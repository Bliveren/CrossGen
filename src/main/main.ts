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
  CrossGenJsonErrorCode,
  CrossGenJsonFailure,
  CrossGenJsonResponse,
  DownloadRequest,
  EditedImageDownloadRequest,
  EditedGalleryImageInput,
  GalleryAsset,
  GalleryAssetPatch,
  GalleryFolder,
  GalleryFolderDeleteResult,
  GalleryFolderInput,
  GeminiAspectRatio,
  GeminiResolution,
  GenerationJob,
  GenerationQueueFile,
  GenerationQueueItem,
  GenerationQueueWorkerHost,
  HistoryJobPatch,
  ImageAsset,
  InputAsset,
  ImageParams,
  ImageQuality,
  JobStatus,
  JobProgressEvent,
  OpenAIImageRoute,
  OpenAIImageRouteProbe,
  OpenAIImageRouting,
  PromptTemplate,
  PromptTemplateInput,
  ProviderConfig,
  ProviderConfigInput,
  QueueSource,
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
  DEFAULT_GEMINI_IMAGE_PARAMS,
  DEFAULT_GENERAL_IMAGE_PARAMS,
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
import { resolveDataDirs, resolveUserDataDir } from "../core/dataDirs.js";
import { createGenerationQueueItem } from "../core/generation.js";
import {
  createGalleryFolder as createCoreGalleryFolder,
  deleteGalleryFolder as deleteCoreGalleryFolder,
  exportGalleryAsset as exportCoreGalleryAsset,
  getGalleryAssetPublicMetadata,
  importGalleryAssets as importCoreGalleryAssets,
  moveGalleryFolder as moveCoreGalleryFolder,
  removeGalleryAsset as removeCoreGalleryAsset,
  renameGalleryFolder as renameCoreGalleryFolder,
  resolveGalleryAssetPath as resolveCoreGalleryAssetPath,
  updateGalleryAsset as updateCoreGalleryAsset,
  type GalleryDuplicateAction,
  type GalleryMutationContext
} from "../core/gallery.js";
import {
  completeGenerationQueueItemInQueue,
  recordGenerationQueuePartialOutput,
  requestGenerationQueueItemCancelInQueue,
  retryGenerationQueueItemInQueue,
  runGenerationQueueItemToCompletion,
  runNextGenerationQueueItem,
  type GenerationQueueExecutionResult
} from "../core/generationQueue.js";
import { getProviderEnvKeyNames } from "../core/keyring.js";
import {
  MAX_QUEUE_CONCURRENCY,
  MIN_QUEUE_CONCURRENCY,
  applyQueueRuntimeConfigPatch,
  normalizeQueueRuntimeConfig,
  type QueueRuntimeConfigPatch
} from "../core/queueConfig.js";
import { createQueueStore, type QueueStore } from "../core/queueStore.js";
import { createJsonStateStore, type JsonStateStore } from "../core/stateStore.js";
import { withStateQueueTransaction } from "../core/stateQueueTransaction.js";
import { parseGenerationPromptFile, type GenerationPromptFileEntry } from "../cli/generationBatch.js";
import {
  buildCliAssetInspect,
  buildCliConfigStatus,
  buildCliFolderList,
  buildCliFolderTree,
  buildCliGalleryList,
  buildCliJobList,
  buildCliJobStatus,
  buildCliMcpConfig,
  buildCliModelsList,
  buildCliProviderList,
  buildCliQueueConfig,
  buildCliQueueStatus,
  type McpClientName,
  type McpMode
} from "../cli/readonly.js";
import { runReadonlyMcpStdioServer } from "../mcp/stdioServer.js";
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
const DATA_DIR_ENV = "CROSSGEN_DATA_DIR";
const USER_DATA_DIR_ENV = "CROSSGEN_USER_DATA_DIR";
const LEGACY_USER_DATA_DIR_ENV = "IMAGE2TOOLS_USER_DATA_DIR";
const PERF_RESULT_PATH_ENV = "CROSSGEN_PERF_RESULT_PATH";
const RENDERER_PERF_RESULT_PATH_ENV = "CROSSGEN_RENDERER_PERF_RESULT_PATH";
const THEME_SOURCE_ENV = "CROSSGEN_THEME_SOURCE";
const RENDERER_SCREENSHOT_DIR_ENV = "CROSSGEN_RENDERER_SCREENSHOT_DIR";
const CLI_SCHEMA_VERSION = 1;
const DESKTOP_QUEUE_WORKER_INTERVAL_MS = 5000;
const DESKTOP_QUEUE_WORKER_RECHECK_MS = 250;
const DESKTOP_QUEUE_WORKER_LEASE_MS = 30000;

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
let appStateStore: JsonStateStore<AppStateFile> | null = null;
let generationQueueStore: QueueStore | null = null;
const desktopWorkerHostId = `desktop_${process.pid}_${randomUUID()}`;
let desktopQueueWorkerTimer: NodeJS.Timeout | null = null;
let desktopQueueWorkerRunning = false;
let desktopQueueWorkerStopped = false;
const runningJobControllers = new Map<string, AbortController>();
const runningQueueControllers = new Map<string, AbortController>();
const backgroundQueueRuns = new Map<string, Promise<unknown>>();
const queuedJobIds = new Map<string, string>();

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
  const userDataOverride = process.env[USER_DATA_DIR_ENV] || process.env[DATA_DIR_ENV] || process.env[LEGACY_USER_DATA_DIR_ENV];
  app.setPath(
    "userData",
    resolveUserDataDir({
      appDataDir: app.getPath("appData"),
      userDataDir: userDataOverride,
      legacyUserDataName: LEGACY_USER_DATA_NAME
    })
  );
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
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).statePath;
}

function getBackupStatePath(): string {
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).backupStatePath;
}

function getStateLockPath(): string {
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).lockPath;
}

function getQueuePath(): string {
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).queuePath;
}

function getQueueLockPath(): string {
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).queueLockPath;
}

function getDefaultImagesDir(): string {
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).imagesDir;
}

function getDefaultGalleryDir(): string {
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).galleryDir;
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
  return resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") }).galleryThumbnailCacheDir;
}

function getHistoryImageRoots(state?: AppStateFile | null): string[] {
  const dirs = resolveDataDirs({ appDataDir: app.getPath("appData"), userDataDir: app.getPath("userData") });
  const roots = [
    getImagesDir(state),
    ...dirs.legacyImageRoots
  ];
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function getGenerationQueueStore(): QueueStore {
  generationQueueStore ??= createQueueStore({
    queuePath: getQueuePath(),
    lockPath: getQueueLockPath()
  });
  return generationQueueStore;
}

function getAppStateStore(): JsonStateStore<AppStateFile> {
  appStateStore ??= createJsonStateStore({
    statePath: getStatePath(),
    backupPath: getBackupStatePath(),
    lockPath: getStateLockPath(),
    defaultState: getDefaultState(),
    normalize: normalizeState
  });
  return appStateStore;
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
  const payload = persistentStatePayload(state);
  await getAppStateStore().write(payload, options);
  stateWriteCount += 1;
  stateCache = payload;
}

function persistentStatePayload(state: AppStateFile): AppStateFile {
  return {
    version: STATE_VERSION,
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    history: state.history.slice(0, MAX_HISTORY),
    promptTemplates: state.promptTemplates,
    galleryFolders: state.galleryFolders,
    galleryAssets: state.galleryAssets,
    queueConfig: normalizeQueueRuntimeConfig(state.queueConfig),
    storage: state.storage,
    draft: state.draft
  };
}

async function mutateStateAndQueue<TResult>(
  operation: (state: AppStateFile, queue: GenerationQueueFile) => Promise<{ state: AppStateFile; queue: GenerationQueueFile; result: TResult }> | { state: AppStateFile; queue: GenerationQueueFile; result: TResult },
  options: WriteStateOptions = {}
): Promise<{ state: AppStateFile; queue: GenerationQueueFile; result: TResult }> {
  await ensureDir(app.getPath("userData"));
  const transaction = await withStateQueueTransaction<AppStateFile, TResult>({
    lockPath: getStateLockPath(),
    queuePath: getQueuePath(),
    updateBackup: options.updateBackup,
    state: {
      statePath: getStatePath(),
      backupPath: getBackupStatePath(),
      defaultState: getDefaultState(),
      normalize: (value) => applyStartupRecovery(normalizeState(value))
    }
  }, async (context) => {
    const next = await operation(context.state, context.queue);
    context.setState(persistentStatePayload(next.state));
    context.setQueue(next.queue);
    return next.result;
  });
  stateWriteCount += 1;
  stateCache = transaction.state;
  return transaction;
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

function getEnvApiKeyForConfig(config: StoredProviderConfig): string | null {
  const names = getProviderEnvKeyNames(config.kind);
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function getApiKeyForConfigOrThrow(config: StoredProviderConfig): string {
  const apiKey = getEnvApiKeyForConfig(config) ?? decryptApiKey(config);
  if (!apiKey) {
    throw new Error(`缺少 API Key。请先保存 ${providerDisplayName(config.kind)} API Key，或设置 ${getProviderEnvKeyNames(config.kind).join(" / ")}。`);
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
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted")
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, "AIza...redacted")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ...redacted")
    .replace(/([?&]key=)[^&\s]+/gi, "$1...redacted");
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

function mergeImageAssets(...groups: ImageAsset[][]): ImageAsset[] {
  const byId = new Map<string, ImageAsset>();
  for (const asset of groups.flat()) {
    byId.set(asset.id, asset);
  }
  return [...byId.values()];
}

async function upsertJob(job: GenerationJob): Promise<void> {
  const state = await readState();
  await writeState(upsertJobInState(state, job));
}

function upsertJobInState(state: AppStateFile, job: GenerationJob): AppStateFile {
  const persistentJob = stripTransientPreviewsFromJob(job);
  const existingIndex = state.history.findIndex((item) => item.id === persistentJob.id);
  const nextHistory =
    existingIndex === -1
      ? [persistentJob, ...state.history]
      : state.history.map((item) => (item.id === persistentJob.id ? persistentJob : item));
  return { ...state, history: nextHistory.slice(0, MAX_HISTORY) };
}

function appendQueueItem(queue: GenerationQueueFile, item: GenerationQueueItem): GenerationQueueFile {
  return {
    ...queue,
    updatedAt: new Date().toISOString(),
    items: [...queue.items, item]
  };
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

async function mutateDesktopGalleryState<TResult>(
  operation: (state: AppStateFile) => Promise<{ state: AppStateFile; result: TResult; changed?: boolean }>
): Promise<TResult> {
  let result: TResult | undefined;
  let shouldNotify = false;
  const nextState = await getAppStateStore().mutate(async (state) => {
    const synced = await buildGalleryDiskSyncedState(state, undefined, { useStateCache: false });
    const outcome = await operation(synced.state);
    result = outcome.result;
    shouldNotify = outcome.changed !== false;
    return persistentStatePayload(outcome.state);
  });
  stateWriteCount += 1;
  stateCache = nextState;
  if (result === undefined) throw new Error("Gallery 操作没有返回结果。");
  if (shouldNotify) sendGalleryEvent(nextState, "mutation");
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

async function buildGalleryDiskSyncedState(
  inputState: AppStateFile,
  changedRelPaths?: string[],
  options: { useStateCache?: boolean } = {}
): Promise<{ state: AppStateFile; changed: boolean }> {
  const galleryDir = getGalleryDir(inputState);
  await ensureDir(galleryDir);

  const now = new Date().toISOString();
  const baseState = options.useStateCache === false ? inputState : stateCache ?? inputState;
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
  return result;
}

async function syncGalleryWithDisk(inputState: AppStateFile, changedRelPaths?: string[]): Promise<AppStateFile> {
  let syncedState = inputState;
  const nextState = await getAppStateStore().mutate(async (state) => {
    const result = await buildGalleryDiskSyncedState(state, changedRelPaths, { useStateCache: false });
    syncedState = result.state;
    return result.changed ? persistentStatePayload(result.state) : persistentStatePayload(state);
  });
  stateWriteCount += 1;
  stateCache = nextState;
  return syncedState;
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
  return mutateDesktopGalleryState(async (state) => {
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
    return { state: nextState, result: folder };
  });
}

async function handleRenameGalleryFolder(_event: IpcMainInvokeEvent, id: string, input: GalleryFolderInput): Promise<GalleryFolder> {
  return mutateDesktopGalleryState(async (state) => {
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
    return { state: writtenState, result: updated };
  });
}

async function handleMoveGalleryFolder(_event: IpcMainInvokeEvent, id: string, parentId: string | null): Promise<GalleryFolder> {
  return mutateDesktopGalleryState(async (state) => {
    const folder = state.galleryFolders.find((item) => item.id === id);
    if (!folder) throw new Error("Gallery 文件夹不存在。");
    const normalizedParentId = normalizeGalleryFolderParentId(state, parentId, id);
    if (state.galleryFolders.some((item) => item.id !== id && (item.parentId ?? null) === normalizedParentId && item.name.toLowerCase() === folder.name.toLowerCase())) {
      throw new Error("Gallery 文件夹名称已存在。");
    }
    const updated: GalleryFolder = {
      ...folder,
      parentId: normalizedParentId,
      updatedAt: new Date().toISOString()
    };
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
    return {
      state: {
        ...state,
        galleryFolders: nextState.galleryFolders,
        galleryAssets
      },
      result: updated
    };
  });
}

async function handleDeleteGalleryFolder(_event: IpcMainInvokeEvent, id: string): Promise<GalleryFolderDeleteResult> {
  return mutateDesktopGalleryState(async (state) => {
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
      galleryFolders: state.galleryFolders.filter((candidate) => !subtreeIds.has(candidate.id)),
      galleryAssets: movedAssets.map((asset) => asset.folderId && subtreeIds.has(asset.folderId) ? { ...asset, folderId: null, updatedAt: now } : asset)
    };
    await fs.rm(galleryFolderAbsolutePath(state, folder), { recursive: true, force: true }).catch(() => undefined);
    return {
      state: nextState,
      result: {
        folders: nextState.galleryFolders,
        assets: nextState.galleryAssets
      }
    };
  });
}

async function handleImportToGallery(_event: IpcMainInvokeEvent, paths?: string[], folderId?: string | null): Promise<GalleryAsset[]> {
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
  return mutateDesktopGalleryState(async (state) => {
    const targetFolderId = normalizeGalleryFolderId(state, folderId);
    const now = new Date().toISOString();
    const imported: GalleryAsset[] = [];
    let nextState = state;
    for (const sourcePath of sourcePaths) {
      if (typeof sourcePath !== "string") continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) continue;
      const result = await createGalleryAssetFromFile(nextState, sourcePath, "import", now, targetFolderId);
      if (!result.asset) continue;
      imported.push(result.asset);
      nextState = applyGalleryAssetCreateResult(nextState, result);
    }
    return { state: nextState, result: imported, changed: imported.length > 0 };
  });
}

async function handleAddHistoryAssetToGallery(_event: IpcMainInvokeEvent, assetPath: string, folderId?: string | null, tags?: string[]): Promise<GalleryAsset | null> {
  return mutateDesktopGalleryState(async (state) => {
    const targetFolderId = normalizeGalleryFolderId(state, folderId);
    const sourcePath = await assertKnownHistoryRegularAsset(state, assetPath);
    const result = await createGalleryAssetFromFile(state, sourcePath, "result", new Date().toISOString(), targetFolderId, historySourceMetadata(state, sourcePath, tags));
    if (!result.asset) return { state, result: null, changed: false };
    const nextState = applyGalleryAssetCreateResult(state, result);
    return { state: nextState, result: result.asset };
  });
}

async function handleAddEditedImageToGallery(_event: IpcMainInvokeEvent, input: EditedGalleryImageInput): Promise<GalleryAsset | null> {
  return mutateDesktopGalleryState(async (state) => {
    const targetFolderId = normalizeGalleryFolderId(state, input?.folderId);
    const result = await createGalleryAssetFromDataUrl(state, input, "result", new Date().toISOString(), targetFolderId);
    if (!result.asset) return { state, result: null, changed: false };
    const nextState = applyGalleryAssetCreateResult(state, result);
    return { state: nextState, result: result.asset };
  });
}

async function handleReplaceGalleryAssetImage(_event: IpcMainInvokeEvent, id: string, input: EditedGalleryImageInput): Promise<GalleryAsset> {
  if (!input || typeof input !== "object" || typeof input.dataUrl !== "string") {
    throw new Error("Gallery 图片内容无效。");
  }
  const mimeMatch = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(input.dataUrl);
  if (!mimeMatch) throw new Error("Gallery 只能保存 png、jpg、jpeg 或 webp 图片。");
  const buffer = Buffer.from(dataUrlToBase64(input.dataUrl), "base64");
  if (buffer.length === 0) throw new Error("Gallery 图片内容为空。");

  return mutateDesktopGalleryState(async (state) => {
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
    return { state: nextState, result: updated };
  });
}

async function handleUpdateGalleryAsset(_event: IpcMainInvokeEvent, id: string, patch: GalleryAssetPatch = {}): Promise<GalleryAsset> {
  const normalizedPatch = patch && typeof patch === "object" ? patch : {};
  return mutateDesktopGalleryState(async (state) => {
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
    return { state: nextState, result: updated };
  });
}

async function handleMoveGalleryAsset(_event: IpcMainInvokeEvent, id: string, folderId: string | null): Promise<GalleryAsset> {
  return handleUpdateGalleryAsset(_event, id, { folderId });
}

async function handleRemoveGalleryAsset(_event: IpcMainInvokeEvent, id: string): Promise<GalleryAsset[]> {
  return mutateDesktopGalleryState(async (state) => {
    const asset = state.galleryAssets.find((item) => item.id === id);
    const galleryAssets = state.galleryAssets.filter((item) => item.id !== id);
    const nextState = { ...state, galleryAssets };
    if (asset) {
      const filePath = resolveManagedFileName(getGalleryDir(state), asset.fileName);
      await fs.unlink(filePath).catch(() => undefined);
    }
    return { state: nextState, result: galleryAssets, changed: Boolean(asset) };
  });
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

function selectProviderForQueueItem(state: AppStateFile, item: GenerationQueueItem): StoredProviderConfig {
  const provider = state.providers.find((candidate) => candidate.id === item.providerId);
  if (!provider) {
    throw new Error("任务对应的 API 配置不存在。");
  }
  if (!provider.enabled) {
    throw new Error("任务对应的 API 配置已停用。");
  }
  return provider;
}

async function getOrCreateHistoryJobForQueueItem(
  state: AppStateFile,
  item: GenerationQueueItem,
  provider: StoredProviderConfig,
  request: RunJobRequest
): Promise<GenerationJob> {
  const existing = item.historyJobId ? state.history.find((job) => job.id === item.historyJobId) : undefined;
  if (existing) {
    return {
      ...existing,
      prompt: request.prompt,
      params: request.params
    };
  }

  const { inputs, mask } = await resolveRequestInputs(request, getImagesDir(state));
  const job = createJob(request, provider, inputs, mask);
  await upsertJob(job);
  return job;
}

function mergeStringIds(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of groups.flatMap((group) => group ?? [])) {
    if (!value.trim() || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function importGenerationResultOutputsToGalleryState(
  state: AppStateFile,
  job: GenerationJob,
  item: GenerationQueueItem
): Promise<{ state: AppStateFile; galleryAssets: GalleryAsset[] }> {
  if (item.targetGalleryFolderId === undefined) return { state, galleryAssets: [] };
  const outputs = job.outputs.filter((asset) => asset.sourceType === "result");
  if (outputs.length === 0) return { state, galleryAssets: [] };

  const importedAssets: GalleryAsset[] = [];
  let nextState = state;
  const context = galleryMutationContext(state, { duplicateAction: "copy" });
  for (const output of outputs) {
    const outcome = await importCoreGalleryAssets(nextState, context, [output.path], item.targetGalleryFolderId ?? null, {
      source: "result",
      sourceJobId: job.id,
      sourceAssetId: output.id,
      tags: job.tags
    });
    importedAssets.push(...outcome.result.assets);
    nextState = mergeGalleryState(nextState, outcome.state);
  }
  return { state: nextState, galleryAssets: importedAssets };
}

function terminalJobForQueueExecution(job: GenerationJob, execution: GenerationQueueExecutionResult<GenerationJob>, nowIso: string): GenerationJob {
  if (execution.status === "cancelled" && job.status !== "cancelled") {
    return {
      ...job,
      status: "cancelled",
      error: execution.error ?? job.error ?? "任务已终止。",
      updatedAt: nowIso
    };
  }
  if (execution.status === "failed" && job.status !== "failed") {
    return {
      ...job,
      status: "failed",
      error: execution.error ?? job.error ?? "任务失败。",
      updatedAt: nowIso
    };
  }
  return job;
}

async function completeGenerationQueueItemWithState(
  item: GenerationQueueItem,
  execution: GenerationQueueExecutionResult<GenerationJob>,
  nowMs: number
): Promise<GenerationQueueItem> {
  let eventJob: GenerationJob | undefined;
  let importedGalleryAssets: GalleryAsset[] = [];
  const transaction = await mutateStateAndQueue<GenerationQueueItem>(async (currentState, queue) => {
    const nowIso = new Date(nowMs).toISOString();
    let nextState = currentState;
    let nextExecution: GenerationQueueExecutionResult<GenerationJob> = execution;
    const executionJob = execution.value;

    if (executionJob) {
      let jobToPersist = terminalJobForQueueExecution(executionJob, execution, nowIso);
      let galleryAssetIds = execution.galleryAssetIds ?? item.galleryAssetIds;

      if (jobToPersist.status === "succeeded") {
        try {
          const imported = await importGenerationResultOutputsToGalleryState(nextState, jobToPersist, item);
          nextState = imported.state;
          importedGalleryAssets = imported.galleryAssets;
          galleryAssetIds = mergeStringIds(galleryAssetIds, imported.galleryAssets.map((asset) => asset.id));
        } catch (error) {
          const message = normalizeError(error);
          jobToPersist = {
            ...jobToPersist,
            status: "failed",
            error: message,
            updatedAt: nowIso
          };
          nextExecution = {
            ...nextExecution,
            status: "failed",
            error: message,
            errorCategory: "unknown",
            retryable: false
          };
          galleryAssetIds = item.galleryAssetIds;
          importedGalleryAssets = [];
        }
      }

      eventJob = jobToPersist;
      nextState = upsertJobInState(nextState, jobToPersist);
      nextExecution = {
        ...nextExecution,
        historyJobId: jobToPersist.id,
        outputAssetIds: mergeStringIds(nextExecution.outputAssetIds, jobToPersist.outputs.map((asset) => asset.id)),
        partialAssetIds: mergeStringIds(nextExecution.partialAssetIds, jobToPersist.outputs.filter((asset) => asset.sourceType === "partial").map((asset) => asset.id)),
        galleryAssetIds
      };
    }

    const completed = completeGenerationQueueItemInQueue(queue, item, nextExecution, nowMs);
    return {
      state: nextState,
      queue: completed.queue,
      result: completed.item
    };
  });

  if (importedGalleryAssets.length > 0) {
    sendGalleryEvent(transaction.state, "mutation");
  }
  if (eventJob) {
    if (eventJob.status === "succeeded") {
      sendJobEvent({ jobId: eventJob.id, queueId: item.queueId, type: "completed" });
    } else {
      sendJobEvent({ jobId: eventJob.id, queueId: item.queueId, type: "failed", error: eventJob.error });
    }
  }

  return transaction.result;
}

function updateHistoryJobForQueueItem(
  state: AppStateFile,
  item: GenerationQueueItem,
  updater: (job: GenerationJob) => GenerationJob
): AppStateFile {
  if (!item.historyJobId) return state;
  const existing = state.history.find((job) => job.id === item.historyJobId);
  if (!existing) return state;
  return upsertJobInState(state, updater(existing));
}

function cancelledHistoryJob(job: GenerationJob, item: GenerationQueueItem): GenerationJob {
  return {
    ...job,
    status: "cancelled",
    error: job.error ?? "任务已取消。",
    updatedAt: item.updatedAt
  };
}

function queuedHistoryJobForRetry(job: GenerationJob, item: GenerationQueueItem): GenerationJob {
  const { error: _error, durationMs: _durationMs, ...rest } = job;
  return {
    ...rest,
    status: "queued",
    updatedAt: item.updatedAt
  };
}

async function cancelGenerationQueueItemWithState(queueId: string) {
  const nowMs = Date.now();
  const transaction = await mutateStateAndQueue<GenerationQueueItem | undefined>((currentState, queue) => {
    const next = requestGenerationQueueItemCancelInQueue(queue, queueId, nowMs);
    const cancelledItem = next.item?.status === "cancelled" ? next.item : undefined;
    const nextState =
      cancelledItem
        ? updateHistoryJobForQueueItem(currentState, cancelledItem, (job) => cancelledHistoryJob(job, cancelledItem))
        : currentState;
    return {
      state: nextState,
      queue: next.queue,
      result: next.item
    };
  });
  return {
    item: transaction.result,
    state: transaction.state,
    queue: transaction.queue
  };
}

async function cancelGenerationQueueItemAndUpsertJob(queueId: string, job: GenerationJob): Promise<void> {
  const nowMs = Date.now();
  await mutateStateAndQueue((currentState, queue) => {
    const next = requestGenerationQueueItemCancelInQueue(queue, queueId, nowMs);
    return {
      state: upsertJobInState(currentState, job),
      queue: next.queue,
      result: null
    };
  });
}

async function retryGenerationQueueItemWithState(jobId: string) {
  const nowMs = Date.now();
  const transaction = await mutateStateAndQueue((currentState, queue) => {
    const next = retryGenerationQueueItemInQueue(queue, jobId, nowMs);
    const retriedItem = next.result.action === "retried" ? next.result.item : undefined;
    const nextState = retriedItem
      ? updateHistoryJobForQueueItem(currentState, retriedItem, (job) => queuedHistoryJobForRetry(job, retriedItem))
      : currentState;
    return {
      state: nextState,
      queue: next.queue,
      result: next.result
    };
  });
  return {
    ...transaction.result,
    state: transaction.state,
    queue: transaction.queue
  };
}

async function executeGenerationQueueItem(item: GenerationQueueItem, abortSignal: AbortSignal) {
  const state = await readState();
  const provider = selectProviderForQueueItem(state, item);
  const request = validateAgentRunJobRequest(item.request, provider);
  const adapter = getImageProviderAdapterForRequest(request);
  if (!adapter) {
    throw new Error(unsupportedImageProviderMessage());
  }
  const apiKey = getApiKeyForConfigOrThrow(provider);
  const imagesDir = getImagesDir(state);
  const startedAt = Date.now();
  const partialAssets: ImageAsset[] = [];
  let job = await getOrCreateHistoryJobForQueueItem(state, item, provider, request);

  const sendQueuedJobEvent = (event: JobProgressEvent) => {
    if (event.type === "partial" && event.image) {
      partialAssets.push(event.image);
      void recordGenerationQueuePartialOutput(getGenerationQueueStore(), item.queueId, [event.image.id]);
    }
    sendJobEvent({ ...event, queueId: item.queueId });
  };

  job = {
    ...job,
    status: "running",
    updatedAt: new Date().toISOString()
  };
  await upsertJob(job);
  sendQueuedJobEvent({ jobId: job.id, queueId: item.queueId, type: "started" });

  try {
    job = await adapter.runJob(job, apiKey, provider, {
      fetch,
      imagesDir,
      ensureDir,
      sendJobEvent: sendQueuedJobEvent,
      abortSignal
    });
    job = {
      ...job,
      name: job.name.trim() || defaultHistoryJobName(job),
      durationMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    };
    return {
      status: job.status === "succeeded" ? "succeeded" as const : "failed" as const,
      value: job,
      historyJobId: job.id,
      outputAssetIds: job.outputs.map((asset) => asset.id),
      galleryAssetIds: item.galleryAssetIds,
      partialAssetIds: job.outputs.filter((asset) => asset.sourceType === "partial").map((asset) => asset.id),
      error: job.status === "failed" ? job.error : undefined
    };
  } catch (error) {
    const message = abortSignal.aborted ? "任务已终止。" : normalizeError(error);
    const status = abortSignal.aborted ? "cancelled" as const : "failed" as const;
    job = {
      ...job,
      status,
      durationMs: Date.now() - startedAt,
      error: message,
      outputs: mergeImageAssets(job.outputs, partialAssets),
      updatedAt: new Date().toISOString()
    };
    return {
      status,
      value: job,
      historyJobId: job.id,
      outputAssetIds: job.outputs.map((asset) => asset.id),
      galleryAssetIds: item.galleryAssetIds,
      partialAssetIds: partialAssets.map((asset) => asset.id),
      error: message
    };
  }
}

async function buildQueuedGenerationJobStatus(queueId: string) {
  return buildCliJobStatus(await readExistingQueueForCli(), await readExistingStateForCli(), queueId);
}

function queueWorkerHostId(hostKind: GenerationQueueWorkerHost["kind"]): string {
  return hostKind === "desktop" ? desktopWorkerHostId : `${hostKind}_${process.pid}_${randomUUID()}`;
}

async function clearQueueWorkerHost(hostId: string): Promise<void> {
  await getGenerationQueueStore().mutate((queue) => ({
    ...queue,
    updatedAt: new Date().toISOString(),
    workerHosts: queue.workerHosts.filter((host) => host.hostId !== hostId)
  }));
}

function trackQueuedGenerationStart(item: GenerationQueueItem, controller: AbortController): void {
  runningQueueControllers.set(item.queueId, controller);
  if (item.historyJobId) {
    runningJobControllers.set(item.historyJobId, controller);
    queuedJobIds.set(item.historyJobId, item.queueId);
  }
}

function trackQueuedGenerationFinish(item: GenerationQueueItem): void {
  runningQueueControllers.delete(item.queueId);
  if (item.historyJobId) {
    runningJobControllers.delete(item.historyJobId);
    queuedJobIds.delete(item.historyJobId);
  }
}

async function runQueuedGenerationForAgent(
  queueId: string,
  hostKind: GenerationQueueWorkerHost["kind"],
  waitTimeoutMs?: number
) {
  const startedAt = Date.now();
  const host = { hostId: queueWorkerHostId(hostKind), kind: hostKind, processId: process.pid };
  const queueConfig = await readQueueRuntimeConfigForCli();
  const result = await runGenerationQueueItemToCompletion<GenerationJob>({
    queueStore: getGenerationQueueStore(),
    queueId,
    host,
    maxGlobalRunning: queueConfig.maxGlobalRunning,
    providerConcurrency: queueConfig.providerConcurrency,
    waitTimeoutMs,
    executeItem: executeGenerationQueueItem,
    completeItem: completeGenerationQueueItemWithState,
    onStarted: trackQueuedGenerationStart,
    onFinished: trackQueuedGenerationFinish
  }).finally(() => {
    if (hostKind !== "desktop" || desktopQueueWorkerStopped) {
      return clearQueueWorkerHost(host.hostId).catch(() => undefined);
    }
    return undefined;
  });
  const job = await buildQueuedGenerationJobStatus(queueId);
  const status = job?.queueItem?.status ?? result.item?.status ?? null;
  const terminal = Boolean(job?.terminal);
  return {
    mode: "wait",
    hostKind,
    queueId,
    claimed: result.claimed,
    status,
    terminal,
    timedOut: Boolean(waitTimeoutMs && !terminal),
    elapsedMs: Date.now() - startedAt,
    job
  };
}

function startBackgroundQueuedGeneration(queueId: string, hostKind: GenerationQueueWorkerHost["kind"]): boolean {
  if (backgroundQueueRuns.has(queueId)) return false;
  const run = runQueuedGenerationForAgent(queueId, hostKind).catch((error: unknown) => {
    process.stderr.write(`CrossGen background queue worker failed: ${sanitizeError(error)}\n`);
  }).finally(() => {
    backgroundQueueRuns.delete(queueId);
  });
  backgroundQueueRuns.set(queueId, run);
  return true;
}

async function registerDesktopQueueWorkerHeartbeat(): Promise<void> {
  const now = Date.now();
  await getGenerationQueueStore().registerWorkerHeartbeat({
    hostId: desktopWorkerHostId,
    kind: "desktop",
    processId: process.pid,
    mode: "generate",
    heartbeatAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + DESKTOP_QUEUE_WORKER_LEASE_MS).toISOString()
  });
}

async function runNextDesktopQueuedGeneration(): Promise<boolean> {
  const queueConfig = await readQueueRuntimeConfigForCli();
  const result = await runNextGenerationQueueItem<GenerationJob>({
    queueStore: getGenerationQueueStore(),
    host: { hostId: desktopWorkerHostId, kind: "desktop", processId: process.pid },
    maxGlobalRunning: queueConfig.maxGlobalRunning,
    providerConcurrency: queueConfig.providerConcurrency,
    leaseMs: DESKTOP_QUEUE_WORKER_LEASE_MS,
    executeItem: executeGenerationQueueItem,
    completeItem: completeGenerationQueueItemWithState,
    onStarted: trackQueuedGenerationStart,
    onFinished: trackQueuedGenerationFinish
  });
  return result.claimed;
}

function scheduleDesktopQueueWorker(delayMs: number): void {
  if (desktopQueueWorkerStopped) return;
  if (desktopQueueWorkerTimer) clearTimeout(desktopQueueWorkerTimer);
  desktopQueueWorkerTimer = setTimeout(() => {
    desktopQueueWorkerTimer = null;
    void desktopQueueWorkerTick();
  }, delayMs);
  desktopQueueWorkerTimer.unref?.();
}

async function desktopQueueWorkerTick(): Promise<void> {
  if (desktopQueueWorkerStopped) return;
  if (desktopQueueWorkerRunning) {
    scheduleDesktopQueueWorker(DESKTOP_QUEUE_WORKER_RECHECK_MS);
    return;
  }

  desktopQueueWorkerRunning = true;
  let claimed = false;
  try {
    await registerDesktopQueueWorkerHeartbeat();
    claimed = await runNextDesktopQueuedGeneration();
  } catch (error) {
    console.warn("[CrossGen] Desktop queue worker failed.", sanitizeError(error));
  } finally {
    desktopQueueWorkerRunning = false;
    scheduleDesktopQueueWorker(claimed ? DESKTOP_QUEUE_WORKER_RECHECK_MS : DESKTOP_QUEUE_WORKER_INTERVAL_MS);
  }
}

function startDesktopQueueWorker(): void {
  desktopQueueWorkerStopped = false;
  scheduleDesktopQueueWorker(0);
}

function stopDesktopQueueWorker(): void {
  desktopQueueWorkerStopped = true;
  if (desktopQueueWorkerTimer) {
    clearTimeout(desktopQueueWorkerTimer);
    desktopQueueWorkerTimer = null;
  }
  for (const controller of runningQueueControllers.values()) {
    controller.abort();
  }
  void clearQueueWorkerHost(desktopWorkerHostId).catch(() => undefined);
}

async function waitForQueuedGenerationStatus(queueId: string, waitMs: number) {
  const startedAt = Date.now();
  const cappedWaitMs = Math.max(0, waitMs);
  while (true) {
    const job = await buildQueuedGenerationJobStatus(queueId);
    const status = job?.queueItem?.status ?? job?.historyJob?.status ?? null;
    const terminal = Boolean(job?.terminal);
    const elapsedMs = Date.now() - startedAt;
    if (terminal || elapsedMs >= cappedWaitMs) {
      return {
        mode: "waitMs",
        queueId,
        status,
        terminal,
        timedOut: !terminal,
        elapsedMs,
        job
      };
    }
    await sleep(Math.min(100, cappedWaitMs - elapsedMs));
  }
}

async function hasLiveGenerationWorkerHost(now = Date.now()): Promise<boolean> {
  if (backgroundQueueRuns.size > 0) return true;
  const queue = await readExistingQueueForCli();
  return queue.workerHosts.some((host) => Date.parse(host.leaseExpiresAt) > now);
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
  getApiKeyForConfigOrThrow(activeProvider);
  const imagesDir = getImagesDir(state);
  const { inputs, mask } = await resolveRequestInputs(normalizedRequest, imagesDir);
  const queuedAt = Date.now();
  let job!: GenerationJob;
  let queueItem!: GenerationQueueItem;
  await mutateStateAndQueue((currentState, queue) => {
    const currentProvider = currentState.providers.find(p => p.id === currentState.activeProviderId) ?? currentState.providers[0];
    if (!canRunRequestWithConfig(normalizedRequest, currentProvider)) {
      throw new Error("任务 provider 与当前服务配置不一致。请先切换并保存对应服务商。");
    }
    job = createJob(normalizedRequest, currentProvider, inputs, mask);
    queueItem = createGenerationQueueItem({
      source: "desktop",
      providerId: currentProvider.id,
      request: normalizedRequest,
      costConfirmed: true,
      historyJobId: job.id,
      sourceAssetIds: [...inputs.map((asset) => asset.id), ...(mask ? [mask.id] : [])],
      outputMediaKinds: ["image"]
    });
    return {
      state: upsertJobInState(currentState, job),
      queue: appendQueueItem(queue, queueItem),
      result: null
    };
  });
  queuedJobIds.set(job.id, queueItem.queueId);

  const result = await runQueuedGenerationForAgent(queueItem.queueId, "desktop", normalizedRequest.params.timeoutMs);

  if (result.job?.historyJob) {
    const latest = (await readState()).history.find((item) => item.id === result.job?.historyJob?.id);
    if (latest) return latest;
  }

  const message = result.status === "cancelled" ? "任务已终止。" : "任务等待超时。";
  job = {
    ...job,
    status: "failed",
    durationMs: Date.now() - queuedAt,
    error: message,
    updatedAt: new Date().toISOString()
  };
  await cancelGenerationQueueItemAndUpsertJob(queueItem.queueId, job);
  sendJobEvent({ jobId: job.id, queueId: queueItem.queueId, type: "failed", error: message });
  queuedJobIds.delete(job.id);
  return job;
}

async function handleCancelJob(jobId: string): Promise<boolean> {
  if (typeof jobId !== "string" || !jobId.trim()) return false;
  const queueId = queuedJobIds.get(jobId);
  const controller = runningJobControllers.get(jobId);
  if (!queueId) return false;
  const result = await cancelGenerationQueueItemWithState(queueId);
  if (!result.item) return false;
  if (controller) {
    controller.abort();
  }
  if (result.item.status === "cancelled") {
    queuedJobIds.delete(jobId);
    sendJobEvent({ jobId, queueId, type: "failed", error: "任务已取消。" });
  }
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
  const syncedState = (await buildGalleryDiskSyncedState(state, undefined, { useStateCache: false })).state;
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
  const nextState = await getAppStateStore().mutate(async (state) => {
    const baseState = kind === "gallery" || options.syncBoth
      ? (await buildGalleryDiskSyncedState(state, undefined, { useStateCache: false })).state
      : state;
    const migratedState = options.syncBoth
      ? await migrateGalleryStorage(await migrateHistoryStorage(baseState, nextDir), nextDir)
      : kind === "history"
        ? await migrateHistoryStorage(baseState, nextDir)
        : await migrateGalleryStorage(baseState, nextDir);
    const finalState = kind === "gallery" || options.syncBoth
      ? (await buildGalleryDiskSyncedState(migratedState, undefined, { useStateCache: false })).state
      : migratedState;
    return persistentStatePayload(finalState);
  });
  stateWriteCount += 1;
  stateCache = nextState;
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

function getCliCommandArgs(): string[] | null {
  const cliIndex = process.argv.indexOf("--cli");
  if (cliIndex < 0) return null;
  return process.argv.slice(cliIndex + 1);
}

function getMcpCommandArgs(): string[] | null {
  const mcpIndex = process.argv.indexOf("--mcp");
  if (mcpIndex < 0) return null;
  return process.argv.slice(mcpIndex + 1);
}

function hasCliFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getCliOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function getCliRequestId(args: string[]): string {
  return getCliOption(args, "--request-id")?.trim() || `req_${randomUUID()}`;
}

function getCliCorrelationId(args: string[], requestId: string): string {
  return getCliOption(args, "--correlation-id")?.trim() || requestId;
}

function getCliCommand(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("--"));
}

function getCliSubcommand(args: string[], command: string | undefined): string | undefined {
  if (!command) return undefined;
  const commandIndex = args.indexOf(command);
  if (commandIndex < 0) return undefined;
  return args.slice(commandIndex + 1).find((arg) => !arg.startsWith("--"));
}

function getCliPositionalAfter(args: string[], token: string): string | undefined {
  const index = args.indexOf(token);
  if (index < 0) return undefined;
  return args.slice(index + 1).find((arg) => !arg.startsWith("--"));
}

function getCliPositionalsAfter(args: string[], token: string): string[] {
  const index = args.indexOf(token);
  if (index < 0) return [];
  const valueFlags = new Set([
    "--asset-id",
    "--aspect-ratio",
    "--client",
    "--clear-provider-concurrency",
    "--correlation-id",
    "--duplicate",
    "--folder",
    "--idempotency-key",
    "--input",
    "--mask",
    "--max-attempts",
    "--max-global-running",
    "--mode",
    "--model",
    "--name",
    "--parent",
    "--prompt",
    "--prompt-file",
    "--provider",
    "--provider-concurrency",
    "--quality",
    "--query",
    "--request-id",
    "--resolution",
    "--size",
    "--status",
    "--tag",
    "--timeout-ms",
    "--to",
    "--wait-ms"
  ]);
  const result: string[] = [];
  for (let cursor = index + 1; cursor < args.length; cursor += 1) {
    const arg = args[cursor];
    if (arg.startsWith("--")) {
      if (valueFlags.has(arg) && args[cursor + 1] && !args[cursor + 1].startsWith("--")) cursor += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function getCliOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (value && !value.startsWith("--")) values.push(value);
  }
  return values;
}

function writeCliJson(response: CrossGenJsonResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function cliSuccess(requestId: string, correlationId: string, data: Record<string, unknown>): CrossGenJsonResponse<Record<string, unknown>> {
  return {
    ok: true,
    schemaVersion: CLI_SCHEMA_VERSION,
    requestId,
    correlationId,
    data
  };
}

function cliFailure(
  requestId: string,
  correlationId: string,
  code: CrossGenJsonErrorCode,
  message: string,
  nextActions: string[] = []
): CrossGenJsonFailure {
  return {
    ok: false,
    schemaVersion: CLI_SCHEMA_VERSION,
    requestId,
    correlationId,
    error: {
      code,
      message: redactLikelySecrets(message),
      retryable: false,
      nextActions
    }
  };
}

class CliCommandModeError extends Error {
  constructor(
    readonly code: CrossGenJsonErrorCode,
    message: string,
    readonly nextActions: string[] = [],
    readonly exitCode = 2
  ) {
    super(message);
  }
}

function throwCliCommandError(code: CrossGenJsonErrorCode, message: string, nextActions: string[] = [], exitCode = 2): never {
  throw new CliCommandModeError(code, message, nextActions, exitCode);
}

function mcpToolErrorFromCli(error: CliCommandModeError) {
  const message = redactLikelySecrets(error.message);
  return {
    isError: true,
    content: [{ type: "text", text: `${error.code}: ${message}` }],
    structuredContent: {
      code: error.code,
      message,
      nextActions: error.nextActions
    }
  };
}

async function readExistingStateForCli(): Promise<AppStateFile | null> {
  try {
    return normalizeState(await readStateFile(getStatePath()));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readExistingQueueForCli() {
  return getGenerationQueueStore().read();
}

async function readQueueRuntimeConfigForCli() {
  return buildCliQueueConfig(await readExistingStateForCli());
}

async function setQueueRuntimeConfigForCli(patch: QueueRuntimeConfigPatch) {
  const nextState = await getAppStateStore().mutate((state) => ({
    ...state,
    queueConfig: applyQueueRuntimeConfigPatch(normalizeQueueRuntimeConfig(state.queueConfig), patch)
  }));
  stateCache = nextState;
  return {
    config: normalizeQueueRuntimeConfig(nextState.queueConfig)
  };
}

function parseProviderConcurrencyAssignments(values: string[]): Record<string, number> {
  const providerConcurrency: Record<string, number> = {};
  for (const value of values) {
    const separatorIndex = value.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      throwCliCommandError("INVALID_ARGUMENT", "Provider concurrency must use providerId=number.", ["Use --provider-concurrency <provider-id>=<number>."]);
    }
    const providerId = value.slice(0, separatorIndex).trim();
    if (!providerId) {
      throwCliCommandError("INVALID_ARGUMENT", "Provider id cannot be empty.", ["Use --provider-concurrency <provider-id>=<number>."]);
    }
    providerConcurrency[providerId] = parseCliQueueConcurrencyValue(value.slice(separatorIndex + 1), "--provider-concurrency");
  }
  return providerConcurrency;
}

function parseCliQueueConcurrencyValue(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_QUEUE_CONCURRENCY || parsed > MAX_QUEUE_CONCURRENCY) {
    throwCliCommandError(
      "INVALID_ARGUMENT",
      `${name} must be an integer from ${MIN_QUEUE_CONCURRENCY} to ${MAX_QUEUE_CONCURRENCY}.`,
      [`Use ${name} <number> within ${MIN_QUEUE_CONCURRENCY}-${MAX_QUEUE_CONCURRENCY}.`]
    );
  }
  return parsed;
}

function parseQueueRuntimeConfigPatchFromCli(args: string[]): QueueRuntimeConfigPatch | null {
  const maxGlobalRunningValue = getCliOption(args, "--max-global-running");
  const providerConcurrencyValues = getCliOptions(args, "--provider-concurrency");
  const clearProviderIds = getCliOptions(args, "--clear-provider-concurrency").map((providerId) => providerId.trim()).filter(Boolean);
  if (maxGlobalRunningValue === undefined && providerConcurrencyValues.length === 0 && clearProviderIds.length === 0) return null;
  return {
    maxGlobalRunning: maxGlobalRunningValue === undefined ? undefined : parseCliQueueConcurrencyValue(maxGlobalRunningValue, "--max-global-running"),
    providerConcurrency: parseProviderConcurrencyAssignments(providerConcurrencyValues),
    clearProviderIds
  };
}

function parseCliJobStatuses(args: string[]): JobStatus[] | undefined {
  const statuses = getCliOptions(args, "--status").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  if (statuses.length === 0) return undefined;
  const validStatuses = new Set<JobStatus>(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]);
  const parsed: JobStatus[] = [];
  for (const status of statuses) {
    if (!validStatuses.has(status as JobStatus)) {
      throwCliCommandError("INVALID_ARGUMENT", `Unsupported job status filter: ${status}.`, [
        "Use one of queued, running, succeeded, failed, cancelled, interrupted."
      ]);
    }
    parsed.push(status as JobStatus);
  }
  return [...new Set(parsed)];
}

function parseCliNullableFolderOption(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "null" || normalized.toLowerCase() === "uncategorized") return null;
  return normalized;
}

function parseCliGalleryListOptions(args: string[]) {
  return {
    folderId: parseCliNullableFolderOption(getCliOption(args, "--folder")),
    tags: getCliOptions(args, "--tag"),
    query: getCliOption(args, "--query")
  };
}

async function cancelGenerationQueueItemForCli(queueId: string) {
  const queue = await readExistingQueueForCli();
  const before = queue.items.find((item) => item.queueId === queueId);
  if (!before) return null;

  await cancelGenerationQueueItemWithState(queueId);
  const controller = runningQueueControllers.get(queueId);
  if (controller) {
    controller.abort();
  }
  const afterQueue = await readExistingQueueForCli();
  const job = buildCliJobStatus(afterQueue, await readExistingStateForCli(), queueId);
  if (!job) return null;

  const action =
    before.status === "queued"
      ? "cancelled"
      : before.status === "running"
      ? "cancel_requested"
      : "already_terminal";

  return {
    action,
    queueId,
    status: job.queueItem?.status ?? before.status,
    cancelRequested: job.queueItem?.cancelRequested ?? before.cancelRequested,
    providerRequestAborted: Boolean(controller),
    note:
      action === "cancel_requested"
        ? controller
          ? "Cancel was recorded in the durable queue and the current worker provider request was aborted."
          : "Cancel was recorded in the durable queue. A running provider request may continue until the active worker observes cancellation or returns."
        : undefined,
    job
  };
}

async function retryGenerationQueueItemForCli(jobId: string) {
  const result = await retryGenerationQueueItemWithState(jobId);
  if (result.action === "not_found") return { action: "not_found" as const };

  const lookupId = result.item?.queueId ?? jobId;
  const job = buildCliJobStatus(result.queue, result.state, lookupId);
  if (result.action === "not_retryable") {
    return {
      action: "not_retryable" as const,
      queueId: result.item?.queueId,
      status: result.item?.status,
      job
    };
  }

  return {
    action: "retried" as const,
    queueId: result.item?.queueId,
    status: result.item?.status,
    job
  };
}

interface AgentGenerationEnqueueInput {
  source: QueueSource;
  mode: "generate" | "edit";
  prompt: string;
  inputPaths: string[];
  maskPath?: string;
  targetGalleryFolderId?: string | null;
  providerId?: string;
  model?: string;
  costConfirmed: boolean;
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  size?: string;
  quality?: string;
  aspectRatio?: string;
  resolution?: string;
}

interface AgentGenerationEnqueueTransactionResult {
  created: boolean;
  duplicate: boolean;
  idempotencyKey?: string;
  queueId: string;
  historyJobId?: string;
  status: JobStatus;
  lookupQueueId: string;
}

function parsePositiveIntegerOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throwCliCommandError("INVALID_ARGUMENT", `${name} must be a positive integer.`, [`Use ${name} <number>.`]);
  }
  return parsed;
}

function selectProviderForAgent(state: AppStateFile, providerId?: string): StoredProviderConfig {
  const requestedId = providerId?.trim() || state.activeProviderId;
  const provider = state.providers.find((candidate) => candidate.id === requestedId);
  if (!provider) {
    throwCliCommandError("CONFIG_NOT_FOUND", "Provider configuration not found.", ["Run crossgen --cli provider list --json to find provider ids."], 4);
  }
  if (!provider.enabled) {
    throwCliCommandError("CONFIG_NOT_FOUND", "Provider configuration is disabled.", ["Enable or switch provider in CrossGen before submitting generation jobs."], 4);
  }
  return provider;
}

function normalizeTargetGalleryFolderId(state: AppStateFile, folderId: string | null | undefined): string | null | undefined {
  if (folderId === undefined) return undefined;
  if (folderId === null) return null;
  const normalized = folderId.trim();
  if (!normalized || normalized === "null") return null;
  if (!state.galleryFolders.some((folder) => folder.id === normalized)) {
    throwCliCommandError("ASSET_NOT_FOUND", "Gallery folder not found.", ["Run crossgen --cli gallery list --json to find folder ids."]);
  }
  return normalized;
}

function activeProviderModel(provider: StoredProviderConfig, override?: string): string {
  return override?.trim() || provider.activeModelId || provider.defaultModel;
}

function buildAgentImageParams(provider: StoredProviderConfig, input: AgentGenerationEnqueueInput): ImageParams {
  const model = activeProviderModel(provider, input.model);
  const timeoutMs = input.timeoutMs ?? provider.timeoutMs;
  if (provider.activeLaunchId === GENERAL_LAUNCH_ID) {
    return {
      ...DEFAULT_GENERAL_IMAGE_PARAMS,
      providerKind: provider.kind,
      model,
      timeoutMs
    };
  }
  if (provider.kind === "gemini" || provider.activeLaunchId === NANO_BANANA_3_LAUNCH_ID) {
    return {
      ...DEFAULT_GEMINI_IMAGE_PARAMS,
      providerKind: "gemini",
      model,
      aspectRatio: (input.aspectRatio as GeminiAspectRatio | undefined) ?? DEFAULT_GEMINI_IMAGE_PARAMS.aspectRatio,
      resolution: (input.resolution as GeminiResolution | undefined) ?? DEFAULT_GEMINI_IMAGE_PARAMS.resolution,
      timeoutMs
    };
  }
  return {
    ...DEFAULT_IMAGE_PARAMS,
    providerKind: "openai",
    model,
    imageRoute:
      input.mode === "generate"
        ? provider.openAIImageRouting?.preferredGenerateRoute ?? DEFAULT_IMAGE_PARAMS.imageRoute
        : provider.openAIImageRouting?.preferredEditRoute ?? DEFAULT_IMAGE_PARAMS.imageRoute,
    size: input.size ?? (provider.defaultSize || DEFAULT_IMAGE_PARAMS.size),
    quality: (input.quality as ImageQuality | undefined) ?? provider.defaultQuality,
    stream: false,
    partialImages: 0,
    timeoutMs
  };
}

function buildAgentRunJobRequest(provider: StoredProviderConfig, input: AgentGenerationEnqueueInput): RunJobRequest {
  return {
    mode: input.mode,
    prompt: input.prompt,
    inputPaths: input.inputPaths,
    maskPath: input.maskPath,
    params: buildAgentImageParams(provider, input)
  };
}

function validateAgentRunJobRequest(request: RunJobRequest, provider: StoredProviderConfig): RunJobRequest {
  const validation = validateRunJobRequest(request);
  if (!validation.ok) {
    throwCliCommandError("INVALID_ARGUMENT", validation.message ?? "Generation request is invalid.");
  }
  const normalizedRequest: RunJobRequest = {
    ...request,
    prompt: request.prompt.trim(),
    params: normalizeImageParams(request.params)
  };
  const validationError = getValidationError(normalizedRequest.params, normalizedRequest.prompt);
  if (validationError) {
    throwCliCommandError("INVALID_ARGUMENT", validationError);
  }
  const adapter = getImageProviderAdapterForRequest(normalizedRequest);
  if (!adapter) {
    throwCliCommandError("CAPABILITY_UNSUPPORTED", unsupportedImageProviderMessage(), ["Run crossgen --cli models list --json to inspect supported model capabilities."], 4);
  }
  const adapterValidation = adapter.validateJob(normalizedRequest);
  if (!adapterValidation.ok) {
    throwCliCommandError("CAPABILITY_UNSUPPORTED", adapterValidation.message ?? "Generation request is not supported by the selected model.", ["Run crossgen --cli models list --json to inspect supported model capabilities."], 4);
  }
  if (!canRunRequestWithConfig(normalizedRequest, provider)) {
    throwCliCommandError("CAPABILITY_UNSUPPORTED", "Request provider/model does not match the selected provider configuration.", ["Switch provider or pass --provider/--model for a compatible configuration."], 4);
  }
  return normalizedRequest;
}

async function enqueueGenerationForAgent(input: AgentGenerationEnqueueInput) {
  if (!input.costConfirmed) {
    throwCliCommandError("CONFIRMATION_REQUIRED", "Generation submission requires explicit confirmation.", ["Re-run with --yes or call the MCP tool with confirm: true."], 3);
  }
  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  if (idempotencyKey) {
    const existingQueue = await readExistingQueueForCli();
    const existing = existingQueue.items.find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      return {
        created: false,
        duplicate: true,
        idempotencyKey,
        queueId: existing.queueId,
        historyJobId: existing.historyJobId,
        job: buildCliJobStatus(existingQueue, await readExistingStateForCli(), existing.queueId)
      };
    }
  }

  const state = await readState();
  const provider = selectProviderForAgent(state, input.providerId);
  const targetGalleryFolderId = normalizeTargetGalleryFolderId(state, input.targetGalleryFolderId);
  const request = validateAgentRunJobRequest(buildAgentRunJobRequest(provider, input), provider);
  const { inputs, mask } = await resolveRequestInputs(request, getImagesDir(state));
  const job = createJob(request, provider, inputs, mask);
  const queueItem = createGenerationQueueItem({
    source: input.source,
    providerId: provider.id,
    request,
    costConfirmed: true,
    historyJobId: job.id,
    maxAttempts: input.maxAttempts,
    targetGalleryFolderId,
    sourceAssetIds: [...inputs.map((asset) => asset.id), ...(mask ? [mask.id] : [])],
    outputMediaKinds: ["image"],
    idempotencyKey,
    requestId: input.requestId,
    correlationId: input.correlationId
  });
  const transaction = await mutateStateAndQueue<AgentGenerationEnqueueTransactionResult>((currentState, queue) => {
    if (idempotencyKey) {
      const existing = queue.items.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) {
        return {
          state: currentState,
          queue,
          result: {
            created: false,
            duplicate: true,
            idempotencyKey,
            queueId: existing.queueId,
            historyJobId: existing.historyJobId,
            status: existing.status,
            lookupQueueId: existing.queueId
          }
        };
      }
    }
    const currentProvider = selectProviderForAgent(currentState, input.providerId);
    normalizeTargetGalleryFolderId(currentState, input.targetGalleryFolderId);
    validateAgentRunJobRequest(request, currentProvider);
    return {
      state: upsertJobInState(currentState, job),
      queue: appendQueueItem(queue, queueItem),
      result: {
        created: true,
        duplicate: false,
        idempotencyKey,
        queueId: queueItem.queueId,
        historyJobId: job.id,
        status: queueItem.status,
        lookupQueueId: queueItem.queueId
      }
    };
  });
  const { lookupQueueId, ...result } = transaction.result;
  return {
    ...result,
    job: buildCliJobStatus(transaction.queue, transaction.state, lookupQueueId)
  };
}

function readGenerationPromptFromCli(args: string[], command: string): string {
  const prompt = getCliOption(args, "--prompt");
  if (prompt !== undefined) return prompt;
  const promptFile = getCliOption(args, "--prompt-file");
  if (promptFile && command !== "generate") return readFileSync(promptFile, "utf8");
  if (command === "generate") {
    return getCliPositionalsAfter(args, command).join(" ");
  }
  return "";
}

function readGenerationPromptFileEntriesFromCli(args: string[]): { path: string; entries: GenerationPromptFileEntry[] } | null {
  const promptFile = getCliOption(args, "--prompt-file");
  if (!promptFile) return null;
  try {
    return {
      path: promptFile,
      entries: parseGenerationPromptFile(readFileSync(promptFile, "utf8"))
    };
  } catch (error) {
    throwCliCommandError("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), ["Use one prompt per line, or JSONL objects such as {\"prompt\":\"...\",\"model\":\"...\"}."]);
  }
}

function getCliGenerationInputPaths(args: string[], command: string): string[] {
  const explicit = getCliOptions(args, "--input");
  if (explicit.length > 0) return explicit;
  return command === "edit" ? getCliPositionalsAfter(args, command) : [];
}

function cliCommandErrorPayload(error: CliCommandModeError) {
  return {
    code: error.code,
    message: redactLikelySecrets(error.message),
    nextActions: error.nextActions
  };
}

function batchIdempotencyKey(globalKey: string | undefined, entry: GenerationPromptFileEntry, index: number): string | undefined {
  if (entry.idempotencyKey) return entry.idempotencyKey;
  const normalized = globalKey?.trim();
  return normalized ? `${normalized}:${index + 1}` : undefined;
}

type CliGenerationEnqueueResult = Awaited<ReturnType<typeof enqueueGenerationForAgent>>;
type CliGenerationWaitExecution = Awaited<ReturnType<typeof runQueuedGenerationForAgent>>;
type CliGenerationQueuedExecution = {
  mode: "enqueue-only" | "async";
  queueId: string;
  pendingLiveWorker: boolean;
  liveWorkerAvailable: boolean;
  job: Awaited<ReturnType<typeof buildQueuedGenerationJobStatus>>;
};
type CliGenerationBatchExecution = CliGenerationWaitExecution | CliGenerationQueuedExecution;
type CliCommandErrorPayload = ReturnType<typeof cliCommandErrorPayload>;

type CliGeneratePromptFileBatchSuccess = CliGenerationEnqueueResult & {
  ok: true;
  index: number;
  line: number;
  promptPreview: string;
  execution: CliGenerationBatchExecution;
};

interface CliGeneratePromptFileBatchFailure {
  ok: false;
  index: number;
  line: number;
  promptPreview: string;
  error: CliCommandErrorPayload;
}

type CliGeneratePromptFileBatchItem = CliGeneratePromptFileBatchSuccess | CliGeneratePromptFileBatchFailure;

function isCliGeneratePromptFileBatchSuccess(item: CliGeneratePromptFileBatchItem): item is CliGeneratePromptFileBatchSuccess {
  return item.ok === true;
}

async function runCliGeneratePromptFileBatch(input: {
  args: string[];
  requestId: string;
  correlationId: string;
  promptFile: string;
  entries: GenerationPromptFileEntry[];
  enqueueOnly: boolean;
  asyncRequested: boolean;
  waitRequested: boolean;
  waitMs?: number;
  globalMaxAttempts?: number;
  globalTimeoutMs?: number;
}) {
  const providerId = getCliOption(input.args, "--provider");
  const model = getCliOption(input.args, "--model");
  const globalIdempotencyKey = getCliOption(input.args, "--idempotency-key");
  const size = getCliOption(input.args, "--size");
  const quality = getCliOption(input.args, "--quality");
  const aspectRatio = getCliOption(input.args, "--aspect-ratio");
  const resolution = getCliOption(input.args, "--resolution");
  const targetGalleryFolderId = getCliOption(input.args, "--folder");
  const items: CliGeneratePromptFileBatchItem[] = [];

  for (let index = 0; index < input.entries.length; index += 1) {
    const entry = input.entries[index];
    try {
      const result = await enqueueGenerationForAgent({
        source: "cli",
        mode: "generate",
        prompt: entry.prompt,
        inputPaths: [],
        targetGalleryFolderId: entry.folderId ?? targetGalleryFolderId,
        providerId: entry.providerId ?? providerId,
        model: entry.model ?? model,
        costConfirmed: true,
        idempotencyKey: batchIdempotencyKey(globalIdempotencyKey, entry, index),
        requestId: `${input.requestId}:${index + 1}`,
        correlationId: input.correlationId,
        maxAttempts: entry.maxAttempts ?? input.globalMaxAttempts,
        timeoutMs: entry.timeoutMs ?? input.globalTimeoutMs,
        size: entry.size ?? size,
        quality: entry.quality ?? quality,
        aspectRatio: entry.aspectRatio ?? aspectRatio,
        resolution: entry.resolution ?? resolution
      });
      const execution: CliGenerationBatchExecution = input.waitRequested
        ? await runQueuedGenerationForAgent(result.queueId, "cli-worker", input.waitMs)
        : {
            mode: input.enqueueOnly ? "enqueue-only" : "async",
            queueId: result.queueId,
            pendingLiveWorker: input.asyncRequested,
            liveWorkerAvailable: input.asyncRequested,
            job: await buildQueuedGenerationJobStatus(result.queueId)
          };
      items.push({
        ok: true,
        index,
        line: entry.line,
        promptPreview: entry.prompt.replace(/\s+/g, " ").trim().slice(0, 180),
        ...result,
        execution
      });
    } catch (error) {
      if (error instanceof CliCommandModeError) {
        items.push({
          ok: false,
          index,
          line: entry.line,
          promptPreview: entry.prompt.replace(/\s+/g, " ").trim().slice(0, 180),
          error: cliCommandErrorPayload(error)
        });
        continue;
      }
      throw error;
    }
  }

  return {
    batch: true,
    mode: "generate",
    promptFile: input.promptFile,
    total: input.entries.length,
    submitted: items.filter(isCliGeneratePromptFileBatchSuccess).length,
    failedToSubmit: items.filter((item) => !isCliGeneratePromptFileBatchSuccess(item)).length,
    executionMode: input.waitRequested ? "wait" : input.enqueueOnly ? "enqueue-only" : "async",
    queueIds: items.filter(isCliGeneratePromptFileBatchSuccess).map((item) => item.queueId),
    items
  };
}

function normalizeCliDuplicateAction(value: string | undefined): GalleryDuplicateAction {
  return value === "replace" || value === "copy" ? value : "cancel";
}

function galleryMutationContext(state: AppStateFile, options: { duplicateAction?: GalleryDuplicateAction } = {}): GalleryMutationContext {
  return {
    galleryDir: getGalleryDir(state),
    duplicateAction: options.duplicateAction
  };
}

function mergeGalleryState(state: AppStateFile, galleryState: { galleryFolders: GalleryFolder[]; galleryAssets: GalleryAsset[] }): AppStateFile {
  return {
    ...state,
    galleryFolders: galleryState.galleryFolders,
    galleryAssets: galleryState.galleryAssets
  };
}

async function mutateGalleryStateForCli<TResult>(
  operation: (state: AppStateFile, context: GalleryMutationContext) => Promise<{ state: { galleryFolders: GalleryFolder[]; galleryAssets: GalleryAsset[] }; result: TResult }>,
  options: { duplicateAction?: GalleryDuplicateAction } = {}
): Promise<TResult> {
  let result: TResult | undefined;
  const nextState = await getAppStateStore().mutate(async (state) => {
    const outcome = await operation(state, galleryMutationContext(state, options));
    result = outcome.result;
    return mergeGalleryState(state, outcome.state);
  });
  stateCache = nextState;
  if (result === undefined) throw new Error("Gallery 操作没有返回结果。");
  return result;
}

async function readGalleryStateForCli(): Promise<AppStateFile> {
  const state = await getAppStateStore().read();
  stateCache = state;
  return state;
}

async function runMcpCommandMode(args: string[]): Promise<number> {
  const requestedMode = normalizeCliMcpMode(getCliOption(args, "--mode") ?? process.env.CROSSGEN_MCP_MODE);
  return runReadonlyMcpStdioServer({
    mode: requestedMode,
    serverVersion: getAppVersion(),
    readers: {
      configStatus: async () => buildCliConfigStatus(await readExistingStateForCli(), await readExistingQueueForCli()),
      providerList: async () => buildCliProviderList(await readExistingStateForCli()),
      modelsList: async () => buildCliModelsList(await readExistingStateForCli()),
      queueStatus: async () => buildCliQueueStatus(await readExistingQueueForCli(), await readQueueRuntimeConfigForCli()),
      queueConfig: async () => ({ config: await readQueueRuntimeConfigForCli() }),
      jobList: async (options) => buildCliJobList(await readExistingQueueForCli(), options),
      jobStatus: async (jobId) => buildCliJobStatus(await readExistingQueueForCli(), await readExistingStateForCli(), jobId),
      folderList: async () => buildCliFolderList(await readExistingStateForCli()),
      folderTree: async () => buildCliFolderTree(await readExistingStateForCli()),
      galleryList: async (options) => buildCliGalleryList(await readExistingStateForCli(), options),
      assetInspect: async (assetId) => buildCliAssetInspect(await readExistingStateForCli(), assetId)
    },
    writers: requestedMode === "readonly" ? undefined : {
      folderCreate: async ({ name, parentId }) => {
        const folder = await mutateGalleryStateForCli(async (state, context) => {
          const outcome = await createCoreGalleryFolder(state, context, { name, parentId });
          return { state: outcome.state, result: outcome.folder };
        });
        return { folder };
      },
      folderRename: async ({ folderId, name, parentId }) => {
        const folder = await mutateGalleryStateForCli(async (state, context) => {
          const outcome = await renameCoreGalleryFolder(state, context, folderId, { name, parentId });
          return { state: outcome.state, result: outcome.folder };
        });
        return { folder };
      },
      folderMove: async ({ folderId, parentId }) => {
        const folder = await mutateGalleryStateForCli(async (state, context) => {
          const outcome = await moveCoreGalleryFolder(state, context, folderId, parentId);
          return { state: outcome.state, result: outcome.folder };
        });
        return { folder };
      },
      folderDelete: async ({ folderId }) => mutateGalleryStateForCli(async (state, context) => {
        const outcome = await deleteCoreGalleryFolder(state, context, folderId);
        return { state: outcome.state, result: outcome.result };
      }),
      assetImport: async ({ paths, folderId, duplicateAction }) => {
        const result = await mutateGalleryStateForCli(
          async (state, context) => {
            const outcome = await importCoreGalleryAssets(state, context, paths, folderId ?? null);
            return { state: outcome.state, result: outcome.result };
          },
          { duplicateAction: normalizeCliDuplicateAction(duplicateAction) }
        );
        return {
          imported: result.assets.map(getGalleryAssetPublicMetadata),
          skipped: result.skipped,
          replacedAssetIds: result.replacedAssetIds
        };
      },
      assetMove: async ({ assetId, folderId }) => {
        const asset = await mutateGalleryStateForCli(async (state, context) => {
          const outcome = await updateCoreGalleryAsset(state, context, assetId, { folderId });
          return { state: outcome.state, result: outcome.asset };
        });
        return { asset: getGalleryAssetPublicMetadata(asset) };
      },
      assetUpdate: async ({ assetId, originalName, tags, folderId }) => {
        const patch: GalleryAssetPatch = {};
        if (originalName) patch.originalName = originalName;
        if (tags) patch.tags = tags;
        if (folderId !== undefined) patch.folderId = folderId;
        if (!Object.keys(patch).length) throw new Error("No asset update fields were provided.");
        const asset = await mutateGalleryStateForCli(async (state, context) => {
          const outcome = await updateCoreGalleryAsset(state, context, assetId, patch);
          return { state: outcome.state, result: outcome.asset };
        });
        return { asset: getGalleryAssetPublicMetadata(asset) };
      },
      assetRemove: async ({ assetId }) => mutateGalleryStateForCli(async (state, context) => {
        const outcome = await removeCoreGalleryAsset(state, context, assetId);
        return {
          state: outcome.state,
          result: {
            assets: outcome.assets.map(getGalleryAssetPublicMetadata),
            removed: outcome.removed ? getGalleryAssetPublicMetadata(outcome.removed) : null
          }
        };
      }),
      assetPath: async ({ assetId }) => {
        const state = await readGalleryStateForCli();
        const result = await resolveCoreGalleryAssetPath(state, galleryMutationContext(state), assetId);
        return { asset: getGalleryAssetPublicMetadata(result.asset), path: result.path };
      },
      assetExport: async ({ assetId, to, replace }) => {
        const state = await readGalleryStateForCli();
        const result = await exportCoreGalleryAsset(state, galleryMutationContext(state), assetId, to, { replace });
        return {
          asset: getGalleryAssetPublicMetadata(result.asset),
          exportedPath: result.exportedPath,
          replaced: result.replaced
        };
      }
    },
    queueControllers: requestedMode === "readonly" ? undefined : {
      queueConfigSet: async ({ maxGlobalRunning, providerConcurrency, clearProviderIds }) =>
        setQueueRuntimeConfigForCli({ maxGlobalRunning, providerConcurrency, clearProviderIds })
    },
    jobControllers: requestedMode === "generate" ? {
      generationSubmit: async ({
        mode,
        prompt,
        inputPaths,
        maskPath,
        folderId,
        providerId,
        model,
        idempotencyKey,
        confirm,
        waitMs,
        timeoutMs,
        size,
        quality,
        aspectRatio,
        resolution
      }) => {
        try {
          const result = await enqueueGenerationForAgent({
            source: "mcp",
            mode,
            prompt,
            inputPaths,
            maskPath,
            targetGalleryFolderId: folderId,
            providerId,
            model,
            costConfirmed: confirm,
            idempotencyKey,
            timeoutMs,
            size,
            quality,
            aspectRatio,
            resolution
          });
          const backgroundWorkerStarted = startBackgroundQueuedGeneration(result.queueId, "mcp");
          const normalizedWaitMs = typeof waitMs === "number" && Number.isFinite(waitMs) && waitMs > 0 ? Math.floor(waitMs) : undefined;
          const execution = normalizedWaitMs
            ? await waitForQueuedGenerationStatus(result.queueId, normalizedWaitMs)
            : {
                mode: "async",
                queueId: result.queueId,
                backgroundWorkerStarted,
                job: await buildQueuedGenerationJobStatus(result.queueId)
              };
          return {
            ...result,
            execution
          };
        } catch (error: unknown) {
          if (error instanceof CliCommandModeError) return mcpToolErrorFromCli(error);
          throw error;
        }
      },
      jobCancel: async ({ queueId }) => cancelGenerationQueueItemForCli(queueId),
      jobRetry: async ({ jobId }) => retryGenerationQueueItemForCli(jobId)
    } : undefined,
    sanitizeError: (error) => redactLikelySecrets(normalizeError(error))
  });
}

function normalizeCliMcpClient(value: string | undefined): McpClientName {
  return value === "claude-code" || value === "cursor" ? value : "codex";
}

function normalizeCliMcpMode(value: string | undefined): McpMode {
  return value === "write" || value === "generate" ? value : "readonly";
}

function envApiKeyAvailable(kind: StoredProviderConfig["kind"]): boolean {
  const providerSpecific = kind === "gemini" ? "CROSSGEN_GEMINI_API_KEY" : kind === "custom" ? "CROSSGEN_CUSTOM_API_KEY" : "CROSSGEN_OPENAI_API_KEY";
  return Boolean(process.env[providerSpecific]?.trim() || process.env.CROSSGEN_API_KEY?.trim());
}

function savedApiKeyPresentForCli(config: StoredProviderConfig): boolean {
  return Boolean(config.encryptedApiKey);
}

async function runCliCommandMode(args: string[]): Promise<number> {
  const requestId = getCliRequestId(args);
  const correlationId = getCliCorrelationId(args, requestId);
  const json = hasCliFlag(args, "--json");
  const command = getCliCommand(args);
  const subcommand = getCliSubcommand(args, command);

  try {
    if (hasCliFlag(args, "--version") || command === "version") {
      const data = {
        appName: BRAND_NAME,
        appVersion: getAppVersion(),
        schemaVersion: CLI_SCHEMA_VERSION,
        commandMode: "electron",
        userDataDir: app.getPath("userData")
      };
      if (json) {
        writeCliJson(cliSuccess(requestId, correlationId, data));
      } else {
        process.stdout.write(`${BRAND_NAME} ${getAppVersion()}\n`);
      }
      return 0;
    }

    if (command === "mcp" && subcommand === "config") {
      const data = buildCliMcpConfig({
        client: normalizeCliMcpClient(getCliOption(args, "--client")),
        mode: normalizeCliMcpMode(getCliOption(args, "--mode")),
        command: process.execPath
      });
      writeCliJson(cliSuccess(requestId, correlationId, data));
      return 0;
    }

    if (command === "doctor" && hasCliFlag(args, "--agent")) {
      const state = await readExistingStateForCli();
      const queueConfig = buildCliQueueConfig(state);
      const activeProvider = state ? state.providers.find((provider) => provider.id === state.activeProviderId) ?? state.providers[0] : undefined;
      const data = {
        appVersion: getAppVersion(),
        cliExecutable: process.execPath,
        packagedExecutable: app.isPackaged ? process.execPath : null,
        mcpCommand: process.execPath,
        recommendedArgs: ["--mcp"],
        dataDir: app.getPath("userData"),
        statePath: getStatePath(),
        stateFound: Boolean(state),
        activeProvider: activeProvider
          ? {
              id: activeProvider.id,
              kind: activeProvider.kind,
              name: activeProvider.name,
              enabled: activeProvider.enabled,
              activeLaunchId: activeProvider.activeLaunchId,
              activeModelId: activeProvider.activeModelId
            }
          : null,
        apiKeyAvailable: activeProvider ? envApiKeyAvailable(activeProvider.kind) || savedApiKeyPresentForCli(activeProvider) : false,
        liveWorkerHost: false,
        queueConfig,
        permissions: {
          cliMode: "readonly",
          mcpDefaultMode: "readonly",
          writeModeRequiresExplicitEnable: true,
          generateModeRequiresExplicitEnable: true,
          paidGenerationRequiresConfirmation: true,
          pathDisclosureRequiresConfirmation: true
        },
        knownLimitations: [
          "v0.3.1 CLI/MCP command mode currently exposes readonly discovery, queue inspection/cancellation, Gallery asset management, and generation/edit tools.",
          "CLI --wait/default command mode can execute the queued job in the current process. MCP generate mode starts a background queue worker and supports waitMs.",
          "Agent generation submit/edit tools require explicit confirmation because they may create paid provider requests when a worker executes them."
        ]
      };
      writeCliJson(cliSuccess(requestId, correlationId, data));
      return 0;
    }

    if (command === "generate" || command === "edit") {
      const promptFileBatch = command === "generate" ? readGenerationPromptFileEntriesFromCli(args) : null;
      const prompt = readGenerationPromptFromCli(args, command);
      if (!promptFileBatch && !prompt.trim()) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing prompt.", ["Use --prompt <text> or --prompt-file <path>."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Generation submission requires --yes.", [`Re-run ${command} with --yes if you intend to submit this paid job.`]));
        return 3;
      }
      const enqueueOnly = hasCliFlag(args, "--enqueue-only");
      const asyncRequested = hasCliFlag(args, "--async");
      const explicitWaitRequested = hasCliFlag(args, "--wait") || hasCliFlag(args, "--wait-ms");
      const waitRequested = explicitWaitRequested || (!promptFileBatch && !enqueueOnly && !asyncRequested);
      if (asyncRequested && waitRequested) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Use either --async or --wait, not both.", ["Use --enqueue-only if you only want to write a durable queue item."]));
        return 2;
      }
      if (asyncRequested && enqueueOnly) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Use either --async or --enqueue-only, not both."));
        return 2;
      }
      const batchDefaultsToAsync = Boolean(promptFileBatch);
      const effectiveAsyncRequested = asyncRequested || (batchDefaultsToAsync && !waitRequested && !enqueueOnly);
      if (effectiveAsyncRequested && !(await hasLiveGenerationWorkerHost())) {
        writeCliJson(cliFailure(requestId, correlationId, "NO_LIVE_QUEUE_WORKER", "No live CrossGen generation worker is available for --async.", [
          "Open CrossGen desktop, start MCP generate mode, run a queue worker, or use --wait so this CLI process executes the job.",
          "Use --enqueue-only only if you intentionally want to leave a pending durable queue item."
        ]));
        return 4;
      }
      const timeoutMs = parsePositiveIntegerOption(getCliOption(args, "--timeout-ms"), "--timeout-ms");
      const waitMs = parsePositiveIntegerOption(getCliOption(args, "--wait-ms"), "--wait-ms");
      const maxAttempts = parsePositiveIntegerOption(getCliOption(args, "--max-attempts"), "--max-attempts");
      if (promptFileBatch) {
        const result = await runCliGeneratePromptFileBatch({
          args,
          requestId,
          correlationId,
          promptFile: promptFileBatch.path,
          entries: promptFileBatch.entries,
          enqueueOnly,
          asyncRequested: effectiveAsyncRequested,
          waitRequested,
          waitMs,
          globalMaxAttempts: maxAttempts,
          globalTimeoutMs: timeoutMs
        });
        const firstItem = result.items[0];
        if (result.submitted === 0 && firstItem && !isCliGeneratePromptFileBatchSuccess(firstItem)) {
          const firstError = firstItem.error;
          writeCliJson(cliFailure(requestId, correlationId, firstError.code, firstError.message, firstError.nextActions));
          return 1;
        }
        writeCliJson(cliSuccess(requestId, correlationId, result));
        return 0;
      }
      const result = await enqueueGenerationForAgent({
        source: "cli",
        mode: command,
        prompt,
        inputPaths: getCliGenerationInputPaths(args, command),
        maskPath: getCliOption(args, "--mask"),
        targetGalleryFolderId: getCliOption(args, "--folder"),
        providerId: getCliOption(args, "--provider"),
        model: getCliOption(args, "--model"),
        costConfirmed: true,
        idempotencyKey: getCliOption(args, "--idempotency-key"),
        requestId,
        correlationId,
        maxAttempts,
        timeoutMs,
        size: getCliOption(args, "--size"),
        quality: getCliOption(args, "--quality"),
        aspectRatio: getCliOption(args, "--aspect-ratio"),
        resolution: getCliOption(args, "--resolution")
      });
      const execution = waitRequested
        ? await runQueuedGenerationForAgent(result.queueId, "cli-worker", waitMs)
        : {
            mode: enqueueOnly ? "enqueue-only" : "async",
            queueId: result.queueId,
            pendingLiveWorker: asyncRequested,
            liveWorkerAvailable: asyncRequested,
            job: await buildQueuedGenerationJobStatus(result.queueId)
          };
      writeCliJson(cliSuccess(requestId, correlationId, { ...result, execution }));
      return 0;
    }

    if (command === "config" && subcommand === "status") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliConfigStatus(await readExistingStateForCli(), await readExistingQueueForCli())));
      return 0;
    }

    if (command === "provider" && subcommand === "list") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliProviderList(await readExistingStateForCli())));
      return 0;
    }

    if (command === "models" && subcommand === "list") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliModelsList(await readExistingStateForCli())));
      return 0;
    }

    if (command === "queue" && subcommand === "status") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliQueueStatus(await readExistingQueueForCli(), await readQueueRuntimeConfigForCli())));
      return 0;
    }

    if (command === "queue" && subcommand === "config" && getCliPositionalsAfter(args, "config")[0] === "get") {
      writeCliJson(cliSuccess(requestId, correlationId, { config: await readQueueRuntimeConfigForCli() }));
      return 0;
    }

    if (command === "queue" && subcommand === "config" && getCliPositionalsAfter(args, "config")[0] === "set") {
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Queue configuration changes require --yes.", [
          "Re-run with --yes if you intend to change generation concurrency limits."
        ]));
        return 3;
      }
      const patch = parseQueueRuntimeConfigPatchFromCli(args);
      if (!patch) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "No queue configuration fields were provided.", [
          "Use --max-global-running <number>, --provider-concurrency <provider-id>=<number>, or --clear-provider-concurrency <provider-id>."
        ]));
        return 2;
      }
      writeCliJson(cliSuccess(requestId, correlationId, await setQueueRuntimeConfigForCli(patch)));
      return 0;
    }

    if (command === "job" && subcommand === "list") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliJobList(await readExistingQueueForCli(), { status: parseCliJobStatuses(args) })));
      return 0;
    }

    if (command === "job" && subcommand === "status") {
      const [jobId] = getCliPositionalsAfter(args, subcommand);
      if (!jobId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing job id.", ["Use job status <queue-id-or-history-job-id>."]));
        return 2;
      }
      const job = buildCliJobStatus(await readExistingQueueForCli(), await readExistingStateForCli(), jobId);
      if (!job) {
        writeCliJson(cliFailure(requestId, correlationId, "JOB_NOT_FOUND", "Generation job not found.", ["Run crossgen --cli job list --json to find queue ids."]));
        return 4;
      }
      writeCliJson(cliSuccess(requestId, correlationId, { job }));
      return 0;
    }

    if (command === "job" && subcommand === "cancel") {
      const [queueId] = getCliPositionalsAfter(args, subcommand);
      if (!queueId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing queue id.", ["Use job cancel <queue-id> --yes."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Job cancellation requires --yes.", ["Re-run with --yes if you intend to cancel this queued or running generation job."]));
        return 3;
      }
      const result = await cancelGenerationQueueItemForCli(queueId);
      if (!result) {
        writeCliJson(cliFailure(requestId, correlationId, "JOB_NOT_FOUND", "Generation queue item not found.", ["Run crossgen --cli job list --json to find queue ids."]));
        return 4;
      }
      writeCliJson(cliSuccess(requestId, correlationId, result));
      return 0;
    }

    if (command === "job" && subcommand === "retry") {
      const [jobId] = getCliPositionalsAfter(args, subcommand);
      if (!jobId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing job id.", ["Use job retry <queue-id-or-history-job-id> --yes."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Job retry requires --yes.", [
          "Re-run with --yes if you intend to requeue this failed, cancelled, or interrupted generation job."
        ]));
        return 3;
      }
      const result = await retryGenerationQueueItemForCli(jobId);
      if (result.action === "not_found") {
        writeCliJson(cliFailure(requestId, correlationId, "JOB_NOT_FOUND", "Generation job not found.", ["Run crossgen --cli job list --json to find queue ids."]));
        return 4;
      }
      if (result.action === "not_retryable") {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Generation job is not retryable.", [
          "Only failed, cancelled, or interrupted generation jobs can be retried."
        ]));
        return 2;
      }
      writeCliJson(cliSuccess(requestId, correlationId, result));
      return 0;
    }

    if (command === "folder" && subcommand === "list") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliFolderList(await readExistingStateForCli())));
      return 0;
    }

    if (command === "folder" && subcommand === "tree") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliFolderTree(await readExistingStateForCli())));
      return 0;
    }

    if (command === "gallery" && subcommand === "list") {
      writeCliJson(cliSuccess(requestId, correlationId, buildCliGalleryList(await readExistingStateForCli(), parseCliGalleryListOptions(args))));
      return 0;
    }

    if (command === "asset" && subcommand === "inspect") {
      const assetId = getCliOption(args, "--asset-id")?.trim() || getCliPositionalAfter(args, subcommand)?.trim();
      if (!assetId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing --asset-id for asset inspect.", ["Use --asset-id <gallery asset id>."]));
        return 2;
      }
      const asset = buildCliAssetInspect(await readExistingStateForCli(), assetId);
      if (!asset) {
        writeCliJson(cliFailure(requestId, correlationId, "ASSET_NOT_FOUND", "Gallery asset not found.", ["Run crossgen --cli gallery list --json to find asset ids."]));
        return 4;
      }
      writeCliJson(cliSuccess(requestId, correlationId, { asset }));
      return 0;
    }

    if (command === "folder" && subcommand === "create") {
      const [name] = getCliPositionalsAfter(args, subcommand);
      if (!name) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing folder name.", ["Use folder create <name>."]));
        return 2;
      }
      const folder = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await createCoreGalleryFolder(state, context, {
          name,
          parentId: getCliOption(args, "--parent") ?? undefined
        });
        return { state: outcome.state, result: outcome.folder };
      });
      writeCliJson(cliSuccess(requestId, correlationId, { folder }));
      return 0;
    }

    if (command === "folder" && subcommand === "rename") {
      const [folderId, name] = getCliPositionalsAfter(args, subcommand);
      if (!folderId || !name) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing folder id or name.", ["Use folder rename <id> <name>."]));
        return 2;
      }
      const folder = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await renameCoreGalleryFolder(state, context, folderId, {
          name,
          parentId: getCliOption(args, "--parent") ?? undefined
        });
        return { state: outcome.state, result: outcome.folder };
      });
      writeCliJson(cliSuccess(requestId, correlationId, { folder }));
      return 0;
    }

    if (command === "folder" && subcommand === "move") {
      const [folderId] = getCliPositionalsAfter(args, subcommand);
      if (!folderId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing folder id.", ["Use folder move <id> --parent <id|null>."]));
        return 2;
      }
      const folder = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await moveCoreGalleryFolder(state, context, folderId, getCliOption(args, "--parent") ?? null);
        return { state: outcome.state, result: outcome.folder };
      });
      writeCliJson(cliSuccess(requestId, correlationId, { folder }));
      return 0;
    }

    if (command === "folder" && subcommand === "delete") {
      const [folderId] = getCliPositionalsAfter(args, subcommand);
      if (!folderId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing folder id.", ["Use folder delete <id> --yes."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Folder deletion requires --yes.", ["Re-run with --yes if you intend to delete this Gallery folder."]));
        return 3;
      }
      const result = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await deleteCoreGalleryFolder(state, context, folderId);
        return { state: outcome.state, result: outcome.result };
      });
      writeCliJson(cliSuccess(requestId, correlationId, { folders: result.folders, assets: result.assets }));
      return 0;
    }

    if (command === "asset" && subcommand === "import") {
      const paths = getCliPositionalsAfter(args, subcommand);
      if (paths.length === 0) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing image path for asset import.", ["Use asset import <path...> [--folder <id>] [--duplicate cancel|replace|copy]."]));
        return 2;
      }
      const result = await mutateGalleryStateForCli(
        async (state, context) => {
          const outcome = await importCoreGalleryAssets(state, context, paths, getCliOption(args, "--folder") ?? null);
          return { state: outcome.state, result: outcome.result };
        },
        { duplicateAction: normalizeCliDuplicateAction(getCliOption(args, "--duplicate")) }
      );
      writeCliJson(cliSuccess(requestId, correlationId, {
        imported: result.assets.map(getGalleryAssetPublicMetadata),
        skipped: result.skipped,
        replacedAssetIds: result.replacedAssetIds
      }));
      return 0;
    }

    if (command === "asset" && subcommand === "move") {
      const [assetId] = getCliPositionalsAfter(args, subcommand);
      if (!assetId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing asset id.", ["Use asset move <id> --folder <id|null>."]));
        return 2;
      }
      const asset = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await updateCoreGalleryAsset(state, context, assetId, { folderId: getCliOption(args, "--folder") ?? null });
        return { state: outcome.state, result: outcome.asset };
      });
      writeCliJson(cliSuccess(requestId, correlationId, { asset: getGalleryAssetPublicMetadata(asset) }));
      return 0;
    }

    if (command === "asset" && subcommand === "update") {
      const [assetId] = getCliPositionalsAfter(args, subcommand);
      if (!assetId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing asset id.", ["Use asset update <id> [--name <name>] [--tag <tag>] [--folder <id|null>]."]));
        return 2;
      }
      const patch: GalleryAssetPatch = {};
      const name = getCliOption(args, "--name");
      if (name) patch.originalName = name;
      const tags = getCliOptions(args, "--tag");
      if (tags.length > 0) patch.tags = tags;
      if (args.includes("--folder")) patch.folderId = getCliOption(args, "--folder") ?? null;
      if (!Object.keys(patch).length) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "No asset update fields were provided.", ["Use --name, --tag, or --folder."]));
        return 2;
      }
      const asset = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await updateCoreGalleryAsset(state, context, assetId, patch);
        return { state: outcome.state, result: outcome.asset };
      });
      writeCliJson(cliSuccess(requestId, correlationId, { asset: getGalleryAssetPublicMetadata(asset) }));
      return 0;
    }

    if (command === "asset" && subcommand === "remove") {
      const [assetId] = getCliPositionalsAfter(args, subcommand);
      if (!assetId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing asset id.", ["Use asset remove <id> --yes."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Asset removal requires --yes.", ["Re-run with --yes if you intend to remove this Gallery asset."]));
        return 3;
      }
      const result = await mutateGalleryStateForCli(async (state, context) => {
        const outcome = await removeCoreGalleryAsset(state, context, assetId);
        return { state: outcome.state, result: { assets: outcome.assets.map(getGalleryAssetPublicMetadata), removed: outcome.removed ? getGalleryAssetPublicMetadata(outcome.removed) : null } };
      });
      writeCliJson(cliSuccess(requestId, correlationId, result));
      return 0;
    }

    if (command === "asset" && subcommand === "path") {
      const [assetId] = getCliPositionalsAfter(args, subcommand);
      if (!assetId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing asset id.", ["Use asset path <id> --yes."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Absolute asset path disclosure requires --yes.", ["Re-run with --yes if you intend to expose the local absolute path."]));
        return 3;
      }
      const state = await readGalleryStateForCli();
      const result = await resolveCoreGalleryAssetPath(state, galleryMutationContext(state), assetId);
      writeCliJson(cliSuccess(requestId, correlationId, { asset: getGalleryAssetPublicMetadata(result.asset), path: result.path }));
      return 0;
    }

    if (command === "asset" && subcommand === "export") {
      const [assetId] = getCliPositionalsAfter(args, subcommand);
      const targetPath = getCliOption(args, "--to");
      if (!assetId || !targetPath) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing asset id or --to path.", ["Use asset export <id> --to <path> --yes."]));
        return 2;
      }
      if (!hasCliFlag(args, "--yes")) {
        writeCliJson(cliFailure(requestId, correlationId, "CONFIRMATION_REQUIRED", "Asset export requires --yes.", ["Re-run with --yes if you intend to copy this asset to the target path."]));
        return 3;
      }
      const state = await readGalleryStateForCli();
      const result = await exportCoreGalleryAsset(state, galleryMutationContext(state), assetId, targetPath, { replace: hasCliFlag(args, "--replace") });
      writeCliJson(cliSuccess(requestId, correlationId, {
        asset: getGalleryAssetPublicMetadata(result.asset),
        exportedPath: result.exportedPath,
        replaced: result.replaced
      }));
      return 0;
    }

    if (command === "asset" && subcommand === "open") {
      const [assetId] = getCliPositionalsAfter(args, subcommand);
      if (!assetId) {
        writeCliJson(cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Missing asset id.", ["Use asset open <id>."]));
        return 2;
      }
      const state = await readGalleryStateForCli();
      const result = await resolveCoreGalleryAssetPath(state, galleryMutationContext(state), assetId);
      shell.showItemInFolder(result.path);
      writeCliJson(cliSuccess(requestId, correlationId, { asset: getGalleryAssetPublicMetadata(result.asset), opened: true }));
      return 0;
    }

    const response = cliFailure(requestId, correlationId, "INVALID_ARGUMENT", "Unsupported CrossGen CLI command.", [
      "Use --cli --version --json.",
      "Use --cli doctor --agent --json.",
      "Use --cli config status --json.",
      "Use --cli provider list --json.",
      "Use --cli models list --json.",
      "Use --cli generate --prompt <text> [--folder <id|null>] --yes [--wait|--async|--enqueue-only] --json.",
      "Use --cli generate --prompt-file <jsonl> [--folder <id|null>] --yes [--wait|--async|--enqueue-only] --json.",
      "Use --cli edit --prompt <text> --input <path> [--folder <id|null>] --yes [--wait|--async|--enqueue-only] --json.",
      "Use --cli queue status --json.",
      "Use --cli queue config get --json.",
      "Use --cli queue config set --max-global-running <number> [--provider-concurrency <provider-id>=<number>] --yes --json.",
      "Use --cli job list [--status queued|running|succeeded|failed|cancelled|interrupted] --json.",
      "Use --cli job status <queue-id-or-history-job-id> --json.",
      "Use --cli job cancel <queue-id> --yes --json.",
      "Use --cli job retry <queue-id-or-history-job-id> --yes --json.",
      "Use --cli folder tree --json.",
      "Use --cli gallery list [--folder <id|null>] [--tag <tag>] [--query <text>] --json.",
      "Use --cli folder create <name> --json.",
      "Use --cli asset import <path...> --json.",
      "Use --cli asset export <id> --to <path> --yes --json.",
      "Use --cli mcp config --client codex --mode readonly --json."
    ]);
    if (json) {
      writeCliJson(response);
    } else {
      process.stderr.write(`${response.error.message}\n`);
    }
    return 2;
  } catch (error) {
    if (error instanceof CliCommandModeError) {
      writeCliJson(cliFailure(requestId, correlationId, error.code, error.message, error.nextActions));
      return error.exitCode;
    }
    writeCliJson(cliFailure(requestId, correlationId, "UNKNOWN_ERROR", normalizeError(error)));
    return 1;
  }
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
  const cliCommandArgs = getCliCommandArgs();
  if (cliCommandArgs) {
    const exitCode = await runCliCommandMode(cliCommandArgs);
    app.exit(exitCode);
    return;
  }
  const mcpCommandArgs = getMcpCommandArgs();
  if (mcpCommandArgs) {
    const exitCode = await runMcpCommandMode(mcpCommandArgs);
    app.exit(exitCode);
    return;
  }
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
  startDesktopQueueWorker();

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
  stopDesktopQueueWorker();
  stopGalleryWatcher();
});
