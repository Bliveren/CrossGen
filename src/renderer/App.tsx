import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Brush,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clipboard,
  Download,
  FileDown,
  FileUp,
  Eraser,
  FolderOpen,
  ImagePlus,
  KeyRound,
  Languages,
  Loader2,
  Maximize2,
  Paintbrush,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Plus,
  Wand2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  DEFAULT_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GENERAL_IMAGE_PARAMS,
  DEFAULT_GEMINI_IMAGE_PARAMS,
  DEFAULT_IMAGE_PARAMS,
  GEMINI_ASPECT_RATIO_OPTIONS,
  GEMINI_RESOLUTION_OPTIONS,
  MAX_GPT_IMAGE_INPUTS,
  maskMimeTypeForSource,
  mimeTypeFromDataUrl,
  validateMaskMimeType,
  validateMaskSourceFormat,
  getValidationError,
  isGeminiImageParams,
  isGeneralImageParams,
  isOpenAIImageParams,
  validateGptImage2Size
} from "../shared/validation";
import type {
  AppSnapshot,
  FocusedLaunchId,
  GeneralImageParams,
  GenerationJob,
  GeminiAspectRatio,
  GeminiImageParams,
  GeminiResolution,
  ImageAsset,
  ImageBackground,
  ImageFormat,
  ImageParams,
  ImageQuality,
  InputAsset,
  ModerationMode,
  OpenAIImageParams,
  PromptTemplate,
  PromptTemplateInput,
  ProviderConfig,
  ProviderKind,
  WorkMode,
  UpdateCheckResult,
  WorkspaceDraft
} from "../shared/types";
import {
  FOCUSED_MODEL_CATALOG,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID,
  generalFallbackSupportsReferenceImages,
  getFocusedModelDefinition,
  getGeneralImageModelCandidate,
  isGeneralFallbackProvider,
  isPotentialGeneralImageModel,
  normalizeModelId
} from "../shared/modelCatalog";
import { getInitialLanguage, localizeValidationMessage, translations, type Language, type UiCopy } from "./i18n";

type NoticeKind = "info" | "success" | "error";

interface Notice {
  kind: NoticeKind;
  text: string;
}

interface MaskCheck {
  ok: boolean;
  message: string;
}

interface ConnectionCheck {
  status: "idle" | "checking" | "ok" | "error";
  message?: string;
}

const sizePresets = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x1152", "2048x2048", "3840x2160", "2160x3840"];
const qualityOptions: ImageQuality[] = ["auto", "low", "medium", "high"];
const formatOptions: ImageFormat[] = ["png", "jpeg", "webp"];
const backgroundOptions: ImageBackground[] = ["auto", "opaque"];
const moderationOptions: ModerationMode[] = ["auto", "low"];
const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.25;
const DEFAULT_SIDEBAR_WIDTH = 310;
const DEFAULT_HISTORY_WIDTH = 330;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 430;
const MIN_HISTORY_WIDTH = 280;
const MAX_HISTORY_WIDTH = 460;
const MIN_WORKSPACE_WIDTH = 680;
const RESIZER_WIDTH = 12;
const HISTORY_COLLAPSED_LIMIT = 6;
const DEFAULT_HISTORY_MODEL_DISPLAY = "GPT Image 2";

type TabMode = "text2img" | "img2img";

function tabModeForWorkMode(mode: WorkMode): TabMode {
  return mode === "generate" ? "text2img" : "img2img";
}

interface HistoryModelDetails {
  modelDisplayName: string;
  modelTitle: string;
  providerDisplayName?: string;
  providerTitle?: string;
  searchText: string;
}

interface LaunchButtonState {
  launchId: FocusedLaunchId;
  displayName: string;
  modelId: string;
  providerKind: ProviderKind;
  available: boolean;
  reason: string;
}

interface LaunchModelOption {
  id: string;
  providerKind: ProviderKind;
  displayName: string;
}

type OpenAIParamPatch = Partial<Omit<OpenAIImageParams, "providerKind" | "launchId">>;
type GeminiParamPatch = Partial<Omit<GeminiImageParams, "providerKind" | "launchId">>;

const fallbackConfig: ProviderConfig = {
  id: "default",
  kind: "openai",
  name: "OpenAI",
  apiKeySaved: false,
  apiKeyPreview: undefined,
  baseURL: DEFAULT_BASE_URL,
  enabled: true,
  defaultModel: DEFAULT_IMAGE_PARAMS.model,
  defaultSize: DEFAULT_IMAGE_PARAMS.size,
  defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
  timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
  discoveredModels: [],
  activeLaunchId: DEFAULT_IMAGE_PARAMS.launchId,
  activeModelId: DEFAULT_IMAGE_PARAMS.model,
  updatedAt: new Date(0).toISOString()
};

const fallbackSnapshot: AppSnapshot = {
  appVersion: "0.0.0",
  providers: [fallbackConfig],
  activeProviderId: fallbackConfig.id,
  history: [],
  promptTemplates: []
};

function getBridge() {
  return window.image2tools;
}

function assetSource(asset?: ImageAsset | InputAsset | null): string | undefined {
  if (!asset) return undefined;
  if ("dataUrl" in asset && asset.dataUrl) return asset.dataUrl;
  if ("fileName" in asset && asset.path) return `image2tools-asset://image?path=${encodeURIComponent(asset.path)}`;
  if (asset.path) return `file://${encodeURI(asset.path)}`;
  return undefined;
}

function getResultAssets(job?: GenerationJob | null): ImageAsset[] {
  return job?.outputs.filter((asset) => asset.sourceType === "result") ?? [];
}

function getBestResult(job?: GenerationJob | null): ImageAsset | undefined {
  const results = getResultAssets(job);
  return results[results.length - 1] ?? job?.outputs[job.outputs.length - 1];
}

function getJobError(job?: GenerationJob | null): string | null {
  return job?.status === "failed" && job.error ? job.error : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function stringFromRuntime(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function runtimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function modelLabelFromId(value: string): string {
  if (value === "gpt-image-2") return DEFAULT_HISTORY_MODEL_DISPLAY;
  return value;
}

function providerLabelFromKind(value: string): string {
  if (value === "openai") return "OpenAI";
  if (value === "gemini") return "Gemini";
  if (value === "custom") return "Custom";
  return value;
}

function apiAccessDisplayName(config: ProviderConfig, fallback: string): string {
  return config.name.trim() || providerLabelFromKind(config.kind) || fallback;
}

function summarizeBaseURL(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`.replace(/\/$/, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function defaultBaseURLForProvider(kind: ProviderKind, currentBaseURL: string): string {
  if (kind === "openai") return DEFAULT_BASE_URL;
  if (kind === "gemini") return DEFAULT_GEMINI_BASE_URL;
  return currentBaseURL || DEFAULT_BASE_URL;
}

function defaultModelForProvider(kind: ProviderKind): string {
  if (kind === "gemini") return NANO_BANANA_3_MODEL_ID;
  if (kind === "custom") return "";
  return GPT_IMAGE_2_MODEL_ID;
}

function defaultLaunchForProvider(kind: ProviderKind): FocusedLaunchId {
  if (kind === "gemini") return NANO_BANANA_3_LAUNCH_ID;
  if (kind === "custom") return GENERAL_LAUNCH_ID;
  return GPT_IMAGE_2_LAUNCH_ID;
}

function createOpenAIParams(modelId: string, current: ImageParams, config?: ProviderConfig): OpenAIImageParams {
  const base = isOpenAIImageParams(current) ? current : DEFAULT_IMAGE_PARAMS;
  return normalizeOpenAIParamsForOutputCount({
    ...DEFAULT_IMAGE_PARAMS,
    ...base,
    providerKind: "openai",
    launchId: GPT_IMAGE_2_LAUNCH_ID,
    model: modelId || GPT_IMAGE_2_MODEL_ID,
    size: config?.defaultSize ?? base.size,
    quality: config?.defaultQuality ?? base.quality,
    timeoutMs: config?.timeoutMs ?? base.timeoutMs
  });
}

function normalizeOpenAIParamsForOutputCount(params: OpenAIImageParams): OpenAIImageParams {
  if (!params.stream || params.n <= 1) return params;
  return {
    ...params,
    stream: false,
    partialImages: 0
  };
}

function normalizeParamsForOutputCount(params: ImageParams): ImageParams {
  return isOpenAIImageParams(params) ? normalizeOpenAIParamsForOutputCount(params) : params;
}

function createGeminiParams(modelId: string, current: ImageParams, config?: ProviderConfig): GeminiImageParams {
  const base = isGeminiImageParams(current) ? current : DEFAULT_GEMINI_IMAGE_PARAMS;
  return {
    ...DEFAULT_GEMINI_IMAGE_PARAMS,
    ...base,
    providerKind: "gemini",
    launchId: NANO_BANANA_3_LAUNCH_ID,
    model: modelId || NANO_BANANA_3_MODEL_ID,
    timeoutMs: config?.timeoutMs ?? base.timeoutMs
  };
}

function createGeneralParams(providerKind: ProviderKind, modelId: string, current: ImageParams, config?: ProviderConfig): GeneralImageParams {
  const base = isGeneralImageParams(current) ? current : DEFAULT_GENERAL_IMAGE_PARAMS;
  return {
    ...DEFAULT_GENERAL_IMAGE_PARAMS,
    ...base,
    providerKind,
    launchId: GENERAL_LAUNCH_ID,
    model: modelId || base.model || config?.activeModelId || config?.defaultModel || "",
    timeoutMs: config?.timeoutMs ?? base.timeoutMs
  };
}

function createLaunchParams(launchId: FocusedLaunchId, modelId: string, current: ImageParams, providerKind: ProviderKind, config?: ProviderConfig): ImageParams {
  if (launchId === NANO_BANANA_3_LAUNCH_ID) {
    return createGeminiParams(modelId, current, config);
  }
  if (launchId === GENERAL_LAUNCH_ID) {
    return createGeneralParams(providerKind, modelId, current, config);
  }
  return createOpenAIParams(modelId, current, config);
}

function createParamsForConfig(config: ProviderConfig, current: ImageParams): ImageParams {
  if (config.activeLaunchId === NANO_BANANA_3_LAUNCH_ID) {
    return createGeminiParams(config.activeModelId || config.defaultModel || NANO_BANANA_3_MODEL_ID, current, config);
  }
  if (config.activeLaunchId === GENERAL_LAUNCH_ID) {
    return createGeneralParams(config.kind, config.activeModelId || config.defaultModel, current, config);
  }
  return createOpenAIParams(config.activeModelId || config.defaultModel || GPT_IMAGE_2_MODEL_ID, current, config);
}

function defaultModelForConfigSave(kind: ProviderKind, params: ImageParams, config: ProviderConfig): string {
  if (isGeneralImageParams(params)) return params.model;
  if (kind === "openai") {
    return isOpenAIImageParams(params) ? params.model : GPT_IMAGE_2_MODEL_ID;
  }
  if (kind === "gemini") {
    return isGeminiImageParams(params) ? params.model : NANO_BANANA_3_MODEL_ID;
  }
  if (kind === config.kind && config.defaultModel) return config.defaultModel;
  return defaultModelForProvider(kind);
}

function defaultSizeForConfigSave(params: ImageParams, config: ProviderConfig): string {
  return isOpenAIImageParams(params) ? params.size : config.defaultSize || DEFAULT_IMAGE_PARAMS.size;
}

function defaultQualityForConfigSave(params: ImageParams, config: ProviderConfig): ImageQuality {
  return isOpenAIImageParams(params) ? params.quality : config.defaultQuality || DEFAULT_IMAGE_PARAMS.quality;
}

function runtimeSelectionError(params: ImageParams, config: ProviderConfig, copy: UiCopy): string | null {
  if (isOpenAIImageParams(params)) {
    return config.activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ? null : copy.selectLaunchToRun("GPT Image 2");
  }
  if (isGeminiImageParams(params)) {
    return config.activeLaunchId === NANO_BANANA_3_LAUNCH_ID ? null : copy.selectLaunchToRun("Nano Banana 3");
  }
  if (!isGeneralImageParams(params)) return copy.generalRuntimeUnsupported;
  if (config.activeLaunchId !== GENERAL_LAUNCH_ID) return copy.selectLaunchToRun("General");
  if (!isGeneralFallbackProvider(params.providerKind)) return copy.generalRuntimeUnsupported;
  if (!params.model.trim()) return copy.launchUnavailableNoImageModels;
  return null;
}

function generalRuntimeNotice(providerKind: ProviderKind, copy: UiCopy): string {
  if (!isGeneralFallbackProvider(providerKind)) return copy.generalRuntimeUnsupported;
  return generalFallbackSupportsReferenceImages(providerKind) ? copy.generalReferenceRuntime : copy.generalPromptOnlyRuntime;
}

function patchConfigActiveLaunch(config: ProviderConfig, job: GenerationJob): ProviderConfig {
  return {
    ...config,
    activeLaunchId: job.launchId,
    activeModelId: job.modelId,
    defaultModel: job.modelId || config.defaultModel,
    timeoutMs: job.params.timeoutMs
  };
}

function paramsNotice(params: ImageParams, restoredText: string, copy: UiCopy): string {
  if (isGeneralImageParams(params) && !isGeneralFallbackProvider(params.providerKind)) return `${restoredText} ${copy.generalRuntimeUnsupported}`;
  return restoredText;
}

function updateCustomSizeFromParams(params: ImageParams, setCustomSize: (value: string) => void) {
  if (isOpenAIImageParams(params) && !sizePresets.includes(params.size)) {
    setCustomSize(params.size);
  }
}

function getLaunchButtonStates(config: ProviderConfig, copy: UiCopy): LaunchButtonState[] {
  const hasDiscovery = config.discoveredModels.length > 0;
  return FOCUSED_MODEL_CATALOG.map((definition) => {
    const modelOptions = getLaunchModelOptions(config, definition.launchId);
    const preferredModel = getPreferredLaunchModel(config, definition.launchId, modelOptions);
    const modelId = preferredModel?.id ?? definition.defaultModelId;
    const providerKind = preferredModel?.providerKind ?? definition.providerKind;
    let available = false;
    let reason = "";

    if (!config.apiKeySaved) {
      reason = copy.launchUnavailableNoKey;
    } else if (config.lastModelDiscoveryError) {
      reason = config.lastModelDiscoveryError;
    } else if (!hasDiscovery) {
      reason = copy.launchUnavailableNoDiscovery;
    } else if (definition.launchId === GENERAL_LAUNCH_ID) {
      if (!isGeneralFallbackProvider(config.kind)) {
        reason = copy.generalRuntimeUnsupported;
      } else if (!preferredModel) {
        reason = copy.launchUnavailableNoImageModels;
      } else {
        available = true;
        reason = copy.launchAvailable;
      }
    } else if (preferredModel) {
      available = true;
      reason = copy.launchAvailable;
    } else {
      reason = copy.launchUnavailableModel(definition.modelIds.join(", "));
    }

    return {
      launchId: definition.launchId,
      displayName: definition.displayName,
      modelId,
      providerKind,
      available,
      reason
    };
  });
}

function getLaunchModelOptions(config: ProviderConfig, launchId: FocusedLaunchId): LaunchModelOption[] {
  if (launchId === GENERAL_LAUNCH_ID) {
    return getGeneralLaunchModelOptions(config);
  }
  const definition = FOCUSED_MODEL_CATALOG.find((item) => item.launchId === launchId);
  if (!definition) return [];
  const normalizedModelIds = new Set(definition.modelIds.map(normalizeModelId));
  return config.discoveredModels
    .filter((model) => normalizedModelIds.has(normalizeModelId(model.id)))
    .map(toLaunchModelOption);
}

function getPreferredLaunchModel(config: ProviderConfig, launchId: FocusedLaunchId, options: LaunchModelOption[]): LaunchModelOption | undefined {
  if (config.activeLaunchId === launchId) {
    const activeModel = options.find((model) => normalizeModelId(model.id) === normalizeModelId(config.activeModelId));
    if (activeModel) return activeModel;
  }
  return options[0];
}

function getGeneralLaunchModelOptions(config: ProviderConfig): LaunchModelOption[] {
  const preferred = getGeneralImageModelCandidate(config.discoveredModels, config.kind);
  const candidates = config.discoveredModels.filter((model) => isGeneralFallbackProvider(model.providerKind) && isPotentialGeneralImageModel(model));
  const ordered = preferred ? [preferred, ...candidates.filter((model) => model !== preferred)] : candidates;
  return ordered.map(toLaunchModelOption);
}

function toLaunchModelOption(model: { id: string; providerKind: ProviderKind; displayName?: string }): LaunchModelOption {
  return {
    id: model.id,
    providerKind: model.providerKind,
    displayName: model.displayName?.trim() || model.id
  };
}

function modeLabelsForParams(copy: UiCopy, params: ImageParams): UiCopy["modes"] {
  if (inpaintCapabilityForParams(params) !== "guided-region") return copy.modes;
  return {
    ...copy.modes,
    inpaint: copy.guidedRegionMode
  };
}

function inpaintCapabilityForParams(params: ImageParams) {
  return getFocusedModelDefinition(params.launchId)?.capabilities.inpaint ?? false;
}

function connectionStatusLabel(check: ConnectionCheck, copy: UiCopy): string {
  if (check.status === "checking") return copy.connectionChecking;
  if (check.status === "ok") return copy.connectionOk;
  if (check.status === "error") return copy.connectionError;
  return copy.connectionIdle;
}

function discoverySummary(config: ProviderConfig, copy: UiCopy): string {
  return config.lastModelDiscoveryError ?? copy.discoveredModelsCount(config.discoveredModels.length);
}

function getHistoryModelDetails(job: GenerationJob): HistoryModelDetails {
  const jobRecord = runtimeRecord(job);
  const paramsRecord = runtimeRecord(job.params);
  const modelDisplayName = stringFromRuntime(jobRecord.modelDisplayName);
  const paramsModel = stringFromRuntime(paramsRecord.model);
  const modelId = stringFromRuntime(jobRecord.modelId);
  const launchId = stringFromRuntime(jobRecord.launchId) ?? stringFromRuntime(jobRecord.activeLaunchId) ?? stringFromRuntime(paramsRecord.launchId);
  const providerKind = stringFromRuntime(jobRecord.providerKind) ?? stringFromRuntime(paramsRecord.providerKind);
  const rawModelDisplay = modelDisplayName ?? paramsModel ?? DEFAULT_HISTORY_MODEL_DISPLAY;
  const displayModel = modelLabelFromId(rawModelDisplay);
  const providerDisplayName = providerKind ? providerLabelFromKind(providerKind) : undefined;
  const searchText = [
    displayModel,
    rawModelDisplay,
    modelDisplayName,
    paramsModel,
    modelId,
    launchId,
    providerKind,
    providerDisplayName
  ]
    .filter(Boolean)
    .join(" ");

  return {
    modelDisplayName: displayModel,
    modelTitle: modelId && modelId !== rawModelDisplay ? `${displayModel} (${modelId})` : displayModel,
    providerDisplayName,
    providerTitle: providerKind && providerDisplayName !== providerKind ? `${providerDisplayName} (${providerKind})` : providerDisplayName,
    searchText
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  const stored = window.localStorage.getItem(key);
  const parsed = stored ? Number(stored) : fallback;
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

async function loadImage(dataUrl: string, copy: UiCopy): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(copy.validation.cannotReadImage));
    image.src = dataUrl;
  });
}

async function inspectMask(
  sourceDataUrl: string | undefined,
  maskDataUrl: string | undefined,
  copy: UiCopy,
  maskMimeType?: string,
  sourceMimeType?: string
): Promise<MaskCheck> {
  if (!maskDataUrl) {
    return { ok: false, message: copy.validation.paintOrUploadMask };
  }

  const maskType = validateMaskMimeType(maskMimeType);
  if (!maskType.ok) return { ok: false, message: localizeValidationMessage(maskType.message, copy) ?? copy.validation.maskFormatInvalid };

  const sourceFormat = validateMaskSourceFormat(sourceMimeType, maskMimeType);
  if (!sourceFormat.ok) return { ok: false, message: localizeValidationMessage(sourceFormat.message, copy) ?? copy.validation.maskFormatInvalid };

  const mask = await loadImage(maskDataUrl, copy);
  if (sourceDataUrl) {
    const source = await loadImage(sourceDataUrl, copy);
    if (source.naturalWidth !== mask.naturalWidth || source.naturalHeight !== mask.naturalHeight) {
      return { ok: false, message: copy.validation.maskSizeMismatch };
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = mask.naturalWidth;
  canvas.height = mask.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { ok: false, message: copy.validation.cannotInspectMaskAlpha };
  }

  context.drawImage(mask, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparentPixels = 0;
  let paintedPixels = 0;

  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index];
    if (alpha < 255) transparentPixels += 1;
    if (alpha > 0) paintedPixels += 1;
    if (transparentPixels > 0 && paintedPixels > 0) break;
  }

  if (paintedPixels === 0) {
    return { ok: false, message: copy.validation.maskEmpty };
  }

  if (transparentPixels === 0) {
    return { ok: false, message: copy.validation.maskNeedsAlpha };
  }

  return { ok: true, message: copy.validation.maskLooksValid };
}

export function App() {
  const bridge = getBridge();
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const copy = translations[language];
  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);
  const [tabMode, setTabMode] = useState<TabMode>("text2img");
  const [prompt, setPrompt] = useState("A clean product photo of a matte black travel mug on a brushed steel counter");
  const [params, setParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS);
  const modeLabels = useMemo(() => modeLabelsForParams(copy, params), [copy, params]);
  const [apiKey, setApiKey] = useState("");
  const [apiAccessName, setApiAccessName] = useState("OpenAI");
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [isApiAccessOpen, setIsApiAccessOpen] = useState(false);
  const [isAddingApiAccess, setIsAddingApiAccess] = useState(false);
  const [newApiAccessKind, setNewApiAccessKind] = useState<ProviderKind>("openai");
  const [newApiAccessName, setNewApiAccessName] = useState("");
  const [newApiAccessBaseURL, setNewApiAccessBaseURL] = useState(DEFAULT_BASE_URL);
  const [newApiAccessKey, setNewApiAccessKey] = useState("");
  const [customSize, setCustomSize] = useState("2048x1152");
  const [inputAssets, setInputAssets] = useState<InputAsset[]>([]);
  const [maskAsset, setMaskAsset] = useState<InputAsset | null>(null);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [maskCheck, setMaskCheck] = useState<MaskCheck | null>(null);
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [partialImages, setPartialImages] = useState<ImageAsset[]>([]);
  const [notice, setNotice] = useState<Notice>({
    kind: bridge ? "info" : "error",
    text: bridge ? copy.notices.ready : copy.notices.browserPreview
  });
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false);
  const [isClearingApiKey, setIsClearingApiKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck>({ status: "idle" });
  const [isRunning, setIsRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openLaunchMenuId, setOpenLaunchMenuId] = useState<FocusedLaunchId | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historySort, setHistorySort] = useState<"newest" | "oldest">("newest");
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateTagFilter, setTemplateTagFilter] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [isClearHistoryConfirmOpen, setIsClearHistoryConfirmOpen] = useState(false);
  const [brushSize, setBrushSize] = useState(72);
  const [isPainting, setIsPainting] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [hasUserChangedDraft, setHasUserChangedDraft] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isReferenceDragOver, setIsReferenceDragOver] = useState(false);
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, number>>({});
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth("image2tools.sidebarWidth", DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
  const [historyWidth, setHistoryWidth] = useState(() => readStoredWidth("image2tools.historyWidth", DEFAULT_HISTORY_WIDTH, MIN_HISTORY_WIDTH, MAX_HISTORY_WIDTH));
  const [resizingColumn, setResizingColumn] = useState<"sidebar" | "history" | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; assetId: string; jobPrompt: string } | null>(null);

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const paintedDuringStrokeRef = useRef(false);
  const hasAutoTestedConnectionRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null);

  const activeConfig = snapshot.providers.find(p => p.id === snapshot.activeProviderId) ?? snapshot.providers[0];
  const sourceAsset = inputAssets[0];
  const sourcePreview = assetSource(sourceAsset);
  const maskPreview = maskDataUrl ?? assetSource(maskAsset);
  const activeResults = getResultAssets(activeJob);
  const selectedResult = activeResults.find((asset) => asset.id === selectedResultId);
  const activeImage = selectedResult ?? getBestResult(activeJob) ?? partialImages[partialImages.length - 1];
  const activeImageSource = assetSource(activeImage);
  const activeJobError = getJobError(activeJob);
  const openAIParams = isOpenAIImageParams(params) ? params : null;
  const geminiParams = isGeminiImageParams(params) ? params : null;
  const generalParams = isGeneralImageParams(params) ? params : null;
  const isGeneralMode = Boolean(generalParams);
  const generalAllowsReferences = generalParams ? generalFallbackSupportsReferenceImages(generalParams.providerKind) : false;
  const hasMask = Boolean(maskAsset || maskDataUrl);
  // 内部 WorkMode 由 UI 的 tabMode 推导：text2img→generate；img2img 有蒙版→inpaint，否则→edit。
  // General 模式仍按既有规则（支持参考图且已选图→edit，否则 generate）。
  const requestMode: WorkMode = generalParams
    ? generalAllowsReferences && inputAssets.length > 0
      ? "edit"
      : "generate"
    : tabMode === "text2img"
      ? "generate"
      : hasMask
        ? "inpaint"
        : "edit";
  const showReferenceTools = generalParams ? generalAllowsReferences : tabMode === "img2img";
  const generalModeNotice = generalParams ? generalRuntimeNotice(generalParams.providerKind, copy) : copy.generalRuntimeUnsupported;
  const activeInpaintCapability = inpaintCapabilityForParams(params);
  const usesExactMask = activeInpaintCapability === "exact-mask";
  const sizeSelectValue = openAIParams && sizePresets.includes(openAIParams.size) ? openAIParams.size : "custom";
  const previewZoomPercent = Math.round(previewZoom * 100);
  const apiKeyPlaceholder = activeConfig.apiKeyPreview ?? (activeConfig.apiKeySaved ? copy.savedLocally : copy.pasteApiKey);
  const launchButtons = useMemo(() => getLaunchButtonStates(activeConfig, copy), [copy, activeConfig]);
  const activeLaunchDisplay = launchButtons.find((button) => button.launchId === activeConfig.activeLaunchId)?.displayName ?? modelLabelFromId(activeConfig.activeModelId);
  const connectionLabel = connectionStatusLabel(connectionCheck, copy);
  const connectionTitle = connectionCheck.status === "error" && connectionCheck.message ? copy.connectionErrorDetail(connectionCheck.message) : connectionLabel;
  const connectionErrorText = connectionCheck.status === "error" && connectionCheck.message ? copy.connectionErrorDetail(connectionCheck.message) : null;
  const discoveryText = discoverySummary(activeConfig, copy);
  const maxSidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - historyWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
  const maxHistoryWidth = Math.min(MAX_HISTORY_WIDTH, Math.max(MIN_HISTORY_WIDTH, window.innerWidth - sidebarWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    const matched = !query
      ? snapshot.history
      : snapshot.history.filter((job) => {
          const modelDetails = getHistoryModelDetails(job);
          const haystack = `${job.prompt} ${job.mode} ${job.status} ${job.error ?? ""} ${job.createdAt} ${modelDetails.searchText}`.toLowerCase();
          return haystack.includes(query);
        });
    const sorted = [...matched];
    if (historySort === "oldest") {
      sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    } else {
      sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    return sorted;
  }, [historySearch, historySort, snapshot.history]);
  const templateTagsAvailable = useMemo(() => {
    const tags = new Set<string>();
    snapshot.promptTemplates.forEach((template) => template.tags.forEach((tag) => tags.add(tag)));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [snapshot.promptTemplates]);
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return snapshot.promptTemplates.filter((template) => {
      const matchesTag = !templateTagFilter || template.tags.includes(templateTagFilter);
      if (!matchesTag) return false;
      if (!query) return true;
      const haystack = `${template.title} ${template.body} ${template.tags.join(" ")} ${template.category ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [snapshot.promptTemplates, templateSearch, templateTagFilter]);
  const hasHistoryOverflow = filteredHistory.length > HISTORY_COLLAPSED_LIMIT;
  const visibleHistory = isHistoryExpanded ? filteredHistory : filteredHistory.slice(0, HISTORY_COLLAPSED_LIMIT);
  const isSearchingHistory = historySearch.trim().length > 0;

  const modeError = useMemo(() => {
    if (generalParams && !generalFallbackSupportsReferenceImages(generalParams.providerKind) && inputAssets.length > 0) {
      return copy.validation.generalPromptOnly;
    }
    if (requestMode === "edit" && inputAssets.length === 0) return copy.validation.addReference;
    if (requestMode === "inpaint" && inputAssets.length === 0) return copy.validation.addSource;
    if (openAIParams && requestMode !== "generate" && inputAssets.length > MAX_GPT_IMAGE_INPUTS) {
      return copy.validation.maxInputs(MAX_GPT_IMAGE_INPUTS);
    }
    if (usesExactMask && requestMode === "inpaint" && maskCheck && !maskCheck.ok) return maskCheck.message;
    return null;
  }, [copy, generalParams, inputAssets.length, maskCheck, openAIParams, requestMode, usesExactMask]);

  const launchRuntimeError = runtimeSelectionError(params, activeConfig, copy);
  const validationError = launchRuntimeError ?? localizeValidationMessage(getValidationError(params, prompt), copy) ?? modeError;
  const canRun = !validationError && !isRunning;

  useEffect(() => {
    window.localStorage.setItem("image2tools.language", language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem("image2tools.sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem("image2tools.historyWidth", String(historyWidth));
  }, [historyWidth]);

  useEffect(() => {
    if (!resizingColumn) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (resizingColumn === "sidebar") {
        const nextMax = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - historyWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
        setSidebarWidth(clamp(event.clientX, MIN_SIDEBAR_WIDTH, nextMax));
      } else {
        const nextMax = Math.min(MAX_HISTORY_WIDTH, Math.max(MIN_HISTORY_WIDTH, window.innerWidth - sidebarWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
        setHistoryWidth(clamp(window.innerWidth - event.clientX, MIN_HISTORY_WIDTH, nextMax));
      }
    };
    const stopResizing = () => setResizingColumn(null);

    document.body.classList.add("is-resizing-columns");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.classList.remove("is-resizing-columns");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [historyWidth, resizingColumn, sidebarWidth]);

  useEffect(() => {
    if (!bridge) return;
    setIsCheckingUpdate(true);
    bridge
      .checkForUpdates()
      .then((result) => setUpdateCheck(result))
      .catch((error) =>
        setUpdateCheck({
          status: "error",
          currentVersion: snapshot.appVersion,
          updateAvailable: false,
          checkedAt: new Date().toISOString(),
          message: normalizeNotice(error)
        })
      )
      .finally(() => setIsCheckingUpdate(false));
  }, []);

  useEffect(() => {
    setSelectedResultId((current) => {
      if (activeResults.length === 0) return null;
      if (current && activeResults.some((asset) => asset.id === current)) return current;
      return activeResults[activeResults.length - 1]?.id ?? null;
    });
  }, [activeJob?.id, activeJob?.outputs]);

  useEffect(() => {
    setPreviewZoom(1);
  }, [activeImageSource]);

  useEffect(() => {
    if (!generalParams) return;
    if (!generalFallbackSupportsReferenceImages(generalParams.providerKind)) {
      if (inputAssets.length > 0) {
        setInputAssets([]);
      }
      if (maskAsset || maskDataUrl) {
        setMaskAsset(null);
        setMaskDataUrl(null);
      }
      return;
    }
    if (maskAsset || maskDataUrl) {
      setMaskAsset(null);
      setMaskDataUrl(null);
    }
  }, [generalParams, inputAssets.length, maskAsset, maskDataUrl]);

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    if (!bridge) return;
    if (!activeConfig.apiKeySaved) {
      hasAutoTestedConnectionRef.current = false;
      setConnectionCheck({ status: "idle" });
      return;
    }
    if (hasAutoTestedConnectionRef.current) return;
    hasAutoTestedConnectionRef.current = true;
    void runConnectionTest({ silent: true });
  }, [bridge, activeConfig.apiKeySaved, activeConfig.updatedAt]);

  useEffect(() => {
    if (!bridge || !hasRestoredDraft || !hasUserChangedDraft) return;
    const timer = window.setTimeout(() => {
      bridge
        .saveDraft({
          activeLaunchId: params.launchId,
          activeModelId: params.model,
          mode: requestMode,
          prompt,
          params,
          inputAssets,
          maskAsset: maskAsset ?? undefined,
          maskDataUrl: maskDataUrl ?? undefined,
          brushSize
        })
        .then((draft) => setDraftUpdatedAt(draft.updatedAt))
        .catch((error) => setNotice({ kind: "error", text: normalizeNotice(error) }));
    }, 600);

    return () => window.clearTimeout(timer);
  }, [bridge, brushSize, hasRestoredDraft, hasUserChangedDraft, inputAssets, maskAsset, maskDataUrl, requestMode, params, prompt]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onJobEvent((event) => {
      if (event.type === "started") {
        setNotice({ kind: "info", text: copy.notices.jobStarted });
      }
      if (event.type === "partial" && event.image) {
        setPartialImages((current) => [...current, event.image as ImageAsset]);
        setNotice({ kind: "info", text: copy.notices.partialReceived(event.partialIndex ?? currentPartialLabel(partialImages.length)) });
      }
      if (event.type === "completed") {
        setNotice({ kind: "success", text: copy.notices.imageCompleted });
      }
      if (event.type === "failed") {
        setNotice({ kind: "error", text: event.error ?? copy.jobFailed });
      }
    });
  }, [bridge, copy, partialImages.length]);

  useEffect(() => {
    const source = sourcePreview;
    const mask = maskPreview;
    if (requestMode !== "inpaint" || !mask) {
      setMaskCheck(null);
      return;
    }
    if (!usesExactMask) {
      setMaskCheck({ ok: true, message: copy.validation.regionGuideReady });
      return;
    }

    let cancelled = false;
    inspectMask(source, mask, copy, maskAsset?.mimeType ?? mimeTypeFromDataUrl(mask) ?? "image/png", inputAssets[0]?.mimeType)
      .then((result) => {
        if (!cancelled) setMaskCheck(result);
      })
      .catch((error) => {
        if (!cancelled) setMaskCheck({ ok: false, message: error instanceof Error ? error.message : copy.notices.maskValidationFailed });
      });

    return () => {
      cancelled = true;
    };
  }, [copy, inputAssets, maskAsset?.mimeType, maskPreview, requestMode, sourcePreview, usesExactMask]);

  async function refreshSnapshot() {
    if (!bridge) return;
    setIsLoadingSnapshot(true);
    try {
      const next = await bridge.getSnapshot();
      const nextActiveConfig = applySnapshot(next);
      if (!hasRestoredDraft) {
        restoreDraft(next.draft, nextActiveConfig);
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  function restoreDraft(draft?: WorkspaceDraft, config = activeConfig) {
    setHasRestoredDraft(true);
    if (!draft) return;
    const restoredParams = normalizeParamsForOutputCount(draft.params);
    // 兼容 v0.2.0 旧 draft（仅存 WorkMode）：generate→text2img；edit/inpaint→img2img。
    setTabMode(tabModeForWorkMode(draft.mode));
    setPrompt(draft.prompt);
    setParams(restoredParams);
    updateCustomSizeFromParams(restoredParams, setCustomSize);
    setBaseURL(config.baseURL);
    setInputAssets(draft.inputAssets);
    setMaskAsset(isGeneralImageParams(restoredParams) ? null : draft.maskAsset ?? null);
    setMaskDataUrl(isGeneralImageParams(restoredParams) ? null : draft.maskDataUrl ?? null);
    setBrushSize(draft.brushSize);
    setDraftUpdatedAt(draft.updatedAt);
    setNotice({ kind: "info", text: paramsNotice(restoredParams, copy.notices.draftRestored(formatDate(draft.updatedAt)), copy) });
  }

  async function clearDraft() {
    if (!bridge) return;
    try {
      await bridge.clearDraft();
      setDraftUpdatedAt(null);
      setHasUserChangedDraft(false);
      setNotice({ kind: "success", text: copy.notices.draftCleared });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function resetTemplateForm() {
    setEditingTemplateId(null);
    setTemplateTitle("");
    setTemplateBody("");
    setTemplateTags("");
    setTemplateCategory("");
  }

  function editTemplate(template: PromptTemplate) {
    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateBody(template.body);
    setTemplateTags(template.tags.join(", "));
    setTemplateCategory(template.category ?? "");
    setIsTemplatesOpen(true);
  }

  function templateInputFromForm(): PromptTemplateInput {
    return {
      title: templateTitle,
      body: templateBody,
      tags: templateTags.split(",").map((tag) => tag.trim()).filter(Boolean),
      category: templateCategory.trim() || undefined
    };
  }

  async function saveTemplateFromForm() {
    if (!bridge) return;
    try {
      const template = await bridge.saveTemplate(templateInputFromForm(), editingTemplateId ?? undefined);
      setSnapshot((current) => {
        const exists = current.promptTemplates.some((item) => item.id === template.id);
        return {
          ...current,
          promptTemplates: exists
            ? current.promptTemplates.map((item) => (item.id === template.id ? template : item))
            : [template, ...current.promptTemplates]
        };
      });
      resetTemplateForm();
      setNotice({ kind: "success", text: copy.templateSaved });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function deleteTemplate(template: PromptTemplate) {
    if (!bridge) return;
    if (!window.confirm(copy.templateDeleteConfirm(template.title))) return;
    try {
      await bridge.deleteTemplate(template.id);
      setSnapshot((current) => ({ ...current, promptTemplates: current.promptTemplates.filter((item) => item.id !== template.id) }));
      if (editingTemplateId === template.id) resetTemplateForm();
      setNotice({ kind: "success", text: copy.templateDeleted });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function applyTemplate(template: PromptTemplate) {
    setPrompt(template.body);
    setHasUserChangedDraft(true);
    try {
      await bridge?.saveDraft({
        activeLaunchId: params.launchId,
        activeModelId: params.model,
        mode: requestMode,
        prompt: template.body,
        params,
        inputAssets,
        maskAsset: maskAsset ?? undefined,
        maskDataUrl: maskDataUrl ?? undefined,
        brushSize
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
      return;
    }
    setNotice({ kind: "success", text: copy.templateApplied(template.title) });
  }

  async function importTemplates() {
    if (!bridge) return;
    try {
      const result = await bridge.importTemplates();
      const importedTemplates = await bridge.listTemplates();
      setSnapshot((current) => ({ ...current, promptTemplates: importedTemplates }));
      setNotice({ kind: "success", text: copy.templateImported(result.imported, result.skipped) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function exportTemplates() {
    if (!bridge) return;
    try {
      const filePath = await bridge.exportTemplates();
      if (filePath) setNotice({ kind: "success", text: copy.templateExported(filePath) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function updateOpenAIParams(patch: OpenAIParamPatch) {
    markDraftChanged();
    setParams((current) =>
      normalizeOpenAIParamsForOutputCount({
        ...(isOpenAIImageParams(current) ? current : createOpenAIParams("", current, activeConfig)),
        ...patch,
        providerKind: "openai",
        launchId: GPT_IMAGE_2_LAUNCH_ID
      })
    );
  }

  function updateGeminiParams(patch: GeminiParamPatch) {
    markDraftChanged();
    setParams((current) => ({
      ...(isGeminiImageParams(current) ? current : createGeminiParams("", current, activeConfig)),
      ...patch,
      providerKind: "gemini",
      launchId: NANO_BANANA_3_LAUNCH_ID
    }));
  }

  function markDraftChanged() {
    if (hasRestoredDraft) {
      setHasUserChangedDraft(true);
    }
  }

  function applySnapshot(next: AppSnapshot): ProviderConfig {
    setSnapshot(next);
    const nextActiveConfig = next.providers.find(p => p.id === next.activeProviderId) ?? next.providers[0];
    setApiAccessName(apiAccessDisplayName(nextActiveConfig, copy.apiAccessUntitled));
    setBaseURL(nextActiveConfig.baseURL);
    setApiKey("");
    syncParamsToConfig(nextActiveConfig);
    return nextActiveConfig;
  }

  function applyConfig(config: ProviderConfig) {
    setSnapshot((current) => {
      const nextProviders = current.providers.map(p => p.id === current.activeProviderId ? config : p);
      return { ...current, providers: nextProviders };
    });
    setApiAccessName(apiAccessDisplayName(config, copy.apiAccessUntitled));
    setBaseURL(config.baseURL);
  }

  function syncParamsToConfig(config: ProviderConfig) {
    setParams((current) => {
      const nextParams = createParamsForConfig(config, current);
      updateCustomSizeFromParams(nextParams, setCustomSize);
      return nextParams;
    });
  }

  function resetConnectionCheckForConfigEdit() {
    hasAutoTestedConnectionRef.current = false;
    setConnectionCheck({ status: "idle" });
  }

  async function persistCurrentDraft() {
    if (!bridge) return;
    await bridge.saveDraft({
      activeLaunchId: params.launchId,
      activeModelId: params.model,
      mode: requestMode,
      prompt,
      params,
      inputAssets,
      maskAsset: maskAsset ?? undefined,
      maskDataUrl: maskDataUrl ?? undefined,
      brushSize
    });
  }

  async function saveConfig() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSaveConfig });
      return;
    }
    setIsSavingConfig(true);
    try {
      const configKind = activeConfig.kind;
      const config = await bridge.saveConfig({
        kind: configKind,
        name: apiAccessName.trim() || providerLabelFromKind(configKind),
        apiKey: apiKey.trim() ? apiKey : undefined,
        baseURL,
        defaultModel: defaultModelForConfigSave(configKind, params, activeConfig),
        defaultSize: defaultSizeForConfigSave(params, activeConfig),
        defaultQuality: defaultQualityForConfigSave(params, activeConfig),
        timeoutMs: params.timeoutMs,
        activeLaunchId: activeConfig.activeLaunchId,
        activeModelId: activeConfig.activeModelId
      });
      applyConfig(config);
      syncParamsToConfig(config);
      setApiKey("");
      setNotice({
        kind: config.lastModelDiscoveryError ? "error" : "success",
        text: config.lastModelDiscoveryError ? config.lastModelDiscoveryError : copy.notices.configSaved
      });
      if (config.apiKeySaved) {
        hasAutoTestedConnectionRef.current = true;
        await runConnectionTest({ silent: false, apiKeySaved: config.apiKeySaved });
      } else {
        setConnectionCheck({ status: "idle" });
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  function changeNewApiAccessKind(kind: ProviderKind) {
    setNewApiAccessKind(kind);
    setNewApiAccessBaseURL(defaultBaseURLForProvider(kind, kind === "custom" ? newApiAccessBaseURL : baseURL));
    setNewApiAccessName((current) => current || providerLabelFromKind(kind));
  }

  async function switchApiAccess(providerId: string) {
    if (!bridge || providerId === activeConfig.id) {
      setIsApiAccessOpen(false);
      return;
    }
    try {
      await persistCurrentDraft();
      const next = await bridge.switchProvider(providerId);
      const nextActiveConfig = applySnapshot(next);
      hasAutoTestedConnectionRef.current = false;
      setConnectionCheck({ status: "idle" });
      setIsApiAccessOpen(false);
      setNotice({ kind: "success", text: copy.apiAccessSwitched(apiAccessDisplayName(nextActiveConfig, copy.apiAccessUntitled)) });
      if (nextActiveConfig.apiKeySaved) {
        hasAutoTestedConnectionRef.current = true;
        await runConnectionTest({ silent: true, apiKeySaved: nextActiveConfig.apiKeySaved });
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function addApiAccess() {
    if (!bridge) return;
    setIsSavingConfig(true);
    try {
      await persistCurrentDraft();
      const defaultModel = defaultModelForProvider(newApiAccessKind);
      const next = await bridge.addProvider({
        kind: newApiAccessKind,
        name: newApiAccessName.trim() || providerLabelFromKind(newApiAccessKind),
        apiKey: newApiAccessKey.trim() || undefined,
        baseURL: newApiAccessBaseURL,
        defaultModel,
        defaultSize: DEFAULT_IMAGE_PARAMS.size,
        defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
        timeoutMs: params.timeoutMs,
        activeLaunchId: defaultLaunchForProvider(newApiAccessKind),
        activeModelId: defaultModel
      });
      const nextActiveConfig = applySnapshot(next);
      setNewApiAccessKind("openai");
      setNewApiAccessName("");
      setNewApiAccessBaseURL(DEFAULT_BASE_URL);
      setNewApiAccessKey("");
      setIsAddingApiAccess(false);
      setIsApiAccessOpen(true);
      hasAutoTestedConnectionRef.current = false;
      setConnectionCheck({ status: "idle" });
      setNotice({ kind: "success", text: copy.apiAccessAdded });
      if (nextActiveConfig.apiKeySaved) {
        hasAutoTestedConnectionRef.current = true;
        await runConnectionTest({ silent: true, apiKeySaved: nextActiveConfig.apiKeySaved });
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function deleteApiAccess(config: ProviderConfig) {
    if (!bridge || snapshot.providers.length <= 1) return;
    const name = apiAccessDisplayName(config, copy.apiAccessUntitled);
    if (!window.confirm(copy.confirmDeleteApiAccess(name))) return;
    setIsSavingConfig(true);
    try {
      if (config.id === activeConfig.id) {
        await persistCurrentDraft();
      }
      const next = await bridge.deleteProvider(config.id);
      const nextActiveConfig = applySnapshot(next);
      hasAutoTestedConnectionRef.current = false;
      setConnectionCheck({ status: "idle" });
      setNotice({ kind: "success", text: copy.apiAccessDeleted });
      if (nextActiveConfig.apiKeySaved) {
        hasAutoTestedConnectionRef.current = true;
        await runConnectionTest({ silent: true, apiKeySaved: nextActiveConfig.apiKeySaved });
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function discoverModels() {
    if (!bridge) return;
    setIsDiscoveringModels(true);
    try {
      const config = await bridge.discoverModels();
      applyConfig(config);
      setNotice({
        kind: config.lastModelDiscoveryError ? "error" : "success",
        text: config.lastModelDiscoveryError ?? copy.notices.modelsDiscovered(config.discoveredModels.length)
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsDiscoveringModels(false);
    }
  }

  async function launchModel(button: LaunchButtonState) {
    if (!bridge || !button.available) return;
    const launchProvider = button.providerKind;
    const launchConfig = activeConfig;
    const nextParams = createLaunchParams(button.launchId, button.modelId, params, launchProvider, launchConfig);
    setParams(nextParams);
    if (isGeneralImageParams(nextParams)) {
      if (!generalFallbackSupportsReferenceImages(nextParams.providerKind)) {
        setTabMode("text2img");
        setInputAssets([]);
      }
      setMaskAsset(null);
      setMaskDataUrl(null);
    }
    updateCustomSizeFromParams(nextParams, setCustomSize);
    markDraftChanged();
    setIsSavingConfig(true);
    try {
      const config = await bridge.saveConfig({
        baseURL: activeConfig.baseURL,
        defaultModel: defaultModelForConfigSave(activeConfig.kind, nextParams, activeConfig),
        defaultSize: defaultSizeForConfigSave(nextParams, activeConfig),
        defaultQuality: defaultQualityForConfigSave(nextParams, activeConfig),
        timeoutMs: nextParams.timeoutMs,
        activeLaunchId: button.launchId,
        activeModelId: button.modelId
      });
      applyConfig(config);
      setNotice({ kind: "info", text: copy.notices.launchSelected(button.displayName) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function selectLaunchModel(launchId: FocusedLaunchId, selectedModel: LaunchModelOption) {
    if (!bridge || !selectedModel.id) return;
    const modelOptions = getLaunchModelOptions(activeConfig, launchId);
    const isAvailable = modelOptions.some((model) => model.id === selectedModel.id && model.providerKind === selectedModel.providerKind);
    if (!isAvailable) return;
    const nextParams = createLaunchParams(launchId, selectedModel.id, params, selectedModel.providerKind, activeConfig);
    setParams(nextParams);
    if (isGeneralImageParams(nextParams)) {
      if (!generalFallbackSupportsReferenceImages(nextParams.providerKind)) {
        setTabMode("text2img");
        setInputAssets([]);
      }
      setMaskAsset(null);
      setMaskDataUrl(null);
    }
    updateCustomSizeFromParams(nextParams, setCustomSize);
    markDraftChanged();
    setIsSavingConfig(true);
    try {
      const config = await bridge.saveConfig({
        baseURL: activeConfig.baseURL,
        defaultModel: defaultModelForConfigSave(activeConfig.kind, nextParams, activeConfig),
        defaultSize: defaultSizeForConfigSave(nextParams, activeConfig),
        defaultQuality: defaultQualityForConfigSave(nextParams, activeConfig),
        timeoutMs: nextParams.timeoutMs,
        activeLaunchId: launchId,
        activeModelId: selectedModel.id
      });
      applyConfig(config);
      setOpenLaunchMenuId(null);
      setNotice({ kind: "info", text: copy.notices.launchSelected(selectedModel.displayName) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function runConnectionTest({ silent = false, apiKeySaved = activeConfig.apiKeySaved }: { silent?: boolean; apiKeySaved?: boolean } = {}) {
    if (!bridge) {
      if (!silent) setNotice({ kind: "error", text: copy.notices.bridgeTestConnection });
      return;
    }
    if (!apiKeySaved) {
      setConnectionCheck({ status: "idle" });
      return;
    }
    setIsTestingConnection(true);
    setConnectionCheck({ status: "checking" });
    try {
      const result = await bridge.testConnection();
      setConnectionCheck({ status: result.ok ? "ok" : "error", message: result.message });
      if (!silent || !result.ok) {
        setNotice({
          kind: result.ok ? "success" : "error",
          text: result.ok ? result.message : copy.connectionErrorDetail(result.message)
        });
      }
    } catch (error) {
      const message = normalizeNotice(error);
      setConnectionCheck({ status: "error", message });
      setNotice({ kind: "error", text: copy.connectionErrorDetail(message) });
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function clearApiKey() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeClearKey });
      return;
    }
    setIsClearingApiKey(true);
    try {
      const config = await bridge.clearApiKey();
      applyConfig(config);
      setApiKey("");
      hasAutoTestedConnectionRef.current = false;
      setConnectionCheck({ status: "idle" });
      setNotice({ kind: "success", text: copy.notices.keyCleared });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsClearingApiKey(false);
    }
  }

  async function checkForUpdates() {
    if (!bridge) return;
    setIsCheckingUpdate(true);
    try {
      const result = await bridge.checkForUpdates();
      setUpdateCheck(result);
      setNotice({ kind: result.status === "error" ? "error" : "info", text: formatUpdateStatus(result) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function downloadAndInstallUpdate() {
    if (!bridge) return;
    setIsInstallingUpdate(true);
    try {
      await bridge.saveDraft({
        activeLaunchId: params.launchId,
        activeModelId: params.model,
        mode: requestMode,
        prompt,
        params,
        inputAssets,
        maskAsset: maskAsset ?? undefined,
        maskDataUrl: maskDataUrl ?? undefined,
        brushSize
      });
      const result = await bridge.downloadAndInstallUpdate();
      setNotice({ kind: "success", text: copy.updateReady(result.version) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsInstallingUpdate(false);
    }
  }

  function formatUpdateStatus(result: UpdateCheckResult | null): string {
    if (!result) return copy.updateNotConfigured;
    if (result.status === "not-configured") return result.message ?? copy.updateNotConfigured;
    if (result.status === "current") return result.message ?? copy.updateCurrent;
    if (result.status === "available" && result.latestVersion) return copy.updateAvailable(result.latestVersion);
    if (result.status === "error") return result.message ?? copy.updateCheckFailed;
    return result.message ?? copy.updateCurrent;
  }

  function addInputAssets(assets: InputAsset[]) {
    if (assets.length === 0) return;
    markDraftChanged();
    const next = dedupeAssets([...inputAssets, ...assets]);
    const usesOpenAIInputCap = Boolean(openAIParams);
    const cappedNext = usesOpenAIInputCap ? next.slice(0, MAX_GPT_IMAGE_INPUTS) : next;
    const addedCount = Math.max(0, cappedNext.length - inputAssets.length);
    const capped = Boolean(usesOpenAIInputCap && next.length > MAX_GPT_IMAGE_INPUTS);
    setInputAssets(cappedNext);
    if (tabMode === "text2img") setTabMode("img2img");
    setNotice({
      kind: capped ? "info" : "success",
      text: copy.notices.imagesAdded(addedCount, cappedNext.length, capped, MAX_GPT_IMAGE_INPUTS)
    });
  }

  async function selectImages() {
    if (generalParams && !generalAllowsReferences) {
      setNotice({ kind: "error", text: copy.generalPromptOnlyRuntime });
      return;
    }
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSelectImages });
      return;
    }
    const assets = await bridge.selectImages();
    addInputAssets(assets);
  }

  async function handleReferenceDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsReferenceDragOver(false);
    if (generalParams && !generalAllowsReferences) {
      setNotice({ kind: "error", text: copy.generalPromptOnlyRuntime });
      return;
    }
    if (!bridge) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    const paths = bridge
      .getDroppedFilePaths(files)
      .filter((value): value is string => typeof value === "string" && /\.(png|jpe?g|webp)$/i.test(value));
    if (paths.length === 0) {
      const history = event.dataTransfer.getData("application/x-image2tools-asset");
      if (history && /\.(png|jpe?g|webp)$/i.test(history)) {
        const assets = await bridge.importImages([history]);
        addInputAssets(assets);
      }
      return;
    }
    const assets = await bridge.importImages(paths);
    addInputAssets(assets);
  }

  async function selectMask() {
    if (isGeneralMode) {
      setNotice({ kind: "error", text: copy.validation.generalNoMask });
      return;
    }
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSelectMask });
      return;
    }
    const asset = await bridge.selectMask();
    if (asset) {
      markDraftChanged();
      setMaskAsset(asset);
      setMaskDataUrl(null);
      setTabMode("img2img");
      setNotice({ kind: "success", text: copy.notices.maskAdded });
    }
  }

  async function runJob() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeRunJob });
      return;
    }
    if (validationError) {
      setNotice({ kind: "error", text: validationError });
      return;
    }

    setIsRunning(true);
    setPartialImages([]);
    setActiveJob(null);
    setNotice({ kind: "info", text: copy.notices.requestSent(modeLabels[requestMode].action) });

    try {
      const requestParams = normalizeParamsForOutputCount(params);
      const job = await bridge.runJob({
        mode: requestMode,
        prompt,
        inputPaths: requestMode === "generate" ? [] : inputAssets.map((asset) => asset.path),
        maskPath: requestMode === "inpaint" && !maskDataUrl ? maskAsset?.path : undefined,
        maskDataUrl: requestMode === "inpaint" && maskDataUrl ? maskDataUrl : undefined,
        params: requestParams
      });
      setActiveJob(job);
      setSnapshot((current) => ({
        ...current,
        history: [job, ...current.history.filter((item) => item.id !== job.id)]
      }));
      setNotice({ kind: job.status === "succeeded" ? "success" : "error", text: job.error ?? copy.notices.actionFinished(modeLabels[requestMode].action) });
      if (job.status === "succeeded") {
        await bridge.clearDraft();
        setDraftUpdatedAt(null);
        setHasUserChangedDraft(false);
      }
      await refreshSnapshot();
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsRunning(false);
    }
  }

  async function downloadAsset(asset?: ImageAsset) {
    if (!bridge || !asset) return;
    try {
      flashButton(`download:${asset.id}`);
      const savedPath = await bridge.downloadAsset({
        assetPath: asset.path,
        suggestedName: asset.fileName
      });
      if (savedPath) setNotice({ kind: "success", text: copy.notices.savedTo(savedPath) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function openAssetFolder(asset?: ImageAsset) {
    if (!bridge || !asset) return;
    try {
      flashButton(`folder:${asset.id}`);
      await bridge.openAssetFolder(asset.path);
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function deleteJob(jobId: string) {
    if (!bridge) return;
    try {
      const history = await bridge.deleteJob(jobId);
      setSnapshot((current) => ({ ...current, history }));
      if (activeJob?.id === jobId) setActiveJob(null);
      setNotice({ kind: "success", text: copy.notices.jobDeleted });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function confirmClearHistory() {
    if (!bridge) return;
    try {
      const history = await bridge.clearHistory();
      setSnapshot((current) => ({ ...current, history }));
      setActiveJob(null);
      setIsClearHistoryConfirmOpen(false);
      setNotice({ kind: "success", text: copy.notices.historyCleared });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function copyPrompt(value: string, feedbackId = "copy:prompt") {
    try {
      await navigator.clipboard.writeText(value);
      flashButton(feedbackId);
      setNotice({ kind: "success", text: copy.notices.promptCopied });
    } catch {
      setNotice({ kind: "error", text: copy.notices.clipboardUnavailable });
    }
  }

  function reuseJob(job: GenerationJob) {
    flashButton(`reuse:${job.id}`);
    const reusedParams = normalizeParamsForOutputCount(job.params);
    setTabMode(tabModeForWorkMode(job.mode));
    setPrompt(job.prompt);
    setParams(reusedParams);
    updateCustomSizeFromParams(reusedParams, setCustomSize);
    setBaseURL(activeConfig.baseURL);
    if (job.providerKind === activeConfig.kind) {
      setSnapshot((current) => {
        const nextProviders = current.providers.map(p =>
          p.id === current.activeProviderId ? patchConfigActiveLaunch(p, job) : p
        );
        return { ...current, providers: nextProviders };
      });
    }
    setInputAssets(job.inputAssets);
    setMaskAsset(isGeneralImageParams(reusedParams) ? null : job.maskAsset ?? null);
    setMaskDataUrl(null);
    setActiveJob(job);
    setHasUserChangedDraft(true);
    setNotice({ kind: "info", text: paramsNotice(reusedParams, copy.notices.jobLoaded, copy) });
  }

  function removeInputAsset(assetId: string) {
    markDraftChanged();
    setInputAssets((current) => current.filter((asset) => asset.id !== assetId));
    if (inputAssets[0]?.id === assetId) {
      clearPaintedMask();
    }
  }

  function flashButton(id: string) {
    setButtonFeedback((current) => ({ ...current, [id]: Date.now() }));
    window.setTimeout(() => {
      setButtonFeedback((current) => {
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
    }, 850);
  }

  function buttonFeedbackClass(id: string, base = "icon-button"): string {
    return buttonFeedback[id] ? `${base} clicked` : base;
  }

  function adjustPreviewZoom(delta: number) {
    setPreviewZoom((current) => clamp(Math.round((current + delta) * 100) / 100, MIN_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM));
  }

  function resetPreviewView() {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  }

  function handleImageContextMenu(event: React.MouseEvent, asset: ImageAsset | undefined, jobPrompt: string) {
    event.preventDefault();
    if (!asset) return;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      assetId: asset.id,
      jobPrompt
    });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  async function handleContextMenuSaveImage() {
    if (!contextMenu) return;
    const asset = activeImage?.id === contextMenu.assetId ? activeImage : undefined;
    closeContextMenu();
    await downloadAsset(asset);
  }

  async function handleContextMenuOpenFolder() {
    if (!contextMenu) return;
    const asset = activeImage?.id === contextMenu.assetId ? activeImage : undefined;
    closeContextMenu();
    await openAssetFolder(asset);
  }

  async function handleContextMenuCopyPrompt() {
    if (!contextMenu) return;
    const prompt = contextMenu.jobPrompt;
    closeContextMenu();
    await copyPrompt(prompt, 'context:copy-prompt');
  }

  useEffect(() => {
    const surface = zoomSurfaceRef.current;
    if (!surface || !activeImage) return;
    const onWheel = (event: WheelEvent) => {
      // Non-passive listener so preventDefault stops the surrounding panel/canvas
      // from also scrolling — wheel here only zooms the preview.
      event.preventDefault();
      const delta = event.deltaY < 0 ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP;
      setPreviewZoom((current) => {
        const next = clamp(Math.round((current + delta) * 100) / 100, MIN_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM);
        if (next === 1) setPreviewPan({ x: 0, y: 0 });
        return next;
      });
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [activeImage]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => closeContextMenu();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  function handlePreviewPanStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeImage || previewZoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    panStartRef.current = { x: event.clientX, y: event.clientY, panX: previewPan.x, panY: previewPan.y };
  }

  function handlePreviewPanMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning || !panStartRef.current) return;
    const { x, y, panX, panY } = panStartRef.current;
    setPreviewPan({ x: panX + (event.clientX - x), y: panY + (event.clientY - y) });
  }

  function handlePreviewPanEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
    panStartRef.current = null;
  }

  function nudgeColumn(column: "sidebar" | "history", delta: number) {
    if (column === "sidebar") {
      setSidebarWidth((current) => clamp(current + delta, MIN_SIDEBAR_WIDTH, maxSidebarWidth));
    } else {
      setHistoryWidth((current) => clamp(current + delta, MIN_HISTORY_WIDTH, maxHistoryWidth));
    }
  }

  function resizeHandleKeyDown(column: "sidebar" | "history", event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeColumn(column, column === "sidebar" ? -step : step);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeColumn(column, column === "sidebar" ? step : -step);
    }
  }

  function handleSourceImageLoad() {
    resizeMaskCanvas();
  }

  function resizeMaskCanvas() {
    const image = sourceImageRef.current;
    const canvas = maskCanvasRef.current;
    if (!image || !canvas) return;
    const previousMask = maskDataUrl;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (previousMask) {
      const mask = new Image();
      mask.onload = () => {
        context.drawImage(mask, 0, 0, canvas.width, canvas.height);
      };
      mask.src = previousMask;
    }
  }

  function startPaint(event: React.PointerEvent<HTMLCanvasElement>) {
    // Painting is what CREATES a freehand mask, so it cannot gate on requestMode === "inpaint"
    // (which only becomes true once a mask already exists). Gate on the conditions under which
    // the canvas is shown: img2img tab, a source image present, non-General.
    if (isGeneralMode || tabMode !== "img2img" || !sourcePreview) return;
    setIsPainting(true);
    paintedDuringStrokeRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    paintAt(event);
  }

  function continuePaint(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isPainting) return;
    paintAt(event);
  }

  function finishPaint(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isPainting) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPainting(false);
    const canvas = maskCanvasRef.current;
    if (canvas && paintedDuringStrokeRef.current) {
      markDraftChanged();
      setMaskDataUrl(canvas.toDataURL(maskMimeTypeForSource(inputAssets[0]?.mimeType)));
      setMaskAsset(null);
    }
  }

  function paintAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(255,255,255,0.9)";
    context.shadowColor = "rgba(30,107,95,0.4)";
    context.shadowBlur = brushSize * 0.2;
    context.beginPath();
    context.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    paintedDuringStrokeRef.current = true;
  }

  function clearPaintedMask() {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    markDraftChanged();
    setMaskDataUrl(null);
  }

  const sizeValidation = openAIParams ? validateGptImage2Size(openAIParams.size) : null;
  const maskDescription = activeInpaintCapability === "guided-region" ? copy.guidedRegionDescription : copy.maskDescription;
  const parameterSummary = openAIParams ? (
    <>
      <span>{copy.size}</span>
      <strong>{openAIParams.size}</strong>
      <span>{copy.quality}</span>
      <strong>{openAIParams.quality}</strong>
      <span>{copy.format}</span>
      <strong>{openAIParams.outputFormat.toUpperCase()}</strong>
    </>
  ) : geminiParams ? (
    <>
      <span>{copy.aspectRatio}</span>
      <strong>{geminiParams.aspectRatio}</strong>
      <span>{copy.resolution}</span>
      <strong>{geminiParams.resolution}</strong>
      <span>{copy.count}</span>
      <strong>{geminiParams.outputCount}</strong>
    </>
  ) : (
    <>
      <span>{copy.model}</span>
      <strong>{generalParams?.model || copy.generalFallback}</strong>
      <span>{copy.provider}</span>
      <strong>{providerLabelFromKind(generalParams?.providerKind ?? activeConfig.kind)}</strong>
    </>
  );
  const advancedControls = openAIParams ? (
    <div className="advanced-controls">
      <label>
        {copy.size}
        <select
          value={sizeSelectValue}
          onChange={(event) => {
            const value = event.target.value;
            updateOpenAIParams({ size: value === "custom" ? customSize : value });
          }}
        >
          {sizePresets.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
          <option value="custom">{copy.custom}</option>
        </select>
      </label>
      {sizeSelectValue === "custom" && (
        <label>
          {copy.customSize}
          <input
            value={customSize}
            onChange={(event) => {
              setCustomSize(event.target.value);
              updateOpenAIParams({ size: event.target.value });
            }}
            placeholder="2048x1152"
          />
        </label>
      )}
      <label>
        {copy.quality}
        <select value={openAIParams.quality} onChange={(event) => updateOpenAIParams({ quality: event.target.value as ImageQuality })}>
          {qualityOptions.map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.format}
        <select value={openAIParams.outputFormat} onChange={(event) => updateOpenAIParams({ outputFormat: event.target.value as ImageFormat })}>
          {formatOptions.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.compression}
        <input
          type="range"
          min="0"
          max="100"
          value={openAIParams.outputCompression}
          disabled={openAIParams.outputFormat === "png"}
          onChange={(event) => updateOpenAIParams({ outputCompression: Number(event.target.value) })}
        />
        <span className="range-value">{openAIParams.outputFormat === "png" ? copy.pngIgnoresCompression : `${openAIParams.outputCompression}%`}</span>
      </label>
      <label>
        {copy.background}
        <select value={openAIParams.background} onChange={(event) => updateOpenAIParams({ background: event.target.value as ImageBackground })}>
          {backgroundOptions.map((background) => (
            <option key={background} value={background}>
              {background}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.count}
        <input
          type="number"
          min="1"
          max="10"
          value={openAIParams.n}
          onChange={(event) => updateOpenAIParams({ n: clamp(Number(event.target.value), 1, 10) })}
        />
      </label>
      <label className="checkbox-row" title={openAIParams.n > 1 ? copy.streamSingleOutputOnly : undefined}>
        <input
          type="checkbox"
          checked={openAIParams.stream}
          disabled={openAIParams.n > 1}
          onChange={(event) => updateOpenAIParams({ stream: event.target.checked })}
        />
        {copy.streamPartialPreview}
      </label>
      <label>
        {copy.partialImages}
        <input
          type="number"
          min="0"
          max="3"
          disabled={!openAIParams.stream || openAIParams.n > 1}
          value={openAIParams.partialImages}
          onChange={(event) => updateOpenAIParams({ partialImages: clamp(Number(event.target.value), 0, 3) })}
        />
      </label>
      <label>
        {copy.moderation}
        <select value={openAIParams.moderation} onChange={(event) => updateOpenAIParams({ moderation: event.target.value as ModerationMode })}>
          {moderationOptions.map((moderation) => (
            <option key={moderation} value={moderation}>
              {moderation}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.timeoutSeconds}
        <input
          type="number"
          min="30"
          max="600"
          value={Math.round(openAIParams.timeoutMs / 1000)}
          onChange={(event) => updateOpenAIParams({ timeoutMs: clamp(Number(event.target.value), 30, 600) * 1000 })}
        />
      </label>
      {sizeValidation && (
        <p className={sizeValidation.ok ? "inline-check ok" : "inline-check error"}>
          {sizeValidation.ok ? copy.sizeValid : localizeValidationMessage(sizeValidation.message, copy)}
        </p>
      )}
    </div>
  ) : geminiParams ? (
    <div className="advanced-controls">
      <label>
        {copy.aspectRatio}
        <select value={geminiParams.aspectRatio} onChange={(event) => updateGeminiParams({ aspectRatio: event.target.value as GeminiAspectRatio })}>
          {GEMINI_ASPECT_RATIO_OPTIONS.map((aspectRatio) => (
            <option key={aspectRatio} value={aspectRatio}>
              {aspectRatio}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.resolution}
        <select value={geminiParams.resolution} onChange={(event) => updateGeminiParams({ resolution: event.target.value as GeminiResolution })}>
          {GEMINI_RESOLUTION_OPTIONS.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.count}
        <input type="number" min="1" max="1" value={geminiParams.outputCount} onChange={() => updateGeminiParams({ outputCount: 1 })} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={geminiParams.thinking} onChange={(event) => updateGeminiParams({ thinking: event.target.checked })} />
        {copy.thinking}
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={geminiParams.searchGrounding} onChange={(event) => updateGeminiParams({ searchGrounding: event.target.checked })} />
        {copy.searchGrounding}
      </label>
      <label>
        {copy.timeoutSeconds}
        <input
          type="number"
          min="30"
          max="600"
          value={Math.round(geminiParams.timeoutMs / 1000)}
          onChange={(event) => updateGeminiParams({ timeoutMs: clamp(Number(event.target.value), 30, 600) * 1000 })}
        />
      </label>
    </div>
  ) : (
    <div className="advanced-controls">
      <p className="inline-check">{generalModeNotice}</p>
    </div>
  );

  return (
    <main
      className="app-shell"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--history-width": `${historyWidth}px`
        } as React.CSSProperties
      }
    >
      <aside className="sidebar">
        <header className="brand-block">
          <img className="brand-icon" src="./favicon.svg" alt="" />
          <div>
            <h1>Image2Tools</h1>
            <p className="muted">{copy.tagline}</p>
          </div>
        </header>

        <section className="language-switcher" aria-label={copy.language}>
          <Languages size={16} />
          <span>{copy.language}</span>
          <div className="segmented-control">
            <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>
              {copy.english}
            </button>
            <button type="button" className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>
              {copy.chinese}
            </button>
          </div>
        </section>

        <section className="tool-section api-access-section">
          <div className="section-title config-title">
            <div className="section-title-label">
              <KeyRound size={16} />
              <h2>{copy.apiAccess}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setIsApiAccessOpen((current) => !current)}
              aria-expanded={isApiAccessOpen}
              title={copy.apiAccessList}
            >
              {isApiAccessOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
          <button
            type="button"
            className="api-access-current"
            onClick={() => setIsApiAccessOpen((current) => !current)}
            aria-expanded={isApiAccessOpen}
          >
            <span>
              <strong>{apiAccessDisplayName(activeConfig, copy.apiAccessUntitled)}</strong>
              <small>{providerLabelFromKind(activeConfig.kind)} · {activeConfig.apiKeySaved ? copy.keySaved : copy.noKeySaved}</small>
            </span>
            {isApiAccessOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {isApiAccessOpen && (
            <div className="api-access-panel">
              <div className="api-access-list" aria-label={copy.apiAccessList}>
                {snapshot.providers.map((config) => {
                  const isActive = config.id === activeConfig.id;
                  const canDelete = snapshot.providers.length > 1;
                  return (
                    <div key={config.id} className={isActive ? "api-access-item active" : "api-access-item"}>
                      <button
                        type="button"
                        className="api-access-item-main"
                        onClick={() => void switchApiAccess(config.id)}
                        disabled={isSavingConfig}
                        title={copy.switchApiAccess}
                      >
                        <span className="api-access-item-title">{apiAccessDisplayName(config, copy.apiAccessUntitled)}</span>
                        <span className="api-access-item-meta">
                          {providerLabelFromKind(config.kind)} · {summarizeBaseURL(config.baseURL)}
                        </span>
                        <span className="api-access-item-key">
                          <span className={config.apiKeySaved ? "dot ok" : "dot"} />
                          {config.apiKeySaved ? copy.keySaved : copy.noKeySaved}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-button ghost danger"
                        onClick={() => void deleteApiAccess(config)}
                        disabled={!canDelete || isSavingConfig}
                        title={canDelete ? copy.deleteApiAccess : copy.deleteLastApiAccessDisabled}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="secondary" onClick={() => setIsAddingApiAccess((current) => !current)}>
                <Plus size={16} />
                {copy.addApiAccess}
              </button>
              {isAddingApiAccess && (
                <div className="api-access-add-form">
                  <label>
                    {copy.apiAccessKind}
                    <select value={newApiAccessKind} onChange={(event) => changeNewApiAccessKind(event.target.value as ProviderKind)}>
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Gemini</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  <label>
                    {copy.apiAccessName}
                    <input value={newApiAccessName} onChange={(event) => setNewApiAccessName(event.target.value)} placeholder={providerLabelFromKind(newApiAccessKind)} />
                  </label>
                  <label>
                    {copy.baseURL}
                    <input value={newApiAccessBaseURL} onChange={(event) => setNewApiAccessBaseURL(event.target.value)} />
                  </label>
                  <label>
                    {copy.apiKey}
                    <input type="password" autoComplete="off" value={newApiAccessKey} onChange={(event) => setNewApiAccessKey(event.target.value)} placeholder={copy.pasteApiKey} />
                  </label>
                  <div className="button-row">
                    <button type="button" onClick={addApiAccess} disabled={isSavingConfig}>
                      {isSavingConfig ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                      {isSavingConfig ? copy.addingApiAccess : copy.addApiAccess}
                    </button>
                    <button type="button" className="ghost" onClick={() => setIsAddingApiAccess(false)}>
                      <X size={16} />
                      {copy.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <form
          className="tool-section model-config-section"
          onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}
        >
          <div className="section-title config-title">
            <div className="section-title-label">
              <KeyRound size={16} />
              <h2>{copy.provider}</h2>
            </div>
            <span className="connection-badge" data-status={connectionCheck.status} title={connectionTitle}>
              {isTestingConnection || connectionCheck.status === "checking" ? (
                <Loader2 className="spin" size={13} />
              ) : connectionCheck.status === "ok" ? (
                <CheckCircle2 size={13} />
              ) : connectionCheck.status === "error" ? (
                <AlertTriangle size={13} />
              ) : (
                <span className="connection-dot" />
              )}
              {connectionLabel}
            </span>
          </div>
          <label>
            {copy.apiAccessName}
            <input
              value={apiAccessName}
              onChange={(event) => {
                setApiAccessName(event.target.value);
              }}
              placeholder={providerLabelFromKind(activeConfig.kind)}
            />
          </label>
          <label>
            {copy.apiKey}
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                resetConnectionCheckForConfigEdit();
                setApiKey(event.target.value);
              }}
              placeholder={apiKeyPlaceholder}
            />
          </label>
          <label>
            {copy.baseURL}
            <input
              value={baseURL}
              onChange={(event) => {
                resetConnectionCheckForConfigEdit();
                setBaseURL(event.target.value);
              }}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={saveConfig} disabled={isSavingConfig}>
              {isSavingConfig ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {copy.save}
            </button>
            <button type="button" className="ghost" onClick={clearApiKey} disabled={isClearingApiKey || !activeConfig.apiKeySaved}>
              {isClearingApiKey ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              {copy.clearKey}
            </button>
          </div>
          <div className="config-status">
            <span className={activeConfig.apiKeySaved ? "dot ok" : "dot"} />
            {activeConfig.apiKeySaved ? copy.keySaved : copy.noKeySaved}
            {activeConfig.apiKeySaved && (
              <span className="provider-chip-inline" title={copy.providerAutoDetected}>
                {providerLabelFromKind(activeConfig.kind)}
              </span>
            )}
          </div>
          {connectionErrorText && <p className="inline-check error config-error-detail">{connectionErrorText}</p>}
          <div className="discovery-row">
            <button type="button" className="secondary discover-button" onClick={discoverModels} disabled={!bridge || isDiscoveringModels || !activeConfig.apiKeySaved}>
              {isDiscoveringModels ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {isDiscoveringModels ? copy.discoveringModels : copy.discoverModels}
            </button>
            <span className="model-discovery-summary" data-kind={activeConfig.lastModelDiscoveryError ? "error" : "info"} title={activeConfig.lastModelDiscoveryError ?? discoveryText}>
              {discoveryText}
            </span>
          </div>
        </form>

        <section className="tool-section launch-section">
          <div className="section-title launch-title">
            <div className="section-title-label">
              <Wand2 size={16} />
              <h2>{copy.launchModels}</h2>
            </div>
            <strong>{activeLaunchDisplay}</strong>
          </div>
          <div className="launch-strip" aria-label={copy.launchModels}>
            {launchButtons.map((button) => {
              const modelOptions = getLaunchModelOptions(activeConfig, button.launchId);
              const hasModelMenu = button.available && modelOptions.length > 1;
              const activeModelOption =
                modelOptions.find((model) => model.id === activeConfig.activeModelId && model.providerKind === button.providerKind) ??
                modelOptions.find((model) => model.id === button.modelId && model.providerKind === button.providerKind);
              const isActive = activeConfig.activeLaunchId === button.launchId;
              return (
                <div key={button.launchId} className="launch-item">
                  <button
                    type="button"
                    className={isActive ? "launch-button active" : "launch-button"}
                    onClick={() => {
                      if (!button.available) return;
                      setOpenLaunchMenuId((current) => (hasModelMenu ? (current === button.launchId ? null : button.launchId) : null));
                      void launchModel(button);
                    }}
                    disabled={!button.available || isSavingConfig}
                    title={button.reason}
                    aria-expanded={hasModelMenu ? openLaunchMenuId === button.launchId : undefined}
                  >
                    <span className="launch-button-main">
                      <span>{button.displayName}</span>
                      {hasModelMenu && (openLaunchMenuId === button.launchId ? <ChevronUp size={15} /> : <ChevronDown size={15} />)}
                    </span>
                    <small>{button.available ? activeModelOption?.displayName ?? (button.modelId || copy.generalFallback) : button.reason}</small>
                  </button>
                  {hasModelMenu && openLaunchMenuId === button.launchId && (
                    <div className="launch-model-menu" role="listbox" aria-label={`${button.displayName} ${copy.model}`}>
                      {modelOptions.map((model) => {
                        const isSelected = activeConfig.activeLaunchId === button.launchId && activeConfig.activeModelId === model.id && params.providerKind === model.providerKind;
                        return (
                          <button
                            key={`${model.providerKind}:${model.id}`}
                            type="button"
                            className={isSelected ? "launch-model-option active" : "launch-model-option"}
                            onClick={() => void selectLaunchModel(button.launchId, model)}
                            disabled={isSavingConfig}
                            role="option"
                            aria-selected={isSelected}
                            title={model.id}
                          >
                            <span>{model.displayName}</span>
                            <small>{providerLabelFromKind(model.providerKind)}</small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="tool-section template-section">
          <button type="button" className="section-toggle" onClick={() => setIsTemplatesOpen((current) => !current)}>
            <span className="section-toggle-label">
              <Clipboard size={16} />
              <span>{copy.promptTemplates}</span>
            </span>
            <span className="section-toggle-state">
              {snapshot.promptTemplates.length}
              {isTemplatesOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>
          {isTemplatesOpen && (
            <div className="template-panel">
              <div className="template-toolbar">
                <input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder={copy.templateSearch} />
                <select value={templateTagFilter} onChange={(event) => setTemplateTagFilter(event.target.value)}>
                  <option value="">{copy.templateAllTags}</option>
                  {templateTagsAvailable.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
                <button type="button" className="icon-button" onClick={() => void importTemplates()} title={copy.templateImport}>
                  <FileUp size={15} />
                </button>
                <button type="button" className="icon-button" onClick={() => void exportTemplates()} title={copy.templateExport} disabled={snapshot.promptTemplates.length === 0}>
                  <FileDown size={15} />
                </button>
              </div>
              <div className="template-editor">
                <label>
                  {copy.templateTitle}
                  <input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} placeholder={copy.templateNew} />
                </label>
                <label>
                  {copy.templateBody}
                  <textarea value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} placeholder={copy.prompt} />
                </label>
                <label>
                  {copy.templateTags}
                  <input value={templateTags} onChange={(event) => setTemplateTags(event.target.value)} placeholder="portrait, product, style" />
                </label>
                <label>
                  {copy.templateCategory}
                  <input value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)} placeholder={copy.templateCategory} />
                </label>
                <div className="button-row">
                  <button type="button" onClick={() => void saveTemplateFromForm()} disabled={!templateTitle.trim() || !templateBody.trim()}>
                    <Save size={16} />
                    {editingTemplateId ? copy.templateUpdate : copy.templateSave}
                  </button>
                  <button type="button" className="ghost" onClick={resetTemplateForm}>
                    <X size={16} />
                    {copy.clear}
                  </button>
                </div>
              </div>
              <div className="template-list">
                {filteredTemplates.length === 0 && (
                  <p className="empty-inline">{snapshot.promptTemplates.length === 0 ? copy.templateEmpty : copy.templateNoMatch}</p>
                )}
                {filteredTemplates.map((template) => (
                  <article key={template.id} className="template-item">
                    <div className="template-item-main">
                      <strong>{template.title}</strong>
                      <p>{template.body}</p>
                      {template.tags.length > 0 && (
                        <div className="template-tags">
                          {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      )}
                    </div>
                    <div className="template-actions">
                      <button type="button" className="icon-button" onClick={() => void applyTemplate(template)} title={copy.templateUse}>
                        <Clipboard size={15} />
                      </button>
                      <button type="button" className="icon-button" onClick={() => editTemplate(template)} title={copy.templateEdit}>
                        <SlidersHorizontal size={15} />
                      </button>
                      <button type="button" className="icon-button ghost danger" onClick={() => void deleteTemplate(template)} title={copy.delete}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="tool-section">
          <button type="button" className="section-toggle" onClick={() => setShowAdvanced((current) => !current)}>
            <span className="section-toggle-label">
              <SlidersHorizontal size={16} />
              <span>{copy.parameters}</span>
            </span>
            <span className="section-toggle-state">
              {showAdvanced ? copy.hide : copy.show}
              {showAdvanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>

          <div className="compact-grid">
            {parameterSummary}
          </div>

          {showAdvanced && advancedControls}
        </section>

        <section className="tool-section draft-section">
          <div className="section-title">
            <RefreshCw size={16} />
            <h2>{copy.draft}</h2>
          </div>
          <p className="muted">{draftUpdatedAt ? `${copy.autosaved} ${formatDate(draftUpdatedAt)}` : copy.workspaceAutosaves}</p>
          <button type="button" className="secondary" onClick={clearDraft} disabled={!draftUpdatedAt}>
            <Trash2 size={16} />
            {copy.clearDraft}
          </button>
        </section>

        <section className="notice-area" data-kind={notice.kind}>
          {notice.kind === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{notice.text}</span>
        </section>

        <section className="update-panel sidebar-bottom">
          <div className="section-title">
            <RefreshCw size={16} />
            <h2>{copy.updates}</h2>
          </div>
          <div className="update-status">
            <span>
              {copy.currentVersion}: {snapshot.appVersion}
            </span>
            <strong data-status={updateCheck?.status ?? "idle"}>{isCheckingUpdate ? copy.checkingUpdates : formatUpdateStatus(updateCheck)}</strong>
          </div>
          {updateCheck?.status === "available" && (
            <button type="button" onClick={downloadAndInstallUpdate} disabled={!bridge || isCheckingUpdate || isInstallingUpdate}>
              {isInstallingUpdate ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              {isInstallingUpdate ? copy.downloadingUpdate : copy.installUpdate}
            </button>
          )}
        </section>
      </aside>

      <div
        className="column-resizer"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maxSidebarWidth}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizingColumn("sidebar");
        }}
        onKeyDown={(event) => resizeHandleKeyDown("sidebar", event)}
      />

      <section className="workspace">
        <div className="workspace-topbar">
          {isGeneralMode ? (
            <div className="general-mode-status">
              <Wand2 size={16} />
              <span>{generalModeNotice}</span>
            </div>
          ) : (
            <div className="mode-tabs" role="tablist" aria-label={copy.parameters}>
              <button
                type="button"
                className={tabMode === "text2img" ? "mode-tab active" : "mode-tab"}
                onClick={() => {
                  markDraftChanged();
                  setTabMode("text2img");
                }}
              >
                <Wand2 size={16} />
                <span>{copy.tabs.text2img.title}</span>
                <small>{copy.tabs.text2img.hint}</small>
              </button>
              <button
                type="button"
                className={tabMode === "img2img" ? "mode-tab active" : "mode-tab"}
                onClick={() => {
                  markDraftChanged();
                  setTabMode("img2img");
                }}
              >
                <ImagePlus size={16} />
                <span>{copy.tabs.img2img.title}</span>
                <small>{copy.tabs.img2img.hint}</small>
              </button>
            </div>
          )}
        </div>

        <div className="preview-layout">
          <section className="result-stage">
            <div className="stage-toolbar">
              <div>
                <h2>{copy.resultViewer}</h2>
              </div>
              <div className="stage-actions">
                <button
                  type="button"
                  className={activeImage ? buttonFeedbackClass(`download:${activeImage.id}`) : "icon-button"}
                  disabled={!activeImage}
                  onClick={() => downloadAsset(activeImage)}
                  title={copy.download}
                >
                  <Download size={17} />
                </button>
                <button
                  type="button"
                  className={activeImage ? buttonFeedbackClass(`folder:${activeImage.id}`) : "icon-button"}
                  disabled={!activeImage}
                  onClick={() => openAssetFolder(activeImage)}
                  title={copy.openFolder}
                >
                  <FolderOpen size={17} />
                </button>
              </div>
            </div>

            <div className="result-canvas">
              {activeImageSource ? (
                <>
                  <div
                    ref={zoomSurfaceRef}
                    className={isPanning ? "zoom-surface panning" : previewZoom > 1 ? "zoom-surface pannable" : "zoom-surface"}
                    onDoubleClick={() => setIsPreviewOpen(true)}
                    onPointerDown={handlePreviewPanStart}
                    onPointerMove={handlePreviewPanMove}
                    onPointerUp={handlePreviewPanEnd}
                    onPointerCancel={handlePreviewPanEnd}
                  >
                    <img
                      src={activeImageSource}
                      alt={copy.generatedResult}
                      draggable={false}
                      style={{ width: `${previewZoom * 100}%`, transform: `translate(${previewPan.x}px, ${previewPan.y}px)` }}
                      onContextMenu={(e) => handleImageContextMenu(e, activeImage, activeJob?.prompt ?? '')}
                    />
                  </div>
                  <div className="zoom-overlay">
                    <button type="button" className="icon-button" onClick={() => adjustPreviewZoom(-PREVIEW_ZOOM_STEP)} title={copy.zoomOut}>
                      <ZoomOut size={16} />
                    </button>
                    <span className="zoom-readout" title={copy.zoomLevel}>{previewZoomPercent}%</span>
                    <button type="button" className="icon-button" onClick={() => adjustPreviewZoom(PREVIEW_ZOOM_STEP)} title={copy.zoomIn}>
                      <ZoomIn size={16} />
                    </button>
                    <button type="button" className="icon-button" disabled={previewZoom === 1 && previewPan.x === 0 && previewPan.y === 0} onClick={resetPreviewView} title={copy.resetZoom}>
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </>
              ) : activeJobError ? (
                <div className="job-error-panel" role="alert">
                  <AlertTriangle size={30} />
                  <strong>{copy.jobFailed}</strong>
                  <span>{activeJobError}</span>
                </div>
              ) : (
                <div className="empty-state">
                  <Wand2 size={30} />
                  <span>{copy.outputEmpty}</span>
                </div>
              )}
            </div>

            {activeResults.length > 1 && (
              <div className="result-strip">
                {activeResults.map((asset, index) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={asset.id === activeImage?.id ? "active" : undefined}
                    onClick={() => setSelectedResultId(asset.id)}
                    title={`${copy.generatedResult} ${index + 1}`}
                  >
                    <img src={assetSource(asset)} alt={`${copy.generatedResult} ${index + 1}`} />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            )}

            {partialImages.length > 0 && (
              <div className="partial-strip">
                {partialImages.map((asset, index) => (
                  <button key={asset.id} type="button" onClick={() => setActiveJob((job) => (job ? { ...job, outputs: [...job.outputs, asset] } : job))}>
                    <img src={assetSource(asset)} alt={`${copy.partialImages} ${index + 1}`} />
                    <span>P{index + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="input-panel">
            <div className="prompt-block">
              <label>
                {copy.prompt}
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    markDraftChanged();
                    setPrompt(event.target.value);
                  }}
                />
              </label>
              <div className="run-row">
                <button type="button" className="primary-run" onClick={runJob} disabled={!canRun}>
                  {isRunning ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
                  {isRunning ? copy.running : modeLabels[requestMode].action}
                </button>
                <button type="button" className={buttonFeedbackClass("copy:prompt", "secondary")} onClick={() => copyPrompt(prompt)}>
                  <Clipboard size={16} />
                  {buttonFeedback["copy:prompt"] ? copy.clicked : copy.copy}
                </button>
              </div>
              {validationError && <p className="inline-check error">{validationError}</p>}
            </div>

            {showReferenceTools && (
              <>
                <div className="asset-tools">
                  <button type="button" className="secondary" onClick={selectImages}>
                    <ImagePlus size={16} />
                    {copy.addReferences}
                  </button>
                  {!isGeneralMode && (
                    <button type="button" className="secondary" onClick={selectMask}>
                      <Paintbrush size={16} />
                      {copy.uploadMask}
                    </button>
                  )}
                  {inputAssets.length > 0 && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        markDraftChanged();
                        setInputAssets([]);
                      }}
                    >
                      <X size={16} />
                      {copy.clear}
                    </button>
                  )}
                </div>
                {(geminiParams || (generalParams && generalFallbackSupportsReferenceImages(generalParams.providerKind))) && (
                  <p className="inline-check reference-rights-reminder">
                    <AlertTriangle size={14} />
                    <span>{copy.uploadRightsReminder}</span>
                  </p>
                )}

                <div
                  className={isReferenceDragOver ? "reference-grid drag-over" : "reference-grid"}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    if (!isReferenceDragOver) setIsReferenceDragOver(true);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                    setIsReferenceDragOver(false);
                  }}
                  onDrop={handleReferenceDrop}
                >
                  {inputAssets.length === 0 ? (
                    <div className="empty-inline">{copy.dropReferencesHint}</div>
                  ) : (
                    inputAssets.map((asset, index) => (
                      <div key={asset.id} className="asset-tile">
                        {assetSource(asset) && <img src={assetSource(asset)} alt={asset.name} />}
                        <button type="button" className="tile-remove" onClick={() => removeInputAsset(asset.id)} title={copy.delete}>
                          <X size={14} />
                        </button>
                        <div>
                          <strong>{index === 0 ? copy.source : `${copy.reference} ${index + 1}`}</strong>
                          <span>{asset.name}</span>
                          <small>{formatBytes(asset.sizeBytes)}</small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tabMode === "img2img" && !isGeneralMode && (
              <div className="mask-editor">
                <div className="mask-header">
                  <div>
                    <h3>
                      {copy.mask} <span className="mask-optional">{copy.maskOptional}</span>
                    </h3>
                    <p>{maskDescription}</p>
                  </div>
                  <div className="brush-controls">
                    <Eraser size={16} />
                    <input
                      type="range"
                      min="16"
                      max="180"
                      value={brushSize}
                      onChange={(event) => {
                        markDraftChanged();
                        setBrushSize(Number(event.target.value));
                      }}
                    />
                    <button type="button" className="icon-button" onClick={clearPaintedMask} title={copy.clearPaintedMask}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="mask-canvas-wrap">
                  {sourcePreview ? (
                    <>
                      <img ref={sourceImageRef} src={sourcePreview} alt={copy.sourceForMask} onLoad={handleSourceImageLoad} />
                      <canvas
                        ref={maskCanvasRef}
                        onPointerDown={startPaint}
                        onPointerMove={continuePaint}
                        onPointerUp={finishPaint}
                        onPointerCancel={finishPaint}
                      />
                    </>
                  ) : (
                    <div className="empty-state">
                      <Brush size={24} />
                      <span>{copy.addSourceForMask}</span>
                    </div>
                  )}
                </div>
                {maskPreview && (
                  <div className="mask-status">
                    {maskCheck?.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    <span>{maskCheck?.message ?? copy.checkingMask}</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </section>

      <div
        className="column-resizer"
        role="separator"
        aria-label="Resize history"
        aria-orientation="vertical"
        aria-valuemin={MIN_HISTORY_WIDTH}
        aria-valuemax={maxHistoryWidth}
        aria-valuenow={historyWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizingColumn("history");
        }}
        onKeyDown={(event) => resizeHandleKeyDown("history", event)}
      />

      <aside className="history">
        <header className="history-header">
          <div>
            <p className="eyebrow">{copy.history}</p>
            <h2>{copy.recentJobs}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setIsClearHistoryConfirmOpen(true)}
            disabled={snapshot.history.length === 0}
            title={copy.clearAllHistoryTooltip}
          >
            <Trash2 size={16} />
          </button>
        </header>

        <label className="search-box">
          <Search size={15} />
          <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder={copy.searchPrompt} />
        </label>

        <div className="history-sort">
          <ArrowDownUp size={14} />
          <button
            type="button"
            className={historySort === "newest" ? "history-sort-option active" : "history-sort-option"}
            onClick={() => setHistorySort("newest")}
          >
            {copy.sortNewest}
          </button>
          <button
            type="button"
            className={historySort === "oldest" ? "history-sort-option active" : "history-sort-option"}
            onClick={() => setHistorySort("oldest")}
          >
            {copy.sortOldest}
          </button>
        </div>

        {(isSearchingHistory || hasHistoryOverflow) && (
          <div className="history-list-status">
            {isSearchingHistory && <span>{copy.historyMatchCount(filteredHistory.length)}</span>}
            {hasHistoryOverflow && (
              <button type="button" className="history-expand-button ghost" onClick={() => setIsHistoryExpanded((current) => !current)}>
                {isHistoryExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                <span>{isHistoryExpanded ? copy.collapseHistory : copy.showAllHistory(filteredHistory.length)}</span>
              </button>
            )}
          </div>
        )}

        <div className="history-list">
          {filteredHistory.length === 0 ? (
            <div className="history-empty">{copy.noJobsYet}</div>
          ) : (
            visibleHistory.map((job) => {
              const result = getBestResult(job);
              const jobError = getJobError(job);
              const modelDetails = getHistoryModelDetails(job);
              const paramsSummary = isOpenAIImageParams(job.params) ? `${job.params.size} · ${job.params.quality}` : modelDetails.modelDisplayName;
              return (
                <article key={job.id} className={activeJob?.id === job.id ? "history-item active" : "history-item"}>
                  <button
                    type="button"
                    className="history-preview"
                    onClick={() => setActiveJob(job)}
                    title={jobError ?? job.status}
                    aria-label={jobError ? `${copy.jobFailed}: ${jobError}` : `${copy.openJob}: ${job.status}`}
                  >
                    {result ? (
                      <img
                        src={assetSource(result)}
                        alt={copy.historyResult}
                        draggable={Boolean(result.path)}
                        onDragStart={(event) => {
                          if (!result.path) return;
                          event.dataTransfer.setData("application/x-image2tools-asset", result.path);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                      />
                    ) : (
                      <span>{job.status}</span>
                    )}
                  </button>
                  <div className="history-copy">
                    <div className="history-meta">
                      <strong>{modeLabels[job.mode].title}</strong>
                      <span>{formatDate(job.createdAt)}</span>
                    </div>
                    <div className="history-chip-row" aria-label={copy.model}>
                      <span className="history-chip model-chip" title={modelDetails.modelTitle}>
                        {modelDetails.modelDisplayName}
                      </span>
                      {modelDetails.providerDisplayName && (
                        <span className="history-chip provider-chip" title={modelDetails.providerTitle ?? modelDetails.providerDisplayName}>
                          {modelDetails.providerDisplayName}
                        </span>
                      )}
                    </div>
                    <p>{job.prompt}</p>
                    <small>
                      {job.status} · {paramsSummary} · {formatDuration(job.durationMs)}
                    </small>
                    {jobError && <p className="history-error">{jobError}</p>}
                  </div>
                  <div className="history-actions">
                    <button type="button" className={buttonFeedbackClass(`reuse:${job.id}`, "history-action-button")} onClick={() => reuseJob(job)} title={copy.reuse}>
                      <RefreshCw size={15} />
                      <span>{buttonFeedback[`reuse:${job.id}`] ? copy.clicked : copy.reuse}</span>
                    </button>
                    <button type="button" className={buttonFeedbackClass(`copy:${job.id}`, "history-action-button")} onClick={() => copyPrompt(job.prompt, `copy:${job.id}`)} title={copy.copyPrompt}>
                      <Clipboard size={15} />
                      <span>{buttonFeedback[`copy:${job.id}`] ? copy.clicked : copy.copy}</span>
                    </button>
                    <button
                      type="button"
                      className={result ? buttonFeedbackClass(`download:${result.id}`, "history-action-button") : "history-action-button"}
                      disabled={!result}
                      onClick={() => downloadAsset(result)}
                      title={copy.download}
                    >
                      <Download size={15} />
                      <span>{result && buttonFeedback[`download:${result.id}`] ? copy.clicked : copy.download}</span>
                    </button>
                    <button type="button" className="history-action-button danger" onClick={() => deleteJob(job.id)} title={copy.delete}>
                      <Trash2 size={15} />
                      <span>{copy.delete}</span>
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </aside>
      {isClearHistoryConfirmOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsClearHistoryConfirmOpen(false);
          }}
        >
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
            <div>
              <h2 id="clear-history-title">{copy.confirmClearHistoryTitle}</h2>
              <p>{copy.confirmClearHistoryBody(snapshot.history.length)}</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => setIsClearHistoryConfirmOpen(false)}>
                {copy.cancel}
              </button>
              <button type="button" className="danger-button" onClick={confirmClearHistory}>
                <Trash2 size={16} />
                {copy.confirmClearHistory}
              </button>
            </div>
          </section>
        </div>
      )}
      {isPreviewOpen && activeImageSource && (
        <div
          className="preview-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsPreviewOpen(false);
          }}
        >
          <button type="button" className="preview-modal-close icon-button" onClick={() => setIsPreviewOpen(false)} title={copy.cancel}>
            <X size={18} />
          </button>
          <img
            src={activeImageSource}
            alt={copy.generatedResult}
            className="preview-modal-image"
            onContextMenu={(e) => handleImageContextMenu(e, activeImage, activeJob?.prompt ?? '')}
          />
        </div>
      )}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={handleContextMenuSaveImage}>
            <Download size={14} />
            {copy.saveImage}
          </div>
          <div className="context-menu-item" onClick={handleContextMenuOpenFolder}>
            <FolderOpen size={14} />
            {copy.openFolder}
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={handleContextMenuCopyPrompt}>
            <Clipboard size={14} />
            {copy.copyPrompt}
          </div>
        </div>
      )}
    </main>
  );
}

function currentPartialLabel(index: number): number {
  return index + 1;
}

function normalizeNotice(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function dedupeAssets(assets: InputAsset[]): InputAsset[] {
  const seen = new Set<string>();
  const result: InputAsset[] = [];
  for (const asset of assets) {
    const key = asset.path || asset.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}
