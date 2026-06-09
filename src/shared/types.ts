export type WorkMode = "generate" | "edit" | "inpaint";

export type ProviderKind = "openai" | "gemini" | "custom";

export type FocusedLaunchId = "gpt-image-2" | "nano-banana-3" | "general";

export type ImageQuality = "auto" | "low" | "medium" | "high";

export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageBackground = "auto" | "opaque";

export type ModerationMode = "auto" | "low";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface ImageModelCapabilities {
  generate: boolean;
  edit: boolean;
  inpaint: "exact-mask" | "guided-region" | false;
  referenceImages: boolean;
  multiTurn: boolean;
  streamingPartials: boolean;
  outputText: boolean;
  configurableOutputFormat: boolean;
  configurableResolution: "openai-size" | "gemini-resolution-aspect" | "none";
  supportsThinking: boolean;
  supportsSearchGrounding: boolean;
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
  discoveredModels: DiscoveredModel[];
  lastModelDiscoveryAt?: string;
  lastModelDiscoveryError?: string;
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  updatedAt: string;
}

export interface ProviderConfigInput {
  kind?: ProviderKind;
  apiKey?: string;
  baseURL: string;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: ImageQuality;
  timeoutMs: number;
  activeLaunchId?: FocusedLaunchId;
  activeModelId?: string;
}

export interface OpenAIImageParams {
  providerKind: "openai";
  launchId: "gpt-image-2";
  model: string;
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
  width?: number;
  height?: number;
}

export interface ImageAsset {
  id: string;
  jobId: string;
  path: string;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
  sourceType: "result" | "partial" | "input" | "mask";
  createdAt: string;
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
}

export interface RunJobRequest {
  mode: WorkMode;
  prompt: string;
  inputPaths: string[];
  maskPath?: string;
  maskDataUrl?: string;
  params: ImageParams;
}

export interface JobProgressEvent {
  jobId: string;
  type: "started" | "partial" | "completed" | "failed";
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
  config: ProviderConfig;
  history: GenerationJob[];
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

export type UpdatePlatform = "darwin" | "win32" | "linux" | "all";

export interface UpdateManifestAsset {
  platform: UpdatePlatform;
  arch?: string;
  url: string;
  fileName?: string;
  sha256: string;
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
  clearApiKey: () => Promise<ProviderConfig>;
  testConnection: () => Promise<ConnectionTestResult>;
  saveDraft: (input: WorkspaceDraftInput) => Promise<WorkspaceDraft>;
  clearDraft: () => Promise<void>;
  selectImages: () => Promise<InputAsset[]>;
  selectMask: () => Promise<InputAsset | null>;
  runJob: (request: RunJobRequest) => Promise<GenerationJob>;
  downloadAsset: (request: DownloadRequest) => Promise<string | null>;
  openAssetFolder: (assetPath: string) => Promise<void>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadAndInstallUpdate: () => Promise<UpdateInstallResult>;
  deleteJob: (jobId: string) => Promise<GenerationJob[]>;
  clearHistory: () => Promise<GenerationJob[]>;
  onJobEvent: (callback: (event: JobProgressEvent) => void) => () => void;
}
