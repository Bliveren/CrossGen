import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  AppBridge,
  AppSnapshot,
  GenerationJob,
  ImageAsset,
  RunJobRequest,
  ProviderConfig,
  UpdateCheckResult,
  WorkspaceDraft
} from "../shared/types";
import {
  DEFAULT_GEMINI_IMAGE_PARAMS,
  DEFAULT_IMAGE_PARAMS
} from "../shared/validation";
import {
  GEMINI_3_PRO_IMAGE_MODEL_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID
} from "../shared/modelCatalog";

const now = new Date(0).toISOString();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.restoreAllMocks();
  installLocalStorageMock();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete window.image2tools;
});

describe("renderer multi-model smoke", () => {
  it("shows a clear browser preview notice when the Electron bridge is missing", async () => {
    await renderAppWithoutBridge();

    expect(document.body.textContent).toContain("Browser preview: Electron IPC is unavailable.");
    expect(buttonByText("Discover models").disabled).toBe(true);
  });

  it("disables all launch buttons before an API key is saved", async () => {
    await renderApp(snapshot({ config: providerConfig({ apiKeySaved: false, discoveredModels: [] }) }));

    expect(launchButton("GPT Image 2").disabled).toBe(true);
    expect(launchButton("Nano Banana 3").disabled).toBe(true);
    expect(launchButton("General").disabled).toBe(true);
    expect(document.body.textContent).toContain("Save an API key first.");
  });

  it("auto-tests saved API config on startup and after config save", async () => {
    const bridge = await renderApp(snapshot());

    await flushAsync();

    expect(bridge.testConnection).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Connected");

    vi.mocked(bridge.testConnection).mockClear();
    await click(buttonByText("Save"));
    await flushAsync();

    expect(bridge.saveConfig).toHaveBeenCalled();
    expect(bridge.testConnection).toHaveBeenCalledTimes(1);
  });

  it("enables only GPT Image 2 for OpenAI discovery without enabling General", async () => {
    await renderApp(
      snapshot({
        config: providerConfig({
          apiKeySaved: true,
          discoveredModels: [
            { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
            { id: "gpt-4.1", providerKind: "openai" }
          ],
          lastModelDiscoveryAt: now
        })
      })
    );

    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(launchButton("Nano Banana 3").disabled).toBe(true);
    expect(launchButton("General").disabled).toBe(true);
    expect(launchButton("General").textContent).toContain("No image models discovered");
  });

  it("submits GPT Image 2 multi-count requests without stream partial previews", async () => {
    const bridge = await renderApp(snapshot());

    await click(buttonByText("Parameters", ".section-toggle"));
    await changeInput(inputByLabel("Count"), "4");

    const streamPreview = inputByLabel("Stream partial preview");
    expect(streamPreview.disabled).toBe(true);
    expect(streamPreview.checked).toBe(false);

    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          providerKind: "openai",
          launchId: GPT_IMAGE_2_LAUNCH_ID,
          n: 4,
          stream: false,
          partialImages: 0
        })
      })
    );
  });

  it("enables OpenAI General prompt-only fallback for non-focused image models", async () => {
    const bridge = await renderApp(
      snapshot({
        config: providerConfig({
          apiKeySaved: true,
          discoveredModels: [
            { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
            { id: "dall-e-3", providerKind: "openai" }
          ],
          lastModelDiscoveryAt: now
        })
      })
    );

    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(launchButton("General").disabled).toBe(false);

    await click(launchButton("General"));
    await click(buttonByText("Generate", ".primary-run"));

    expect(document.body.textContent).toContain("prompt-only generation");
    expect(bridge.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ activeLaunchId: "general", activeModelId: "dall-e-3" }));
    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "generate",
        inputPaths: [],
        params: expect.objectContaining({
          providerKind: "openai",
          launchId: "general",
          model: "dall-e-3"
        })
      })
    );
  });

  it("enables focused launches from discovered API models instead of the selected provider", async () => {
    const bridge = await renderApp(
      snapshot({
        config: providerConfig({
          kind: "openai",
          name: "OpenAI",
          baseURL: "https://gateway.example.com/v1",
          apiKeySaved: true,
          discoveredModels: [
            { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
            { id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" },
            { id: GEMINI_3_PRO_IMAGE_MODEL_ID, providerKind: "gemini", displayName: "Gemini 3 Pro Image" }
          ],
          lastModelDiscoveryAt: now
        })
      })
    );

    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(launchButton("Nano Banana 3").disabled).toBe(false);

    await click(launchButton("Nano Banana 3"));
    expect(document.body.textContent).toContain("Guided region");
    const modelOption = launchModelOption("Gemini 3 Pro Image");
    expect(modelOption).toBeTruthy();
    await click(modelOption);
    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "openai",
        baseURL: "https://gateway.example.com/v1",
        activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
        activeModelId: GEMINI_3_PRO_IMAGE_MODEL_ID
      })
    );
    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "generate",
        params: expect.objectContaining({
          providerKind: "gemini",
          launchId: NANO_BANANA_3_LAUNCH_ID,
          model: GEMINI_3_PRO_IMAGE_MODEL_ID
        })
      })
    );
  });

  it("can discover models, select Nano Banana 3, and run through the Electron bridge", async () => {
    const geminiConfig = providerConfig({
      kind: "gemini",
      name: "Gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      apiKeySaved: true,
      defaultModel: NANO_BANANA_3_MODEL_ID,
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: NANO_BANANA_3_MODEL_ID,
      discoveredModels: [{ id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" }],
      lastModelDiscoveryAt: now
    });
    const bridge = await renderApp(snapshot({ config: geminiConfig, history: [geminiJob(0)] }));

    await click(buttonByText("Discover models"));
    await click(launchButton("Nano Banana 3"));
    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.discoverModels).toHaveBeenCalled();
    expect(bridge.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ activeLaunchId: NANO_BANANA_3_LAUNCH_ID }));
    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "generate",
        params: expect.objectContaining({ launchId: NANO_BANANA_3_LAUNCH_ID })
      })
    );
  });

  it("shows Gemini upload rights reminder beside reference tools", async () => {
    await renderApp(
      snapshot({
        config: providerConfig({
          kind: "gemini",
          name: "Gemini",
          baseURL: "https://generativelanguage.googleapis.com/v1beta",
          apiKeySaved: true,
          defaultModel: NANO_BANANA_3_MODEL_ID,
          activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
          activeModelId: NANO_BANANA_3_MODEL_ID,
          discoveredModels: [{ id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" }],
          lastModelDiscoveryAt: now
        })
      })
    );

    expect(document.body.textContent).toContain("Only upload images you have permission to use");
    expect(buttonByText("Upload mask")).toBeTruthy();
  });

  it("enables Nano Banana 3 and Gemini General candidate without showing more than six collapsed history items", async () => {
    await renderApp(
      snapshot({
        config: providerConfig({
          kind: "gemini",
          name: "Gemini",
          baseURL: "https://generativelanguage.googleapis.com/v1beta",
          apiKeySaved: true,
          defaultModel: NANO_BANANA_3_MODEL_ID,
          activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
          activeModelId: NANO_BANANA_3_MODEL_ID,
          discoveredModels: [
            { id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" },
            { id: "gemini-2.0-flash-preview-image-generation", providerKind: "gemini", displayName: "Gemini image fallback" }
          ],
          lastModelDiscoveryAt: now
        }),
        history: Array.from({ length: 8 }, (_, index) => geminiJob(index))
      })
    );

    expect(launchButton("GPT Image 2").disabled).toBe(true);
    expect(launchButton("Nano Banana 3").disabled).toBe(false);
    expect(launchButton("General").disabled).toBe(false);
    expect(document.querySelectorAll(".history-item")).toHaveLength(6);
    expect(document.body.textContent).toContain("Show all 8");
    expect(document.body.textContent).toContain("Nano Banana 3");

    await click(buttonByText("Show all 8"));

    expect(document.querySelectorAll(".history-item")).toHaveLength(8);
    expect(document.body.textContent).toContain("Show fewer");
  });

  it("keeps prompt text while switching models and resets incompatible General inputs", async () => {
    const bridge = await renderApp(
      snapshot({
        config: providerConfig({
          apiKeySaved: true,
          discoveredModels: [
            { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
            { id: "dall-e-3", providerKind: "openai" }
          ],
          lastModelDiscoveryAt: now
        })
      })
    );
    const promptInput = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const originalPrompt = promptInput.value;

    await click(buttonByText("Edit"));
    await click(launchButton("General"));

    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(originalPrompt);
    expect(buttonByText("Generate", ".primary-run").disabled).toBe(false);
    expect(document.body.textContent).toContain("prompt-only generation");
    expect(document.body.textContent).not.toContain("Add references");
    expect(bridge.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeLaunchId: "general",
        activeModelId: "dall-e-3",
        kind: "openai"
      })
    );
  });

  it("keeps model config, launch buttons, parameters, and updates in a clear left-rail order", async () => {
    await renderApp(snapshot());
    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
    const configSection = sidebar.querySelector<HTMLElement>("form.tool-section")!;
    const launchSection = sidebar.querySelector<HTMLElement>(".launch-section")!;
    const parameterSection = buttonByText("Parameters", ".section-toggle").closest<HTMLElement>(".tool-section")!;
    const updatePanel = sidebar.querySelector<HTMLElement>(".update-panel")!;

    expect(configSection.textContent).toContain("Model config");
    expect(launchSection.textContent).toContain("Launch");
    expect(parameterSection.textContent).toContain("Parameters");
    expect(updatePanel.textContent).toContain("Updates");
    expect(configSection.compareDocumentPosition(launchSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(launchSection.compareDocumentPosition(parameterSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(parameterSection.compareDocumentPosition(updatePanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supports keyboard resizing without losing fixed history layout", async () => {
    await renderApp(snapshot());
    const sidebarResizer = separatorByLabel("Resize sidebar");
    const historyResizer = separatorByLabel("Resize history");

    expect(sidebarResizer.getAttribute("aria-valuenow")).toBe("310");
    expect(historyResizer.getAttribute("aria-valuenow")).toBe("330");

    await keyDown(sidebarResizer, "ArrowRight");
    await keyDown(historyResizer, "ArrowLeft", { shiftKey: true });

    expect(sidebarResizer.getAttribute("aria-valuenow")).toBe("326");
    expect(historyResizer.getAttribute("aria-valuenow")).toBe("370");
    expect(window.localStorage.getItem("image2tools.sidebarWidth")).toBe("326");
    expect(window.localStorage.getItem("image2tools.historyWidth")).toBe("370");
  });

  it("keeps compact controls and history from overflowing their layout contracts", async () => {
    await renderApp(
      snapshot({
        config: providerConfig({
          kind: "gemini",
          name: "Gemini",
          baseURL: "https://generativelanguage.googleapis.com/v1beta",
          apiKeySaved: true,
          defaultModel: NANO_BANANA_3_MODEL_ID,
          activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
          activeModelId: NANO_BANANA_3_MODEL_ID,
          discoveredModels: [
            { id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" },
            {
              id: "gemini-2.0-flash-preview-image-generation-with-a-very-long-display-name",
              providerKind: "gemini",
              displayName: "Gemini image fallback with a very long display name"
            }
          ],
          lastModelDiscoveryAt: now
        }),
        history: Array.from({ length: 10 }, (_, index) => geminiJob(index))
      })
    );

    expect(document.querySelector(".history-list")).toBeTruthy();
    expect(document.querySelector(".launch-button span")).toBeTruthy();
    expect(document.querySelector(".launch-button small")).toBeTruthy();
    expect(document.querySelectorAll(".history-item")).toHaveLength(6);
    expect(buttonByText("Show all 10")).toBeTruthy();
    expect(launchButton("General").textContent).toContain("Gemini image fallback with a very long display name");
  });

  it("requires confirmation before clearing all history", async () => {
    const bridge = await renderApp(snapshot({ history: [geminiJob(0), geminiJob(1)] }));
    const clearAllButton = document.querySelector<HTMLButtonElement>('button[title="Clear all history records"]')!;

    expect(clearAllButton).toBeTruthy();
    await click(clearAllButton);

    expect(bridge.clearHistory).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Clear all history?");
    expect(document.body.textContent).toContain("This will delete all 2 history records");

    await click(buttonByText("Clear all", ".danger-button"));

    expect(bridge.clearHistory).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Clear all history?");
  });

  it("renders Gemini results on the canvas and routes downloads through the bridge", async () => {
    const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
    const bridge = await renderApp(snapshot({ history: [job] }));

    await click(document.querySelector<HTMLButtonElement>(".history-preview")!);

    const result = document.querySelector<HTMLImageElement>('img[alt="Generated result"]');
    expect(result?.src).toContain("image2tools-asset://image?path=");

    const downloadButtons = [...document.querySelectorAll<HTMLButtonElement>('button[title="Download"]')].filter((button) => !button.disabled);
    expect(downloadButtons.length).toBeGreaterThan(0);
    await click(downloadButtons[0]);

    expect(bridge.downloadAsset).toHaveBeenCalledWith({
      assetPath: "/tmp/image2tools/result_gemini.png",
      suggestedName: "result_gemini.png"
    });
  });

  it("renders selectable thumbnails for multi-output jobs", async () => {
    const job = geminiJob(0, {
      outputs: [
        imageAsset("result_1.png", "job_gemini_0"),
        imageAsset("result_2.png", "job_gemini_0"),
        imageAsset("result_3.png", "job_gemini_0")
      ]
    });
    await renderApp(snapshot({ history: [job] }));

    await click(document.querySelector<HTMLButtonElement>(".history-preview")!);

    const resultButtons = document.querySelectorAll<HTMLButtonElement>(".result-strip button");
    expect(resultButtons).toHaveLength(3);
    expect(document.querySelector<HTMLImageElement>(".zoom-surface img")?.src).toContain("result_3.png");

    await click(resultButtons[1]);

    expect(document.querySelector<HTMLImageElement>(".zoom-surface img")?.src).toContain("result_2.png");
  });
});

async function renderApp(initialSnapshot: AppSnapshot): Promise<AppBridge> {
  container = document.createElement("div");
  document.body.append(container);
  const bridge = createBridge(initialSnapshot);
  window.image2tools = bridge;
  await act(async () => {
    root = createRoot(container!);
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return bridge;
}

async function renderAppWithoutBridge() {
  container = document.createElement("div");
  document.body.append(container);
  delete window.image2tools;
  await act(async () => {
    root = createRoot(container!);
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function createBridge(initialSnapshot: AppSnapshot): AppBridge {
  let currentSnapshot = initialSnapshot;
  const updateCheckResult: UpdateCheckResult = {
    status: "not-configured",
    currentVersion: "0.1.0",
    updateAvailable: false,
    checkedAt: now,
    message: "not configured"
  };

  return {
    getSnapshot: vi.fn(async () => currentSnapshot),
    saveConfig: vi.fn(async (input) => {
      const nextConfig: ProviderConfig = {
        ...currentSnapshot.config,
        kind: input.kind ?? currentSnapshot.config.kind,
        baseURL: input.baseURL,
        defaultModel: input.defaultModel,
        defaultSize: input.defaultSize,
        defaultQuality: input.defaultQuality,
        timeoutMs: input.timeoutMs,
        activeLaunchId: input.activeLaunchId ?? currentSnapshot.config.activeLaunchId,
        activeModelId: input.activeModelId ?? currentSnapshot.config.activeModelId,
        apiKeySaved: currentSnapshot.config.apiKeySaved || Boolean(input.apiKey?.trim()),
        updatedAt: now
      };
      currentSnapshot = { ...currentSnapshot, config: nextConfig };
      return nextConfig;
    }),
    discoverModels: vi.fn(async () => currentSnapshot.config),
    clearApiKey: vi.fn(async () => ({ ...initialSnapshot.config, apiKeySaved: false, discoveredModels: [] })),
    testConnection: vi.fn(async () => ({ ok: true, message: "ok" })),
    saveDraft: vi.fn(async (input) => ({ ...input, activeLaunchId: input.activeLaunchId ?? input.params.launchId, activeModelId: input.activeModelId ?? input.params.model, updatedAt: now }) as WorkspaceDraft),
    clearDraft: vi.fn(async () => undefined),
    selectImages: vi.fn(async () => []),
    selectMask: vi.fn(async () => null),
    runJob: vi.fn(async (request) => {
      const job = jobFromRequest(request, currentSnapshot.config);
      currentSnapshot = { ...currentSnapshot, history: [job, ...currentSnapshot.history] };
      return job;
    }),
    downloadAsset: vi.fn(async () => "/tmp/downloaded.png"),
    openAssetFolder: vi.fn(async () => undefined),
    checkForUpdates: vi.fn(async () => updateCheckResult),
    downloadAndInstallUpdate: vi.fn(async () => ({ version: "0.0.0", filePath: "/tmp/update", message: "opened" })),
    deleteJob: vi.fn(async () => initialSnapshot.history),
    clearHistory: vi.fn(async () => []),
    onJobEvent: vi.fn(() => () => undefined)
  };
}

function jobFromRequest(request: RunJobRequest, config: ProviderConfig): GenerationJob {
  const modelId = request.params.model;
  return {
    id: "job_bridge_result",
    providerKind: request.params.providerKind,
    providerId: config.id,
    launchId: request.params.launchId,
    modelId,
    modelDisplayName: modelId,
    mode: request.mode,
    prompt: request.prompt,
    inputAssets: [],
    maskAsset: undefined,
    params: request.params,
    status: "succeeded",
    createdAt: now,
    updatedAt: now,
    outputs: [imageAsset("bridge_result.png", "job_bridge_result")]
  };
}

function snapshot(patch: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    appVersion: "0.1.0",
    config: providerConfig(),
    history: [],
    ...patch
  };
}

function providerConfig(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "test-provider",
    kind: "openai",
    name: "OpenAI",
    apiKeySaved: true,
    apiKeyPreview: "sk-...mock",
    baseURL: "https://api.openai.com/v1",
    enabled: true,
    defaultModel: GPT_IMAGE_2_MODEL_ID,
    defaultSize: DEFAULT_IMAGE_PARAMS.size,
    defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
    timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
    discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
    lastModelDiscoveryAt: now,
    activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
    activeModelId: GPT_IMAGE_2_MODEL_ID,
    updatedAt: now,
    ...patch
  };
}

function geminiJob(index: number, patch: Partial<GenerationJob> = {}): GenerationJob {
  const id = `job_gemini_${index}`;
  return {
    id,
    providerKind: "gemini",
    providerId: "gemini",
    launchId: NANO_BANANA_3_LAUNCH_ID,
    modelId: NANO_BANANA_3_MODEL_ID,
    modelDisplayName: "Nano Banana 3",
    mode: "generate",
    prompt: `Gemini prompt ${index}`,
    inputAssets: [],
    params: {
      ...DEFAULT_GEMINI_IMAGE_PARAMS,
      providerKind: "gemini",
      launchId: NANO_BANANA_3_LAUNCH_ID,
      model: NANO_BANANA_3_MODEL_ID
    },
    status: "succeeded",
    createdAt: new Date(index).toISOString(),
    updatedAt: new Date(index).toISOString(),
    outputs: index === 0 ? [imageAsset(`result_${index}.png`, id)] : [],
    ...patch
  };
}

function imageAsset(fileName: string, jobId = "job_gemini_0"): ImageAsset {
  return {
    id: `img_${fileName}`,
    jobId,
    path: `/tmp/image2tools/${fileName}`,
    fileName,
    mimeType: "image/png",
    sourceType: "result",
    createdAt: now
  };
}

function launchButton(name: string): HTMLButtonElement {
  return buttonByText(name, ".launch-button");
}

function launchModelOption(name: string): HTMLButtonElement {
  return buttonByText(name, ".launch-model-option");
}

function buttonByText(text: string, selector = "button"): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button containing "${text}" was not found.`);
  return button;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function inputByLabel(labelText: string): HTMLInputElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.includes(labelText));
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`Input labeled "${labelText}" was not found.`);
  return input;
}

async function keyDown(element: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

function separatorByLabel(label: string): HTMLElement {
  const separator = [...document.querySelectorAll<HTMLElement>('[role="separator"]')].find((item) => item.getAttribute("aria-label") === label);
  if (!separator) throw new Error(`Separator "${label}" was not found.`);
  return separator;
}

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    }
  });
}
