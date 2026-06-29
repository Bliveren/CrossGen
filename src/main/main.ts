import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  shell,
  type IpcMainInvokeEvent
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppSnapshot,
  ConnectionTestResult,
  DownloadRequest,
  GenerationJob,
  InputAsset,
  JobProgressEvent,
  PromptTemplate,
  PromptTemplateInput,
  ProviderConfig,
  ProviderConfigInput,
  RunJobRequest,
  TemplateExportFormat,
  UpdateCheckResult,
  UpdateInstallResult,
  WorkspaceDraft,
  WorkspaceDraftInput
} from "../shared/types.js";
import {
  DEFAULT_IMAGE_PARAMS,
  dataUrlToBase64,
  getValidationError,
  validateApiKey,
  validateProviderConfigInput,
  validateRunJobRequest,
  validateWorkspaceDraftInput
} from "../shared/validation.js";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  getFocusedModelDefinition,
  getModelDisplayName,
  isGeneralFallbackProvider,
  isPotentialGeneralImageModel,
  normalizeModelId
} from "../shared/modelCatalog.js";
import { compareVersions, isAllowedUpdateUrl, parseUpdateManifest, safeUpdateFileName, selectUpdateAsset } from "../shared/updateManifest.js";
import { fetchWithTimeout } from "./services/openaiImage.js";
import { getImageProviderAdapterForRequest, unsupportedImageProviderMessage } from "./services/imageProviderAdapters.js";
import { discoverModelsAcrossProviders, sanitizeModelDiscoveryError } from "./services/modelDiscovery.js";
import { buildProviderConfigForSave, providerDisplayName } from "./services/providerConfigSave.js";
import { assertKnownOutputPath, assertManagedRegularFile, collectOwnedJobFilePaths, normalizeManagedAssetPath } from "./services/assetOwnership.js";
import { recoverInterruptedJobs } from "./services/stateRecovery.js";
import { type AppStateFile, type StoredProviderConfig, STATE_VERSION, getDefaultState, normalizeImageParams, normalizeState } from "./services/stateMigration.js";
import { verifyUpdateAssetBytes } from "./services/updateInstallerVerification.js";
import { launchWindowsInstallerAndRestart } from "./services/windowsUpdateLauncher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_HISTORY = 100;
const FALLBACK_KEY_PREFIX = "plain:";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ASSET_PROTOCOL = "image2tools-asset";
const UPDATE_CHECK_TIMEOUT_MS = 30000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 600000; // 10 minutes for large installer downloads

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

interface PackageMetadata {
  image2tools?: {
    updateManifestUrl?: unknown;
  };
}

let stateCache: AppStateFile | null = null;
let recoveredInterruptedJobs = false;
let latestUpdateCheck: UpdateCheckResult | null = null;

interface WriteStateOptions {
  updateBackup?: boolean;
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: "Image2Tools",
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  if (devServerURL) {
    void window.loadURL(devServerURL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
  }
}

function registerAssetProtocol(): void {
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const assetPath = url.searchParams.get("path") ?? "";
    const normalized = normalizeManagedAssetPath(getImagesDir(), assetPath);

    if (!normalized) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const safePath = await assertManagedRegularFile(getImagesDir(), normalized);
      const content = await fs.readFile(safePath);
      const mimeType = mimeTypeForFile(safePath);
      return new Response(new Blob([content], { type: mimeType }), {
        headers: {
          "cache-control": "no-store",
          "content-type": mimeType
        }
      });
    } catch (error) {
      console.warn("[image2tools] Failed to serve image asset.", sanitizeError(error));
      return new Response("Not found", { status: 404 });
    }
  });
}

function getStatePath(): string {
  return path.join(app.getPath("userData"), "image2tools-state.v1.json");
}

function getBackupStatePath(): string {
  return `${getStatePath()}.bak`;
}

function getImagesDir(): string {
  return path.join(app.getPath("userData"), "images");
}

function toPublicConfig(config: StoredProviderConfig): ProviderConfig {
  return {
    id: config.id,
    kind: config.kind,
    name: config.name,
    apiKeySaved: Boolean(config.encryptedApiKey),
    apiKeyPreview: getSavedApiKeyPreview(config),
    baseURL: config.baseURL,
    enabled: config.enabled,
    defaultModel: config.defaultModel,
    defaultSize: config.defaultSize,
    defaultQuality: config.defaultQuality,
    timeoutMs: config.timeoutMs,
    discoveredModels: config.discoveredModels,
    lastModelDiscoveryAt: config.lastModelDiscoveryAt,
    lastModelDiscoveryError: config.lastModelDiscoveryError,
    activeLaunchId: config.activeLaunchId,
    activeModelId: config.activeModelId,
    updatedAt: config.updatedAt
  };
}

function getAppVersion(): string {
  return app.getVersion();
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readState(): Promise<AppStateFile> {
  if (stateCache) return stateCache;

  try {
    stateCache = applyStartupRecovery(normalizeState(await readStateFile(getStatePath())));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      console.warn("[image2tools] Failed to read state file; trying backup.", sanitizeError(error));
    }

    try {
      stateCache = applyStartupRecovery(normalizeState(await readStateFile(getBackupStatePath())));
      await writeState(stateCache, { updateBackup: false });
      return stateCache;
    } catch (backupError) {
      if (!isNodeError(backupError) || backupError.code !== "ENOENT") {
        console.warn("[image2tools] Failed to read backup state file; using defaults.", sanitizeError(backupError));
      }
      stateCache = getDefaultState();
      await writeState(stateCache);
    }
  }

  if (recoveredInterruptedJobs) {
    recoveredInterruptedJobs = false;
    await writeState(stateCache);
  }
  return stateCache;
}

async function writeState(state: AppStateFile, options: WriteStateOptions = {}): Promise<void> {
  await ensureDir(app.getPath("userData"));
  const payload: AppStateFile = {
    version: STATE_VERSION,
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    history: state.history.slice(0, MAX_HISTORY),
    promptTemplates: state.promptTemplates,
    draft: state.draft
  };
  const statePath = getStatePath();
  const backupPath = getBackupStatePath();
  const tmpPath = `${statePath}.tmp`;
  if (options.updateBackup !== false) {
    try {
      await fs.copyFile(statePath, backupPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        console.warn("[image2tools] Failed to update state backup.", sanitizeError(error));
      }
    }
  }
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, statePath);
  stateCache = payload;
}

async function readStateFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function applyStartupRecovery(state: AppStateFile): AppStateFile {
  const result = recoverInterruptedJobs(state.history);
  recoveredInterruptedJobs = recoveredInterruptedJobs || result.changed;
  return result.changed ? { ...state, history: result.history } : state;
}

function encryptApiKey(apiKey: string): Pick<StoredProviderConfig, "encryptedApiKey" | "encryption"> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { encryptedApiKey: undefined, encryption: "none" };
  }

  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryptedApiKey: safeStorage.encryptString(trimmed).toString("base64"),
      encryption: "safeStorage"
    };
  }

  // Explicit fallback for platforms without Electron safeStorage support.
  // This is reversible local storage only, not OS-backed encryption.
  return {
    encryptedApiKey: `${FALLBACK_KEY_PREFIX}${Buffer.from(trimmed, "utf8").toString("base64")}`,
    encryption: "localFallback"
  };
}

function decryptApiKey(config: StoredProviderConfig): string | null {
  if (!config.encryptedApiKey) return null;

  if (config.encryption === "safeStorage") {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("已保存 API Key，但当前系统无法使用 Electron safeStorage 解密。请重新保存 API Key。");
    }
    return safeStorage.decryptString(Buffer.from(config.encryptedApiKey, "base64"));
  }

  if (config.encryption === "localFallback" && config.encryptedApiKey.startsWith(FALLBACK_KEY_PREFIX)) {
    return Buffer.from(config.encryptedApiKey.slice(FALLBACK_KEY_PREFIX.length), "base64").toString("utf8");
  }

  return null;
}

function getSavedApiKeyPreview(config: StoredProviderConfig): string | undefined {
  if (!config.encryptedApiKey) return undefined;

  try {
    const apiKey = decryptApiKey(config);
    return apiKey ? maskApiKeyPreview(apiKey) : undefined;
  } catch {
    return undefined;
  }
}

function maskApiKeyPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}${"*".repeat(12)}${trimmed.slice(-4)}`;
}

async function getApiKeyOrThrow(): Promise<string> {
  const state = await readState();
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  return getApiKeyForConfigOrThrow(activeProvider);
}

function getApiKeyForConfigOrThrow(config: StoredProviderConfig): string {
  const apiKey = decryptApiKey(config);
  if (!apiKey) {
    throw new Error(`缺少 API Key。请先保存 ${providerDisplayName(config.kind)} API Key。`);
  }
  const validation = validateApiKey(apiKey);
  if (!validation.ok) {
    throw new Error(validation.message ?? "API Key 无效。");
  }
  return apiKey;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return redactLikelySecrets(error.message);
  return redactLikelySecrets(String(error));
}

function sanitizeError(error: unknown): string {
  return normalizeError(error).replace(/\s+/g, " ");
}

function redactLikelySecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted");
}

function getUpdatesDir(): string {
  return path.join(app.getPath("userData"), "updates");
}

function getUpdateManifestUrl(): string {
  const envUrl = process.env.IMAGE2TOOLS_UPDATE_URL?.trim();
  if (envUrl) return envUrl;

  try {
    const packagePath = path.join(app.getAppPath(), "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as PackageMetadata;
    const packageUrl = packageJson.image2tools?.updateManifestUrl;
    return typeof packageUrl === "string" ? packageUrl.trim() : "";
  } catch {
    return "";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function mimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function createAssetId(filePath: string): string {
  const hash = createHash("sha1").update(filePath).digest("hex").slice(0, 12);
  return `asset_${hash}`;
}

async function toInputAsset(filePath: string, includePreview: boolean): Promise<InputAsset> {
  const stat = await fs.stat(filePath);
  const mimeType = mimeTypeForFile(filePath);
  const asset: InputAsset = {
    id: createAssetId(filePath),
    name: path.basename(filePath),
    path: filePath,
    mimeType,
    sizeBytes: stat.size
  };

  if (includePreview) {
    const content = await fs.readFile(filePath);
    asset.dataUrl = `data:${mimeType};base64,${content.toString("base64")}`;
  }

  return asset;
}

async function selectedFilesToAssets(paths: string[]): Promise<InputAsset[]> {
  const imagePaths = paths.filter(isImagePath);
  return Promise.all(imagePaths.map((filePath) => toInputAsset(filePath, true)));
}

async function resolveRequestInputs(request: RunJobRequest): Promise<{ inputs: InputAsset[]; mask?: InputAsset }> {
  const inputs = await Promise.all(request.inputPaths.filter(isImagePath).map((filePath) => toInputAsset(filePath, false)));

  let mask: InputAsset | undefined;
  if (request.maskPath) {
    mask = await toInputAsset(request.maskPath, false);
  } else if (request.maskDataUrl) {
    mask = await persistMaskDataUrl(request.maskDataUrl);
  }

  return { inputs, mask };
}

async function persistMaskDataUrl(dataUrl: string): Promise<InputAsset> {
  const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  await ensureDir(getImagesDir());
  const fileName = `mask-${Date.now()}-${randomUUID()}.${ext}`;
  const filePath = path.join(getImagesDir(), fileName);
  await fs.writeFile(filePath, Buffer.from(dataUrlToBase64(dataUrl), "base64"));
  const stat = await fs.stat(filePath);

  return {
    id: createAssetId(filePath),
    name: fileName,
    path: filePath,
    mimeType,
    sizeBytes: stat.size,
    dataUrl
  };
}

function createJob(request: RunJobRequest, config: StoredProviderConfig, inputAssets: InputAsset[], maskAsset?: InputAsset): GenerationJob {
  const now = new Date().toISOString();
  const launchId = request.params.launchId;
  const modelId = request.params.model;
  return {
    id: `job_${randomUUID()}`,
    providerKind: request.params.providerKind,
    providerId: config.id,
    launchId,
    modelId,
    modelDisplayName: getModelDisplayName(launchId, modelId),
    mode: request.mode,
    prompt: request.prompt.trim(),
    inputAssets,
    maskAsset,
    params: request.params,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    outputs: []
  };
}

async function upsertJob(job: GenerationJob): Promise<void> {
  const state = await readState();
  const existingIndex = state.history.findIndex((item) => item.id === job.id);
  const nextHistory =
    existingIndex === -1
      ? [job, ...state.history]
      : state.history.map((item) => (item.id === job.id ? job : item));
  await writeState({ ...state, history: nextHistory.slice(0, MAX_HISTORY) });
}

function sendJobEvent(event: JobProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("job:event", event);
  }
}

async function handleGetSnapshot(): Promise<AppSnapshot> {
  const state = await readState();
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  return {
    appVersion: getAppVersion(),
    providers: state.providers.map(toPublicConfig),
    activeProviderId: state.activeProviderId,
    history: state.history,
    promptTemplates: state.promptTemplates,
    draft: state.draft
  };
}

async function handleSaveConfig(_event: IpcMainInvokeEvent, input: ProviderConfigInput): Promise<ProviderConfig> {
  const state = await readState();
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  const configValidation = validateProviderConfigInput(input);
  if (!configValidation.ok) {
    throw new Error(configValidation.message ?? "配置参数无效。");
  }
  const now = new Date().toISOString();
  let nextConfig = buildProviderConfigForSave(activeProvider, input, now);

  if (input.apiKey !== undefined && input.apiKey.trim()) {
    const validation = validateApiKey(input.apiKey);
    if (!validation.ok) {
      throw new Error(validation.message ?? "API Key 无效。");
    }
    Object.assign(nextConfig, encryptApiKey(input.apiKey));
  }

  const hasUsableApiKey = Boolean(nextConfig.encryptedApiKey);
  const baseURLChanged = nextConfig.baseURL !== activeProvider.baseURL;
  const submittedNewApiKey = input.apiKey !== undefined && input.apiKey.trim().length > 0;
  if (hasUsableApiKey && (submittedNewApiKey || baseURLChanged)) {
    nextConfig = await refreshModelDiscovery(nextConfig);
  }

  const nextProviders = state.providers.map(p => p.id === state.activeProviderId ? nextConfig : p);
  await writeState({ ...state, providers: nextProviders });
  return toPublicConfig(nextConfig);
}

async function handleAddProvider(_event: IpcMainInvokeEvent, input: ProviderConfigInput): Promise<AppSnapshot> {
  const state = await readState();
  const configValidation = validateProviderConfigInput(input);
  if (!configValidation.ok) {
    throw new Error(configValidation.message ?? "配置参数无效。");
  }

  const now = new Date().toISOString();
  const newId = `provider_${randomUUID()}`;
  const kind = input.kind ?? "openai";

  const baseConfig: StoredProviderConfig = {
    id: newId,
    kind,
    name: input.name?.trim() || providerDisplayName(kind),
    baseURL: input.baseURL,
    enabled: true,
    defaultModel: input.defaultModel,
    defaultSize: input.defaultSize,
    defaultQuality: input.defaultQuality,
    timeoutMs: input.timeoutMs,
    discoveredModels: [],
    activeLaunchId: input.activeLaunchId ?? GPT_IMAGE_2_LAUNCH_ID,
    activeModelId: input.activeModelId ?? input.defaultModel,
    updatedAt: now,
    encryption: "none"
  };
  let newConfig = buildProviderConfigForSave(baseConfig, input, now);

  if (input.apiKey !== undefined && input.apiKey.trim()) {
    const validation = validateApiKey(input.apiKey);
    if (!validation.ok) {
      throw new Error(validation.message ?? "API Key 无效。");
    }
    Object.assign(newConfig, encryptApiKey(input.apiKey));
    newConfig = await refreshModelDiscovery(newConfig);
  }

  const nextProviders = [...state.providers, newConfig];
  const nextState = { ...state, providers: nextProviders, activeProviderId: newId };
  await writeState(nextState);

  return {
    appVersion: getAppVersion(),
    providers: nextProviders.map(toPublicConfig),
    activeProviderId: newId,
    history: state.history,
    promptTemplates: state.promptTemplates,
    draft: state.draft
  };
}

async function handleSwitchProvider(_event: IpcMainInvokeEvent, providerId: string): Promise<AppSnapshot> {
  const state = await readState();
  const provider = state.providers.find(p => p.id === providerId);

  if (!provider) {
    throw new Error(`Provider ${providerId} not found.`);
  }

  const nextState = { ...state, activeProviderId: providerId };
  await writeState(nextState);

  return {
    appVersion: getAppVersion(),
    providers: state.providers.map(toPublicConfig),
    activeProviderId: providerId,
    history: state.history,
    promptTemplates: state.promptTemplates,
    draft: state.draft
  };
}

async function handleDeleteProvider(_event: IpcMainInvokeEvent, providerId: string): Promise<AppSnapshot> {
  const state = await readState();

  if (state.providers.length <= 1) {
    throw new Error("Cannot delete the last provider.");
  }

  const nextProviders = state.providers.filter(p => p.id !== providerId);
  const nextActiveProviderId = state.activeProviderId === providerId ? nextProviders[0].id : state.activeProviderId;

  const nextState = { ...state, providers: nextProviders, activeProviderId: nextActiveProviderId };
  await writeState(nextState);

  return {
    appVersion: getAppVersion(),
    providers: nextProviders.map(toPublicConfig),
    activeProviderId: nextActiveProviderId,
    history: state.history,
    promptTemplates: state.promptTemplates,
    draft: state.draft
  };
}

async function handleClearApiKey(): Promise<ProviderConfig> {
  const state = await readState();
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  const nextConfig: StoredProviderConfig = {
    ...activeProvider,
    encryptedApiKey: undefined,
    encryption: "none",
    discoveredModels: [],
    lastModelDiscoveryAt: undefined,
    lastModelDiscoveryError: undefined,
    updatedAt: new Date().toISOString()
  };
  const nextProviders = state.providers.map(p => p.id === state.activeProviderId ? nextConfig : p);
  await writeState({ ...state, providers: nextProviders });
  return toPublicConfig(nextConfig);
}

async function handleSaveDraft(_event: IpcMainInvokeEvent, input: WorkspaceDraftInput): Promise<WorkspaceDraft> {
  const validation = validateWorkspaceDraftInput(input);
  if (!validation.ok) {
    throw new Error(validation.message ?? "草稿参数无效。");
  }
  const state = await readState();
  const params = normalizeImageParams(input.params);
  const draft: WorkspaceDraft = {
    ...input,
    params,
    activeLaunchId: input.activeLaunchId ?? params.launchId,
    activeModelId: input.activeModelId?.trim() || params.model,
    updatedAt: new Date().toISOString()
  };
  await writeState({ ...state, draft });
  return draft;
}

async function handleClearDraft(): Promise<void> {
  const state = await readState();
  await writeState({ ...state, draft: undefined });
}

function normalizePromptTemplateInput(input: PromptTemplateInput): Required<Pick<PromptTemplateInput, "title" | "body" | "tags">> & Pick<PromptTemplateInput, "category"> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error("模板标题不能为空。");
  if (!body) throw new Error("模板正文不能为空。");
  return {
    title,
    body,
    tags: normalizeTemplateTags(input.tags),
    category: input.category?.trim() || undefined
  };
}

function normalizeTemplateTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const tag = item.trim();
    if (!tag || seen.has(tag)) return [];
    seen.add(tag);
    return [tag];
  });
}

function normalizeImportedTemplate(value: unknown, now: string): PromptTemplate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.title !== "string" || typeof input.body !== "string") return null;
  try {
    const normalized = normalizePromptTemplateInput({
      title: input.title,
      body: input.body,
      tags: normalizeTemplateTags(input.tags),
      category: typeof input.category === "string" ? input.category : undefined
    });
    const createdAt = typeof input.createdAt === "string" && input.createdAt.trim() ? input.createdAt.trim() : now;
    const updatedAt = typeof input.updatedAt === "string" && input.updatedAt.trim() ? input.updatedAt.trim() : createdAt;
    return {
      id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : `template_${randomUUID()}`,
      ...normalized,
      createdAt,
      updatedAt
    };
  } catch {
    return null;
  }
}

async function handleListTemplates(): Promise<PromptTemplate[]> {
  const state = await readState();
  return state.promptTemplates;
}

async function handleSaveTemplate(_event: IpcMainInvokeEvent, input: PromptTemplateInput, templateId?: string): Promise<PromptTemplate> {
  const state = await readState();
  const normalized = normalizePromptTemplateInput(input);
  const now = new Date().toISOString();
  const existing = templateId ? state.promptTemplates.find((template) => template.id === templateId) : undefined;
  const template: PromptTemplate = {
    id: existing?.id ?? `template_${randomUUID()}`,
    ...normalized,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const promptTemplates = existing
    ? state.promptTemplates.map((item) => (item.id === existing.id ? template : item))
    : [template, ...state.promptTemplates];
  await writeState({ ...state, promptTemplates });
  return template;
}

async function handleDeleteTemplate(_event: IpcMainInvokeEvent, id: string): Promise<void> {
  const state = await readState();
  await writeState({ ...state, promptTemplates: state.promptTemplates.filter((template) => template.id !== id) });
}

async function handleImportTemplates(): Promise<{ imported: number; skipped: number }> {
  const result = await dialog.showOpenDialog({
    title: "导入提示词模板",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { imported: 0, skipped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
  } catch {
    throw new Error("模板 JSON 无法解析。");
  }

  if (!parsed || typeof parsed !== "object" || (parsed as TemplateExportFormat).schemaVersion !== 1 || !Array.isArray((parsed as TemplateExportFormat).templates)) {
    throw new Error("模板 JSON 格式不受支持。");
  }

  const state = await readState();
  const now = new Date().toISOString();
  const existingIds = new Set(state.promptTemplates.map((template) => template.id));
  const imported: PromptTemplate[] = [];
  let skipped = 0;

  for (const rawTemplate of (parsed as TemplateExportFormat).templates) {
    const template = normalizeImportedTemplate(rawTemplate, now);
    if (!template) {
      skipped += 1;
      continue;
    }
    let id = template.id;
    if (existingIds.has(id)) {
      id = `template_${randomUUID()}`;
    }
    existingIds.add(id);
    imported.push({ ...template, id });
  }

  if (imported.length > 0) {
    await writeState({ ...state, promptTemplates: [...imported, ...state.promptTemplates] });
  }

  return { imported: imported.length, skipped };
}

async function handleExportTemplates(_event: IpcMainInvokeEvent, templateIds?: string[]): Promise<string | null> {
  const state = await readState();
  const selectedIds = new Set(Array.isArray(templateIds) ? templateIds : []);
  const templates = selectedIds.size > 0
    ? state.promptTemplates.filter((template) => selectedIds.has(template.id))
    : state.promptTemplates;
  const result = await dialog.showSaveDialog({
    title: "导出提示词模板",
    defaultPath: `image2tools-prompt-templates-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return null;

  const payload: TemplateExportFormat = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    templates
  };
  await fs.writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return result.filePath;
}

async function refreshModelDiscovery(config: StoredProviderConfig): Promise<StoredProviderConfig> {
  const apiKey = getApiKeyForConfigOrThrow(config);
  try {
    const discovery = await discoverModelsAcrossProviders(config.kind, config.baseURL, apiKey, Math.min(config.timeoutMs, 30000), { fetch });
    const kind = discovery.inferredProviderKind ?? config.kind;
    const activeSelection = discovery.inferredProviderKind
      ? selectActiveLaunchForDiscovery(config, discovery.models, discovery.inferredProviderKind)
      : {
          activeLaunchId: config.activeLaunchId,
          activeModelId: config.activeModelId,
          defaultModel: config.defaultModel
        };
    return {
      ...config,
      kind,
      name: config.name || providerDisplayName(kind),
      defaultModel: activeSelection.defaultModel,
      activeLaunchId: activeSelection.activeLaunchId,
      activeModelId: activeSelection.activeModelId,
      discoveredModels: discovery.models,
      lastModelDiscoveryAt: new Date().toISOString(),
      lastModelDiscoveryError: undefined,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...config,
      discoveredModels: [],
      lastModelDiscoveryAt: new Date().toISOString(),
      lastModelDiscoveryError: sanitizeModelDiscoveryError(error, apiKey),
      updatedAt: new Date().toISOString()
    };
  }
}

function selectActiveLaunchForDiscovery(
  config: StoredProviderConfig,
  models: StoredProviderConfig["discoveredModels"],
  inferredProviderKind: StoredProviderConfig["kind"]
) {
  if (inferredProviderKind === "gemini") {
    const nanoDefinition = getFocusedModelDefinition(NANO_BANANA_3_LAUNCH_ID);
    const nanoModelIds = new Set((nanoDefinition?.modelIds ?? []).map(normalizeModelId));
    const nanoModel = models.find((model) => model.providerKind === "gemini" && nanoModelIds.has(normalizeModelId(model.id)));
    if (nanoModel) {
      return {
        activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
        activeModelId: nanoModel.id,
        defaultModel: nanoModel.id
      };
    }
  }

  if (inferredProviderKind === "openai") {
    const gptModel = models.find((model) => model.providerKind === "openai" && normalizeModelId(model.id) === normalizeModelId(GPT_IMAGE_2_MODEL_ID));
    if (gptModel) {
      return {
        activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
        activeModelId: gptModel.id,
        defaultModel: gptModel.id
      };
    }
  }

  const generalModel = models.find((model) => isGeneralFallbackProvider(model.providerKind) && isPotentialGeneralImageModel(model));
  if (generalModel) {
    return {
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: generalModel.id,
      defaultModel: generalModel.id
    };
  }

  return {
    activeLaunchId: config.activeLaunchId,
    activeModelId: config.activeModelId,
    defaultModel: config.defaultModel
  };
}

async function handleDiscoverModels(): Promise<ProviderConfig> {
  const state = await readState();
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  const nextConfig = await refreshModelDiscovery(activeProvider);
  const nextProviders = state.providers.map(p => p.id === state.activeProviderId ? nextConfig : p);
  await writeState({ ...state, providers: nextProviders });
  return toPublicConfig(nextConfig);
}

async function handleTestConnection(): Promise<ConnectionTestResult> {
  try {
    const state = await readState();
    const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
    const nextConfig = await refreshModelDiscovery(activeProvider);
    const nextProviders = state.providers.map(p => p.id === state.activeProviderId ? nextConfig : p);
    await writeState({ ...state, providers: nextProviders });
    if (nextConfig.lastModelDiscoveryError) {
      return {
        ok: false,
        message: nextConfig.lastModelDiscoveryError
      };
    }

    return {
      ok: true,
      message: "连接成功。",
      status: 200
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizeError(error)
    };
  }
}

async function handleSelectImages(): Promise<InputAsset[]> {
  const result = await dialog.showOpenDialog({
    title: "Select images",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });

  if (result.canceled) return [];
  return selectedFilesToAssets(result.filePaths);
}

async function handleImportImages(_event: IpcMainInvokeEvent, paths: unknown): Promise<InputAsset[]> {
  if (!Array.isArray(paths)) return [];
  const safePaths = paths.filter((value): value is string => typeof value === "string" && value.length > 0);
  return selectedFilesToAssets(safePaths);
}

async function handleSelectMask(): Promise<InputAsset | null> {
  const result = await dialog.showOpenDialog({
    title: "Select mask",
    properties: ["openFile"],
    filters: [{ name: "Mask images with alpha", extensions: ["png", "webp"] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return toInputAsset(result.filePaths[0], true);
}

async function handleRunJob(_event: IpcMainInvokeEvent, request: RunJobRequest): Promise<GenerationJob> {
  const validation = validateRunJobRequest(request);
  if (!validation.ok) {
    throw new Error(validation.message ?? "任务请求无效。");
  }
  const normalizedRequest: RunJobRequest = {
    ...request,
    params: normalizeImageParams(request.params)
  };
  const validationError = getValidationError(normalizedRequest.params, normalizedRequest.prompt);
  if (validationError) {
    throw new Error(validationError);
  }
  const adapter = getImageProviderAdapterForRequest(normalizedRequest);
  if (!adapter) {
    throw new Error(unsupportedImageProviderMessage());
  }
  const adapterValidation = adapter.validateJob(normalizedRequest);
  if (!adapterValidation.ok) {
    throw new Error(adapterValidation.message ?? "任务请求无效。");
  }

  const state = await readState();
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  if (!canRunRequestWithConfig(normalizedRequest, activeProvider)) {
    throw new Error("任务 provider 与当前服务配置不一致。请先切换并保存对应服务商。");
  }
  const apiKey = await getApiKeyOrThrow();
  const { inputs, mask } = await resolveRequestInputs(normalizedRequest);
  const startedAt = Date.now();
  let job = createJob(normalizedRequest, activeProvider, inputs, mask);
  await upsertJob(job);

  job = {
    ...job,
    status: "running",
    updatedAt: new Date().toISOString()
  };
  await upsertJob(job);
  sendJobEvent({ jobId: job.id, type: "started" });

  try {
    job = await adapter.runJob(job, apiKey, activeProvider, {
      fetch,
      imagesDir: getImagesDir(),
      ensureDir,
      sendJobEvent
    });
    job = {
      ...job,
      durationMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    };
    await upsertJob(job);
    sendJobEvent({ jobId: job.id, type: "completed" });
    return job;
  } catch (error) {
    const message = normalizeError(error);
    job = {
      ...job,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: message,
      updatedAt: new Date().toISOString()
    };
    await upsertJob(job);
    sendJobEvent({ jobId: job.id, type: "failed", error: message });
    return job;
  }
}

function canRunRequestWithConfig(request: RunJobRequest, config: StoredProviderConfig): boolean {
  if (request.params.providerKind === config.kind) return true;
  if (request.params.launchId !== config.activeLaunchId) return false;

  const requestedModelId = normalizeModelId(request.params.model);
  return config.discoveredModels.some(
    (model) => model.providerKind === request.params.providerKind && normalizeModelId(model.id) === requestedModelId
  );
}

async function handleDownloadAsset(_event: IpcMainInvokeEvent, request: DownloadRequest): Promise<string | null> {
  const state = await readState();
  const sourcePath = assertKnownOutputPath(getImagesDir(), state.history, request.assetPath);
  await assertManagedRegularFile(getImagesDir(), sourcePath);

  const result = await dialog.showSaveDialog({
    title: "Save image",
    defaultPath: request.suggestedName || path.basename(sourcePath)
  });

  if (result.canceled || !result.filePath) return null;
  await fs.copyFile(sourcePath, result.filePath);
  return result.filePath;
}

async function handleOpenAssetFolder(_event: IpcMainInvokeEvent, assetPath: string): Promise<void> {
  const state = await readState();
  const sourcePath = assertKnownOutputPath(getImagesDir(), state.history, assetPath);
  try {
    await assertManagedRegularFile(getImagesDir(), sourcePath);
    shell.showItemInFolder(sourcePath);
  } catch {
    await shell.openPath(getImagesDir());
  }
}

async function handleCheckForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = getAppVersion();
  const checkedAt = new Date().toISOString();
  const manifestUrl = getUpdateManifestUrl();

  if (!manifestUrl) {
    latestUpdateCheck = {
      status: "not-configured",
      currentVersion,
      updateAvailable: false,
      checkedAt,
      message: "未配置更新检查地址。"
    };
    return latestUpdateCheck;
  }

  if (!isAllowedUpdateUrl(manifestUrl)) {
    latestUpdateCheck = {
      status: "error",
      currentVersion,
      updateAvailable: false,
      checkedAt,
      message: "更新 manifest URL 必须是 https，或本地调试用 http loopback。"
    };
    return latestUpdateCheck;
  }

  try {
    const response = await fetchWithTimeout(
      fetch,
      manifestUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      },
      UPDATE_CHECK_TIMEOUT_MS
    );

    if (!response.ok) {
      const notFoundHint = response.status === 404 ? "manifest 地址不存在，请检查更新地址或发布配置。" : "";
      throw new Error(`更新检查失败：HTTP ${response.status}${notFoundHint ? `，${notFoundHint}` : ""}`);
    }

    const manifest = parseUpdateManifest(await response.json());
    const asset = selectUpdateAsset(manifest.assets, process.platform, process.arch);
    const updateAvailable = compareVersions(manifest.version, currentVersion) > 0;
    latestUpdateCheck = {
      status: updateAvailable && asset ? "available" : "current",
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable: updateAvailable && Boolean(asset),
      checkedAt,
      notes: manifest.notes,
      pubDate: manifest.pubDate,
      asset,
      message: updateAvailable && !asset ? "发现新版本，但没有适用于当前系统的安装包。" : undefined
    };
    return latestUpdateCheck;
  } catch (error) {
    latestUpdateCheck = {
      status: "error",
      currentVersion,
      updateAvailable: false,
      checkedAt,
      message: normalizeError(error)
    };
    return latestUpdateCheck;
  }
}

async function handleDownloadAndInstallUpdate(): Promise<UpdateInstallResult> {
  const update = latestUpdateCheck?.status === "available" ? latestUpdateCheck : await handleCheckForUpdates();
  if (update.status !== "available" || !update.asset || !update.latestVersion) {
    throw new Error(update.message ?? "当前没有可安装的更新。");
  }

  await ensureDir(getUpdatesDir());
  const fileName = safeUpdateFileName(update.asset);
  const filePath = path.join(getUpdatesDir(), fileName);
  const response = await fetchWithTimeout(fetch, update.asset.url, { method: "GET" }, UPDATE_DOWNLOAD_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`更新包下载失败：HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  verifyUpdateAssetBytes(update.asset, bytes);

  await fs.writeFile(filePath, bytes);
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755).catch(() => undefined);
  }

  if (process.platform === "win32") {
    launchWindowsInstallerAndRestart(filePath, { appQuit: () => app.quit() });
    return {
      version: update.latestVersion,
      filePath,
      message: "更新包已下载并启动静默安装，应用将关闭并在安装完成后重新打开。"
    };
  }

  const openError = await shell.openPath(filePath);
  if (openError) {
    throw new Error(`更新包已下载，但无法打开安装程序：${openError}`);
  }

  return {
    version: update.latestVersion,
    filePath,
    message: "更新包已下载并打开安装程序。"
  };
}

async function handleDeleteJob(_event: IpcMainInvokeEvent, jobId: string): Promise<GenerationJob[]> {
  const state = await readState();
  const job = state.history.find((item) => item.id === jobId);
  const history = state.history.filter((item) => item.id !== jobId);
  await writeState({ ...state, history });
  if (job) {
    await Promise.all(pathsOwnedByJob(job).map((assetPath) => fs.unlink(assetPath).catch(() => undefined)));
  }
  return history;
}

async function handleClearHistory(): Promise<GenerationJob[]> {
  const state = await readState();
  const paths = state.history.flatMap(pathsOwnedByJob);
  await writeState({ ...state, history: [] });
  await Promise.all(paths.map((assetPath) => fs.unlink(assetPath).catch(() => undefined)));
  return [];
}

function pathsOwnedByJob(job: GenerationJob): string[] {
  return collectOwnedJobFilePaths(getImagesDir(), job);
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:getSnapshot", handleGetSnapshot);
  ipcMain.handle("config:save", handleSaveConfig);
  ipcMain.handle("provider:add", handleAddProvider);
  ipcMain.handle("provider:switch", handleSwitchProvider);
  ipcMain.handle("provider:delete", handleDeleteProvider);
  ipcMain.handle("config:discoverModels", handleDiscoverModels);
  ipcMain.handle("config:clearApiKey", handleClearApiKey);
  ipcMain.handle("config:testConnection", handleTestConnection);
  ipcMain.handle("draft:save", handleSaveDraft);
  ipcMain.handle("draft:clear", handleClearDraft);
  ipcMain.handle("templates:list", handleListTemplates);
  ipcMain.handle("templates:save", handleSaveTemplate);
  ipcMain.handle("templates:delete", handleDeleteTemplate);
  ipcMain.handle("templates:import", handleImportTemplates);
  ipcMain.handle("templates:export", handleExportTemplates);
  ipcMain.handle("dialog:selectImages", handleSelectImages);
  ipcMain.handle("dialog:importImages", handleImportImages);
  ipcMain.handle("dialog:selectMask", handleSelectMask);
  ipcMain.handle("job:run", handleRunJob);
  ipcMain.handle("asset:download", handleDownloadAsset);
  ipcMain.handle("asset:openFolder", handleOpenAssetFolder);
  ipcMain.handle("updates:check", handleCheckForUpdates);
  ipcMain.handle("updates:downloadAndInstall", handleDownloadAndInstallUpdate);
  ipcMain.handle("history:deleteJob", handleDeleteJob);
  ipcMain.handle("history:clear", handleClearHistory);
}

app.whenReady().then(() => {
  registerIpcHandlers();
  registerAssetProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
