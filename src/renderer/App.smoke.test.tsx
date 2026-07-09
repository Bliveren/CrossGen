import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  AppBridge,
  AppSnapshot,
  GenerationJob,
  GalleryAsset,
  GalleryFolder,
  ImageAsset,
  InputAsset,
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined)
    }
  });
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
  document.documentElement.removeAttribute("data-theme");
  delete window.crossgen;
  delete window.image2tools;
});

describe("renderer multi-model smoke", () => {
  it("shows a clear browser preview notice when the Electron bridge is missing", async () => {
    await renderAppWithoutBridge();

    expect(document.body.textContent).toContain("Browser preview: Electron IPC is unavailable.");
    await click(apiAccessCurrentButton());
    expect(buttonByText("Discover models").disabled).toBe(true);
  });

  it("adds hover tooltips to compactable prompt action buttons", async () => {
    await renderApp(snapshot());

    expect(document.querySelector<HTMLButtonElement>(".primary-run")?.dataset.tooltip).toBe("Generate");
    expect(document.querySelector<HTMLButtonElement>(".prompt-template-button")?.dataset.tooltip).toBe("Prompt templates");
    expect(document.querySelector<HTMLButtonElement>(".prompt-copy-button")?.dataset.tooltip).toBe("Copy prompt");
  });

  it("disables all launch buttons before an API key is saved", async () => {
    const defaultConfig = providerConfig({ apiKeySaved: false, discoveredModels: [] });
    await renderApp(snapshot({ providers: [defaultConfig], activeProviderId: defaultConfig.id }));

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
    await click(apiAccessCurrentButton());
    await click(buttonByText("Save"));
    await flushAsync();

    expect(bridge.saveConfig).toHaveBeenCalled();
    expect(bridge.testConnection).toHaveBeenCalledTimes(1);
  });

  it("enables only GPT Image 2 for OpenAI discovery without enabling General", async () => {
    const defaultConfig = providerConfig({
      apiKeySaved: true,
      discoveredModels: [
        { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
        { id: "gpt-4.1", providerKind: "openai" }
      ],
      lastModelDiscoveryAt: now
    });
    await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id
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
    expect(inputByLabel("Stream partial preview").checked).toBe(false);
    expect(inputByLabel("Partial images").value).toBe("0");

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

  it("keeps the job progress listener stable when partial images arrive", async () => {
    const bridge = await renderApp(snapshot());
    const firstHandler = vi.mocked(bridge.onJobEvent).mock.calls[0]?.[0];
    expect(firstHandler).toBeTruthy();

    await act(async () => {
      firstHandler?.({ jobId: "partial-job", type: "partial", image: imageAsset("partial_1.png", "partial-job") });
      await Promise.resolve();
    });
    await act(async () => {
      firstHandler?.({ jobId: "partial-job", type: "partial", image: imageAsset("partial_2.png", "partial-job") });
      await Promise.resolve();
    });

    expect(bridge.onJobEvent).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".partial-strip button")).toHaveLength(2);
    expect(document.body.textContent).toContain("Partial image 2 received.");
  });

  it("uses transient run previews without refreshing the full snapshot", async () => {
    const bridge = await renderApp(snapshot());
    const initialSnapshotReads = vi.mocked(bridge.getSnapshot).mock.calls.length;
    const transientDataUrl = "data:image/png;base64,ZmFrZQ==";
    vi.mocked(bridge.runJob).mockImplementationOnce(async (request) => {
      const result = jobFromRequest(request, providerConfig());
      return {
        ...result,
        outputs: result.outputs.map((asset) => ({
          ...asset,
          transientPreview: {
            dataUrl: transientDataUrl
          }
        }))
      };
    });

    await click(buttonByText("Generate", ".primary-run"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.clearDraft).toHaveBeenCalledTimes(1);
    expect(bridge.getSnapshot).toHaveBeenCalledTimes(initialSnapshotReads);
    expect(document.querySelector<HTMLImageElement>(".preview-image-frame img")?.src).toBe(transientDataUrl);
    const historyImage = document.querySelector<HTMLImageElement>(".history-preview img");
    expect(historyImage?.src).toContain("image2tools-asset://image?path=");
    expect(historyImage?.src).not.toContain("data:image");
  });

  it("shows generation elapsed status in the editor while a job is pending", async () => {
    const bridge = await renderApp(snapshot());
    let resolveJob: ((job: GenerationJob) => void) | null = null;
    vi.mocked(bridge.runJob).mockImplementationOnce((request) => new Promise<GenerationJob>((resolve) => {
      resolveJob = (job) => {
        resolve(job);
      };
    }));

    await click(buttonByText("Generate", ".primary-run"));

    expect(document.querySelector(".generation-status-overlay")?.textContent).toContain("Generating image, elapsed 0 seconds");
    const request = vi.mocked(bridge.runJob).mock.calls[0]?.[0];
    expect(request).toBeTruthy();

    await act(async () => {
      resolveJob?.(jobFromRequest(request!, providerConfig()));
      await Promise.resolve();
    });
    await flushAsync();
  });

  it("enables OpenAI General prompt-only fallback for non-focused image models", async () => {
    const defaultConfig = providerConfig({
      apiKeySaved: true,
      discoveredModels: [
        { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
        { id: "dall-e-3", providerKind: "openai" }
      ],
      lastModelDiscoveryAt: now
    });
    const bridge = await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id
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

  it("enables discovered Nano Banana 3 models on OpenAI-compatible access", async () => {
    const defaultConfig = providerConfig({
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
    });
    const bridge = await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id
      })
    );

    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(launchButton("Nano Banana 3").disabled).toBe(false);

    await click(launchButton("Nano Banana 3"));
    await changeSelect(selectByLabel("Aspect ratio"), "4:3");
    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: NANO_BANANA_3_MODEL_ID,
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: NANO_BANANA_3_MODEL_ID
    }));
    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          providerKind: "gemini",
          launchId: NANO_BANANA_3_LAUNCH_ID,
          model: NANO_BANANA_3_MODEL_ID,
          aspectRatio: "4:3"
        })
      })
    );
  });

  it("keeps the single API config path working", async () => {
    const bridge = await renderApp(snapshot());

    expect(document.body.textContent).toContain("API config");
    expect(document.body.textContent).toContain("OpenAI · api.openai.com/v1");
    expect(document.body.textContent).toContain("Key saved · 1 model discovered");

    await click(apiAccessCurrentButton());
    await changeInput(inputByLabel("API config name"), "Primary gateway");
    await click(buttonByText("Save"));
    await flushAsync();

    expect(bridge.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ name: "Primary gateway" }));
    expect(buttonByText("Saved", ".api-config-detail button")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Saved key:");
    await openSavedApiAccess();
    expect(document.querySelectorAll(".api-config-card").length).toBe(1);
    expect(document.body.textContent).toContain("Primary gateway");
    expect(document.body.textContent).toContain("Current API config");
  });

  it("adds a second API config and switches to it automatically", async () => {
    const bridge = await renderApp(snapshot());

    await openSavedApiAccess();
    await click(buttonByText("Add API config"));
    const addForm = apiAccessAddForm();
    await changeSelect(selectByLabel("API type", addForm), "gemini");
    await changeInput(inputByLabel("API config name", addForm), "Gemini gateway");
    await changeInput(inputByLabel("API Key", addForm), "gemini-test-key");
    await click(buttonByText("Add API config", ".api-access-add-form button"));

    expect(bridge.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "gemini",
        name: "Gemini gateway",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        activeLaunchId: NANO_BANANA_3_LAUNCH_ID
      })
    );
    expect(document.body.textContent).toContain("Gemini gateway");
    expect(document.querySelectorAll(".api-config-card").length).toBe(2);
    expect(document.body.textContent).toContain("Current API config");
    expect(buttonByText("Nano Banana 3", ".launch-button").disabled).toBe(true);
  });

  it("adds an API config without a key and leaves it untested", async () => {
    const bridge = await renderApp(snapshot());
    vi.mocked(bridge.testConnection).mockClear();

    await openSavedApiAccess();
    await click(buttonByText("Add API config"));
    const addForm = apiAccessAddForm();
    await changeSelect(selectByLabel("API type", addForm), "custom");
    await changeInput(inputByLabel("API config name", addForm), "Custom gateway");
    await changeInput(inputByLabel("Base URL", addForm), "https://gateway.example.com/v1");
    await click(buttonByText("Add API config", ".api-access-add-form button"));

    expect(bridge.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "custom",
        name: "Custom gateway",
        apiKey: undefined,
        baseURL: "https://gateway.example.com/v1"
      })
    );
    expect(bridge.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Custom gateway");
    expect(document.body.textContent).toContain("No key saved");
    expect(buttonByText("GPT Image 2", ".launch-button").disabled).toBe(true);
  });

  it("switches API config and derives launch availability from the selected config discovery", async () => {
    const openaiConfig = providerConfig({ id: "openai-access", name: "OpenAI access" });
    const geminiConfig = providerConfig({
      id: "gemini-access",
      kind: "gemini",
      name: "Gemini access",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: NANO_BANANA_3_MODEL_ID,
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: NANO_BANANA_3_MODEL_ID,
      discoveredModels: [{ id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" }]
    });
    const bridge = await renderApp(snapshot({ providers: [openaiConfig, geminiConfig], activeProviderId: openaiConfig.id }));

    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(launchButton("Nano Banana 3").disabled).toBe(true);

    await openSavedApiAccess();
    await click(apiConfigCardMainByText("Gemini access"));

    expect(inputByLabel("API config name").value).toBe("Gemini access");
    expect(bridge.switchProvider).not.toHaveBeenCalled();

    await click(apiConfigUseButtonByText("Gemini access"));

    expect(bridge.saveDraft).toHaveBeenCalled();
    expect(bridge.switchProvider).toHaveBeenCalledWith("gemini-access");
    expect(launchButton("GPT Image 2").disabled).toBe(true);
    expect(launchButton("Nano Banana 3").disabled).toBe(false);
  });

  it("discovers models from a saved API config card and shows the model list in details", async () => {
    const openaiConfig = providerConfig({ id: "openai-access", name: "OpenAI access" });
    const geminiConfig = providerConfig({
      id: "gemini-access",
      kind: "gemini",
      name: "Gemini access",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      discoveredModels: []
    });
    const bridge = await renderApp(snapshot({ providers: [openaiConfig, geminiConfig], activeProviderId: openaiConfig.id }));
    vi.mocked(bridge.discoverModels).mockResolvedValueOnce({
      ...geminiConfig,
      discoveredModels: [
        { id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" },
        { id: GEMINI_3_PRO_IMAGE_MODEL_ID, providerKind: "gemini", displayName: "Gemini 3 Pro Image" }
      ],
      lastModelDiscoveryAt: now
    });

    await openSavedApiAccess();
    await click(apiConfigDiscoverButtonByText("Gemini access"));
    await flushAsync();
    await click(apiConfigCardMainByText("Gemini access"));

    expect(bridge.discoverModels).toHaveBeenCalledWith("gemini-access");
    expect(apiConfigCardByText("Gemini access").textContent).toContain("2 models discovered");
    expect(apiConfigCardByText("Gemini access").getAttribute("title")).toContain(NANO_BANANA_3_MODEL_ID);
    expect(document.body.textContent).toContain("Gemini 3 Pro Image");
  });

  it("keeps prompt and references when switching API config", async () => {
    const openaiConfig = providerConfig({ id: "openai-access", name: "OpenAI access" });
    const geminiConfig = providerConfig({
      id: "gemini-access",
      kind: "gemini",
      name: "Gemini access",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: NANO_BANANA_3_MODEL_ID,
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: NANO_BANANA_3_MODEL_ID,
      discoveredModels: [{ id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" }]
    });
    const gallery = galleryAsset("switch-reference.png");
    const bridge = await renderApp(snapshot({
      providers: [openaiConfig, geminiConfig],
      activeProviderId: openaiConfig.id,
      galleryAssets: [gallery]
    }));

    await changeTextArea(textAreaByLabel("Prompt"), "Keep this prompt");
    await openGalleryRail();
    await contextMenu(document.querySelector<HTMLElement>(".gallery-item")!);
    await click(elementByText("Choose from Gallery", ".context-menu-item"));
    expect(document.querySelector(".asset-tile")?.textContent).toContain("switch-reference.png");

    await openSavedApiAccess();
    await click(apiConfigUseButtonByText("Gemini access"));

    expect(bridge.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Keep this prompt",
      inputAssets: [expect.objectContaining({ name: "switch-reference.png" })]
    }));
    expect(textAreaByLabel("Prompt").value).toBe("Keep this prompt");
    expect(document.querySelector(".asset-tile")?.textContent).toContain("switch-reference.png");
  });

  it("deletes inactive API config without changing the active workspace", async () => {
    const openaiConfig = providerConfig({ id: "openai-access", name: "OpenAI access" });
    const geminiConfig = providerConfig({
      id: "gemini-access",
      kind: "gemini",
      name: "Gemini access",
      baseURL: "https://generativelanguage.googleapis.com/v1beta"
    });
    const bridge = await renderApp(snapshot({ providers: [openaiConfig, geminiConfig], activeProviderId: openaiConfig.id }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await openSavedApiAccess();
    await click(apiConfigDeleteButtonByText("Gemini access"));

    expect(bridge.deleteProvider).toHaveBeenCalledWith("gemini-access");
    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Gemini access");
  });

  it("deletes active API config and switches to the remaining config", async () => {
    const openaiConfig = providerConfig({ id: "openai-access", name: "OpenAI access" });
    const geminiConfig = providerConfig({
      id: "gemini-access",
      kind: "gemini",
      name: "Gemini access",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: NANO_BANANA_3_MODEL_ID,
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: NANO_BANANA_3_MODEL_ID,
      discoveredModels: [{ id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" }]
    });
    const bridge = await renderApp(snapshot({ providers: [openaiConfig, geminiConfig], activeProviderId: geminiConfig.id }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await click(apiAccessCurrentButton());
    const activeDeleteButton = [...document.querySelectorAll<HTMLButtonElement>(".api-config-detail button")].find((button) => button.title === "Delete API config")!;
    await click(activeDeleteButton);

    expect(bridge.saveDraft).toHaveBeenCalled();
    expect(bridge.deleteProvider).toHaveBeenCalledWith("gemini-access");
    expect(document.body.textContent).toContain("OpenAI access");
    expect(launchButton("GPT Image 2").disabled).toBe(false);
  });

  it("creates, searches, applies, and deletes prompt templates", async () => {
    const bridge = await renderApp(snapshot());

    await openTemplateDialog();
    await changeInput(inputByLabel("Title"), "Product shot");
    await changeTextArea(textAreaByLabel("Template prompt"), "A crisp product shot on a steel table");
    await click(buttonByText("Save template"));

    expect(bridge.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Product shot",
        body: "A crisp product shot on a steel table",
        tags: []
      }),
      undefined
    );
    expect(document.body.textContent).toContain("Product shot");
    expect(document.querySelector(".template-toolbar select")).toBeNull();

    await changeInput(inputByPlaceholder("Search templates"), "steel");
    expect(document.body.textContent).toContain("Product shot");

    await click(document.querySelector<HTMLButtonElement>('.template-actions button[aria-label="Use template"]')!);
    expect(textAreaByLabel("Prompt").value).toBe("A crisp product shot on a steel table");
    expect(bridge.saveDraft).toHaveBeenCalled();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click(document.querySelector<HTMLButtonElement>('.template-actions button[aria-label="Delete"]')!);
    expect(bridge.deleteTemplate).toHaveBeenCalledWith("template-1");
    expect(document.body.textContent).not.toContain("Product shot");
  });

  it("imports and exports prompt templates from the prompt template dialog", async () => {
    const bridge = await renderApp(snapshot({
      promptTemplates: [
        {
          id: "template-export",
          title: "Exportable",
          body: "export body",
          tags: [],
          createdAt: now,
          updatedAt: now
        }
      ]
    }));

    await openTemplateDialog();
    await click(document.querySelector<HTMLButtonElement>('.template-toolbar button[aria-label="Import templates"]')!);

    expect(bridge.importTemplates).toHaveBeenCalled();
    expect(bridge.listTemplates).toHaveBeenCalled();
    expect(document.body.textContent).toContain("0 templates imported");

    await click(document.querySelector<HTMLButtonElement>('.template-toolbar button[aria-label="Export templates"]')!);

    expect(bridge.exportTemplates).toHaveBeenCalledWith();
    expect(document.body.textContent).toContain("Templates exported to /tmp/templates.json");
  });

  it("opens a Gallery image in the editor from the thumbnail", async () => {
    const asset = galleryAsset("gallery-preview.png", { tags: ["product"] });
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    const thumbnailImage = document.querySelector<HTMLImageElement>(".gallery-thumb img")!;
    expect(thumbnailImage.getAttribute("loading")).toBe("lazy");
    expect(thumbnailImage.getAttribute("decoding")).toBe("async");
    expect(thumbnailImage.getAttribute("src")).toContain("&thumb=1&");
    await click(document.querySelector<HTMLButtonElement>(".gallery-thumb")!);

    expect(bridge.pickGalleryAsset).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLImageElement>(".preview-image-frame img")?.src).toContain(`image2tools-asset://image?gallery=${asset.fileName}`);
    expect(document.querySelector<HTMLImageElement>(".preview-image-frame img")?.src).not.toContain("thumb=1");
    expect(document.body.textContent).toContain("gallery-preview.png opened in the editor.");
    expect(document.querySelector(".notice-area")?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector(".notice-area")?.getAttribute("aria-atomic")).toBe("true");

    const previewOpener = document.querySelector<HTMLElement>(".preview-image-frame img")!;
    previewOpener.focus();
    expect(document.activeElement).toBe(previewOpener);
    await keyDown(previewOpener, "Enter");
    await flushAsync();

    const previewDialog = document.querySelector<HTMLElement>(".preview-modal-dialog")!;
    const previewClose = document.querySelector<HTMLButtonElement>(".preview-modal-close")!;
    expect(previewDialog.getAttribute("aria-modal")).toBe("true");
    expect(previewDialog.getAttribute("aria-labelledby")).toBe("preview-modal-title");
    expect(document.querySelector("#preview-modal-title")?.textContent).toBe("Image preview");
    expect(document.activeElement).toBe(previewClose);

    await keyDown(previewDialog, "Escape");
    await flushAsync();

    expect(document.querySelector(".preview-modal-dialog")).toBeNull();
    expect(document.activeElement).toBe(previewOpener);
  });

  it("picks a Gallery image as a reference asset from the context menu", async () => {
    const asset = galleryAsset("gallery-product.png", { tags: ["product"] });
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    await contextMenu(document.querySelector<HTMLElement>(".gallery-item")!);
    expect(elementByText("Choose from Gallery", ".context-menu-item").tagName).toBe("BUTTON");
    expect(elementByText("Choose from Gallery", ".context-menu-item").getAttribute("role")).toBe("menuitem");
    await click(elementByText("Choose from Gallery", ".context-menu-item"));

    expect(bridge.pickGalleryAsset).toHaveBeenCalledWith(asset.id);
    expect(document.body.textContent).toContain("gallery-product.png added as a reference.");
    expect(document.querySelector(".asset-tile")?.textContent).toContain("gallery-product.png");
    expect(document.querySelector<HTMLImageElement>(".asset-tile img")?.src).toBe(`image2tools-asset://image?gallery=${asset.fileName}`);

    await click(document.querySelector<HTMLButtonElement>(".primary-run")!);

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "edit",
        inputPaths: [`/tmp/gallery/${asset.fileName}`]
      })
    );
  });

  it("drags a Gallery image from the right rail into the reference area", async () => {
    const asset = galleryAsset("gallery-drag.png", { tags: ["product"] });
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await click(buttonByText("Image to image", ".mode-tab"));
    await openGalleryRail();

    const dragTransfer = dataTransferStub();
    await dispatchDragEvent(document.querySelector<HTMLButtonElement>(".gallery-thumb")!, "dragstart", dragTransfer);
    expect(dragTransfer.setData).toHaveBeenCalledWith("application/x-image2tools-gallery-id", asset.id);

    const dropTransfer = dataTransferStub({ "application/x-image2tools-gallery-id": asset.id });
    await dispatchDragEvent(document.querySelector<HTMLElement>(".reference-grid")!, "drop", dropTransfer);

    expect(bridge.pickGalleryAsset).toHaveBeenCalledWith(asset.id);
    expect(document.querySelector(".asset-tile")?.textContent).toContain("gallery-drag.png");
  });

  it("keeps plain text prompt submissions unchanged", async () => {
    const bridge = await renderApp(snapshot());

    await changeTextArea(textAreaByLabel("Prompt"), "Plain prompt only");
    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Plain prompt only",
        inputPaths: []
      })
    );
  });

  it("serializes Gallery and template prompt chips before running", async () => {
    const gallery = galleryAsset("chip-gallery.png");
    const template = {
      id: "template-chip",
      title: "Studio light",
      body: "softbox lighting",
      tags: ["studio"],
      createdAt: now,
      updatedAt: now
    };
    const bridge = await renderApp(snapshot({ galleryAssets: [gallery], promptTemplates: [template] }));

    await changeTextArea(textAreaByLabel("Prompt"), "Product hero");
    await changeTextArea(textAreaByLabel("Prompt"), "Product hero @chip");
    await keyDown(textAreaByLabel("Prompt"), "Enter");
    await changeTextArea(textAreaByLabel("Prompt"), `${textAreaByLabel("Prompt").value} ~studio`);
    await keyDown(textAreaByLabel("Prompt"), "Enter");

    expect(bridge.pickGalleryAsset).toHaveBeenCalledWith(gallery.id);
    expect(document.body.textContent).toContain("@ chip-gallery.png");
    expect(document.body.textContent).toContain("~ Studio light");

    await click(document.querySelector<HTMLButtonElement>(".primary-run")!);

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "edit",
        prompt: "Product hero\n\nsoftbox lighting",
        inputPaths: [`/tmp/gallery/${gallery.fileName}`]
      })
    );
  });

  it("removes prompt chips and saves serialized draft content", async () => {
    const openaiConfig = providerConfig({ id: "openai-access", name: "OpenAI access" });
    const geminiConfig = providerConfig({
      id: "gemini-access",
      kind: "gemini",
      name: "Gemini access",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: NANO_BANANA_3_MODEL_ID,
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: NANO_BANANA_3_MODEL_ID,
      discoveredModels: [{ id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" }]
    });
    const gallery = galleryAsset("draft-gallery.png");
    const template = {
      id: "template-draft",
      title: "Draft template",
      body: "serialized template body",
      tags: ["draft"],
      createdAt: now,
      updatedAt: now
    };
    const bridge = await renderApp(snapshot({
      providers: [openaiConfig, geminiConfig],
      activeProviderId: openaiConfig.id,
      galleryAssets: [gallery],
      promptTemplates: [template]
    }));
    const promptInput = textAreaByLabel("Prompt");

    await changeTextArea(promptInput, "Product hero @draft");
    await keyDown(promptInput, "Enter");
    await changeTextArea(promptInput, `${promptInput.value} ~draft`);
    await keyDown(promptInput, "Enter");

    expect(document.body.textContent).toContain("@ draft-gallery.png");
    expect(document.body.textContent).toContain("~ Draft template");

    await click(document.querySelector<HTMLButtonElement>(".prompt-chip")!);
    expect(document.body.textContent).not.toContain("@ draft-gallery.png");

    await openSavedApiAccess();
    await click(apiConfigUseButtonByText("Gemini access"));

    expect(bridge.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Product hero\n\nserialized template body",
      inputAssets: []
    }));
  });

  it("creates prompt chips from @ and ~ triggers in the prompt input", async () => {
    const gallery = galleryAsset("trigger-gallery.png");
    const template = {
      id: "template-trigger",
      title: "Trigger template",
      body: "cinematic backlight",
      tags: ["cinematic"],
      createdAt: now,
      updatedAt: now
    };
    const bridge = await renderApp(snapshot({ galleryAssets: [gallery], promptTemplates: [template] }));
    const promptInput = textAreaByLabel("Prompt");

    await changeTextArea(promptInput, "Product hero @trigger");
    expect(document.body.textContent).toContain("trigger-gallery.png");
    await keyDown(promptInput, "Enter");

    await changeTextArea(promptInput, `${promptInput.value} ~trigger`);
    expect(document.body.textContent).toContain("Trigger template");
    await keyDown(promptInput, "Enter");

    expect(bridge.pickGalleryAsset).toHaveBeenCalledWith(gallery.id);
    expect(document.body.textContent).toContain("@ trigger-gallery.png");
    expect(document.body.textContent).toContain("~ Trigger template");

    await click(document.querySelector<HTMLButtonElement>(".primary-run")!);

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "edit",
        prompt: "Product hero\n\ncinematic backlight",
        inputPaths: [`/tmp/gallery/${gallery.fileName}`]
      })
    );
  });

  it("creates a color prompt chip with keyboard navigation", async () => {
    const bridge = await renderApp(snapshot());
    const promptInput = textAreaByLabel("Prompt");

    await changeTextArea(promptInput, "Product hero #");
    expect(document.querySelector('[role="listbox"][aria-label="# Color"]')).toBeTruthy();
    await keyDown(promptInput, "ArrowDown");
    await keyDown(promptInput, "Enter");

    expect(document.body.textContent).toContain("#FF6600");

    await click(document.querySelector<HTMLButtonElement>(".primary-run")!);

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Product hero\n\n#FF6600"
      })
    );
  });

  it("filters @ Gallery prompt chips by the active Gallery folder and search", async () => {
    const productFolder = galleryFolder("Product refs");
    const matching = galleryAsset("folder-match.png", { folderId: productFolder.id, tags: ["hero"] });
    const wrongFolder = galleryAsset("folder-miss.png", { tags: ["hero"] });
    const wrongName = galleryAsset("name-miss.png", { folderId: productFolder.id, tags: ["hero"] });
    const bridge = await renderApp(snapshot({
      galleryFolders: [productFolder],
      galleryAssets: [matching, wrongFolder, wrongName]
    }));
    const promptInput = textAreaByLabel("Prompt");

    await openGalleryRail();
    await selectGalleryFolder("Product refs");
    await changeInput(inputByPlaceholder("Search Gallery"), "folder-match");

    await changeTextArea(promptInput, "Product hero @");
    expect(document.body.textContent).toContain("folder-match.png");
    expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain("folder-miss.png");
    expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain("name-miss.png");
    await keyDown(promptInput, "Enter");

    expect(bridge.pickGalleryAsset).toHaveBeenCalledWith(matching.id);
    expect(document.body.textContent).toContain("@ folder-match.png");
  });

  it("adds a history result to a selected Gallery folder", async () => {
    const folder = galleryFolder("History picks");
    const result = imageAsset("history-result.png");
    const job = geminiJob(0, { outputs: [result] });
    const bridge = await renderApp(snapshot({ history: [job], galleryFolders: [folder] }));

    await click(buttonByText("Add to Gallery", ".history-action-button"));
    await click(buttonByText("History picks", ".history-gallery-target-menu button"));

    expect(bridge.addHistoryAssetToGallery).toHaveBeenCalledWith(result.path, folder.id, ["Generate"]);
    expect(document.body.textContent).toContain("Added to Gallery.");

    await openGalleryRail();
    expect(document.body.textContent).toContain("history.png");
  });

  it("marks a history result as already in Gallery only when provenance matches", async () => {
    const linkedResult = imageAsset("already.png", "job_gemini_0");
    const unrelatedResult = imageAsset("already.png", "job_gemini_1");
    const linkedJob = geminiJob(0, { outputs: [linkedResult] });
    const unrelatedJob = geminiJob(1, { outputs: [unrelatedResult] });
    const linked = galleryAsset("linked.png", {
      source: "result",
      originalName: linkedResult.fileName,
      sourceJobId: linkedJob.id
    });
    await renderApp(snapshot({ history: [linkedJob, unrelatedJob], galleryAssets: [linked] }));

    const buttons = [...document.querySelectorAll<HTMLElement>(".history-gallery-menu-button")];
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((button) => button.classList.contains("already-in-gallery"))).toHaveLength(1);
    expect(document.querySelector(".history-gallery-check")).toBeTruthy();
  });

  it("edits History image names and user tags while keeping the mode system tag", async () => {
    const job = geminiJob(0, { name: "original-name.png", tags: ["draft"] });
    const bridge = await renderApp(snapshot({ history: [job] }));

    await click(buttonByText("original-name.png", ".history-name-button"));
    await changeInput(document.querySelector<HTMLInputElement>(".history-name-input")!, "renamed-history.png");
    await keyDown(document.querySelector<HTMLInputElement>(".history-name-input")!, "Enter");

    expect(bridge.updateHistoryJob).toHaveBeenCalledWith(job.id, { name: "renamed-history.png" });
    expect(document.body.textContent).toContain("History image renamed.");

    const tagRow = document.querySelector<HTMLElement>(".history-tag-row")!;
    const tagChips = [...tagRow.querySelectorAll<HTMLElement>(".history-chip")].map((chip) => chip.textContent);
    expect(tagChips).toEqual(["Generate", "draft", "Add tag"]);

    await click(document.querySelector<HTMLButtonElement>(".history-add-tag-button")!);
    expect(document.querySelector(".history-tag-popover")).not.toBeNull();
    await pointer(document.body, "pointerdown");
    expect(document.querySelector(".history-tag-popover")).toBeNull();

    await click(document.querySelector<HTMLButtonElement>(".history-add-tag-button")!);
    await changeInput(document.querySelector<HTMLInputElement>(".history-tag-popover input")!, "product");
    await click(document.querySelector<HTMLButtonElement>('.history-tag-popover button[aria-label="Save history tags"]')!);

    expect(bridge.updateHistoryJob).toHaveBeenCalledWith(job.id, { tags: ["draft", "product"] });
    expect(document.body.textContent).toContain("Generate");
    expect(document.body.textContent).toContain("draft");
    expect(document.body.textContent).toContain("product");
  });

  it("adds Gallery tags from the card popover and updates the visible filter state", async () => {
    const asset = galleryAsset("gallery-tags.png", { tags: ["old"] });
    const other = galleryAsset("gallery-other.png", { tags: ["draft"] });
    const bridge = await renderApp(snapshot({ galleryAssets: [asset, other] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>(".gallery-add-tag-button")!);
    await changeInput(document.querySelector<HTMLInputElement>(".gallery-tag-popover input")!, "hero");
    await click(document.querySelector<HTMLButtonElement>('.gallery-tag-popover button[aria-label="Save tags"]')!);

    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(asset.id, { tags: ["old", "hero"] });
    expect(document.body.textContent).toContain("Gallery tags updated.");
    expect(document.body.textContent).toContain("old");
    expect(document.body.textContent).toContain("hero");

    await changeSelect(document.querySelector<HTMLSelectElement>('select[aria-label="Gallery tag filter"]')!, "hero");
    expect(document.body.textContent).toContain("gallery-tags.png");
    expect(document.body.textContent).not.toContain("gallery-other.png");
  });

  it("creates Gallery folders, imports assets, then deletes folders back to Unsorted", async () => {
    const bridge = await renderApp(snapshot());

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Create folder"]')!);
    await changeInput(inputByLabel("Folder name", document.querySelector<HTMLElement>(".gallery-folder-dialog")!), "Product refs");
    await click(buttonByText("Create folder", ".gallery-folder-dialog button"));

    expect(bridge.createGalleryFolder).toHaveBeenCalledWith({ name: "Product refs", parentId: null });
    expect(document.body.textContent).toContain("Product refs");
    expect(document.body.textContent).toContain("No Gallery images yet.");

    await click(document.querySelector<HTMLButtonElement>(".rail-import-button")!);
    expect(bridge.importToGallery).toHaveBeenCalledWith(undefined, "folder-product-refs");
    expect(document.body.textContent).toContain("imported.png");

    await selectGalleryFolder("Product refs");
    expect(document.body.textContent).toContain("imported.png");

    const folderButton = await openGalleryFolderMenuItem("Product refs");
    await contextMenu(folderButton);
    await click(elementByText("Delete folder", ".context-menu-item"));

    expect(bridge.deleteGalleryFolder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Delete Gallery folder "Product refs"?');
    await click(buttonByText("Delete folder", ".confirm-dialog .danger-button"));

    expect(bridge.deleteGalleryFolder).toHaveBeenCalledWith("folder-product-refs");
    expect(document.body.textContent).toContain("Unsorted");
    expect(document.body.textContent).toContain("imported.png");
  });

  it("shows a canceled notice when Gallery import returns no assets", async () => {
    const bridge = await renderApp(snapshot());
    vi.mocked(bridge.importToGallery).mockResolvedValueOnce([]);

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>(".rail-import-button")!);

    expect(document.body.textContent).toContain("Gallery import canceled.");
    expect(document.body.textContent).not.toContain("0 images imported to Gallery.");
  });

  it("shows a clean duplicate Gallery folder error from Electron IPC", async () => {
    const bridge = await renderApp(snapshot());
    vi.mocked(bridge.createGalleryFolder).mockRejectedValueOnce(
      new Error("Error invoking remote method 'galleryFolders:create': Error: Gallery 文件夹名称已存在。")
    );

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Create folder"]')!);
    await changeInput(inputByLabel("Folder name", document.querySelector<HTMLElement>(".gallery-folder-dialog")!), "Product refs");
    await click(buttonByText("Create folder", ".gallery-folder-dialog button"));

    expect(document.body.textContent).toContain("A Gallery folder with this name already exists.");
    expect(document.body.textContent).not.toContain("Error invoking remote method");
    expect(document.querySelector(".gallery-folder-dialog")).toBeTruthy();
  });

  it("blocks duplicate Gallery folder names before calling IPC", async () => {
    const existing = galleryFolder("Product refs");
    const bridge = await renderApp(snapshot({ galleryFolders: [existing] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Create folder"]')!);
    await changeInput(inputByLabel("Folder name", document.querySelector<HTMLElement>(".gallery-folder-dialog")!), " product refs ");
    await click(buttonByText("Create folder", ".gallery-folder-dialog button"));

    expect(bridge.createGalleryFolder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("A Gallery folder with this name already exists.");
    expect(document.body.textContent).not.toContain("Error invoking remote method");
    expect(document.querySelector(".gallery-folder-dialog")).toBeTruthy();
  });

  it("shows the localized duplicate Gallery folder error in Chinese", async () => {
    window.localStorage.setItem("image2tools.language", "zh");
    const bridge = await renderApp(snapshot());
    vi.mocked(bridge.createGalleryFolder).mockRejectedValueOnce(
      new Error("Error: Error invoking remote method 'galleryFolders:create': Error: Gallery 文件夹名称已存在。")
    );

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>(".rail-new-folder-button")!);
    await changeInput(inputByLabel("文件夹名称", document.querySelector<HTMLElement>(".gallery-folder-dialog")!), "Product refs");
    await click(buttonByText("创建文件夹", ".gallery-folder-dialog button"));

    expect(document.body.textContent).toContain("图库文件夹名称已存在。");
    expect(document.body.textContent).not.toContain("Error invoking remote method");
    expect(document.querySelector(".gallery-folder-dialog")).toBeTruthy();
  });

  it("renders nested Gallery folders with a tree, compact sort control, and child creation target", async () => {
    const parent = galleryFolder("Products");
    const child = galleryFolder("Hero shots", { parentId: parent.id });
    const asset = galleryAsset("hero.png", { folderId: child.id });
    const bridge = await renderApp(snapshot({ galleryFolders: [parent, child], galleryAssets: [asset] }));

    await openGalleryRail();
    await click(buttonByText("Products", ".gallery-tree-folder-button"));
    await flushAsync();

    expect(document.querySelector(".gallery-breadcrumb")).toBeNull();
    expect(document.querySelector(".gallery-sort-trigger")?.textContent).toContain("Newest");
    expect(document.body.textContent).toContain("Hero shots");

    await click(buttonByText("Hero shots", ".gallery-tree-folder-button"));
    expect(document.querySelector(".gallery-breadcrumb")).toBeNull();
    expect(document.body.textContent).toContain("hero.png");

    await click(buttonByText("Products", ".gallery-tree-folder-button"));
    await click(document.querySelector<HTMLButtonElement>(".rail-new-folder-button")!);
    await changeInput(inputByLabel("Folder name", document.querySelector<HTMLElement>(".gallery-folder-dialog")!), "Campaign");
    await click(buttonByText("Create folder", ".gallery-folder-dialog button"));

    expect(bridge.createGalleryFolder).toHaveBeenLastCalledWith({ name: "Campaign", parentId: parent.id });
  });

  it("opens Gallery sort options from the compact sort button", async () => {
    await renderApp(snapshot({ galleryAssets: [galleryAsset("newest.png"), galleryAsset("oldest.png", { createdAt: new Date(1).toISOString() })] }));

    await openGalleryRail();
    expect(document.querySelector(".gallery-sort-menu")).toBeNull();
    await click(document.querySelector<HTMLButtonElement>(".gallery-sort-trigger")!);

    expect(document.querySelector(".gallery-sort-menu")?.textContent).toContain("Oldest");
    await click(buttonByText("Oldest", ".gallery-sort-menu button"));

    expect(document.querySelector(".gallery-sort-menu")).toBeNull();
    expect(document.querySelector(".gallery-sort-trigger")?.textContent).toContain("Oldest");
  });

  it("moves nested Gallery folders by dragging them into another folder", async () => {
    const parent = galleryFolder("Products");
    const target = galleryFolder("Archive");
    const child = galleryFolder("Hero shots", { parentId: parent.id });
    const bridge = await renderApp(snapshot({ galleryFolders: [parent, target, child] }));

    await openGalleryRail();
    await click(buttonByText("Products", ".gallery-tree-folder-button"));
    await flushAsync();
    const dragTransfer = dataTransferStub();
    await dispatchDragEvent(document.querySelector<HTMLElement>(".gallery-folder-entry")!, "dragstart", dragTransfer);
    await dispatchDragEvent(buttonByText("Archive", ".gallery-tree-folder-button").closest<HTMLElement>(".gallery-tree-row")!, "drop", dragTransfer);

    expect(bridge.moveGalleryFolder).toHaveBeenCalledWith(child.id, target.id);
  });

  it("deletes selected Gallery images in a batch", async () => {
    const asset = galleryAsset("batch-delete.png");
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Select batch-delete.png"]')).toBeNull();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Batch select"]')!);
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select batch-delete.png"]')!);
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Delete selected"]')!);

    expect(bridge.removeGalleryAsset).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Delete 1 selected Gallery item?");
    await click(buttonByText("Delete selected", ".confirm-dialog .danger-button"));

    expect(bridge.removeGalleryAsset).toHaveBeenCalledWith(asset.id);
    expect(document.body.textContent).toContain("Selected Gallery items deleted.");
  });

  it("keeps Gallery checkbox selections additive and applies batch tags", async () => {
    const first = galleryAsset("batch-tag-a.png", { tags: ["old"] });
    const second = galleryAsset("batch-tag-b.png");
    const bridge = await renderApp(snapshot({ galleryAssets: [first, second] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Batch select"]')!);
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select batch-tag-a.png"]')!);
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select batch-tag-b.png"]')!);

    expect(document.body.textContent).toContain("2 selected");

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Manage tags"]')!);
    await changeInput(document.querySelector<HTMLInputElement>('.batch-tag-new input[aria-label="New tag"]')!, "selected");
    await click(document.querySelector<HTMLButtonElement>('.batch-tag-new button[aria-label="Add tag"]')!);

    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(first.id, { tags: ["old", "selected"] });
    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(second.id, { tags: ["selected"] });
    expect(document.body.textContent).toContain("Selected tags updated.");
  });

  it("applies batch tags to selected History jobs", async () => {
    const first = geminiJob(0, { tags: ["old"] });
    const second = geminiJob(1, { tags: ["draft"], outputs: [imageAsset("history-b.png", "job_gemini_1")] });
    const bridge = await renderApp(snapshot({ history: [first, second] }));

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Batch select"]')!);
    const checkboxes = document.querySelectorAll<HTMLInputElement>(".history-entry-select");
    expect(checkboxes).toHaveLength(2);
    await click(checkboxes[0]!);
    await click(checkboxes[1]!);

    expect(document.body.textContent).toContain("2 selected");

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Manage tags"]')!);
    await changeInput(document.querySelector<HTMLInputElement>('.batch-tag-new input[aria-label="New tag"]')!, "review");
    await click(document.querySelector<HTMLButtonElement>('.batch-tag-new button[aria-label="Add tag"]')!);

    expect(bridge.updateHistoryJob).toHaveBeenCalledWith(first.id, { tags: ["old", "review"] });
    expect(bridge.updateHistoryJob).toHaveBeenCalledWith(second.id, { tags: ["draft", "review"] });
    expect(document.body.textContent).toContain("Selected tags updated.");
  });

  it("renames and deletes tags across History and Gallery from the tag manager", async () => {
    const job = geminiJob(0, { tags: ["draft"] });
    const asset = galleryAsset("tagged-gallery.png", { tags: ["draft", "asset-only"] });
    const bridge = await renderApp(snapshot({ history: [job], galleryAssets: [asset] }));

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Manage tags"]')!);
    const draftInput = [...document.querySelectorAll<HTMLInputElement>(".tag-manager-row input")]
      .find((input) => input.value === "draft")!;
    await changeInput(draftInput, "review");
    await click(draftInput.closest<HTMLElement>(".tag-manager-row")!.querySelector<HTMLButtonElement>('button[aria-label="Rename tag"]')!);
    await flushAsync();

    expect(bridge.updateHistoryJob).toHaveBeenCalledWith(job.id, { tags: ["review"] });
    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(asset.id, { tags: ["review", "asset-only"] });

    const assetOnlyInput = [...document.querySelectorAll<HTMLInputElement>(".tag-manager-row input")]
      .find((input) => input.value === "asset-only")!;
    await click(assetOnlyInput.closest<HTMLElement>(".tag-manager-row")!.querySelector<HTMLButtonElement>('button[aria-label="Delete tag"]')!);

    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(asset.id, { tags: ["review"] });
  });

  it("uses unified Library actions and single-button display toggles", async () => {
    const asset = galleryAsset("view-toggle.png");
    await renderApp(snapshot({ history: [geminiJob(0)], galleryAssets: [asset] }));

    let actionButtons = document.querySelectorAll<HTMLButtonElement>(".right-rail-action-group button");
    expect(actionButtons).toHaveLength(5);
    expect([...actionButtons].map((button) => button.getAttribute("aria-label"))).toEqual([
      "Grid view",
      "Library path settings",
      "Batch select",
      "Manage tags",
      "Clear all history records"
    ]);
    expect(Boolean(document.querySelector(".right-rail-summary")!.compareDocumentPosition(document.querySelector(".right-rail-action-group")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await click(actionButtons[0]);
    expect(document.querySelector(".history-list.grid")).toBeTruthy();
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="List view"]')).toBeTruthy();

    await openGalleryRail();
    actionButtons = document.querySelectorAll<HTMLButtonElement>(".right-rail-action-group button");
    expect(actionButtons).toHaveLength(5);
    expect([...actionButtons].map((button) => button.getAttribute("aria-label"))).toEqual([
      "List view",
      "Library path settings",
      "Batch select",
      "Manage tags",
      "Clear all Gallery items"
    ]);
    expect(document.querySelector(".gallery-entry-select")).toBeNull();

    await click(actionButtons[0]);
    expect(document.querySelector(".gallery-content-grid.list")).toBeTruthy();
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Grid view"]')).toBeTruthy();
  });

  it("opens the Gallery file context menu for file-specific actions", async () => {
    const asset = galleryAsset("context-file.png");
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    await contextMenu(document.querySelector<HTMLElement>(".gallery-item")!);
    expect(elementByText("Open folder", ".context-menu-item").tagName).toBe("BUTTON");
    expect(elementByText("Open folder", ".context-menu-item").getAttribute("role")).toBe("menuitem");
    await click(elementByText("Open folder", ".context-menu-item"));

    expect(bridge.openStorageFolder).toHaveBeenCalledWith("gallery", null);
  });

  it("copies image paths from History and Gallery card context menus", async () => {
    const result = imageAsset("copy-history.png");
    const job = geminiJob(0, { outputs: [result] });
    const asset = galleryAsset("Products/copy-gallery.png", { originalName: "copy-gallery.png" });
    await renderApp(snapshot({ history: [job], galleryAssets: [asset] }));

    await contextMenu(document.querySelector<HTMLElement>(".history-preview")!);
    await click(elementByText("Copy image path", ".context-menu-item"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(result.path);

    await openGalleryRail();
    await contextMenu(document.querySelector<HTMLElement>(".gallery-item")!);
    await click(elementByText("Copy image path", ".context-menu-item"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/tmp/crossgen/gallery/Products/copy-gallery.png");
  });

  it("renames a Gallery image from the file context menu", async () => {
    const asset = galleryAsset("rename-file.png");
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    await contextMenu(document.querySelector<HTMLElement>(".gallery-item")!);
    await click(elementByText("Rename image", ".context-menu-item"));
    const nameInput = document.querySelector<HTMLInputElement>(".gallery-name-input")!;
    await changeInput(nameInput, "renamed-file.png");
    await keyDown(nameInput, "Enter");

    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(asset.id, { originalName: "renamed-file.png" });
    expect(document.body.textContent).toContain("Gallery image renamed.");
    expect(document.body.textContent).toContain("renamed-file.png");
    expect(document.body.textContent).not.toContain("rename-file.png");
  });

  it("opens the current folder context menu from blank Gallery space", async () => {
    const folder = galleryFolder("Products");
    const bridge = await renderApp(snapshot({ galleryFolders: [folder] }));

    await openGalleryRail();
    await click(buttonByText("Products", ".gallery-tree-folder-button"));
    await contextMenu(document.querySelector<HTMLElement>(".gallery-empty-state")!);
    await click(elementByText("Create folder", ".context-menu-item"));
    await changeInput(inputByLabel("Folder name", document.querySelector<HTMLElement>(".gallery-folder-dialog")!), "Nested");
    await click(buttonByText("Create folder", ".gallery-folder-dialog button"));

    expect(bridge.createGalleryFolder).toHaveBeenLastCalledWith({ name: "Nested", parentId: folder.id });
  });

  it("virtualizes large Gallery folders instead of rendering every item at once", async () => {
    const assets = Array.from({ length: 80 }, (_, index) => galleryAsset(`virtual-${String(index).padStart(2, "0")}.png`));
    await renderApp(snapshot({ galleryAssets: assets }));

    await openGalleryRail();
    const grid = document.querySelector<HTMLElement>(".gallery-content-grid")!;

    expect(grid.dataset.totalCount).toBe("80");
    expect(Number(grid.dataset.renderedCount)).toBeLessThan(80);
    expect(document.querySelectorAll(".gallery-content-grid .gallery-item").length).toBe(Number(grid.dataset.renderedCount));
  });

  it("moves Gallery images by dragging them into a folder", async () => {
    const folder = galleryFolder("Product refs");
    const asset = galleryAsset("folder-drag.png");
    const bridge = await renderApp(snapshot({ galleryFolders: [folder], galleryAssets: [asset] }));

    await openGalleryRail();
    const dragTransfer = dataTransferStub();
    await dispatchDragEvent(document.querySelector<HTMLButtonElement>(".gallery-thumb")!, "dragstart", dragTransfer);
    const folderButton = await openGalleryFolderMenuItem("Product refs");
    await dispatchDragEvent(folderButton, "dragover", dragTransfer);
    await dispatchDragEvent(folderButton, "drop", dragTransfer);

    expect(bridge.moveGalleryAsset).toHaveBeenCalledWith(asset.id, folder.id);
    expect(document.body.textContent).toContain("Gallery image moved.");
  });

  it("moves multiple selected Gallery images by dragging the selection into a folder", async () => {
    const folder = galleryFolder("Batch target");
    const first = galleryAsset("batch-move-a.png");
    const second = galleryAsset("batch-move-b.png");
    const bridge = await renderApp(snapshot({ galleryFolders: [folder], galleryAssets: [first, second] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Batch select"]')!);
    const dragTransfer = dataTransferStub({
      "application/x-image2tools-gallery-selection": JSON.stringify({ assetIds: [first.id, second.id], folderIds: [] })
    });
    const folderButton = await openGalleryFolderMenuItem("Batch target");
    await dispatchDragEvent(folderButton, "drop", dragTransfer);

    expect(bridge.moveGalleryAsset).toHaveBeenCalledWith(first.id, folder.id);
    expect(bridge.moveGalleryAsset).toHaveBeenCalledWith(second.id, folder.id);
  });

  it("confirms before deleting a Gallery image", async () => {
    const asset = galleryAsset("gallery-delete.png");
    const bridge = await renderApp(snapshot({ galleryAssets: [asset], history: [geminiJob(0)] }));

    await openGalleryRail();
    expect(buttonByText("History", ".right-rail-tabs button")).toBeTruthy();
    await click(document.querySelector<HTMLButtonElement>('.gallery-actions button[aria-label="Delete"]')!);

    expect(document.body.textContent).toContain('Delete Gallery image "gallery-delete.png"?');
    expect(bridge.removeGalleryAsset).not.toHaveBeenCalled();

    await click(buttonByText("Cancel", ".confirm-dialog button"));
    await click(document.querySelector<HTMLButtonElement>('.gallery-actions button[aria-label="Delete"]')!);
    await click(buttonByText("Delete", ".confirm-dialog .danger-button"));

    expect(bridge.removeGalleryAsset).toHaveBeenCalledWith(asset.id);
    expect(document.body.textContent).not.toContain("gallery-delete.png");
    await click(buttonByText("History", ".right-rail-tabs button"));
    expect(document.querySelectorAll(".history-item")).toHaveLength(1);
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
    const bridge = await renderApp(snapshot({ providers: [geminiConfig], activeProviderId: geminiConfig.id, history: [geminiJob(0)] }));

    await click(apiAccessCurrentButton());
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

  it("passes the selected Nano Banana 3 aspect ratio through runJob", async () => {
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
    const bridge = await renderApp(snapshot({ providers: [geminiConfig], activeProviderId: geminiConfig.id }));

    await click(launchButton("Nano Banana 3"));
    await changeSelect(selectByLabel("Aspect ratio"), "1:1");
    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          providerKind: "gemini",
          launchId: NANO_BANANA_3_LAUNCH_ID,
          aspectRatio: "1:1"
        })
      })
    );
  });

  it("shows Gemini upload rights reminder beside reference tools", async () => {
    const defaultConfig = providerConfig({
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
    await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id
      })
    );

    // Reference tools (and the upload-rights reminder) live under the image-to-image tab now.
    await click(buttonByText("Image to image", ".mode-tab"));
    const addReferenceButton = document.querySelector<HTMLButtonElement>(".reference-add-button")!;
    expect(addReferenceButton.dataset.tooltip).toBe("Add local reference image");
    const referenceGrid = document.querySelector<HTMLElement>(".reference-grid");
    const reminder = document.querySelector<HTMLElement>(".reference-rights-reminder");
    expect(reminder?.textContent).toContain("Only upload images you have permission to use");
    expect(referenceGrid && reminder ? Boolean(referenceGrid.compareDocumentPosition(reminder) & Node.DOCUMENT_POSITION_FOLLOWING) : false).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Add as mask"]')?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Drag local images, History results, or Gallery images here.");
    expect(document.querySelector<HTMLButtonElement>('.input-panel button[aria-label="Clear"]')).toBeNull();
  });

  it("caps local reference images to the active model capability", async () => {
    const defaultConfig = providerConfig({
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
    const bridge = await renderApp(snapshot({ providers: [defaultConfig], activeProviderId: defaultConfig.id }));
    vi.mocked(bridge.selectImages).mockResolvedValueOnce([
      inputAsset("local-a.png"),
      inputAsset("local-b.png"),
      inputAsset("local-c.png")
    ]);

    await click(buttonByText("Image to image", ".mode-tab"));
    await click(document.querySelector<HTMLButtonElement>(".reference-add-button")!);
    await flushAsync();

    expect(document.querySelectorAll(".asset-tile")).toHaveLength(2);
    expect(document.body.textContent).toContain("The current model supports up to 2 reference images.");
    expect(document.querySelector(".reference-limit-toast")?.textContent).toContain("The current model supports up to 2 reference images.");

    vi.mocked(bridge.selectImages).mockClear();
    await click(document.querySelector<HTMLButtonElement>(".reference-add-button")!);

    expect(bridge.selectImages).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The current model supports up to 2 reference images.");
    expect(document.querySelector(".reference-limit-toast")?.textContent).toContain("The current model supports up to 2 reference images.");
  });

  it("enables Nano Banana 3 and Gemini General candidate without showing more than six collapsed history items", async () => {
    const defaultConfig = providerConfig({
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
    });
    await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id,
        history: Array.from({ length: 8 }, (_, index) => geminiJob(index))
      })
    );

    expect(launchButton("GPT Image 2").disabled).toBe(true);
    expect(launchButton("Nano Banana 3").disabled).toBe(false);
    expect(launchButton("General").disabled).toBe(false);
    expect(document.querySelectorAll(".history-item")).toHaveLength(6);
    expect(document.body.textContent).toContain("Show all");
    expect(document.body.textContent).toContain("Nano Banana 3");

    await click(buttonByText("Show all"));

    expect(document.querySelectorAll(".history-item")).toHaveLength(8);
    expect(document.body.textContent).toContain("Show fewer");
  });

  it("keeps prompt text and reference inputs while switching to incompatible General mode", async () => {
    const defaultConfig = providerConfig({
      apiKeySaved: true,
      discoveredModels: [
        { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" },
        { id: "dall-e-3", providerKind: "openai" }
      ],
      lastModelDiscoveryAt: now
    });
    const referenceAsset = galleryAsset("general-reference.png");
    const bridge = await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id,
        galleryAssets: [referenceAsset]
      })
    );
    const promptInput = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const originalPrompt = promptInput.value;
    vi.mocked(bridge.pickGalleryAsset).mockResolvedValueOnce({
      id: referenceAsset.id,
      name: referenceAsset.originalName,
      path: `/tmp/gallery/${referenceAsset.fileName}`,
      mimeType: referenceAsset.mimeType,
      sizeBytes: referenceAsset.sizeBytes,
      previewUrl: `image2tools-asset://image?gallery=${referenceAsset.fileName}`
    });

    await click(buttonByText("Image to image", ".mode-tab"));
    await openGalleryRail();
    await contextMenu(document.querySelector<HTMLElement>(".gallery-item")!);
    await click(elementByText("Choose from Gallery", ".context-menu-item"));
    await flushAsync();
    await click(launchButton("General"));

    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(originalPrompt);
    expect(document.body.textContent).toContain("general-reference.png");
    expect(document.querySelector<HTMLImageElement>(".asset-tile img")?.src).toBe(`image2tools-asset://image?gallery=${referenceAsset.fileName}`);
    expect(buttonByText("Generate", ".primary-run").disabled).toBe(true);
    expect(document.body.textContent).toContain("prompt-only generation");
    expect(bridge.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeLaunchId: "general",
        activeModelId: "dall-e-3"
      })
    );
  });

  it("keeps API config, launch buttons, parameters, and updates in a clear left-rail order", async () => {
    await renderApp(snapshot());
    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
    const configSection = sidebar.querySelector<HTMLElement>(".api-access-section")!;
    const launchSection = sidebar.querySelector<HTMLElement>(".launch-section")!;
    const parameterSection = buttonByText("Parameters", ".section-toggle").closest<HTMLElement>(".tool-section")!;
    const updatePanel = sidebar.querySelector<HTMLElement>(".sidebar-utility-bar")!;

    expect(configSection.textContent).toContain("API config");
    expect(launchSection.textContent).toContain("Launch");
    expect(parameterSection.textContent).toContain("Parameters");
    expect(updatePanel.textContent).toContain("0.1.0");
    expect(sidebar.querySelector(".template-sidebar-section")).toBeNull();
    expect(sidebar.querySelector(".draft-section")).toBeNull();
    expect(configSection.compareDocumentPosition(launchSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(launchSection.compareDocumentPosition(parameterSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(parameterSection.compareDocumentPosition(updatePanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers a persistent theme mode toggle in the left rail", async () => {
    await renderApp(snapshot());
    const themeButton = document.querySelector<HTMLButtonElement>(".theme-mode-button")!;

    expect(themeButton.getAttribute("aria-label")).toBe("Theme: System");
    expect(themeButton.querySelector("span")).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();

    await click(themeButton);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("image2tools.theme")).toBe("light");
    expect(themeButton.getAttribute("aria-label")).toBe("Theme: Light");

    await click(themeButton);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("image2tools.theme")).toBe("dark");
    expect(themeButton.getAttribute("aria-label")).toBe("Theme: Dark");

    await click(themeButton);
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(window.localStorage.getItem("image2tools.theme")).toBe("system");
    expect(themeButton.getAttribute("aria-label")).toBe("Theme: System");

    await click(document.querySelector<HTMLButtonElement>(".sidebar-collapse-button")!);
    expect(document.querySelector<HTMLButtonElement>('.sidebar-mini-utility button[aria-label="Theme: System"]')).toBeTruthy();
  });

  it("does not show the release guide automatically", async () => {
    await renderApp(snapshot());
    await flushAsync();

    expect(document.body.textContent).not.toContain("What's new in 0.1.0");
    expect(document.querySelector(".release-guide-dialog")).toBeNull();
  });

  it("uses a clear Chinese update failure label instead of an exception shorthand", async () => {
    window.localStorage.setItem("image2tools.language", "zh");
    const bridge = await renderApp(snapshot());
    vi.mocked(bridge.checkForUpdates).mockResolvedValueOnce({
      status: "error",
      currentVersion: "0.1.0",
      updateAvailable: false,
      checkedAt: now,
      message: "网络错误"
    });

    const checkButton = document.querySelector<HTMLButtonElement>(".sidebar-utility-bar .utility-check-button")!;
    expect(checkButton.getAttribute("aria-label")).toBe("检查最新版本");
    expect(checkButton.dataset.tooltip).toBe("检查最新版本");
    expect(checkButton.textContent).toBe("");

    await click(checkButton);
    await flushAsync();

    expect(document.querySelector<HTMLElement>(".version-status-badge")?.textContent).toBe("检查失败");
    expect(document.querySelector<HTMLElement>(".version-status-badge")?.textContent).not.toBe("异常");
  });

  it("supports keyboard resizing without losing fixed history layout", async () => {
    await renderApp(snapshot());
    const sidebarResizer = separatorByLabel("Resize sidebar");
    const historyResizer = separatorByLabel("Resize history");

    expect(sidebarResizer.getAttribute("aria-valuenow")).toBe("310");
    expect(historyResizer.getAttribute("aria-valuenow")).toBe("310");

    await keyDown(sidebarResizer, "ArrowRight");
    await keyDown(historyResizer, "ArrowLeft", { shiftKey: true });

    expect(sidebarResizer.getAttribute("aria-valuenow")).toBe("326");
    expect(historyResizer.getAttribute("aria-valuenow")).toBe("350");
    expect(window.localStorage.getItem("image2tools.sidebarWidth")).toBe("326");
    expect(window.localStorage.getItem("image2tools.historyWidth")).toBe("350");
  });

  it("auto-collapses side rails when dividers are dragged past their thresholds", async () => {
    await renderApp(snapshot());
    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    const sidebarResizer = separatorByLabel("Resize sidebar");
    const historyResizer = separatorByLabel("Resize history");
    sidebarResizer.setPointerCapture = vi.fn();
    historyResizer.setPointerCapture = vi.fn();

    await pointer(sidebarResizer, "pointerdown", { clientX: 310 });
    await windowPointer("pointermove", { clientX: 240 });

    expect(shell.classList.contains("sidebar-collapsed")).toBe(true);
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("76px");

    await pointer(historyResizer, "pointerdown", { clientX: 1130 });
    await windowPointer("pointermove", { clientX: 1160 });

    expect(shell.classList.contains("right-rail-collapsed")).toBe(true);
    expect(shell.style.getPropertyValue("--history-width")).toBe("280px");
    expect(historyResizer.getAttribute("aria-disabled")).toBe("false");
    expect(historyResizer.getAttribute("aria-valuenow")).toBe("280");
  });

  it("keeps the workspace in the main grid when the sidebar is collapsed", async () => {
    await renderApp(snapshot());

    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    expect(shell.style.getPropertyValue("--sidebar-collapse-button-y")).toBeTruthy();
    expect(shell.style.getPropertyValue("--right-rail-collapse-button-y")).toBeTruthy();
    expect(shell.style.getPropertyValue("--rail-collapse-button-y")).toBe("");
    expect(document.querySelector(".sidebar-resizer")).toBeTruthy();
    expect(document.querySelector(".history-resizer")).toBeTruthy();
    expect(document.querySelector(".workspace")).toBeTruthy();

    await click(document.querySelector<HTMLButtonElement>(".sidebar-collapse-button")!);

    expect(shell.classList.contains("sidebar-collapsed")).toBe(true);
    expect(document.querySelector(".sidebar-resizer")).toBeTruthy();
    expect(document.querySelector(".workspace")).toBeTruthy();
    expect(document.querySelector(".history")).toBeTruthy();
    const compactStack = document.querySelector<HTMLElement>(".sidebar-mini-stack")!;
    expect(compactStack).toBeTruthy();
    expect(compactStack.querySelector('button[aria-label="API config"]')).toBeTruthy();
    expect(compactStack.querySelector('button[aria-label="Launch"]')).toBeTruthy();
    expect(compactStack.querySelector('button[aria-label="Parameters"]')).toBeTruthy();

    await click(document.querySelector<HTMLButtonElement>(".right-rail-collapse-button")!);

    expect(shell.classList.contains("right-rail-collapsed")).toBe(true);
    expect(shell.style.getPropertyValue("--history-width")).toBe("256px");
    expect(document.querySelector(".right-rail.collapsed")).toBeTruthy();
    expect(document.querySelector(".right-rail-drawer-toggle")).toBeTruthy();
  });

  it("keeps Gallery thumbnails rendered when the right rail is collapsed", async () => {
    const asset = galleryAsset("collapsed-gallery.png");
    await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>(".right-rail-collapse-button")!);

    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    const grid = document.querySelector<HTMLElement>(".gallery-content-grid")!;
    expect(shell.classList.contains("right-rail-collapsed")).toBe(true);
    expect(grid.dataset.totalCount).toBe("1");
    expect(grid.dataset.renderedCount).toBe("1");
    expect(document.querySelector(".right-rail.collapsed .gallery-thumb img")).toBeTruthy();
    expect(document.querySelector(".right-rail.collapsed .gallery-compact-controls")).toBeTruthy();
  });

  it("keeps collapsed Gallery thumbnails rendered while the right rail is dragged narrower", async () => {
    const assets = Array.from({ length: 12 }, (_, index) => galleryAsset(`collapsed-resize-${String(index).padStart(2, "0")}.png`));
    await renderApp(snapshot({ galleryAssets: assets }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>(".right-rail-collapse-button")!);
    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    const historyResizer = separatorByLabel("Resize history");
    historyResizer.setPointerCapture = vi.fn();

    await pointer(historyResizer, "pointerdown", { clientX: 1184 });
    await windowPointer("pointermove", { clientX: 1260 });
    await windowPointer("pointerup", { clientX: 1260 });

    const grid = document.querySelector<HTMLElement>(".gallery-content-grid")!;
    expect(shell.classList.contains("right-rail-collapsed")).toBe(true);
    expect(shell.style.getPropertyValue("--history-width")).toBe("180px");
    expect(shell.style.getPropertyValue("--right-rail-thumb-size")).toBe("132px");
    expect(historyResizer.getAttribute("aria-disabled")).toBe("false");
    expect(Number(grid.dataset.renderedCount)).toBeGreaterThan(0);
    expect(document.querySelector(".right-rail.collapsed .gallery-thumb img")).toBeTruthy();
  });

  it("keeps Gallery thumbnails rendered after collapsing from a deep Gallery scroll position", async () => {
    const assets = Array.from({ length: 80 }, (_, index) => galleryAsset(`collapsed-scrolled-${String(index).padStart(2, "0")}.png`));
    await renderApp(snapshot({ galleryAssets: assets }));

    await openGalleryRail();
    const grid = document.querySelector<HTMLElement>(".gallery-content-grid")!;
    grid.scrollTop = 100000;
    grid.dispatchEvent(new Event("scroll", { bubbles: true }));
    await flushAsync();
    await click(document.querySelector<HTMLButtonElement>(".right-rail-collapse-button")!);
    await flushAsync();

    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    expect(shell.classList.contains("right-rail-collapsed")).toBe(true);
    expect(Number(grid.dataset.renderedCount)).toBeGreaterThan(0);
    expect(grid.scrollTop).toBe(0);
    expect(document.querySelector(".right-rail.collapsed .gallery-thumb img")).toBeTruthy();
  });

  it("keeps compact controls and history from overflowing their layout contracts", async () => {
    const defaultConfig = providerConfig({
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
    });
    await renderApp(
      snapshot({
        providers: [defaultConfig],
        activeProviderId: defaultConfig.id,
        history: Array.from({ length: 10 }, (_, index) => geminiJob(index))
      })
    );

    expect(document.querySelector(".history-list")).toBeTruthy();
    expect(document.querySelector(".launch-button span")).toBeTruthy();
    expect(document.querySelector(".launch-button small")).toBeTruthy();
    expect(document.querySelectorAll(".history-item")).toHaveLength(6);
    expect(buttonByText("Show all")).toBeTruthy();
    expect(launchButton("General").textContent).toContain("Gemini image fallback with a very long display name");
  });

  it("requires confirmation before clearing all history", async () => {
    const bridge = await renderApp(snapshot({ history: [geminiJob(0), geminiJob(1)] }));
    const clearAllButton = document.querySelector<HTMLButtonElement>('button[aria-label="Clear all history records"]')!;

    expect(clearAllButton).toBeTruthy();
    await click(clearAllButton);

    expect(bridge.clearHistory).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Clear all history?");
    expect(document.body.textContent).toContain("This will delete all 2 history records");

    await click(buttonByText("Clear all", ".danger-button"));

    expect(bridge.clearHistory).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Clear all history?");
  });

  it("traps focus inside shared dialogs and returns focus to the opener", async () => {
    await renderApp(snapshot({ history: [geminiJob(0), geminiJob(1)] }));
    const clearAllButton = document.querySelector<HTMLButtonElement>('button[aria-label="Clear all history records"]')!;

    clearAllButton.focus();
    expect(document.activeElement).toBe(clearAllButton);
    await click(clearAllButton);
    await flushAsync();

    const dialog = document.querySelector<HTMLElement>(".confirm-dialog")!;
    const cancelButton = buttonByText("Cancel", ".confirm-dialog button");
    const confirmButton = buttonByText("Clear all", ".confirm-dialog button");

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(cancelButton);

    await keyDown(dialog, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(confirmButton);

    await keyDown(dialog, "Tab");
    expect(document.activeElement).toBe(cancelButton);

    await keyDown(dialog, "Escape");
    await flushAsync();

    expect(document.querySelector(".confirm-dialog")).toBeNull();
    expect(document.activeElement).toBe(clearAllButton);
  });

  it("can set History and Gallery storage to the same local path", async () => {
    const bridge = await renderApp(snapshot());
    const storageConfigButton = document.querySelector<HTMLButtonElement>('button[aria-label="Library path settings"]')!;

    await click(storageConfigButton);
    expect(document.body.textContent).toContain("Use the same path for History and Gallery");
    expect(document.body.textContent).toContain("History");
    expect(document.body.textContent).toContain("Gallery");
    const pathValues = document.querySelectorAll<HTMLElement>(".storage-path-value");
    expect(pathValues[0]?.dataset.tooltip).toBe("/tmp/crossgen/history");
    expect(pathValues[1]?.dataset.tooltip).toBe("/tmp/crossgen/gallery");

    await click(inputByLabel("Use the same path for History and Gallery"));
    expect(document.querySelectorAll<HTMLElement>(".storage-path-value")).toHaveLength(1);
    await click(buttonByText("Choose folder", ".storage-dialog button"));

    expect(bridge.chooseStorageFolder).toHaveBeenCalledWith("history", { syncBoth: true });
    expect(document.body.textContent).toContain("History and Gallery storage folders updated.");
  });

  it("renders Gemini results on the canvas and routes downloads through the bridge", async () => {
    const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
    const bridge = await renderApp(snapshot({ history: [job] }));

    await click(document.querySelector<HTMLButtonElement>(".history-preview")!);

    const result = document.querySelector<HTMLImageElement>('img[alt="Generated result"]');
    expect(result?.src).toContain("image2tools-asset://image?path=");

    const downloadButtons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Download"]')].filter((button) => !button.disabled);
    expect(downloadButtons.length).toBeGreaterThan(0);
    await click(downloadButtons[0]);

    expect(bridge.downloadAsset).toHaveBeenCalledWith({
      assetPath: "/tmp/image2tools/result_gemini.png",
      suggestedName: "result_gemini.png"
    });
  });

  it("switches preview edit and crop controls with active toggle buttons", async () => {
    const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
    await renderApp(snapshot({ history: [job] }));

    await click(document.querySelector<HTMLButtonElement>(".history-preview")!);

    const previewControls = document.querySelector<HTMLElement>(".preview-control-strip")!;
    expect(previewControls.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')?.dataset.tooltip).toBe("Edit");
    expect(previewControls.querySelector<HTMLButtonElement>('button[aria-label="Crop"]')?.dataset.tooltip).toBe("Crop");

    await click(previewControls.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!);

    const primaryActions = previewControls.querySelector<HTMLElement>(".preview-primary-actions")!;
    const secondaryActions = previewControls.querySelector<HTMLElement>(".preview-secondary-actions")!;
    expect(primaryActions.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')?.classList.contains("active")).toBe(true);
    expect(primaryActions.querySelector<HTMLButtonElement>('button[aria-label="Download"]')).toBeTruthy();
    expect(primaryActions.querySelector<HTMLButtonElement>('button[aria-label="Save to Gallery"]')).toBeTruthy();
    expect(secondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Pick color from image"]')).toBeTruthy();
    expect(secondaryActions.querySelector<HTMLElement>(".annotation-color-readout")?.textContent).toContain("#FF3B30");
    expect(secondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Text box"]')).toBeTruthy();
    expect(secondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Clear annotations"]')?.dataset.tooltip).toBe("Clear annotations");
    expect(secondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Download"]')).toBeNull();
    expect(secondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Save to Gallery"]')).toBeNull();

    await click(secondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Pick color from image"]')!);
    expect(document.querySelector(".annotation-canvas")?.classList.contains("eyedropper-mode")).toBe(true);

    await click(previewControls.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!);
    await click(previewControls.querySelector<HTMLButtonElement>('button[aria-label="Crop"]')!);

    const cropSecondaryActions = previewControls.querySelector<HTMLElement>(".preview-secondary-actions")!;
    expect(primaryActions.querySelector<HTMLButtonElement>('button[aria-label="Crop"]')?.classList.contains("active")).toBe(true);
    expect(cropSecondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Rectangle crop"]')).toBeTruthy();
    expect(cropSecondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Apply crop"]')).toBeTruthy();
    expect(cropSecondaryActions.querySelector<HTMLButtonElement>('button[aria-label="Save selected area to Gallery"]')).toBeTruthy();
    const cropActionLabels = [...cropSecondaryActions.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.getAttribute("aria-label"));
    expect(cropActionLabels.indexOf("Save selected area to Gallery")).toBeLessThan(cropActionLabels.indexOf("Apply crop"));
  });

  it("samples an annotation color from the active preview", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockCanvasContext({
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([18, 52, 86, 255]),
        colorSpace: "srgb",
        height: 1,
        width: 1
      } as ImageData))
    }) as unknown as CanvasRenderingContext2D);
    const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
    await renderApp(snapshot({ history: [job] }));

    await click(document.querySelector<HTMLButtonElement>(".history-preview")!);
    await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Edit"]')!);

    const previewImage = document.querySelector<HTMLImageElement>(".preview-image-frame > img, .zoom-surface img")!;
    Object.defineProperty(previewImage, "naturalWidth", { configurable: true, value: 100 });
    Object.defineProperty(previewImage, "naturalHeight", { configurable: true, value: 100 });
    const canvas = document.querySelector<HTMLCanvasElement>(".annotation-canvas")!;
    const frame = document.querySelector<HTMLElement>(".preview-image-frame")!;
    const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined };
    Object.defineProperty(frame, "getBoundingClientRect", { configurable: true, value: () => rect });
    Object.defineProperty(canvas, "getBoundingClientRect", { configurable: true, value: () => rect });

    await click(document.querySelector<HTMLButtonElement>('.preview-secondary-actions button[aria-label="Pick color from image"]')!);
    await pointer(canvas, "pointerdown", { clientX: 10, clientY: 10 });

    expect(document.querySelector<HTMLElement>(".annotation-color-readout")?.textContent).toContain("#123456");
    expect(document.body.textContent).toContain("Picked #123456.");
  });

  it("saves the edited preview to Gallery through the bridge", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockCanvasContext() as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmFrZQ==");
    const OriginalImage = window.Image;
    class MockImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(value: string) {
        this.#src = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    window.Image = MockImage as unknown as typeof Image;
    try {
      const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
      const bridge = await renderApp(snapshot({ history: [job] }));

      await click(document.querySelector<HTMLButtonElement>(".history-preview")!);
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Edit"]')!);
      await createPreviewTextAnnotation("Pinned label");
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Save to Gallery"]')!);
      await flushAsync();

      expect(bridge.addEditedImageToGallery).toHaveBeenCalledWith({
        dataUrl: "data:image/png;base64,ZmFrZQ==",
        originalName: "result_gemini-edited.png",
        folderId: null,
        tags: ["Generate"]
      });
    } finally {
      window.Image = OriginalImage;
    }
  });

  it("downloads the edited preview through the bridge", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockCanvasContext() as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmFrZQ==");
    const OriginalImage = window.Image;
    class MockImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(value: string) {
        this.#src = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    window.Image = MockImage as unknown as typeof Image;
    try {
      const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
      const bridge = await renderApp(snapshot({ history: [job] }));

      await click(document.querySelector<HTMLButtonElement>(".history-preview")!);
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Edit"]')!);
      await createPreviewTextAnnotation("Pinned label");
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Download edited image"]')!);
      await flushAsync();

      expect(bridge.downloadEditedImage).toHaveBeenCalledWith({
        dataUrl: "data:image/png;base64,ZmFrZQ==",
        suggestedName: "result_gemini-edited.png"
      });
    } finally {
      window.Image = OriginalImage;
    }
  });

  it("downloads the composited preview after leaving edit mode", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockCanvasContext() as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmFrZQ==");
    const OriginalImage = window.Image;
    class MockImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(value: string) {
        this.#src = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    window.Image = MockImage as unknown as typeof Image;
    try {
      const job = geminiJob(0, { outputs: [imageAsset("result_gemini.png")] });
      const bridge = await renderApp(snapshot({ history: [job] }));

      await click(document.querySelector<HTMLButtonElement>(".history-preview")!);
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Edit"]')!);
      await createPreviewTextAnnotation("Pinned label");
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Edit"]')!);
      await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Download edited image"]')!);
      await flushAsync();

      expect(bridge.downloadEditedImage).toHaveBeenCalledWith({
        dataUrl: "data:image/png;base64,ZmFrZQ==",
        suggestedName: "result_gemini-edited.png"
      });
      expect(bridge.downloadAsset).not.toHaveBeenCalled();
    } finally {
      window.Image = OriginalImage;
    }
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
  window.crossgen = bridge;
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
  delete window.crossgen;
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

  const activeConfig = () => currentSnapshot.providers.find(p => p.id === currentSnapshot.activeProviderId) ?? currentSnapshot.providers[0];
  const configById = (providerId?: string) => currentSnapshot.providers.find(p => p.id === providerId) ?? activeConfig();

  return {
    getSnapshot: vi.fn(async () => currentSnapshot),
    saveConfig: vi.fn(async (input) => {
      const config = configById(input.providerId);
      const nextConfig: ProviderConfig = {
        ...config,
        kind: input.kind ?? config.kind,
        name: input.name ?? config.name,
        baseURL: input.baseURL,
        defaultModel: input.defaultModel,
        defaultSize: input.defaultSize,
        defaultQuality: input.defaultQuality,
        timeoutMs: input.timeoutMs,
        streamingPartialsEnabled: input.streamingPartialsEnabled ?? config.streamingPartialsEnabled,
        activeLaunchId: input.activeLaunchId ?? config.activeLaunchId,
        activeModelId: input.activeModelId ?? config.activeModelId,
        apiKeySaved: config.apiKeySaved || Boolean(input.apiKey?.trim()),
        updatedAt: now
      };
      currentSnapshot = {
        ...currentSnapshot,
        providers: currentSnapshot.providers.map(p => p.id === config.id ? nextConfig : p)
      };
      return nextConfig;
    }),
    discoverModels: vi.fn(async (providerId?: string) => configById(providerId)),
    clearApiKey: vi.fn(async (providerId?: string) => {
      const config = configById(providerId);
      const nextConfig = { ...config, apiKeySaved: false, discoveredModels: [] };
      currentSnapshot = {
        ...currentSnapshot,
        providers: currentSnapshot.providers.map(p => p.id === config.id ? nextConfig : p)
      };
      return nextConfig;
    }),
    testConnection: vi.fn(async () => ({ ok: true, message: "ok" })),
    saveDraft: vi.fn(async (input) => ({ ...input, activeLaunchId: input.activeLaunchId ?? input.params.launchId, activeModelId: input.activeModelId ?? input.params.model, updatedAt: now }) as WorkspaceDraft),
    clearDraft: vi.fn(async () => undefined),
    listTemplates: vi.fn(async () => currentSnapshot.promptTemplates),
    saveTemplate: vi.fn(async (input, templateId) => {
      const existing = templateId ? currentSnapshot.promptTemplates.find((template) => template.id === templateId) : undefined;
      const template = {
        id: existing?.id ?? `template-${currentSnapshot.promptTemplates.length + 1}`,
        title: input.title.trim(),
        body: input.body.trim(),
        tags: input.tags ?? [],
        category: input.category,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      currentSnapshot = {
        ...currentSnapshot,
        promptTemplates: existing
          ? currentSnapshot.promptTemplates.map((item) => (item.id === existing.id ? template : item))
          : [template, ...currentSnapshot.promptTemplates]
      };
      return template;
    }),
    deleteTemplate: vi.fn(async (id) => {
      currentSnapshot = { ...currentSnapshot, promptTemplates: currentSnapshot.promptTemplates.filter((template) => template.id !== id) };
    }),
    importTemplates: vi.fn(async () => ({ imported: 0, skipped: 0 })),
    exportTemplates: vi.fn(async () => "/tmp/templates.json"),
    listGallery: vi.fn(async () => currentSnapshot.galleryAssets),
    listGalleryFolders: vi.fn(async () => currentSnapshot.galleryFolders),
    createGalleryFolder: vi.fn(async (input) => {
      const folder = galleryFolder(input.name, { parentId: input.parentId ?? null });
      currentSnapshot = { ...currentSnapshot, galleryFolders: [folder, ...currentSnapshot.galleryFolders] };
      return folder;
    }),
    renameGalleryFolder: vi.fn(async (id, input) => {
      const folder = currentSnapshot.galleryFolders.find((item) => item.id === id) ?? galleryFolder(input.name, { id });
      const updated = { ...folder, name: input.name.trim(), parentId: input.parentId ?? folder.parentId ?? null, updatedAt: now };
      currentSnapshot = { ...currentSnapshot, galleryFolders: currentSnapshot.galleryFolders.map((item) => item.id === id ? updated : item) };
      return updated;
    }),
    moveGalleryFolder: vi.fn(async (id, parentId) => {
      const folder = currentSnapshot.galleryFolders.find((item) => item.id === id)!;
      const updated = { ...folder, parentId, updatedAt: now };
      currentSnapshot = { ...currentSnapshot, galleryFolders: currentSnapshot.galleryFolders.map((item) => item.id === id ? updated : item) };
      return updated;
    }),
    deleteGalleryFolder: vi.fn(async (id) => {
      currentSnapshot = {
        ...currentSnapshot,
        galleryFolders: currentSnapshot.galleryFolders.filter((folder) => folder.id !== id),
        galleryAssets: currentSnapshot.galleryAssets.map((asset) => asset.folderId === id ? { ...asset, folderId: null, updatedAt: now } : asset)
      };
      return {
        folders: currentSnapshot.galleryFolders,
        assets: currentSnapshot.galleryAssets
      };
    }),
    importToGallery: vi.fn(async (_paths, folderId) => {
      const asset = galleryAsset("imported.png", { folderId: folderId ?? null });
      currentSnapshot = { ...currentSnapshot, galleryAssets: [asset, ...currentSnapshot.galleryAssets] };
      return [asset];
    }),
    addHistoryAssetToGallery: vi.fn(async (assetPath, folderId, tags) => {
      const source = currentSnapshot.history
        .flatMap((job) => job.outputs.map((asset) => ({ job, asset })))
        .find((item) => item.asset.path === assetPath);
      const asset = galleryAsset("history.png", {
        source: "result",
        folderId: folderId ?? null,
        tags: tags ?? source?.job.tags ?? [],
        sourceJobId: source?.job.id,
        sourceAssetId: source?.asset.id
      });
      currentSnapshot = { ...currentSnapshot, galleryAssets: [asset, ...currentSnapshot.galleryAssets] };
      return asset;
    }),
    addEditedImageToGallery: vi.fn(async (input) => {
      const asset = galleryAsset(input.originalName ?? "edited.png", { source: "result", folderId: input.folderId ?? null, tags: input.tags ?? [] });
      currentSnapshot = { ...currentSnapshot, galleryAssets: [asset, ...currentSnapshot.galleryAssets] };
      return asset;
    }),
    replaceGalleryAssetImage: vi.fn(async (id, input) => {
      const asset = currentSnapshot.galleryAssets.find((item) => item.id === id) ?? galleryAsset(input.originalName ?? "replaced.png", { id });
      const updated = {
        ...asset,
        source: "result" as const,
        mimeType: input.dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : input.dataUrl.startsWith("data:image/webp") ? "image/webp" : "image/png",
        tags: input.tags ?? asset.tags,
        updatedAt: now,
        modifiedAt: now
      };
      currentSnapshot = { ...currentSnapshot, galleryAssets: currentSnapshot.galleryAssets.map((item) => item.id === id ? updated : item) };
      return updated;
    }),
    updateGalleryAsset: vi.fn(async (id, patch) => {
      const asset = currentSnapshot.galleryAssets.find((item) => item.id === id) ?? galleryAsset("missing.png", { id });
      const originalName = patch.originalName?.trim() || asset.originalName;
      const updated = {
        ...asset,
        fileName: patch.originalName ? originalName : asset.fileName,
        originalName,
        tags: patch.tags ?? asset.tags,
        folderId: "folderId" in patch ? patch.folderId ?? null : asset.folderId ?? null,
        updatedAt: now
      };
      currentSnapshot = { ...currentSnapshot, galleryAssets: currentSnapshot.galleryAssets.map((item) => item.id === id ? updated : item) };
      return updated;
    }),
    moveGalleryAsset: vi.fn(async (id, folderId) => {
      const asset = currentSnapshot.galleryAssets.find((item) => item.id === id) ?? galleryAsset("missing.png", { id });
      const updated = { ...asset, folderId, updatedAt: now };
      currentSnapshot = { ...currentSnapshot, galleryAssets: currentSnapshot.galleryAssets.map((item) => item.id === id ? updated : item) };
      return updated;
    }),
    removeGalleryAsset: vi.fn(async (id) => {
      currentSnapshot = { ...currentSnapshot, galleryAssets: currentSnapshot.galleryAssets.filter((item) => item.id !== id) };
      return currentSnapshot.galleryAssets;
    }),
    pickGalleryAsset: vi.fn(async (id) => {
      const asset = currentSnapshot.galleryAssets.find((item) => item.id === id) ?? galleryAsset("picked.png", { id });
      return {
        id: asset.id,
        name: asset.originalName,
        path: `/tmp/gallery/${asset.fileName}`,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        previewUrl: `image2tools-asset://image?gallery=${asset.fileName}`
      };
    }),
    selectImages: vi.fn(async () => []),
    getDroppedFilePaths: vi.fn(() => []),
    importImages: vi.fn(async () => []),
    selectMask: vi.fn(async () => null),
    runJob: vi.fn(async (request) => {
      const job = jobFromRequest(request, activeConfig());
      currentSnapshot = { ...currentSnapshot, history: [job, ...currentSnapshot.history] };
      return job;
    }),
    downloadAsset: vi.fn(async () => "/tmp/downloaded.png"),
    downloadEditedImage: vi.fn(async () => "/tmp/edited.png"),
    openAssetFolder: vi.fn(async () => undefined),
    openStorageFolder: vi.fn(async () => undefined),
    chooseStorageFolder: vi.fn(async () => currentSnapshot),
    checkForUpdates: vi.fn(async () => updateCheckResult),
    downloadAndInstallUpdate: vi.fn(async () => ({ version: "0.0.0", filePath: "/tmp/update", message: "opened" })),
    deleteJob: vi.fn(async () => initialSnapshot.history),
    updateHistoryJob: vi.fn(async (jobId, patch) => {
      const job = currentSnapshot.history.find((item) => item.id === jobId) ?? geminiJob(0, { id: jobId });
      const updated = {
        ...job,
        name: patch.name?.trim() || job.name,
        tags: patch.tags ?? job.tags,
        updatedAt: now
      };
      currentSnapshot = { ...currentSnapshot, history: currentSnapshot.history.map((item) => item.id === jobId ? updated : item) };
      return updated;
    }),
    clearHistory: vi.fn(async () => []),
    onJobEvent: vi.fn(() => () => undefined),
    onGalleryEvent: vi.fn(() => () => undefined),
    addProvider: vi.fn(async (input) => {
      const kind = input.kind ?? "openai";
      const newProvider = providerConfig({
        id: `provider-${currentSnapshot.providers.length + 1}`,
        kind,
        name: input.name || (kind === "gemini" ? "Gemini" : kind === "custom" ? "Custom" : "OpenAI"),
        baseURL: input.baseURL,
        defaultModel: input.defaultModel,
        defaultSize: input.defaultSize,
        defaultQuality: input.defaultQuality,
        timeoutMs: input.timeoutMs,
        apiKeySaved: Boolean(input.apiKey?.trim()),
        discoveredModels: [],
        activeLaunchId: input.activeLaunchId ?? (kind === "gemini" ? NANO_BANANA_3_LAUNCH_ID : GPT_IMAGE_2_LAUNCH_ID),
        activeModelId: input.activeModelId ?? input.defaultModel
      });
      currentSnapshot = {
        ...currentSnapshot,
        providers: [...currentSnapshot.providers, newProvider],
        activeProviderId: newProvider.id
      };
      return currentSnapshot;
    }),
    switchProvider: vi.fn(async (providerId: string) => {
      currentSnapshot = { ...currentSnapshot, activeProviderId: providerId };
      return currentSnapshot;
    }),
    deleteProvider: vi.fn(async (providerId: string) => {
      const providers = currentSnapshot.providers.filter((provider) => provider.id !== providerId);
      currentSnapshot = {
        ...currentSnapshot,
        providers,
        activeProviderId: currentSnapshot.activeProviderId === providerId ? providers[0].id : currentSnapshot.activeProviderId
      };
      return currentSnapshot;
    })
  };
}

function jobFromRequest(request: RunJobRequest, config: ProviderConfig): GenerationJob {
  const modelId = request.params.model;
  return {
    id: "job_bridge_result",
    name: "bridge_result.png",
    tags: [],
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
  const defaultConfig = providerConfig();
  return {
    appVersion: "0.1.0",
    providers: [defaultConfig],
    activeProviderId: defaultConfig.id,
    history: [],
    promptTemplates: [],
    galleryFolders: [],
    galleryAssets: [],
    storage: {
      historyDir: "/tmp/crossgen/history",
      galleryDir: "/tmp/crossgen/gallery"
    },
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
    streamingPartialsEnabled: true,
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
    name: `result_${index}.png`,
    tags: [],
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

function inputAsset(fileName: string): InputAsset {
  return {
    id: `input_${fileName}`,
    name: fileName,
    path: `/tmp/input/${fileName}`,
    mimeType: "image/png",
    sizeBytes: 1024,
    previewUrl: `image2tools-asset://image?path=${encodeURIComponent(`/tmp/input/${fileName}`)}`
  };
}

function galleryAsset(fileName: string, patch: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    id: `gallery_${fileName}`,
    fileName,
    originalName: fileName,
    mimeType: "image/png",
    sizeBytes: 1024,
    tags: [],
    source: "import",
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function mockCanvasContext(patch: Partial<CanvasRenderingContext2D> = {}): Partial<CanvasRenderingContext2D> {
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    ellipse: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 12 }) as TextMetrics),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    ...patch
  };
}

function galleryFolder(name: string, patch: Partial<GalleryFolder> = {}): GalleryFolder {
  const id = `folder-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled"}`;
  return {
    id,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function launchButton(name: string): HTMLButtonElement {
  return buttonByText(name, ".launch-button");
}

function launchModelOption(name: string): HTMLButtonElement {
  return buttonByText(name, ".launch-model-option");
}

function apiAccessCurrentButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".api-access-current");
  if (!button) throw new Error("Current API config button was not found.");
  return button;
}

function apiConfigCardByText(text: string): HTMLElement {
  const card = [...document.querySelectorAll<HTMLElement>(".api-config-card")].find((item) => item.textContent?.includes(text));
  if (!card) throw new Error(`API config card containing "${text}" was not found.`);
  return card;
}

function apiConfigCardMainByText(text: string): HTMLButtonElement {
  const button = apiConfigCardByText(text).querySelector<HTMLButtonElement>(".api-config-card-main");
  if (!button) throw new Error(`API config card main button containing "${text}" was not found.`);
  return button;
}

function apiConfigUseButtonByText(text: string): HTMLButtonElement {
  const button = apiConfigCardByText(text).querySelector<HTMLButtonElement>(".api-config-use-button");
  if (!button) throw new Error(`API config use button containing "${text}" was not found.`);
  return button;
}

function apiConfigDeleteButtonByText(text: string): HTMLButtonElement {
  const button = [...apiConfigCardByText(text).querySelectorAll<HTMLButtonElement>(".api-config-card-actions button")].find((item) => item.getAttribute("aria-label") === "Delete API config");
  if (!button) throw new Error(`API config delete button containing "${text}" was not found.`);
  return button;
}

function apiConfigDiscoverButtonByText(text: string): HTMLButtonElement {
  const button = [...apiConfigCardByText(text).querySelectorAll<HTMLButtonElement>(".api-config-card-actions button")].find((item) => item.getAttribute("aria-label") === "Discover models");
  if (!button) throw new Error(`API config discover button containing "${text}" was not found.`);
  return button;
}

async function openSavedApiAccess() {
  await click(apiAccessCurrentButton());
}

async function openTemplateDialog() {
  await click(buttonByText("Prompt templates", ".prompt-actions button"));
}

async function openGalleryRail() {
  const tab = document.querySelectorAll<HTMLButtonElement>(".right-rail-tabs button")[1];
  if (!tab) throw new Error("Gallery rail tab was not found.");
  await click(tab);
}

async function openGalleryFolderMenuItem(text: string): Promise<HTMLElement> {
  const button = buttonByText(text, ".gallery-tree-folder-button, .gallery-tree-root");
  return button.closest<HTMLElement>(".gallery-tree-row") ?? button;
}

async function selectGalleryFolder(text: string) {
  await click(buttonByText(text, ".gallery-tree-folder-button, .gallery-tree-root"));
}

async function createPreviewTextAnnotation(text: string) {
  const previewImage = document.querySelector<HTMLImageElement>(".preview-image-frame > img, .zoom-surface img");
  if (!previewImage) throw new Error("Preview image was not found.");
  Object.defineProperty(previewImage, "complete", { configurable: true, value: true });
  Object.defineProperty(previewImage, "naturalWidth", { configurable: true, value: 100 });
  Object.defineProperty(previewImage, "naturalHeight", { configurable: true, value: 100 });

  await click(document.querySelector<HTMLButtonElement>('.preview-control-strip button[aria-label="Text box"]')!);

  const canvas = document.querySelector<HTMLCanvasElement>(".annotation-canvas")!;
  const frame = document.querySelector<HTMLElement>(".preview-image-frame")!;
  const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined };
  Object.defineProperty(frame, "getBoundingClientRect", { configurable: true, value: () => rect });
  Object.defineProperty(canvas, "getBoundingClientRect", { configurable: true, value: () => rect });
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = vi.fn(() => true);
  canvas.releasePointerCapture = vi.fn();

  await pointer(canvas, "pointerdown", { clientX: 10, clientY: 10 });
  await pointer(canvas, "pointerup", { clientX: 80, clientY: 42 });
  await flushAsync();

  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text box"]');
  if (!textarea) throw new Error("Annotation text box was not created.");
  await changeTextArea(textarea, text);
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

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function pointer(element: HTMLElement, type: string, init: MouseEventInit = {}) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    Object.defineProperty(event, "pressure", { value: 0 });
    element.dispatchEvent(event);
    await Promise.resolve();
  });
}

async function windowPointer(type: string, init: MouseEventInit = {}) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    Object.defineProperty(event, "pressure", { value: 0 });
    window.dispatchEvent(event);
    await Promise.resolve();
  });
}

function elementByText(text: string, selector: string): HTMLElement {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find((item) => item.textContent?.includes(text));
  if (!element) throw new Error(`Element containing "${text}" was not found.`);
  return element;
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function changeTextArea(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function inputByLabel(labelText: string, root: ParentNode = document): HTMLInputElement {
  const label = [...root.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.includes(labelText));
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`Input labeled "${labelText}" was not found.`);
  return input;
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = [...document.querySelectorAll<HTMLInputElement>("input")].find((item) => item.placeholder === placeholder);
  if (!input) throw new Error(`Input with placeholder "${placeholder}" was not found.`);
  return input;
}

function textAreaByLabel(labelText: string, root: ParentNode = document): HTMLTextAreaElement {
  const label = [...root.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.includes(labelText));
  const textarea = label?.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) throw new Error(`Textarea labeled "${labelText}" was not found.`);
  return textarea;
}

function selectByLabel(labelText: string, root: ParentNode = document): HTMLSelectElement {
  const label = [...root.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.includes(labelText));
  const select = label?.querySelector<HTMLSelectElement>("select");
  if (!select) throw new Error(`Select labeled "${labelText}" was not found.`);
  return select;
}

function apiAccessAddForm(): HTMLElement {
  const form = document.querySelector<HTMLElement>(".api-access-add-form");
  if (!form) throw new Error("API config add form was not found.");
  return form;
}

async function keyDown(element: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

async function dispatchDragEvent(element: HTMLElement, type: string, dataTransfer: DataTransfer) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    element.dispatchEvent(event);
    await Promise.resolve();
  });
}

async function contextMenu(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 24, clientY: 24 }));
    await Promise.resolve();
  });
}

function dataTransferStub(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const transfer = {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: Object.keys(initial),
    clearData: vi.fn((format?: string) => {
      if (format) {
        values.delete(format);
      } else {
        values.clear();
      }
    }),
    getData: vi.fn((format: string) => values.get(format) ?? ""),
    setData: vi.fn((format: string, data: string) => {
      values.set(format, data);
    }),
    setDragImage: vi.fn()
  };
  return transfer as typeof transfer & DataTransfer;
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
