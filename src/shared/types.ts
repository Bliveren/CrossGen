export type WorkMode = "generate" | "edit" | "inpaint";

export type ProviderKind = "openai" | "gemini" | "custom";

export type FocusedLaunchId = "gpt-image-2" | "nano-banana-3" | "general";

export type ImageQuality = "auto" | "low" | "medium" | "high";

export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageBackground = "auto" | "opaque";

export type ModerationMode = "auto" | "low";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export type MediaKind = "image" | "animated-gif" | "video";

export type QueueSource = "desktop" | "cli" | "mcp";

export type QueueExecutionKind = "sync-provider" | "remote-poll" | "local-cpu";

export type QueueErrorCategory = "transient" | "auth" | "quota" | "safety" | "cancelled" | "unsupported" | "unknown";

export type QueueStage =
  | "queued"
  | "claiming"
  | "calling_provider"
  | "awaiting_remote"
  | "downloading"
  | "postprocessing"
  | "finalizing";

export type ImageCapabilityContractKind =
  | "openai-image"
  | "gemini-generate-content"
  | "openai-compatible-minimal"
  | "provider-native"
  | "local-workflow";

export type ImageCapabilityConfidence = "verified" | "discovered" | "assumed" | "unknown";

export type VideoRouteStrategy =
  | "openai-videos"
  | "openai-compatible-video-generations"
  | "provider-native"
  | "none"
  | "unknown";

export interface ImageModelCapabilities {
  generate: boolean;
  edit: boolean;
  inpaint: "exact-mask" | "guided-region" | false;
  referenceImages: boolean;
  maxReferenceImages: number;
  multiTurn: boolean;
  streamingPartials: boolean;
  outputText: boolean;
  configurableOutputFormat: boolean;
  configurableResolution: "openai-size" | "gemini-resolution-aspect" | "none";
  supportsThinking: boolean;
  supportsSearchGrounding: boolean;
}

export interface ImageModelCapabilityContract extends ImageModelCapabilities {
  asyncJob: boolean;
  mediaKinds: MediaKind[];
  outputAssetKinds: MediaKind[];
  requiresPublicUrl: boolean;
  supportsBase64Input: boolean;
  maxInputImageBytes?: number;
  estimatedCostSignals: boolean;
  supportsLocalRuntime: boolean;
  animatedGif: boolean;
  video: boolean;
  videoRouteStrategy: VideoRouteStrategy;
  contract: ImageCapabilityContractKind;
  confidence: ImageCapabilityConfidence;
}

export interface FocusedModelDefinition {
  launchId: FocusedLaunchId;
  displayName: string;
  providerKind: ProviderKind;
  modelIds: string[];
  defaultModelId: string;
  capabilities: ImageModelCapabilities;
}

export interface DiscoveredModel {
  id: string;
  providerKind: ProviderKind;
  displayName?: string;
  description?: string;
  raw?: unknown;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  apiKeySaved: boolean;
  apiKeyPreview?: string;
  baseURL: string;
  enabled: boolean;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: ImageQuality;
  timeoutMs: number;
  streamingPartialsEnabled: boolean;
  discoveredModels: DiscoveredModel[];
  lastModelDiscoveryAt?: string;
  lastModelDiscoveryError?: string;
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  openAIImageRouting?: OpenAIImageRouting;
  updatedAt: string;
}

export type OpenAIImageRoute = "image-api" | "responses" | "chat-completions";

export type OpenAIImageRouteSelection = "auto" | OpenAIImageRoute;

export interface OpenAIImageRouteProbe {
  route: OpenAIImageRoute;
  mode: "generate" | "edit";
  endpoint: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}

export interface OpenAIImageRouting {
  preferredGenerateRoute?: OpenAIImageRoute;
  preferredEditRoute?: OpenAIImageRoute;
  probes: OpenAIImageRouteProbe[];
  updatedAt: string;
}

export interface ProviderConfigInput {
  providerId?: string;
  kind?: ProviderKind;
  name?: string;
  apiKey?: string;
  baseURL: string;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: ImageQuality;
  timeoutMs: number;
  streamingPartialsEnabled?: boolean;
  activeLaunchId?: FocusedLaunchId;
  activeModelId?: string;
}

export interface OpenAIImageParams {
  providerKind: "openai";
  launchId: "gpt-image-2";
  model: string;
  imageRoute: OpenAIImageRouteSelection;
  size: string;
  quality: ImageQuality;
  outputFormat: ImageFormat;
  outputCompression: number;
  background: ImageBackground;
  n: number;
  stream: boolean;
  partialImages: number;
  moderation: ModerationMode;
  timeoutMs: number;
}

export type GeminiAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";

export type GeminiResolution = "0.5K" | "1K" | "2K" | "4K";

export interface GeminiImageParams {
  providerKind: "gemini";
  launchId: "nano-banana-3";
  model: string;
  aspectRatio: GeminiAspectRatio;
  resolution: GeminiResolution;
  outputCount: number;
  thinking: boolean;
  searchGrounding: boolean;
  timeoutMs: number;
}

export interface GeneralImageParams {
  providerKind: ProviderKind;
  launchId: "general";
  model: string;
  outputCount: number;
  timeoutMs: number;
}

export type ImageParams = OpenAIImageParams | GeminiImageParams | GeneralImageParams;

export interface InputAsset {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
}

export interface ImageAsset {
  id: string;
  jobId: string;
  path: string;
  fileName: string;
  mimeType: string;
  kind?: MediaKind;
  width?: number;
  height?: number;
  sourceType: "result" | "partial" | "input" | "mask";
  createdAt: string;
  transientPreview?: {
    dataUrl: string;
  };
}

export interface GalleryAsset {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  kind?: MediaKind;
  sizeBytes: number;
  width?: number;
  height?: number;
  previewUrl?: string;
  folderId?: string | null;
  tags: string[];
  source: "import" | "result";
  createdAt: string;
  updatedAt: string;
  modifiedAt?: string;
  contentHash?: string;
  sourcePathHash?: string;
  sourceJobId?: string;
  sourceAssetId?: string;
}

export interface GalleryFolder {
  id: string;
  name: string;
  parentId?: string | null;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryFolderInput {
  name: string;
  parentId?: string | null;
  color?: string;
}

export interface GalleryAssetPatch {
  originalName?: string;
  tags?: string[];
  folderId?: string | null;
}

export interface HistoryJobPatch {
  name?: string;
  tags?: string[];
}

export interface EditedGalleryImageInput {
  dataUrl: string;
  originalName?: string;
  folderId?: string | null;
  tags?: string[];
}

export interface EditedImageDownloadRequest {
  dataUrl: string;
  suggestedName?: string;
}

export interface GalleryFolderDeleteResult {
  folders: GalleryFolder[];
  assets: GalleryAsset[];
}

export interface GallerySyncEvent {
  folders: GalleryFolder[];
  assets: GalleryAsset[];
  reason: "disk" | "mutation";
}

export type StorageKind = "history" | "gallery";

export interface StorageSettings {
  historyDir: string;
  galleryDir: string;
}

export interface StorageFolderOptions {
  syncBoth?: boolean;
}

export interface UsageDetails {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    text_tokens?: number;
    image_tokens?: number;
  };
}

export interface GenerationJob {
  id: string;
  name: string;
  tags: string[];
  providerKind: ProviderKind;
  providerId: string;
  launchId: FocusedLaunchId;
  modelId: string;
  modelDisplayName: string;
  mode: WorkMode;
  prompt: string;
  inputAssets: InputAsset[];
  maskAsset?: InputAsset;
  params: ImageParams;
  status: JobStatus;
  durationMs?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  outputs: ImageAsset[];
  usage?: UsageDetails;
  providerMetadata?: Record<string, unknown>;
}

export interface RunJobRequest {
  mode: WorkMode;
  prompt: string;
  inputPaths: string[];
  maskPath?: string;
  maskDataUrl?: string;
  params: ImageParams;
}

export interface GenerationQueueItem {
  queueId: string;
  source: QueueSource;
  providerId: string;
  request: RunJobRequest;
  status: JobStatus;
  priority: number;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  nextRunAt?: string;
  lastError?: string;
  lastErrorCategory?: QueueErrorCategory;
  lastErrorRetryable?: boolean;
  historyJobId?: string;
  outputAssetIds: string[];
  partialAssetIds: string[];
  cancelRequested: boolean;
  costConfirmed: boolean;
  workerHostId?: string;
  workerProcessId?: number;
  workerHeartbeatAt?: string;
  workerLeaseExpiresAt?: string;
  executionKind: QueueExecutionKind;
  stage: QueueStage;
  remoteJobHandle?: string;
  remoteProviderStatus?: string;
  remoteExpiresAt?: string;
  lastPollAt?: string;
  localStep?: string;
  sourceAssetIds: string[];
  outputMediaKinds: MediaKind[];
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
}

export interface GenerationQueueWorkerHost {
  hostId: string;
  kind: "desktop" | "mcp" | "cli-worker";
  processId: number;
  mode: "generate";
  heartbeatAt: string;
  leaseExpiresAt: string;
}

export interface GenerationQueueFile {
  schemaVersion: 1;
  updatedAt: string;
  items: GenerationQueueItem[];
  workerHosts: GenerationQueueWorkerHost[];
}

export type CrossGenJsonErrorCode =
  | "CONFIG_NOT_FOUND"
  | "API_KEY_MISSING"
  | "CONFIRMATION_REQUIRED"
  | "NO_LIVE_QUEUE_WORKER"
  | "CAPABILITY_UNSUPPORTED"
  | "UNSUPPORTED_IN_THIS_VERSION"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "LOCK_TIMEOUT"
  | "PATH_NOT_ALLOWED"
  | "ASSET_NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "UNKNOWN_ERROR";

export interface CrossGenJsonError {
  code: CrossGenJsonErrorCode;
  message: string;
  retryable: boolean;
  nextActions: string[];
}

export interface CrossGenJsonSuccess<TData = unknown> {
  ok: true;
  schemaVersion: 1;
  requestId: string;
  correlationId?: string;
  data: TData;
}

export interface CrossGenJsonFailure {
  ok: false;
  schemaVersion: 1;
  requestId: string;
  correlationId?: string;
  error: CrossGenJsonError;
}

export type CrossGenJsonResponse<TData = unknown> = CrossGenJsonSuccess<TData> | CrossGenJsonFailure;

export interface JobProgressEvent {
  jobId: string;
  queueId?: string;
  type: "started" | "attempt" | "partial" | "completed" | "failed";
  attemptIndex?: number;
  route?: OpenAIImageRoute;
  partialIndex?: number;
  image?: ImageAsset;
  error?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  status?: number;
  requestId?: string;
}

export interface AppSnapshot {
  appVersion: string;
  providers: ProviderConfig[];
  activeProviderId: string;
  history: GenerationJob[];
  promptTemplates: PromptTemplate[];
  galleryFolders: GalleryFolder[];
  galleryAssets: GalleryAsset[];
  storage: StorageSettings;
  draft?: WorkspaceDraft;
}

export interface DownloadRequest {
  assetPath: string;
  suggestedName: string;
}

export interface WorkspaceDraftInput {
  activeLaunchId?: FocusedLaunchId;
  activeModelId?: string;
  mode: WorkMode;
  prompt: string;
  params: ImageParams;
  inputAssets: InputAsset[];
  maskAsset?: InputAsset;
  maskDataUrl?: string;
  brushSize: number;
}

export interface WorkspaceDraft extends WorkspaceDraftInput {
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  updatedAt: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  body: string;
  tags: string[];
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateInput {
  title: string;
  body: string;
  tags?: string[];
  category?: string;
}

export interface TemplateExportFormat {
  schemaVersion: 1;
  exportedAt: string;
  templates: PromptTemplate[];
}

export type UpdatePlatform = "darwin" | "win32" | "linux" | "all";

export interface UpdateManifestAsset {
  platform: UpdatePlatform;
  arch?: string;
  url: string;
  fileName?: string;
  sha256: string;
  sizeBytes: number;
}

export interface UpdateCheckResult {
  status: "not-configured" | "current" | "available" | "error";
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checkedAt: string;
  notes?: string;
  pubDate?: string;
  asset?: UpdateManifestAsset;
  message?: string;
}

export interface UpdateInstallResult {
  version: string;
  filePath: string;
  message: string;
}

export interface AppBridge {
  getSnapshot: () => Promise<AppSnapshot>;
  saveConfig: (input: ProviderConfigInput) => Promise<ProviderConfig>;
  addProvider: (input: ProviderConfigInput) => Promise<AppSnapshot>;
  switchProvider: (providerId: string) => Promise<AppSnapshot>;
  deleteProvider: (providerId: string) => Promise<AppSnapshot>;
  discoverModels: (providerId?: string) => Promise<ProviderConfig>;
  clearApiKey: (providerId?: string) => Promise<ProviderConfig>;
  testConnection: () => Promise<ConnectionTestResult>;
  saveDraft: (input: WorkspaceDraftInput) => Promise<WorkspaceDraft>;
  clearDraft: () => Promise<void>;
  listTemplates: () => Promise<PromptTemplate[]>;
  saveTemplate: (input: PromptTemplateInput, templateId?: string) => Promise<PromptTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  importTemplates: () => Promise<{ imported: number; skipped: number }>;
  exportTemplates: (templateIds?: string[]) => Promise<string | null>;
  listGallery: () => Promise<GalleryAsset[]>;
  listGalleryFolders: () => Promise<GalleryFolder[]>;
  createGalleryFolder: (input: GalleryFolderInput) => Promise<GalleryFolder>;
  renameGalleryFolder: (id: string, input: GalleryFolderInput) => Promise<GalleryFolder>;
  moveGalleryFolder: (id: string, parentId: string | null) => Promise<GalleryFolder>;
  deleteGalleryFolder: (id: string) => Promise<GalleryFolderDeleteResult>;
  importToGallery: (paths?: string[], folderId?: string | null) => Promise<GalleryAsset[]>;
  addHistoryAssetToGallery: (assetPath: string, folderId?: string | null, tags?: string[]) => Promise<GalleryAsset | null>;
  addEditedImageToGallery: (input: EditedGalleryImageInput) => Promise<GalleryAsset | null>;
  replaceGalleryAssetImage: (id: string, input: EditedGalleryImageInput) => Promise<GalleryAsset>;
  updateGalleryAsset: (id: string, patch: GalleryAssetPatch) => Promise<GalleryAsset>;
  moveGalleryAsset: (id: string, folderId: string | null) => Promise<GalleryAsset>;
  removeGalleryAsset: (id: string) => Promise<GalleryAsset[]>;
  pickGalleryAsset: (id: string) => Promise<InputAsset>;
  selectImages: () => Promise<InputAsset[]>;
  getDroppedFilePaths: (files: File[]) => string[];
  importImages: (paths: string[]) => Promise<InputAsset[]>;
  selectMask: () => Promise<InputAsset | null>;
  runJob: (request: RunJobRequest) => Promise<GenerationJob>;
  cancelJob: (jobId: string) => Promise<boolean>;
  downloadAsset: (request: DownloadRequest) => Promise<string | null>;
  downloadEditedImage: (request: EditedImageDownloadRequest) => Promise<string | null>;
  openAssetFolder: (assetPath: string) => Promise<void>;
  openStorageFolder: (kind: StorageKind, folderId?: string | null) => Promise<void>;
  chooseStorageFolder: (kind: StorageKind, options?: StorageFolderOptions) => Promise<AppSnapshot>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadAndInstallUpdate: () => Promise<UpdateInstallResult>;
  deleteJob: (jobId: string) => Promise<GenerationJob[]>;
  updateHistoryJob: (jobId: string, patch: HistoryJobPatch) => Promise<GenerationJob>;
  clearHistory: () => Promise<GenerationJob[]>;
  onJobEvent: (callback: (event: JobProgressEvent) => void) => () => void;
  onGalleryEvent: (callback: (event: GallerySyncEvent) => void) => () => void;
}
