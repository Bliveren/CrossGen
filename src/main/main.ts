import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  type IpcMainInvokeEvent
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppSnapshot,
  ConnectionTestResult,
  DownloadRequest,
  GenerationJob,
  ImageParams,
  InputAsset,
  JobProgressEvent,
  ProviderConfig,
  ProviderConfigInput,
  RunJobRequest,
  WorkspaceDraft,
  WorkspaceDraftInput
} from "../shared/types.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_PARAMS,
  dataUrlToBase64,
  getValidationError,
  normalizeBaseURL,
  validateApiKey
} from "../shared/validation.js";
import { buildEndpoint, fetchWithTimeout, runOpenAIImageJob } from "./services/openaiImage.js";
import { recoverInterruptedJobs } from "./services/stateRecovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_VERSION = 1;
const MAX_HISTORY = 100;
const FALLBACK_KEY_PREFIX = "plain:";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

interface StoredConfig {
  id: string;
  name: string;
  baseURL: string;
  enabled: boolean;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: ImageParams["quality"];
  timeoutMs: number;
  updatedAt: string;
  encryptedApiKey?: string;
  encryption: "safeStorage" | "localFallback" | "none";
}

interface AppStateFile {
  version: number;
  config: StoredConfig;
  history: GenerationJob[];
  draft?: WorkspaceDraft;
}

interface ApiErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

const defaultStoredConfig: StoredConfig = {
  id: "default",
  name: "OpenAI",
  baseURL: DEFAULT_BASE_URL,
  enabled: true,
  defaultModel: DEFAULT_IMAGE_PARAMS.model,
  defaultSize: DEFAULT_IMAGE_PARAMS.size,
  defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
  timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
  updatedAt: new Date(0).toISOString(),
  encryption: "none"
};

let stateCache: AppStateFile | null = null;
let recoveredInterruptedJobs = false;

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

function getStatePath(): string {
  return path.join(app.getPath("userData"), "image2tools-state.v1.json");
}

function getBackupStatePath(): string {
  return `${getStatePath()}.bak`;
}

function getImagesDir(): string {
  return path.join(app.getPath("userData"), "images");
}

function getDefaultState(): AppStateFile {
  return {
    version: STATE_VERSION,
    config: { ...defaultStoredConfig },
    history: []
  };
}

function toPublicConfig(config: StoredConfig): ProviderConfig {
  return {
    id: config.id,
    name: config.name,
    apiKeySaved: Boolean(config.encryptedApiKey),
    baseURL: config.baseURL,
    enabled: config.enabled,
    defaultModel: config.defaultModel,
    defaultSize: config.defaultSize,
    defaultQuality: config.defaultQuality,
    timeoutMs: config.timeoutMs,
    updatedAt: config.updatedAt
  };
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
    config: state.config,
    history: state.history.slice(0, MAX_HISTORY),
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

async function readStateFile(filePath: string): Promise<Partial<AppStateFile>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Partial<AppStateFile>;
}

function normalizeState(parsed: Partial<AppStateFile>): AppStateFile {
  return {
    version: STATE_VERSION,
    config: {
      ...defaultStoredConfig,
      ...(parsed.config ?? {}),
      baseURL: normalizeBaseURL(parsed.config?.baseURL ?? DEFAULT_BASE_URL)
    },
    history: Array.isArray(parsed.history) ? parsed.history : [],
    draft: parsed.draft
  };
}

function applyStartupRecovery(state: AppStateFile): AppStateFile {
  const result = recoverInterruptedJobs(state.history);
  recoveredInterruptedJobs = recoveredInterruptedJobs || result.changed;
  return result.changed ? { ...state, history: result.history } : state;
}

function encryptApiKey(apiKey: string): Pick<StoredConfig, "encryptedApiKey" | "encryption"> {
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

function decryptApiKey(config: StoredConfig): string | null {
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

async function getApiKeyOrThrow(): Promise<string> {
  const state = await readState();
  const apiKey = decryptApiKey(state.config);
  if (!apiKey) {
    throw new Error("缺少 API Key。请先保存 OpenAI API Key。");
  }
  const validation = validateApiKey(apiKey);
  if (!validation.ok) {
    throw new Error(validation.message ?? "API Key 无效。");
  }
  return apiKey;
}

async function readApiError(response: Response): Promise<string> {
  const requestId = response.headers.get("x-request-id");
  const requestSuffix = requestId ? ` Request ID: ${requestId}` : "";
  const fallback = `OpenAI API 请求失败：HTTP ${response.status}.${requestSuffix}`;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as ApiErrorPayload;
      const message = payload.error?.message ?? payload.error?.code ?? payload.error?.type;
      return message ? `OpenAI API 请求失败：${message}${requestSuffix}` : fallback;
    }

    const text = await response.text();
    return text.trim() ? `OpenAI API 请求失败：${redactLikelySecrets(text.trim())}${requestSuffix}` : fallback;
  } catch {
    return fallback;
  }
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

function createJob(request: RunJobRequest, inputAssets: InputAsset[], maskAsset?: InputAsset): GenerationJob {
  const now = new Date().toISOString();
  return {
    id: `job_${randomUUID()}`,
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
  return {
    config: toPublicConfig(state.config),
    history: state.history,
    draft: state.draft
  };
}

async function handleSaveConfig(_event: IpcMainInvokeEvent, input: ProviderConfigInput): Promise<ProviderConfig> {
  const state = await readState();
  const now = new Date().toISOString();
  const nextConfig: StoredConfig = {
    ...state.config,
    baseURL: normalizeBaseURL(input.baseURL),
    defaultModel: input.defaultModel.trim() || DEFAULT_IMAGE_PARAMS.model,
    defaultSize: input.defaultSize.trim() || DEFAULT_IMAGE_PARAMS.size,
    defaultQuality: input.defaultQuality,
    timeoutMs: input.timeoutMs,
    updatedAt: now
  };

  if (input.apiKey !== undefined && input.apiKey.trim()) {
    const validation = validateApiKey(input.apiKey);
    if (!validation.ok) {
      throw new Error(validation.message ?? "API Key 无效。");
    }
    Object.assign(nextConfig, encryptApiKey(input.apiKey));
  }

  await writeState({ ...state, config: nextConfig });
  return toPublicConfig(nextConfig);
}

async function handleClearApiKey(): Promise<ProviderConfig> {
  const state = await readState();
  const nextConfig: StoredConfig = {
    ...state.config,
    encryptedApiKey: undefined,
    encryption: "none",
    updatedAt: new Date().toISOString()
  };
  await writeState({ ...state, config: nextConfig });
  return toPublicConfig(nextConfig);
}

async function handleSaveDraft(_event: IpcMainInvokeEvent, input: WorkspaceDraftInput): Promise<WorkspaceDraft> {
  const state = await readState();
  const draft: WorkspaceDraft = {
    ...input,
    prompt: input.prompt,
    inputAssets: input.inputAssets.slice(0, 10),
    maskDataUrl: input.maskDataUrl,
    updatedAt: new Date().toISOString()
  };
  await writeState({ ...state, draft });
  return draft;
}

async function handleClearDraft(): Promise<void> {
  const state = await readState();
  await writeState({ ...state, draft: undefined });
}

async function handleTestConnection(): Promise<ConnectionTestResult> {
  try {
    const state = await readState();
    const apiKey = await getApiKeyOrThrow();
    const response = await fetchWithTimeout(
      fetch,
      buildEndpoint(state.config.baseURL, "/models"),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      },
      Math.min(state.config.timeoutMs, 30000)
    );

    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      return {
        ok: false,
        message: await readApiError(response),
        status: response.status,
        requestId
      };
    }

    return {
      ok: true,
      message: "连接成功。",
      status: response.status,
      requestId
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
  const validationError = getValidationError(request.params, request.prompt);
  if (validationError) {
    throw new Error(validationError);
  }

  const state = await readState();
  const apiKey = await getApiKeyOrThrow();
  const { inputs, mask } = await resolveRequestInputs(request);
  const startedAt = Date.now();
  let job = createJob(request, inputs, mask);
  await upsertJob(job);

  job = {
    ...job,
    status: "running",
    updatedAt: new Date().toISOString()
  };
  await upsertJob(job);
  sendJobEvent({ jobId: job.id, type: "started" });

  try {
    job = await runOpenAIImageJob(job, apiKey, state.config.baseURL, {
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

async function handleDownloadAsset(_event: IpcMainInvokeEvent, request: DownloadRequest): Promise<string | null> {
  const sourceStat = await fs.stat(request.assetPath);
  if (!sourceStat.isFile()) {
    throw new Error("无法下载：资源不是文件。");
  }

  const result = await dialog.showSaveDialog({
    title: "Save image",
    defaultPath: request.suggestedName || path.basename(request.assetPath)
  });

  if (result.canceled || !result.filePath) return null;
  await fs.copyFile(request.assetPath, result.filePath);
  return result.filePath;
}

async function handleOpenAssetFolder(_event: IpcMainInvokeEvent, assetPath: string): Promise<void> {
  try {
    await fs.access(assetPath);
    shell.showItemInFolder(assetPath);
  } catch {
    await shell.openPath(path.dirname(assetPath));
  }
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
  const outputPaths = job.outputs.map((asset) => asset.path);
  const maskPath = job.maskAsset?.path.startsWith(getImagesDir()) ? [job.maskAsset.path] : [];
  return [...outputPaths, ...maskPath];
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:getSnapshot", handleGetSnapshot);
  ipcMain.handle("config:save", handleSaveConfig);
  ipcMain.handle("config:clearApiKey", handleClearApiKey);
  ipcMain.handle("config:testConnection", handleTestConnection);
  ipcMain.handle("draft:save", handleSaveDraft);
  ipcMain.handle("draft:clear", handleClearDraft);
  ipcMain.handle("dialog:selectImages", handleSelectImages);
  ipcMain.handle("dialog:selectMask", handleSelectMask);
  ipcMain.handle("job:run", handleRunJob);
  ipcMain.handle("asset:download", handleDownloadAsset);
  ipcMain.handle("asset:openFolder", handleOpenAssetFolder);
  ipcMain.handle("history:deleteJob", handleDeleteJob);
  ipcMain.handle("history:clear", handleClearHistory);
}

app.whenReady().then(() => {
  registerIpcHandlers();
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
