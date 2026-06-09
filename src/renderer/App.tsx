import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brush,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clipboard,
  Download,
  Eraser,
  FolderOpen,
  ImagePlus,
  KeyRound,
  Languages,
  Loader2,
  Paintbrush,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
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
  NANO_BANANA_3_MODEL_ID
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
const MIN_WORKSPACE_WIDTH = 620;
const RESIZER_WIDTH = 12;
const HISTORY_COLLAPSED_LIMIT = 6;
const DEFAULT_HISTORY_MODEL_DISPLAY = "GPT Image 2";

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
  available: boolean;
  reason: string;
}

type OpenAIParamPatch = Partial<Omit<OpenAIImageParams, "providerKind" | "launchId">>;
type GeminiParamPatch = Partial<Omit<GeminiImageParams, "providerKind" | "launchId">>;
type GeneralParamPatch = Partial<Omit<GeneralImageParams, "providerKind" | "launchId">>;

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
  config: fallbackConfig,
  history: []
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

function generalModelId(config: ProviderConfig): string {
  return config.discoveredModels[0]?.id ?? config.activeModelId ?? config.defaultModel;
}

function providerForLaunch(launchId: FocusedLaunchId, fallback: ProviderKind): ProviderKind {
  const definition = FOCUSED_MODEL_CATALOG.find((item) => item.launchId === launchId);
  if (!definition || definition.launchId === GENERAL_LAUNCH_ID) return fallback;
  return definition.providerKind;
}

function isGeneralImageParams(params: ImageParams): params is GeneralImageParams {
  return params.launchId === GENERAL_LAUNCH_ID;
}

function createOpenAIParams(modelId: string, current: ImageParams, config?: ProviderConfig): OpenAIImageParams {
  const base = isOpenAIImageParams(current) ? current : DEFAULT_IMAGE_PARAMS;
  return {
    ...DEFAULT_IMAGE_PARAMS,
    ...base,
    providerKind: "openai",
    launchId: GPT_IMAGE_2_LAUNCH_ID,
    model: modelId || GPT_IMAGE_2_MODEL_ID,
    size: config?.defaultSize ?? base.size,
    quality: config?.defaultQuality ?? base.quality,
    timeoutMs: config?.timeoutMs ?? base.timeoutMs
  };
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
  if (kind === "openai") {
    return isOpenAIImageParams(params) ? params.model : GPT_IMAGE_2_MODEL_ID;
  }
  if (kind === "gemini") {
    return isGeminiImageParams(params) ? params.model : NANO_BANANA_3_MODEL_ID;
  }
  if (isGeneralImageParams(params)) return params.model;
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
    return config.kind === "openai" && config.activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ? null : copy.selectLaunchToRun("GPT Image 2");
  }
  if (isGeminiImageParams(params)) {
    return config.kind === "gemini" && config.activeLaunchId === NANO_BANANA_3_LAUNCH_ID ? null : copy.selectLaunchToRun("Nano Banana 3");
  }
  return copy.generalRuntimeUnsupported;
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
  if (isGeneralImageParams(params)) return `${restoredText} ${copy.generalRuntimeUnsupported}`;
  return restoredText;
}

function updateCustomSizeFromParams(params: ImageParams, setCustomSize: (value: string) => void) {
  if (isOpenAIImageParams(params) && !sizePresets.includes(params.size)) {
    setCustomSize(params.size);
  }
}

function getLaunchButtonStates(config: ProviderConfig, copy: UiCopy): LaunchButtonState[] {
  const discoveredIds = new Set(config.discoveredModels.map((model) => model.id));
  const hasDiscovery = config.discoveredModels.length > 0;
  const generalId = generalModelId(config);
  return FOCUSED_MODEL_CATALOG.map((definition) => {
    const modelId = definition.launchId === GENERAL_LAUNCH_ID ? generalId : definition.defaultModelId;
    let available = false;
    let reason = "";

    if (!config.apiKeySaved) {
      reason = copy.launchUnavailableNoKey;
    } else if (config.lastModelDiscoveryError) {
      reason = config.lastModelDiscoveryError;
    } else if (!hasDiscovery) {
      reason = copy.launchUnavailableNoDiscovery;
    } else if (definition.launchId === GENERAL_LAUNCH_ID) {
      available = Boolean(modelId);
      reason = available ? copy.launchAvailable : copy.launchUnavailableNoImageModels;
    } else if (config.kind !== definition.providerKind) {
      reason = copy.launchUnavailableProvider(providerLabelFromKind(definition.providerKind));
    } else if (definition.modelIds.some((id) => discoveredIds.has(id))) {
      available = true;
      reason = copy.launchAvailable;
    } else {
      reason = copy.launchUnavailableModel(definition.modelIds.join(", "));
    }

    return {
      launchId: definition.launchId,
      displayName: definition.displayName,
      modelId,
      available,
      reason
    };
  });
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
  const modeLabels = copy.modes;
  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);
  const [mode, setMode] = useState<WorkMode>("generate");
  const [prompt, setPrompt] = useState("A clean product photo of a matte black travel mug on a brushed steel counter");
  const [params, setParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS);
  const [apiKey, setApiKey] = useState("");
  const [providerKind, setProviderKind] = useState<ProviderKind>("openai");
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [customSize, setCustomSize] = useState("2048x1152");
  const [inputAssets, setInputAssets] = useState<InputAsset[]>([]);
  const [maskAsset, setMaskAsset] = useState<InputAsset | null>(null);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [maskCheck, setMaskCheck] = useState<MaskCheck | null>(null);
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null);
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
  const [isRunning, setIsRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [brushSize, setBrushSize] = useState(72);
  const [isPainting, setIsPainting] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [hasUserChangedDraft, setHasUserChangedDraft] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, number>>({});
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth("image2tools.sidebarWidth", DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
  const [historyWidth, setHistoryWidth] = useState(() => readStoredWidth("image2tools.historyWidth", DEFAULT_HISTORY_WIDTH, MIN_HISTORY_WIDTH, MAX_HISTORY_WIDTH));
  const [resizingColumn, setResizingColumn] = useState<"sidebar" | "history" | null>(null);

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const paintedDuringStrokeRef = useRef(false);

  const sourceAsset = inputAssets[0];
  const sourcePreview = assetSource(sourceAsset);
  const maskPreview = maskDataUrl ?? assetSource(maskAsset);
  const activeImage = getBestResult(activeJob) ?? partialImages[partialImages.length - 1];
  const activeImageSource = assetSource(activeImage);
  const activeJobError = getJobError(activeJob);
  const openAIParams = isOpenAIImageParams(params) ? params : null;
  const geminiParams = isGeminiImageParams(params) ? params : null;
  const generalParams = isGeneralImageParams(params) ? params : null;
  const usesExactMask = Boolean(openAIParams);
  const sizeSelectValue = openAIParams && sizePresets.includes(openAIParams.size) ? openAIParams.size : "custom";
  const previewZoomPercent = Math.round(previewZoom * 100);
  const apiKeyPlaceholder = snapshot.config.apiKeyPreview ?? (snapshot.config.apiKeySaved ? copy.savedLocally : copy.pasteApiKey);
  const launchButtons = useMemo(() => getLaunchButtonStates(snapshot.config, copy), [copy, snapshot.config]);
  const activeLaunchDisplay = launchButtons.find((button) => button.launchId === snapshot.config.activeLaunchId)?.displayName ?? modelLabelFromId(snapshot.config.activeModelId);
  const maxSidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - historyWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
  const maxHistoryWidth = Math.min(MAX_HISTORY_WIDTH, Math.max(MIN_HISTORY_WIDTH, window.innerWidth - sidebarWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return snapshot.history;
    return snapshot.history.filter((job) => {
      const modelDetails = getHistoryModelDetails(job);
      const haystack = `${job.prompt} ${job.mode} ${job.status} ${job.error ?? ""} ${job.createdAt} ${modelDetails.searchText}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [historySearch, snapshot.history]);
  const hasHistoryOverflow = filteredHistory.length > HISTORY_COLLAPSED_LIMIT;
  const visibleHistory = isHistoryExpanded ? filteredHistory : filteredHistory.slice(0, HISTORY_COLLAPSED_LIMIT);
  const isSearchingHistory = historySearch.trim().length > 0;

  const modeError = useMemo(() => {
    if (mode === "edit" && inputAssets.length === 0) return copy.validation.addReference;
    if (mode === "inpaint" && inputAssets.length === 0) return copy.validation.addSource;
    if (openAIParams && mode !== "generate" && inputAssets.length > MAX_GPT_IMAGE_INPUTS) {
      return copy.validation.maxInputs(MAX_GPT_IMAGE_INPUTS);
    }
    if (mode === "inpaint" && !maskPreview) return copy.validation.paintOrUploadMask;
    if (usesExactMask && mode === "inpaint" && maskCheck && !maskCheck.ok) return maskCheck.message;
    return null;
  }, [copy, inputAssets.length, maskCheck, maskPreview, mode, openAIParams, usesExactMask]);

  const launchRuntimeError = runtimeSelectionError(params, snapshot.config, copy);
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
    setPreviewZoom(1);
  }, [activeImageSource]);

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    if (!bridge || !hasRestoredDraft || !hasUserChangedDraft) return;
    const timer = window.setTimeout(() => {
      bridge
        .saveDraft({
          activeLaunchId: params.launchId,
          activeModelId: params.model,
          mode,
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
  }, [bridge, brushSize, hasRestoredDraft, hasUserChangedDraft, inputAssets, maskAsset, maskDataUrl, mode, params, prompt]);

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
    if (mode !== "inpaint" || !mask) {
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
  }, [copy, inputAssets, maskAsset?.mimeType, maskPreview, mode, sourcePreview, usesExactMask]);

  async function refreshSnapshot() {
    if (!bridge) return;
    setIsLoadingSnapshot(true);
    try {
      const next = await bridge.getSnapshot();
      setSnapshot(next);
      setProviderKind(next.config.kind);
      setBaseURL(next.config.baseURL);
      syncParamsToConfig(next.config);
      if (!hasRestoredDraft) {
        restoreDraft(next.draft, next.config);
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  function restoreDraft(draft?: WorkspaceDraft, config = snapshot.config) {
    setHasRestoredDraft(true);
    if (!draft) return;
    setMode(draft.mode);
    setPrompt(draft.prompt);
    setParams(draft.params);
    updateCustomSizeFromParams(draft.params, setCustomSize);
    setProviderKind(draft.params.providerKind);
    setBaseURL(defaultBaseURLForProvider(draft.params.providerKind, config.baseURL));
    setInputAssets(draft.inputAssets);
    setMaskAsset(draft.maskAsset ?? null);
    setMaskDataUrl(draft.maskDataUrl ?? null);
    setBrushSize(draft.brushSize);
    setDraftUpdatedAt(draft.updatedAt);
    setNotice({ kind: "info", text: paramsNotice(draft.params, copy.notices.draftRestored(formatDate(draft.updatedAt)), copy) });
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

  function updateOpenAIParams(patch: OpenAIParamPatch) {
    markDraftChanged();
    setParams((current) => ({
      ...(isOpenAIImageParams(current) ? current : createOpenAIParams("", current, snapshot.config)),
      ...patch,
      providerKind: "openai",
      launchId: GPT_IMAGE_2_LAUNCH_ID
    }));
  }

  function updateGeminiParams(patch: GeminiParamPatch) {
    markDraftChanged();
    setParams((current) => ({
      ...(isGeminiImageParams(current) ? current : createGeminiParams("", current, snapshot.config)),
      ...patch,
      providerKind: "gemini",
      launchId: NANO_BANANA_3_LAUNCH_ID
    }));
  }

  function updateGeneralParams(patch: GeneralParamPatch) {
    markDraftChanged();
    setParams((current) => ({
      ...(isGeneralImageParams(current) ? current : createGeneralParams(providerKind, "", current, snapshot.config)),
      ...patch,
      providerKind,
      launchId: GENERAL_LAUNCH_ID
    }));
  }

  function markDraftChanged() {
    if (hasRestoredDraft) {
      setHasUserChangedDraft(true);
    }
  }

  function applyConfig(config: ProviderConfig) {
    setSnapshot((current) => ({ ...current, config }));
    setProviderKind(config.kind);
    setBaseURL(config.baseURL);
  }

  function syncParamsToConfig(config: ProviderConfig) {
    setParams((current) => {
      const nextParams = createParamsForConfig(config, current);
      updateCustomSizeFromParams(nextParams, setCustomSize);
      return nextParams;
    });
  }

  async function saveConfig() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSaveConfig });
      return;
    }
    setIsSavingConfig(true);
    try {
      const providerChanged = providerKind !== snapshot.config.kind;
      const config = await bridge.saveConfig({
        kind: providerKind,
        apiKey: apiKey.trim() ? apiKey : undefined,
        baseURL,
        defaultModel: defaultModelForConfigSave(providerKind, params, snapshot.config),
        defaultSize: defaultSizeForConfigSave(params, snapshot.config),
        defaultQuality: defaultQualityForConfigSave(params, snapshot.config),
        timeoutMs: params.timeoutMs,
        activeLaunchId: providerChanged ? undefined : snapshot.config.activeLaunchId,
        activeModelId: providerChanged ? undefined : snapshot.config.activeModelId
      });
      applyConfig(config);
      syncParamsToConfig(config);
      setApiKey("");
      setNotice({
        kind: config.lastModelDiscoveryError ? "error" : "success",
        text: config.lastModelDiscoveryError ? config.lastModelDiscoveryError : copy.notices.configSaved
      });
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

  function changeProvider(kind: ProviderKind) {
    markDraftChanged();
    setProviderKind(kind);
    setBaseURL(defaultBaseURLForProvider(kind, baseURL));
  }

  async function launchModel(button: LaunchButtonState) {
    if (!bridge || !button.available) return;
    const launchProvider = providerForLaunch(button.launchId, snapshot.config.kind);
    const launchConfig = snapshot.config.kind === launchProvider ? snapshot.config : undefined;
    const nextParams = createLaunchParams(button.launchId, button.modelId, params, launchProvider, launchConfig);
    setParams(nextParams);
    updateCustomSizeFromParams(nextParams, setCustomSize);
    markDraftChanged();
    setIsSavingConfig(true);
    try {
      const config = await bridge.saveConfig({
        kind: launchProvider,
        baseURL: defaultBaseURLForProvider(launchProvider, baseURL),
        defaultModel: defaultModelForConfigSave(launchProvider, nextParams, snapshot.config),
        defaultSize: defaultSizeForConfigSave(nextParams, snapshot.config),
        defaultQuality: defaultQualityForConfigSave(nextParams, snapshot.config),
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

  async function testConnection() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeTestConnection });
      return;
    }
    setIsTestingConnection(true);
    try {
      if (apiKey.trim() || baseURL !== snapshot.config.baseURL || providerKind !== snapshot.config.kind) {
        await saveConfig();
      }
      const result = await bridge.testConnection();
      setNotice({ kind: result.ok ? "success" : "error", text: result.message });
      await refreshSnapshot();
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
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

  async function selectImages() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSelectImages });
      return;
    }
    const assets = await bridge.selectImages();
    if (assets.length > 0) {
      markDraftChanged();
      const next = dedupeAssets([...inputAssets, ...assets]);
      const cappedNext = openAIParams ? next.slice(0, MAX_GPT_IMAGE_INPUTS) : next;
      const addedCount = Math.max(0, cappedNext.length - inputAssets.length);
      const capped = Boolean(openAIParams && next.length > MAX_GPT_IMAGE_INPUTS);
      setInputAssets(cappedNext);
      if (mode === "generate") setMode("edit");
      setNotice({
        kind: capped ? "info" : "success",
        text: copy.notices.imagesAdded(addedCount, cappedNext.length, capped, MAX_GPT_IMAGE_INPUTS)
      });
    }
  }

  async function selectMask() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSelectMask });
      return;
    }
    const asset = await bridge.selectMask();
    if (asset) {
      markDraftChanged();
      setMaskAsset(asset);
      setMaskDataUrl(null);
      setMode("inpaint");
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
    setNotice({ kind: "info", text: copy.notices.requestSent(modeLabels[mode].action) });

    try {
      const job = await bridge.runJob({
        mode,
        prompt,
        inputPaths: mode === "generate" ? [] : inputAssets.map((asset) => asset.path),
        maskPath: mode === "inpaint" && !maskDataUrl ? maskAsset?.path : undefined,
        maskDataUrl: mode === "inpaint" && maskDataUrl ? maskDataUrl : undefined,
        params
      });
      setActiveJob(job);
      setSnapshot((current) => ({
        ...current,
        history: [job, ...current.history.filter((item) => item.id !== job.id)]
      }));
      setNotice({ kind: job.status === "succeeded" ? "success" : "error", text: job.error ?? copy.notices.actionFinished(modeLabels[mode].action) });
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

  async function clearHistory() {
    if (!bridge) return;
    try {
      const history = await bridge.clearHistory();
      setSnapshot((current) => ({ ...current, history }));
      setActiveJob(null);
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
    setMode(job.mode);
    setPrompt(job.prompt);
    setParams(job.params);
    updateCustomSizeFromParams(job.params, setCustomSize);
    setProviderKind(job.providerKind);
    setBaseURL(defaultBaseURLForProvider(job.providerKind, baseURL));
    if (job.providerKind === snapshot.config.kind) {
      setSnapshot((current) => ({ ...current, config: patchConfigActiveLaunch(current.config, job) }));
    }
    setInputAssets(job.inputAssets);
    setMaskAsset(job.maskAsset ?? null);
    setMaskDataUrl(null);
    setActiveJob(job);
    setHasUserChangedDraft(true);
    setNotice({ kind: "info", text: paramsNotice(job.params, copy.notices.jobLoaded, copy) });
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
    if (mode !== "inpaint" || !sourcePreview) return;
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
  const maskDescription = geminiParams ? copy.guidedRegionDescription : copy.maskDescription;
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
      <span>{copy.count}</span>
      <strong>{generalParams?.outputCount ?? 1}</strong>
      <span>{copy.timeoutSeconds}</span>
      <strong>{Math.round((generalParams?.timeoutMs ?? params.timeoutMs) / 1000)}</strong>
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
      <label className="checkbox-row">
        <input type="checkbox" checked={openAIParams.stream} onChange={(event) => updateOpenAIParams({ stream: event.target.checked })} />
        {copy.streamPartialPreview}
      </label>
      <label>
        {copy.partialImages}
        <input
          type="number"
          min="0"
          max="3"
          disabled={!openAIParams.stream}
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
      <p className="inline-check error">{copy.generalRuntimeUnsupported}</p>
      <label>
        {copy.count}
        <input type="number" min="1" max="1" value={generalParams?.outputCount ?? 1} onChange={() => updateGeneralParams({ outputCount: 1 })} />
      </label>
      <label>
        {copy.timeoutSeconds}
        <input
          type="number"
          min="30"
          max="600"
          value={Math.round((generalParams?.timeoutMs ?? params.timeoutMs) / 1000)}
          onChange={(event) => updateGeneralParams({ timeoutMs: clamp(Number(event.target.value), 30, 600) * 1000 })}
        />
      </label>
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
          <img className="brand-icon" src="/favicon.svg" alt="" />
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

        <section className="update-panel">
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
          <div className="button-row">
            <button type="button" className="secondary" onClick={checkForUpdates} disabled={!bridge || isCheckingUpdate || isInstallingUpdate}>
              {isCheckingUpdate ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {isCheckingUpdate ? copy.checkingUpdates : copy.checkUpdates}
            </button>
            <button
              type="button"
              onClick={downloadAndInstallUpdate}
              disabled={!bridge || updateCheck?.status !== "available" || isCheckingUpdate || isInstallingUpdate}
            >
              {isInstallingUpdate ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              {isInstallingUpdate ? copy.downloadingUpdate : copy.installUpdate}
            </button>
          </div>
        </section>

        <form
          className="tool-section"
          onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}
        >
          <div className="section-title">
            <KeyRound size={16} />
            <h2>{copy.provider}</h2>
          </div>
          <label>
            {copy.providerLabel}
            <select value={providerKind} onChange={(event) => changeProvider(event.target.value as ProviderKind)}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            {copy.apiKey}
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={apiKeyPlaceholder}
            />
          </label>
          <label>
            {copy.baseURL}
            <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" onClick={saveConfig} disabled={isSavingConfig}>
              {isSavingConfig ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {copy.save}
            </button>
            <button type="button" className="secondary" onClick={testConnection} disabled={isTestingConnection}>
              {isTestingConnection ? <Loader2 className="spin" size={16} /> : <PlugZap size={16} />}
              {copy.test}
            </button>
            <button type="button" className="ghost" onClick={clearApiKey} disabled={isClearingApiKey || !snapshot.config.apiKeySaved}>
              {isClearingApiKey ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              {copy.clearKey}
            </button>
          </div>
          <div className="config-status">
            <span className={snapshot.config.apiKeySaved ? "dot ok" : "dot"} />
            {snapshot.config.apiKeySaved ? copy.keySaved : copy.noKeySaved}
          </div>
          <div className="model-discovery-status" data-kind={snapshot.config.lastModelDiscoveryError ? "error" : "info"}>
            <span>{copy.discoveryStatus}</span>
            <strong>
              {snapshot.config.lastModelDiscoveryError
                ? snapshot.config.lastModelDiscoveryError
                : snapshot.config.lastModelDiscoveryAt
                  ? copy.discoveryLastRun(formatDate(snapshot.config.lastModelDiscoveryAt), snapshot.config.discoveredModels.length)
                  : copy.discoveryNotRun}
            </strong>
          </div>
          <button type="button" className="secondary discover-button" onClick={discoverModels} disabled={!bridge || isDiscoveringModels || !snapshot.config.apiKeySaved}>
            {isDiscoveringModels ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {isDiscoveringModels ? copy.discoveringModels : copy.discoverModels}
          </button>
          <div className="launch-strip" aria-label={copy.launchModels}>
            <div className="launch-strip-header">
              <span>{copy.launchModels}</span>
              <strong>{activeLaunchDisplay}</strong>
            </div>
            {launchButtons.map((button) => (
              <button
                key={button.launchId}
                type="button"
                className={snapshot.config.activeLaunchId === button.launchId ? "launch-button active" : "launch-button"}
                onClick={() => launchModel(button)}
                disabled={!button.available || isSavingConfig}
                title={button.reason}
              >
                <span>{button.displayName}</span>
                <small>{button.available ? button.modelId || copy.generalFallback : button.reason}</small>
              </button>
            ))}
          </div>
        </form>

        <section className="tool-section">
          <button type="button" className="section-toggle" onClick={() => setShowAdvanced((current) => !current)}>
            <SlidersHorizontal size={16} />
            {copy.parameters}
            <span>{showAdvanced ? copy.hide : copy.show}</span>
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
          <div className="mode-tabs" role="tablist" aria-label={copy.parameters}>
            {(Object.keys(modeLabels) as WorkMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={mode === item ? "mode-tab active" : "mode-tab"}
                onClick={() => {
                  markDraftChanged();
                  setMode(item);
                }}
              >
                {item === "generate" && <Wand2 size={16} />}
                {item === "edit" && <ImagePlus size={16} />}
                {item === "inpaint" && <Brush size={16} />}
                <span>{modeLabels[item].title}</span>
                <small>{modeLabels[item].hint}</small>
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={refreshSnapshot} disabled={isLoadingSnapshot}>
            {isLoadingSnapshot ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {copy.sync}
          </button>
        </div>

        <div className="preview-layout">
          <section className="result-stage">
            <div className="stage-toolbar">
              <div>
                <p className="eyebrow">{copy.preview}</p>
                <h2>{activeJob ? `${modeLabels[activeJob.mode].title} ${copy.resultSuffix}` : copy.outputCanvas}</h2>
              </div>
              <div className="stage-actions">
                <button type="button" className="icon-button" disabled={!activeImage} onClick={() => adjustPreviewZoom(-PREVIEW_ZOOM_STEP)} title={copy.zoomOut}>
                  <ZoomOut size={17} />
                </button>
                <span className="zoom-readout" title={copy.zoomLevel}>{previewZoomPercent}%</span>
                <button type="button" className="icon-button" disabled={!activeImage} onClick={() => adjustPreviewZoom(PREVIEW_ZOOM_STEP)} title={copy.zoomIn}>
                  <ZoomIn size={17} />
                </button>
                <button type="button" className="ghost reset-zoom" disabled={!activeImage || previewZoom === 1} onClick={() => setPreviewZoom(1)}>
                  {copy.resetZoom}
                </button>
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
                <div className="zoom-surface">
                  <img src={activeImageSource} alt={copy.generatedResult} style={{ width: `${previewZoom * 100}%` }} />
                </div>
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
                  {isRunning ? copy.running : modeLabels[mode].action}
                </button>
                <button type="button" className={buttonFeedbackClass("copy:prompt", "secondary")} onClick={() => copyPrompt(prompt)}>
                  <Clipboard size={16} />
                  {buttonFeedback["copy:prompt"] ? copy.clicked : copy.copy}
                </button>
              </div>
              {validationError && <p className="inline-check error">{validationError}</p>}
            </div>

            <div className="asset-tools">
              <button type="button" className="secondary" onClick={selectImages}>
                <ImagePlus size={16} />
                {copy.addReferences}
              </button>
              <button type="button" className="secondary" onClick={selectMask}>
                <Paintbrush size={16} />
                {copy.uploadMask}
              </button>
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

            <div className="reference-grid">
              {inputAssets.length === 0 ? (
                <div className="empty-inline">{copy.noReferences}</div>
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

            {mode === "inpaint" && (
              <div className="mask-editor">
                <div className="mask-header">
                  <div>
                    <h3>{copy.mask}</h3>
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
          <button type="button" className="icon-button" onClick={clearHistory} disabled={snapshot.history.length === 0} title={copy.clearHistory}>
            <Trash2 size={16} />
          </button>
        </header>

        <label className="search-box">
          <Search size={15} />
          <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder={copy.searchPrompt} />
        </label>

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
                    {result ? <img src={assetSource(result)} alt={copy.historyResult} /> : <span>{job.status}</span>}
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
