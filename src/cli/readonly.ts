import { listProviderModelCapabilitySummaries } from "../core/modelCapabilities.js";
import type {
  GalleryAsset,
  GalleryFolder,
  GenerationJob,
  GenerationQueueFile,
  ImageQuality,
  OpenAIImageRouting,
  ProviderConfig,
  ProviderKind,
  StorageSettings
} from "../shared/types.js";
import type { FocusedLaunchId } from "../shared/types.js";

interface ReadonlyProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  enabled: boolean;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: ImageQuality;
  timeoutMs: number;
  streamingPartialsEnabled: boolean;
  discoveredModels: ProviderConfig["discoveredModels"];
  lastModelDiscoveryAt?: string;
  lastModelDiscoveryError?: string;
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  openAIImageRouting?: OpenAIImageRouting;
  updatedAt: string;
  encryptedApiKey?: string;
}

interface ReadonlyAppState {
  providers: ReadonlyProviderConfig[];
  activeProviderId: string;
  history: GenerationJob[];
  galleryFolders: GalleryFolder[];
  galleryAssets: GalleryAsset[];
  storage?: StorageSettings;
}

export type McpClientName = "codex" | "claude-code" | "cursor";

export type McpMode = "readonly" | "write" | "generate";

function activeProvider(state: ReadonlyAppState): ReadonlyProviderConfig | undefined {
  return state.providers.find((provider) => provider.id === state.activeProviderId) ?? state.providers[0];
}

function publicProvider(provider: ReadonlyProviderConfig) {
  return {
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    enabled: provider.enabled,
    activeLaunchId: provider.activeLaunchId,
    activeModelId: provider.activeModelId,
    defaultModel: provider.defaultModel,
    defaultSize: provider.defaultSize,
    defaultQuality: provider.defaultQuality,
    timeoutMs: provider.timeoutMs,
    streamingPartialsEnabled: provider.streamingPartialsEnabled,
    discoveredModelCount: provider.discoveredModels.length,
    lastModelDiscoveryAt: provider.lastModelDiscoveryAt,
    lastModelDiscoveryError: provider.lastModelDiscoveryError,
    apiKeySaved: Boolean(provider.encryptedApiKey),
    openAIImageRouting: provider.openAIImageRouting
  };
}

function capabilityProvider(provider: ReadonlyProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKeySaved: Boolean(provider.encryptedApiKey),
    discoveredModels: provider.discoveredModels
  };
}

function queueStatusCounts(queue: GenerationQueueFile): Record<string, number> {
  return queue.items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

function promptPreview(prompt: string, maxLength = 180): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function liveWorkerHosts(queue: GenerationQueueFile, now = Date.now()): number {
  return queue.workerHosts.filter((host) => Date.parse(host.leaseExpiresAt) > now).length;
}

export function buildCliConfigStatus(state: ReadonlyAppState | null, queue: GenerationQueueFile) {
  const provider = state ? activeProvider(state) : undefined;
  return {
    stateFound: Boolean(state),
    activeProvider: provider ? publicProvider(provider) : null,
    providerCount: state?.providers.length ?? 0,
    historyCount: state?.history.length ?? 0,
    galleryFolderCount: state?.galleryFolders.length ?? 0,
    galleryAssetCount: state?.galleryAssets.length ?? 0,
    queueItemCount: queue.items.length,
    queueStatusCounts: queueStatusCounts(queue),
    liveWorkerHosts: liveWorkerHosts(queue),
    storageConfigured: {
      historyDir: Boolean(state?.storage?.historyDir),
      galleryDir: Boolean(state?.storage?.galleryDir)
    }
  };
}

export function buildCliProviderList(state: ReadonlyAppState | null) {
  return {
    activeProviderId: state?.activeProviderId ?? null,
    providers: state?.providers.map(publicProvider) ?? []
  };
}

export function buildCliModelsList(state: ReadonlyAppState | null) {
  return {
    providers: state?.providers.map((provider) => ({
      provider: publicProvider(provider),
      models: listProviderModelCapabilitySummaries(capabilityProvider(provider))
    })) ?? []
  };
}

export function buildCliQueueStatus(queue: GenerationQueueFile) {
  return {
    schemaVersion: queue.schemaVersion,
    updatedAt: queue.updatedAt,
    totalItems: queue.items.length,
    statusCounts: queueStatusCounts(queue),
    liveWorkerHosts: liveWorkerHosts(queue),
    workerHosts: queue.workerHosts.map((host) => ({
      hostId: host.hostId,
      kind: host.kind,
      processId: host.processId,
      mode: host.mode,
      heartbeatAt: host.heartbeatAt,
      leaseExpiresAt: host.leaseExpiresAt
    }))
  };
}

export function buildCliJobList(queue: GenerationQueueFile) {
  return {
    jobs: queue.items.map((item) => ({
      queueId: item.queueId,
      source: item.source,
      providerId: item.providerId,
      status: item.status,
      priority: item.priority,
      attempt: item.attempt,
      maxAttempts: item.maxAttempts,
      mode: item.request.mode,
      promptPreview: promptPreview(item.request.prompt),
      createdAt: item.createdAt,
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      nextRunAt: item.nextRunAt,
      lastError: item.lastError,
      lastErrorCategory: item.lastErrorCategory,
      lastErrorRetryable: item.lastErrorRetryable,
      historyJobId: item.historyJobId,
      outputAssetIds: item.outputAssetIds,
      partialAssetIds: item.partialAssetIds,
      cancelRequested: item.cancelRequested,
      workerHostId: item.workerHostId,
      executionKind: item.executionKind,
      stage: item.stage,
      outputMediaKinds: item.outputMediaKinds,
      requestId: item.requestId,
      correlationId: item.correlationId
    }))
  };
}

export function buildCliGalleryList(state: ReadonlyAppState | null) {
  return {
    folders: state?.galleryFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      color: folder.color,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt
    })) ?? [],
    assets: state?.galleryAssets.map((asset) => ({
      id: asset.id,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      kind: asset.kind ?? "image",
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      folderId: asset.folderId ?? null,
      tags: asset.tags,
      source: asset.source,
      sourceJobId: asset.sourceJobId,
      sourceAssetId: asset.sourceAssetId,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      modifiedAt: asset.modifiedAt,
      hasContentHash: Boolean(asset.contentHash)
    })) ?? []
  };
}

export function buildCliFolderList(state: ReadonlyAppState | null) {
  return {
    folders: state?.galleryFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      color: folder.color,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt
    })) ?? []
  };
}

export function buildCliAssetInspect(state: ReadonlyAppState | null, assetId: string) {
  const asset = state?.galleryAssets.find((candidate) => candidate.id === assetId);
  if (!asset) return null;
  return {
    id: asset.id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    kind: asset.kind ?? "image",
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    folderId: asset.folderId ?? null,
    tags: asset.tags,
    source: asset.source,
    sourceJobId: asset.sourceJobId,
    sourceAssetId: asset.sourceAssetId,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    modifiedAt: asset.modifiedAt,
    hasContentHash: Boolean(asset.contentHash),
    hasSourcePathHash: Boolean(asset.sourcePathHash)
  };
}

export function buildCliMcpConfig(options: { client: McpClientName; mode: McpMode; command: string }) {
  const args = ["--mcp"];
  const effectiveMode: McpMode = "readonly";
  return {
    client: options.client,
    requestedMode: options.mode,
    mode: effectiveMode,
    transport: "stdio",
    command: options.command,
    args,
    env: {
      CROSSGEN_MCP_MODE: effectiveMode
    },
    permissions: {
      readonly: true,
      write: false,
      generate: false
    },
    supportedModes: [effectiveMode],
    unsupportedModeWarning:
      options.mode === effectiveMode
        ? undefined
        : "This build currently exposes readonly MCP tools only. Write and generation MCP modes are reserved for later v0.3.1 phases."
  };
}
