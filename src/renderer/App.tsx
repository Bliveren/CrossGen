import {
  Archive,
  CheckCircle2,
  Clipboard,
  Copy,
  Download,
  Eraser,
  Eye,
  FileImage,
  FolderOpen,
  ImagePlus,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_PARAMS,
  getValidationError,
  normalizeBaseURL,
  validateGptImage2Size
} from "../shared/validation";
import type {
  AppBridge,
  AppSnapshot,
  ConnectionTestResult,
  GenerationJob,
  ImageAsset,
  ImageFormat,
  ImageParams,
  ImageQuality,
  InputAsset,
  JobProgressEvent,
  ModerationMode,
  ProviderConfig,
  ProviderConfigInput,
  WorkMode
} from "../shared/types";

type RunState = "idle" | "running" | "succeeded" | "failed";

interface AppNotice {
  tone: "info" | "success" | "error";
  message: string;
}

interface FormState {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  timeoutMs: number;
}

const modeCopy: Record<WorkMode, { label: string; detail: string; icon: typeof Sparkles }> = {
  generate: {
    label: "Generate",
    detail: "Prompt only",
    icon: Sparkles
  },
  edit: {
    label: "Edit",
    detail: "Prompt plus references",
    icon: Wand2
  },
  inpaint: {
    label: "Inpaint",
    detail: "Source image plus mask",
    icon: Eraser
  }
};

const sizePresets = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x1152", "1152x2048"];

const fallbackConfig: ProviderConfig = {
  id: "browser-preview",
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function assetPreview(asset?: InputAsset | ImageAsset | null): string | null {
  if (!asset) return null;
  if ("dataUrl" in asset && asset.dataUrl) return asset.dataUrl;
  return asset.path;
}

function imageName(asset: InputAsset | ImageAsset): string {
  return "name" in asset ? asset.name : asset.fileName;
}

function makePreviewAsset(id: string, label: string, sourceType: ImageAsset["sourceType"] = "result"): ImageAsset {
  return {
    id,
    jobId: "browser-preview",
    path: "",
    fileName: label,
    mimeType: "image/svg+xml",
    sourceType,
    createdAt: new Date().toISOString()
  };
}

function createPreviewDataUrl(prompt: string, label: string): string {
  const safePrompt = prompt.trim().slice(0, 80) || "Preview image";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820">
      <rect width="1200" height="820" fill="#f7f4ed"/>
      <rect x="58" y="58" width="1084" height="704" rx="28" fill="#ffffff" stroke="#d9d4c9" stroke-width="2"/>
      <rect x="102" y="112" width="996" height="492" rx="20" fill="#dfe8e4"/>
      <circle cx="294" cy="268" r="92" fill="#a8c8c0"/>
      <path d="M120 558 C260 396 372 410 502 548 C602 654 748 390 1090 546 L1090 604 L120 604 Z" fill="#2e6259" opacity=".86"/>
      <path d="M120 586 C314 510 508 516 704 586 C836 634 950 630 1090 568 L1090 604 L120 604 Z" fill="#c98a45" opacity=".78"/>
      <text x="102" y="682" fill="#27231f" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700">${label}</text>
      <text x="102" y="728" fill="#5f5a52" font-family="Inter, Arial, sans-serif" font-size="22">${safePrompt}</text>
    </svg>`;
  return `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svg)))}`;
}

function coerceSnapshot(snapshot: AppSnapshot | null): AppSnapshot {
  return snapshot ?? fallbackSnapshot;
}

function validationForMode(mode: WorkMode, prompt: string, params: ImageParams, references: InputAsset[], mask: InputAsset | null): string | null {
  const baseMessage = getValidationError(params, prompt);
  if (baseMessage) return baseMessage;
  if (mode === "edit" && references.length === 0) {
    return "Edit requires at least one reference image.";
  }
  if (mode === "inpaint") {
    if (references.length === 0) return "Inpaint requires a source image.";
    if (!mask) return "Inpaint requires a mask.";
  }
  return null;
}

function runButtonLabel(mode: WorkMode): string {
  if (mode === "generate") return "Generate";
  if (mode === "edit") return "Run edit";
  return "Run inpaint";
}

export function App() {
  const bridge: AppBridge | undefined = window.image2tools;
  const bridgeAvailable = Boolean(bridge);
  const isMountedRef = useRef(true);

  const [snapshot, setSnapshot] = useState<AppSnapshot>(fallbackSnapshot);
  const [mode, setMode] = useState<WorkMode>("generate");
  const [prompt, setPrompt] = useState("A clean product photo of a matte black travel mug on a brushed steel counter");
  const [params, setParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS);
  const [sizePreset, setSizePreset] = useState(DEFAULT_IMAGE_PARAMS.size);
  const [customSize, setCustomSize] = useState("2048x1152");
  const [references, setReferences] = useState<InputAsset[]>([]);
  const [mask, setMask] = useState<InputAsset | null>(null);
  const [partials, setPartials] = useState<ImageAsset[]>([]);
  const [activeResult, setActiveResult] = useState<ImageAsset | null>(null);
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progressText, setProgressText] = useState("Ready");
  const [notice, setNotice] = useState<AppNotice>({ tone: "info", message: "Browser preview mode is available without Electron." });
  const [historyQuery, setHistoryQuery] = useState("");
  const [form, setForm] = useState<FormState>({
    apiKey: "",
    baseURL: fallbackConfig.baseURL,
    defaultModel: fallbackConfig.defaultModel,
    timeoutMs: fallbackConfig.timeoutMs
  });
  const [connection, setConnection] = useState<ConnectionTestResult | null>(null);
  const [configBusy, setConfigBusy] = useState(false);

  const loadSnapshot = useCallback(async () => {
    if (!bridge) {
      setSnapshot(fallbackSnapshot);
      return;
    }

    try {
      const nextSnapshot = coerceSnapshot(await bridge.getSnapshot());
      if (!isMountedRef.current) return;
      setSnapshot(nextSnapshot);
      setParams((current) => ({
        ...current,
        model: nextSnapshot.config.defaultModel,
        size: nextSnapshot.config.defaultSize,
        quality: nextSnapshot.config.defaultQuality,
        timeoutMs: nextSnapshot.config.timeoutMs
      }));
      setSizePreset(sizePresets.includes(nextSnapshot.config.defaultSize) ? nextSnapshot.config.defaultSize : "custom");
      if (!sizePresets.includes(nextSnapshot.config.defaultSize)) {
        setCustomSize(nextSnapshot.config.defaultSize);
      }
      setForm({
        apiKey: "",
        baseURL: nextSnapshot.config.baseURL,
        defaultModel: nextSnapshot.config.defaultModel,
        timeoutMs: nextSnapshot.config.timeoutMs
      });
      setNotice({ tone: "success", message: "Snapshot loaded." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to load app snapshot." });
    }
  }, [bridge]);

  useEffect(() => {
    isMountedRef.current = true;
    void loadSnapshot();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.onJobEvent((event: JobProgressEvent) => {
      if (event.type === "started") {
        setRunState("running");
        setProgressText("Job started");
      }
      if (event.type === "partial" && event.image) {
        setPartials((current) => {
          const withoutDuplicate = current.filter((asset) => asset.id !== event.image?.id);
          return [...withoutDuplicate, event.image as ImageAsset];
        });
        setActiveResult(event.image);
        setProgressText(`Partial image ${event.partialIndex ?? ""}`.trim());
      }
      if (event.type === "completed") {
        setRunState("succeeded");
        setProgressText("Completed");
      }
      if (event.type === "failed") {
        setRunState("failed");
        setProgressText("Failed");
        setNotice({ tone: "error", message: event.error ?? "Job failed." });
      }
    });
  }, [bridge]);

  const visibleHistory = useMemo(() => {
    const normalized = historyQuery.trim().toLowerCase();
    if (!normalized) return snapshot.history;
    return snapshot.history.filter((job) => {
      return (
        job.prompt.toLowerCase().includes(normalized) ||
        job.mode.includes(normalized) ||
        job.status.includes(normalized) ||
        job.outputs.some((asset) => asset.fileName.toLowerCase().includes(normalized))
      );
    });
  }, [historyQuery, snapshot.history]);

  const validationMessage = validationForMode(mode, prompt, params, references, mask);
  const canRun = !validationMessage && runState !== "running";
  const customSizeStatus = sizePreset === "custom" ? validateGptImage2Size(customSize) : { ok: true };
  const latestOutput = activeResult ?? activeJob?.outputs.find((asset) => asset.sourceType === "result") ?? activeJob?.outputs[0] ?? null;
  const previewSource = assetPreview(latestOutput);

  const updateParams = <K extends keyof ImageParams>(key: K, value: ImageParams[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  const handleSizeChange = (nextSize: string) => {
    setSizePreset(nextSize);
    updateParams("size", nextSize === "custom" ? customSize : nextSize);
  };

  const handleCustomSizeChange = (value: string) => {
    setCustomSize(value);
    if (sizePreset === "custom") {
      updateParams("size", value);
    }
  };

  const saveConfig = async () => {
    const input: ProviderConfigInput = {
      apiKey: form.apiKey.trim() || undefined,
      baseURL: normalizeBaseURL(form.baseURL),
      defaultModel: form.defaultModel.trim() || DEFAULT_IMAGE_PARAMS.model,
      defaultSize: params.size,
      defaultQuality: params.quality,
      timeoutMs: form.timeoutMs
    };

    if (!bridge) {
      setSnapshot((current) => ({
        ...current,
        config: {
          ...current.config,
          apiKeySaved: Boolean(input.apiKey) || current.config.apiKeySaved,
          baseURL: input.baseURL,
          defaultModel: input.defaultModel,
          defaultSize: input.defaultSize,
          defaultQuality: input.defaultQuality,
          timeoutMs: input.timeoutMs,
          updatedAt: new Date().toISOString()
        }
      }));
      setNotice({ tone: "info", message: "Saved in browser preview state only." });
      return;
    }

    setConfigBusy(true);
    try {
      const config = await bridge.saveConfig(input);
      setSnapshot((current) => ({ ...current, config }));
      setForm((current) => ({ ...current, apiKey: "", baseURL: config.baseURL }));
      setNotice({ tone: "success", message: "Provider settings saved." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to save settings." });
    } finally {
      setConfigBusy(false);
    }
  };

  const testConnection = async () => {
    if (!bridge) {
      const result = { ok: true, message: "Browser preview: Electron bridge is not connected." };
      setConnection(result);
      setNotice({ tone: "info", message: result.message });
      return;
    }

    setConfigBusy(true);
    try {
      const result = await bridge.testConnection();
      setConnection(result);
      setNotice({ tone: result.ok ? "success" : "error", message: result.message });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Connection test failed." });
    } finally {
      setConfigBusy(false);
    }
  };

  const selectReferences = async () => {
    if (!bridge) {
      const now = Date.now();
      setReferences((current) => [
        ...current,
        {
          id: `preview-reference-${now}`,
          name: `reference-${current.length + 1}.png`,
          path: createPreviewDataUrl(prompt, "Reference preview"),
          mimeType: "image/png",
          sizeBytes: 428000,
          dataUrl: createPreviewDataUrl(prompt, "Reference preview"),
          width: 1200,
          height: 820
        }
      ]);
      setNotice({ tone: "info", message: "Added a browser preview reference." });
      return;
    }

    try {
      const assets = await bridge.selectImages();
      setReferences((current) => {
        const knownIds = new Set(current.map((asset) => asset.id));
        return [...current, ...assets.filter((asset) => !knownIds.has(asset.id))];
      });
      if (assets.length > 0) {
        setNotice({ tone: "success", message: `${assets.length} reference image${assets.length === 1 ? "" : "s"} added.` });
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to select images." });
    }
  };

  const selectMask = async () => {
    if (!bridge) {
      const preview = createPreviewDataUrl("Transparent areas mark the edit region.", "Mask preview");
      setMask({
        id: `preview-mask-${Date.now()}`,
        name: "mask.png",
        path: preview,
        mimeType: "image/png",
        sizeBytes: 90000,
        dataUrl: preview,
        width: 1200,
        height: 820
      });
      setNotice({ tone: "info", message: "Added a browser preview mask." });
      return;
    }

    try {
      const asset = await bridge.selectMask();
      if (asset) {
        setMask(asset);
        setNotice({ tone: "success", message: "Mask selected." });
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to select mask." });
    }
  };

  const removeReference = (id: string) => {
    setReferences((current) => current.filter((asset) => asset.id !== id));
  };

  const runJob = async () => {
    const message = validationForMode(mode, prompt, params, references, mask);
    if (message) {
      setNotice({ tone: "error", message });
      return;
    }

    setRunState("running");
    setProgressText("Submitting job");
    setPartials([]);
    setActiveResult(null);
    setActiveJob(null);

    if (!bridge) {
      const partial = makePreviewAsset(`preview-partial-${Date.now()}`, "partial-preview.svg", "partial");
      partial.path = createPreviewDataUrl(prompt, "Partial preview");
      const final = makePreviewAsset(`preview-result-${Date.now()}`, "browser-preview.svg", "result");
      final.path = createPreviewDataUrl(prompt, `${modeCopy[mode].label} result`);
      const previewJob: GenerationJob = {
        id: `browser-preview-${Date.now()}`,
        mode,
        prompt,
        inputAssets: references,
        maskAsset: mask ?? undefined,
        params,
        status: "succeeded",
        durationMs: 1200,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        outputs: [final],
        usage: {
          total_tokens: 0
        }
      };
      window.setTimeout(() => {
        setPartials([partial]);
        setActiveResult(partial);
        setProgressText("Partial image 1");
      }, 350);
      window.setTimeout(() => {
        setActiveJob(previewJob);
        setActiveResult(final);
        setRunState("succeeded");
        setProgressText("Completed");
        setSnapshot((current) => ({ ...current, history: [previewJob, ...current.history] }));
        setNotice({ tone: "success", message: "Browser preview job completed." });
      }, 850);
      return;
    }

    try {
      const job = await bridge.runJob({
        mode,
        prompt,
        inputPaths: references.map((asset) => asset.path),
        maskPath: mask?.path,
        maskDataUrl: mask?.dataUrl,
        params
      });
      setActiveJob(job);
      setActiveResult(job.outputs.find((asset) => asset.sourceType === "result") ?? job.outputs[0] ?? null);
      setRunState(job.status === "succeeded" ? "succeeded" : job.status === "failed" ? "failed" : "running");
      setProgressText(job.status === "succeeded" ? "Completed" : job.status);
      await loadSnapshot();
      if (job.status === "failed") {
        setNotice({ tone: "error", message: job.error ?? "Job failed." });
      } else {
        setNotice({ tone: "success", message: "Job completed." });
      }
    } catch (error) {
      setRunState("failed");
      setProgressText("Failed");
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to run job." });
    }
  };

  const reuseJob = (job: GenerationJob) => {
    setMode(job.mode);
    setPrompt(job.prompt);
    setParams(job.params);
    setSizePreset(sizePresets.includes(job.params.size) ? job.params.size : "custom");
    if (!sizePresets.includes(job.params.size)) setCustomSize(job.params.size);
    setReferences(job.inputAssets);
    setMask(job.maskAsset ?? null);
    setActiveJob(job);
    setActiveResult(job.outputs.find((asset) => asset.sourceType === "result") ?? job.outputs[0] ?? null);
    setNotice({ tone: "info", message: "Job settings loaded." });
  };

  const retryJob = (job: GenerationJob) => {
    reuseJob(job);
    window.setTimeout(() => void runJob(), 0);
  };

  const copyPrompt = async (value: string = prompt) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ tone: "success", message: "Prompt copied." });
    } catch {
      setNotice({ tone: "error", message: "Clipboard is unavailable." });
    }
  };

  const downloadAsset = async (asset: ImageAsset) => {
    if (!bridge) {
      setNotice({ tone: "info", message: "Download is available in Electron." });
      return;
    }
    try {
      const destination = await bridge.downloadAsset({ assetPath: asset.path, suggestedName: asset.fileName });
      setNotice({ tone: destination ? "success" : "info", message: destination ? "Asset downloaded." : "Download canceled." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Download failed." });
    }
  };

  const openFolder = async (asset: ImageAsset) => {
    if (!bridge) {
      setNotice({ tone: "info", message: "Open folder is available in Electron." });
      return;
    }
    try {
      await bridge.openAssetFolder(asset.path);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to open folder." });
    }
  };

  const deleteJob = async (jobId: string) => {
    if (!bridge) {
      setSnapshot((current) => ({ ...current, history: current.history.filter((job) => job.id !== jobId) }));
      setNotice({ tone: "info", message: "Removed from browser preview history." });
      return;
    }
    try {
      const history = await bridge.deleteJob(jobId);
      setSnapshot((current) => ({ ...current, history }));
      setNotice({ tone: "success", message: "History item deleted." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to delete history item." });
    }
  };

  const clearHistory = async () => {
    if (!bridge) {
      setSnapshot((current) => ({ ...current, history: [] }));
      setNotice({ tone: "info", message: "Browser preview history cleared." });
      return;
    }
    try {
      const history = await bridge.clearHistory();
      setSnapshot((current) => ({ ...current, history }));
      setNotice({ tone: "success", message: "History cleared." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to clear history." });
    }
  };

  return (
    <main className="app-shell">
      <aside className="left-rail" aria-label="Provider and parameters">
        <header className="brand-block">
          <div>
            <p className="eyebrow">Image2Tools</p>
            <h1>Renderer Workbench</h1>
          </div>
          <div className={bridgeAvailable ? "bridge-pill ready" : "bridge-pill"}>
            {bridgeAvailable ? <CheckCircle2 aria-hidden="true" /> : <Eye aria-hidden="true" />}
            <span>{bridgeAvailable ? "Electron" : "Browser"}</span>
          </div>
        </header>

        <section className="settings-section" aria-labelledby="provider-title">
          <div className="section-title">
            <Settings2 aria-hidden="true" />
            <h2 id="provider-title">Provider</h2>
          </div>
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={snapshot.config.apiKeySaved ? "Saved key" : "Paste API key"}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Base URL</span>
            <input
              value={form.baseURL}
              onChange={(event) => setForm((current) => ({ ...current, baseURL: event.target.value }))}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={form.defaultModel}
              onChange={(event) => {
                setForm((current) => ({ ...current, defaultModel: event.target.value }));
                updateParams("model", event.target.value);
              }}
              spellCheck={false}
            />
          </label>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={configBusy}>
              <RefreshCw aria-hidden="true" />
              <span>Test</span>
            </button>
            <button type="button" onClick={() => void saveConfig()} disabled={configBusy}>
              <Save aria-hidden="true" />
              <span>Save</span>
            </button>
          </div>
          {connection ? <p className={connection.ok ? "inline-status good" : "inline-status bad"}>{connection.message}</p> : null}
        </section>

        <section className="settings-section" aria-labelledby="params-title">
          <div className="section-title">
            <SlidersHorizontal aria-hidden="true" />
            <h2 id="params-title">Parameters</h2>
          </div>
          <label className="field">
            <span>Size</span>
            <select value={sizePreset} onChange={(event) => handleSizeChange(event.target.value)}>
              {sizePresets.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          {sizePreset === "custom" ? (
            <label className="field">
              <span>Custom size</span>
              <input value={customSize} onChange={(event) => handleCustomSizeChange(event.target.value)} placeholder="1536x1024" />
            </label>
          ) : null}
          <div className="two-up">
            <label className="field">
              <span>Quality</span>
              <select value={params.quality} onChange={(event) => updateParams("quality", event.target.value as ImageQuality)}>
                <option value="auto">auto</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="field">
              <span>Format</span>
              <select value={params.outputFormat} onChange={(event) => updateParams("outputFormat", event.target.value as ImageFormat)}>
                <option value="png">png</option>
                <option value="jpeg">jpeg</option>
                <option value="webp">webp</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Compression</span>
            <div className="range-row">
              <input
                type="range"
                min="0"
                max="100"
                value={params.outputCompression}
                onChange={(event) => updateParams("outputCompression", Number(event.target.value))}
              />
              <output>{params.outputCompression}</output>
            </div>
          </label>
          <div className="three-up">
            <label className="field">
              <span>Count</span>
              <input type="number" min="1" max="10" value={params.n} onChange={(event) => updateParams("n", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Partials</span>
              <input
                type="number"
                min="0"
                max="3"
                value={params.partialImages}
                onChange={(event) => updateParams("partialImages", Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Timeout</span>
              <input
                type="number"
                min="30"
                max="600"
                value={Math.round(params.timeoutMs / 1000)}
                onChange={(event) => {
                  const seconds = Number(event.target.value);
                  updateParams("timeoutMs", seconds * 1000);
                  setForm((current) => ({ ...current, timeoutMs: seconds * 1000 }));
                }}
              />
            </label>
          </div>
          <div className="two-up">
            <label className="field">
              <span>Moderation</span>
              <select value={params.moderation} onChange={(event) => updateParams("moderation", event.target.value as ModerationMode)}>
                <option value="auto">auto</option>
                <option value="low">low</option>
              </select>
            </label>
            <label className="toggle-field">
              <input type="checkbox" checked={params.stream} onChange={(event) => updateParams("stream", event.target.checked)} />
              <span>Stream</span>
            </label>
          </div>
          {!customSizeStatus.ok ? <p className="inline-status bad">{customSizeStatus.message}</p> : null}
        </section>
      </aside>

      <section className="workspace" aria-label="Prompt and image workspace">
        <header className="workspace-top">
          <div className="mode-tabs" role="tablist" aria-label="Mode">
            {(Object.keys(modeCopy) as WorkMode[]).map((item) => {
              const Icon = modeCopy[item].icon;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={mode === item}
                  className={mode === item ? "mode-tab active" : "mode-tab"}
                  onClick={() => setMode(item)}
                >
                  <Icon aria-hidden="true" />
                  <span>{modeCopy[item].label}</span>
                  <small>{modeCopy[item].detail}</small>
                </button>
              );
            })}
          </div>
          <div className={`notice ${notice.tone}`}>
            <span>{notice.message}</span>
          </div>
        </header>

        <section className="prompt-panel" aria-label="Prompt">
          <label className="prompt-field">
            <span>Prompt</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the image to create or change." />
          </label>
          <div className="prompt-actions">
            <button type="button" className="icon-button" onClick={() => void copyPrompt()} title="Copy prompt" aria-label="Copy prompt">
              <Clipboard aria-hidden="true" />
            </button>
            <button type="button" className="secondary-button" onClick={() => void loadSnapshot()}>
              <RefreshCw aria-hidden="true" />
              <span>Refresh</span>
            </button>
            <button type="button" onClick={() => void runJob()} disabled={!canRun}>
              {runState === "running" ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{runState === "running" ? "Running" : runButtonLabel(mode)}</span>
            </button>
          </div>
        </section>

        <section className="preview-section" aria-label="Preview canvas">
          <div className="canvas-toolbar">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>{activeJob ? `${modeCopy[activeJob.mode].label} output` : "Current output"}</h2>
            </div>
            <div className="progress-chip">
              {runState === "running" ? <Loader2 className="spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              <span>{progressText}</span>
            </div>
          </div>

          <div className="canvas-frame">
            {previewSource ? (
              <img src={previewSource} alt={latestOutput?.fileName ?? "Generated output"} />
            ) : (
              <div className="empty-canvas">
                <FileImage aria-hidden="true" />
                <span>Run a job to display generated images here.</span>
              </div>
            )}
          </div>

          {partials.length > 0 ? (
            <div className="partial-strip" aria-label="Partial images">
              {partials.map((asset) => (
                <button key={asset.id} type="button" onClick={() => setActiveResult(asset)} className="partial-thumb">
                  {assetPreview(asset) ? <img src={assetPreview(asset) ?? ""} alt={asset.fileName} /> : <FileImage aria-hidden="true" />}
                  <span>{asset.fileName}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="asset-panel" aria-label="References and mask">
          <div className="asset-panel-header">
            <div>
              <h2>Inputs</h2>
              <p>Mask applies to the first reference image when multiple references exist.</p>
            </div>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => void selectReferences()}>
                <ImagePlus aria-hidden="true" />
                <span>Add images</span>
              </button>
              <button type="button" className="secondary-button" onClick={() => void selectMask()}>
                <Upload aria-hidden="true" />
                <span>Add mask</span>
              </button>
            </div>
          </div>

          <div className="asset-grid">
            {references.length === 0 ? (
              <div className="asset-empty">No reference images selected.</div>
            ) : (
              references.map((asset, index) => (
                <figure className="asset-thumb" key={asset.id}>
                  {assetPreview(asset) ? <img src={assetPreview(asset) ?? ""} alt={asset.name} /> : <FileImage aria-hidden="true" />}
                  <figcaption>
                    <span>{index === 0 ? "Source" : `Reference ${index + 1}`}</span>
                    <small>{asset.name}</small>
                  </figcaption>
                  <button type="button" className="thumb-remove" onClick={() => removeReference(asset.id)} aria-label={`Remove ${asset.name}`}>
                    <X aria-hidden="true" />
                  </button>
                </figure>
              ))
            )}
            <figure className={mask ? "asset-thumb mask" : "asset-thumb mask empty"}>
              {mask && assetPreview(mask) ? <img src={assetPreview(mask) ?? ""} alt={mask.name} /> : <Eraser aria-hidden="true" />}
              <figcaption>
                <span>Mask</span>
                <small>{mask ? mask.name : "Not selected"}</small>
              </figcaption>
              {mask ? (
                <button type="button" className="thumb-remove" onClick={() => setMask(null)} aria-label="Remove mask">
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </figure>
          </div>

          {validationMessage ? <p className="inline-status bad">{validationMessage}</p> : <p className="inline-status good">Ready to run.</p>}
        </section>
      </section>

      <aside className="right-rail" aria-label="History">
        <header className="history-header">
          <div>
            <p className="eyebrow">History</p>
            <h2>Recent jobs</h2>
          </div>
          <button type="button" className="icon-button danger" onClick={() => void clearHistory()} title="Clear history" aria-label="Clear history">
            <Trash2 aria-hidden="true" />
          </button>
        </header>

        <label className="search-box">
          <Search aria-hidden="true" />
          <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search jobs" />
        </label>

        <div className="history-list">
          {visibleHistory.length === 0 ? (
            <div className="history-empty">
              <Archive aria-hidden="true" />
              <span>No history yet.</span>
            </div>
          ) : (
            visibleHistory.map((job) => {
              const output = job.outputs.find((asset) => asset.sourceType === "result") ?? job.outputs[0];
              return (
                <article className="history-item" key={job.id}>
                  <button type="button" className="history-preview" onClick={() => reuseJob(job)}>
                    {assetPreview(output) ? <img src={assetPreview(output) ?? ""} alt={output.fileName} /> : <FileImage aria-hidden="true" />}
                  </button>
                  <div className="history-meta">
                    <div>
                      <strong>{modeCopy[job.mode].label}</strong>
                      <span className={`job-status ${job.status}`}>{job.status}</span>
                    </div>
                    <p>{job.prompt}</p>
                    <small>
                      {formatDate(job.createdAt)}
                      {job.durationMs ? ` · ${(job.durationMs / 1000).toFixed(1)}s` : ""}
                      {output ? ` · ${output.fileName}` : ""}
                    </small>
                  </div>
                  <div className="history-actions">
                    <button type="button" className="icon-button" onClick={() => retryJob(job)} title="Retry" aria-label="Retry">
                      <RotateCcw aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" onClick={() => reuseJob(job)} title="Reuse settings" aria-label="Reuse settings">
                      <Copy aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" onClick={() => void copyPrompt(job.prompt)} title="Copy prompt" aria-label="Copy prompt">
                      <Clipboard aria-hidden="true" />
                    </button>
                    {output ? (
                      <>
                        <button type="button" className="icon-button" onClick={() => void downloadAsset(output)} title="Download" aria-label="Download">
                          <Download aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button" onClick={() => void openFolder(output)} title="Open folder" aria-label="Open folder">
                          <FolderOpen aria-hidden="true" />
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="icon-button danger" onClick={() => void deleteJob(job.id)} title="Delete" aria-label="Delete">
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <footer className="history-footer">
          <span>{snapshot.history.length} jobs</span>
          <span>{references.length} refs</span>
          <span>{formatBytes(references.reduce((sum, asset) => sum + asset.sizeBytes, 0))}</span>
        </footer>
      </aside>
    </main>
  );
}
