import type {
  DiscoveredModel,
  FocusedLaunchId,
  GalleryAsset,
  GalleryFolder,
  GenerationJob,
  ImageParams,
  ImageQuality,
  OpenAIImageParams,
  PromptTemplate,
  ProviderKind,
  StorageSettings,
  WorkspaceDraft
} from "../../shared/types.js";
import path from "node:path";
import {
  DEFAULT_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GENERAL_IMAGE_PARAMS,
  DEFAULT_GEMINI_IMAGE_PARAMS,
  DEFAULT_IMAGE_PARAMS,
  IMAGE_BACKGROUND_OPTIONS,
  IMAGE_FORMAT_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  MODERATION_MODE_OPTIONS,
  normalizeBaseURL
} from "../../shared/validation.js";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  getModelDisplayName
} from "../../shared/modelCatalog.js";

export const STATE_VERSION = 3;
export const DEFAULT_OPENAI_PROVIDER_ID = "default";

export interface StoredProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  enabled: boolean;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: ImageQuality;
  timeoutMs: number;
  discoveredModels: DiscoveredModel[];
  lastModelDiscoveryAt?: string;
  lastModelDiscoveryError?: string;
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  updatedAt: string;
  encryptedApiKey?: string;
  encryption: "safeStorage" | "localFallback" | "none";
}

export interface AppStateFile {
  version: number;
  providers: StoredProviderConfig[];
  activeProviderId: string;
  history: GenerationJob[];
  promptTemplates: PromptTemplate[];
  galleryFolders: GalleryFolder[];
  galleryAssets: GalleryAsset[];
  storage?: StorageSettings;
  draft?: WorkspaceDraft;
}

export const defaultStoredConfig: StoredProviderConfig = {
  id: DEFAULT_OPENAI_PROVIDER_ID,
  kind: "openai",
  name: "OpenAI",
  baseURL: DEFAULT_BASE_URL,
  enabled: true,
  defaultModel: DEFAULT_IMAGE_PARAMS.model,
  defaultSize: DEFAULT_IMAGE_PARAMS.size,
  defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
  timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
  discoveredModels: [],
  activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
  activeModelId: DEFAULT_IMAGE_PARAMS.model,
  updatedAt: new Date(0).toISOString(),
  encryption: "none"
};

export function getDefaultState(): AppStateFile {
  const defaultProvider = { ...defaultStoredConfig, discoveredModels: [...defaultStoredConfig.discoveredModels] };
  return {
    version: STATE_VERSION,
    providers: [defaultProvider],
    activeProviderId: defaultProvider.id,
    history: [],
    promptTemplates: [],
    galleryFolders: [],
    galleryAssets: []
  };
}

export function normalizeState(parsed: unknown): AppStateFile {
  if (!isRecord(parsed)) return getDefaultState();

  // Handle migration from v1/v2 (single config) to v3 (multiple providers)
  if ((parsed.version === 1 || parsed.version === 2) && isRecord(parsed.config)) {
    const migratedProvider = normalizeStoredConfig(parsed.config);
    const galleryFolders = normalizeGalleryFolders(parsed.galleryFolders);
    return {
      version: STATE_VERSION,
      providers: [migratedProvider],
      activeProviderId: migratedProvider.id,
      history: Array.isArray(parsed.history) ? parsed.history.map((job) => normalizeGenerationJob(job, migratedProvider.id)) : [],
      promptTemplates: normalizePromptTemplates(parsed.promptTemplates),
      galleryFolders,
      galleryAssets: normalizeGalleryAssets(parsed.galleryAssets, galleryFolders),
      storage: normalizeStorageSettings(parsed.storage),
      draft: normalizeWorkspaceDraft(parsed.draft)
    };
  }

  // Handle v3 format
  const providers = Array.isArray(parsed.providers) && parsed.providers.length > 0
    ? parsed.providers.map((p) => normalizeStoredConfig(p))
    : [{ ...defaultStoredConfig, discoveredModels: [...defaultStoredConfig.discoveredModels] }];

  const activeProviderId = nonEmptyString(parsed.activeProviderId, providers[0].id);
  const activeProvider = providers.find(p => p.id === activeProviderId) ?? providers[0];

  const galleryFolders = normalizeGalleryFolders(parsed.galleryFolders);
  return {
    version: STATE_VERSION,
    providers,
    activeProviderId: activeProvider.id,
    history: Array.isArray(parsed.history) ? parsed.history.map((job) => normalizeGenerationJob(job, activeProvider.id)) : [],
    promptTemplates: normalizePromptTemplates(parsed.promptTemplates),
    galleryFolders,
    galleryAssets: normalizeGalleryAssets(parsed.galleryAssets, galleryFolders),
    storage: normalizeStorageSettings(parsed.storage),
    draft: normalizeWorkspaceDraft(parsed.draft)
  };
}

function normalizeStoredConfig(value: unknown): StoredProviderConfig {
  const input = isRecord(value) ? value : {};
  const kind = normalizeProviderKind(input.kind, "openai");
  const defaultModel = nonEmptyString(input.defaultModel, DEFAULT_IMAGE_PARAMS.model);
  const defaultSize = nonEmptyString(input.defaultSize, DEFAULT_IMAGE_PARAMS.size);
  const activeLaunchId = normalizeFocusedLaunchId(input.activeLaunchId, GPT_IMAGE_2_LAUNCH_ID);
  const defaultBaseURL = kind === "gemini" ? DEFAULT_GEMINI_BASE_URL : DEFAULT_BASE_URL;
  const baseURL = typeof input.baseURL === "string" && input.baseURL.trim() ? input.baseURL : defaultBaseURL;

  return {
    id: nonEmptyString(input.id, DEFAULT_OPENAI_PROVIDER_ID),
    kind,
    name: nonEmptyString(input.name, kind === "gemini" ? "Gemini" : kind === "custom" ? "Custom" : "OpenAI"),
    baseURL: normalizeBaseURL(baseURL),
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    defaultModel,
    defaultSize,
    defaultQuality: oneOf(input.defaultQuality, IMAGE_QUALITY_OPTIONS, DEFAULT_IMAGE_PARAMS.quality),
    timeoutMs: boundedInteger(input.timeoutMs, 30000, 600000, DEFAULT_IMAGE_PARAMS.timeoutMs),
    discoveredModels: normalizeDiscoveredModels(input.discoveredModels, kind),
    lastModelDiscoveryAt: optionalString(input.lastModelDiscoveryAt),
    lastModelDiscoveryError: optionalString(input.lastModelDiscoveryError),
    activeLaunchId,
    activeModelId: nonEmptyString(input.activeModelId, activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ? defaultModel : getDefaultModelForLaunch(activeLaunchId)),
    updatedAt: nonEmptyString(input.updatedAt, new Date(0).toISOString()),
    encryptedApiKey: optionalString(input.encryptedApiKey),
    encryption: normalizeEncryption(input.encryption)
  };
}

function normalizeDiscoveredModels(value: unknown, fallbackKind: ProviderKind): DiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    return [
      {
        id: item.id.trim(),
        providerKind: normalizeProviderKind(item.providerKind, fallbackKind),
        displayName: optionalString(item.displayName),
        description: optionalString(item.description),
        raw: item.raw
      }
    ];
  });
}

function normalizePromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = nonEmptyString(item.id, "");
    const title = nonEmptyString(item.title, "");
    const body = nonEmptyString(item.body, "");
    if (!id || !title || !body || seen.has(id)) return [];
    seen.add(id);
    const createdAt = nonEmptyString(item.createdAt, new Date(0).toISOString());
    const updatedAt = nonEmptyString(item.updatedAt, createdAt);
    return [
      {
        id,
        title,
        body,
        tags: normalizeStringList(item.tags),
        category: optionalString(item.category),
        createdAt,
        updatedAt
      }
    ];
  });
}

function normalizeGalleryFolders(value: unknown): GalleryFolder[] {
  if (!Array.isArray(value)) return [];
  const candidates: GalleryFolder[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = nonEmptyString(item.id, "");
    const name = normalizeGalleryFolderName(item.name);
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    const createdAt = nonEmptyString(item.createdAt, new Date(0).toISOString());
    const updatedAt = nonEmptyString(item.updatedAt, createdAt);
    const color = normalizeGalleryFolderColor(item.color);
    candidates.push({
      id,
      name,
      parentId: optionalString(item.parentId) ?? null,
      color,
      createdAt,
      updatedAt
    });
  }

  const idSet = new Set(candidates.map((folder) => folder.id));
  const normalizedParents = candidates.map((folder) => ({
    ...folder,
    parentId: folder.parentId && idSet.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : null
  }));
  const parentById = new Map(normalizedParents.map((folder) => [folder.id, folder.parentId ?? null]));
  const breaksCycle = (folder: GalleryFolder): boolean => {
    const visited = new Set<string>([folder.id]);
    let current = folder.parentId ?? null;
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      current = parentById.get(current) ?? null;
    }
    return true;
  };
  const acyclic = normalizedParents.map((folder) => breaksCycle(folder) ? folder : { ...folder, parentId: null });
  const seenSiblingNames = new Set<string>();
  const result: GalleryFolder[] = [];
  for (const folder of acyclic) {
    const key = `${folder.parentId ?? ""}\u0000${folder.name.toLowerCase()}`;
    if (seenSiblingNames.has(key)) continue;
    seenSiblingNames.add(key);
    result.push(folder);
  }
  return result;
}

function normalizeGalleryFolderName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeGalleryFolderColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

function normalizeStorageSettings(value: unknown): StorageSettings | undefined {
  if (!isRecord(value)) return undefined;
  const historyDir = optionalString(value.historyDir);
  const galleryDir = optionalString(value.galleryDir);
  if (!historyDir && !galleryDir) return undefined;
  return {
    historyDir: historyDir ?? "",
    galleryDir: galleryDir ?? ""
  };
}

function normalizeGalleryAssets(value: unknown, folders: GalleryFolder[]): GalleryAsset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const folderIds = new Set(folders.map((folder) => folder.id));
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = nonEmptyString(item.id, "");
    const fileName = nonEmptyString(item.fileName, "");
    const safeFileName = pathSafeFileName(fileName);
    const originalName = nonEmptyString(item.originalName, fileName);
    const mimeType = nonEmptyString(item.mimeType, "");
    const sizeBytes = typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0 ? item.sizeBytes : -1;
    if (!id || !fileName || safeFileName !== fileName || !mimeType || sizeBytes < 0 || seen.has(id)) return [];
    seen.add(id);
    const createdAt = nonEmptyString(item.createdAt, new Date(0).toISOString());
    const updatedAt = nonEmptyString(item.updatedAt, createdAt);
    const folderId = optionalString(item.folderId);
    return [
      {
        id,
        fileName: safeFileName,
        originalName,
        mimeType,
        sizeBytes,
        width: boundedOptionalInteger(item.width),
        height: boundedOptionalInteger(item.height),
        folderId: folderId && folderIds.has(folderId) ? folderId : null,
        tags: normalizeStringList(item.tags),
        source: item.source === "result" ? "result" : "import",
        createdAt,
        updatedAt,
        ...(optionalString(item.modifiedAt) ? { modifiedAt: optionalString(item.modifiedAt) } : {})
      }
    ];
  });
}

function pathSafeFileName(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return "";
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
  return segments.join("/");
}

function boundedOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

function normalizeGenerationJob(value: unknown, fallbackProviderId: string): GenerationJob {
  const input = isRecord(value) ? value : {};
  const params = normalizeImageParams(input.params);
  const providerKind = normalizeProviderKind(input.providerKind, params.providerKind);
  const launchId = normalizeFocusedLaunchId(input.launchId, params.launchId);
  const modelId = nonEmptyString(input.modelId, params.model);

  return {
    ...(input as unknown as GenerationJob),
    providerKind,
    providerId: nonEmptyString(input.providerId, fallbackProviderId),
    launchId,
    modelId,
    modelDisplayName: nonEmptyString(input.modelDisplayName, getModelDisplayName(launchId, modelId)),
    params
  };
}

function normalizeWorkspaceDraft(value: unknown): WorkspaceDraft | undefined {
  if (!isRecord(value)) return undefined;
  const params = normalizeImageParams(value.params);
  return {
    ...(value as unknown as WorkspaceDraft),
    activeLaunchId: normalizeFocusedLaunchId(value.activeLaunchId, params.launchId),
    activeModelId: nonEmptyString(value.activeModelId, params.model),
    params
  };
}

export function normalizeImageParams(value: unknown): ImageParams {
  const input = isRecord(value) ? value : {};
  const launchId = normalizeFocusedLaunchId(input.launchId, GPT_IMAGE_2_LAUNCH_ID);
  const providerKind = normalizeProviderKind(input.providerKind, launchId === NANO_BANANA_3_LAUNCH_ID ? "gemini" : "openai");

  if (launchId === GENERAL_LAUNCH_ID) {
    const defaults = DEFAULT_GENERAL_IMAGE_PARAMS;
    return {
      ...defaults,
      providerKind,
      launchId: GENERAL_LAUNCH_ID,
      model: nonEmptyString(input.model, defaults.model),
      outputCount: boundedInteger(input.outputCount, 1, 1, defaults.outputCount),
      timeoutMs: boundedInteger(input.timeoutMs, 30000, 600000, defaults.timeoutMs)
    };
  }

  if (providerKind === "gemini" || launchId === NANO_BANANA_3_LAUNCH_ID) {
    const defaults = DEFAULT_GEMINI_IMAGE_PARAMS;
    return {
      ...defaults,
      providerKind: "gemini",
      launchId: NANO_BANANA_3_LAUNCH_ID,
      model: nonEmptyString(input.model, defaults.model),
      aspectRatio: oneOf(input.aspectRatio, ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"] as const, defaults.aspectRatio),
      resolution: oneOf(input.resolution, ["0.5K", "1K", "2K", "4K"] as const, defaults.resolution),
      outputCount: boundedInteger(input.outputCount, 1, 1, defaults.outputCount),
      thinking: typeof input.thinking === "boolean" ? input.thinking : defaults.thinking,
      searchGrounding: typeof input.searchGrounding === "boolean" ? input.searchGrounding : defaults.searchGrounding,
      timeoutMs: boundedInteger(input.timeoutMs, 30000, 600000, defaults.timeoutMs)
    };
  }

  return normalizeOpenAIImageParams(input);
}

function normalizeOpenAIImageParams(input: Record<string, unknown>): OpenAIImageParams {
  return {
    ...DEFAULT_IMAGE_PARAMS,
    providerKind: "openai",
    launchId: GPT_IMAGE_2_LAUNCH_ID,
    model: nonEmptyString(input.model, GPT_IMAGE_2_MODEL_ID),
    size: nonEmptyString(input.size, DEFAULT_IMAGE_PARAMS.size),
    quality: oneOf(input.quality, IMAGE_QUALITY_OPTIONS, DEFAULT_IMAGE_PARAMS.quality),
    outputFormat: oneOf(input.outputFormat, IMAGE_FORMAT_OPTIONS, DEFAULT_IMAGE_PARAMS.outputFormat),
    outputCompression: boundedInteger(input.outputCompression, 0, 100, DEFAULT_IMAGE_PARAMS.outputCompression),
    background: oneOf(input.background, IMAGE_BACKGROUND_OPTIONS, DEFAULT_IMAGE_PARAMS.background),
    n: boundedInteger(input.n, 1, 10, DEFAULT_IMAGE_PARAMS.n),
    stream: typeof input.stream === "boolean" ? input.stream : DEFAULT_IMAGE_PARAMS.stream,
    partialImages: boundedInteger(input.partialImages, 0, 3, DEFAULT_IMAGE_PARAMS.partialImages),
    moderation: oneOf(input.moderation, MODERATION_MODE_OPTIONS, DEFAULT_IMAGE_PARAMS.moderation),
    timeoutMs: boundedInteger(input.timeoutMs, 30000, 600000, DEFAULT_IMAGE_PARAMS.timeoutMs)
  };
}

function getDefaultModelForLaunch(launchId: FocusedLaunchId): string {
  if (launchId === NANO_BANANA_3_LAUNCH_ID) return DEFAULT_GEMINI_IMAGE_PARAMS.model;
  if (launchId === GENERAL_LAUNCH_ID) return DEFAULT_GENERAL_IMAGE_PARAMS.model;
  return GPT_IMAGE_2_MODEL_ID;
}

function normalizeProviderKind(value: unknown, fallback: ProviderKind): ProviderKind {
  if (value === "openai" || value === "gemini" || value === "custom") return value;
  return fallback;
}

function normalizeFocusedLaunchId(value: unknown, fallback: FocusedLaunchId): FocusedLaunchId {
  if (value === GPT_IMAGE_2_LAUNCH_ID || value === NANO_BANANA_3_LAUNCH_ID || value === GENERAL_LAUNCH_ID) return value;
  return fallback;
}

function normalizeEncryption(value: unknown): StoredProviderConfig["encryption"] {
  if (value === "safeStorage" || value === "localFallback" || value === "none") return value;
  return "none";
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
