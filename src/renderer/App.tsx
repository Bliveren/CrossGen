import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brush,
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
  DEFAULT_IMAGE_PARAMS,
  MAX_GPT_IMAGE_INPUTS,
  maskMimeTypeForSource,
  mimeTypeFromDataUrl,
  validateMaskMimeType,
  validateMaskSourceFormat,
  getValidationError,
  isOpenAIImageParams,
  validateGptImage2Size
} from "../shared/validation";
import type {
  AppSnapshot,
  GenerationJob,
  ImageAsset,
  ImageBackground,
  ImageFormat,
  ImageQuality,
  InputAsset,
  ModerationMode,
  OpenAIImageParams,
  ProviderConfig,
  WorkMode,
  UpdateCheckResult,
  WorkspaceDraft
} from "../shared/types";
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
  const [params, setParams] = useState<OpenAIImageParams>(DEFAULT_IMAGE_PARAMS);
  const [apiKey, setApiKey] = useState("");
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
  const [isClearingApiKey, setIsClearingApiKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
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
  const sizeSelectValue = sizePresets.includes(params.size) ? params.size : "custom";
  const previewZoomPercent = Math.round(previewZoom * 100);
  const apiKeyPlaceholder = snapshot.config.apiKeyPreview ?? (snapshot.config.apiKeySaved ? copy.savedLocally : copy.pasteApiKey);
  const maxSidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - historyWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));
  const maxHistoryWidth = Math.min(MAX_HISTORY_WIDTH, Math.max(MIN_HISTORY_WIDTH, window.innerWidth - sidebarWidth - RESIZER_WIDTH * 2 - MIN_WORKSPACE_WIDTH));

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return snapshot.history;
    return snapshot.history.filter((job) => {
      const haystack = `${job.prompt} ${job.mode} ${job.status} ${job.error ?? ""} ${job.createdAt}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [historySearch, snapshot.history]);

  const modeError = useMemo(() => {
    if (mode === "edit" && inputAssets.length === 0) return copy.validation.addReference;
    if (mode === "inpaint" && inputAssets.length === 0) return copy.validation.addSource;
    if (mode !== "generate" && inputAssets.length > MAX_GPT_IMAGE_INPUTS) {
      return copy.validation.maxInputs(MAX_GPT_IMAGE_INPUTS);
    }
    if (mode === "inpaint" && !maskPreview) return copy.validation.paintOrUploadMask;
    if (mode === "inpaint" && maskCheck && !maskCheck.ok) return maskCheck.message;
    return null;
  }, [copy, inputAssets.length, maskCheck, maskPreview, mode]);

  const validationError = localizeValidationMessage(getValidationError(params, prompt), copy) ?? modeError;
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
  }, [copy, inputAssets, maskAsset?.mimeType, maskPreview, mode, sourcePreview]);

  async function refreshSnapshot() {
    if (!bridge) return;
    setIsLoadingSnapshot(true);
    try {
      const next = await bridge.getSnapshot();
      setSnapshot(next);
      setBaseURL(next.config.baseURL);
      setParams((current) => ({
        ...current,
        model: next.config.defaultModel,
        size: next.config.defaultSize,
        quality: next.config.defaultQuality,
        timeoutMs: next.config.timeoutMs
      }));
      if (!hasRestoredDraft) {
        restoreDraft(next.draft);
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  function restoreDraft(draft?: WorkspaceDraft) {
    setHasRestoredDraft(true);
    if (!draft) return;
    setMode(draft.mode);
    setPrompt(draft.prompt);
    setParams(isOpenAIImageParams(draft.params) ? draft.params : DEFAULT_IMAGE_PARAMS);
    setInputAssets(draft.inputAssets);
    setMaskAsset(draft.maskAsset ?? null);
    setMaskDataUrl(draft.maskDataUrl ?? null);
    setBrushSize(draft.brushSize);
    setDraftUpdatedAt(draft.updatedAt);
    setNotice({ kind: "info", text: copy.notices.draftRestored(formatDate(draft.updatedAt)) });
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

  function updateParams(patch: Partial<OpenAIImageParams>) {
    markDraftChanged();
    setParams((current) => ({ ...current, ...patch }));
  }

  function markDraftChanged() {
    if (hasRestoredDraft) {
      setHasUserChangedDraft(true);
    }
  }

  async function saveConfig() {
    if (!bridge) {
      setNotice({ kind: "error", text: copy.notices.bridgeSaveConfig });
      return;
    }
    setIsSavingConfig(true);
    try {
      const config = await bridge.saveConfig({
        apiKey: apiKey.trim() ? apiKey : undefined,
        baseURL,
        defaultModel: params.model,
        defaultSize: params.size,
        defaultQuality: params.quality,
        timeoutMs: params.timeoutMs
      });
      setSnapshot((current) => ({ ...current, config }));
      setApiKey("");
      setNotice({ kind: "success", text: copy.notices.configSaved });
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
      if (apiKey.trim() || baseURL !== snapshot.config.baseURL) {
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
      setSnapshot((current) => ({ ...current, config }));
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
      const cappedNext = next.slice(0, MAX_GPT_IMAGE_INPUTS);
      const addedCount = Math.max(0, cappedNext.length - inputAssets.length);
      const capped = next.length > MAX_GPT_IMAGE_INPUTS;
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
    setParams(isOpenAIImageParams(job.params) ? job.params : DEFAULT_IMAGE_PARAMS);
    setInputAssets(job.inputAssets);
    setMaskAsset(job.maskAsset ?? null);
    setMaskDataUrl(null);
    setActiveJob(job);
    setHasUserChangedDraft(true);
    setNotice({ kind: "info", text: copy.notices.jobLoaded });
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

  const sizeValidation = validateGptImage2Size(params.size);

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
        </form>

        <section className="tool-section">
          <button type="button" className="section-toggle" onClick={() => setShowAdvanced((current) => !current)}>
            <SlidersHorizontal size={16} />
            {copy.parameters}
            <span>{showAdvanced ? copy.hide : copy.show}</span>
          </button>

          <div className="compact-grid">
            <span>{copy.size}</span>
            <strong>{params.size}</strong>
            <span>{copy.quality}</span>
            <strong>{params.quality}</strong>
            <span>{copy.format}</span>
            <strong>{params.outputFormat.toUpperCase()}</strong>
          </div>

          {showAdvanced && (
            <div className="advanced-controls">
              <label>
                {copy.size}
                <select
                  value={sizeSelectValue}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateParams({ size: value === "custom" ? customSize : value });
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
                      updateParams({ size: event.target.value });
                    }}
                    placeholder="2048x1152"
                  />
                </label>
              )}
              <label>
                {copy.quality}
                <select value={params.quality} onChange={(event) => updateParams({ quality: event.target.value as ImageQuality })}>
                  {qualityOptions.map((quality) => (
                    <option key={quality} value={quality}>
                      {quality}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy.format}
                <select value={params.outputFormat} onChange={(event) => updateParams({ outputFormat: event.target.value as ImageFormat })}>
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
                  value={params.outputCompression}
                  disabled={params.outputFormat === "png"}
                  onChange={(event) => updateParams({ outputCompression: Number(event.target.value) })}
                />
                <span className="range-value">{params.outputFormat === "png" ? copy.pngIgnoresCompression : `${params.outputCompression}%`}</span>
              </label>
              <label>
                {copy.background}
                <select value={params.background} onChange={(event) => updateParams({ background: event.target.value as ImageBackground })}>
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
                  value={params.n}
                  onChange={(event) => updateParams({ n: clamp(Number(event.target.value), 1, 10) })}
                />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={params.stream} onChange={(event) => updateParams({ stream: event.target.checked })} />
                {copy.streamPartialPreview}
              </label>
              <label>
                {copy.partialImages}
                <input
                  type="number"
                  min="0"
                  max="3"
                  disabled={!params.stream}
                  value={params.partialImages}
                  onChange={(event) => updateParams({ partialImages: clamp(Number(event.target.value), 0, 3) })}
                />
              </label>
              <label>
                {copy.moderation}
                <select value={params.moderation} onChange={(event) => updateParams({ moderation: event.target.value as ModerationMode })}>
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
                  value={Math.round(params.timeoutMs / 1000)}
                  onChange={(event) => updateParams({ timeoutMs: clamp(Number(event.target.value), 30, 600) * 1000 })}
                />
              </label>
              <p className={sizeValidation.ok ? "inline-check ok" : "inline-check error"}>
                {sizeValidation.ok ? copy.sizeValid : localizeValidationMessage(sizeValidation.message, copy)}
              </p>
            </div>
          )}
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
                    <p>{copy.maskDescription}</p>
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

        <div className="history-list">
          {filteredHistory.length === 0 ? (
            <div className="history-empty">{copy.noJobsYet}</div>
          ) : (
            filteredHistory.map((job) => {
              const result = getBestResult(job);
              const jobError = getJobError(job);
              const paramsSummary = isOpenAIImageParams(job.params) ? `${job.params.size} · ${job.params.quality}` : job.modelDisplayName;
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
