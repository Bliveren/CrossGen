import { listProviderModelCapabilitySummaries } from "../core/modelCapabilities.js";
import { DEFAULT_QUEUE_RUNTIME_CONFIG, normalizeQueueRuntimeConfig } from "../core/queueConfig.js";
import type {
  GalleryAsset,
  GalleryFolder,
  GenerationJob,
  GenerationQueueItem,
  GenerationQueueFile,
  ImageQuality,
  JobStatus,
  OpenAIImageRouting,
  ProviderConfig,
  ProviderKind,
  QueueRuntimeConfig,
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
  queueConfig?: QueueRuntimeConfig;
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

export function buildCliQueueConfig(state: ReadonlyAppState | null) {
  return normalizeQueueRuntimeConfig(state?.queueConfig ?? DEFAULT_QUEUE_RUNTIME_CONFIG);
}

function publicQueueJob(item: GenerationQueueItem) {
  return {
    queueId: item.queueId,
    source: item.source,
    providerId: item.providerId,
    status: item.status,
    priority: item.priority,
    attempt: item.attempt,
    maxAttempts: item.maxAttempts,
    mode: item.request.mode,
    promptPreview: promptPreview(item.request.prompt),
    inputCount: item.request.inputPaths.length,
    hasMask: Boolean(item.request.maskPath || item.request.maskDataUrl),
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
    galleryAssetIds: item.galleryAssetIds,
    targetGalleryFolderId: item.targetGalleryFolderId ?? null,
    cancelRequested: item.cancelRequested,
    workerHostId: item.workerHostId,
    workerProcessId: item.workerProcessId,
    workerHeartbeatAt: item.workerHeartbeatAt,
    workerLeaseExpiresAt: item.workerLeaseExpiresAt,
    executionKind: item.executionKind,
    stage: item.stage,
    remoteProviderStatus: item.remoteProviderStatus,
    lastPollAt: item.lastPollAt,
    localStep: item.localStep,
    outputMediaKinds: item.outputMediaKinds,
    sourceAssetIds: item.sourceAssetIds,
    requestId: item.requestId,
    correlationId: item.correlationId
  };
}

function publicHistoryJob(job: GenerationJob) {
  return {
    id: job.id,
    name: job.name,
    tags: job.tags,
    providerKind: job.providerKind,
    providerId: job.providerId,
    launchId: job.launchId,
    modelId: job.modelId,
    modelDisplayName: job.modelDisplayName,
    mode: job.mode,
    promptPreview: promptPreview(job.prompt),
    inputCount: job.inputAssets.length,
    hasMask: Boolean(job.maskAsset),
    status: job.status,
    durationMs: job.durationMs,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputCount: job.outputs.length,
    outputs: job.outputs.map((output) => ({
      id: output.id,
      fileName: output.fileName,
      mimeType: output.mimeType,
      kind: output.kind ?? "image",
      width: output.width,
      height: output.height,
      sourceType: output.sourceType,
      createdAt: output.createdAt
    })),
    usage: job.usage,
    hasProviderMetadata: Boolean(job.providerMetadata)
  };
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
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
    queueConfig: buildCliQueueConfig(state),
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

export function buildCliQueueStatus(queue: GenerationQueueFile, queueConfig: QueueRuntimeConfig = DEFAULT_QUEUE_RUNTIME_CONFIG) {
  return {
    schemaVersion: queue.schemaVersion,
    updatedAt: queue.updatedAt,
    config: normalizeQueueRuntimeConfig(queueConfig),
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
    jobs: queue.items.map(publicQueueJob)
  };
}

export function buildCliJobStatus(queue: GenerationQueueFile, state: ReadonlyAppState | null, jobId: string) {
  const lookupId = jobId.trim();
  const queueItem = queue.items.find((item) => item.queueId === lookupId || item.historyJobId === lookupId);
  const historyJob = state?.history.find((job) => job.id === lookupId || job.id === queueItem?.historyJobId);
  if (!queueItem && !historyJob) return null;
  return {
    lookupId,
    source: queueItem ? "queue" : "history",
    queueItem: queueItem ? publicQueueJob(queueItem) : null,
    historyJob: historyJob ? publicHistoryJob(historyJob) : null,
    canCancel: queueItem ? queueItem.status === "queued" || queueItem.status === "running" : false,
    terminal: queueItem ? isTerminalStatus(queueItem.status) : historyJob ? isTerminalStatus(historyJob.status) : false
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
  const effectiveMode: McpMode = options.mode;
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
      write: effectiveMode === "write" || effectiveMode === "generate",
      generate: effectiveMode === "generate"
    },
    supportedModes: ["readonly", "write", "generate"],
    generateModeWarning:
      options.mode === "generate"
        ? "Generate mode can submit image generation/edit requests. MCP generate hosts start queue execution and tools may pass waitMs for short completion waits."
        : undefined
  };
}
