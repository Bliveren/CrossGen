import { Profiler, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  Brush,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  FileDown,
  FileUp,
  Eraser,
  Folder,
  FolderCog,
  FolderInput,
  FolderOpen,
  FolderPlus,
  History,
  Images,
  ImageUp,
  KeyRound,
  Layers,
  List,
  Loader2,
  LibraryBig,
  Monitor,
  Moon,
  Paintbrush,
  Pencil,
  Radar,
  RefreshCw,
  Rocket,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  Tags,
  Trash2,
  Plus,
  Type,
  X
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
  GalleryAsset,
  GalleryFolder,
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
  StorageKind,
  WorkMode,
  UpdateCheckResult,
  HistoryJobPatch,
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
import { PromptComposer } from "./PromptComposer";
import { ImageEditor } from "./ImageEditor";
import { DialogShell } from "./DialogShell";
import { HistoryFilterToolbar, HistoryFloatingPager, HistoryItemCard, HistoryListShell } from "./HistoryPanel";
import { ApiConfigDialog, LaunchSection, ProviderSummarySection } from "./ProviderConfigPanel";
import { ParameterSection } from "./ParameterConfigPanel";
import {
  GalleryCompactControls,
  GalleryContentGrid,
  GalleryDirectoryTree,
  GallerySortToolbar,
  GalleryTreeRows,
  type GalleryExplorerEntry,
  type GalleryFolderFilter,
  type GallerySortMode,
  type GalleryViewMode
} from "./GalleryPanel";
import { getInitialLanguage, localizeValidationMessage, translations, type Language, type UiCopy } from "./i18n";
import { useImageEditor } from "./useImageEditor";
import { useHistoryListModel } from "./useHistoryListModel";
import {
  GALLERY_ALL_FILTER,
  GALLERY_CONTENT_DEFAULT_HEIGHT,
  GALLERY_CONTENT_DEFAULT_WIDTH,
  GALLERY_UNCATEGORIZED_FILTER,
  useGalleryExplorerModel
} from "./useGalleryExplorerModel";
import {
  MIN_TEXT_BOX_SIZE,
  type AnnotationTextBox,
  type CanvasPoint,
  type CanvasRect,
  type EditorSnapshot
} from "./imageEditorTypes";
import { serializePromptTokens, type PromptToken } from "./promptTokens";

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

interface GlobalTooltip {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
}

interface ConfirmDialogState {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}

type GalleryFolderDialogState =
  | { mode: "create"; parentId?: string | null }
  | { mode: "rename"; folder: GalleryFolder };
interface GallerySaveChoiceDialogState {
  asset: GalleryAsset;
  dataUrl: string;
  suggestedName: string;
}
type BatchTagTarget = "history" | "gallery";
type ImageContextMenuState = { x: number; y: number; asset: ImageAsset; jobPrompt: string };
type CrossgenProfilerEvent = {
  id: string;
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};

declare global {
  interface Window {
    __crossgenProfilerEvents?: CrossgenProfilerEvent[];
  }
}

function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (typeof window === "undefined" || !window.__crossgenProfilerEvents) {
    return <>{children}</>;
  }

  return (
    <Profiler
      id={id}
      onRender={(profilerId, phase, actualDuration, baseDuration, startTime, commitTime) => {
        window.__crossgenProfilerEvents?.push({
          id: profilerId,
          phase,
          actualDuration,
          baseDuration,
          startTime,
          commitTime
        });
      }}
    >
      {children}
    </Profiler>
  );
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
const DEFAULT_HISTORY_WIDTH = 310;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 430;
const MIN_HISTORY_WIDTH = 300;
const MAX_HISTORY_WIDTH = 460;
const MIN_WORKSPACE_WIDTH = 620;
const COMPACT_SIDEBAR_WIDTH = 76;
const RIGHT_RAIL_COLLAPSED_WIDTH = 256;
const MIN_RIGHT_RAIL_WIDTH = 176;
const RIGHT_RAIL_STACKED_WIDTH = 330;
const RIGHT_RAIL_DENSE_WIDTH = 292;
const RIGHT_RAIL_THUMB_MAX_SIZE = 180;
const RIGHT_RAIL_THUMB_MIN_SIZE = 128;
const RIGHT_RAIL_THUMB_HORIZONTAL_CHROME = 48;
const LEFT_RAIL_AUTO_COLLAPSE_WIDTH = MIN_SIDEBAR_WIDTH;
const RIGHT_RAIL_AUTO_COLLAPSE_WIDTH = MIN_HISTORY_WIDTH;
const DEFAULT_PREVIEW_PANEL_RATIO = 0.618;
const MIN_PREVIEW_PANEL_RATIO = 0.48;
const MAX_PREVIEW_PANEL_RATIO = 0.74;
const RESIZER_WIDTH = 12;
const HISTORY_COLLAPSED_LIMIT = 6;
const HISTORY_PAGE_SIZE_OPTIONS = [6, 12, 24, 48];
const DEFAULT_HISTORY_MODEL_DISPLAY = "GPT Image 2";
const PROMPT_ACTION_ICON_BUTTON_WIDTH = 40;
const PROMPT_ACTION_EDGE_GUARD = 4;
type TabMode = "text2img" | "img2img";
type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "image2tools.theme";
const RELEASE_GUIDE_STORAGE_KEY = "image2tools.releaseGuide.seenVersion";
const themeModeOrder: ThemeMode[] = ["system", "light", "dark"];

function getInitialThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyThemeMode(mode: ThemeMode) {
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
    return;
  }
  document.documentElement.dataset.theme = mode;
}

function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = themeModeOrder.indexOf(mode);
  return themeModeOrder[(index + 1) % themeModeOrder.length] ?? "system";
}

function themeModeLabel(copy: UiCopy, mode: ThemeMode): string {
  if (mode === "light") return copy.themeLight;
  if (mode === "dark") return copy.themeDark;
  return copy.themeSystem;
}

function getReferenceImageLimit(params: ImageParams): number {
  if (isOpenAIImageParams(params)) {
    return getFocusedModelDefinition(GPT_IMAGE_2_LAUNCH_ID)?.capabilities.maxReferenceImages ?? MAX_GPT_IMAGE_INPUTS;
  }
  if (isGeminiImageParams(params)) {
    return getFocusedModelDefinition(NANO_BANANA_3_LAUNCH_ID)?.capabilities.maxReferenceImages ?? 2;
  }
  if (isGeneralImageParams(params) && generalFallbackSupportsReferenceImages(params.providerKind)) {
    return getFocusedModelDefinition(NANO_BANANA_3_LAUNCH_ID)?.capabilities.maxReferenceImages ?? 2;
  }
  return 0;
}

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
  promptTemplates: [],
  galleryFolders: [],
  galleryAssets: [],
  storage: {
    historyDir: "",
    galleryDir: ""
  }
};

function getBridge() {
  return window.crossgen ?? window.image2tools;
}

function assetSource(asset?: ImageAsset | InputAsset | null): string | undefined {
  if (!asset) return undefined;
  if ("previewUrl" in asset && asset.previewUrl) return asset.previewUrl;
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

function historyDisplayName(job: GenerationJob): string {
  const name = job.name?.trim();
  if (name) return name;
  const result = getBestResult(job);
  return result?.fileName ?? `${job.modelDisplayName || job.modelId || "image"}-${job.id.slice(-8)}.png`;
}

function historySystemTagLabel(mode: WorkMode, language: Language): string {
  if (mode === "generate") return language === "zh" ? "生成" : "Generate";
  return language === "zh" ? "编辑" : "Edit";
}

function normalizeTagList(value: string | string[]): string[] {
  const rawTags = Array.isArray(value) ? value : value.split(",");
  const seen = new Set<string>();
  return rawTags.flatMap((item) => {
    const tag = item.trim();
    if (!tag || seen.has(tag)) return [];
    seen.add(tag);
    return [tag];
  });
}

function mergeTags(existing: string[], additions: string[]): string[] {
  return normalizeTagList([...existing, ...additions]);
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

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureButtonTextWidth(text: string, element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const measurer = document.createElement("span");
  measurer.textContent = text;
  measurer.style.position = "absolute";
  measurer.style.left = "-9999px";
  measurer.style.top = "-9999px";
  measurer.style.visibility = "hidden";
  measurer.style.whiteSpace = "nowrap";
  measurer.style.font = style.font;
  measurer.style.letterSpacing = style.letterSpacing;
  document.body.append(measurer);
  const width = measurer.getBoundingClientRect().width;
  measurer.remove();
  return width;
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
  if (isGeminiImageParams(params)) return params.model;
  if (kind === "openai") {
    return isOpenAIImageParams(params) ? params.model : GPT_IMAGE_2_MODEL_ID;
  }
  if (kind === "gemini") return NANO_BANANA_3_MODEL_ID;
  if (kind === config.kind && config.defaultModel) return config.defaultModel;
  return defaultModelForProvider(kind);
}

function hasDiscoveredProviderModel(config: ProviderConfig, providerKind: ProviderKind, modelId: string): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  return config.discoveredModels.some((model) => model.providerKind === providerKind && normalizeModelId(model.id) === normalizedModelId);
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
    if (config.activeLaunchId !== NANO_BANANA_3_LAUNCH_ID) return copy.selectLaunchToRun("Nano Banana 3");
    if (config.kind === "gemini" || hasDiscoveredProviderModel(config, "gemini", params.model)) return null;
    return copy.launchUnavailableModel(params.model);
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

function discoveredModelLabel(model: ProviderConfig["discoveredModels"][number]): string {
  const display = model.displayName?.trim();
  return display && display !== model.id ? `${display} (${model.id})` : model.id;
}

function discoveredModelTooltip(config: ProviderConfig, copy: UiCopy): string {
  if (config.lastModelDiscoveryError) return config.lastModelDiscoveryError;
  if (config.discoveredModels.length === 0) return copy.apiAccessNoModels;
  return config.discoveredModels.map(discoveredModelLabel).join("\n");
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

function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const copy = translations[language];
  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);
  const [tabMode, setTabMode] = useState<TabMode>("text2img");
  const [prompt, setPrompt] = useState("A clean product photo of a matte black travel mug on a brushed steel counter");
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const [promptTokenAssets, setPromptTokenAssets] = useState<Record<string, InputAsset>>({});
  const [params, setParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS);
  const modeLabels = useMemo(() => modeLabelsForParams(copy, params), [copy, params]);
  const [apiKey, setApiKey] = useState("");
  const [apiAccessName, setApiAccessName] = useState("OpenAI");
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [isActiveApiConfigOpen, setIsActiveApiConfigOpen] = useState(false);
  const [selectedApiConfigId, setSelectedApiConfigId] = useState<string | null>(null);
  const [promotedApiConfigId, setPromotedApiConfigId] = useState<string | null>(null);
  const [savedApiConfigId, setSavedApiConfigId] = useState<string | null>(null);
  const [isAddingApiAccess, setIsAddingApiAccess] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAutoSidebarCollapsed, setIsAutoSidebarCollapsed] = useState(() => window.innerWidth <= 1320);
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
  const [discoveringProviderId, setDiscoveringProviderId] = useState<string | null>(null);
  const [isClearingApiKey, setIsClearingApiKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck>({ status: "idle" });
  const [isRunning, setIsRunning] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [arePromptSecondaryActionsIconOnly, setArePromptSecondaryActionsIconOnly] = useState(false);
  const [isPrimaryRunIconOnly, setIsPrimaryRunIconOnly] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openLaunchMenuId, setOpenLaunchMenuId] = useState<FocusedLaunchId | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "succeeded" | "failed">("all");
  const [historySort, setHistorySort] = useState<"newest" | "oldest">("newest");
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [historyPageSize, setHistoryPageSize] = useState(HISTORY_COLLAPSED_LIMIT);
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const [historyViewMode, setHistoryViewMode] = useState<GalleryViewMode>("list");
  const [isHistoryBatchMode, setIsHistoryBatchMode] = useState(false);
  const [selectedHistoryJobIds, setSelectedHistoryJobIds] = useState<Set<string>>(() => new Set());
  const [isHistoryPageSizeMenuOpen, setIsHistoryPageSizeMenuOpen] = useState(false);
  const [historyListScrollState, setHistoryListScrollState] = useState({ top: 0, clientHeight: 0, scrollHeight: 0 });
  const [editingHistoryNameId, setEditingHistoryNameId] = useState<string | null>(null);
  const [historyNameDraft, setHistoryNameDraft] = useState("");
  const [editingHistoryTagsId, setEditingHistoryTagsId] = useState<string | null>(null);
  const [historyTagsInput, setHistoryTagsInput] = useState("");
  const [historyGalleryMenuJobId, setHistoryGalleryMenuJobId] = useState<string | null>(null);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [rightRailView, setRightRailView] = useState<"history" | "gallery">("history");
  const [isRightRailCollapsed, setIsRightRailCollapsed] = useState(false);
  const [isRightRailActionDrawerOpen, setIsRightRailActionDrawerOpen] = useState(false);
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryTagFilter, setGalleryTagFilter] = useState("");
  const [gallerySort, setGallerySort] = useState<GallerySortMode>("newest");
  const [isGallerySortMenuOpen, setIsGallerySortMenuOpen] = useState(false);
  const [galleryViewMode, setGalleryViewMode] = useState<GalleryViewMode>("grid");
  const [isGalleryBatchMode, setIsGalleryBatchMode] = useState(false);
  const [galleryContentScrollTop, setGalleryContentScrollTop] = useState(0);
  const [galleryContentViewport, setGalleryContentViewport] = useState({ width: GALLERY_CONTENT_DEFAULT_WIDTH, height: GALLERY_CONTENT_DEFAULT_HEIGHT });
  const [activeGalleryFolderId, setActiveGalleryFolderId] = useState<GalleryFolderFilter>(GALLERY_ALL_FILTER);
  const [isGalleryFolderMenuOpen, setIsGalleryFolderMenuOpen] = useState(false);
  const [galleryFolderContextMenu, setGalleryFolderContextMenu] = useState<{ x: number; y: number; folderId: GalleryFolderFilter } | null>(null);
  const [galleryAssetContextMenu, setGalleryAssetContextMenu] = useState<{ x: number; y: number; assetId: string } | null>(null);
  const [galleryFolderDragTarget, setGalleryFolderDragTarget] = useState<GalleryFolderFilter | null>(null);
  const [expandedGalleryFolderIds, setExpandedGalleryFolderIds] = useState<Set<string>>(() => new Set());
  const [selectedGalleryAssetIds, setSelectedGalleryAssetIds] = useState<Set<string>>(() => new Set());
  const [selectedGalleryFolderIds, setSelectedGalleryFolderIds] = useState<Set<string>>(() => new Set());
  const [lastGallerySelectionIndex, setLastGallerySelectionIndex] = useState<number | null>(null);
  const [historyGalleryFolderId, setHistoryGalleryFolderId] = useState("");
  const [newGalleryFolderName, setNewGalleryFolderName] = useState("");
  const [galleryFolderDialog, setGalleryFolderDialog] = useState<GalleryFolderDialogState | null>(null);
  const [galleryFolderDialogName, setGalleryFolderDialogName] = useState("");
  const [galleryFolderDialogError, setGalleryFolderDialogError] = useState("");
  const [activeGalleryAssetId, setActiveGalleryAssetId] = useState<string | null>(null);
  const [gallerySaveChoiceDialog, setGallerySaveChoiceDialog] = useState<GallerySaveChoiceDialogState | null>(null);
  const [editingGalleryFolderId, setEditingGalleryFolderId] = useState<string | null>(null);
  const [editingGalleryFolderName, setEditingGalleryFolderName] = useState("");
  const [editingGalleryNameId, setEditingGalleryNameId] = useState<string | null>(null);
  const [galleryNameDraft, setGalleryNameDraft] = useState("");
  const [editingGalleryId, setEditingGalleryId] = useState<string | null>(null);
  const [galleryTagsInput, setGalleryTagsInput] = useState("");
  const [batchTagMenuTarget, setBatchTagMenuTarget] = useState<BatchTagTarget | null>(null);
  const [batchTagInput, setBatchTagInput] = useState("");
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [tagRenameDrafts, setTagRenameDrafts] = useState<Record<string, string>>({});
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [storageDialogKind, setStorageDialogKind] = useState<StorageKind | null>(null);
  const [syncStorageFolders, setSyncStorageFolders] = useState(false);
  const [brushSize, setBrushSize] = useState(72);
  const [isPainting, setIsPainting] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [hasUserChangedDraft, setHasUserChangedDraft] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [isReleaseGuideOpen, setIsReleaseGuideOpen] = useState(false);
  const {
    previewZoom,
    setPreviewZoom,
    previewPan,
    setPreviewPan,
    isPanning,
    setIsPanning,
    previewMode,
    setPreviewMode,
    annotationTool,
    setAnnotationTool,
    annotationColor,
    setAnnotationColor,
    annotationSize,
    setAnnotationSize,
    annotationTextSize,
    setAnnotationTextSize,
    isAnnotationTextBold,
    setIsAnnotationTextBold,
    isAnnotationColorSampling,
    setIsAnnotationColorSampling,
    sampledAnnotationColor,
    setSampledAnnotationColor,
    annotationDrawingLayers,
    setAnnotationDrawingLayers,
    annotationTextBoxes,
    setAnnotationTextBoxes,
    activeAnnotationTextBoxId,
    setActiveAnnotationTextBoxId,
    draftTextRect,
    setDraftTextRect,
    isDrawingAnnotation,
    setIsDrawingAnnotation,
    hasAnnotationMarks,
    setHasAnnotationMarks,
    editedImageDataUrl,
    setEditedImageDataUrl,
    editorUndoStack,
    setEditorUndoStack,
    isAnnotationColorPickerOpen,
    setIsAnnotationColorPickerOpen,
    cropShape,
    setCropShape,
    cropSelection,
    setCropSelection,
    annotationCanvasRef,
    annotationImageRef,
    annotationFrameRef,
    annotationLastPointRef,
    isAnnotationPointerActiveRef,
    textDragStartRef,
    textResizeRef,
    annotationOrderRef,
    cropDragStartRef,
    panStartRef,
    resultCanvasRef,
    zoomSurfaceRef,
    previewZoomPercent,
    isEditingPreview,
    isCroppingPreview,
    isPreviewCanvasInteractive,
    hasEditorOverlay,
    hasExportableEditorOverlay,
    hasEditedPreviewChanges
  } = useImageEditor();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isReferenceDragOver, setIsReferenceDragOver] = useState(false);
  const [referenceLimitToast, setReferenceLimitToast] = useState<{ id: number; text: string } | null>(null);
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, number>>({});
  const [globalTooltip, setGlobalTooltip] = useState<GlobalTooltip | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth("image2tools.sidebarWidth", DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
  const [historyWidth, setHistoryWidth] = useState(() => readStoredWidth("image2tools.historyWidth", DEFAULT_HISTORY_WIDTH, MIN_RIGHT_RAIL_WIDTH, MAX_HISTORY_WIDTH));
  const [previewPanelRatio, setPreviewPanelRatio] = useState(() => readStoredWidth("image2tools.previewPanelRatio", DEFAULT_PREVIEW_PANEL_RATIO, MIN_PREVIEW_PANEL_RATIO, MAX_PREVIEW_PANEL_RATIO));
  const [resizingColumn, setResizingColumn] = useState<"sidebar" | "history" | "preview" | null>(null);
  const [contextMenu, setContextMenu] = useState<ImageContextMenuState | null>(null);
  const [sidebarCollapseButtonY, setSidebarCollapseButtonY] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight - 86));
  const [rightRailCollapseButtonY, setRightRailCollapseButtonY] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight - 86));

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const galleryContentRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const referenceLimitToastTimerRef = useRef<number | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const paintedDuringStrokeRef = useRef(false);
  const hasAutoTestedConnectionRef = useRef(false);
  const previewLayoutRef = useRef<HTMLDivElement | null>(null);
  const promptActionsRef = useRef<HTMLDivElement | null>(null);
  const primaryRunButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptTemplateButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarUtilityBarRef = useRef<HTMLElement | null>(null);
  const rightRailActionsRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const historyWidthRef = useRef(historyWidth);
  const expandedHistoryWidthRef = useRef(Math.max(historyWidth, MIN_HISTORY_WIDTH));

  const activeConfig = snapshot.providers.find(p => p.id === snapshot.activeProviderId) ?? snapshot.providers[0];
  const isSidebarCompact = isSidebarCollapsed || isAutoSidebarCollapsed;
  const selectedApiConfig = snapshot.providers.find(p => p.id === selectedApiConfigId) ?? activeConfig;
  const isDiscoveringModels = discoveringProviderId !== null;
  const serializedPromptPreview = useMemo(
    () => serializePromptTokens([{ type: "text", text: prompt }, ...promptTokens], { resolveAsset: resolvePromptTokenAsset }),
    [prompt, promptTokenAssets, promptTokens]
  );
  const effectivePrompt = serializedPromptPreview.prompt;
  const effectiveInputAssets = useMemo(
    () => dedupeAssets([...inputAssets, ...serializedPromptPreview.inputAssets]),
    [inputAssets, serializedPromptPreview.inputAssets]
  );
  const sourceAsset = effectiveInputAssets[0];
  const sourcePreview = assetSource(sourceAsset);
  const maskPreview = maskDataUrl ?? assetSource(maskAsset);
  const activeResults = getResultAssets(activeJob);
  const selectedResult = activeResults.find((asset) => asset.id === selectedResultId);
  const activeGalleryAsset = activeGalleryAssetId ? snapshot.galleryAssets.find((asset) => asset.id === activeGalleryAssetId) : undefined;
  const activeGalleryPreviewImage: ImageAsset | undefined = activeGalleryAsset ? {
    id: `gallery_preview_${activeGalleryAsset.id}_${activeGalleryAsset.updatedAt}`,
    jobId: `gallery:${activeGalleryAsset.id}`,
    path: galleryAssetAbsolutePath(activeGalleryAsset),
    fileName: activeGalleryAsset.originalName,
    mimeType: activeGalleryAsset.mimeType,
    width: activeGalleryAsset.width,
    height: activeGalleryAsset.height,
    sourceType: "result",
    createdAt: activeGalleryAsset.createdAt
  } : undefined;
  const activeImage = activeGalleryPreviewImage ?? selectedResult ?? getBestResult(activeJob) ?? partialImages[partialImages.length - 1];
  const activeImageSource = activeGalleryAsset ? galleryAssetPath(activeGalleryAsset) : assetSource(activeImage);
  const activePreviewSource = editedImageDataUrl ?? activeImageSource;
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
    ? generalAllowsReferences && effectiveInputAssets.length > 0
      ? "edit"
      : "generate"
    : tabMode === "text2img"
      ? "generate"
      : hasMask
        ? "inpaint"
        : "edit";
  const showReferenceTools = generalParams ? generalAllowsReferences || effectiveInputAssets.length > 0 : tabMode === "img2img";
  const activeReferenceImageLimit = getReferenceImageLimit(params);
  const generalModeNotice = generalParams ? generalRuntimeNotice(generalParams.providerKind, copy) : copy.generalRuntimeUnsupported;
  const activeInpaintCapability = inpaintCapabilityForParams(params);
  const usesExactMask = activeInpaintCapability === "exact-mask";
  const sizeSelectValue = openAIParams && sizePresets.includes(openAIParams.size) ? openAIParams.size : "custom";
  const apiKeyPlaceholder = selectedApiConfig.apiKeyPreview ?? (selectedApiConfig.apiKeySaved ? copy.savedLocally : copy.pasteApiKey);
  const launchButtons = useMemo(() => getLaunchButtonStates(activeConfig, copy), [copy, activeConfig]);
  const activeLaunchDisplay = launchButtons.find((button) => button.launchId === activeConfig.activeLaunchId)?.displayName ?? modelLabelFromId(activeConfig.activeModelId);
  const connectionLabel = connectionStatusLabel(connectionCheck, copy);
  const connectionTitle = connectionCheck.status === "error" && connectionCheck.message ? copy.connectionErrorDetail(connectionCheck.message) : connectionLabel;
  const connectionErrorText = connectionCheck.status === "error" && connectionCheck.message ? copy.connectionErrorDetail(connectionCheck.message) : null;
  const discoveryText = discoverySummary(activeConfig, copy);
  const selectedDiscoveryText = discoverySummary(selectedApiConfig, copy);
  const selectedModelSummary = selectedApiConfig.lastModelDiscoveryError
    ?? (selectedApiConfig.lastModelDiscoveryAt || selectedApiConfig.discoveredModels.length > 0 ? selectedDiscoveryText : copy.apiAccessNoModels);
  const isSelectedConfigSaved = savedApiConfigId === selectedApiConfig.id && selectedApiConfig.apiKeySaved && !apiKey.trim();
  const inactiveApiConfigs = snapshot.providers.filter((config) => config.id !== activeConfig.id);
  const maxSidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - historyWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
  const maxHistoryWidth = Math.min(MAX_HISTORY_WIDTH, Math.max(MIN_RIGHT_RAIL_WIDTH, window.innerWidth - sidebarWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
  const isRightRailStacked = historyWidth <= RIGHT_RAIL_STACKED_WIDTH;
  const isRightRailDense = historyWidth <= RIGHT_RAIL_DENSE_WIDTH;
  const isRightRailCompact = isRightRailCollapsed || historyWidth <= RIGHT_RAIL_COLLAPSED_WIDTH;
  const rightRailLayoutMode = isRightRailCompact ? "compact" : isRightRailDense ? "dense" : isRightRailStacked ? "stacked" : "full";
  const rightRailThumbSize = clamp(
    historyWidth - RIGHT_RAIL_THUMB_HORIZONTAL_CHROME,
    RIGHT_RAIL_THUMB_MIN_SIZE,
    RIGHT_RAIL_THUMB_MAX_SIZE
  );

  const setShellWidthVariable = (name: "--sidebar-width" | "--history-width", value: number) => {
    appShellRef.current?.style.setProperty(name, `${Math.round(value)}px`);
  };

  const applyRightRailWidth = (nextWidth: number, options: { forceCollapsed?: boolean } = {}) => {
    const clampedWidth = clamp(nextWidth, MIN_RIGHT_RAIL_WIDTH, maxHistoryWidth);
    historyWidthRef.current = clampedWidth;
    setShellWidthVariable("--history-width", clampedWidth);
    setHistoryWidth(clampedWidth);
    if (clampedWidth >= MIN_HISTORY_WIDTH) {
      expandedHistoryWidthRef.current = clampedWidth;
    }
    setIsRightRailCollapsed(options.forceCollapsed ?? clampedWidth <= RIGHT_RAIL_COLLAPSED_WIDTH);
  };

  const getRightRailAutoCollapseWidth = () => {
    const actionsNode = rightRailActionsRef.current;
    if (!actionsNode) return RIGHT_RAIL_AUTO_COLLAPSE_WIDTH;
    const summaryNode = actionsNode.querySelector<HTMLElement>(".right-rail-summary");
    const actionGroupNode = actionsNode.querySelector<HTMLElement>(".right-rail-action-group");
    if (!summaryNode || !actionGroupNode) return RIGHT_RAIL_AUTO_COLLAPSE_WIDTH;

    const actionsStyle = window.getComputedStyle(actionsNode);
    const gap = cssPixelValue(actionsStyle.columnGap) || cssPixelValue(actionsStyle.gap) || 10;
    const horizontalPadding =
      cssPixelValue(actionsStyle.paddingLeft) +
      cssPixelValue(actionsStyle.paddingRight) +
      cssPixelValue(actionsStyle.borderLeftWidth) +
      cssPixelValue(actionsStyle.borderRightWidth);
    const requiredWidth =
      summaryNode.scrollWidth +
      actionGroupNode.getBoundingClientRect().width +
      gap +
      horizontalPadding +
      2;
    return Math.max(RIGHT_RAIL_AUTO_COLLAPSE_WIDTH, Math.ceil(requiredWidth));
  };

  function toggleRightRailCollapsed() {
    if (isRightRailCompact) {
      const preferredWidth = Math.max(expandedHistoryWidthRef.current, MIN_HISTORY_WIDTH);
      const targetWidth = clamp(preferredWidth, MIN_RIGHT_RAIL_WIDTH, maxHistoryWidth);
      applyRightRailWidth(targetWidth, { forceCollapsed: false });
      return;
    }

    expandedHistoryWidthRef.current = Math.max(historyWidthRef.current, MIN_HISTORY_WIDTH);
    applyRightRailWidth(RIGHT_RAIL_COLLAPSED_WIDTH, { forceCollapsed: true });
  }

  const {
    filteredHistory,
    tagsAvailable: historyTagsAvailable,
    systemTagsAvailable: historySystemTagsAvailable,
    hasOverflow: hasHistoryOverflow,
    pageCount: historyPageCount,
    normalizedPageIndex: normalizedHistoryPageIndex,
    visibleHistory,
    isSearching: isSearchingHistory,
    pagerVisible: historyPagerVisible
  } = useHistoryListModel({
    history: snapshot.history,
    search: historySearch,
    statusFilter: historyStatusFilter,
    sort: historySort,
    language,
    pageSize: historyPageSize,
    pageIndex: historyPageIndex,
    expanded: isHistoryExpanded,
    scrollState: historyListScrollState,
    displayNameForJob: historyDisplayName,
    systemTagLabelForMode: historySystemTagLabel,
    modelDetailsForJob: getHistoryModelDetails
  });
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return snapshot.promptTemplates.filter((template) => {
      if (!query) return true;
      const haystack = `${template.title} ${template.body}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [snapshot.promptTemplates, templateSearch]);
  const {
    tagsAvailable: galleryTagsAvailable,
    folderById: galleryFolderById,
    foldersByParent: galleryFoldersByParent,
    folderAssetCounts: galleryFolderAssetCounts,
    folderSubtreeAssetCounts: galleryFolderSubtreeAssetCounts,
    currentImportFolderId,
    currentCreateParentId: currentGalleryCreateParentId,
    filteredAssets: filteredGalleryAssets,
    explorerEntries: galleryExplorerEntries,
    virtualStartIndex: galleryVirtualStartIndex,
    virtualEntries: galleryVirtualEntries,
    virtualTopSpacer: galleryVirtualTopSpacer,
    virtualBottomSpacer: galleryVirtualBottomSpacer
  } = useGalleryExplorerModel({
    galleryAssets: snapshot.galleryAssets,
    galleryFolders: snapshot.galleryFolders,
    activeFolderId: activeGalleryFolderId,
    search: gallerySearch,
    tagFilter: galleryTagFilter,
    sort: gallerySort,
    viewMode: galleryViewMode,
    scrollTop: galleryContentScrollTop,
    viewport: galleryContentViewport,
    compact: isRightRailCompact,
    compactItemSize: rightRailThumbSize
  });
  const globalTagOptions = useMemo(() => {
    const tags = new Set<string>();
    [...historyTagsAvailable, ...historySystemTagsAvailable, ...galleryTagsAvailable].forEach((tag) => tags.add(tag));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [galleryTagsAvailable, historySystemTagsAvailable, historyTagsAvailable]);
  const managedTagOptions = useMemo(() => {
    const tags = new Set<string>();
    [...historyTagsAvailable, ...galleryTagsAvailable].forEach((tag) => tags.add(tag));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [galleryTagsAvailable, historyTagsAvailable]);
  const galleryFolderSelectOptions = useMemo(() => [
    { id: GALLERY_ALL_FILTER, name: copy.galleryAllFolders },
    { id: GALLERY_UNCATEGORIZED_FILTER, name: copy.galleryUncategorized },
    ...snapshot.galleryFolders.map((folder) => ({ id: folder.id, name: galleryFolderDisplayPath(folder) }))
  ], [copy.galleryAllFolders, copy.galleryUncategorized, snapshot.galleryFolders, galleryFolderById]);
  const historyGalleryTargetFolderId = historyGalleryFolderId || null;
  const selectedGalleryItemCount = selectedGalleryAssetIds.size + selectedGalleryFolderIds.size;
  const selectedHistoryItemCount = selectedHistoryJobIds.size;
  const canTagSelectedHistory = isHistoryBatchMode && selectedHistoryJobIds.size > 0;
  const canTagSelectedGallery = isGalleryBatchMode && selectedGalleryAssetIds.size > 0;
  const selectedHistoryJobs = useMemo(
    () => snapshot.history.filter((job) => selectedHistoryJobIds.has(job.id)),
    [selectedHistoryJobIds, snapshot.history]
  );
  const selectedGalleryAssets = useMemo(
    () => snapshot.galleryAssets.filter((asset) => selectedGalleryAssetIds.has(asset.id)),
    [selectedGalleryAssetIds, snapshot.galleryAssets]
  );
  const historyDisplayActionLabel = historyViewMode === "grid" ? copy.historyListView : copy.historyGridView;
  const galleryDisplayActionLabel = galleryViewMode === "grid" ? copy.galleryListView : copy.galleryGridView;
  const gallerySortOptions: Array<{ value: GallerySortMode; label: string }> = [
    { value: "newest", label: copy.sortNewest },
    { value: "oldest", label: copy.sortOldest },
    { value: "name", label: copy.sortName },
    { value: "size", label: copy.sortSize },
    { value: "modified", label: copy.sortModified }
  ];
  const gallerySortLabel = gallerySortOptions.find((option) => option.value === gallerySort)?.label ?? copy.sortNewest;
  const selectedTagTarget: BatchTagTarget = rightRailView === "history" ? "history" : "gallery";
  const canTagCurrentSelection = selectedTagTarget === "history" ? canTagSelectedHistory : canTagSelectedGallery;

  function galleryFolderPathForId(folderId: string | null | undefined): GalleryFolder[] {
    if (!folderId) return [];
    const folders: GalleryFolder[] = [];
    const seen = new Set<string>();
    let current = galleryFolderById.get(folderId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      folders.push(current);
      current = current.parentId ? galleryFolderById.get(current.parentId) : undefined;
    }
    return folders.reverse();
  }

  function galleryFolderDisplayPath(folder: GalleryFolder): string {
    return galleryFolderPathForId(folder.id).map((item) => item.name).join(" / ") || folder.name;
  }

  function localPathJoin(basePath: string, relativePath: string): string {
    const separator = basePath.includes("\\") ? "\\" : "/";
    const normalizedBase = basePath.replace(/[\\/]+$/, "");
    const normalizedRelative = relativePath.split("/").join(separator);
    return normalizedBase ? `${normalizedBase}${separator}${normalizedRelative}` : normalizedRelative;
  }

  function galleryAssetAbsolutePath(asset: GalleryAsset): string {
    return localPathJoin(snapshot.storage.galleryDir, asset.fileName);
  }

  function historyGalleryTags(job: GenerationJob): string[] {
    return mergeTags(job.tags, [historySystemTagLabel(job.mode, language)]);
  }

  function historyResultIsInGallery(result?: ImageAsset): boolean {
    if (!result) return false;
    return snapshot.galleryAssets.some((asset) =>
      asset.source === "result" &&
      (asset.sourceAssetId === result.id || (asset.sourceJobId === result.jobId && asset.originalName === result.fileName))
    );
  }

  function isGalleryFolderDescendant(folderId: string, maybeAncestorId: string): boolean {
    let current = galleryFolderById.get(folderId);
    const seen = new Set<string>();
    while (current && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentId === maybeAncestorId) return true;
      current = galleryFolderById.get(current.parentId);
    }
    return false;
  }

  function navigateGalleryFolder(folderId: GalleryFolderFilter) {
    setActiveGalleryFolderId(folderId);
    setIsGalleryFolderMenuOpen(false);
    setGalleryFolderContextMenu(null);
    setGalleryAssetContextMenu(null);
    setLastGallerySelectionIndex(null);
  }

  function toggleGalleryFolderExpanded(folderId: string) {
    setExpandedGalleryFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function expandGalleryFolderPath(folderId: string | null) {
    if (!folderId) return;
    setExpandedGalleryFolderIds((current) => {
      const next = new Set(current);
      galleryFolderPathForId(folderId).forEach((folder) => next.add(folder.id));
      return next;
    });
  }

  function isGalleryEntrySelected(entry: GalleryExplorerEntry): boolean {
    return entry.kind === "folder" ? selectedGalleryFolderIds.has(entry.id) : selectedGalleryAssetIds.has(entry.id);
  }

  function selectOnlyGalleryEntry(entry: GalleryExplorerEntry) {
    setSelectedGalleryFolderIds(new Set(entry.kind === "folder" ? [entry.id] : []));
    setSelectedGalleryAssetIds(new Set(entry.kind === "asset" ? [entry.id] : []));
  }

  function mergeGalleryEntrySelection(entries: GalleryExplorerEntry[], checked = true) {
    setSelectedGalleryFolderIds((current) => {
      const next = new Set(current);
      entries.filter((entry) => entry.kind === "folder").forEach((entry) => {
        if (checked) next.add(entry.id);
        else next.delete(entry.id);
      });
      return next;
    });
    setSelectedGalleryAssetIds((current) => {
      const next = new Set(current);
      entries.filter((entry) => entry.kind === "asset").forEach((entry) => {
        if (checked) next.add(entry.id);
        else next.delete(entry.id);
      });
      return next;
    });
  }

  function toggleGalleryEntrySelection(entry: GalleryExplorerEntry, index: number, event: React.MouseEvent<HTMLInputElement>) {
    const checked = event.currentTarget.checked;
    if (event.shiftKey && lastGallerySelectionIndex !== null) {
      const start = Math.min(lastGallerySelectionIndex, index);
      const end = Math.max(lastGallerySelectionIndex, index);
      mergeGalleryEntrySelection(galleryExplorerEntries.slice(start, end + 1), checked);
    } else if (isGalleryBatchMode || event.metaKey || event.ctrlKey) {
      if (entry.kind === "folder") {
        setSelectedGalleryFolderIds((current) => {
          const next = new Set(current);
          if (checked) next.add(entry.id);
          else next.delete(entry.id);
          return next;
        });
      } else {
        setSelectedGalleryAssetIds((current) => {
          const next = new Set(current);
          if (checked) next.add(entry.id);
          else next.delete(entry.id);
          return next;
        });
      }
    } else if (checked) {
      selectOnlyGalleryEntry(entry);
    } else {
      if (entry.kind === "folder") {
        setSelectedGalleryFolderIds((current) => {
          const next = new Set(current);
          next.delete(entry.id);
          return next;
        });
      } else {
        setSelectedGalleryAssetIds((current) => {
          const next = new Set(current);
          next.delete(entry.id);
          return next;
        });
      }
    }
    setLastGallerySelectionIndex(index);
  }

  function clearGallerySelection() {
    setSelectedGalleryAssetIds(new Set());
    setSelectedGalleryFolderIds(new Set());
    setLastGallerySelectionIndex(null);
  }

  function toggleGalleryBatchMode() {
    setIsGalleryBatchMode((current) => {
      if (current) clearGallerySelection();
      return !current;
    });
  }

  function toggleHistoryBatchMode() {
    setIsHistoryBatchMode((current) => {
      if (current) setSelectedHistoryJobIds(new Set());
      return !current;
    });
  }

  function toggleHistoryJobSelection(jobId: string, checked: boolean) {
    setSelectedHistoryJobIds((current) => {
      const next = new Set(current);
      if (checked) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }

  function topLevelSelectedGalleryFolderIds(folderIds: string[]): string[] {
    const selected = new Set(folderIds);
    return folderIds.filter((folderId) => ![...selected].some((candidate) => candidate !== folderId && isGalleryFolderDescendant(folderId, candidate)));
  }

  function prepareGalleryEntryDrag(event: React.DragEvent<HTMLElement>, entry: GalleryExplorerEntry) {
    const isSelected = isGalleryEntrySelected(entry);
    const assetIds = isSelected ? [...selectedGalleryAssetIds] : entry.kind === "asset" ? [entry.id] : [];
    const folderIds = isSelected ? [...selectedGalleryFolderIds] : entry.kind === "folder" ? [entry.id] : [];
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-image2tools-gallery-selection", JSON.stringify({ assetIds, folderIds }));
    if (entry.kind === "asset") event.dataTransfer.setData("application/x-image2tools-gallery-id", entry.id);
    if (entry.kind === "folder") event.dataTransfer.setData("application/x-image2tools-gallery-folder-id", entry.id);
  }

  const modeError = useMemo(() => {
    if (generalParams && !generalFallbackSupportsReferenceImages(generalParams.providerKind) && effectiveInputAssets.length > 0) {
      return copy.validation.generalPromptOnly;
    }
    if (requestMode === "edit" && effectiveInputAssets.length === 0) return copy.validation.addReference;
    if (requestMode === "inpaint" && effectiveInputAssets.length === 0) return copy.validation.addSource;
    if (requestMode !== "generate" && activeReferenceImageLimit > 0 && effectiveInputAssets.length > activeReferenceImageLimit) {
      return copy.validation.maxInputs(activeReferenceImageLimit);
    }
    if (usesExactMask && requestMode === "inpaint" && maskCheck && !maskCheck.ok) return maskCheck.message;
    return null;
  }, [activeReferenceImageLimit, copy, effectiveInputAssets.length, generalParams, maskCheck, requestMode, usesExactMask]);

  const launchRuntimeError = runtimeSelectionError(params, activeConfig, copy);
  const validationError = launchRuntimeError ?? localizeValidationMessage(getValidationError(params, effectivePrompt), copy) ?? modeError;
  const canRun = !validationError && !isRunning;
  const primaryRunActionLabel = isRunning ? copy.running : modeLabels[requestMode].action;
  const promptCopyActionLabel = buttonFeedback["copy:prompt"] ? copy.clicked : copy.copyPrompt;
  const savedApiConfigs = snapshot.providers;
  const canDeleteActiveApiAccess = snapshot.providers.length > 1;
  const canDeleteSelectedApiAccess = snapshot.providers.length > 1;

  useEffect(() => {
    window.localStorage.setItem("image2tools.language", language);
  }, [language]);

  useEffect(() => {
    applyThemeMode(themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const version = snapshot.appVersion;
    if (!version || version === fallbackSnapshot.appVersion) return;
    if (window.localStorage.getItem(RELEASE_GUIDE_STORAGE_KEY) === version) return;
    setIsReleaseGuideOpen(true);
  }, [snapshot.appVersion]);

  useEffect(() => {
    if (!editingHistoryTagsId) return undefined;

    const closeHistoryTagPopover = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".history-tag-popover, .history-add-tag-button")) return;
      setEditingHistoryTagsId(null);
      setHistoryTagsInput("");
    };

    window.addEventListener("pointerdown", closeHistoryTagPopover, true);
    return () => window.removeEventListener("pointerdown", closeHistoryTagPopover, true);
  }, [editingHistoryTagsId]);

  useEffect(() => {
    if (!editingGalleryId) return undefined;

    const closeGalleryTagPopover = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".gallery-tag-popover, .gallery-add-tag-button")) return;
      setEditingGalleryId(null);
      setGalleryTagsInput("");
    };

    window.addEventListener("pointerdown", closeGalleryTagPopover, true);
    return () => window.removeEventListener("pointerdown", closeGalleryTagPopover, true);
  }, [editingGalleryId]);

  useEffect(() => {
    if (!isGallerySortMenuOpen) return undefined;

    const closeGallerySortMenu = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".gallery-sort-control")) return;
      setIsGallerySortMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsGallerySortMenuOpen(false);
    };

    window.addEventListener("pointerdown", closeGallerySortMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeGallerySortMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isGallerySortMenuOpen]);

  useEffect(() => {
    if (!isTagManagerOpen) return undefined;

    const closeTagManager = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".right-rail-tag-action")) return;
      setIsTagManagerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsTagManagerOpen(false);
    };

    window.addEventListener("pointerdown", closeTagManager, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeTagManager, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isTagManagerOpen]);

  useEffect(() => {
    const updateCompactState = () => setIsAutoSidebarCollapsed(window.innerWidth <= 1320);
    updateCompactState();
    window.addEventListener("resize", updateCompactState);
    return () => window.removeEventListener("resize", updateCompactState);
  }, []);

  useEffect(() => {
    const container = promptActionsRef.current;
    const primaryButton = primaryRunButtonRef.current;
    const templateButton = promptTemplateButtonRef.current;
    const copyButton = promptCopyButtonRef.current;
    if (!container || !primaryButton || !templateButton || !copyButton) return;

    let frameId: number | null = null;
    const measureActionButtonWidth = (button: HTMLButtonElement, label: string, count?: string): number => {
      const buttonStyle = window.getComputedStyle(button);
      const buttonGap = cssPixelValue(buttonStyle.columnGap) || cssPixelValue(buttonStyle.gap) || 8;
      const iconWidth = button.querySelector("svg")?.getBoundingClientRect().width || 16;
      const labelWidth = measureButtonTextWidth(label, button);
      const countElement = button.querySelector<HTMLElement>(".button-count");
      const countWidth = count && countElement
        ? measureButtonTextWidth(count, countElement) +
          cssPixelValue(window.getComputedStyle(countElement).paddingLeft) +
          cssPixelValue(window.getComputedStyle(countElement).paddingRight) +
          cssPixelValue(window.getComputedStyle(countElement).borderLeftWidth) +
          cssPixelValue(window.getComputedStyle(countElement).borderRightWidth)
        : 0;
      const segments = 1 + (label ? 1 : 0) + (count ? 1 : 0);
      const buttonChrome =
        cssPixelValue(buttonStyle.paddingLeft) +
        cssPixelValue(buttonStyle.paddingRight) +
        cssPixelValue(buttonStyle.borderLeftWidth) +
        cssPixelValue(buttonStyle.borderRightWidth);
      return iconWidth + labelWidth + countWidth + buttonGap * Math.max(0, segments - 1) + buttonChrome;
    };

    const updatePromptActionLayout = () => {
      frameId = null;
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) {
        setArePromptSecondaryActionsIconOnly(false);
        setIsPrimaryRunIconOnly(false);
        return;
      }

      const row = container.querySelector<HTMLElement>(".run-row");
      const rowStyle = window.getComputedStyle(row ?? container);
      const gap = cssPixelValue(rowStyle.columnGap) || cssPixelValue(rowStyle.gap) || 8;
      const fullColumnWidth = Math.max(0, (containerWidth - gap * 2) / 3);
      const requiredPrimaryWidth = measureActionButtonWidth(primaryButton, primaryRunActionLabel);
      const requiredTemplateWidth = measureActionButtonWidth(templateButton, copy.promptTemplates, String(snapshot.promptTemplates.length));
      const requiredCopyWidth = measureActionButtonWidth(copyButton, promptCopyActionLabel);
      const shouldUseSecondaryIconOnly =
        fullColumnWidth <= Math.max(requiredPrimaryWidth, requiredTemplateWidth, requiredCopyWidth) + PROMPT_ACTION_EDGE_GUARD;
      const availablePrimaryWidth = shouldUseSecondaryIconOnly
        ? containerWidth - PROMPT_ACTION_ICON_BUTTON_WIDTH * 2 - gap * 2
        : fullColumnWidth;
      const shouldUseIconOnly = availablePrimaryWidth <= requiredPrimaryWidth + PROMPT_ACTION_EDGE_GUARD;
      setArePromptSecondaryActionsIconOnly((current) => current === shouldUseSecondaryIconOnly ? current : shouldUseSecondaryIconOnly);
      setIsPrimaryRunIconOnly((current) => current === shouldUseIconOnly ? current : shouldUseIconOnly);
    };

    const schedulePrimaryRunLayoutUpdate = () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      if (typeof window.requestAnimationFrame === "function") {
        frameId = window.requestAnimationFrame(updatePromptActionLayout);
      } else {
        updatePromptActionLayout();
      }
    };

    schedulePrimaryRunLayoutUpdate();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedulePrimaryRunLayoutUpdate);
    resizeObserver?.observe(container);
    window.addEventListener("resize", schedulePrimaryRunLayoutUpdate);
    return () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedulePrimaryRunLayoutUpdate);
    };
  }, [copy.promptTemplates, primaryRunActionLabel, promptCopyActionLabel, snapshot.promptTemplates.length]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    window.localStorage.setItem("image2tools.sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    historyWidthRef.current = historyWidth;
    window.localStorage.setItem("image2tools.historyWidth", String(historyWidth));
  }, [historyWidth]);

  useEffect(() => {
    window.localStorage.setItem("image2tools.previewPanelRatio", String(previewPanelRatio));
  }, [previewPanelRatio]);

  useEffect(() => {
    if (!isRunning || generationStartedAt === null) return;

    const updateElapsed = () => {
      setGenerationElapsedSeconds(Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)));
    };

    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timerId);
  }, [generationStartedAt, isRunning]);

  useEffect(() => {
    let frameId: number | null = null;
    const measureCollapseButtons = () => {
      frameId = null;

      const sidebarNode =
        sidebarUtilityBarRef.current?.getBoundingClientRect().height
          ? sidebarUtilityBarRef.current
          : document.querySelector<HTMLElement>(".sidebar-mini-utility");
      if (sidebarNode) {
        const sidebarRect = sidebarNode.getBoundingClientRect();
        if (sidebarRect.width !== 0 || sidebarRect.height !== 0) {
          const nextSidebarY = Math.round(Math.max(48, sidebarRect.top));
          setSidebarCollapseButtonY((current) => (Math.abs(current - nextSidebarY) > 1 ? nextSidebarY : current));
        }
      }

      const rightActionsNode = rightRailActionsRef.current;
      if (rightActionsNode) {
        const rightActionsRect = rightActionsNode.getBoundingClientRect();
        if (rightActionsRect.width !== 0 || rightActionsRect.height !== 0) {
          const nextRightRailY = Math.round(Math.max(48, rightActionsRect.top));
          setRightRailCollapseButtonY((current) => (Math.abs(current - nextRightRailY) > 1 ? nextRightRailY : current));
        }
      }
    };
    const scheduleMeasure = () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      if (typeof window.requestAnimationFrame === "function") {
        frameId = window.requestAnimationFrame(measureCollapseButtons);
      } else {
        measureCollapseButtons();
      }
    };

    scheduleMeasure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    const sidebarNode = sidebarUtilityBarRef.current;
    if (sidebarNode) resizeObserver?.observe(sidebarNode);
    const compactSidebarNode = document.querySelector<HTMLElement>(".sidebar-mini-utility");
    if (compactSidebarNode) resizeObserver?.observe(compactSidebarNode);
    const sidebarRoot = sidebarNode?.closest(".sidebar");
    if (sidebarRoot instanceof HTMLElement) resizeObserver?.observe(sidebarRoot);
    const rightActionsNode = rightRailActionsRef.current;
    if (rightActionsNode) resizeObserver?.observe(rightActionsNode);
    const rightRailNode = rightActionsNode?.closest(".right-rail");
    if (rightRailNode instanceof HTMLElement) resizeObserver?.observe(rightRailNode);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [isRightRailCompact, isSidebarCompact, notice.text, rightRailView, rightRailLayoutMode, showAdvanced, updateCheck?.status]);

  useEffect(() => {
    const node = historyListRef.current;
    if (!node) return;
    setHistoryListScrollState({
      top: node.scrollTop,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight
    });
  }, [filteredHistory.length, historyPageIndex, historyPageSize, historyViewMode, isHistoryExpanded, rightRailView]);

  useEffect(() => {
    setHistoryPageIndex(0);
  }, [historySearch, historySort, historyStatusFilter, historyPageSize]);

  useEffect(() => {
    setHistoryPageIndex((current) => Math.min(current, historyPageCount - 1));
  }, [historyPageCount]);

  useEffect(() => {
    if (!isActiveApiConfigOpen) return;
    if (!selectedApiConfigId || !snapshot.providers.some((config) => config.id === selectedApiConfigId)) {
      hydrateApiConfigForm(activeConfig);
    }
  }, [activeConfig, isActiveApiConfigOpen, selectedApiConfigId, snapshot.providers]);

  useEffect(() => {
    if (
      activeGalleryFolderId !== GALLERY_ALL_FILTER &&
      activeGalleryFolderId !== GALLERY_UNCATEGORIZED_FILTER &&
      !snapshot.galleryFolders.some((folder) => folder.id === activeGalleryFolderId)
    ) {
      setActiveGalleryFolderId(GALLERY_ALL_FILTER);
    }
  }, [activeGalleryFolderId, snapshot.galleryFolders]);

  useEffect(() => {
    const folderIds = new Set(snapshot.galleryFolders.map((folder) => folder.id));
    const assetIds = new Set(snapshot.galleryAssets.map((asset) => asset.id));
    setSelectedGalleryFolderIds((current) => {
      const next = new Set([...current].filter((id) => folderIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setSelectedGalleryAssetIds((current) => {
      const next = new Set([...current].filter((id) => assetIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setExpandedGalleryFolderIds((current) => {
      const next = new Set([...current].filter((id) => folderIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setActiveGalleryAssetId((current) => (current && !assetIds.has(current) ? null : current));
  }, [snapshot.galleryAssets, snapshot.galleryFolders]);

  useEffect(() => {
    if (galleryFolderById.has(activeGalleryFolderId)) expandGalleryFolderPath(activeGalleryFolderId);
  }, [activeGalleryFolderId, galleryFolderById]);

  useEffect(() => {
    const element = galleryContentRef.current;
    if (!element) return;
    const updateViewport = () => {
      const rect = element.getBoundingClientRect();
      const measuredWidth = rect.width || element.clientWidth || GALLERY_CONTENT_DEFAULT_WIDTH;
      const measuredHeight = rect.height || element.clientHeight || GALLERY_CONTENT_DEFAULT_HEIGHT;
      setGalleryContentViewport({
        width: Math.max(1, measuredWidth),
        height: Math.max(1, measuredHeight)
      });
    };
    updateViewport();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(element);
    window.addEventListener("resize", updateViewport);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, [rightRailView, galleryViewMode, rightRailLayoutMode]);

  useEffect(() => {
    setGalleryContentScrollTop(0);
    if (galleryContentRef.current) galleryContentRef.current.scrollTop = 0;
  }, [activeGalleryFolderId, gallerySearch, gallerySort, galleryTagFilter, galleryViewMode, isRightRailCompact]);

  useEffect(() => {
    setIsRightRailActionDrawerOpen(false);
  }, [isRightRailCompact, rightRailView]);

  useEffect(() => {
    if (historyGalleryFolderId && !snapshot.galleryFolders.some((folder) => folder.id === historyGalleryFolderId)) {
      setHistoryGalleryFolderId("");
    }
  }, [historyGalleryFolderId, snapshot.galleryFolders]);

  useEffect(() => {
    if (!resizingColumn) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (resizingColumn === "sidebar") {
        const rawWidth = event.clientX;
        if (rawWidth <= LEFT_RAIL_AUTO_COLLAPSE_WIDTH) {
          setShellWidthVariable("--sidebar-width", COMPACT_SIDEBAR_WIDTH);
          setIsSidebarCollapsed(true);
          setResizingColumn(null);
          return;
        }
        const nextMax = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - historyWidthRef.current - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
        const nextWidth = clamp(rawWidth, MIN_SIDEBAR_WIDTH, nextMax);
        sidebarWidthRef.current = nextWidth;
        setShellWidthVariable("--sidebar-width", nextWidth);
        setSidebarWidth(nextWidth);
      } else if (resizingColumn === "history") {
        const rawWidth = window.innerWidth - event.clientX;
        const nextMax = Math.min(MAX_HISTORY_WIDTH, Math.max(MIN_RIGHT_RAIL_WIDTH, window.innerWidth - sidebarWidthRef.current - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
        const nextWidth = clamp(rawWidth, MIN_RIGHT_RAIL_WIDTH, nextMax);
        applyRightRailWidth(nextWidth, { forceCollapsed: rawWidth <= getRightRailAutoCollapseWidth() ? true : undefined });
      } else {
        const layout = previewLayoutRef.current;
        if (!layout) return;
        const rect = layout.getBoundingClientRect();
        const rawRatio = (event.clientX - rect.left) / rect.width;
        setPreviewPanelRatio(clamp(rawRatio, MIN_PREVIEW_PANEL_RATIO, MAX_PREVIEW_PANEL_RATIO));
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
  }, [resizingColumn]);

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
    setPreviewPan({ x: 0, y: 0 });
    setIsAnnotationColorSampling(false);
    setSampledAnnotationColor(null);
  }, [activePreviewSource]);

  useEffect(() => {
    if (!generalParams) return;
    if (maskAsset || maskDataUrl) {
      setMaskAsset(null);
      setMaskDataUrl(null);
    }
  }, [generalParams, maskAsset, maskDataUrl]);

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    return () => {
      if (referenceLimitToastTimerRef.current) window.clearTimeout(referenceLimitToastTimerRef.current);
    };
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
          prompt: effectivePrompt,
          params,
          inputAssets: effectiveInputAssets,
          maskAsset: maskAsset ?? undefined,
          maskDataUrl: maskDataUrl ?? undefined,
          brushSize
        })
        .then((draft) => setDraftUpdatedAt(draft.updatedAt))
        .catch((error) => setNotice({ kind: "error", text: normalizeNotice(error) }));
    }, 600);

    return () => window.clearTimeout(timer);
  }, [bridge, brushSize, effectiveInputAssets, effectivePrompt, hasRestoredDraft, hasUserChangedDraft, maskAsset, maskDataUrl, requestMode, params]);

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
    if (!bridge) return;
    return bridge.onGalleryEvent((event) => {
      setSnapshot((current) => ({
        ...current,
        galleryFolders: event.folders,
        galleryAssets: event.assets
      }));
    });
  }, [bridge]);

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
    inspectMask(source, mask, copy, maskAsset?.mimeType ?? mimeTypeFromDataUrl(mask) ?? "image/png", effectiveInputAssets[0]?.mimeType)
      .then((result) => {
        if (!cancelled) setMaskCheck(result);
      })
      .catch((error) => {
        if (!cancelled) setMaskCheck({ ok: false, message: error instanceof Error ? error.message : copy.notices.maskValidationFailed });
      });

    return () => {
      cancelled = true;
    };
  }, [copy, effectiveInputAssets, maskAsset?.mimeType, maskPreview, requestMode, sourcePreview, usesExactMask]);

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
    clearPromptChips();
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
      clearPromptChips();
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
  }

  function clearPromptChips() {
    setPromptTokens([]);
    setPromptTokenAssets({});
  }

  function editTemplate(template: PromptTemplate) {
    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateBody(template.body);
    setIsTemplatesOpen(true);
  }

  function templateInputFromForm(): PromptTemplateInput {
    return {
      title: templateTitle,
      body: templateBody,
      tags: []
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
        inputAssets: effectiveInputAssets,
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

  function galleryAssetPath(asset: GalleryAsset): string {
    if (asset.previewUrl) return asset.previewUrl;
    const version = encodeURIComponent(asset.modifiedAt ?? asset.updatedAt ?? asset.createdAt);
    return `image2tools-asset://image?gallery=${encodeURIComponent(asset.fileName)}&v=${version}`;
  }

  function galleryAssetThumbnailPath(asset: GalleryAsset): string {
    if (asset.previewUrl) return asset.previewUrl;
    const version = encodeURIComponent(asset.modifiedAt ?? asset.updatedAt ?? asset.createdAt);
    return `image2tools-asset://image?gallery=${encodeURIComponent(asset.fileName)}&thumb=1&v=${version}`;
  }

  async function importToGallery() {
    if (!bridge) return;
    try {
      const assets = await bridge.importToGallery(undefined, currentImportFolderId);
      if (assets.length > 0) {
        mergeGalleryAssetsIntoSnapshot(assets);
      }
      setNotice({ kind: assets.length > 0 ? "success" : "info", text: assets.length > 0 ? copy.galleryImported(assets.length) : copy.galleryImportCanceled });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function openStorageFolder(kind: "history" | "gallery", folderId?: string | null) {
    if (!bridge) return;
    try {
      await bridge.openStorageFolder(kind, folderId);
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function openStorageSettings() {
    setStorageDialogKind("history");
    setSyncStorageFolders(snapshot.storage.historyDir === snapshot.storage.galleryDir);
  }

  async function chooseStorageFolder(kind: StorageKind, syncBoth = false) {
    if (!bridge) return;
    try {
      const next = await bridge.chooseStorageFolder(kind, { syncBoth });
      applySnapshot(next);
      setStorageDialogKind(null);
      setNotice({ kind: "success", text: syncBoth ? copy.storageFoldersUpdated : kind === "history" ? copy.historyStorageUpdated : copy.galleryStorageUpdated });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function requestDangerConfirm(dialog: ConfirmDialogState) {
    setConfirmDialog(dialog);
  }

  async function runConfirmDialogAction() {
    if (!confirmDialog) return;
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function importDroppedFilesToGallery(files: File[], folderId: string | null): Promise<boolean> {
    if (!bridge) return false;
    const paths = bridge
      .getDroppedFilePaths(files)
      .filter((value): value is string => typeof value === "string" && /\.(png|jpe?g|webp)$/i.test(value));
    if (paths.length === 0) return false;
    const assets = await bridge.importToGallery(paths, folderId);
    if (assets.length > 0) {
      mergeGalleryAssetsIntoSnapshot(assets);
    }
    setNotice({ kind: assets.length > 0 ? "success" : "info", text: assets.length > 0 ? copy.galleryImported(assets.length) : copy.galleryImportCanceled });
    return true;
  }

  function mergeGalleryAssetsIntoSnapshot(assets: GalleryAsset[]) {
    if (assets.length === 0) return;
    setSnapshot((current) => {
      const incomingIds = new Set(assets.map((asset) => asset.id));
      return {
        ...current,
        galleryAssets: [
          ...assets,
          ...current.galleryAssets
            .filter((asset) => !incomingIds.has(asset.id))
            .map((asset) => assets.find((incoming) => incoming.id === asset.id) ?? asset)
        ]
      };
    });
  }

  async function addHistoryAssetToGallery(asset?: ImageAsset, folderId: string | null = historyGalleryTargetFolderId, job?: GenerationJob) {
    if (!bridge || !asset) return;
    try {
      const galleryAsset = await bridge.addHistoryAssetToGallery(asset.path, folderId, job ? historyGalleryTags(job) : []);
      if (galleryAsset) mergeGalleryAssetsIntoSnapshot([galleryAsset]);
      setHistoryGalleryMenuJobId(null);
      setNotice({ kind: galleryAsset ? "success" : "info", text: galleryAsset ? copy.galleryAdded : copy.galleryAddCanceled });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function addHistoryPathToGallery(assetPath: string, folderId: string | null) {
    if (!bridge || !assetPath) return;
    try {
      const galleryAsset = await bridge.addHistoryAssetToGallery(assetPath, folderId);
      if (galleryAsset) mergeGalleryAssetsIntoSnapshot([galleryAsset]);
      setNotice({ kind: galleryAsset ? "success" : "info", text: galleryAsset ? copy.galleryAdded : copy.galleryAddCanceled });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function pickGalleryAsset(asset: GalleryAsset) {
    if (!bridge) return;
    try {
      const inputAsset = await bridge.pickGalleryAsset(asset.id);
      addInputAssets([inputAsset]);
      setNotice({ kind: "success", text: copy.galleryPicked(asset.originalName) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function previewGalleryAsset(asset: GalleryAsset) {
    setActiveGalleryAssetId(asset.id);
    setActiveJob(null);
    setSelectedResultId(null);
    setPartialImages([]);
    resetPreviewView();
    setNotice({ kind: "info", text: copy.galleryOpenedForPreview(asset.originalName) });
  }

  async function addGalleryPromptToken(asset: GalleryAsset) {
    if (!bridge) return;
    try {
      const inputAsset = await bridge.pickGalleryAsset(asset.id);
      setPromptTokenAssets((current) => ({ ...current, [asset.id]: inputAsset }));
      setPromptTokens((current) => [...current, { type: "asset", galleryAssetId: asset.id, label: asset.originalName }]);
      markDraftChanged();
      if (tabMode === "text2img") setTabMode("img2img");
      setNotice({ kind: "success", text: copy.galleryPicked(asset.originalName) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function createGalleryFolder(name = newGalleryFolderName, parentId: string | null = null): Promise<boolean> {
    if (!bridge) return false;
    try {
      const folder = await bridge.createGalleryFolder({ name, parentId });
      setSnapshot((current) => ({ ...current, galleryFolders: [folder, ...current.galleryFolders] }));
      setActiveGalleryFolderId(folder.id);
      expandGalleryFolderPath(folder.id);
      setNewGalleryFolderName("");
      setIsGalleryFolderMenuOpen(false);
      setNotice({ kind: "success", text: copy.galleryFolderCreated });
      return true;
    } catch (error) {
      const message = normalizeGalleryFolderNotice(error, copy);
      setGalleryFolderDialogError(message);
      setNotice({ kind: "error", text: message });
      return false;
    }
  }

  function openCreateGalleryFolderDialog(parentId: string | null = currentGalleryCreateParentId) {
    setGalleryFolderDialog({ mode: "create", parentId });
    setGalleryFolderDialogName("");
    setGalleryFolderDialogError("");
    setIsGalleryFolderMenuOpen(false);
  }

  function openRenameGalleryFolderDialog(folder: GalleryFolder) {
    setGalleryFolderDialog({ mode: "rename", folder });
    setGalleryFolderDialogName(folder.name);
    setGalleryFolderDialogError("");
    setIsGalleryFolderMenuOpen(false);
  }

  function closeGalleryFolderDialog() {
    setGalleryFolderDialog(null);
    setGalleryFolderDialogError("");
  }

  function hasGalleryFolderNameConflict(name: string, parentId: string | null, excludeId?: string): boolean {
    const normalizedName = name.trim().toLowerCase();
    return snapshot.galleryFolders.some((folder) =>
      folder.id !== excludeId &&
      (folder.parentId ?? null) === parentId &&
      folder.name.trim().toLowerCase() === normalizedName
    );
  }

  async function submitGalleryFolderDialog() {
    const name = galleryFolderDialogName.trim();
    if (!galleryFolderDialog || !name) return;
    const parentId = galleryFolderDialog.mode === "create"
      ? galleryFolderDialog.parentId ?? null
      : galleryFolderDialog.folder.parentId ?? null;
    const excludeId = galleryFolderDialog.mode === "rename" ? galleryFolderDialog.folder.id : undefined;
    if (hasGalleryFolderNameConflict(name, parentId, excludeId)) {
      setGalleryFolderDialogError(copy.galleryFolderNameExists);
      setNotice({ kind: "error", text: copy.galleryFolderNameExists });
      return;
    }
    setGalleryFolderDialogError("");
    const didSave = galleryFolderDialog.mode === "create"
      ? await createGalleryFolder(name, parentId)
      : await renameGalleryFolder(galleryFolderDialog.folder, name);
    if (!didSave) return;
    closeGalleryFolderDialog();
    setGalleryFolderDialogName("");
  }

  function editGalleryFolder(folder: GalleryFolder) {
    setEditingGalleryFolderId(folder.id);
    setEditingGalleryFolderName(folder.name);
  }

  async function renameGalleryFolder(folder: GalleryFolder, name = editingGalleryFolderName): Promise<boolean> {
    if (!bridge) return false;
    try {
      const updated = await bridge.renameGalleryFolder(folder.id, { name });
      setSnapshot((current) => ({ ...current, galleryFolders: current.galleryFolders.map((item) => item.id === folder.id ? updated : item) }));
      setEditingGalleryFolderId(null);
      setEditingGalleryFolderName("");
      setGalleryFolderContextMenu(null);
      setNotice({ kind: "success", text: copy.galleryFolderRenamed });
      return true;
    } catch (error) {
      const message = normalizeGalleryFolderNotice(error, copy);
      setGalleryFolderDialogError(message);
      setNotice({ kind: "error", text: message });
      return false;
    }
  }

  function deleteGalleryFolder(folder: GalleryFolder) {
    if (!bridge) return;
    requestDangerConfirm({
      title: copy.galleryFolderDelete,
      body: copy.galleryFolderDeleteConfirm(folder.name),
      confirmLabel: copy.galleryFolderDelete,
      onConfirm: () => performDeleteGalleryFolder(folder)
    });
  }

  async function performDeleteGalleryFolder(folder: GalleryFolder) {
    if (!bridge) return;
    try {
      const next = await bridge.deleteGalleryFolder(folder.id);
      setSnapshot((current) => ({ ...current, galleryFolders: next.folders, galleryAssets: next.assets }));
      setActiveGalleryFolderId(GALLERY_UNCATEGORIZED_FILTER);
      setGalleryFolderContextMenu(null);
      setNotice({ kind: "success", text: copy.galleryFolderDeleted });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function openGalleryFolderContextMenu(event: React.MouseEvent, folderId: GalleryFolderFilter) {
    event.preventDefault();
    event.stopPropagation();
    setGalleryAssetContextMenu(null);
    setGalleryFolderContextMenu({ x: event.clientX, y: event.clientY, folderId });
  }

  function openGalleryAssetContextMenu(event: React.MouseEvent, asset: GalleryAsset) {
    event.preventDefault();
    event.stopPropagation();
    setGalleryFolderContextMenu(null);
    setGalleryAssetContextMenu({ x: event.clientX, y: event.clientY, assetId: asset.id });
  }

  function closeGalleryFolderContextMenu() {
    setGalleryFolderContextMenu(null);
  }

  async function moveGalleryAsset(asset: GalleryAsset, folderId: string | null) {
    if (!bridge) return;
    try {
      const updated = await bridge.moveGalleryAsset(asset.id, folderId);
      setSnapshot((current) => ({ ...current, galleryAssets: current.galleryAssets.map((item) => item.id === asset.id ? updated : item) }));
      setNotice({ kind: "success", text: copy.galleryMoved });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function moveGalleryFolder(folder: GalleryFolder, parentId: string | null) {
    if (!bridge) return;
    if (folder.id === parentId || (parentId && isGalleryFolderDescendant(parentId, folder.id))) {
      setNotice({ kind: "error", text: copy.galleryFolderMoveInvalid });
      return;
    }
    try {
      const updated = await bridge.moveGalleryFolder(folder.id, parentId);
      setSnapshot((current) => ({ ...current, galleryFolders: current.galleryFolders.map((item) => item.id === folder.id ? updated : item) }));
      expandGalleryFolderPath(updated.id);
      setNotice({ kind: "success", text: copy.galleryFolderMoved });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeGalleryFolderNotice(error, copy) });
    }
  }

  function deleteSelectedGalleryItems() {
    if (!bridge || selectedGalleryItemCount === 0) return;
    requestDangerConfirm({
      title: copy.galleryDeleteSelected,
      body: copy.gallerySelectedDeleteConfirm(selectedGalleryItemCount),
      confirmLabel: copy.galleryDeleteSelected,
      onConfirm: performDeleteSelectedGalleryItems
    });
  }

  async function performDeleteSelectedGalleryItems() {
    if (!bridge || selectedGalleryItemCount === 0) return;
    try {
      for (const folderId of topLevelSelectedGalleryFolderIds([...selectedGalleryFolderIds])) {
        if (!galleryFolderById.has(folderId)) continue;
        const next = await bridge.deleteGalleryFolder(folderId);
        setSnapshot((current) => ({ ...current, galleryFolders: next.folders, galleryAssets: next.assets }));
      }
      for (const assetId of selectedGalleryAssetIds) {
        const nextAssets = await bridge.removeGalleryAsset(assetId);
        setSnapshot((current) => ({ ...current, galleryAssets: nextAssets }));
      }
      clearGallerySelection();
      setNotice({ kind: "success", text: copy.gallerySelectedDeleted });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function clearGallery() {
    if (!bridge || (snapshot.galleryAssets.length === 0 && snapshot.galleryFolders.length === 0)) return;
    requestDangerConfirm({
      title: copy.confirmClearGalleryTitle,
      body: copy.confirmClearGalleryBody(snapshot.galleryAssets.length, snapshot.galleryFolders.length),
      confirmLabel: copy.confirmClearGallery,
      onConfirm: performClearGallery
    });
  }

  async function performClearGallery() {
    if (!bridge) return;
    try {
      for (const folderId of topLevelSelectedGalleryFolderIds(snapshot.galleryFolders.map((folder) => folder.id))) {
        const next = await bridge.deleteGalleryFolder(folderId);
        setSnapshot((current) => ({ ...current, galleryFolders: next.folders, galleryAssets: next.assets }));
      }
      for (const asset of snapshot.galleryAssets) {
        const nextAssets = await bridge.removeGalleryAsset(asset.id);
        setSnapshot((current) => ({ ...current, galleryAssets: nextAssets }));
      }
      setActiveGalleryFolderId(GALLERY_ALL_FILTER);
      clearGallerySelection();
      setNotice({ kind: "success", text: copy.galleryCleared });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function handleGalleryFolderDrop(event: React.DragEvent<HTMLElement>, folderId: GalleryFolderFilter) {
    event.preventDefault();
    event.stopPropagation();
    setGalleryFolderDragTarget(null);
    if (!bridge) return;
    const targetFolderId = folderId === GALLERY_ALL_FILTER || folderId === GALLERY_UNCATEGORIZED_FILTER ? null : folderId;
    const selection = event.dataTransfer.getData("application/x-image2tools-gallery-selection");
    if (selection) {
      try {
        const parsed = JSON.parse(selection) as { assetIds?: string[]; folderIds?: string[] };
        for (const draggedFolderId of topLevelSelectedGalleryFolderIds(parsed.folderIds ?? [])) {
          const folder = galleryFolderById.get(draggedFolderId);
          if (folder) await moveGalleryFolder(folder, targetFolderId);
        }
        for (const draggedAssetId of parsed.assetIds ?? []) {
          const asset = snapshot.galleryAssets.find((item) => item.id === draggedAssetId);
          if (asset) await moveGalleryAsset(asset, targetFolderId);
        }
        clearGallerySelection();
        return;
      } catch {
        // Fall through to the legacy single-item payloads below.
      }
    }
    const folderDragId = event.dataTransfer.getData("application/x-image2tools-gallery-folder-id");
    if (folderDragId) {
      const folder = galleryFolderById.get(folderDragId);
      if (folder) await moveGalleryFolder(folder, targetFolderId);
      return;
    }
    const galleryId = event.dataTransfer.getData("application/x-image2tools-gallery-id");
    if (galleryId) {
      const asset = snapshot.galleryAssets.find((item) => item.id === galleryId);
      if (asset) await moveGalleryAsset(asset, targetFolderId);
      return;
    }
    const historyPath = event.dataTransfer.getData("application/x-image2tools-asset");
    if (historyPath && /\.(png|jpe?g|webp)$/i.test(historyPath)) {
      await addHistoryPathToGallery(historyPath, targetFolderId);
      return;
    }
    await importDroppedFilesToGallery(Array.from(event.dataTransfer.files ?? []), targetFolderId);
  }

  function galleryFolderDropHandlers(folderId: GalleryFolderFilter) {
    return {
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setGalleryFolderDragTarget(folderId);
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setGalleryFolderDragTarget((current) => (current === folderId ? null : current));
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => void handleGalleryFolderDrop(event, folderId)
    };
  }

  function editGalleryTags(asset: GalleryAsset) {
    setEditingGalleryId(asset.id);
    setGalleryTagsInput("");
  }

  async function saveGalleryTags(asset: GalleryAsset) {
    if (!bridge) return;
    const [tag] = normalizeTagList(galleryTagsInput);
    if (!tag) {
      setEditingGalleryId(null);
      setGalleryTagsInput("");
      return;
    }
    try {
      const updated = await bridge.updateGalleryAsset(asset.id, {
        tags: mergeTags(asset.tags, [tag])
      });
      setSnapshot((current) => ({ ...current, galleryAssets: current.galleryAssets.map((item) => item.id === asset.id ? updated : item) }));
      setEditingGalleryId(null);
      setGalleryTagsInput("");
      setNotice({ kind: "success", text: copy.galleryUpdated });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function beginEditGalleryAssetName(asset: GalleryAsset) {
    setEditingGalleryNameId(asset.id);
    setGalleryNameDraft(asset.originalName);
    setGalleryAssetContextMenu(null);
  }

  function openGalleryAssetNameEditor(asset: GalleryAsset) {
    beginEditGalleryAssetName(asset);
  }

  async function saveGalleryAssetName(asset: GalleryAsset) {
    if (!bridge) return;
    const originalName = galleryNameDraft.trim() || asset.originalName;
    try {
      const updated = await bridge.updateGalleryAsset(asset.id, { originalName });
      setSnapshot((current) => ({ ...current, galleryAssets: current.galleryAssets.map((item) => item.id === updated.id ? updated : item) }));
      setEditingGalleryNameId(null);
      setGalleryNameDraft("");
      setNotice({ kind: "success", text: copy.galleryAssetRenamed });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function cancelGalleryAssetNameEdit() {
    setEditingGalleryNameId(null);
    setGalleryNameDraft("");
  }

  function removeGalleryAsset(asset: GalleryAsset) {
    if (!bridge) return;
    requestDangerConfirm({
      title: copy.delete,
      body: copy.galleryDeleteConfirm(asset.originalName),
      confirmLabel: copy.delete,
      onConfirm: () => performRemoveGalleryAsset(asset)
    });
  }

  async function performRemoveGalleryAsset(asset: GalleryAsset) {
    if (!bridge) return;
    try {
      const galleryAssets = await bridge.removeGalleryAsset(asset.id);
      setSnapshot((current) => ({ ...current, galleryAssets }));
      setNotice({ kind: "success", text: copy.galleryDeleted });
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

  function hydrateApiConfigForm(config: ProviderConfig) {
    setSelectedApiConfigId(config.id);
    setApiAccessName(apiAccessDisplayName(config, copy.apiAccessUntitled));
    setBaseURL(config.baseURL);
    setApiKey("");
    setSavedApiConfigId(null);
  }

  function openApiConfigDialog(config: ProviderConfig = activeConfig) {
    hydrateApiConfigForm(config);
    setIsActiveApiConfigOpen(true);
  }

  function selectApiConfigForEditing(config: ProviderConfig) {
    hydrateApiConfigForm(config);
    resetConnectionCheckForConfigEdit();
  }

  function applySnapshot(next: AppSnapshot): ProviderConfig {
    setSnapshot(next);
    const nextActiveConfig = next.providers.find(p => p.id === next.activeProviderId) ?? next.providers[0];
    const nextSelectedConfig = next.providers.find(p => p.id === selectedApiConfigId) ?? nextActiveConfig;
    setApiAccessName(apiAccessDisplayName(nextSelectedConfig, copy.apiAccessUntitled));
    setBaseURL(nextSelectedConfig.baseURL);
    setSelectedApiConfigId(nextSelectedConfig.id);
    setApiKey("");
    syncParamsToConfig(nextActiveConfig);
    return nextActiveConfig;
  }

  function applyConfig(config: ProviderConfig) {
    setSnapshot((current) => {
      const nextProviders = current.providers.map(p => p.id === config.id ? config : p);
      return { ...current, providers: nextProviders };
    });
    if (config.id === (selectedApiConfigId ?? activeConfig.id)) {
      setApiAccessName(apiAccessDisplayName(config, copy.apiAccessUntitled));
      setBaseURL(config.baseURL);
    }
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

  function apiConfigConnectionCheck(config: ProviderConfig): ConnectionCheck {
    return config.id === activeConfig.id ? connectionCheck : { status: "idle" };
  }

  function renderApiConfigConnectionBadge(config: ProviderConfig) {
    const check = apiConfigConnectionCheck(config);
    const label = connectionStatusLabel(check, copy);
    const title = check.status === "error" && check.message ? copy.connectionErrorDetail(check.message) : label;
    const checking = config.id === activeConfig.id && (isTestingConnection || check.status === "checking");
    return (
      <span className="connection-badge api-config-card-connection" data-status={check.status} title={title}>
        {checking ? (
          <Loader2 className="spin" size={12} />
        ) : check.status === "ok" ? (
          <CheckCircle2 size={12} />
        ) : check.status === "error" ? (
          <AlertTriangle size={12} />
        ) : (
          <span className="connection-dot" />
        )}
        {label}
      </span>
    );
  }

  async function persistCurrentDraft() {
    if (!bridge) return;
    await bridge.saveDraft({
      activeLaunchId: params.launchId,
      activeModelId: params.model,
      mode: requestMode,
      prompt: effectivePrompt,
      params,
      inputAssets: effectiveInputAssets,
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
      const targetConfig = selectedApiConfig;
      const configKind = targetConfig.kind;
      const isEditingActiveConfig = targetConfig.id === activeConfig.id;
      const config = await bridge.saveConfig({
        providerId: targetConfig.id,
        kind: configKind,
        name: apiAccessName.trim() || providerLabelFromKind(configKind),
        apiKey: apiKey.trim() ? apiKey : undefined,
        baseURL,
        defaultModel: isEditingActiveConfig ? defaultModelForConfigSave(configKind, params, activeConfig) : targetConfig.defaultModel,
        defaultSize: isEditingActiveConfig ? defaultSizeForConfigSave(params, activeConfig) : targetConfig.defaultSize,
        defaultQuality: isEditingActiveConfig ? defaultQualityForConfigSave(params, activeConfig) : targetConfig.defaultQuality,
        timeoutMs: isEditingActiveConfig ? params.timeoutMs : targetConfig.timeoutMs,
        activeLaunchId: targetConfig.activeLaunchId,
        activeModelId: targetConfig.activeModelId
      });
      applyConfig(config);
      if (config.id === activeConfig.id) {
        syncParamsToConfig(config);
      }
      setApiKey("");
      setSavedApiConfigId(config.apiKeySaved ? config.id : null);
      setNotice({
        kind: config.lastModelDiscoveryError ? "error" : "success",
        text: config.lastModelDiscoveryError ? config.lastModelDiscoveryError : copy.notices.configSaved
      });
      if (config.id === activeConfig.id && config.apiKeySaved) {
        hasAutoTestedConnectionRef.current = true;
        await runConnectionTest({ silent: false, apiKeySaved: config.apiKeySaved });
      } else if (config.id === activeConfig.id) {
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
      return;
    }
    try {
      await persistCurrentDraft();
      const next = await bridge.switchProvider(providerId);
      const nextActiveConfig = applySnapshot(next);
      hydrateApiConfigForm(nextActiveConfig);
      setPromotedApiConfigId(nextActiveConfig.id);
      window.setTimeout(() => {
        setPromotedApiConfigId((current) => current === nextActiveConfig.id ? null : current);
      }, 700);
      hasAutoTestedConnectionRef.current = false;
      setConnectionCheck({ status: "idle" });
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
      hydrateApiConfigForm(nextActiveConfig);
      setNewApiAccessKind("openai");
      setNewApiAccessName("");
      setNewApiAccessBaseURL(DEFAULT_BASE_URL);
      setNewApiAccessKey("");
      setIsAddingApiAccess(false);
      setIsActiveApiConfigOpen(true);
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

  async function discoverModels(config: ProviderConfig = selectedApiConfig) {
    if (!bridge) return;
    setDiscoveringProviderId(config.id);
    try {
      const updatedConfig = await bridge.discoverModels(config.id);
      applyConfig(updatedConfig);
      setNotice({
        kind: updatedConfig.lastModelDiscoveryError ? "error" : "success",
        text: updatedConfig.lastModelDiscoveryError ?? copy.notices.modelsDiscovered(updatedConfig.discoveredModels.length)
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setDiscoveringProviderId(null);
    }
  }

  async function launchModel(button: LaunchButtonState) {
    if (!bridge || !button.available) return;
    const launchProvider = button.providerKind;
    const launchConfig = activeConfig;
    const nextParams = createLaunchParams(button.launchId, button.modelId, params, launchProvider, launchConfig);
    setParams(nextParams);
    if (isGeneralImageParams(nextParams)) {
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
      const config = await bridge.clearApiKey(selectedApiConfig.id);
      applyConfig(config);
      setApiKey("");
      if (config.id === activeConfig.id) {
        hasAutoTestedConnectionRef.current = false;
        setConnectionCheck({ status: "idle" });
      }
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
        prompt: effectivePrompt,
        params,
        inputAssets: effectiveInputAssets,
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

  function formatUpdateStatusShort(result: UpdateCheckResult | null): string {
    if (isCheckingUpdate) return language === "zh" ? "检查中" : "Checking";
    if (!result || result.status === "not-configured") return language === "zh" ? "未检查" : "Not checked";
    if (result.status === "available") return language === "zh" ? "可升级" : "Upgrade";
    if (result.status === "error") return language === "zh" ? "检查失败" : "Check failed";
    return language === "zh" ? "已最新" : "Latest";
  }

  function versionBadgeStatus(result: UpdateCheckResult | null): "ok" | "available" | "error" | "checking" {
    if (isCheckingUpdate) return "checking";
    if (result?.status === "available") return "available";
    if (result?.status === "error") return "error";
    return "ok";
  }

  function movePreviewToolbarTowardPointer(event: React.MouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const drift = event.currentTarget.dataset.drift === "subtle" ? { x: 0.8, y: 0.5 } : { x: 2.2, y: 1.3 };
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * drift.x;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * drift.y;
    event.currentTarget.style.setProperty("--toolbar-drift-x", `${x.toFixed(2)}px`);
    event.currentTarget.style.setProperty("--toolbar-drift-y", `${y.toFixed(2)}px`);
  }

  function resetPreviewToolbarDrift(event: React.MouseEvent<HTMLElement>) {
    event.currentTarget.style.setProperty("--toolbar-drift-x", "0px");
    event.currentTarget.style.setProperty("--toolbar-drift-y", "0px");
  }

  function toggleLanguage() {
    setLanguage((current) => (current === "en" ? "zh" : "en"));
  }

  function toggleThemeMode() {
    setThemeMode((current) => nextThemeMode(current));
  }

  function dismissReleaseGuide() {
    if (snapshot.appVersion && snapshot.appVersion !== fallbackSnapshot.appVersion) {
      window.localStorage.setItem(RELEASE_GUIDE_STORAGE_KEY, snapshot.appVersion);
    }
    setIsReleaseGuideOpen(false);
  }

  function renderThemeIcon() {
    if (themeMode === "light") return <Sun size={15} />;
    if (themeMode === "dark") return <Moon size={15} />;
    return <Monitor size={15} />;
  }

  function showReferenceLimitHint(max: number) {
    const text = copy.referenceLimitReached(max);
    if (referenceLimitToastTimerRef.current) window.clearTimeout(referenceLimitToastTimerRef.current);
    setReferenceLimitToast({ id: Date.now(), text });
    referenceLimitToastTimerRef.current = window.setTimeout(() => setReferenceLimitToast(null), 2400);
  }

  function addInputAssets(assets: InputAsset[]) {
    if (assets.length === 0) return;
    markDraftChanged();
    const referenceLimit = activeReferenceImageLimit;
    const next = dedupeAssets([...inputAssets, ...assets]);
    const cappedNext = referenceLimit > 0 ? next.slice(0, referenceLimit) : next;
    const addedCount = Math.max(0, cappedNext.length - inputAssets.length);
    const capped = Boolean(referenceLimit > 0 && next.length > referenceLimit);
    setInputAssets(cappedNext);
    if (tabMode === "text2img") setTabMode("img2img");
    if (capped) showReferenceLimitHint(referenceLimit);
    if (addedCount > 0) {
      setNotice({
        kind: "success",
        text: copy.notices.imagesAdded(addedCount, cappedNext.length, false, referenceLimit)
      });
    }
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
    if (activeReferenceImageLimit > 0 && inputAssets.length >= activeReferenceImageLimit) {
      showReferenceLimitHint(activeReferenceImageLimit);
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
    const galleryId = event.dataTransfer.getData("application/x-image2tools-gallery-id");
    if (galleryId) {
      const asset = snapshot.galleryAssets.find((item) => item.id === galleryId);
      if (asset) {
        await pickGalleryAsset(asset);
      }
      return;
    }
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

  function addPaintedMask() {
    if (isGeneralMode) {
      setNotice({ kind: "error", text: copy.validation.generalNoMask });
      return;
    }
    if (!maskDataUrl) {
      setNotice({ kind: "error", text: copy.validation.paintOrUploadMask });
      return;
    }
    markDraftChanged();
    setMaskAsset(null);
    setTabMode("img2img");
    setNotice({ kind: "success", text: copy.notices.maskAdded });
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
    setGenerationStartedAt(Date.now());
    setGenerationElapsedSeconds(0);
    setPartialImages([]);
    setActiveJob(null);
    setActiveGalleryAssetId(null);
    setNotice({ kind: "info", text: copy.notices.requestSent(modeLabels[requestMode].action) });

    try {
      const requestParams = normalizeParamsForOutputCount(params);
      const job = await bridge.runJob({
        mode: requestMode,
        prompt: effectivePrompt,
        inputPaths: requestMode === "generate" ? [] : effectiveInputAssets.map((asset) => asset.path),
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
        clearPromptChips();
        setDraftUpdatedAt(null);
        setHasUserChangedDraft(false);
      }
      await refreshSnapshot();
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsRunning(false);
      setGenerationStartedAt(null);
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

  function requestClearHistory() {
    if (!bridge || snapshot.history.length === 0) return;
    requestDangerConfirm({
      title: copy.confirmClearHistoryTitle,
      body: copy.confirmClearHistoryBody(snapshot.history.length),
      confirmLabel: copy.confirmClearHistory,
      onConfirm: confirmClearHistory
    });
  }

  async function confirmClearHistory() {
    if (!bridge) return;
    try {
      const history = await bridge.clearHistory();
      setSnapshot((current) => ({ ...current, history }));
      setActiveJob(null);
      setSelectedHistoryJobIds(new Set());
      setIsHistoryBatchMode(false);
      setNotice({ kind: "success", text: copy.notices.historyCleared });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function deleteSelectedHistoryItems() {
    if (!bridge || selectedHistoryItemCount === 0) return;
    requestDangerConfirm({
      title: copy.historyDeleteSelected,
      body: copy.historySelectedDeleteConfirm(selectedHistoryItemCount),
      confirmLabel: copy.historyDeleteSelected,
      onConfirm: performDeleteSelectedHistoryItems
    });
  }

  async function performDeleteSelectedHistoryItems() {
    if (!bridge || selectedHistoryItemCount === 0) return;
    try {
      let nextHistory = snapshot.history;
      for (const jobId of selectedHistoryJobIds) {
        nextHistory = await bridge.deleteJob(jobId);
      }
      setSnapshot((current) => ({ ...current, history: nextHistory }));
      if (activeJob && selectedHistoryJobIds.has(activeJob.id)) setActiveJob(null);
      setSelectedHistoryJobIds(new Set());
      setIsHistoryBatchMode(false);
      setNotice({ kind: "success", text: copy.historySelectedDeleted(selectedHistoryItemCount) });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function updateHistoryJobState(updated: GenerationJob) {
    setSnapshot((current) => ({
      ...current,
      history: current.history.map((item) => item.id === updated.id ? updated : item)
    }));
    setActiveJob((current) => current?.id === updated.id ? updated : current);
  }

  async function updateHistoryJob(job: GenerationJob, patch: HistoryJobPatch, successText?: string): Promise<GenerationJob | null> {
    if (!bridge) return null;
    try {
      const updated = await bridge.updateHistoryJob(job.id, patch);
      updateHistoryJobState(updated);
      if (successText) setNotice({ kind: "success", text: successText });
      return updated;
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
      return null;
    }
  }

  function beginEditHistoryName(job: GenerationJob) {
    setEditingHistoryNameId(job.id);
    setHistoryNameDraft(historyDisplayName(job));
  }

  async function saveHistoryName(job: GenerationJob) {
    const name = historyNameDraft.trim() || historyDisplayName(job);
    const updated = await updateHistoryJob(job, { name }, copy.historyRenamed);
    if (updated) {
      setEditingHistoryNameId(null);
      setHistoryNameDraft("");
    }
  }

  function cancelHistoryNameEdit() {
    setEditingHistoryNameId(null);
    setHistoryNameDraft("");
  }

  function editHistoryTags(job: GenerationJob) {
    setEditingHistoryTagsId(job.id);
    setHistoryTagsInput("");
  }

  async function saveHistoryTags(job: GenerationJob) {
    const [tag] = normalizeTagList(historyTagsInput);
    if (!tag) {
      cancelHistoryTagsEdit();
      return;
    }
    const updated = await updateHistoryJob(job, { tags: mergeTags(job.tags, [tag]) }, copy.historyTagsUpdated);
    if (updated) {
      cancelHistoryTagsEdit();
    }
  }

  function cancelHistoryTagsEdit() {
    setEditingHistoryTagsId(null);
    setHistoryTagsInput("");
  }

  async function applyBatchTag(target: BatchTagTarget, rawTag: string) {
    if (!bridge) return;
    const [tag] = normalizeTagList(rawTag);
    if (!tag) return;
    try {
      if (target === "history") {
        let nextHistory = snapshot.history;
        let nextActiveJob = activeJob;
        for (const job of selectedHistoryJobs) {
          const updated = await bridge.updateHistoryJob(job.id, { tags: mergeTags(job.tags, [tag]) });
          nextHistory = nextHistory.map((item) => item.id === updated.id ? updated : item);
          if (nextActiveJob?.id === updated.id) nextActiveJob = updated;
        }
        setSnapshot((current) => ({ ...current, history: nextHistory }));
        setActiveJob(nextActiveJob);
      } else {
        let nextAssets = snapshot.galleryAssets;
        for (const asset of selectedGalleryAssets) {
          const updated = await bridge.updateGalleryAsset(asset.id, { tags: mergeTags(asset.tags, [tag]) });
          nextAssets = nextAssets.map((item) => item.id === updated.id ? updated : item);
        }
        setSnapshot((current) => ({ ...current, galleryAssets: nextAssets }));
      }
      setBatchTagInput("");
      setNotice({ kind: "success", text: copy.batchTagsUpdated });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function renameTagEverywhere(oldTag: string, rawNewTag: string) {
    if (!bridge) return;
    const [newTag] = normalizeTagList(rawNewTag);
    if (!newTag || newTag === oldTag) {
      setTagRenameDrafts((current) => ({ ...current, [oldTag]: oldTag }));
      return;
    }
    try {
      let nextHistory = snapshot.history;
      let nextActiveJob = activeJob;
      for (const job of snapshot.history) {
        if (!job.tags.includes(oldTag)) continue;
        const updated = await bridge.updateHistoryJob(job.id, {
          tags: normalizeTagList(job.tags.map((tag) => tag === oldTag ? newTag : tag))
        });
        nextHistory = nextHistory.map((item) => item.id === updated.id ? updated : item);
        if (nextActiveJob?.id === updated.id) nextActiveJob = updated;
      }

      let nextAssets = snapshot.galleryAssets;
      for (const asset of snapshot.galleryAssets) {
        if (!asset.tags.includes(oldTag)) continue;
        const updated = await bridge.updateGalleryAsset(asset.id, {
          tags: normalizeTagList(asset.tags.map((tag) => tag === oldTag ? newTag : tag))
        });
        nextAssets = nextAssets.map((item) => item.id === updated.id ? updated : item);
      }

      setSnapshot((current) => ({ ...current, history: nextHistory, galleryAssets: nextAssets }));
      setActiveJob(nextActiveJob);
      setTagRenameDrafts((current) => {
        const { [oldTag]: _removed, ...rest } = current;
        return rest;
      });
      setNotice({ kind: "success", text: copy.tagRenamed });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function deleteTagEverywhere(tagToDelete: string) {
    if (!bridge) return;
    try {
      let nextHistory = snapshot.history;
      let nextActiveJob = activeJob;
      for (const job of snapshot.history) {
        if (!job.tags.includes(tagToDelete)) continue;
        const updated = await bridge.updateHistoryJob(job.id, {
          tags: job.tags.filter((tag) => tag !== tagToDelete)
        });
        nextHistory = nextHistory.map((item) => item.id === updated.id ? updated : item);
        if (nextActiveJob?.id === updated.id) nextActiveJob = updated;
      }

      let nextAssets = snapshot.galleryAssets;
      for (const asset of snapshot.galleryAssets) {
        if (!asset.tags.includes(tagToDelete)) continue;
        const updated = await bridge.updateGalleryAsset(asset.id, {
          tags: asset.tags.filter((tag) => tag !== tagToDelete)
        });
        nextAssets = nextAssets.map((item) => item.id === updated.id ? updated : item);
      }

      setSnapshot((current) => ({ ...current, history: nextHistory, galleryAssets: nextAssets }));
      setActiveJob(nextActiveJob);
      setTagRenameDrafts((current) => {
        const { [tagToDelete]: _removed, ...rest } = current;
        return rest;
      });
      setNotice({ kind: "success", text: copy.tagDeleted });
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

  async function copyImagePath(value: string, feedbackId = "copy:image-path") {
    try {
      await navigator.clipboard.writeText(value);
      flashButton(feedbackId);
      setNotice({ kind: "success", text: copy.imagePathCopied });
    } catch {
      setNotice({ kind: "error", text: copy.notices.clipboardUnavailable });
    }
  }

  function reuseJob(job: GenerationJob) {
    flashButton(`reuse:${job.id}`);
    const reusedParams = normalizeParamsForOutputCount(job.params);
    setTabMode(tabModeForWorkMode(job.mode));
    setPrompt(job.prompt);
    clearPromptChips();
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
    setActiveGalleryAssetId(null);
    setHasUserChangedDraft(true);
    setNotice({ kind: "info", text: paramsNotice(reusedParams, copy.notices.jobLoaded, copy) });
  }

  function resolvePromptTokenAsset(galleryAssetId: string): InputAsset | undefined {
    return promptTokenAssets[galleryAssetId];
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

  function nextAnnotationOrder(): number {
    const order = annotationOrderRef.current;
    annotationOrderRef.current += 1;
    return order;
  }

  function resetAnnotationOrder(drawingLayers = annotationDrawingLayers, textBoxes = annotationTextBoxes) {
    const maxOrder = Math.max(
      -1,
      ...drawingLayers.map((layer) => layer.order),
      ...textBoxes.map((box) => box.order)
    );
    annotationOrderRef.current = maxOrder + 1;
  }

  function resizeAnnotationCanvas(clear = false) {
    const host = annotationFrameRef.current;
    const canvas = annotationCanvasRef.current;
    if (!host || !canvas) return;
    const rect = host.getBoundingClientRect();
    const image = annotationImageRef.current;
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(image?.naturalWidth || rect.width * scale));
    const height = Math.max(1, Math.round(image?.naturalHeight || rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (clear) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function normalizePointerPressure(event: Pick<PointerEvent, "pressure" | "pointerType">): number {
    if (event.pointerType !== "pen") return 1;
    return clamp(event.pressure || 0.45, 0.18, 1);
  }

  function annotationPointFromClient(clientX: number, clientY: number, pressure: number, target: HTMLCanvasElement): CanvasPoint {
    const canvas = annotationCanvasRef.current;
    const rect = target.getBoundingClientRect();
    const scaleX = canvas ? canvas.width / rect.width : 1;
    const scaleY = canvas ? canvas.height / rect.height : 1;
    return {
      x: clamp((clientX - rect.left) * scaleX, 0, canvas?.width ?? Number.MAX_SAFE_INTEGER),
      y: clamp((clientY - rect.top) * scaleY, 0, canvas?.height ?? Number.MAX_SAFE_INTEGER),
      pressure
    };
  }

  function annotationPoint(event: React.PointerEvent<HTMLCanvasElement>): CanvasPoint {
    return annotationPointFromClient(event.clientX, event.clientY, normalizePointerPressure(event.nativeEvent), event.currentTarget);
  }

  function sampleAnnotationColor(point: CanvasPoint) {
    const image = annotationImageRef.current;
    const canvas = annotationCanvasRef.current;
    const width = Math.max(1, Math.round(image?.naturalWidth || canvas?.width || 0));
    const height = Math.max(1, Math.round(image?.naturalHeight || canvas?.height || 0));
    if (!image || !canvas || width <= 0 || height <= 0) {
      setNotice({ kind: "error", text: copy.annotationColorPickFailed });
      setIsAnnotationColorSampling(false);
      return;
    }

    try {
      const sampler = document.createElement("canvas");
      sampler.width = width;
      sampler.height = height;
      const context = sampler.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(copy.annotationColorPickFailed);
      context.drawImage(image, 0, 0, width, height);
      const x = clamp(Math.floor(point.x), 0, width - 1);
      const y = clamp(Math.floor(point.y), 0, height - 1);
      const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
      const hex = rgbToHex(red, green, blue);
      applyAnnotationColor(hex, "sample");
      setSampledAnnotationColor(hex);
      setIsAnnotationColorSampling(false);
      setIsAnnotationColorPickerOpen(false);
      setNotice({ kind: "success", text: copy.annotationColorPicked(hex) });
    } catch {
      setIsAnnotationColorSampling(false);
      setNotice({ kind: "error", text: copy.annotationColorPickFailed });
    }
  }

  function canvasUnitsForCssPixels(cssPixels: number, axis: "x" | "y" = "x"): number {
    const canvas = annotationCanvasRef.current;
    const host = annotationFrameRef.current;
    const rect = host?.getBoundingClientRect();
    if (!canvas || !rect) return cssPixels * (window.devicePixelRatio || 1);
    const cssSize = axis === "x" ? rect.width : rect.height;
    const canvasSize = axis === "x" ? canvas.width : canvas.height;
    return cssSize > 0 ? cssPixels * (canvasSize / cssSize) : cssPixels;
  }

  function cssPixelsForCanvasUnits(canvasPixels: number, axis: "x" | "y" = "x"): number {
    const canvas = annotationCanvasRef.current;
    const host = annotationFrameRef.current;
    const rect = host?.getBoundingClientRect();
    if (!canvas || !rect) return canvasPixels / (window.devicePixelRatio || 1);
    const cssSize = axis === "x" ? rect.width : rect.height;
    const canvasSize = axis === "x" ? canvas.width : canvas.height;
    return canvasSize > 0 ? canvasPixels * (cssSize / canvasSize) : canvasPixels;
  }

  function normalizeCanvasRect(from: CanvasPoint, to: CanvasPoint, minWidth = 0, minHeight = 0): CanvasRect {
    const canvas = annotationCanvasRef.current;
    const maxWidth = canvas?.width ?? Number.MAX_SAFE_INTEGER;
    const maxHeight = canvas?.height ?? Number.MAX_SAFE_INTEGER;
    const rawX = Math.min(from.x, to.x);
    const rawY = Math.min(from.y, to.y);
    const rawWidth = Math.abs(to.x - from.x);
    const rawHeight = Math.abs(to.y - from.y);
    const width = Math.max(rawWidth, minWidth);
    const height = Math.max(rawHeight, minHeight);
    const x = clamp(rawX, 0, Math.max(0, maxWidth - width));
    const y = clamp(rawY, 0, Math.max(0, maxHeight - height));
    return { x, y, width: Math.min(width, maxWidth), height: Math.min(height, maxHeight) };
  }

  function captureEditorSnapshot(): EditorSnapshot {
    return {
      drawingLayers: annotationDrawingLayers.map((layer) => ({ ...layer })),
      textBoxes: annotationTextBoxes.map((box) => ({ ...box })),
      editedImageDataUrl
    };
  }

  function pushEditorUndoSnapshot() {
    const snapshot = captureEditorSnapshot();
    setEditorUndoStack((current) => [...current.slice(-24), snapshot]);
  }

  function restoreEditorSnapshot(snapshot: EditorSnapshot) {
    setEditedImageDataUrl(snapshot.editedImageDataUrl);
    const drawingLayers = snapshot.drawingLayers.map((layer) => ({ ...layer }));
    const textBoxes = snapshot.textBoxes.map((box) => ({ ...box }));
    setAnnotationDrawingLayers(drawingLayers);
    setAnnotationTextBoxes(textBoxes);
    setActiveAnnotationTextBoxId(null);
    setDraftTextRect(null);
    setCropSelection(null);
    setHasAnnotationMarks(drawingLayers.length > 0);
    resetAnnotationOrder(drawingLayers, textBoxes);
    window.requestAnimationFrame(() => {
      resizeAnnotationCanvas(true);
    });
  }

  function undoEditorAction() {
    const previous = editorUndoStack[editorUndoStack.length - 1];
    if (!previous) return;
    setEditorUndoStack((current) => current.slice(0, -1));
    restoreEditorSnapshot(previous);
  }

  function startAnnotation(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isPreviewCanvasInteractive || !activePreviewSource) return;
    resizeAnnotationCanvas();
    const point = annotationPoint(event);
    if (isAnnotationColorSampling && isEditingPreview) {
      event.preventDefault();
      sampleAnnotationColor(point);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    isAnnotationPointerActiveRef.current = true;
    setIsDrawingAnnotation(true);
    if (isCroppingPreview) {
      cropDragStartRef.current = point;
      setCropSelection({ ...normalizeCanvasRect(point, point, 0, 0), shape: cropShape });
      return;
    }
    if (annotationTool === "text") {
      textDragStartRef.current = point;
      setDraftTextRect(null);
      return;
    }
    pushEditorUndoSnapshot();
    clearAnnotationScratchCanvas();
    annotationLastPointRef.current = point;
    drawAnnotationLine(point, point);
    setHasAnnotationMarks(true);
  }

  function continueAnnotation(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isAnnotationPointerActiveRef.current) return;
    const nextPoint = annotationPoint(event);
    if (isCroppingPreview && cropDragStartRef.current) {
      setCropSelection({ ...normalizeCanvasRect(cropDragStartRef.current, nextPoint, 0, 0), shape: cropShape });
      return;
    }
    if (annotationTool === "text" && textDragStartRef.current) {
      const thresholdX = canvasUnitsForCssPixels(4, "x");
      const thresholdY = canvasUnitsForCssPixels(4, "y");
      const rect = normalizeCanvasRect(textDragStartRef.current, nextPoint, 0, 0);
      setDraftTextRect(rect.width >= thresholdX || rect.height >= thresholdY ? rect : null);
      return;
    }
    if (!annotationLastPointRef.current) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const nativeEvent of coalesced) {
      const pressure = normalizePointerPressure(nativeEvent);
      const point = annotationPointFromClient(nativeEvent.clientX, nativeEvent.clientY, pressure, event.currentTarget);
      drawAnnotationLine(annotationLastPointRef.current, point);
      annotationLastPointRef.current = point;
    }
    if (coalesced.length === 0) {
      drawAnnotationLine(annotationLastPointRef.current, nextPoint);
      annotationLastPointRef.current = nextPoint;
    }
    setHasAnnotationMarks(true);
  }

  function finishAnnotation(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isAnnotationPointerActiveRef.current) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const endPoint = annotationPoint(event);
    if (isCroppingPreview && cropDragStartRef.current) {
      setCropSelection({ ...normalizeCanvasRect(cropDragStartRef.current, endPoint, 0, 0), shape: cropShape });
      cropDragStartRef.current = null;
    } else if (annotationTool === "text" && textDragStartRef.current) {
      const rawRect = normalizeCanvasRect(textDragStartRef.current, endPoint, 0, 0);
      const thresholdX = canvasUnitsForCssPixels(12, "x");
      const thresholdY = canvasUnitsForCssPixels(12, "y");
      if (rawRect.width >= thresholdX && rawRect.height >= thresholdY) {
        const minWidth = canvasUnitsForCssPixels(MIN_TEXT_BOX_SIZE, "x");
        const minHeight = canvasUnitsForCssPixels(MIN_TEXT_BOX_SIZE, "y");
        const rect = normalizeCanvasRect(textDragStartRef.current, endPoint, minWidth, minHeight);
        const id = `text_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        pushEditorUndoSnapshot();
        const box: AnnotationTextBox = {
          id,
          order: nextAnnotationOrder(),
          ...rect,
          text: "",
          color: annotationColor,
          fontSize: canvasUnitsForCssPixels(annotationTextSize, "y"),
          bold: isAnnotationTextBold
        };
        setAnnotationTextBoxes((current) => [...current, box]);
        setActiveAnnotationTextBoxId(id);
        window.requestAnimationFrame(() => {
          const editor = document.querySelector<HTMLTextAreaElement>(`[data-annotation-text-box-id="${id}"]`);
          editor?.focus();
        });
      }
      setDraftTextRect(null);
      textDragStartRef.current = null;
    } else if (annotationLastPointRef.current) {
      commitAnnotationDrawingLayer();
    }
    isAnnotationPointerActiveRef.current = false;
    setIsDrawingAnnotation(false);
    annotationLastPointRef.current = null;
  }

  function clearAnnotationScratchCanvas() {
    const canvas = annotationCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function commitAnnotationDrawingLayer() {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setAnnotationDrawingLayers((current) => [
      ...current,
      {
        id: `draw_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        order: nextAnnotationOrder(),
        dataUrl
      }
    ]);
    clearAnnotationScratchCanvas();
    setHasAnnotationMarks(true);
  }

  function drawAnnotationLine(from: CanvasPoint, to: CanvasPoint) {
    const canvas = annotationCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.save();
    context.strokeStyle = annotationColor;
    context.lineWidth = canvasUnitsForCssPixels(annotationSize, "x") * ((from.pressure + to.pressure) / 2);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  function clearAnnotations() {
    pushEditorUndoSnapshot();
    clearAnnotationScratchCanvas();
    setAnnotationDrawingLayers([]);
    setHasAnnotationMarks(false);
    setAnnotationTextBoxes([]);
    setActiveAnnotationTextBoxId(null);
    setDraftTextRect(null);
    annotationOrderRef.current = 0;
  }

  function updateAnnotationTextBox(id: string, patch: Partial<AnnotationTextBox>) {
    setAnnotationTextBoxes((current) => current.map((box) => (box.id === id ? { ...box, ...patch } : box)));
  }

  function applyAnnotationColor(color: string, source: "manual" | "sample" = "manual") {
    setAnnotationColor(color);
    if (source === "manual") setSampledAnnotationColor(null);
    if (activeAnnotationTextBoxId) updateAnnotationTextBox(activeAnnotationTextBoxId, { color });
  }

  function applyAnnotationTextSize(fontSize: number) {
    setAnnotationTextSize(fontSize);
    if (activeAnnotationTextBoxId) updateAnnotationTextBox(activeAnnotationTextBoxId, { fontSize: canvasUnitsForCssPixels(fontSize, "y") });
  }

  function toggleAnnotationTextBold() {
    setIsAnnotationTextBold((current) => {
      const next = !current;
      if (activeAnnotationTextBoxId) updateAnnotationTextBox(activeAnnotationTextBoxId, { bold: next });
      return next;
    });
  }

  function focusAnnotationTextBox(box: AnnotationTextBox) {
    setActiveAnnotationTextBoxId(box.id);
    setAnnotationColor(box.color);
    setSampledAnnotationColor(null);
    setAnnotationTextSize(Math.round(textBoxDisplayFontSize(box)));
    setIsAnnotationTextBold(box.bold);
  }

  function togglePreviewEditMode() {
    if (isEditingPreview) {
      discardEmptyAnnotationTextBoxes();
      setIsAnnotationColorSampling(false);
      setPreviewMode("idle");
      setDraftTextRect(null);
      return;
    }
    setPreviewMode("edit");
    setIsAnnotationColorSampling(false);
    setCropSelection(null);
    resizeAnnotationCanvas();
  }

  function togglePreviewCropMode() {
    if (isCroppingPreview) {
      setPreviewMode("idle");
      setCropSelection(null);
      return;
    }
    discardEmptyAnnotationTextBoxes();
    setIsAnnotationColorSampling(false);
    setPreviewMode("crop");
    setDraftTextRect(null);
    resizeAnnotationCanvas();
  }

  function activatePartialImage(asset: ImageAsset) {
    setActiveGalleryAssetId(null);
    setActiveJob((job) => (job ? { ...job, outputs: [...job.outputs, asset] } : job));
  }

  function cssRectForCanvasRect(rect: CanvasRect): React.CSSProperties {
    const canvas = annotationCanvasRef.current;
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    return {
      left: `${(rect.x / width) * 100}%`,
      top: `${(rect.y / height) * 100}%`,
      width: `${(rect.width / width) * 100}%`,
      height: `${(rect.height / height) * 100}%`
    };
  }

  function cssSizeForCanvasUnits(canvasPixels: number): string {
    const canvas = annotationCanvasRef.current;
    if (!canvas?.width) return `${canvasPixels}px`;
    return `${(canvasPixels / canvas.width) * 100}cqw`;
  }

  function textBoxDisplayFontSize(box: AnnotationTextBox): number {
    return Math.max(8, cssPixelsForCanvasUnits(box.fontSize, "y"));
  }

  function drawWrappedText(context: CanvasRenderingContext2D, box: AnnotationTextBox) {
    const fontSize = Math.max(1, box.fontSize);
    const padding = Math.max(2, fontSize / 3);
    const lineHeight = fontSize * 1.25;
    const maxWidth = Math.max(1, box.width - padding * 2);
    const maxLines = Math.max(1, Math.floor((box.height - padding * 2) / lineHeight));
    context.save();
    context.fillStyle = box.color;
    context.font = `${box.bold ? 700 : 400} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textBaseline = "top";
    const paragraphs = box.text.split(/\n/);
    let lineIndex = 0;
    for (const paragraph of paragraphs) {
      let line = "";
      const units = paragraph.includes(" ") ? paragraph.split(/(\s+)/) : Array.from(paragraph);
      for (const unit of units) {
        const candidate = `${line}${unit}`;
        if (line && context.measureText(candidate).width > maxWidth) {
          context.fillText(line.trimEnd(), box.x + padding, box.y + padding + lineIndex * lineHeight, maxWidth);
          line = unit.trimStart();
          lineIndex += 1;
          if (lineIndex >= maxLines) break;
        } else {
          line = candidate;
        }
      }
      if (lineIndex >= maxLines) break;
      if (line) {
        context.fillText(line.trimEnd(), box.x + padding, box.y + padding + lineIndex * lineHeight, maxWidth);
        lineIndex += 1;
      }
      if (lineIndex >= maxLines) break;
    }
    context.restore();
  }

  function annotationLayerStyle(order: number): React.CSSProperties {
    return { zIndex: 20 + order };
  }

  function pruneEmptyAnnotationTextBox(id: string) {
    setAnnotationTextBoxes((current) => current.filter((box) => box.id !== id || box.text.trim().length > 0));
    setActiveAnnotationTextBoxId((current) => (current === id ? null : current));
  }

  function discardEmptyAnnotationTextBoxes() {
    setAnnotationTextBoxes((current) => current.filter((box) => box.text.trim().length > 0));
    setActiveAnnotationTextBoxId((current) => {
      const activeBox = annotationTextBoxes.find((box) => box.id === current);
      return activeBox?.text.trim() ? current : null;
    });
  }

  function startTextBoxResize(event: React.PointerEvent<HTMLElement>, box: AnnotationTextBox) {
    event.preventDefault();
    event.stopPropagation();
    pushEditorUndoSnapshot();
    setActiveAnnotationTextBoxId(box.id);
    setAnnotationColor(box.color);
    setAnnotationTextSize(Math.round(textBoxDisplayFontSize(box)));
    setIsAnnotationTextBold(box.bold);
    textResizeRef.current = {
      id: box.id,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: box.width,
      startHeight: box.height
    };
  }

  function extensionForImageMime(mimeType = "image/png"): string {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    return "png";
  }

  function exportMimeForGalleryAsset(asset?: GalleryAsset): string {
    const extension = (asset?.fileName ?? asset?.originalName ?? "").toLowerCase().split(".").pop();
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    return "image/png";
  }

  function editedFileName(suffix = "edited", mimeType = "image/png"): string {
    const sourceName = activeGalleryAsset?.originalName ?? activeImage?.fileName ?? "CrossGen";
    const baseName = sourceName.replace(/\.[^.]+$/, "") || "CrossGen";
    return `${baseName}-${suffix}.${extensionForImageMime(mimeType)}`;
  }

  function imageLoadError(): Error {
    return new Error(language === "zh" ? "编辑图处理失败。" : "Edited image processing failed.");
  }

  async function loadPreviewImage(source: string): Promise<HTMLImageElement> {
    const image = new Image();
    if (/^(?:https?:|image2tools-asset:)/i.test(source)) {
      image.crossOrigin = "anonymous";
    }
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(imageLoadError());
      image.src = source;
    });
    if (!(image.naturalWidth || image.width) || !(image.naturalHeight || image.height)) throw imageLoadError();
    return image;
  }

  async function getExportablePreviewImage(source: string): Promise<HTMLImageElement> {
    try {
      return await loadPreviewImage(source);
    } catch (error) {
      const renderedImage = annotationImageRef.current;
      if (
        renderedImage?.complete &&
        ((renderedImage.naturalWidth || renderedImage.width) > 0) &&
        ((renderedImage.naturalHeight || renderedImage.height) > 0)
      ) {
        return renderedImage;
      }
      throw error;
    }
  }

  async function renderEditedPreviewCanvas(): Promise<HTMLCanvasElement> {
    if (!activePreviewSource) throw imageLoadError();
    resizeAnnotationCanvas();
    const image = await getExportablePreviewImage(activePreviewSource);
    const output = document.createElement("canvas");
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) throw imageLoadError();
    output.width = imageWidth;
    output.height = imageHeight;
    const context = output.getContext("2d");
    if (!context) throw imageLoadError();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(image, 0, 0, output.width, output.height);
    const layers = [
      ...annotationDrawingLayers.map((layer) => ({ kind: "drawing" as const, order: layer.order, layer })),
      ...annotationTextBoxes
        .filter((box) => box.text.trim())
        .map((box) => ({ kind: "text" as const, order: box.order, box }))
    ].sort((a, b) => a.order - b.order);

    for (const item of layers) {
      if (item.kind === "drawing") {
        const layerImage = await loadPreviewImage(item.layer.dataUrl);
        context.drawImage(layerImage, 0, 0, output.width, output.height);
      } else {
        drawWrappedText(context, item.box);
      }
    }
    return output;
  }

  async function downloadEditedPreview() {
    try {
      discardEmptyAnnotationTextBoxes();
      const output = await renderEditedPreviewCanvas();
      await downloadCanvasAsImage(output, "edited");
      flashButton("download:edited");
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function downloadCurrentPreview() {
    if (isCroppingPreview && cropSelection) {
      try {
        const output = await renderCropSelectionCanvas();
        await downloadCanvasAsImage(output, "cropped");
        flashButton("download:edited");
      } catch (error) {
        setNotice({ kind: "error", text: normalizeNotice(error) });
      }
      return;
    }
    if (hasEditedPreviewChanges) {
      await downloadEditedPreview();
      return;
    }
    await downloadAsset(activeImage);
  }

  async function downloadCanvasAsImage(output: HTMLCanvasElement, suffix: string) {
    const dataUrl = output.toDataURL("image/png");
    const suggestedName = editedFileName(suffix);
    if (bridge) {
      const savedPath = await bridge.downloadEditedImage({
        dataUrl,
        suggestedName
      });
      if (savedPath) {
        setNotice({ kind: "success", text: copy.notices.savedTo(savedPath) });
      }
    } else {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = suggestedName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice({ kind: "success", text: copy.editedDownloadStarted });
    }
  }

  async function saveEditedPreviewToGallery() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSelectImages });
      return;
    }
    try {
      discardEmptyAnnotationTextBoxes();
      const output = await renderEditedPreviewCanvas();
      if (activeGalleryAsset) {
        openGallerySaveChoice(output, activeGalleryAsset, "edited");
        return;
      }
      const galleryAsset = await bridge.addEditedImageToGallery({
        dataUrl: output.toDataURL("image/png"),
        originalName: editedFileName(),
        folderId: historyGalleryTargetFolderId,
        tags: activeJob ? historyGalleryTags(activeJob) : []
      });
      if (galleryAsset) mergeGalleryAssetsIntoSnapshot([galleryAsset]);
      flashButton("gallery:edited");
      setNotice({ kind: galleryAsset ? "success" : "info", text: galleryAsset ? copy.galleryAdded : copy.galleryAddCanceled });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function saveCurrentPreviewToGallery() {
    if (isCroppingPreview && cropSelection) {
      await saveCropSelectionToGallery();
      return;
    }
    if (hasEditedPreviewChanges) {
      await saveEditedPreviewToGallery();
      return;
    }
    if (activeGalleryAsset) {
      setNotice({ kind: "info", text: copy.galleryAlreadyInGallery });
      return;
    }
    if (activeImage) {
      await addHistoryAssetToGallery(activeImage);
      flashButton("gallery:current");
    }
  }

  async function renderCropSelectionCanvas(): Promise<HTMLCanvasElement> {
    if (!cropSelection || cropSelection.width < 4 || cropSelection.height < 4) throw imageLoadError();
    const sourceCanvas = await renderEditedPreviewCanvas();
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(cropSelection.width));
    cropCanvas.height = Math.max(1, Math.round(cropSelection.height));
    const context = cropCanvas.getContext("2d");
    if (!context) throw imageLoadError();
    if (cropSelection.shape === "ellipse") {
      context.save();
      context.beginPath();
      context.ellipse(cropCanvas.width / 2, cropCanvas.height / 2, cropCanvas.width / 2, cropCanvas.height / 2, 0, 0, Math.PI * 2);
      context.clip();
    }
    context.drawImage(
      sourceCanvas,
      cropSelection.x,
      cropSelection.y,
      cropSelection.width,
      cropSelection.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );
    if (cropSelection.shape === "ellipse") context.restore();
    return cropCanvas;
  }

  async function saveCropSelectionToGallery() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSelectImages });
      return;
    }
    try {
      const output = await renderCropSelectionCanvas();
      if (activeGalleryAsset) {
        openGallerySaveChoice(output, activeGalleryAsset, "cropped");
        return;
      }
      const galleryAsset = await bridge.addEditedImageToGallery({
        dataUrl: output.toDataURL("image/png"),
        originalName: editedFileName("cropped"),
        folderId: historyGalleryTargetFolderId,
        tags: activeJob ? historyGalleryTags(activeJob) : []
      });
      if (galleryAsset) mergeGalleryAssetsIntoSnapshot([galleryAsset]);
      flashButton("gallery:cropped");
      setNotice({ kind: galleryAsset ? "success" : "info", text: galleryAsset ? copy.galleryAdded : copy.galleryAddCanceled });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function openGallerySaveChoice(output: HTMLCanvasElement, asset: GalleryAsset, suffix: string) {
    const mimeType = exportMimeForGalleryAsset(asset);
    setGallerySaveChoiceDialog({
      asset,
      dataUrl: output.toDataURL(mimeType),
      suggestedName: editedFileName(suffix, mimeType)
    });
  }

  async function replaceActiveGalleryImage() {
    if (!bridge || !gallerySaveChoiceDialog) return;
    try {
      const updated = await bridge.replaceGalleryAssetImage(gallerySaveChoiceDialog.asset.id, {
        dataUrl: gallerySaveChoiceDialog.dataUrl,
        originalName: gallerySaveChoiceDialog.asset.originalName,
        folderId: gallerySaveChoiceDialog.asset.folderId ?? null,
        tags: gallerySaveChoiceDialog.asset.tags
      });
      setSnapshot((current) => ({ ...current, galleryAssets: current.galleryAssets.map((asset) => asset.id === updated.id ? updated : asset) }));
      setActiveGalleryAssetId(updated.id);
      setGallerySaveChoiceDialog(null);
      setEditedImageDataUrl(null);
      setPreviewMode("idle");
      setCropSelection(null);
      flashButton("gallery:edited");
      setNotice({ kind: "success", text: copy.galleryReplaced });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function saveActiveGalleryImageAsCopy() {
    if (!bridge || !gallerySaveChoiceDialog) return;
    try {
      const galleryAsset = await bridge.addEditedImageToGallery({
        dataUrl: gallerySaveChoiceDialog.dataUrl,
        originalName: gallerySaveChoiceDialog.suggestedName,
        folderId: gallerySaveChoiceDialog.asset.folderId ?? null,
        tags: gallerySaveChoiceDialog.asset.tags
      });
      if (galleryAsset) {
        mergeGalleryAssetsIntoSnapshot([galleryAsset]);
        setActiveGalleryAssetId(galleryAsset.id);
      }
      setGallerySaveChoiceDialog(null);
      setEditedImageDataUrl(null);
      setPreviewMode("idle");
      setCropSelection(null);
      flashButton("gallery:edited");
      setNotice({ kind: galleryAsset ? "success" : "info", text: galleryAsset ? copy.gallerySavedAsCopy : copy.galleryAddCanceled });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function applyCropSelection() {
    if (!cropSelection || cropSelection.width < 4 || cropSelection.height < 4) return;
    try {
      pushEditorUndoSnapshot();
      const cropCanvas = await renderCropSelectionCanvas();
      setEditedImageDataUrl(cropCanvas.toDataURL("image/png"));
      setCropSelection(null);
      setAnnotationDrawingLayers([]);
      setAnnotationTextBoxes([]);
      setActiveAnnotationTextBoxId(null);
      setHasAnnotationMarks(false);
      annotationOrderRef.current = 0;
      window.requestAnimationFrame(() => resizeAnnotationCanvas(true));
      setNotice({ kind: "success", text: copy.cropApplied });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function handleImageContextMenu(event: React.MouseEvent, asset: ImageAsset | undefined, jobPrompt: string) {
    event.preventDefault();
    if (!asset) return;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      asset,
      jobPrompt
    });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  async function handleContextMenuSaveImage() {
    if (!contextMenu) return;
    const asset = contextMenu.asset;
    closeContextMenu();
    if (asset && hasEditedPreviewChanges) {
      await downloadEditedPreview();
      return;
    }
    await downloadAsset(asset);
  }

  async function handleContextMenuCopyPath() {
    if (!contextMenu) return;
    const path = contextMenu.asset.path;
    closeContextMenu();
    await copyImagePath(path, `copy:path:${contextMenu.asset.id}`);
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
    resizeAnnotationCanvas(true);
    setPreviewMode("idle");
    setAnnotationTool("draw");
    setEditedImageDataUrl(null);
    setEditorUndoStack([]);
    setAnnotationDrawingLayers([]);
    setAnnotationTextBoxes([]);
    setActiveAnnotationTextBoxId(null);
    setDraftTextRect(null);
    setCropSelection(null);
    setHasAnnotationMarks(false);
    setIsAnnotationColorPickerOpen(false);
    annotationOrderRef.current = 0;
  }, [activeImage?.id, activeImageSource]);

  useEffect(() => {
    if (!isPreviewCanvasInteractive && !hasEditorOverlay) return;
    resizeAnnotationCanvas();
    const handleResize = () => resizeAnnotationCanvas();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isPreviewCanvasInteractive, hasEditorOverlay, activePreviewSource]);

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

  useEffect(() => {
    const tooltipTarget = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      return target.closest<HTMLElement>("[data-tooltip]");
    };
    const showTooltip = (target: HTMLElement) => {
      const text = target.dataset.tooltip?.trim();
      if (!text) return;
      const rect = target.getBoundingClientRect();
      const placement = target.classList.contains("tooltip-below") ? "bottom" : "top";
      setGlobalTooltip({
        text,
        x: clamp(rect.left + rect.width / 2, 92, window.innerWidth - 92),
        y: placement === "bottom" ? rect.bottom : rect.top,
        placement
      });
    };
    const handlePointerOver = (event: PointerEvent) => {
      const target = tooltipTarget(event.target);
      if (target) showTooltip(target);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const target = tooltipTarget(event.target);
      if (target) showTooltip(target);
    };
    const handlePointerOut = (event: PointerEvent) => {
      const current = tooltipTarget(event.target);
      if (!current) return;
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-tooltip]") : null;
      if (next === current) return;
      setGlobalTooltip(null);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(event.target);
      if (target) showTooltip(target);
    };
    const handleFocusOut = () => setGlobalTooltip(null);
    const hideTooltip = () => setGlobalTooltip(null);

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
    };
  }, []);

  useEffect(() => {
    if (!isGalleryFolderMenuOpen && !galleryFolderContextMenu && !galleryAssetContextMenu) return;
    const handleClick = () => {
      setIsGalleryFolderMenuOpen(false);
      closeGalleryFolderContextMenu();
      setGalleryAssetContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsGalleryFolderMenuOpen(false);
        closeGalleryFolderContextMenu();
        setGalleryAssetContextMenu(null);
      }
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [galleryAssetContextMenu, galleryFolderContextMenu, isGalleryFolderMenuOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = textResizeRef.current;
      const canvas = annotationCanvasRef.current;
      const host = annotationFrameRef.current;
      const hostRect = host?.getBoundingClientRect();
      if (!resizeState || !canvas || !hostRect) return;
      const scaleX = hostRect.width > 0 ? canvas.width / hostRect.width : 1;
      const scaleY = hostRect.height > 0 ? canvas.height / hostRect.height : 1;
      setAnnotationTextBoxes((current) => current.map((box) => {
        if (box.id !== resizeState.id) return box;
        return {
          ...box,
          width: clamp(resizeState.startWidth + (event.clientX - resizeState.startX) * scaleX, canvasUnitsForCssPixels(MIN_TEXT_BOX_SIZE, "x"), Math.max(canvasUnitsForCssPixels(MIN_TEXT_BOX_SIZE, "x"), canvas.width - box.x)),
          height: clamp(resizeState.startHeight + (event.clientY - resizeState.startY) * scaleY, canvasUnitsForCssPixels(MIN_TEXT_BOX_SIZE, "y"), Math.max(canvasUnitsForCssPixels(MIN_TEXT_BOX_SIZE, "y"), canvas.height - box.y))
        };
      }));
    };
    const handlePointerUp = () => {
      textResizeRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (!galleryFolderDialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGalleryFolderDialog();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [galleryFolderDialog]);

  function handlePreviewPanStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeImage || isPreviewCanvasInteractive || previewZoom <= 1) return;
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

  function nudgeColumn(column: "sidebar" | "history" | "preview", delta: number) {
    if (column === "sidebar") {
      const rawWidth = sidebarWidthRef.current + delta;
      if (rawWidth <= LEFT_RAIL_AUTO_COLLAPSE_WIDTH) {
        setShellWidthVariable("--sidebar-width", COMPACT_SIDEBAR_WIDTH);
        setIsSidebarCollapsed(true);
        return;
      }
      const nextWidth = clamp(rawWidth, MIN_SIDEBAR_WIDTH, maxSidebarWidth);
      sidebarWidthRef.current = nextWidth;
      setShellWidthVariable("--sidebar-width", nextWidth);
      setSidebarWidth(nextWidth);
    } else if (column === "history") {
      const rawWidth = historyWidthRef.current + delta;
      applyRightRailWidth(rawWidth, { forceCollapsed: rawWidth <= getRightRailAutoCollapseWidth() ? true : undefined });
    } else {
      setPreviewPanelRatio((current) => clamp(current + delta / 1000, MIN_PREVIEW_PANEL_RATIO, MAX_PREVIEW_PANEL_RATIO));
    }
  }

  function resizeHandleKeyDown(column: "sidebar" | "history" | "preview", event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeColumn(column, column === "sidebar" || column === "preview" ? -step : step);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeColumn(column, column === "sidebar" || column === "preview" ? step : -step);
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
      setMaskDataUrl(canvas.toDataURL(maskMimeTypeForSource(sourceAsset?.mimeType)));
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
    setMaskAsset(null);
  }

  const sizeValidation = openAIParams ? validateGptImage2Size(openAIParams.size) : null;
  const maskDescription = activeInpaintCapability === "guided-region" ? copy.guidedRegionDescription : copy.maskDescription;
  const parameterSummary = openAIParams ? (
    <>
      <label>
        <span>{copy.size}</span>
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
      <label>
        <span>{copy.quality}</span>
        <select value={openAIParams.quality} onChange={(event) => updateOpenAIParams({ quality: event.target.value as ImageQuality })}>
          {qualityOptions.map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{copy.format}</span>
        <select value={openAIParams.outputFormat} onChange={(event) => updateOpenAIParams({ outputFormat: event.target.value as ImageFormat })}>
          {formatOptions.map((format) => (
            <option key={format} value={format}>
              {format.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
    </>
  ) : geminiParams ? (
    <>
      <label>
        <span>{copy.aspectRatio}</span>
        <select value={geminiParams.aspectRatio} onChange={(event) => updateGeminiParams({ aspectRatio: event.target.value as GeminiAspectRatio })}>
          {GEMINI_ASPECT_RATIO_OPTIONS.map((aspectRatio) => (
            <option key={aspectRatio} value={aspectRatio}>
              {aspectRatio}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{copy.resolution}</span>
        <select value={geminiParams.resolution} onChange={(event) => updateGeminiParams({ resolution: event.target.value as GeminiResolution })}>
          {GEMINI_RESOLUTION_OPTIONS.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{copy.count}</span>
        <input type="number" min="1" max="1" value={geminiParams.outputCount} onChange={() => updateGeminiParams({ outputCount: 1 })} />
      </label>
    </>
  ) : (
    <>
      <label>
        <span>{copy.model}</span>
        <input value={generalParams?.model || copy.generalFallback} readOnly />
      </label>
      <label>
        <span>{copy.provider}</span>
        <input value={providerLabelFromKind(generalParams?.providerKind ?? activeConfig.kind)} readOnly />
      </label>
    </>
  );
  const advancedControls = openAIParams ? (
    <div className="advanced-controls">
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
        {copy.compression}
        <div className="range-field">
          <input
            type="range"
            min="0"
            max="100"
            value={openAIParams.outputCompression}
            disabled={openAIParams.outputFormat === "png"}
            onChange={(event) => updateOpenAIParams({ outputCompression: Number(event.target.value) })}
          />
          <span className="range-value">{openAIParams.outputFormat === "png" ? copy.pngIgnoresCompression : `${openAIParams.outputCompression}%`}</span>
        </div>
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

  function renderBatchTagMenu(target: BatchTagTarget, embedded = false) {
    const tags = globalTagOptions;
    const selectedItems = target === "history" ? selectedHistoryJobs : selectedGalleryAssets;
    return (
      <div
        className={embedded ? "batch-tag-panel" : "batch-tag-menu"}
        role="menu"
        aria-label={copy.tagManager}
        data-drift="subtle"
        onMouseMove={embedded ? undefined : movePreviewToolbarTowardPointer}
        onMouseLeave={embedded ? undefined : resetPreviewToolbarDrift}
      >
        <div className="batch-tag-menu-title">
          <Tags size={14} />
          <span>{copy.batchAddTags}</span>
        </div>
        <div className="batch-tag-options">
          {tags.length > 0 ? tags.map((tag) => {
            const isApplied = selectedItems.length > 0 && selectedItems.every((item) => item.tags.includes(tag));
            return (
              <button
                key={tag}
                type="button"
                className={isApplied ? "active" : undefined}
                onClick={() => void applyBatchTag(target, tag)}
                role="menuitem"
              >
                {tag}
              </button>
            );
          }) : <span className="batch-tag-empty">{copy.noTagsYet}</span>}
        </div>
        <form
          className="batch-tag-new"
          onSubmit={(event) => {
            event.preventDefault();
            void applyBatchTag(target, batchTagInput);
          }}
        >
          <input
            value={batchTagInput}
            onChange={(event) => setBatchTagInput(event.target.value)}
            placeholder={copy.newTagPlaceholder}
            aria-label={copy.newTagPlaceholder}
          />
          <button type="submit" className="icon-button" disabled={!batchTagInput.trim()} aria-label={copy.addTag} data-tooltip={copy.addTag}>
            <Plus size={14} />
          </button>
        </form>
      </div>
    );
  }

  function renderTagManagerMenu() {
    return (
      <div
        className="batch-tag-menu tag-manager-menu"
        role="menu"
        aria-label={copy.tagManager}
        onMouseMove={movePreviewToolbarTowardPointer}
        onMouseLeave={resetPreviewToolbarDrift}
      >
        {canTagCurrentSelection && (
          <div className="tag-manager-section">
            {renderBatchTagMenu(selectedTagTarget, true)}
          </div>
        )}
        <div className="batch-tag-menu-title">
          <Tags size={14} />
          <span>{copy.tagManager}</span>
        </div>
        <div className="tag-manager-list">
          {managedTagOptions.length > 0 ? managedTagOptions.map((tag) => {
            const draft = tagRenameDrafts[tag] ?? tag;
            return (
              <div key={tag} className="tag-manager-row">
                <input
                  value={draft}
                  onChange={(event) => setTagRenameDrafts((current) => ({ ...current, [tag]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void renameTagEverywhere(tag, draft);
                    }
                  }}
                  aria-label={copy.tagRename}
                />
                <button type="button" className="icon-button" onClick={() => void renameTagEverywhere(tag, draft)} aria-label={copy.tagRename} data-tooltip={copy.tagRename}>
                  <Save size={13} />
                </button>
                <button type="button" className="icon-button danger" onClick={() => void deleteTagEverywhere(tag)} aria-label={copy.tagDelete} data-tooltip={copy.tagDelete}>
                  <X size={13} />
                </button>
              </div>
            );
          }) : <span className="batch-tag-empty">{copy.noTagsYet}</span>}
        </div>
      </div>
    );
  }

  function renderHistoryGalleryTargetMenu(result: ImageAsset | undefined, job: GenerationJob) {
    if (!result || historyGalleryMenuJobId !== job.id) return null;
    return (
      <div className="history-gallery-target-menu" role="menu" aria-label={copy.galleryAddTargetFolder}>
        <button type="button" onClick={() => void addHistoryAssetToGallery(result, null, job)} role="menuitem">
          <Folder size={14} />
          <span>{copy.galleryUncategorized}</span>
        </button>
        {snapshot.galleryFolders.map((folder) => (
          <button key={folder.id} type="button" onClick={() => void addHistoryAssetToGallery(result, folder.id, job)} role="menuitem">
            <FolderOpen size={14} />
            <span>{galleryFolderDisplayPath(folder)}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <main
      ref={appShellRef}
      className={[
        "app-shell",
        isSidebarCompact ? "sidebar-collapsed" : "",
        isRightRailStacked ? "right-rail-stacked" : "",
        isRightRailDense ? "right-rail-dense" : "",
        isRightRailCompact ? "right-rail-collapsed" : ""
      ].filter(Boolean).join(" ")}
      style={
        {
          "--sidebar-width": `${isSidebarCompact ? COMPACT_SIDEBAR_WIDTH : sidebarWidth}px`,
          "--history-width": `${historyWidth}px`,
          "--right-rail-thumb-size": `${rightRailThumbSize}px`,
          "--preview-ratio": previewPanelRatio,
          "--sidebar-collapse-button-y": `${sidebarCollapseButtonY}px`,
          "--right-rail-collapse-button-y": `${rightRailCollapseButtonY}px`
        } as React.CSSProperties
      }
    >
      <PerfProfiler id="Sidebar">
      <aside className={isSidebarCompact ? "sidebar collapsed" : "sidebar"}>
        <header className="brand-block">
          <img className="brand-icon" src="./brand-logo.png" alt="" />
          <div>
            <h1>CrossGen</h1>
            <p className="muted">{copy.tagline}</p>
          </div>
        </header>

        <button
          type="button"
          className={`icon-button sidebar-collapse-button ${isSidebarCompact ? "collapsed" : ""}`}
          onClick={() => setIsSidebarCollapsed((current) => !current)}
          onMouseMove={movePreviewToolbarTowardPointer}
          onMouseLeave={resetPreviewToolbarDrift}
          aria-label={isSidebarCompact ? copy.show : copy.hide}
          data-tooltip={isSidebarCompact ? copy.show : copy.hide}
        >
          <ChevronLeft size={16} />
        </button>

        <div className="sidebar-mini-stack" aria-label={copy.parameters}>
          <button type="button" className="icon-button" onClick={() => openApiConfigDialog(activeConfig)} aria-label={copy.provider} data-tooltip={copy.provider}>
            <KeyRound size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => setIsSidebarCollapsed(false)} aria-label={copy.launchModels} data-tooltip={copy.launchModels}>
            <Rocket size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => setShowAdvanced((current) => !current)} aria-label={copy.parameters} data-tooltip={copy.parameters}>
            <SlidersHorizontal size={17} />
          </button>
        </div>
        <div className="sidebar-mini-utility">
          <button type="button" className="icon-button" onClick={toggleLanguage} aria-label={copy.language} data-tooltip={copy.language}>
            <span className="language-short">{language === "en" ? "En" : "简"}</span>
          </button>
          <button type="button" className="icon-button" onClick={toggleThemeMode} aria-label={`${copy.theme}: ${themeModeLabel(copy, themeMode)}`} data-tooltip={`${copy.theme}: ${themeModeLabel(copy, themeMode)}`}>
            {renderThemeIcon()}
          </button>
          {updateCheck?.status === "available" ? (
            <button type="button" className="icon-button" onClick={downloadAndInstallUpdate} disabled={!bridge || isInstallingUpdate} aria-label={copy.installUpdate} data-tooltip={copy.installUpdate}>
              {isInstallingUpdate ? <Loader2 className="spin" size={16} /> : <ChevronUp size={17} />}
            </button>
          ) : (
            <button type="button" className="icon-button" onClick={checkForUpdates} disabled={!bridge || isCheckingUpdate} aria-label={copy.checkUpdates} data-tooltip={formatUpdateStatusShort(updateCheck)}>
              {isCheckingUpdate ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            </button>
          )}
        </div>
        <div className="sidebar-full-stack">

        <ProviderSummarySection
          copy={copy}
          activeConfig={activeConfig}
          displayName={apiAccessDisplayName(activeConfig, copy.apiAccessUntitled)}
          providerLabel={providerLabelFromKind(activeConfig.kind)}
          baseUrlSummary={summarizeBaseURL(activeConfig.baseURL)}
          discoveryText={discoveryText}
          connectionStatus={connectionCheck.status}
          connectionLabel={connectionLabel}
          connectionTitle={connectionTitle}
          testingConnection={isTestingConnection}
          onOpen={() => openApiConfigDialog(activeConfig)}
        />

        <LaunchSection
          copy={copy}
          activeConfig={activeConfig}
          activeProviderKind={params.providerKind}
          activeLaunchDisplay={activeLaunchDisplay}
          launchButtons={launchButtons}
          openLaunchMenuId={openLaunchMenuId}
          saving={isSavingConfig}
          providerLabelForKind={providerLabelFromKind}
          modelOptionsForLaunch={getLaunchModelOptions}
          onToggleLaunchMenu={(launchId, open) => setOpenLaunchMenuId(open ? launchId : null)}
          onLaunch={(button) => void launchModel(button)}
          onSelectModel={(launchId, model) => void selectLaunchModel(launchId, model)}
        />

        <ParameterSection
          copy={copy}
          expanded={showAdvanced}
          summary={parameterSummary}
          controls={advancedControls}
          onToggle={() => setShowAdvanced((current) => !current)}
        />

        <section className="notice-area" data-kind={notice.kind} aria-live={notice.kind === "error" ? "assertive" : "polite"} aria-atomic="true">
          {notice.kind === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{notice.text}</span>
        </section>

        <section className="sidebar-utility-bar sidebar-bottom" ref={sidebarUtilityBarRef}>
          <div className="sidebar-utility-left">
            <button type="button" className="language-pill" onClick={toggleLanguage} aria-label={copy.language} data-tooltip={copy.language}>
              {language === "en" ? "En" : "简"}
            </button>
            <button type="button" className="icon-button theme-mode-button" onClick={toggleThemeMode} aria-label={`${copy.theme}: ${themeModeLabel(copy, themeMode)}`} data-tooltip={`${copy.theme}: ${themeModeLabel(copy, themeMode)}`}>
              {renderThemeIcon()}
            </button>
            {updateCheck?.status === "available" ? (
              <button type="button" className="icon-button utility-check-button" onClick={downloadAndInstallUpdate} disabled={!bridge || isCheckingUpdate || isInstallingUpdate} aria-label={copy.installUpdate} data-tooltip={copy.installUpdate}>
                {isInstallingUpdate ? <Loader2 className="spin" size={16} /> : <ChevronUp size={16} />}
              </button>
            ) : (
              <button type="button" className="icon-button utility-check-button" onClick={checkForUpdates} disabled={!bridge || isCheckingUpdate} aria-label={copy.checkLatestVersion} data-tooltip={copy.checkLatestVersion}>
                {isCheckingUpdate ? <Loader2 className="spin" size={16} /> : <RefreshCw size={15} />}
              </button>
            )}
          </div>
          <div className="sidebar-utility-version">
            <span className="connection-badge version-status-badge" data-status={versionBadgeStatus(updateCheck)} title={formatUpdateStatusShort(updateCheck)}>
              {isCheckingUpdate ? (
                <Loader2 className="spin" size={12} />
              ) : updateCheck?.status === "error" ? (
                <AlertTriangle size={12} />
              ) : updateCheck?.status === "available" ? (
                <ChevronUp size={12} />
              ) : (
                <CheckCircle2 size={12} />
              )}
              {formatUpdateStatusShort(updateCheck)}
            </span>
            <small>{copy.currentVersion} {snapshot.appVersion}</small>
          </div>
        </section>
        </div>
      </aside>
      </PerfProfiler>

      <div
        className="column-resizer sidebar-resizer"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maxSidebarWidth}
        aria-valuenow={sidebarWidth}
        aria-disabled={isSidebarCompact}
        tabIndex={isSidebarCompact ? -1 : 0}
        onPointerDown={(event) => {
          if (isSidebarCompact) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizingColumn("sidebar");
        }}
        onKeyDown={(event) => {
          if (!isSidebarCompact) resizeHandleKeyDown("sidebar", event);
        }}
      />

      <PerfProfiler id="Workspace">
      <section className="workspace">
        <div className="preview-layout" ref={previewLayoutRef}>
          <ImageEditor
            copy={copy}
            language={language}
            resultCanvasRef={resultCanvasRef}
            zoomSurfaceRef={zoomSurfaceRef}
            annotationFrameRef={annotationFrameRef}
            annotationImageRef={annotationImageRef}
            annotationCanvasRef={annotationCanvasRef}
            activePreviewSource={activePreviewSource}
            activeJobError={activeJobError}
            isGenerating={isRunning}
            generationElapsedSeconds={generationElapsedSeconds}
            activeImage={activeImage}
            activeResults={activeResults}
            partialImages={partialImages}
            previewZoom={previewZoom}
            previewPan={previewPan}
            previewZoomPercent={previewZoomPercent}
            isPanning={isPanning}
            isPreviewCanvasInteractive={isPreviewCanvasInteractive}
            hasEditorOverlay={hasEditorOverlay}
            isEditingPreview={isEditingPreview}
            isCroppingPreview={isCroppingPreview}
            hasEditedPreviewChanges={hasEditedPreviewChanges}
            annotationDrawingLayers={annotationDrawingLayers}
            annotationTextBoxes={annotationTextBoxes}
            activeAnnotationTextBoxId={activeAnnotationTextBoxId}
            draftTextRect={draftTextRect}
            cropSelection={cropSelection}
            annotationTool={annotationTool}
            annotationColor={annotationColor}
            annotationSize={annotationSize}
            annotationTextSize={annotationTextSize}
            isAnnotationTextBold={isAnnotationTextBold}
            isAnnotationColorSampling={isAnnotationColorSampling}
            sampledAnnotationColor={sampledAnnotationColor}
            isAnnotationColorPickerOpen={isAnnotationColorPickerOpen}
            editorUndoStackLength={editorUndoStack.length}
            cropShape={cropShape}
            assetSource={assetSource}
            buttonFeedbackClass={buttonFeedbackClass}
            annotationLayerStyle={annotationLayerStyle}
            cssRectForCanvasRect={cssRectForCanvasRect}
            cssSizeForCanvasUnits={cssSizeForCanvasUnits}
            onOpenPreview={() => setIsPreviewOpen(true)}
            onPreviewPanStart={handlePreviewPanStart}
            onPreviewPanMove={handlePreviewPanMove}
            onPreviewPanEnd={handlePreviewPanEnd}
            onResizeAnnotationCanvas={resizeAnnotationCanvas}
            onImageContextMenu={(event) => handleImageContextMenu(event, activeImage, activeJob?.prompt ?? "")}
            onStartAnnotation={startAnnotation}
            onContinueAnnotation={continueAnnotation}
            onFinishAnnotation={finishAnnotation}
            onTextBoxFocus={focusAnnotationTextBox}
            onTextBoxChange={(id, text) => updateAnnotationTextBox(id, { text })}
            onPruneEmptyTextBox={pruneEmptyAnnotationTextBox}
            onStartTextBoxResize={startTextBoxResize}
            onMoveToolbarTowardPointer={movePreviewToolbarTowardPointer}
            onResetToolbarDrift={resetPreviewToolbarDrift}
            onToggleEditMode={togglePreviewEditMode}
            onToggleCropMode={togglePreviewCropMode}
            onDownloadCurrentPreview={() => void downloadCurrentPreview()}
            onSaveCurrentPreviewToGallery={() => void saveCurrentPreviewToGallery()}
            onSelectDrawTool={() => {
              discardEmptyAnnotationTextBoxes();
              setIsAnnotationColorSampling(false);
              setAnnotationTool("draw");
            }}
            onSelectTextTool={() => {
              setIsAnnotationColorSampling(false);
              setAnnotationTool("text");
            }}
            onToggleAnnotationColorSampling={() => {
              discardEmptyAnnotationTextBoxes();
              setIsAnnotationColorPickerOpen(false);
              setIsAnnotationColorSampling((current) => !current);
            }}
            onToggleAnnotationColorPicker={() => {
              setIsAnnotationColorSampling(false);
              setIsAnnotationColorPickerOpen((current) => !current);
            }}
            onApplyAnnotationColor={applyAnnotationColor}
            onCloseAnnotationColorPicker={() => setIsAnnotationColorPickerOpen(false)}
            onAnnotationSizeChange={setAnnotationSize}
            onAnnotationTextSizeChange={applyAnnotationTextSize}
            onToggleAnnotationTextBold={toggleAnnotationTextBold}
            onUndoEditorAction={undoEditorAction}
            onClearAnnotations={clearAnnotations}
            onCropShapeChange={setCropShape}
            onSaveCropSelectionToGallery={() => void saveCropSelectionToGallery()}
            onApplyCropSelection={() => void applyCropSelection()}
            onZoomOut={() => adjustPreviewZoom(-PREVIEW_ZOOM_STEP)}
            onZoomIn={() => adjustPreviewZoom(PREVIEW_ZOOM_STEP)}
            onResetPreviewView={resetPreviewView}
            onSelectResult={setSelectedResultId}
            onActivatePartialImage={activatePartialImage}
          />

          <div
            className="preview-resizer"
            role="separator"
            aria-label="Resize preview"
            aria-orientation="vertical"
            aria-valuemin={Math.round(MIN_PREVIEW_PANEL_RATIO * 100)}
            aria-valuemax={Math.round(MAX_PREVIEW_PANEL_RATIO * 100)}
            aria-valuenow={Math.round(previewPanelRatio * 100)}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizingColumn("preview");
            }}
            onKeyDown={(event) => resizeHandleKeyDown("preview", event)}
          />

          <section className="input-panel">
            <div className="workspace-topbar">
              {isGeneralMode ? (
                <div className="general-mode-status">
                  <Layers size={16} />
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
                    <Type size={16} />
                    <span>{copy.tabs.text2img.title}</span>
                  </button>
                  <button
                    type="button"
                    className={tabMode === "img2img" ? "mode-tab active" : "mode-tab"}
                    onClick={() => {
                      markDraftChanged();
                      setTabMode("img2img");
                    }}
                  >
                    <ImageUp size={16} />
                    <span>{copy.tabs.img2img.title}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="prompt-block">
              <PromptComposer
                label={copy.prompt}
                value={prompt}
                tokens={promptTokens}
                templates={snapshot.promptTemplates}
                galleryAssets={filteredGalleryAssets}
                removeTokenLabel={copy.removePromptChip}
                onChange={setPrompt}
                onTokensChange={setPromptTokens}
                onGalleryAssetToken={(asset) => void addGalleryPromptToken(asset)}
                onDirty={markDraftChanged}
              />
              <div
                ref={promptActionsRef}
                className={[
                  "prompt-actions",
                  arePromptSecondaryActionsIconOnly ? "secondary-actions-icon-only" : "",
                  isPrimaryRunIconOnly ? "primary-run-icon-only" : ""
                ].filter(Boolean).join(" ")}
              >
                <div className="run-row">
                  <button
                    ref={primaryRunButtonRef}
                    type="button"
                    className="primary-run"
                    onClick={runJob}
                    disabled={!canRun}
                    aria-label={primaryRunActionLabel}
                    data-tooltip={primaryRunActionLabel}
                  >
                    {isRunning ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                    <span className="button-label">{primaryRunActionLabel}</span>
                  </button>
                  <button
                    ref={promptTemplateButtonRef}
                    type="button"
                    className="prompt-template-button secondary"
                    onClick={() => setIsTemplatesOpen(true)}
                    aria-label={copy.promptTemplates}
                    data-tooltip={copy.promptTemplates}
                  >
                    <BookOpen size={16} />
                    <span className="button-label">{copy.promptTemplates}</span>
                    <small className="button-count">{snapshot.promptTemplates.length}</small>
                  </button>
                  <button
                    ref={promptCopyButtonRef}
                    type="button"
                    className={buttonFeedbackClass("copy:prompt", "prompt-copy-button secondary")}
                    onClick={() => copyPrompt(effectivePrompt)}
                    aria-label={copy.copyPrompt}
                    data-tooltip={promptCopyActionLabel}
                  >
                    <Copy size={16} />
                    <span className="button-label">{promptCopyActionLabel}</span>
                  </button>
                </div>
              </div>
              {validationError && <p className="inline-check error">{validationError}</p>}
            </div>

            {showReferenceTools && (
              <>
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
                        <button type="button" className="tile-remove" onClick={() => removeInputAsset(asset.id)} aria-label={copy.delete} data-tooltip={copy.delete}>
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
                  <button
                    type="button"
                    className="icon-button reference-add-button"
                    onClick={selectImages}
                    aria-label={copy.addLocalReferences}
                    data-tooltip={copy.addLocalReferences}
                  >
                    <Plus size={18} />
                  </button>
                  {referenceLimitToast && (
                    <div key={referenceLimitToast.id} className="reference-limit-toast" role="status">
                      {referenceLimitToast.text}
                    </div>
                  )}
                </div>
                {(geminiParams || (generalParams && generalFallbackSupportsReferenceImages(generalParams.providerKind))) && (
                  <p className="inline-check reference-rights-reminder">
                    <AlertTriangle size={14} />
                    <span>{copy.uploadRightsReminder}</span>
                  </p>
                )}
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
                    <span className="range-tooltip" data-tooltip={copy.maskBrushSize}>
                      <input
                        type="range"
                        min="16"
                        max="180"
                        value={brushSize}
                        aria-label={copy.maskBrushSize}
                        onChange={(event) => {
                          markDraftChanged();
                          setBrushSize(Number(event.target.value));
                        }}
                      />
                    </span>
                    <button
                      type="button"
                      className="icon-button secondary compact-mask-button"
                      onClick={addPaintedMask}
                      disabled={!maskDataUrl}
                      aria-label={copy.addPaintedMask}
                      data-tooltip={copy.addPaintedMaskTooltip}
                    >
                      <Paintbrush size={15} />
                    </button>
                    <button type="button" className="icon-button" onClick={clearPaintedMask} aria-label={copy.clearPaintedMask} data-tooltip={copy.clearPaintedMask}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div className={sourcePreview ? "mask-canvas-wrap has-source" : "mask-canvas-wrap"}>
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
      </PerfProfiler>

      <div
        className="column-resizer history-resizer"
        role="separator"
        aria-label="Resize history"
        aria-orientation="vertical"
        aria-valuemin={MIN_RIGHT_RAIL_WIDTH}
        aria-valuemax={maxHistoryWidth}
        aria-valuenow={historyWidth}
        aria-disabled={false}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizingColumn("history");
        }}
        onKeyDown={(event) => {
          resizeHandleKeyDown("history", event);
        }}
      />

      <PerfProfiler id="RightRail">
      <aside className={[
        "history",
        "right-rail",
        isRightRailStacked ? "stacked" : "",
        isRightRailDense ? "dense" : "",
        isRightRailCompact ? "collapsed" : ""
      ].filter(Boolean).join(" ")}>
        <button
          type="button"
          className={`icon-button right-rail-collapse-button ${isRightRailCompact ? "collapsed" : ""}`}
          onClick={toggleRightRailCollapsed}
          onMouseMove={movePreviewToolbarTowardPointer}
          onMouseLeave={resetPreviewToolbarDrift}
          aria-label={isRightRailCompact ? copy.show : copy.hide}
          data-tooltip={isRightRailCompact ? copy.show : copy.hide}
        >
          <ChevronRight size={16} />
        </button>
        <div className="right-rail-tabs" role="tablist" aria-label={copy.library}>
          <button
            type="button"
            role="tab"
            aria-selected={rightRailView === "history"}
            className={rightRailView === "history" ? "active" : undefined}
            onClick={() => {
              setRightRailView("history");
              setBatchTagMenuTarget(null);
              setHistoryGalleryMenuJobId(null);
            }}
          >
            <History size={15} />
            <span>{copy.history}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightRailView === "gallery"}
            className={rightRailView === "gallery" ? "active" : undefined}
            onClick={() => {
              setRightRailView("gallery");
              setBatchTagMenuTarget(null);
              setHistoryGalleryMenuJobId(null);
            }}
          >
            <Images size={15} />
            <span>{copy.gallery}</span>
          </button>
        </div>

        {rightRailView === "history" ? (
          <div className="right-rail-panel history-panel" role="tabpanel">
            <HistoryFilterToolbar
              copy={copy}
              search={historySearch}
              statusFilter={historyStatusFilter}
              sort={historySort}
              searching={isSearchingHistory}
              matchCount={filteredHistory.length}
              onSearchChange={setHistorySearch}
              onStatusFilterChange={setHistoryStatusFilter}
              onSortChange={setHistorySort}
            />

            <HistoryListShell
              copy={copy}
              listRef={historyListRef}
              viewMode={historyViewMode}
              batchMode={isHistoryBatchMode}
              empty={filteredHistory.length === 0}
              onScrollStateChange={setHistoryListScrollState}
              pager={hasHistoryOverflow ? (
                <HistoryFloatingPager
                  copy={copy}
                  visible={historyPagerVisible}
                  pageSizeMenuOpen={isHistoryPageSizeMenuOpen}
                  pageSizeOptions={HISTORY_PAGE_SIZE_OPTIONS}
                  pageSize={historyPageSize}
                  expanded={isHistoryExpanded}
                  showAllLabel={copy.showAllHistory(filteredHistory.length)}
                  previousLabel={language === "zh" ? "上一页" : "Previous page"}
                  nextLabel={language === "zh" ? "下一页" : "Next page"}
                  previousDisabled={isHistoryExpanded || normalizedHistoryPageIndex === 0}
                  nextDisabled={isHistoryExpanded || normalizedHistoryPageIndex >= historyPageCount - 1}
                  onTogglePageSizeMenu={() => setIsHistoryPageSizeMenuOpen((current) => !current)}
                  onSelectPageSize={(size) => {
                    setHistoryPageSize(size);
                    setIsHistoryExpanded(false);
                    setHistoryPageIndex(0);
                    setIsHistoryPageSizeMenuOpen(false);
                  }}
                  onToggleExpanded={() => setIsHistoryExpanded((current) => !current)}
                  onPreviousPage={() => setHistoryPageIndex((current) => Math.max(0, current - 1))}
                  onNextPage={() => setHistoryPageIndex((current) => Math.min(historyPageCount - 1, current + 1))}
                  onMoveToolbarTowardPointer={movePreviewToolbarTowardPointer}
                  onResetToolbarDrift={resetPreviewToolbarDrift}
                />
              ) : null}
            >
              {visibleHistory.map((job) => {
                    const result = getBestResult(job);
                    const jobError = getJobError(job);
                    const modelDetails = getHistoryModelDetails(job);
                    const isSelected = selectedHistoryJobIds.has(job.id);
                    const displayName = historyDisplayName(job);
                    const systemTag = historySystemTagLabel(job.mode, language);
                    const isGalleryAdded = historyResultIsInGallery(result);
                    return (
                      <HistoryItemCard
                        key={job.id}
                        copy={copy}
                        job={job}
                        result={result}
                        resultSrc={result ? assetSource(result) : undefined}
                        jobError={jobError}
                        active={activeJob?.id === job.id}
                        selected={isSelected}
                        batchMode={isHistoryBatchMode}
                        displayName={displayName}
                        createdAtLabel={formatDate(job.createdAt)}
                        modelDisplayName={modelDetails.modelDisplayName}
                        modelTitle={modelDetails.modelTitle}
                        systemTag={systemTag}
                        isGalleryAdded={isGalleryAdded}
                        galleryMenuOpen={historyGalleryMenuJobId === job.id}
                        galleryTargetMenu={renderHistoryGalleryTargetMenu(result, job)}
                        editingName={editingHistoryNameId === job.id}
                        nameDraft={historyNameDraft}
                        editingTags={editingHistoryTagsId === job.id}
                        tagsInput={historyTagsInput}
                        reuseButtonClass={buttonFeedbackClass(`reuse:${job.id}`, "history-action-button")}
                        copyButtonClass={buttonFeedbackClass(`copy:${job.id}`, "history-action-button")}
                        downloadButtonClass={result ? buttonFeedbackClass(`download:${result.id}`, "history-action-button") : "history-action-button"}
                        reuseButtonLabel={buttonFeedback[`reuse:${job.id}`] ? copy.clicked : copy.reuse}
                        copyButtonLabel={buttonFeedback[`copy:${job.id}`] ? copy.clicked : copy.copy}
                        downloadButtonLabel={result && buttonFeedback[`download:${result.id}`] ? copy.clicked : copy.download}
                        onToggleSelection={(checked) => toggleHistoryJobSelection(job.id, checked)}
                        onOpen={() => {
                          setActiveGalleryAssetId(null);
                          setActiveJob(job);
                        }}
                        onImageContextMenu={(event) => handleImageContextMenu(event, result, job.prompt)}
                        onStartEditName={() => beginEditHistoryName(job)}
                        onNameDraftChange={setHistoryNameDraft}
                        onSaveName={() => void saveHistoryName(job)}
                        onCancelName={cancelHistoryNameEdit}
                        onEditTags={() => editHistoryTags(job)}
                        onTagsInputChange={setHistoryTagsInput}
                        onSaveTags={() => void saveHistoryTags(job)}
                        onCancelTags={cancelHistoryTagsEdit}
                        onMoveTagPopoverPointerDown={(event) => event.stopPropagation()}
                        onMoveToolbarTowardPointer={movePreviewToolbarTowardPointer}
                        onResetToolbarDrift={resetPreviewToolbarDrift}
                        onReuse={() => reuseJob(job)}
                        onCopyPrompt={() => copyPrompt(job.prompt, `copy:${job.id}`)}
                        onDownload={() => downloadAsset(result)}
                        onToggleGalleryMenu={() => setHistoryGalleryMenuJobId((current) => current === job.id ? null : job.id)}
                        onDelete={() => deleteJob(job.id)}
                      />
                    );
              })}
            </HistoryListShell>
          </div>
        ) : (
          <div className="right-rail-panel gallery-panel gallery-explorer-panel" role="tabpanel">
            <GalleryCompactControls
              copy={copy}
              activeFolderId={activeGalleryFolderId}
              folderOptions={galleryFolderSelectOptions}
              tagFilter={galleryTagFilter}
              tagOptions={globalTagOptions}
              onFolderChange={navigateGalleryFolder}
              onTagFilterChange={setGalleryTagFilter}
            />
            <div className="rail-filter-row gallery-toolbar">
              <label className="search-box">
                <Search size={15} />
                <input value={gallerySearch} onChange={(event) => setGallerySearch(event.target.value)} placeholder={copy.gallerySearch} />
              </label>
              <select value={galleryTagFilter} onChange={(event) => setGalleryTagFilter(event.target.value)} aria-label={copy.galleryTagFilter}>
                <option value="">{copy.galleryAllTags}</option>
                {globalTagOptions.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>

            <GallerySortToolbar
              copy={copy}
              sort={gallerySort}
              sortLabel={gallerySortLabel}
              sortOptions={gallerySortOptions}
              isSortMenuOpen={isGallerySortMenuOpen}
              onToggleSortMenu={() => setIsGallerySortMenuOpen((current) => !current)}
              onSortChange={(sort) => {
                setGallerySort(sort);
                setIsGallerySortMenuOpen(false);
              }}
              onCreateFolder={() => openCreateGalleryFolderDialog(currentGalleryCreateParentId)}
              onImport={() => void importToGallery()}
            />
            <div className="resource-explorer">
              <GalleryDirectoryTree
                copy={copy}
                activeFolderId={activeGalleryFolderId}
                allFolderId={GALLERY_ALL_FILTER}
                uncategorizedFolderId={GALLERY_UNCATEGORIZED_FILTER}
                batchMode={isGalleryBatchMode}
                allAssetCount={snapshot.galleryAssets.length}
                uncategorizedAssetCount={galleryFolderAssetCounts.get(GALLERY_UNCATEGORIZED_FILTER) ?? 0}
                allDropTarget={galleryFolderDragTarget === GALLERY_ALL_FILTER}
                uncategorizedDropTarget={galleryFolderDragTarget === GALLERY_UNCATEGORIZED_FILTER}
                allDropHandlers={galleryFolderDropHandlers(GALLERY_ALL_FILTER)}
                uncategorizedDropHandlers={galleryFolderDropHandlers(GALLERY_UNCATEGORIZED_FILTER)}
                onNavigate={navigateGalleryFolder}
                onContextMenu={openGalleryFolderContextMenu}
              >
                <GalleryTreeRows
                  copy={copy}
                  parentId={null}
                  foldersByParent={galleryFoldersByParent}
                  activeFolderId={activeGalleryFolderId}
                  batchMode={isGalleryBatchMode}
                  expandedFolderIds={expandedGalleryFolderIds}
                  selectedFolderIds={selectedGalleryFolderIds}
                  dragTargetId={galleryFolderDragTarget}
                  subtreeAssetCounts={galleryFolderSubtreeAssetCounts}
                  dropHandlersForFolder={galleryFolderDropHandlers}
                  folderDisplayPath={galleryFolderDisplayPath}
                  onPrepareEntryDrag={prepareGalleryEntryDrag}
                  onFolderContextMenu={openGalleryFolderContextMenu}
                  onToggleExpanded={toggleGalleryFolderExpanded}
                  onToggleSelectedFolder={(folderId, checked) => {
                    setSelectedGalleryFolderIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(folderId);
                      else next.delete(folderId);
                      return next;
                    });
                  }}
                  onNavigateFolder={navigateGalleryFolder}
                />
              </GalleryDirectoryTree>
              <GalleryContentGrid
                copy={copy}
                contentRef={galleryContentRef}
                activeFolderId={activeGalleryFolderId}
                viewMode={galleryViewMode}
                batchMode={isGalleryBatchMode}
                dropTarget={galleryFolderDragTarget === activeGalleryFolderId}
                folderDropTargetId={galleryFolderDragTarget}
                entries={galleryExplorerEntries}
                virtualEntries={galleryVirtualEntries}
                virtualStartIndex={galleryVirtualStartIndex}
                virtualTopSpacer={galleryVirtualTopSpacer}
                virtualBottomSpacer={galleryVirtualBottomSpacer}
                isGalleryEmpty={snapshot.galleryAssets.length === 0}
                editingGalleryNameId={editingGalleryNameId}
                galleryNameDraft={galleryNameDraft}
                editingGalleryId={editingGalleryId}
                tagsInput={galleryTagsInput}
                folderSubtreeAssetCounts={galleryFolderSubtreeAssetCounts}
                dropHandlersForFolder={galleryFolderDropHandlers}
                formatBytes={formatBytes}
                formatDate={formatDate}
                folderDisplayPath={galleryFolderDisplayPath}
                assetThumbnailPath={galleryAssetThumbnailPath}
                isEntrySelected={isGalleryEntrySelected}
                onScrollTopChange={setGalleryContentScrollTop}
                onFolderContextMenu={openGalleryFolderContextMenu}
                onPrepareEntryDrag={prepareGalleryEntryDrag}
                onToggleSelection={toggleGalleryEntrySelection}
                onOpenFolder={navigateGalleryFolder}
                onRenameFolder={openRenameGalleryFolderDialog}
                onPreviewAsset={previewGalleryAsset}
                onAssetContextMenu={openGalleryAssetContextMenu}
                onStartEditAssetName={beginEditGalleryAssetName}
                onAssetNameDraftChange={setGalleryNameDraft}
                onSaveAssetName={(asset) => void saveGalleryAssetName(asset)}
                onCancelAssetName={cancelGalleryAssetNameEdit}
                onEditAssetTags={editGalleryTags}
                onTagsInputChange={setGalleryTagsInput}
                onSaveAssetTags={(asset) => void saveGalleryTags(asset)}
                onCancelAssetTags={() => {
                  setEditingGalleryId(null);
                  setGalleryTagsInput("");
                }}
                onMoveTagPopoverPointerDown={(event) => event.stopPropagation()}
                onMoveToolbarTowardPointer={movePreviewToolbarTowardPointer}
                onResetToolbarDrift={resetPreviewToolbarDrift}
                onDeleteAsset={(asset) => void removeGalleryAsset(asset)}
              />
            </div>
          </div>
        )}
        <div ref={rightRailActionsRef} className={`right-rail-actions ${isRightRailActionDrawerOpen ? "drawer-open" : ""}`}>
          <span className="right-rail-summary">
            {rightRailView === "history"
              ? isHistoryBatchMode ? copy.historySelectionCount(selectedHistoryItemCount) : copy.historyStats(snapshot.history.length)
              : isGalleryBatchMode ? copy.gallerySelectionCount(selectedGalleryItemCount) : copy.galleryStats(snapshot.galleryAssets.length, snapshot.galleryFolders.length)}
          </span>
          <button
            type="button"
            className={`icon-button secondary right-rail-drawer-toggle ${isRightRailActionDrawerOpen ? "active" : ""}`}
            data-drift="subtle"
            onClick={() => setIsRightRailActionDrawerOpen((current) => !current)}
            onMouseMove={movePreviewToolbarTowardPointer}
            onMouseLeave={resetPreviewToolbarDrift}
            aria-label={copy.parameters}
            data-tooltip={copy.parameters}
            aria-expanded={isRightRailActionDrawerOpen}
          >
            <SlidersHorizontal size={15} />
          </button>
          <div className="right-rail-action-group" data-drift="subtle" onMouseMove={movePreviewToolbarTowardPointer} onMouseLeave={resetPreviewToolbarDrift}>
            <button
              type="button"
              className="icon-button secondary right-rail-view-toggle"
              onClick={rightRailView === "history" ? () => setHistoryViewMode((current) => current === "grid" ? "list" : "grid") : () => setGalleryViewMode((current) => current === "grid" ? "list" : "grid")}
              aria-label={rightRailView === "history" ? historyDisplayActionLabel : galleryDisplayActionLabel}
              data-tooltip={rightRailView === "history" ? historyDisplayActionLabel : galleryDisplayActionLabel}
            >
              {rightRailView === "history"
                ? historyViewMode === "grid" ? <List size={15} /> : <Images size={15} />
                : galleryViewMode === "grid" ? <List size={15} /> : <Images size={15} />}
            </button>
            <button type="button" className="icon-button secondary" onClick={openStorageSettings} aria-label={copy.libraryConfig} data-tooltip={copy.libraryConfig}>
              <FolderCog size={15} />
            </button>
            <button
              type="button"
              className={`icon-button secondary ${rightRailView === "history" ? isHistoryBatchMode ? "active" : "" : isGalleryBatchMode ? "active" : ""}`}
              onClick={() => {
                setBatchTagMenuTarget(null);
                if (rightRailView === "history") toggleHistoryBatchMode();
                else toggleGalleryBatchMode();
              }}
              aria-label={rightRailView === "history" ? (isHistoryBatchMode ? copy.exitBatchSelect : copy.batchSelect) : (isGalleryBatchMode ? copy.exitBatchSelect : copy.batchSelect)}
              data-tooltip={rightRailView === "history" ? (isHistoryBatchMode ? copy.exitBatchSelect : copy.batchSelect) : (isGalleryBatchMode ? copy.exitBatchSelect : copy.batchSelect)}
            >
              <CheckSquare size={15} />
            </button>
            <div className="right-rail-tag-action">
              <button
                type="button"
                className={`icon-button secondary ${isTagManagerOpen ? "active" : ""}`}
                onClick={() => {
                  setBatchTagMenuTarget(null);
                  setIsTagManagerOpen((current) => !current);
                }}
                aria-label={copy.tagManager}
                data-tooltip={copy.tagManager}
                aria-expanded={isTagManagerOpen}
              >
                <Tags size={15} />
              </button>
              {isTagManagerOpen && renderTagManagerMenu()}
            </div>
            <button
              type="button"
              className="icon-button secondary danger"
              onClick={rightRailView === "history" ? (isHistoryBatchMode ? deleteSelectedHistoryItems : requestClearHistory) : (isGalleryBatchMode ? deleteSelectedGalleryItems : clearGallery)}
              disabled={rightRailView === "history" ? (isHistoryBatchMode ? selectedHistoryItemCount === 0 : snapshot.history.length === 0) : (isGalleryBatchMode ? selectedGalleryItemCount === 0 : snapshot.galleryAssets.length === 0 && snapshot.galleryFolders.length === 0)}
              aria-label={rightRailView === "history" ? (isHistoryBatchMode ? copy.historyDeleteSelected : copy.clearAllHistoryTooltip) : (isGalleryBatchMode ? copy.galleryDeleteSelected : copy.clearGalleryTooltip)}
              data-tooltip={rightRailView === "history" ? (isHistoryBatchMode ? copy.historyDeleteSelectedTooltip(selectedHistoryItemCount) : copy.clearAllHistoryTooltip) : (isGalleryBatchMode ? copy.galleryDeleteSelectedTooltip(selectedGalleryItemCount) : copy.clearGalleryTooltip)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </aside>
      </PerfProfiler>
      {isActiveApiConfigOpen && (
        <ApiConfigDialog
          copy={copy}
          savedApiConfigCount={savedApiConfigs.length}
          activeConfig={activeConfig}
          selectedConfig={selectedApiConfig}
          inactiveConfigs={inactiveApiConfigs}
          promotedApiConfigId={promotedApiConfigId}
          canDeleteActiveApiAccess={canDeleteActiveApiAccess}
          canDeleteSelectedApiAccess={canDeleteSelectedApiAccess}
          saving={isSavingConfig}
          bridgeAvailable={Boolean(bridge)}
          discoveringProviderId={discoveringProviderId}
          discoveringAny={isDiscoveringModels}
          connectionErrorText={connectionErrorText}
          name={apiAccessName}
          apiKey={apiKey}
          baseURL={baseURL}
          apiKeyPlaceholder={apiKeyPlaceholder}
          selectedDiscoveryText={selectedDiscoveryText}
          selectedModelSummary={selectedModelSummary}
          selectedModelSummaryKind={selectedApiConfig.lastModelDiscoveryError ? "error" : "info"}
          selectedConfigSaved={isSelectedConfigSaved}
          addFormOpen={isAddingApiAccess}
          newApiAccessKind={newApiAccessKind}
          newApiAccessName={newApiAccessName}
          newApiAccessBaseURL={newApiAccessBaseURL}
          newApiAccessKey={newApiAccessKey}
          displayNameForConfig={(config) => apiAccessDisplayName(config, copy.apiAccessUntitled)}
          providerLabelForKind={providerLabelFromKind}
          baseUrlSummaryForConfig={(config) => summarizeBaseURL(config.baseURL)}
          discoverySummaryForConfig={(config) => discoverySummary(config, copy)}
          discoveryTooltipForConfig={(config) => discoveredModelTooltip(config, copy)}
          modelLabel={discoveredModelLabel}
          connectionBadgeForConfig={renderApiConfigConnectionBadge}
          onClose={() => setIsActiveApiConfigOpen(false)}
          onUseConfig={(config) => void switchApiAccess(config.id)}
          onSelectConfig={selectApiConfigForEditing}
          onDeleteConfig={(config) => void deleteApiAccess(config)}
          onDiscoverConfig={(config) => void discoverModels(config)}
          onToggleAddForm={() => setIsAddingApiAccess((current) => !current)}
          onNewApiAccessKindChange={changeNewApiAccessKind}
          onNewApiAccessNameChange={setNewApiAccessName}
          onNewApiAccessBaseURLChange={setNewApiAccessBaseURL}
          onNewApiAccessKeyChange={setNewApiAccessKey}
          onAddApiAccess={() => void addApiAccess()}
          onCancelAddApiAccess={() => setIsAddingApiAccess(false)}
          onNameChange={(value) => {
            setSavedApiConfigId(null);
            setApiAccessName(value);
          }}
          onApiKeyChange={(value) => {
            setSavedApiConfigId(null);
            resetConnectionCheckForConfigEdit();
            setApiKey(value);
          }}
          onBaseURLChange={(value) => {
            setSavedApiConfigId(null);
            resetConnectionCheckForConfigEdit();
            setBaseURL(value);
          }}
          onSubmit={() => void saveConfig()}
        />
      )}
      {isReleaseGuideOpen && (
        <DialogShell className="confirm-dialog release-guide-dialog" labelledBy="release-guide-title" onClose={dismissReleaseGuide}>
          <div className="release-guide-heading">
            <span className="release-guide-icon" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <div>
              <h2 id="release-guide-title">{copy.releaseGuideTitle(snapshot.appVersion)}</h2>
              <p>{copy.releaseGuideBody}</p>
            </div>
          </div>
          <ul className="release-guide-list">
            <li>{copy.releaseGuideEyedropper}</li>
            <li>{copy.releaseGuideTheme}</li>
            <li>{copy.releaseGuideGallery}</li>
          </ul>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={dismissReleaseGuide}>
              {copy.releaseGuideSkip}
            </button>
            <button type="button" onClick={dismissReleaseGuide}>
              <CheckCircle2 size={16} />
              {copy.releaseGuideStart}
            </button>
          </div>
        </DialogShell>
      )}
      {isTemplatesOpen && (
        <DialogShell className="template-dialog" labelledBy="prompt-template-dialog-title" onClose={() => setIsTemplatesOpen(false)}>
            <header className="history-header">
              <div>
                <h2 id="prompt-template-dialog-title">{copy.promptTemplates}</h2>
                <p>{copy.promptTemplatesDescription}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsTemplatesOpen(false)} aria-label={copy.cancel} data-tooltip={copy.cancel}>
                <X size={16} />
              </button>
            </header>
            <div className="template-panel">
              <div className="template-toolbar">
                <input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder={copy.templateSearch} />
                <button type="button" className="icon-button" onClick={() => void importTemplates()} aria-label={copy.templateImport} data-tooltip={copy.templateImport}>
                  <FileUp size={15} />
                </button>
                <button type="button" className="icon-button" onClick={() => void exportTemplates()} disabled={snapshot.promptTemplates.length === 0} aria-label={copy.templateExport} data-tooltip={copy.templateExport}>
                  <FileDown size={15} />
                </button>
              </div>
              <div className="template-dialog-body">
                <div className="template-editor">
                  <label>
                    {copy.templateTitle}
                    <input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} placeholder={copy.templateNew} />
                  </label>
                  <label>
                    {copy.templateBody}
                    <textarea value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} placeholder={copy.prompt} />
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
                      </div>
                      <div className="template-actions">
                        <button type="button" className="icon-button" onClick={() => void applyTemplate(template)} aria-label={copy.templateUse} data-tooltip={copy.templateUse}>
                          <BookOpen size={15} />
                        </button>
                        <button type="button" className="icon-button" onClick={() => editTemplate(template)} aria-label={copy.templateEdit} data-tooltip={copy.templateEdit}>
                          <SquarePen size={15} />
                        </button>
                        <button type="button" className="icon-button ghost danger" onClick={() => void deleteTemplate(template)} aria-label={copy.delete} data-tooltip={copy.delete}>
                          <X size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
        </DialogShell>
      )}
      {galleryFolderDialog && (
        <DialogShell className="confirm-dialog gallery-folder-dialog" labelledBy="gallery-folder-dialog-title" onClose={closeGalleryFolderDialog}>
            <div>
              <h2 id="gallery-folder-dialog-title">
                {galleryFolderDialog.mode === "create" ? copy.galleryFolderCreate : copy.galleryFolderRename}
              </h2>
              <p>{copy.galleryFolderDialogDescription}</p>
            </div>
            <label>
              {copy.galleryFolderName}
              <input
                value={galleryFolderDialogName}
                onChange={(event) => {
                  setGalleryFolderDialogName(event.target.value);
                  if (galleryFolderDialogError) setGalleryFolderDialogError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && galleryFolderDialogName.trim()) {
                    event.preventDefault();
                    void submitGalleryFolderDialog();
                  }
                }}
                autoFocus
              />
            </label>
            {galleryFolderDialogError && (
              <p className="inline-check error gallery-folder-dialog-error" role="alert">{galleryFolderDialogError}</p>
            )}
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={closeGalleryFolderDialog}>
                {copy.cancel}
              </button>
              <button type="button" onClick={() => void submitGalleryFolderDialog()} disabled={!galleryFolderDialogName.trim()}>
                <FolderPlus size={16} />
                {galleryFolderDialog.mode === "create" ? copy.galleryFolderCreate : copy.galleryFolderRename}
              </button>
            </div>
        </DialogShell>
      )}
      {storageDialogKind && (
        <DialogShell className="confirm-dialog storage-dialog" labelledBy="storage-dialog-title" onClose={() => setStorageDialogKind(null)}>
            <div>
              <h2 id="storage-dialog-title">{copy.libraryConfig}</h2>
              <p>{copy.storageFolderDialogDescription}</p>
            </div>
            <div className="storage-path-list">
              {syncStorageFolders ? (
                <div className="storage-path-row">
                  <span>{copy.storageSharedPath}</span>
                  <strong className="storage-path-value tooltip-target" title={snapshot.storage.historyDir} data-tooltip={snapshot.storage.historyDir}>{snapshot.storage.historyDir}</strong>
                  <button type="button" className="secondary" onClick={() => void openStorageFolder("history")}>
                    <FolderOpen size={15} />
                    {copy.openFolder}
                  </button>
                  <button type="button" className="secondary" onClick={() => void chooseStorageFolder("history", true)}>
                    <FolderCog size={15} />
                    {copy.chooseStorageFolder}
                  </button>
                </div>
              ) : (
                <>
                  <div className="storage-path-row">
                    <span>{copy.history}</span>
                    <strong className="storage-path-value tooltip-target" title={snapshot.storage.historyDir} data-tooltip={snapshot.storage.historyDir}>{snapshot.storage.historyDir}</strong>
                    <button type="button" className="secondary" onClick={() => void openStorageFolder("history")}>
                      <FolderOpen size={15} />
                      {copy.openFolder}
                    </button>
                    <button type="button" className="secondary" onClick={() => void chooseStorageFolder("history", false)}>
                      <FolderCog size={15} />
                      {copy.chooseStorageFolder}
                    </button>
                  </div>
                  <div className="storage-path-row">
                    <span>{copy.gallery}</span>
                    <strong className="storage-path-value tooltip-target" title={snapshot.storage.galleryDir} data-tooltip={snapshot.storage.galleryDir}>{snapshot.storage.galleryDir}</strong>
                    <button type="button" className="secondary" onClick={() => void openStorageFolder("gallery")}>
                      <FolderOpen size={15} />
                      {copy.openFolder}
                    </button>
                    <button type="button" className="secondary" onClick={() => void chooseStorageFolder("gallery", false)}>
                      <FolderCog size={15} />
                      {copy.chooseStorageFolder}
                    </button>
                  </div>
                </>
              )}
            </div>
            <label className="checkbox-row storage-sync-row">
              <input type="checkbox" checked={syncStorageFolders} onChange={(event) => setSyncStorageFolders(event.target.checked)} />
              <span>{copy.storageFolderSyncBoth}</span>
            </label>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => setStorageDialogKind(null)}>
                {copy.cancel}
              </button>
            </div>
        </DialogShell>
      )}
      {confirmDialog && (
        <DialogShell className="confirm-dialog" labelledBy="confirm-dialog-title" onClose={() => setConfirmDialog(null)}>
            <div>
              <h2 id="confirm-dialog-title">{confirmDialog.title}</h2>
              <p>{confirmDialog.body}</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => setConfirmDialog(null)}>
                {copy.cancel}
              </button>
              <button type="button" className="danger-button" onClick={() => void runConfirmDialogAction()}>
                <X size={16} />
                {confirmDialog.confirmLabel}
              </button>
            </div>
        </DialogShell>
      )}
      {gallerySaveChoiceDialog && (
        <DialogShell className="confirm-dialog gallery-save-choice-dialog" labelledBy="gallery-save-choice-title" onClose={() => setGallerySaveChoiceDialog(null)}>
            <div>
              <h2 id="gallery-save-choice-title">{copy.gallerySaveEditedTitle}</h2>
              <p>{copy.gallerySaveEditedBody(gallerySaveChoiceDialog.asset.originalName)}</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => setGallerySaveChoiceDialog(null)}>
                {copy.cancel}
              </button>
              <button type="button" className="secondary" onClick={() => void saveActiveGalleryImageAsCopy()}>
                <FolderInput size={16} />
                {copy.gallerySaveAsCopy}
              </button>
              <button type="button" onClick={() => void replaceActiveGalleryImage()}>
                <Save size={16} />
                {copy.galleryOverwrite}
              </button>
            </div>
        </DialogShell>
      )}
      {isPreviewOpen && activePreviewSource && (
        <DialogShell className="preview-modal-dialog" backdropClassName="preview-modal-backdrop" labelledBy="preview-modal-title" onClose={() => setIsPreviewOpen(false)}>
          <h2 id="preview-modal-title" className="visually-hidden">{copy.resultViewer}</h2>
          <button type="button" className="preview-modal-close icon-button tooltip-below" onClick={() => setIsPreviewOpen(false)} aria-label={copy.cancel} data-tooltip={copy.cancel}>
            <X size={18} />
          </button>
          <img
            src={activePreviewSource}
            alt={copy.generatedResult}
            className="preview-modal-image"
            onContextMenu={(e) => handleImageContextMenu(e, activeImage, activeJob?.prompt ?? '')}
          />
        </DialogShell>
      )}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="context-menu-item" onClick={handleContextMenuSaveImage} role="menuitem">
            <Download size={14} />
            {copy.saveImage}
          </button>
          <button type="button" className="context-menu-item" onClick={handleContextMenuCopyPath} role="menuitem">
            <Copy size={14} />
            {copy.copyImagePath}
          </button>
          <button type="button" className="context-menu-item" onClick={handleContextMenuCopyPrompt} role="menuitem">
            <Copy size={14} />
            {copy.copyPrompt}
          </button>
        </div>
      )}
      {galleryAssetContextMenu && (() => {
        const asset = snapshot.galleryAssets.find((item) => item.id === galleryAssetContextMenu.assetId);
        if (!asset) return null;
        return (
          <div
            className="context-menu"
            style={{ left: galleryAssetContextMenu.x, top: galleryAssetContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setGalleryAssetContextMenu(null);
                void pickGalleryAsset(asset);
              }}
              role="menuitem"
            >
              <ImageUp size={14} />
              {copy.galleryChoose}
            </button>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setGalleryAssetContextMenu(null);
                openGalleryAssetNameEditor(asset);
              }}
              role="menuitem"
            >
              <Pencil size={14} />
              {copy.galleryAssetRename}
            </button>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setGalleryAssetContextMenu(null);
                editGalleryTags(asset);
              }}
              role="menuitem"
            >
              <Tags size={14} />
              {copy.galleryEditTags}
            </button>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setGalleryAssetContextMenu(null);
                void openStorageFolder("gallery", asset.folderId ?? null);
              }}
              role="menuitem"
            >
              <FolderOpen size={14} />
              {copy.openFolder}
            </button>
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setGalleryAssetContextMenu(null);
                void copyImagePath(galleryAssetAbsolutePath(asset), `copy:path:${asset.id}`);
              }}
              role="menuitem"
            >
              <Copy size={14} />
              {copy.copyImagePath}
            </button>
            <div className="context-menu-divider" />
            <button
              type="button"
              className="context-menu-item danger"
              onClick={() => {
                setGalleryAssetContextMenu(null);
                void removeGalleryAsset(asset);
              }}
              role="menuitem"
            >
              <X size={14} />
              {copy.delete}
            </button>
          </div>
        );
      })()}
      {galleryFolderContextMenu && (() => {
        const folder = snapshot.galleryFolders.find((item) => item.id === galleryFolderContextMenu.folderId);
        const canManageFolder = Boolean(folder);
        const openFolderId = canManageFolder ? folder!.id : null;
        return (
          <div
            className="context-menu"
            style={{ left: galleryFolderContextMenu.x, top: galleryFolderContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                closeGalleryFolderContextMenu();
                void openStorageFolder("gallery", openFolderId);
              }}
              role="menuitem"
            >
              <FolderOpen size={14} />
              {copy.openFolder}
            </button>
            {canManageFolder && (
              <>
                <button
                  type="button"
                  className="context-menu-item"
                  onClick={() => {
                    closeGalleryFolderContextMenu();
                    openRenameGalleryFolderDialog(folder!);
                  }}
                  role="menuitem"
                >
                  <Pencil size={14} />
                  {copy.galleryFolderRename}
                </button>
                <button
                  type="button"
                  className="context-menu-item danger"
                  onClick={() => {
                    closeGalleryFolderContextMenu();
                    void deleteGalleryFolder(folder!);
                  }}
                  role="menuitem"
                >
                  <X size={14} />
                  {copy.galleryFolderDelete}
                </button>
                <div className="context-menu-divider" />
              </>
            )}
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                closeGalleryFolderContextMenu();
                openCreateGalleryFolderDialog(openFolderId);
              }}
              role="menuitem"
            >
              <FolderPlus size={14} />
              {copy.galleryFolderCreate}
            </button>
          </div>
        );
      })()}
      {globalTooltip && (
        <div
          className={`global-tooltip ${globalTooltip.placement}`}
          style={{ left: globalTooltip.x, top: globalTooltip.y }}
          role="tooltip"
        >
          {globalTooltip.text}
        </div>
      )}
    </main>
  );
}

function currentPartialLabel(index: number): number {
  return index + 1;
}

function normalizeNotice(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .replace(/^(?:Error:\s*)*(?:Error invoking remote method '[^']+':\s*)+(?:Error:\s*)*/i, "")
    .trim();
  return normalized || raw;
}

function normalizeGalleryFolderNotice(error: unknown, copy: UiCopy): string {
  const message = normalizeNotice(error);
  if (message.includes("Gallery 文件夹名称已存在")) return copy.galleryFolderNameExists;
  return message;
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
