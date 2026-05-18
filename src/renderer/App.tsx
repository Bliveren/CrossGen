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
  Loader2,
  Paintbrush,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_PARAMS,
  maskMimeTypeForSource,
  mimeTypeFromDataUrl,
  validateMaskMimeType,
  validateMaskSourceFormat,
  getValidationError,
  validateGptImage2Size
} from "../shared/validation";
import type {
  AppSnapshot,
  GenerationJob,
  ImageAsset,
  ImageBackground,
  ImageFormat,
  ImageParams,
  ImageQuality,
  InputAsset,
  ModerationMode,
  ProviderConfig,
  WorkMode,
  WorkspaceDraft
} from "../shared/types";

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

const fallbackConfig: ProviderConfig = {
  id: "default",
  name: "OpenAI",
  apiKeySaved: false,
  baseURL: DEFAULT_BASE_URL,
  enabled: true,
  defaultModel: DEFAULT_IMAGE_PARAMS.model,
  defaultSize: DEFAULT_IMAGE_PARAMS.size,
  defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
  timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
  updatedAt: new Date(0).toISOString()
};

const fallbackSnapshot: AppSnapshot = {
  config: fallbackConfig,
  history: []
};

const modeLabels: Record<WorkMode, { title: string; action: string; hint: string }> = {
  generate: {
    title: "Generate",
    action: "Generate",
    hint: "Prompt only"
  },
  edit: {
    title: "Edit",
    action: "Edit",
    hint: "Use references"
  },
  inpaint: {
    title: "Inpaint",
    action: "Inpaint",
    hint: "Source + mask"
  }
};

function getBridge() {
  return window.image2tools;
}

function assetSource(asset?: ImageAsset | InputAsset | null): string | undefined {
  if (!asset) return undefined;
  if ("dataUrl" in asset && asset.dataUrl) return asset.dataUrl;
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

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取图片。"));
    image.src = dataUrl;
  });
}

async function inspectMask(
  sourceDataUrl: string | undefined,
  maskDataUrl: string | undefined,
  maskMimeType?: string,
  sourceMimeType?: string
): Promise<MaskCheck> {
  if (!maskDataUrl) {
    return { ok: false, message: "Paint or upload a mask before inpaint." };
  }

  const maskType = validateMaskMimeType(maskMimeType);
  if (!maskType.ok) return { ok: false, message: maskType.message ?? "Mask format is invalid." };

  const sourceFormat = validateMaskSourceFormat(sourceMimeType, maskMimeType);
  if (!sourceFormat.ok) return { ok: false, message: sourceFormat.message ?? "Mask format is invalid." };

  const mask = await loadImage(maskDataUrl);
  if (sourceDataUrl) {
    const source = await loadImage(sourceDataUrl);
    if (source.naturalWidth !== mask.naturalWidth || source.naturalHeight !== mask.naturalHeight) {
      return { ok: false, message: "Mask size must match the first source image." };
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = mask.naturalWidth;
  canvas.height = mask.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { ok: false, message: "Cannot inspect mask alpha." };
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
    return { ok: false, message: "Mask is empty." };
  }

  if (transparentPixels === 0) {
    return { ok: false, message: "Mask needs an alpha channel with transparent areas." };
  }

  return { ok: true, message: "Mask format, size, and alpha look valid." };
}

export function App() {
  const bridge = getBridge();
  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);
  const [mode, setMode] = useState<WorkMode>("generate");
  const [prompt, setPrompt] = useState("A clean product photo of a matte black travel mug on a brushed steel counter");
  const [params, setParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [customSize, setCustomSize] = useState("2048x1152");
  const [inputAssets, setInputAssets] = useState<InputAsset[]>([]);
  const [maskAsset, setMaskAsset] = useState<InputAsset | null>(null);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [maskCheck, setMaskCheck] = useState<MaskCheck | null>(null);
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null);
  const [partialImages, setPartialImages] = useState<ImageAsset[]>([]);
  const [notice, setNotice] = useState<Notice>({ kind: bridge ? "info" : "error", text: bridge ? "Ready." : "Browser preview: Electron IPC is unavailable." });
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

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const paintedDuringStrokeRef = useRef(false);

  const sourceAsset = inputAssets[0];
  const sourcePreview = assetSource(sourceAsset);
  const maskPreview = maskDataUrl ?? assetSource(maskAsset);
  const activeImage = getBestResult(activeJob) ?? partialImages[partialImages.length - 1];
  const activeImageSource = assetSource(activeImage);
  const sizeSelectValue = sizePresets.includes(params.size) ? params.size : "custom";

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return snapshot.history;
    return snapshot.history.filter((job) => {
      const haystack = `${job.prompt} ${job.mode} ${job.status} ${job.createdAt}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [historySearch, snapshot.history]);

  const modeError = useMemo(() => {
    if (mode === "edit" && inputAssets.length === 0) return "Add at least one reference image.";
    if (mode === "inpaint" && inputAssets.length === 0) return "Add a source image before inpainting.";
    if (mode === "inpaint" && !maskPreview) return "Paint or upload a mask before inpainting.";
    if (mode === "inpaint" && maskCheck && !maskCheck.ok) return maskCheck.message;
    return null;
  }, [inputAssets.length, maskCheck, maskPreview, mode]);

  const validationError = getValidationError(params, prompt) ?? modeError;
  const canRun = !validationError && !isRunning;

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
        setNotice({ kind: "info", text: "Job started." });
      }
      if (event.type === "partial" && event.image) {
        setPartialImages((current) => [...current, event.image as ImageAsset]);
        setNotice({ kind: "info", text: `Partial image ${event.partialIndex ?? currentPartialLabel(partialImages.length)} received.` });
      }
      if (event.type === "completed") {
        setNotice({ kind: "success", text: "Image completed." });
      }
      if (event.type === "failed") {
        setNotice({ kind: "error", text: event.error ?? "Job failed." });
      }
    });
  }, [bridge, partialImages.length]);

  useEffect(() => {
    const source = sourcePreview;
    const mask = maskPreview;
    if (mode !== "inpaint" || !mask) {
      setMaskCheck(null);
      return;
    }

    let cancelled = false;
    inspectMask(source, mask, maskAsset?.mimeType ?? mimeTypeFromDataUrl(mask) ?? "image/png", inputAssets[0]?.mimeType)
      .then((result) => {
        if (!cancelled) setMaskCheck(result);
      })
      .catch((error) => {
        if (!cancelled) setMaskCheck({ ok: false, message: error instanceof Error ? error.message : "Mask validation failed." });
      });

    return () => {
      cancelled = true;
    };
  }, [inputAssets, maskAsset?.mimeType, maskPreview, mode, sourcePreview]);

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
    setParams(draft.params);
    setInputAssets(draft.inputAssets);
    setMaskAsset(draft.maskAsset ?? null);
    setMaskDataUrl(draft.maskDataUrl ?? null);
    setBrushSize(draft.brushSize);
    setDraftUpdatedAt(draft.updatedAt);
    setNotice({ kind: "info", text: `Draft restored from ${formatDate(draft.updatedAt)}.` });
  }

  async function clearDraft() {
    if (!bridge) return;
    try {
      await bridge.clearDraft();
      setDraftUpdatedAt(null);
      setHasUserChangedDraft(false);
      setNotice({ kind: "success", text: "Draft cleared." });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  function updateParams(patch: Partial<ImageParams>) {
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
      setNotice({ kind: "error", text: "Electron bridge is required to save config." });
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
      setNotice({ kind: "success", text: "Config saved locally." });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function testConnection() {
    if (!bridge) {
      setNotice({ kind: "error", text: "Electron bridge is required to test the API connection." });
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
      setNotice({ kind: "error", text: "Electron bridge is required to clear the saved API key." });
      return;
    }
    setIsClearingApiKey(true);
    try {
      const config = await bridge.clearApiKey();
      setSnapshot((current) => ({ ...current, config }));
      setApiKey("");
      setNotice({ kind: "success", text: "Saved API key cleared." });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    } finally {
      setIsClearingApiKey(false);
    }
  }

  async function selectImages() {
    if (!bridge) {
      setNotice({ kind: "error", text: "Electron bridge is required to select local image paths." });
      return;
    }
    const assets = await bridge.selectImages();
    if (assets.length > 0) {
      markDraftChanged();
      setInputAssets((current) => dedupeAssets([...current, ...assets]));
      if (mode === "generate") setMode("edit");
      setNotice({ kind: "success", text: `${assets.length} image${assets.length === 1 ? "" : "s"} added.` });
    }
  }

  async function selectMask() {
    if (!bridge) {
      setNotice({ kind: "error", text: "Electron bridge is required to select a mask." });
      return;
    }
    const asset = await bridge.selectMask();
    if (asset) {
      markDraftChanged();
      setMaskAsset(asset);
      setMaskDataUrl(null);
      setMode("inpaint");
      setNotice({ kind: "success", text: "Mask added." });
    }
  }

  async function runJob() {
    if (!bridge) {
      setNotice({ kind: "error", text: "Electron bridge is required to run image jobs." });
      return;
    }
    if (validationError) {
      setNotice({ kind: "error", text: validationError });
      return;
    }

    setIsRunning(true);
    setPartialImages([]);
    setActiveJob(null);
    setNotice({ kind: "info", text: `${modeLabels[mode].action} request sent.` });

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
      setNotice({ kind: job.status === "succeeded" ? "success" : "error", text: job.error ?? `${modeLabels[mode].action} finished.` });
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
      const savedPath = await bridge.downloadAsset({
        assetPath: asset.path,
        suggestedName: asset.fileName
      });
      if (savedPath) setNotice({ kind: "success", text: `Saved to ${savedPath}` });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function openAssetFolder(asset?: ImageAsset) {
    if (!bridge || !asset) return;
    try {
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
      setNotice({ kind: "success", text: "Job deleted." });
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
      setNotice({ kind: "success", text: "History cleared." });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeNotice(error) });
    }
  }

  async function copyPrompt(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ kind: "success", text: "Prompt copied." });
    } catch {
      setNotice({ kind: "error", text: "Clipboard is unavailable." });
    }
  }

  function reuseJob(job: GenerationJob) {
    setMode(job.mode);
    setPrompt(job.prompt);
    setParams(job.params);
    setInputAssets(job.inputAssets);
    setMaskAsset(job.maskAsset ?? null);
    setMaskDataUrl(null);
    setActiveJob(job);
    setHasUserChangedDraft(true);
    setNotice({ kind: "info", text: "Job loaded into workspace." });
  }

  function removeInputAsset(assetId: string) {
    markDraftChanged();
    setInputAssets((current) => current.filter((asset) => asset.id !== assetId));
    if (inputAssets[0]?.id === assetId) {
      clearPaintedMask();
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
    <main className="app-shell">
      <aside className="sidebar">
        <header className="brand-block">
          <p className="eyebrow">Image2Tools</p>
          <h1>GPT Image 2</h1>
          <p className="muted">Generate, edit, inpaint, download.</p>
        </header>

        <form
          className="tool-section"
          onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}
        >
          <div className="section-title">
            <KeyRound size={16} />
            <h2>Provider</h2>
          </div>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={snapshot.config.apiKeySaved ? "Saved locally" : "Paste API key"}
            />
          </label>
          <label>
            Base URL
            <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" onClick={saveConfig} disabled={isSavingConfig}>
              {isSavingConfig ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save
            </button>
            <button type="button" className="secondary" onClick={testConnection} disabled={isTestingConnection}>
              {isTestingConnection ? <Loader2 className="spin" size={16} /> : <PlugZap size={16} />}
              Test
            </button>
            <button type="button" className="ghost" onClick={clearApiKey} disabled={isClearingApiKey || !snapshot.config.apiKeySaved}>
              {isClearingApiKey ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              Clear key
            </button>
          </div>
          <div className="config-status">
            <span className={snapshot.config.apiKeySaved ? "dot ok" : "dot"} />
            {snapshot.config.apiKeySaved ? "Key saved" : "No key saved"}
          </div>
        </form>

        <section className="tool-section">
          <button type="button" className="section-toggle" onClick={() => setShowAdvanced((current) => !current)}>
            <SlidersHorizontal size={16} />
            Parameters
            <span>{showAdvanced ? "Hide" : "Show"}</span>
          </button>

          <div className="compact-grid">
            <span>Size</span>
            <strong>{params.size}</strong>
            <span>Quality</span>
            <strong>{params.quality}</strong>
            <span>Format</span>
            <strong>{params.outputFormat.toUpperCase()}</strong>
          </div>

          {showAdvanced && (
            <div className="advanced-controls">
              <label>
                Size
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
                  <option value="custom">custom</option>
                </select>
              </label>
              {sizeSelectValue === "custom" && (
                <label>
                  Custom size
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
                Quality
                <select value={params.quality} onChange={(event) => updateParams({ quality: event.target.value as ImageQuality })}>
                  {qualityOptions.map((quality) => (
                    <option key={quality} value={quality}>
                      {quality}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Format
                <select value={params.outputFormat} onChange={(event) => updateParams({ outputFormat: event.target.value as ImageFormat })}>
                  {formatOptions.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Compression
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={params.outputCompression}
                  disabled={params.outputFormat === "png"}
                  onChange={(event) => updateParams({ outputCompression: Number(event.target.value) })}
                />
                <span className="range-value">{params.outputFormat === "png" ? "PNG ignores compression" : `${params.outputCompression}%`}</span>
              </label>
              <label>
                Background
                <select value={params.background} onChange={(event) => updateParams({ background: event.target.value as ImageBackground })}>
                  {backgroundOptions.map((background) => (
                    <option key={background} value={background}>
                      {background}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Count
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
                Stream partial preview
              </label>
              <label>
                Partial images
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
                Moderation
                <select value={params.moderation} onChange={(event) => updateParams({ moderation: event.target.value as ModerationMode })}>
                  {moderationOptions.map((moderation) => (
                    <option key={moderation} value={moderation}>
                      {moderation}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Timeout seconds
                <input
                  type="number"
                  min="30"
                  max="600"
                  value={Math.round(params.timeoutMs / 1000)}
                  onChange={(event) => updateParams({ timeoutMs: clamp(Number(event.target.value), 30, 600) * 1000 })}
                />
              </label>
              <p className={sizeValidation.ok ? "inline-check ok" : "inline-check error"}>
                {sizeValidation.ok ? "Size is valid for GPT Image 2." : sizeValidation.message}
              </p>
            </div>
          )}
        </section>

        <section className="tool-section draft-section">
          <div className="section-title">
            <RefreshCw size={16} />
            <h2>Draft</h2>
          </div>
          <p className="muted">{draftUpdatedAt ? `Autosaved ${formatDate(draftUpdatedAt)}` : "Workspace autosaves after edits."}</p>
          <button type="button" className="secondary" onClick={clearDraft} disabled={!draftUpdatedAt}>
            <Trash2 size={16} />
            Clear draft
          </button>
        </section>

        <section className="notice-area" data-kind={notice.kind}>
          {notice.kind === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{notice.text}</span>
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-topbar">
          <div className="mode-tabs" role="tablist" aria-label="Mode">
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
            Sync
          </button>
        </div>

        <div className="preview-layout">
          <section className="result-stage">
            <div className="stage-toolbar">
              <div>
                <p className="eyebrow">Preview</p>
                <h2>{activeJob ? `${modeLabels[activeJob.mode].title} result` : "Output canvas"}</h2>
              </div>
              <div className="stage-actions">
                <button type="button" className="icon-button" disabled={!activeImage} onClick={() => downloadAsset(activeImage)} title="Download">
                  <Download size={17} />
                </button>
                <button type="button" className="icon-button" disabled={!activeImage} onClick={() => openAssetFolder(activeImage)} title="Open folder">
                  <FolderOpen size={17} />
                </button>
              </div>
            </div>

            <div className="result-canvas">
              {activeImageSource ? (
                <img src={activeImageSource} alt="Generated result" />
              ) : (
                <div className="empty-state">
                  <Wand2 size={30} />
                  <span>Generated images and partial previews appear here.</span>
                </div>
              )}
            </div>

            {partialImages.length > 0 && (
              <div className="partial-strip">
                {partialImages.map((asset, index) => (
                  <button key={asset.id} type="button" onClick={() => setActiveJob((job) => (job ? { ...job, outputs: [...job.outputs, asset] } : job))}>
                    <img src={assetSource(asset)} alt={`Partial ${index + 1}`} />
                    <span>P{index + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="input-panel">
            <div className="prompt-block">
              <label>
                Prompt
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
                  {isRunning ? "Running" : modeLabels[mode].action}
                </button>
                <button type="button" className="secondary" onClick={() => copyPrompt(prompt)}>
                  <Clipboard size={16} />
                  Copy
                </button>
              </div>
              {validationError && <p className="inline-check error">{validationError}</p>}
            </div>

            <div className="asset-tools">
              <button type="button" className="secondary" onClick={selectImages}>
                <ImagePlus size={16} />
                Add references
              </button>
              <button type="button" className="secondary" onClick={selectMask}>
                <Paintbrush size={16} />
                Upload mask
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
                  Clear
                </button>
              )}
            </div>

            <div className="reference-grid">
              {inputAssets.length === 0 ? (
                <div className="empty-inline">No reference images selected.</div>
              ) : (
                inputAssets.map((asset, index) => (
                  <div key={asset.id} className="asset-tile">
                    {assetSource(asset) && <img src={assetSource(asset)} alt={asset.name} />}
                    <button type="button" className="tile-remove" onClick={() => removeInputAsset(asset.id)} title="Remove">
                      <X size={14} />
                    </button>
                    <div>
                      <strong>{index === 0 ? "Source" : `Reference ${index + 1}`}</strong>
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
                    <h3>Mask</h3>
                    <p>Paint the area to replace. With multiple references, the mask applies to the first image.</p>
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
                    <button type="button" className="icon-button" onClick={clearPaintedMask} title="Clear painted mask">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="mask-canvas-wrap">
                  {sourcePreview ? (
                    <>
                      <img ref={sourceImageRef} src={sourcePreview} alt="Source for mask" onLoad={handleSourceImageLoad} />
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
                      <span>Add a source image to paint a mask.</span>
                    </div>
                  )}
                </div>
                {maskPreview && (
                  <div className="mask-status">
                    {maskCheck?.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    <span>{maskCheck?.message ?? "Checking mask..."}</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </section>

      <aside className="history">
        <header className="history-header">
          <div>
            <p className="eyebrow">History</p>
            <h2>Recent jobs</h2>
          </div>
          <button type="button" className="icon-button" onClick={clearHistory} disabled={snapshot.history.length === 0} title="Clear history">
            <Trash2 size={16} />
          </button>
        </header>

        <label className="search-box">
          <Search size={15} />
          <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search prompt" />
        </label>

        <div className="history-list">
          {filteredHistory.length === 0 ? (
            <div className="history-empty">No jobs yet.</div>
          ) : (
            filteredHistory.map((job) => {
              const result = getBestResult(job);
              return (
                <article key={job.id} className={activeJob?.id === job.id ? "history-item active" : "history-item"}>
                  <button type="button" className="history-preview" onClick={() => setActiveJob(job)}>
                    {result ? <img src={assetSource(result)} alt="History result" /> : <span>{job.status}</span>}
                  </button>
                  <div className="history-copy">
                    <div className="history-meta">
                      <strong>{modeLabels[job.mode].title}</strong>
                      <span>{formatDate(job.createdAt)}</span>
                    </div>
                    <p>{job.prompt}</p>
                    <small>
                      {job.status} · {job.params.size} · {job.params.quality} · {formatDuration(job.durationMs)}
                    </small>
                  </div>
                  <div className="history-actions">
                    <button type="button" className="icon-button" onClick={() => reuseJob(job)} title="Reuse">
                      <RefreshCw size={15} />
                    </button>
                    <button type="button" className="icon-button" onClick={() => copyPrompt(job.prompt)} title="Copy prompt">
                      <Clipboard size={15} />
                    </button>
                    <button type="button" className="icon-button" disabled={!result} onClick={() => downloadAsset(result)} title="Download">
                      <Download size={15} />
                    </button>
                    <button type="button" className="icon-button danger" onClick={() => deleteJob(job.id)} title="Delete">
                      <Trash2 size={15} />
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
