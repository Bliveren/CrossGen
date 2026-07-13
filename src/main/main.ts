import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  nativeImage,
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
  EditedImageDownloadRequest,
  EditedGalleryImageInput,
  GalleryAsset,
  GalleryAssetPatch,
  GalleryFolder,
  GalleryFolderDeleteResult,
  GalleryFolderInput,
  GenerationJob,
  HistoryJobPatch,
  ImageAsset,
  InputAsset,
  JobProgressEvent,
  OpenAIImageRoute,
  OpenAIImageRouteProbe,
  OpenAIImageRouting,
  PromptTemplate,
  PromptTemplateInput,
  ProviderConfig,
  ProviderConfigInput,
  RunJobRequest,
  StorageKind,
  StorageFolderOptions,
  StorageSettings,
  TemplateExportFormat,
  UpdateCheckResult,
  UpdateInstallResult,
  WorkspaceDraft,
  WorkspaceDraftInput
} from "../shared/types.js";
import {
  DEFAULT_IMAGE_PARAMS,
  dataUrlToBase64,
  defaultStreamingPartialsEnabled,
  getValidationError,
  stripTransientPreviewsFromJob,
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
import { buildEndpoint, fetchWithTimeout } from "./services/openaiImageAdapter.js";
import { getImageProviderAdapterForRequest, unsupportedImageProviderMessage } from "./services/imageProviderAdapters.js";
import { discoverModelsAcrossProviders, sanitizeModelDiscoveryError } from "./services/modelDiscovery.js";
import { buildProviderConfigForSave, providerDisplayName } from "./services/providerConfigSave.js";
import { assertManagedRegularFile, assertManagedRegularFileInRoots, collectOwnedJobFilePaths, normalizeManagedAssetPath, resolveManagedFileName } from "./services/assetOwnership.js";
import {
  diskGalleryFoldersFromState,
  isIgnoredGalleryEntryName,
  reconcileGalleryDiskChangesWithResult,
  reconcileGalleryDiskStateWithResult,
  scanGalleryDisk,
  startGalleryDiskWatchers,
  type GalleryWatchHandle
} from "./services/galleryDiskSync.js";
import { DEFAULT_GALLERY_THUMBNAIL_SIZE, galleryThumbnailCachePath } from "./services/galleryThumbnailCache.js";
import { recoverInterruptedJobs } from "./services/stateRecovery.js";
import { type AppStateFile, type StoredProviderConfig, STATE_VERSION, getDefaultState, normalizeImageParams, normalizeState } from "./services/stateMigration.js";
import { verifyUpdateAssetBytes } from "./services/updateInstallerVerification.js";
import { launchWindowsInstaller } from "./services/windowsUpdateLauncher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_HISTORY = 100;
const FALLBACK_KEY_PREFIX = "plain:";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_GALLERY_FOLDER_NAME_BYTES = 120;
const MAX_GALLERY_FILE_NAME_BYTES = 180;
const WINDOWS_RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

type GalleryDuplicateChoice = "cancel" | "replace" | "copy";

interface GalleryAssetCreateResult {
  asset: GalleryAsset | null;
  replacedAssetId?: string;
}
const ASSET_PROTOCOL = "image2tools-asset";
const UPDATE_CHECK_TIMEOUT_MS = 30000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 600000; // 10 minutes for large installer downloads
const BRAND_NAME = "CrossGen";
const LEGACY_USER_DATA_NAME = "Image2Tools";
const USER_DATA_DIR_ENV = "CROSSGEN_USER_DATA_DIR";
const LEGACY_USER_DATA_DIR_ENV = "IMAGE2TOOLS_USER_DATA_DIR";
const PERF_RESULT_PATH_ENV = "CROSSGEN_PERF_RESULT_PATH";
const RENDERER_PERF_RESULT_PATH_ENV = "CROSSGEN_RENDERER_PERF_RESULT_PATH";
const THEME_SOURCE_ENV = "CROSSGEN_THEME_SOURCE";
const RENDERER_SCREENSHOT_DIR_ENV = "CROSSGEN_RENDERER_SCREENSHOT_DIR";

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true
    }
  }
]);

interface PackageMetadata {
  crossgen?: {
    updateManifestUrl?: unknown;
  };
  image2tools?: {
    updateManifestUrl?: unknown;
  };
}

let stateCache: AppStateFile | null = null;
let recoveredInterruptedJobs = false;
let latestUpdateCheck: UpdateCheckResult | null = null;
let galleryWatchRoot: string | null = null;
let galleryWatchers: GalleryWatchHandle[] = [];
let galleryWatchDebounce: NodeJS.Timeout | null = null;
let galleryOperationQueue: Promise<void> = Promise.resolve();
let galleryWatchNeedsFullSync = false;
let galleryWatchChangedRelPaths = new Set<string>();
let stateWriteCount = 0;
const runningJobControllers = new Map<string, AbortController>();

interface AssetProtocolPerfMetrics {
  galleryOriginalRequests: number;
  galleryOriginalBytes: number;
  galleryThumbnailRequests: number;
  galleryThumbnailBytes: number;
  galleryThumbnailCacheHits: number;
  galleryThumbnailCacheMisses: number;
  galleryThumbnailFallbacks: number;
  historyRequests: number;
  historyBytes: number;
  totalBytes: number;
}

function createAssetProtocolPerfMetrics(): AssetProtocolPerfMetrics {
  return {
    galleryOriginalRequests: 0,
    galleryOriginalBytes: 0,
    galleryThumbnailRequests: 0,
    galleryThumbnailBytes: 0,
    galleryThumbnailCacheHits: 0,
    galleryThumbnailCacheMisses: 0,
    galleryThumbnailFallbacks: 0,
    historyRequests: 0,
    historyBytes: 0,
    totalBytes: 0
  };
}

let assetProtocolPerfMetrics = createAssetProtocolPerfMetrics();

interface WriteStateOptions {
  updateBackup?: boolean;
}

interface GalleryAssetSourceMetadata {
  tags?: string[];
  contentHash?: string;
  sourcePathHash?: string;
  sourceJobId?: string;
  sourceAssetId?: string;
}

async function runGalleryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const current = galleryOperationQueue.then(operation, operation);
  galleryOperationQueue = current.then(
    () => undefined,
    () => undefined
  );
  return current;
}

function galleryIpc<TArgs extends unknown[], TResult>(
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult>
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> {
  return (event, ...args) => runGalleryOperation(() => handler(event, ...args));
}

function createWindow(): BrowserWindow {
  const windowBackground = nativeTheme.shouldUseDarkColors ? "#101720" : "#f6f4ef";
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: BRAND_NAME,
    backgroundColor: windowBackground,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  if (devServerURL) {
    const url = process.env[RENDERER_PERF_RESULT_PATH_ENV] ? new URL(devServerURL) : null;
    if (url) url.searchParams.set("crossgenPerf", "1");
    void window.loadURL(url ? url.toString() : devServerURL);
    if (!process.env[RENDERER_PERF_RESULT_PATH_ENV]) {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void window.loadFile(path.join(__dirname, "../../dist-renderer/index.html"), process.env[RENDERER_PERF_RESULT_PATH_ENV] ? { query: { crossgenPerf: "1" } } : undefined);
  }
  return window;
}

function preserveLegacyUserDataPath(): void {
  const userDataOverride = process.env[USER_DATA_DIR_ENV] || process.env[LEGACY_USER_DATA_DIR_ENV];
  app.setPath("userData", userDataOverride ? path.resolve(userDataOverride) : path.join(app.getPath("appData"), LEGACY_USER_DATA_NAME));
}

function registerAssetProtocol(): void {
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const assetPath = url.searchParams.get("path") ?? "";
    const galleryFileName = url.searchParams.get("gallery");
    const galleryThumbnail = galleryFileName ? url.searchParams.get("thumb") === "1" : false;
    let normalized: string | null = null;
    let galleryRelPath = "";

    try {
      const state = await readState();
      const galleryDir = getGalleryDir(state);
      if (galleryFileName) {
        galleryRelPath = normalizeGalleryRelativePath(galleryFileName);
        normalized = resolveManagedFileName(galleryDir, galleryRelPath);
      } else {
        normalized = assertKnownHistoryAssetPath(state, assetPath);
      }
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    if (!normalized) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const state = await readState();
      const galleryDir = getGalleryDir(state);
      const safePath = galleryFileName
        ? await assertManagedRegularFile(galleryDir, normalized)
        : await assertKnownHistoryRegularAsset(state, normalized);
      const served = galleryThumbnail && galleryRelPath
        ? await getOrCreateGalleryThumbnail(galleryRelPath, safePath)
        : { filePath: safePath, mimeType: mimeTypeForFile(safePath), cacheable: false, cacheHit: false, fallback: false };
      const content = await fs.readFile(served.filePath);
      recordAssetProtocolResponse(
        galleryFileName ? (galleryThumbnail ? "gallery-thumbnail" : "gallery-original") : "history",
        content.byteLength,
        served
      );
      return new Response(new Blob([content], { type: served.mimeType }), {
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": served.cacheable ? "private, max-age=31536000, immutable" : "no-store",
          "content-type": served.mimeType
        }
      });
    } catch (error) {
      console.warn("[CrossGen] Failed to serve image asset.", sanitizeError(error));
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

function getDefaultImagesDir(): string {
  return path.join(app.getPath("userData"), "images");
}

function getDefaultGalleryDir(): string {
  return path.join(app.getPath("userData"), "gallery");
}

function getStorageSettings(state?: AppStateFile | null): StorageSettings {
  return {
    historyDir: state?.storage?.historyDir || getDefaultImagesDir(),
    galleryDir: state?.storage?.galleryDir || getDefaultGalleryDir()
  };
}

function getImagesDir(state?: AppStateFile | null): string {
  return getStorageSettings(state ?? stateCache).historyDir;
}

function getGalleryDir(state?: AppStateFile | null): string {
  return getStorageSettings(state ?? stateCache).galleryDir;
}

function getGalleryThumbnailCacheDir(): string {
  return path.join(app.getPath("userData"), "gallery-thumbnails");
}

function getHistoryImageRoots(state?: AppStateFile | null): string[] {
  const roots = [
    getImagesDir(state),
    path.join(app.getPath("appData"), "image2tools", "images"),
    path.join(app.getPath("appData"), LEGACY_USER_DATA_NAME, "images")
  ];
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function assertKnownHistoryAssetPath(state: AppStateFile, assetPath: string): string {
  const resolved = path.resolve(assetPath);
  const knownPaths = new Set<string>();
  for (const job of state.history) {
    for (const asset of job.outputs) {
      knownPaths.add(path.resolve(asset.path));
    }
    if (job.maskAsset) {
      knownPaths.add(path.resolve(job.maskAsset.path));
    }
  }
  if (!knownPaths.has(resolved)) {
    throw new Error("无法操作：资源不属于当前历史。");
  }
  if (!isImagePath(resolved)) {
    throw new Error("无法操作：资源不是图片。");
  }
  return resolved;
}

async function assertKnownHistoryRegularAsset(state: AppStateFile, assetPath: string): Promise<string> {
  const knownPath = assertKnownHistoryAssetPath(state, assetPath);
  return assertManagedRegularFileInRoots(getHistoryImageRoots(state), knownPath);
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
    streamingPartialsEnabled: config.streamingPartialsEnabled,
    discoveredModels: config.discoveredModels,
    lastModelDiscoveryAt: config.lastModelDiscoveryAt,
    lastModelDiscoveryError: config.lastModelDiscoveryError,
    activeLaunchId: config.activeLaunchId,
    activeModelId: config.activeModelId,
    openAIImageRouting: config.openAIImageRouting,
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
      console.warn("[CrossGen] Failed to read state file; trying backup.", sanitizeError(error));
    }

    try {
      stateCache = applyStartupRecovery(normalizeState(await readStateFile(getBackupStatePath())));
      await writeState(stateCache, { updateBackup: false });
      return stateCache;
    } catch (backupError) {
      if (!isNodeError(backupError) || backupError.code !== "ENOENT") {
        console.warn("[CrossGen] Failed to read backup state file; using defaults.", sanitizeError(backupError));
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
    galleryFolders: state.galleryFolders,
    galleryAssets: state.galleryAssets,
    storage: state.storage,
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
        console.warn("[CrossGen] Failed to update state backup.", sanitizeError(error));
      }
    }
  }
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, statePath);
  stateWriteCount += 1;
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
  if (trimmed.length === 0) return "";
  if (trimmed.length === 1) return `${trimmed}**`;
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 1)}${"*".repeat(Math.max(2, trimmed.length - 2))}${trimmed.slice(-1)}`;
  }
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
  if (error instanceof Error) {
    const message = redactLikelySecrets(error.message);
    if (error.cause instanceof Error) {
      return `${message}: ${redactLikelySecrets(error.cause.message)}`;
    }
    return message;
  }
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
    const packageUrl = packageJson.crossgen?.updateManifestUrl ?? packageJson.image2tools?.updateManifestUrl;
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function getOrCreateGalleryThumbnail(relPath: string, sourcePath: string): Promise<{ filePath: string; mimeType: string; cacheable: boolean; cacheHit: boolean; fallback: boolean }> {
  const stat = await fs.stat(sourcePath);
  const cacheDir = getGalleryThumbnailCacheDir();
  const cachePath = galleryThumbnailCachePath(cacheDir, {
    relPath,
    sizeBytes: stat.size,
    modifiedMs: stat.mtimeMs,
    width: DEFAULT_GALLERY_THUMBNAIL_SIZE
  });

  if (await pathExists(cachePath)) {
    return { filePath: cachePath, mimeType: "image/png", cacheable: true, cacheHit: true, fallback: false };
  }

  const source = await fs.readFile(sourcePath);
  const image = nativeImage.createFromBuffer(source);
  if (image.isEmpty()) {
    return { filePath: sourcePath, mimeType: mimeTypeForFile(sourcePath), cacheable: false, cacheHit: false, fallback: true };
  }

  const resized = image.resize({ width: DEFAULT_GALLERY_THUMBNAIL_SIZE, quality: "best" });
  const png = resized.toPNG();
  if (png.length === 0) {
    return { filePath: sourcePath, mimeType: mimeTypeForFile(sourcePath), cacheable: false, cacheHit: false, fallback: true };
  }

  await ensureDir(cacheDir);
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, png);
  await fs.rename(tmpPath, cachePath).catch(async (error) => {
    await fs.unlink(tmpPath).catch(() => undefined);
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  });
  return { filePath: cachePath, mimeType: "image/png", cacheable: true, cacheHit: false, fallback: false };
}

function sameResolvedPath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function recordAssetProtocolResponse(kind: "gallery-original" | "gallery-thumbnail" | "history", bytes: number, served?: { cacheHit?: boolean; fallback?: boolean }): void {
  assetProtocolPerfMetrics.totalBytes += bytes;
  if (kind === "gallery-thumbnail") {
    assetProtocolPerfMetrics.galleryThumbnailRequests += 1;
    assetProtocolPerfMetrics.galleryThumbnailBytes += bytes;
    if (served?.cacheHit) assetProtocolPerfMetrics.galleryThumbnailCacheHits += 1;
    else assetProtocolPerfMetrics.galleryThumbnailCacheMisses += 1;
    if (served?.fallback) assetProtocolPerfMetrics.galleryThumbnailFallbacks += 1;
    return;
  }
  if (kind === "gallery-original") {
    assetProtocolPerfMetrics.galleryOriginalRequests += 1;
    assetProtocolPerfMetrics.galleryOriginalBytes += bytes;
    return;
  }
  assetProtocolPerfMetrics.historyRequests += 1;
  assetProtocolPerfMetrics.historyBytes += bytes;
}

async function fileContentHash(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function filePathHash(filePath: string): string {
  return createHash("sha256").update(path.resolve(filePath)).digest("hex");
}

async function copyOrMoveFile(sourcePath: string, targetPath: string, removeSource = false): Promise<void> {
  if (sameResolvedPath(sourcePath, targetPath)) return;
  await ensureDir(path.dirname(targetPath));
  if (removeSource) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isNodeError(error) || (error.code !== "EXDEV" && error.code !== "EEXIST")) {
        throw error;
      }
    }
  }
  await fs.copyFile(sourcePath, targetPath);
  if (removeSource) {
    await fs.unlink(sourcePath).catch(() => undefined);
  }
}

function normalizeGalleryRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Gallery 资源路径无效。");
  }
  return segments.join("/");
}

function galleryFolderForId(state: AppStateFile, folderId: string | null | undefined): GalleryFolder | undefined {
  if (!folderId) return undefined;
  return state.galleryFolders.find((folder) => folder.id === folderId);
}

function galleryFolderDiskName(folder: GalleryFolder): string {
  return normalizeGalleryFolderName(folder.name);
}

function galleryFolderSegments(state: AppStateFile, folder: GalleryFolder): string[] {
  const byId = new Map(state.galleryFolders.map((item) => [item.id, item]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: GalleryFolder | undefined = folder;
  while (current) {
    if (visited.has(current.id)) throw new Error("Gallery 文件夹层级存在循环。");
    visited.add(current.id);
    segments.unshift(galleryFolderDiskName(current));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments;
}

function galleryFolderRelativePath(state: AppStateFile, folder: GalleryFolder): string {
  return galleryFolderSegments(state, folder).join("/");
}

function galleryFolderRelativePathForId(state: AppStateFile, folderId: string | null | undefined): string {
  const folder = galleryFolderForId(state, folderId);
  return folder ? galleryFolderRelativePath(state, folder) : "";
}

function galleryFolderAbsolutePath(state: AppStateFile, folder: GalleryFolder): string {
  return resolveManagedFileName(getGalleryDir(state), galleryFolderRelativePath(state, folder));
}

function galleryRelativePathFor(state: AppStateFile, sourcePath: string, folder?: GalleryFolder): string {
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  const folderName = folder ? galleryFolderRelativePath(state, folder) : "";
  return folderName ? `${folderName}/${fileName}` : fileName;
}

function galleryAssetBaseName(asset: GalleryAsset): string {
  return path.posix.basename(normalizeGalleryRelativePath(asset.fileName));
}

function sameGalleryFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function mergeStoredTags(current: string[], incoming: unknown): string[] {
  const seen = new Set<string>();
  return [...current, ...normalizeTemplateTags(incoming)].flatMap((tag) => {
    if (seen.has(tag)) return [];
    seen.add(tag);
    return [tag];
  });
}

async function findDuplicateGalleryAsset(state: AppStateFile, folderId: string | null, contentHash: string, sourcePathHash?: string): Promise<GalleryAsset | undefined> {
  const galleryDir = getGalleryDir(state);
  for (const asset of state.galleryAssets) {
    if (!sameGalleryFolder(asset.folderId, folderId)) continue;
    if (sourcePathHash && asset.sourcePathHash === sourcePathHash) return asset;
    if (asset.contentHash === contentHash) return asset;
    if (asset.contentHash) continue;
    const assetPath = resolveManagedFileName(galleryDir, normalizeGalleryRelativePath(asset.fileName));
    if (!(await pathExists(assetPath))) continue;
    try {
      if ((await fileContentHash(assetPath)) === contentHash) return asset;
    } catch {
      // Ignore unreadable stale files while checking for duplicates.
    }
  }
  return undefined;
}

async function chooseGalleryDuplicateAction(originalName: string, folderName: string): Promise<GalleryDuplicateChoice> {
  const result = await dialog.showMessageBox({
    type: "question",
    title: "图库中已存在相同文件",
    message: `"${originalName}" 已存在于「${folderName}」。`,
    detail: "请选择取消添加、替换已有文件，或保留已有文件并创建一份副本。",
    buttons: ["取消", "替换", "复制"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (result.response === 1) return "replace";
  if (result.response === 2) return "copy";
  return "cancel";
}

function galleryFolderDuplicateDisplayName(state: AppStateFile, folderId: string | null): string {
  const folder = galleryFolderForId(state, folderId);
  return folder ? folder.name : "未分类";
}

function findHistorySourceForPath(state: AppStateFile, sourcePath: string): { job: GenerationJob; asset: ImageAsset } | undefined {
  const normalizedSourcePath = path.resolve(sourcePath);
  for (const job of state.history) {
    for (const asset of job.outputs) {
      if (path.resolve(asset.path) === normalizedSourcePath) return { job, asset };
    }
  }
  return undefined;
}

function historySourceMetadata(state: AppStateFile, sourcePath: string, extraTags: unknown = []): GalleryAssetSourceMetadata {
  const source = findHistorySourceForPath(state, sourcePath);
  if (!source) return { tags: normalizeTemplateTags(extraTags) };
  return {
    tags: mergeStoredTags(source.job.tags, extraTags),
    sourceJobId: source.job.id,
    sourceAssetId: source.asset.id
  };
}

function normalizeGalleryAssetNameInput(value: unknown, currentName: string): string {
  const rawName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!rawName) throw new Error("Gallery 图片名称不能为空。");
  if (rawName.includes("/") || rawName.includes("\\")) throw new Error("Gallery 图片名称不能包含路径分隔符。");
  if (/[<>:"|?*\x00-\x1F]/.test(rawName)) throw new Error("Gallery 图片名称包含非法字符。");
  if (rawName.endsWith(".") || rawName.endsWith(" ")) throw new Error("Gallery 图片名称不能以空格或句点结尾。");

  const currentExt = path.posix.extname(currentName).toLowerCase();
  const inputExt = path.posix.extname(rawName).toLowerCase();
  const nextName = inputExt ? rawName : `${rawName}${currentExt || ".png"}`;
  const nextExt = path.posix.extname(nextName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(nextExt)) throw new Error("Gallery 图片名称必须使用 png、jpg、jpeg 或 webp 扩展名。");
  if (isIgnoredGalleryEntryName(nextName) || isReservedWindowsFileName(nextName)) throw new Error("Gallery 图片名称不可用于托管目录。");
  if (Buffer.byteLength(nextName, "utf8") > MAX_GALLERY_FILE_NAME_BYTES) throw new Error("Gallery 图片名称过长。");
  normalizeGalleryRelativePath(nextName);
  return nextName;
}

async function renameGalleryAssetFile(state: AppStateFile, asset: GalleryAsset, originalName: unknown): Promise<GalleryAsset> {
  const galleryDir = getGalleryDir(state);
  const currentRelPath = normalizeGalleryRelativePath(asset.fileName);
  const currentBaseName = galleryAssetBaseName(asset);
  const nextBaseName = normalizeGalleryAssetNameInput(originalName, currentBaseName);
  if (nextBaseName.toLowerCase() === currentBaseName.toLowerCase() && nextBaseName === asset.originalName) {
    return asset;
  }

  const folderRelPath = path.posix.dirname(currentRelPath) === "." ? "" : path.posix.dirname(currentRelPath);
  const desiredRelPath = folderRelPath ? `${folderRelPath}/${nextBaseName}` : nextBaseName;
  const currentPath = resolveManagedFileName(galleryDir, currentRelPath);
  const nextRelPath = await uniqueGalleryRelativePath(galleryDir, desiredRelPath, currentPath);
  const nextPath = resolveManagedFileName(galleryDir, nextRelPath);
  if (await pathExists(currentPath)) {
    await copyOrMoveFile(currentPath, nextPath, true);
  }
  const stat = await fs.stat(nextPath).catch(() => null);
  return {
    ...asset,
    fileName: nextRelPath,
    originalName: path.posix.basename(nextRelPath),
    mimeType: mimeTypeForFile(nextPath),
    sizeBytes: stat?.size ?? asset.sizeBytes,
    modifiedAt: stat?.mtime.toISOString() ?? asset.modifiedAt
  };
}

async function ensureGalleryFolderDirs(state: AppStateFile): Promise<void> {
  const galleryDir = getGalleryDir(state);
  await ensureDir(galleryDir);
  for (const folder of state.galleryFolders) {
    await ensureDir(galleryFolderAbsolutePath(state, folder));
  }
}

async function moveGalleryAssetFileToFolder(state: AppStateFile, asset: GalleryAsset, folderId: string | null): Promise<GalleryAsset> {
  const galleryDir = getGalleryDir(state);
  const currentRelPath = normalizeGalleryRelativePath(asset.fileName);
  const folder = galleryFolderForId(state, folderId);
  const folderRelPath = folder ? galleryFolderRelativePath(state, folder) : "";
  const desiredNextRelPath = folderRelPath ? `${folderRelPath}/${galleryAssetBaseName(asset)}` : galleryAssetBaseName(asset);
  if (currentRelPath === desiredNextRelPath) {
    return { ...asset, folderId, updatedAt: new Date().toISOString() };
  }

  const currentPath = resolveManagedFileName(galleryDir, currentRelPath);
  const nextRelPath = await uniqueGalleryRelativePath(galleryDir, desiredNextRelPath, currentPath);
  const nextPath = resolveManagedFileName(galleryDir, nextRelPath);
  if (await pathExists(currentPath)) {
    await copyOrMoveFile(currentPath, nextPath, true);
  }
  return {
    ...asset,
    fileName: nextRelPath,
    folderId,
    updatedAt: new Date().toISOString()
  };
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

async function resolveRequestInputs(request: RunJobRequest, imagesDir: string): Promise<{ inputs: InputAsset[]; mask?: InputAsset }> {
  const inputs = await Promise.all(request.inputPaths.filter(isImagePath).map((filePath) => toInputAsset(filePath, false)));

  let mask: InputAsset | undefined;
  if (request.maskPath) {
    mask = await toInputAsset(request.maskPath, false);
  } else if (request.maskDataUrl) {
    mask = await persistMaskDataUrl(request.maskDataUrl, imagesDir);
  }

  return { inputs, mask };
}

async function persistMaskDataUrl(dataUrl: string, imagesDir: string): Promise<InputAsset> {
  const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  await ensureDir(imagesDir);
  const fileName = `mask-${Date.now()}-${randomUUID()}.${ext}`;
  const filePath = path.join(imagesDir, fileName);
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
    name: "",
    tags: [],
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

function defaultHistoryJobName(job: GenerationJob): string {
  const result = job.outputs.find((asset) => asset.sourceType === "result") ?? job.outputs[job.outputs.length - 1];
  return result?.fileName ? path.basename(result.fileName) : job.name.trim() || `${job.modelDisplayName || job.modelId || "image"}-${job.id.slice(-8)}.png`;
}

async function upsertJob(job: GenerationJob): Promise<void> {
  const persistentJob = stripTransientPreviewsFromJob(job);
  const state = await readState();
  const existingIndex = state.history.findIndex((item) => item.id === persistentJob.id);
  const nextHistory =
    existingIndex === -1
      ? [persistentJob, ...state.history]
      : state.history.map((item) => (item.id === persistentJob.id ? persistentJob : item));
  await writeState({ ...state, history: nextHistory.slice(0, MAX_HISTORY) });
}

function sendJobEvent(event: JobProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("job:event", event);
  }
}

function sendGalleryEvent(state: AppStateFile, reason: "disk" | "mutation"): void {
  const payload = {
    folders: state.galleryFolders,
    assets: state.galleryAssets,
    reason
  };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("gallery:event", payload);
  }
}

async function readGalleryMutationState(): Promise<AppStateFile> {
  return syncGalleryWithDisk(await readState());
}

async function commitGalleryMutationState<TResult>(state: AppStateFile, result: TResult): Promise<TResult> {
  await writeState(state);
  sendGalleryEvent(state, "mutation");
  return result;
}

async function handleGetSnapshot(): Promise<AppSnapshot> {
  const state = await syncGalleryForRead(await readState());
  return snapshotFromState(state);
}

function snapshotFromState(state: AppStateFile): AppSnapshot {
  const activeProvider = state.providers.find(p => p.id === state.activeProviderId) ?? state.providers[0];
  return {
    appVersion: getAppVersion(),
    providers: state.providers.map(toPublicConfig),
    activeProviderId: activeProvider.id,
    history: state.history,
    promptTemplates: state.promptTemplates,
    galleryFolders: state.galleryFolders,
    galleryAssets: state.galleryAssets,
    storage: getStorageSettings(state),
    draft: state.draft
  };
}

async function handleSaveConfig(_event: IpcMainInvokeEvent, input: ProviderConfigInput): Promise<ProviderConfig> {
  const state = await readState();
  const targetProviderId = typeof input.providerId === "string" && input.providerId.trim() ? input.providerId.trim() : state.activeProviderId;
  const activeProvider = state.providers.find(p => p.id === targetProviderId) ?? state.providers[0];
  if (!activeProvider) {
    throw new Error("API 配置不存在。");
  }
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

  const nextProviders = state.providers.map(p => p.id === activeProvider.id ? nextConfig : p);
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
    streamingPartialsEnabled: input.streamingPartialsEnabled ?? defaultStreamingPartialsEnabled(kind, input.baseURL),
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

  return snapshotFromState(nextState);
}

async function handleSwitchProvider(_event: IpcMainInvokeEvent, providerId: string): Promise<AppSnapshot> {
  const state = await readState();
  const provider = state.providers.find(p => p.id === providerId);

  if (!provider) {
    throw new Error(`Provider ${providerId} not found.`);
  }

  const nextState = { ...state, activeProviderId: providerId };
  await writeState(nextState);

  return snapshotFromState(nextState);
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

  return snapshotFromState(nextState);
}

async function handleClearApiKey(_event: IpcMainInvokeEvent, providerId?: string): Promise<ProviderConfig> {
  const state = await readState();
  const targetProviderId = typeof providerId === "string" && providerId.trim() ? providerId.trim() : state.activeProviderId;
  const activeProvider = state.providers.find(p => p.id === targetProviderId) ?? state.providers[0];
  if (!activeProvider) {
    throw new Error("API 配置不存在。");
  }
  const nextConfig: StoredProviderConfig = {
    ...activeProvider,
    encryptedApiKey: undefined,
    encryption: "none",
    discoveredModels: [],
    lastModelDiscoveryAt: undefined,
    lastModelDiscoveryError: undefined,
    updatedAt: new Date().toISOString()
  };
  const nextProviders = state.providers.map(p => p.id === activeProvider.id ? nextConfig : p);
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
    defaultPath: `CrossGen-prompt-templates-${new Date().toISOString().slice(0, 10)}.json`,
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

async function uniqueGalleryRelativePath(galleryDir: string, desiredRelPath: string, sourcePath?: string): Promise<string> {
  const normalized = normalizeGalleryRelativePath(desiredRelPath);
  const folderName = path.posix.dirname(normalized) === "." ? "" : path.posix.dirname(normalized);
  const baseName = path.posix.basename(normalized, path.posix.extname(normalized));
  const ext = path.posix.extname(normalized);

  for (let index = 0; index < 1000; index += 1) {
    const fileName = index === 0 ? `${baseName}${ext}` : `${baseName}-${index}${ext}`;
    const candidate = folderName ? `${folderName}/${fileName}` : fileName;
    const targetPath = resolveManagedFileName(galleryDir, candidate);
    if (sourcePath && sameResolvedPath(sourcePath, targetPath)) return candidate;
    if (!(await pathExists(targetPath))) return candidate;
  }

  throw new Error("无法创建唯一的 Gallery 文件名。");
}

async function createGalleryAssetFromFile(
  state: AppStateFile,
  sourcePath: string,
  source: GalleryAsset["source"],
  now: string,
  folderId: string | null,
  metadata: GalleryAssetSourceMetadata = {}
): Promise<GalleryAssetCreateResult> {
  const galleryDir = getGalleryDir(state);
  await ensureGalleryFolderDirs(state);
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("Gallery 只能导入图片文件。");
  const originalName = path.basename(sourcePath);
  const contentHash = metadata.contentHash ?? await fileContentHash(sourcePath);
  const sourcePathHash = metadata.sourcePathHash ?? filePathHash(sourcePath);
  const duplicate = await findDuplicateGalleryAsset(state, folderId, contentHash, sourcePathHash);
  if (duplicate) {
    const action = await chooseGalleryDuplicateAction(originalName, galleryFolderDuplicateDisplayName(state, folderId));
    if (action === "cancel") return { asset: null };
    if (action === "replace") {
      const targetPath = resolveManagedFileName(galleryDir, normalizeGalleryRelativePath(duplicate.fileName));
      await ensureDir(path.dirname(targetPath));
      if (!sameResolvedPath(sourcePath, targetPath)) await fs.copyFile(sourcePath, targetPath);
      const nextStat = await fs.stat(targetPath);
      return {
        replacedAssetId: duplicate.id,
        asset: {
          ...duplicate,
          originalName,
          mimeType: mimeTypeForFile(sourcePath),
          sizeBytes: nextStat.size,
          tags: mergeStoredTags(duplicate.tags, metadata.tags ?? []),
          source,
          updatedAt: now,
          contentHash,
          sourcePathHash,
          sourceJobId: metadata.sourceJobId,
          sourceAssetId: metadata.sourceAssetId,
          modifiedAt: nextStat.mtime.toISOString()
        }
      };
    }
  }
  const folder = galleryFolderForId(state, folderId);
  const fileName = await uniqueGalleryRelativePath(galleryDir, galleryRelativePathFor(state, sourcePath, folder));
  const targetPath = resolveManagedFileName(galleryDir, fileName);
  await fs.copyFile(sourcePath, targetPath);
  return {
    asset: {
      id: `gallery_${randomUUID()}`,
      fileName,
      originalName,
      mimeType: mimeTypeForFile(sourcePath),
      sizeBytes: stat.size,
      folderId,
      tags: normalizeTemplateTags(metadata.tags ?? []),
      source,
      createdAt: now,
      updatedAt: now,
      contentHash,
      sourcePathHash,
      sourceJobId: metadata.sourceJobId,
      sourceAssetId: metadata.sourceAssetId,
      modifiedAt: stat.mtime.toISOString()
    }
  };
}

async function createGalleryAssetFromDataUrl(state: AppStateFile, input: EditedGalleryImageInput, source: GalleryAsset["source"], now: string, folderId: string | null): Promise<GalleryAssetCreateResult> {
  if (!input || typeof input !== "object" || typeof input.dataUrl !== "string") {
    throw new Error("Gallery 图片内容无效。");
  }
  const mimeMatch = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(input.dataUrl);
  if (!mimeMatch) throw new Error("Gallery 只能导入 png、jpg、jpeg 或 webp 图片。");
  const mimeType = mimeMatch[1];
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const requestedName = input.originalName || `edited-${Date.now()}.${ext}`;
  const originalName = normalizeGalleryAssetNameInput(requestedName, `edited.${ext}`);
  const buffer = Buffer.from(dataUrlToBase64(input.dataUrl), "base64");
  if (buffer.length === 0) throw new Error("Gallery 图片内容为空。");
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const galleryDir = getGalleryDir(state);
  await ensureGalleryFolderDirs(state);
  const duplicate = await findDuplicateGalleryAsset(state, folderId, contentHash);
  if (duplicate) {
    const action = await chooseGalleryDuplicateAction(originalName, galleryFolderDuplicateDisplayName(state, folderId));
    if (action === "cancel") return { asset: null };
    if (action === "replace") {
      const targetPath = resolveManagedFileName(galleryDir, normalizeGalleryRelativePath(duplicate.fileName));
      await ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, buffer);
      const stat = await fs.stat(targetPath);
      return {
        replacedAssetId: duplicate.id,
        asset: {
          ...duplicate,
          originalName,
          mimeType,
          sizeBytes: stat.size,
          tags: mergeStoredTags(duplicate.tags, input.tags),
          source,
          updatedAt: now,
          contentHash,
          sourcePathHash: undefined,
          sourceJobId: undefined,
          sourceAssetId: undefined,
          modifiedAt: stat.mtime.toISOString()
        }
      };
    }
  }
  const folder = galleryFolderForId(state, folderId);
  const folderName = folder ? galleryFolderRelativePath(state, folder) : "";
  const desiredRelPath = folderName ? `${folderName}/${originalName}` : originalName;
  const fileName = await uniqueGalleryRelativePath(galleryDir, desiredRelPath);
  const targetPath = resolveManagedFileName(galleryDir, fileName);
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, buffer);
  const stat = await fs.stat(targetPath);

  return {
    asset: {
      id: `gallery_${randomUUID()}`,
      fileName,
      originalName: path.posix.basename(fileName),
      mimeType,
      sizeBytes: stat.size,
      folderId,
      tags: normalizeTemplateTags(input.tags),
      source,
      createdAt: now,
      updatedAt: now,
      contentHash,
      modifiedAt: stat.mtime.toISOString()
    }
  };
}

function applyGalleryAssetCreateResult(state: AppStateFile, result: GalleryAssetCreateResult): AppStateFile {
  if (!result.asset) return state;
  if (result.replacedAssetId) {
    return {
      ...state,
      galleryAssets: state.galleryAssets.map((asset) => asset.id === result.replacedAssetId ? result.asset! : asset)
    };
  }
  return {
    ...state,
    galleryAssets: [result.asset, ...state.galleryAssets]
  };
}

async function syncGalleryWithDisk(inputState: AppStateFile, changedRelPaths?: string[]): Promise<AppStateFile> {
  const galleryDir = getGalleryDir(inputState);
  await ensureDir(galleryDir);

  const now = new Date().toISOString();
  const baseState = stateCache ?? inputState;
  const hasIncrementalChanges = Boolean(changedRelPaths?.length);
  const disk = await scanGalleryDisk(galleryDir, hasIncrementalChanges ? { rootRelPaths: changedRelPaths } : undefined);
  const reconcileOptions = {
    now,
    createFolderId: () => `gallery_folder_${randomUUID()}`,
    createAssetId: () => `gallery_${randomUUID()}`
  };
  const result = hasIncrementalChanges
    ? reconcileGalleryDiskChangesWithResult(baseState, disk, changedRelPaths ?? [], reconcileOptions)
    : reconcileGalleryDiskStateWithResult(baseState, disk, reconcileOptions);
  if (result.changed) {
    await writeState(result.state, { updateBackup: false });
    return result.state;
  }

  return baseState;
}

function isGalleryWatchCurrentForState(state: AppStateFile): boolean {
  return Boolean(
    galleryWatchRoot &&
    galleryWatchers.length > 0 &&
    sameResolvedPath(galleryWatchRoot, getGalleryDir(state))
  );
}

function takePendingGalleryWatchSync(): { changedRelPaths?: string[] } | null {
  if (!galleryWatchNeedsFullSync && galleryWatchChangedRelPaths.size === 0) return null;
  if (galleryWatchDebounce) {
    clearTimeout(galleryWatchDebounce);
    galleryWatchDebounce = null;
  }
  const needsFullSync = galleryWatchNeedsFullSync;
  const changedRelPaths = needsFullSync ? undefined : [...galleryWatchChangedRelPaths];
  galleryWatchNeedsFullSync = false;
  galleryWatchChangedRelPaths = new Set();
  return { changedRelPaths };
}

async function syncGalleryForRead(inputState: AppStateFile): Promise<AppStateFile> {
  if (!isGalleryWatchCurrentForState(inputState)) {
    return syncGalleryWithDisk(inputState);
  }

  const pendingSync = takePendingGalleryWatchSync();
  if (!pendingSync) {
    return stateCache ?? inputState;
  }

  const synced = await syncGalleryWithDisk(inputState, pendingSync.changedRelPaths);
  await startGalleryWatcherForState(synced);
  sendGalleryEvent(synced, "disk");
  return synced;
}

async function handleListGallery(): Promise<GalleryAsset[]> {
  const state = await syncGalleryForRead(await readState());
  return state.galleryAssets;
}

async function handleListGalleryFolders(): Promise<GalleryFolder[]> {
  const state = await syncGalleryForRead(await readState());
  return state.galleryFolders;
}

function normalizeGalleryFolderName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isReservedWindowsFileName(name: string): boolean {
  const baseName = name.split(".")[0]?.toUpperCase();
  return Boolean(baseName && WINDOWS_RESERVED_FILE_NAMES.has(baseName));
}

function normalizeGalleryFolderColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

function normalizeGalleryFolderInput(input: GalleryFolderInput | undefined): { name: string; color?: string; hasColor: boolean } {
  const name = normalizeGalleryFolderName(input?.name);
  if (!name) throw new Error("Gallery 文件夹名称不能为空。");
  if (name.includes("/") || name.includes("\\")) throw new Error("Gallery 文件夹名称不能包含路径分隔符。");
  if (/[<>:"|?*\x00-\x1F]/.test(name)) throw new Error("Gallery 文件夹名称包含非法字符。");
  if (name.endsWith(".") || name.endsWith(" ")) throw new Error("Gallery 文件夹名称不能以空格或句点结尾。");
  if (isIgnoredGalleryEntryName(name) || isReservedWindowsFileName(name)) throw new Error("Gallery 文件夹名称不可用于托管目录。");
  if (Buffer.byteLength(name, "utf8") > MAX_GALLERY_FOLDER_NAME_BYTES) throw new Error("Gallery 文件夹名称过长。");
  return {
    name,
    color: normalizeGalleryFolderColor(input?.color),
    hasColor: Object.prototype.hasOwnProperty.call(input ?? {}, "color")
  };
}

function normalizeGalleryFolderId(state: AppStateFile, folderId?: unknown): string | null {
  if (folderId === undefined || folderId === null || folderId === "") return null;
  if (typeof folderId !== "string") throw new Error("Gallery 文件夹不存在。");
  const normalized = folderId.trim();
  if (!normalized) return null;
  if (!state.galleryFolders.some((folder) => folder.id === normalized)) {
    throw new Error("Gallery 文件夹不存在。");
  }
  return normalized;
}

function isGalleryFolderDescendant(state: AppStateFile, folderId: string, maybeAncestorId: string): boolean {
  const byId = new Map(state.galleryFolders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let current = byId.get(folderId)?.parentId ?? null;
  while (current) {
    if (current === maybeAncestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

function galleryFolderSubtreeIds(state: AppStateFile, folderId: string): Set<string> {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.galleryFolders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function normalizeGalleryFolderParentId(state: AppStateFile, parentId?: unknown, movingFolderId?: string): string | null {
  const normalized = normalizeGalleryFolderId(state, parentId);
  if (movingFolderId && normalized) {
    if (normalized === movingFolderId || isGalleryFolderDescendant(state, normalized, movingFolderId)) {
      throw new Error("不能将文件夹移动到自身或其子文件夹。");
    }
  }
  return normalized;
}

async function handleCreateGalleryFolder(_event: IpcMainInvokeEvent, input: GalleryFolderInput): Promise<GalleryFolder> {
  const state = await readGalleryMutationState();
  const { name, color } = normalizeGalleryFolderInput(input);
  const parentId = normalizeGalleryFolderParentId(state, input?.parentId);
  if (state.galleryFolders.some((folder) => (folder.parentId ?? null) === parentId && folder.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Gallery 文件夹名称已存在。");
  }
  const now = new Date().toISOString();
  const folder: GalleryFolder = {
    id: `gallery_folder_${randomUUID()}`,
    name,
    parentId,
    color,
    createdAt: now,
    updatedAt: now
  };
  const nextState = { ...state, galleryFolders: [folder, ...state.galleryFolders] };
  await ensureDir(galleryFolderAbsolutePath(nextState, folder));
  return commitGalleryMutationState(nextState, folder);
}

async function handleRenameGalleryFolder(_event: IpcMainInvokeEvent, id: string, input: GalleryFolderInput): Promise<GalleryFolder> {
  const state = await readGalleryMutationState();
  const folder = state.galleryFolders.find((item) => item.id === id);
  if (!folder) throw new Error("Gallery 文件夹不存在。");
  const { name, color, hasColor } = normalizeGalleryFolderInput(input);
  const parentId = Object.prototype.hasOwnProperty.call(input ?? {}, "parentId")
    ? normalizeGalleryFolderParentId(state, input?.parentId, id)
    : folder.parentId ?? null;
  if (state.galleryFolders.some((item) => item.id !== id && (item.parentId ?? null) === parentId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Gallery 文件夹名称已存在。");
  }
  const updated: GalleryFolder = {
    ...folder,
    name,
    parentId,
    color: hasColor ? color : folder.color,
    updatedAt: new Date().toISOString()
  };
  const galleryDir = getGalleryDir(state);
  const oldDir = galleryFolderAbsolutePath(state, folder);
  const nextState = { ...state, galleryFolders: state.galleryFolders.map((item) => item.id === id ? updated : item) };
  const newDir = galleryFolderAbsolutePath(nextState, updated);
  if (!sameResolvedPath(oldDir, newDir)) {
    await ensureDir(path.dirname(newDir));
    if (await pathExists(oldDir)) {
      await fs.rename(oldDir, newDir);
    } else {
      await ensureDir(newDir);
    }
  }
  const subtreeIds = galleryFolderSubtreeIds(state, id);
  const galleryAssets = state.galleryAssets.map((asset) => {
    if (!asset.folderId || !subtreeIds.has(asset.folderId)) return asset;
    return {
      ...asset,
      fileName: normalizeGalleryRelativePath(path.posix.join(galleryFolderRelativePathForId(nextState, asset.folderId), galleryAssetBaseName(asset))),
      updatedAt: updated.updatedAt
    };
  });
  const writtenState = {
    ...state,
    galleryFolders: nextState.galleryFolders,
    galleryAssets
  };
  return commitGalleryMutationState(writtenState, updated);
}

async function handleMoveGalleryFolder(_event: IpcMainInvokeEvent, id: string, parentId: string | null): Promise<GalleryFolder> {
  const state = await readGalleryMutationState();
  const folder = state.galleryFolders.find((item) => item.id === id);
  if (!folder) throw new Error("Gallery 文件夹不存在。");
  return handleRenameGalleryFolder(_event, id, { name: folder.name, color: folder.color, parentId });
}

async function handleDeleteGalleryFolder(_event: IpcMainInvokeEvent, id: string): Promise<GalleryFolderDeleteResult> {
  const state = await readGalleryMutationState();
  const folder = state.galleryFolders.find((item) => item.id === id);
  if (!folder) {
    throw new Error("Gallery 文件夹不存在。");
  }
  const now = new Date().toISOString();
  const subtreeIds = galleryFolderSubtreeIds(state, id);
  const movedAssets: GalleryAsset[] = [];
  for (const asset of state.galleryAssets) {
    movedAssets.push(asset.folderId && subtreeIds.has(asset.folderId) ? await moveGalleryAssetFileToFolder(state, asset, null) : asset);
  }
  const nextState: AppStateFile = {
    ...state,
    galleryFolders: state.galleryFolders.filter((folder) => !subtreeIds.has(folder.id)),
    galleryAssets: movedAssets.map((asset) => asset.folderId && subtreeIds.has(asset.folderId) ? { ...asset, folderId: null, updatedAt: now } : asset)
  };
  const result = await commitGalleryMutationState(nextState, {
    folders: nextState.galleryFolders,
    assets: nextState.galleryAssets
  });
  await fs.rm(galleryFolderAbsolutePath(state, folder), { recursive: true, force: true }).catch(() => undefined);
  return result;
}

async function handleImportToGallery(_event: IpcMainInvokeEvent, paths?: string[], folderId?: string | null): Promise<GalleryAsset[]> {
  let state = await readGalleryMutationState();
  const targetFolderId = normalizeGalleryFolderId(state, folderId);
  let sourcePaths = Array.isArray(paths) ? paths : [];
  if (sourcePaths.length === 0) {
    const result = await dialog.showOpenDialog({
      title: "导入参考图到 Gallery",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled) return [];
    sourcePaths = result.filePaths;
  }
  const now = new Date().toISOString();
  const imported: GalleryAsset[] = [];
  for (const sourcePath of sourcePaths) {
    if (typeof sourcePath !== "string") continue;
    if (!IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) continue;
    const result = await createGalleryAssetFromFile(state, sourcePath, "import", now, targetFolderId);
    if (!result.asset) continue;
    imported.push(result.asset);
    state = applyGalleryAssetCreateResult(state, result);
  }
  if (imported.length === 0) return [];
  const nextState = state;
  return commitGalleryMutationState(nextState, imported);
}

async function handleAddHistoryAssetToGallery(_event: IpcMainInvokeEvent, assetPath: string, folderId?: string | null, tags?: string[]): Promise<GalleryAsset | null> {
  const state = await readGalleryMutationState();
  const targetFolderId = normalizeGalleryFolderId(state, folderId);
  const sourcePath = await assertKnownHistoryRegularAsset(state, assetPath);
  const result = await createGalleryAssetFromFile(state, sourcePath, "result", new Date().toISOString(), targetFolderId, historySourceMetadata(state, sourcePath, tags));
  if (!result.asset) return null;
  const nextState = applyGalleryAssetCreateResult(state, result);
  return commitGalleryMutationState(nextState, result.asset);
}

async function handleAddEditedImageToGallery(_event: IpcMainInvokeEvent, input: EditedGalleryImageInput): Promise<GalleryAsset | null> {
  const state = await readGalleryMutationState();
  const targetFolderId = normalizeGalleryFolderId(state, input?.folderId);
  const result = await createGalleryAssetFromDataUrl(state, input, "result", new Date().toISOString(), targetFolderId);
  if (!result.asset) return null;
  const nextState = applyGalleryAssetCreateResult(state, result);
  return commitGalleryMutationState(nextState, result.asset);
}

async function handleReplaceGalleryAssetImage(_event: IpcMainInvokeEvent, id: string, input: EditedGalleryImageInput): Promise<GalleryAsset> {
  if (!input || typeof input !== "object" || typeof input.dataUrl !== "string") {
    throw new Error("Gallery 图片内容无效。");
  }
  const mimeMatch = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(input.dataUrl);
  if (!mimeMatch) throw new Error("Gallery 只能保存 png、jpg、jpeg 或 webp 图片。");
  const buffer = Buffer.from(dataUrlToBase64(input.dataUrl), "base64");
  if (buffer.length === 0) throw new Error("Gallery 图片内容为空。");

  const state = await readGalleryMutationState();
  const asset = state.galleryAssets.find((item) => item.id === id);
  if (!asset) throw new Error("Gallery 资源不存在。");
  const galleryDir = getGalleryDir(state);
  const targetPath = await assertManagedRegularFile(galleryDir, resolveManagedFileName(galleryDir, asset.fileName));
  await fs.writeFile(targetPath, buffer);
  const stat = await fs.stat(targetPath);
  const updated: GalleryAsset = {
    ...asset,
    mimeType: mimeMatch[1],
    sizeBytes: stat.size,
    tags: input.tags ? normalizeTemplateTags(input.tags) : asset.tags,
    source: "result",
    updatedAt: new Date().toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    sourcePathHash: undefined,
    sourceJobId: undefined,
    sourceAssetId: undefined
  };
  const nextState = { ...state, galleryAssets: state.galleryAssets.map((item) => item.id === id ? updated : item) };
  return commitGalleryMutationState(nextState, updated);
}

async function handleUpdateGalleryAsset(_event: IpcMainInvokeEvent, id: string, patch: GalleryAssetPatch = {}): Promise<GalleryAsset> {
  const normalizedPatch = patch && typeof patch === "object" ? patch : {};
  const state = await readGalleryMutationState();
  const asset = state.galleryAssets.find((item) => item.id === id);
  if (!asset) throw new Error("Gallery 资源不存在。");
  const hasTagsPatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "tags");
  const hasFolderPatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "folderId");
  const hasNamePatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "originalName");
  const movedAsset = hasFolderPatch
    ? await moveGalleryAssetFileToFolder(state, asset, normalizeGalleryFolderId(state, normalizedPatch.folderId))
    : asset;
  const renamedAsset = hasNamePatch
    ? await renameGalleryAssetFile(state, movedAsset, normalizedPatch.originalName)
    : movedAsset;
  const updated: GalleryAsset = {
    ...renamedAsset,
    tags: hasTagsPatch ? normalizeTemplateTags(normalizedPatch.tags) : renamedAsset.tags,
    updatedAt: new Date().toISOString()
  };
  const nextState = { ...state, galleryAssets: state.galleryAssets.map((item) => item.id === id ? updated : item) };
  return commitGalleryMutationState(nextState, updated);
}

async function handleMoveGalleryAsset(_event: IpcMainInvokeEvent, id: string, folderId: string | null): Promise<GalleryAsset> {
  return handleUpdateGalleryAsset(_event, id, { folderId });
}

async function handleRemoveGalleryAsset(_event: IpcMainInvokeEvent, id: string): Promise<GalleryAsset[]> {
  const state = await readGalleryMutationState();
  const asset = state.galleryAssets.find((item) => item.id === id);
  const galleryAssets = state.galleryAssets.filter((item) => item.id !== id);
  const nextState = { ...state, galleryAssets };
  const result = await commitGalleryMutationState(nextState, galleryAssets);
  if (asset) {
    const filePath = resolveManagedFileName(getGalleryDir(state), asset.fileName);
    await fs.unlink(filePath).catch(() => undefined);
  }
  return result;
}

async function handlePickGalleryAsset(_event: IpcMainInvokeEvent, id: string): Promise<InputAsset> {
  const state = await syncGalleryForRead(await readState());
  const asset = state.galleryAssets.find((item) => item.id === id);
  if (!asset) throw new Error("Gallery 资源不存在。");
  const galleryDir = getGalleryDir(state);
  const filePath = await assertManagedRegularFile(galleryDir, resolveManagedFileName(galleryDir, asset.fileName));
  return {
    id: asset.id,
    name: asset.originalName,
    path: filePath,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    previewUrl: `${ASSET_PROTOCOL}://image?gallery=${encodeURIComponent(asset.fileName)}`,
    width: asset.width,
    height: asset.height
  };
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
      openAIImageRouting: await probeOpenAIImageRouting({
        ...config,
        kind,
        defaultModel: activeSelection.defaultModel,
        activeLaunchId: activeSelection.activeLaunchId,
        activeModelId: activeSelection.activeModelId
      }, apiKey),
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...config,
      discoveredModels: [],
      lastModelDiscoveryAt: new Date().toISOString(),
      lastModelDiscoveryError: sanitizeModelDiscoveryError(error, apiKey),
      openAIImageRouting: await probeOpenAIImageRouting(config, apiKey),
      updatedAt: new Date().toISOString()
    };
  }
}

async function probeOpenAIImageRouting(config: StoredProviderConfig, apiKey: string): Promise<OpenAIImageRouting | undefined> {
  if (config.kind !== "openai" || config.activeLaunchId !== GPT_IMAGE_2_LAUNCH_ID) return config.openAIImageRouting;

  const model = config.activeModelId || config.defaultModel || GPT_IMAGE_2_MODEL_ID;
  const probeTimeoutMs = Math.min(Math.max(Math.floor(config.timeoutMs / 8), 2500), 8000);
  const probes = await Promise.all([
    probeOpenAIImageRoute(config.baseURL, apiKey, probeTimeoutMs, "image-api", "generate", {
      endpoint: "/images/generations",
      body: {
        model
      }
    }),
    probeOpenAIImageRoute(config.baseURL, apiKey, probeTimeoutMs, "image-api", "edit", {
      endpoint: "/images/edits",
      body: new FormData()
    }),
    probeOpenAIImageRoute(config.baseURL, apiKey, probeTimeoutMs, "responses", "edit", {
      endpoint: "/responses",
      body: {
        model
      }
    }),
    probeOpenAIImageRoute(config.baseURL, apiKey, probeTimeoutMs, "responses", "generate", {
      endpoint: "/responses",
      body: {
        model
      }
    }),
    probeOpenAIImageRoute(config.baseURL, apiKey, probeTimeoutMs, "chat-completions", "edit", {
      endpoint: "/chat/completions",
      body: {
        model
      }
    }),
    probeOpenAIImageRoute(config.baseURL, apiKey, probeTimeoutMs, "chat-completions", "generate", {
      endpoint: "/chat/completions",
      body: {
        model
      }
    })
  ]);

  return {
    preferredGenerateRoute: preferredOpenAIImageRoute(probes, "generate"),
    preferredEditRoute: preferredOpenAIImageRoute(probes, "edit"),
    probes,
    updatedAt: new Date().toISOString()
  };
}

async function probeOpenAIImageRoute(
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  route: OpenAIImageRoute,
  mode: "generate" | "edit",
  request: {
    endpoint: "/images/generations" | "/images/edits" | "/responses" | "/chat/completions";
    body: Record<string, unknown> | FormData;
  }
): Promise<OpenAIImageRouteProbe> {
  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: request.endpoint === "/chat/completions" ? "text/event-stream" : "application/json"
    };
    if (!(request.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetchWithTimeout(fetch, buildEndpoint(baseURL, request.endpoint), {
      method: "POST",
      headers,
      body: request.body instanceof FormData ? request.body : JSON.stringify(request.body)
    }, timeoutMs);
    const latencyMs = Date.now() - startedAt;
    return {
      route,
      mode,
      endpoint: request.endpoint,
      ok: isRouteProbeReachableStatus(response.status),
      latencyMs,
      status: response.status,
      error: isRouteProbeReachableStatus(response.status) ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      route,
      mode,
      endpoint: request.endpoint,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: normalizeError(error)
    };
  }
}

function isRouteProbeReachableStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function preferredOpenAIImageRoute(probes: OpenAIImageRouteProbe[], mode: "generate" | "edit"): OpenAIImageRoute | undefined {
  const successfulCandidates = probes
    .filter((probe) => probe.mode === mode && probe.ok && probe.status !== undefined && probe.status >= 200 && probe.status < 300)
    .sort((a, b) => routePreferenceScore(a) - routePreferenceScore(b));
  if (successfulCandidates[0]) return successfulCandidates[0].route;

  return "chat-completions";
}

function routePreferenceScore(probe: OpenAIImageRouteProbe): number {
  return probe.latencyMs;
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

async function handleDiscoverModels(_event: IpcMainInvokeEvent, providerId?: string): Promise<ProviderConfig> {
  const state = await readState();
  const targetProviderId = typeof providerId === "string" && providerId.trim() ? providerId.trim() : state.activeProviderId;
  const activeProvider = state.providers.find(p => p.id === targetProviderId) ?? state.providers[0];
  if (!activeProvider) {
    throw new Error("API 配置不存在。");
  }
  const nextConfig = await refreshModelDiscovery(activeProvider);
  const nextProviders = state.providers.map(p => p.id === activeProvider.id ? nextConfig : p);
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
  const imagesDir = getImagesDir(state);
  const { inputs, mask } = await resolveRequestInputs(normalizedRequest, imagesDir);
  const startedAt = Date.now();
  let job: GenerationJob = {
    ...createJob(normalizedRequest, activeProvider, inputs, mask),
    status: "running",
    updatedAt: new Date().toISOString()
  };
  await upsertJob(job);
  const abortController = new AbortController();
  runningJobControllers.set(job.id, abortController);
  sendJobEvent({ jobId: job.id, type: "started" });

  try {
    job = await adapter.runJob(job, apiKey, activeProvider, {
      fetch,
      imagesDir,
      ensureDir,
      sendJobEvent,
      abortSignal: abortController.signal
    });
    job = {
      ...job,
      name: job.name.trim() || defaultHistoryJobName(job),
      durationMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    };
    await upsertJob(job);
    sendJobEvent({ jobId: job.id, type: "completed" });
    return job;
  } catch (error) {
    const message = abortController.signal.aborted ? "任务已终止。" : normalizeError(error);
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
  } finally {
    runningJobControllers.delete(job.id);
  }
}

function handleCancelJob(jobId: string): boolean {
  if (typeof jobId !== "string" || !jobId.trim()) return false;
  const controller = runningJobControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
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
  let sourcePath: string;
  try {
    sourcePath = await assertKnownHistoryRegularAsset(state, request.assetPath);
  } catch {
    sourcePath = await assertManagedRegularFile(getGalleryDir(state), request.assetPath);
  }

  const result = await dialog.showSaveDialog({
    title: "Save image",
    defaultPath: request.suggestedName || path.basename(sourcePath)
  });

  if (result.canceled || !result.filePath) return null;
  await fs.copyFile(sourcePath, result.filePath);
  return result.filePath;
}

async function handleDownloadEditedImage(_event: IpcMainInvokeEvent, request: EditedImageDownloadRequest): Promise<string | null> {
  if (!request || typeof request !== "object" || typeof request.dataUrl !== "string") {
    throw new Error("图片内容无效。");
  }
  const mimeMatch = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(request.dataUrl);
  if (!mimeMatch) throw new Error("只能下载 png、jpg、jpeg 或 webp 图片。");
  const mimeType = mimeMatch[1];
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const suggestedName = normalizeGalleryAssetNameInput(request.suggestedName || `edited.${ext}`, `edited.${ext}`);
  const buffer = Buffer.from(dataUrlToBase64(request.dataUrl), "base64");
  if (buffer.length === 0) throw new Error("图片内容为空。");

  const result = await dialog.showSaveDialog({
    title: "Save image",
    defaultPath: suggestedName,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });

  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, buffer);
  return result.filePath;
}

async function handleOpenAssetFolder(_event: IpcMainInvokeEvent, assetPath: string): Promise<void> {
  const state = await readState();
  const imagesDir = getImagesDir(state);
  try {
    const sourcePath = await assertKnownHistoryRegularAsset(state, assetPath);
    shell.showItemInFolder(sourcePath);
  } catch {
    await shell.openPath(imagesDir);
  }
}

function normalizeStorageKind(kind: unknown): StorageKind {
  if (kind === "history" || kind === "gallery") return kind;
  throw new Error("存储目录类型无效。");
}

function normalizeStorageFolderOptions(value: unknown): StorageFolderOptions {
  if (!value || typeof value !== "object") return {};
  return {
    syncBoth: (value as StorageFolderOptions).syncBoth === true
  };
}

async function migrateHistoryStorage(state: AppStateFile, nextDir: string): Promise<AppStateFile> {
  const storage = getStorageSettings(state);
  const oldDir = storage.historyDir;
  const resolvedNextDir = path.resolve(nextDir);
  await ensureDir(resolvedNextDir);
  if (sameResolvedPath(oldDir, resolvedNextDir)) {
    return { ...state, storage: { ...storage, historyDir: resolvedNextDir } };
  }

  async function migrateManagedPath(assetPath: string): Promise<string> {
    const normalized = normalizeManagedAssetPath(oldDir, assetPath);
    if (!normalized || !(await pathExists(normalized))) return assetPath;
    const relativePath = path.relative(path.resolve(oldDir), normalized);
    const targetPath = path.resolve(resolvedNextDir, relativePath);
    await copyOrMoveFile(normalized, targetPath, true);
    return targetPath;
  }

  const history = await Promise.all(
    state.history.map(async (job) => ({
      ...job,
      outputs: await Promise.all(
        job.outputs.map(async (asset) => ({
          ...asset,
          path: await migrateManagedPath(asset.path)
        }))
      ),
      maskAsset: job.maskAsset
        ? {
            ...job.maskAsset,
            path: await migrateManagedPath(job.maskAsset.path)
          }
        : undefined
    }))
  );

  return {
    ...state,
    history,
    storage: { ...storage, historyDir: resolvedNextDir }
  };
}

async function migrateGalleryStorage(state: AppStateFile, nextDir: string): Promise<AppStateFile> {
  const syncedState = await syncGalleryWithDisk(state);
  const storage = getStorageSettings(syncedState);
  const oldDir = storage.galleryDir;
  const resolvedNextDir = path.resolve(nextDir);
  await ensureDir(resolvedNextDir);

  if (sameResolvedPath(oldDir, resolvedNextDir)) {
    return { ...syncedState, storage: { ...storage, galleryDir: resolvedNextDir } };
  }

  for (const folder of syncedState.galleryFolders) {
    await ensureDir(resolveManagedFileName(resolvedNextDir, galleryFolderRelativePath(syncedState, folder)));
  }

  for (const asset of syncedState.galleryAssets) {
    const relPath = normalizeGalleryRelativePath(asset.fileName);
    const sourcePath = resolveManagedFileName(oldDir, relPath);
    if (!(await pathExists(sourcePath))) continue;
    await copyOrMoveFile(sourcePath, resolveManagedFileName(resolvedNextDir, relPath), true);
  }

  return {
    ...syncedState,
    storage: { ...storage, galleryDir: resolvedNextDir }
  };
}

async function handleOpenStorageFolder(_event: IpcMainInvokeEvent, kindInput: unknown, folderId?: string | null): Promise<void> {
  const kind = normalizeStorageKind(kindInput);
  const state = kind === "gallery" ? await syncGalleryWithDisk(await readState()) : await readState();
  const storage = getStorageSettings(state);
  let targetPath = kind === "history" ? storage.historyDir : storage.galleryDir;

  if (kind === "gallery" && folderId) {
    const folder = state.galleryFolders.find((item) => item.id === folderId);
    if (!folder) throw new Error("Gallery 文件夹不存在。");
    targetPath = galleryFolderAbsolutePath(state, folder);
  }

  await ensureDir(targetPath);
  const openError = await shell.openPath(targetPath);
  if (openError) throw new Error(openError);
}

async function handleChooseStorageFolder(_event: IpcMainInvokeEvent, kindInput: unknown, optionsInput?: unknown): Promise<AppSnapshot> {
  const kind = normalizeStorageKind(kindInput);
  const options = normalizeStorageFolderOptions(optionsInput);
  const currentState = kind === "gallery" ? await syncGalleryWithDisk(await readState()) : await readState();
  const storage = getStorageSettings(currentState);
  const currentDir = kind === "history" ? storage.historyDir : storage.galleryDir;
  const result = await dialog.showOpenDialog({
    title: options.syncBoth ? "选择历史与图库默认存储目录" : kind === "history" ? "选择历史图片默认存储目录" : "选择图库默认存储目录",
    defaultPath: currentDir,
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) return snapshotFromState(currentState);

  const nextDir = result.filePaths[0];
  const migratedState = options.syncBoth
    ? await migrateGalleryStorage(await migrateHistoryStorage(currentState, nextDir), nextDir)
    : kind === "history"
      ? await migrateHistoryStorage(currentState, nextDir)
      : await migrateGalleryStorage(currentState, nextDir);
  await writeState(migratedState);
  const nextState = kind === "gallery" || options.syncBoth ? await syncGalleryWithDisk(migratedState) : migratedState;
  if (kind === "gallery" || options.syncBoth) {
    await startGalleryWatcherForState(nextState);
    sendGalleryEvent(nextState, "mutation");
  }
  return snapshotFromState(nextState);
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
    await launchWindowsInstaller(filePath);
    return {
      version: update.latestVersion,
      filePath,
      message: "更新包已下载并打开安装程序，请按安装器提示完成更新。"
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
    await Promise.all(pathsOwnedByJob(state, job).map((assetPath) => fs.unlink(assetPath).catch(() => undefined)));
  }
  return history;
}

async function handleUpdateHistoryJob(_event: IpcMainInvokeEvent, jobId: string, patch: HistoryJobPatch = {}): Promise<GenerationJob> {
  const normalizedPatch = patch && typeof patch === "object" ? patch : {};
  const state = await readState();
  const job = state.history.find((item) => item.id === jobId);
  if (!job) throw new Error("历史记录不存在。");
  const hasNamePatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "name");
  const hasTagsPatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "tags");
  const name = typeof normalizedPatch.name === "string" && normalizedPatch.name.trim()
    ? normalizedPatch.name.trim().replace(/\s+/g, " ")
    : job.name || defaultHistoryJobName(job);
  const updated: GenerationJob = {
    ...job,
    name: hasNamePatch ? name : job.name || defaultHistoryJobName(job),
    tags: hasTagsPatch ? normalizeTemplateTags(normalizedPatch.tags) : job.tags ?? [],
    updatedAt: new Date().toISOString()
  };
  await writeState({ ...state, history: state.history.map((item) => item.id === jobId ? updated : item) });
  return updated;
}

async function handleClearHistory(): Promise<GenerationJob[]> {
  const state = await readState();
  const paths = state.history.flatMap((job) => pathsOwnedByJob(state, job));
  await writeState({ ...state, history: [] });
  await Promise.all(paths.map((assetPath) => fs.unlink(assetPath).catch(() => undefined)));
  return [];
}

function pathsOwnedByJob(state: AppStateFile, job: GenerationJob): string[] {
  const paths = getHistoryImageRoots(state).flatMap((root) => collectOwnedJobFilePaths(root, job));
  return [...new Set(paths)];
}

function stopGalleryWatcher(): void {
  for (const watcher of galleryWatchers) {
    watcher.close();
  }
  galleryWatchers = [];
  galleryWatchRoot = null;
  if (galleryWatchDebounce) {
    clearTimeout(galleryWatchDebounce);
    galleryWatchDebounce = null;
  }
  galleryWatchNeedsFullSync = false;
  galleryWatchChangedRelPaths = new Set();
}

async function startGalleryWatcherForState(state: AppStateFile): Promise<void> {
  const galleryDir = getGalleryDir(state);
  await ensureDir(galleryDir);
  stopGalleryWatcher();
  galleryWatchRoot = galleryDir;
  galleryWatchers = startGalleryDiskWatchers(galleryDir, diskGalleryFoldersFromState(state), scheduleGalleryDiskSync, {
    onWatchError: (error) => console.warn("[CrossGen] Failed to watch Gallery directory.", sanitizeError(error))
  });
}

async function startGalleryWatcher(): Promise<void> {
  const state = await syncGalleryWithDisk(await readState());
  await startGalleryWatcherForState(state);
}

function scheduleGalleryDiskSync(changedRelPath: string | null = null): void {
  if (changedRelPath) {
    galleryWatchChangedRelPaths.add(changedRelPath);
  } else {
    galleryWatchNeedsFullSync = true;
  }
  if (galleryWatchDebounce) clearTimeout(galleryWatchDebounce);
  galleryWatchDebounce = setTimeout(() => {
    galleryWatchDebounce = null;
    const changedRelPaths = galleryWatchNeedsFullSync ? undefined : [...galleryWatchChangedRelPaths];
    galleryWatchNeedsFullSync = false;
    galleryWatchChangedRelPaths = new Set();
    void (async () => {
      try {
        await runGalleryOperation(async () => {
          const synced = await syncGalleryWithDisk(await readState(), changedRelPaths);
          await startGalleryWatcherForState(synced);
          sendGalleryEvent(synced, "disk");
        });
      } catch (error) {
        console.warn("[CrossGen] Failed to sync Gallery after disk change.", sanitizeError(error));
      }
    })();
  }, 250);
}

function summarizePerformanceResult(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { kind: "array", count: value.length };
  }
  if (value && typeof value === "object") {
    const maybeSnapshot = value as Partial<AppSnapshot>;
    if (Array.isArray(maybeSnapshot.galleryAssets) && Array.isArray(maybeSnapshot.galleryFolders)) {
      return {
        kind: "snapshot",
        galleryAssetCount: maybeSnapshot.galleryAssets.length,
        galleryFolderCount: maybeSnapshot.galleryFolders.length,
        historyCount: Array.isArray(maybeSnapshot.history) ? maybeSnapshot.history.length : undefined,
        providerCount: Array.isArray(maybeSnapshot.providers) ? maybeSnapshot.providers.length : undefined
      };
    }
    return { kind: "object", keys: Object.keys(value).length };
  }
  return { kind: typeof value };
}

async function runMainPerformanceCapture(resultPath: string): Promise<void> {
  const initialState = await syncGalleryWithDisk(await readState());
  await startGalleryWatcherForState(initialState);

  const measurements: Array<Record<string, unknown>> = [];
  const measure = async (channel: string, operation: () => Promise<unknown>) => {
    const writeCountBefore = stateWriteCount;
    const startedAt = performance.now();
    const value = await runGalleryOperation(operation);
    const durationMs = performance.now() - startedAt;
    measurements.push({
      channel,
      durationMs,
      stateWriteCountDelta: stateWriteCount - writeCountBefore,
      result: summarizePerformanceResult(value)
    });
  };

  await measure("app:getSnapshot", handleGetSnapshot);
  await measure("gallery:list", handleListGallery);
  await measure("galleryFolders:list", handleListGalleryFolders);
  const sampleGalleryAsset = initialState.galleryAssets[0];
  if (sampleGalleryAsset) {
    await measure("gallery:pick", () => handlePickGalleryAsset(null as unknown as IpcMainInvokeEvent, sampleGalleryAsset.id));
  }

  const state = await readState();
  await ensureDir(path.dirname(resultPath));
  await fs.writeFile(
    resultPath,
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      appVersion: getAppVersion(),
      userDataDir: app.getPath("userData"),
      statePath: getStatePath(),
      galleryDir: getGalleryDir(state),
      totalStateWriteCount: stateWriteCount,
      measurements
    }, null, 2)}\n`,
    "utf8"
  );
}

async function waitForWindowLoad(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) return;
  await new Promise<void>((resolve) => {
    window.webContents.once("did-finish-load", () => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRendererPerformanceCapture(window: BrowserWindow, resultPath: string): Promise<void> {
  await waitForWindowLoad(window);
  assetProtocolPerfMetrics = createAssetProtocolPerfMetrics();
  const state = await readState();
  const expectedGalleryAssetCount = state.galleryAssets.length;
  const sampleGalleryAsset = state.galleryAssets[0];
  const samplePartialPath = sampleGalleryAsset ? resolveManagedFileName(getGalleryDir(state), sampleGalleryAsset.fileName) : "";
  const rendererResult = await window.webContents.executeJavaScript(`
    (async () => {
      const expectedGalleryAssetCount = ${JSON.stringify(expectedGalleryAssetCount)};
      const waitForSelector = (selector, timeoutMs = 10000) => new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          const node = document.querySelector(selector);
          if (node) {
            resolve(node);
            return;
          }
          if (performance.now() - startedAt > timeoutMs) {
            reject(new Error("Timed out waiting for " + selector));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
      const waitForGalleryGridReady = (timeoutMs = 10000) => new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          const grid = document.querySelector(".gallery-content-grid");
          if (grid) {
            const renderedCount = Number(grid.dataset.renderedCount || "0");
            const totalCount = Number(grid.dataset.totalCount || "0");
            const itemCount = grid.querySelectorAll(".gallery-item").length;
            const hasEmptyState = Boolean(grid.querySelector(".gallery-empty-state"));
            if (
              renderedCount > 0 ||
              itemCount > 0 ||
              (expectedGalleryAssetCount === 0 && hasEmptyState) ||
              totalCount >= expectedGalleryAssetCount
            ) {
              resolve(grid);
              return;
            }
          }
          if (performance.now() - startedAt > timeoutMs) {
            reject(new Error("Timed out waiting for Gallery grid render"));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
      const accessibleName = (node) => (
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.textContent ||
        ""
      ).trim();
      const dialogFocusableSelector = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
        "[contenteditable='true']"
      ].join(",");
      const dialogFocusableElements = (root) => [...root.querySelectorAll(dialogFocusableSelector)].filter((element) => element.tabIndex >= 0);
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const runDialogKeyboardSmoke = async () => {
        const storageButton = [...document.querySelectorAll("button")].find((button) => {
          const name = accessibleName(button);
          return name === "Library path settings" || name === "库路径配置";
        });
        if (!storageButton) {
          return {
            status: "violations",
            reason: "Library path settings button was not found."
          };
        }

        storageButton.focus();
        const openerFocusedBeforeOpen = document.activeElement === storageButton;
        storageButton.click();
        const dialog = await waitForSelector(".storage-dialog");
        await nextFrame();

        const focusable = dialogFocusableElements(dialog);
        const firstFocusable = focusable[0] ?? null;
        const lastFocusable = focusable[focusable.length - 1] ?? null;
        const initialFocusInside = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement);

        if (firstFocusable) firstFocusable.focus();
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
        await nextFrame();
        const shiftTabWrappedToLast = Boolean(lastFocusable && document.activeElement === lastFocusable);

        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await nextFrame();
        const closedOnEscape = !document.querySelector(".storage-dialog");
        const focusReturnedToOpener = document.activeElement === storageButton;
        const ok = openerFocusedBeforeOpen && initialFocusInside && shiftTabWrappedToLast && closedOnEscape && focusReturnedToOpener;

        return {
          status: ok ? "ok" : "violations",
          openerFocusedBeforeOpen,
          opened: Boolean(dialog),
          initialFocusInside,
          focusableCount: focusable.length,
          shiftTabWrappedToLast,
          closedOnEscape,
          focusReturnedToOpener
        };
      };
      const pageStartedAt = performance.now();
      const galleryTab = await waitForSelector(".right-rail-tabs button:nth-child(2)");
      const tabReadyAt = performance.now();
      galleryTab.click();
      const galleryClickAt = performance.now();
      const grid = await waitForGalleryGridReady();
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const gridReadyAt = performance.now();
      const galleryImages = [...grid.querySelectorAll(".gallery-thumb img")];
      await new Promise((resolve) => setTimeout(resolve, 750));
      const thumbnailWaitDoneAt = performance.now();
      const dialogKeyboardSmoke = await runDialogKeyboardSmoke();
      const buttonsWithoutNames = [...document.querySelectorAll("button")].filter((button) => !accessibleName(button)).map((button) => button.className || button.outerHTML.slice(0, 120));
      const imagesMissingAlt = [...document.querySelectorAll("img:not([alt])")].map((image) => image.className || image.getAttribute("src") || image.outerHTML.slice(0, 120));
      const dialogsWithoutModal = [...document.querySelectorAll('[role="dialog"]')].filter((dialog) => dialog.getAttribute("aria-modal") !== "true").length;
      const notice = document.querySelector(".notice-area");
      const noticeMissingLiveRegion = Boolean(notice && (notice.getAttribute("aria-live") === null || notice.getAttribute("aria-atomic") !== "true"));
      return {
        url: location.href,
        title: document.title,
        timings: {
          pageToGalleryTabReadyMs: tabReadyAt - pageStartedAt,
          timeToFirstGalleryGridRenderMs: gridReadyAt - galleryClickAt,
          thumbnailWaitAfterGridReadyMs: thumbnailWaitDoneAt - gridReadyAt
        },
        galleryGrid: {
          totalCount: Number(grid.dataset.totalCount || "0"),
          renderedCount: Number(grid.dataset.renderedCount || "0"),
          itemCount: grid.querySelectorAll(".gallery-item").length,
          imageCount: galleryImages.length,
          thumbnailSrcCount: galleryImages.filter((image) => image.getAttribute("src")?.includes("thumb=1")).length
        },
        accessibilitySmoke: {
          status: buttonsWithoutNames.length === 0 && imagesMissingAlt.length === 0 && dialogsWithoutModal === 0 && !noticeMissingLiveRegion && dialogKeyboardSmoke.status === "ok" ? "ok" : "violations",
          buttonsWithoutNames,
          imagesMissingAlt,
          dialogsWithoutModal,
          noticeMissingLiveRegion,
          noticeAriaLive: notice?.getAttribute("aria-live") ?? null,
          noticeAriaAtomic: notice?.getAttribute("aria-atomic") ?? null,
          dialogKeyboardSmoke
        }
      };
    })();
  `);
  const screenshotDir = process.env[RENDERER_SCREENSHOT_DIR_ENV];
  if (screenshotDir) {
    await ensureDir(screenshotDir);
    const themeName = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    const screenshotPath = path.join(screenshotDir, `renderer-${themeName}.png`);
    const image = await window.webContents.capturePage();
    await fs.writeFile(screenshotPath, image.toPNG());
    (rendererResult as Record<string, unknown>).screenshot = {
      theme: themeName,
      path: screenshotPath
    };
  }

  const profilerStartIndex = await window.webContents.executeJavaScript("window.__crossgenProfilerEvents?.length ?? 0");
  if (sampleGalleryAsset && samplePartialPath) {
    for (let index = 0; index < 3; index += 1) {
      window.webContents.send("job:event", {
        jobId: "perf_partial_job",
        type: "partial",
        partialIndex: index + 1,
        image: {
          id: `perf_partial_${index + 1}`,
          jobId: "perf_partial_job",
          path: samplePartialPath,
          fileName: `perf-partial-${index + 1}.${path.extname(sampleGalleryAsset.fileName).replace(".", "") || "png"}`,
          mimeType: sampleGalleryAsset.mimeType,
          width: sampleGalleryAsset.width,
          height: sampleGalleryAsset.height,
          sourceType: "partial",
          createdAt: new Date().toISOString()
        }
      } satisfies JobProgressEvent);
      await sleep(30);
    }
    await sleep(120);
  }
  const profilerEvents = await window.webContents.executeJavaScript(`(window.__crossgenProfilerEvents ?? []).slice(${Number(profilerStartIndex) || 0})`);
  const profilerEventsById = Array.isArray(profilerEvents)
    ? profilerEvents.reduce<Record<string, {
      eventCount: number;
      totalActualDuration: number;
      maxActualDuration: number;
      totalBaseDuration: number;
      phases: Record<string, number>;
    }>>((summary, event) => {
      const id = typeof event.id === "string" ? event.id : "unknown";
      const actualDuration = typeof event.actualDuration === "number" ? event.actualDuration : 0;
      const baseDuration = typeof event.baseDuration === "number" ? event.baseDuration : 0;
      const phase = typeof event.phase === "string" ? event.phase : "unknown";
      const current = summary[id] ?? {
        eventCount: 0,
        totalActualDuration: 0,
        maxActualDuration: 0,
        totalBaseDuration: 0,
        phases: {}
      };
      current.eventCount += 1;
      current.totalActualDuration += actualDuration;
      current.maxActualDuration = Math.max(current.maxActualDuration, actualDuration);
      current.totalBaseDuration += baseDuration;
      current.phases[phase] = (current.phases[phase] ?? 0) + 1;
      summary[id] = current;
      return summary;
    }, {})
    : {};
  (rendererResult as Record<string, unknown>).reactProfilerPartialImageTrace = {
    status: Array.isArray(profilerEvents) ? "ok" : "unavailable",
    simulatedPartialEventCount: sampleGalleryAsset ? 3 : 0,
    profilerEventCount: Array.isArray(profilerEvents) ? profilerEvents.length : 0,
    eventsById: profilerEventsById,
    events: Array.isArray(profilerEvents) ? profilerEvents : []
  };
  (rendererResult as Record<string, unknown>).assetProtocol = assetProtocolPerfMetrics;
  try {
    const axeSource = readFileSync(path.join(app.getAppPath(), "node_modules", "axe-core", "axe.min.js"), "utf8");
    await window.webContents.executeJavaScript(axeSource);
    const axeResult = await window.webContents.executeJavaScript(`
      window.axe.run(document, {
        resultTypes: ["violations", "incomplete"],
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "best-practice"]
        }
      }).then((result) => ({
        status: result.violations.length === 0 ? "ok" : "violations",
        violationCount: result.violations.length,
        incompleteCount: result.incomplete.length,
        violations: result.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          description: violation.description,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodes: violation.nodes.slice(0, 3).map((node) => ({
            target: node.target,
            failureSummary: node.failureSummary
          }))
        }))
      }))
    `);
    (rendererResult as Record<string, unknown>).axeAccessibilitySmoke = axeResult;
  } catch (error) {
    (rendererResult as Record<string, unknown>).axeAccessibilitySmoke = {
      status: "unavailable",
      error: sanitizeError(error)
    };
  }

  await ensureDir(path.dirname(resultPath));
  await fs.writeFile(
    resultPath,
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      appVersion: getAppVersion(),
      userDataDir: app.getPath("userData"),
      statePath: getStatePath(),
      result: rendererResult
    }, null, 2)}\n`,
    "utf8"
  );
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:getSnapshot", () => runGalleryOperation(handleGetSnapshot));
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
  ipcMain.handle("gallery:list", () => runGalleryOperation(handleListGallery));
  ipcMain.handle("galleryFolders:list", () => runGalleryOperation(handleListGalleryFolders));
  ipcMain.handle("galleryFolders:create", galleryIpc(handleCreateGalleryFolder));
  ipcMain.handle("galleryFolders:rename", galleryIpc(handleRenameGalleryFolder));
  ipcMain.handle("galleryFolders:move", galleryIpc(handleMoveGalleryFolder));
  ipcMain.handle("galleryFolders:delete", galleryIpc(handleDeleteGalleryFolder));
  ipcMain.handle("gallery:import", galleryIpc(handleImportToGallery));
  ipcMain.handle("gallery:addHistoryAsset", galleryIpc(handleAddHistoryAssetToGallery));
  ipcMain.handle("gallery:addEditedImage", galleryIpc(handleAddEditedImageToGallery));
  ipcMain.handle("gallery:replaceImage", galleryIpc(handleReplaceGalleryAssetImage));
  ipcMain.handle("gallery:update", galleryIpc(handleUpdateGalleryAsset));
  ipcMain.handle("gallery:move", galleryIpc(handleMoveGalleryAsset));
  ipcMain.handle("gallery:remove", galleryIpc(handleRemoveGalleryAsset));
  ipcMain.handle("gallery:pick", galleryIpc(handlePickGalleryAsset));
  ipcMain.handle("dialog:selectImages", handleSelectImages);
  ipcMain.handle("dialog:importImages", handleImportImages);
  ipcMain.handle("dialog:selectMask", handleSelectMask);
  ipcMain.handle("job:run", handleRunJob);
  ipcMain.handle("job:cancel", (_event, jobId: string) => handleCancelJob(jobId));
  ipcMain.handle("asset:download", handleDownloadAsset);
  ipcMain.handle("asset:downloadEdited", handleDownloadEditedImage);
  ipcMain.handle("asset:openFolder", handleOpenAssetFolder);
  ipcMain.handle("storage:openFolder", handleOpenStorageFolder);
  ipcMain.handle("storage:chooseFolder", handleChooseStorageFolder);
  ipcMain.handle("updates:check", handleCheckForUpdates);
  ipcMain.handle("updates:downloadAndInstall", handleDownloadAndInstallUpdate);
  ipcMain.handle("history:deleteJob", handleDeleteJob);
  ipcMain.handle("history:updateJob", handleUpdateHistoryJob);
  ipcMain.handle("history:clear", handleClearHistory);
}

app.whenReady().then(async () => {
  app.setName(BRAND_NAME);
  const themeSource = process.env[THEME_SOURCE_ENV];
  if (themeSource === "light" || themeSource === "dark" || themeSource === "system") {
    nativeTheme.themeSource = themeSource;
  }
  preserveLegacyUserDataPath();
  registerIpcHandlers();
  registerAssetProtocol();
  const performanceResultPath = process.env[PERF_RESULT_PATH_ENV];
  if (performanceResultPath) {
    await runMainPerformanceCapture(performanceResultPath);
    app.quit();
    return;
  }
  const window = createWindow();
  const rendererPerformanceResultPath = process.env[RENDERER_PERF_RESULT_PATH_ENV];
  if (rendererPerformanceResultPath) {
    void runRendererPerformanceCapture(window, rendererPerformanceResultPath).finally(() => app.quit());
    return;
  }
  void startGalleryWatcher();

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

app.on("before-quit", () => {
  stopGalleryWatcher();
});
