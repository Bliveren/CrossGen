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
    await click(apiAccessCurrentButton());
    expect(buttonByText("Discover models").disabled).toBe(true);
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

  it("enables focused launches from discovered API models instead of the selected provider", async () => {
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
    const modelOption = launchModelOption("Gemini 3 Pro Image");
    expect(modelOption).toBeTruthy();
    await click(modelOption);
    await click(buttonByText("Generate", ".primary-run"));

    expect(bridge.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
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

    // Guided-region copy must remain for Gemini when the image-to-image mask area is shown.
    await click(buttonByText("Image to image", ".mode-tab"));
    expect(document.body.textContent).toContain("guidance");
  });

  it("keeps the single API access path working", async () => {
    const bridge = await renderApp(snapshot());

    expect(document.body.textContent).toContain("Model config");
    expect(document.body.textContent).toContain("OpenAI · api.openai.com/v1");
    expect(document.body.textContent).toContain("Key saved · 1 model discovered");

    await click(apiAccessCurrentButton());
    await changeInput(inputByLabel("Configuration name"), "Primary gateway");
    await click(buttonByText("Save"));

    expect(bridge.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ name: "Primary gateway" }));
    await openSavedApiAccess();
    expect(document.querySelectorAll(".api-access-item").length).toBe(1);
    expect(document.body.textContent).toContain("Primary gateway");
    expect(document.body.textContent).toContain("Current configuration");
  });

  it("adds a second API access and switches to it automatically", async () => {
    const bridge = await renderApp(snapshot());

    await openSavedApiAccess();
    await click(buttonByText("Add configuration"));
    const addForm = apiAccessAddForm();
    await changeSelect(selectByLabel("Configuration type", addForm), "gemini");
    await changeInput(inputByLabel("Configuration name", addForm), "Gemini gateway");
    await changeInput(inputByLabel("API Key", addForm), "gemini-test-key");
    await click(buttonByText("Add configuration", ".api-access-add-form button"));

    expect(bridge.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "gemini",
        name: "Gemini gateway",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        activeLaunchId: NANO_BANANA_3_LAUNCH_ID
      })
    );
    expect(document.body.textContent).toContain("Gemini gateway");
    expect(document.querySelectorAll(".api-access-item").length).toBe(2);
    expect(document.body.textContent).toContain("Current configuration");
    expect(buttonByText("Nano Banana 3", ".launch-button").disabled).toBe(true);
  });

  it("switches API access and derives launch availability from the selected access discovery", async () => {
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
    await click(buttonByText("Gemini access", ".api-access-item-main"));

    expect(bridge.saveDraft).toHaveBeenCalled();
    expect(bridge.switchProvider).toHaveBeenCalledWith("gemini-access");
    expect(launchButton("GPT Image 2").disabled).toBe(true);
    expect(launchButton("Nano Banana 3").disabled).toBe(false);
  });

  it("deletes inactive API access without changing the active workspace", async () => {
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
    const geminiItem = [...document.querySelectorAll<HTMLElement>(".api-access-item")].find((item) => item.textContent?.includes("Gemini access"))!;
    await click(geminiItem.querySelector<HTMLButtonElement>(".icon-button")!);

    expect(bridge.deleteProvider).toHaveBeenCalledWith("gemini-access");
    expect(launchButton("GPT Image 2").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Gemini access");
  });

  it("deletes active API access and switches to the remaining access", async () => {
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
    const activeDeleteButton = [...document.querySelectorAll<HTMLButtonElement>(".api-config-detail button")].find((button) => button.title === "Delete configuration")!;
    await click(activeDeleteButton);

    expect(bridge.saveDraft).toHaveBeenCalled();
    expect(bridge.deleteProvider).toHaveBeenCalledWith("gemini-access");
    expect(document.body.textContent).toContain("OpenAI access");
    expect(launchButton("GPT Image 2").disabled).toBe(false);
  });

  it("creates, searches, filters, applies, and deletes prompt templates", async () => {
    const bridge = await renderApp(snapshot());

    await openTemplateDialog();
    await changeInput(inputByLabel("Title"), "Product shot");
    await changeTextArea(textAreaByLabel("Template prompt"), "A crisp product shot on a steel table");
    await changeInput(inputByLabel("Tags"), "product, studio");
    await click(buttonByText("Save template"));

    expect(bridge.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Product shot",
        body: "A crisp product shot on a steel table",
        tags: ["product", "studio"]
      }),
      undefined
    );
    expect(document.body.textContent).toContain("Product shot");

    await changeInput(inputByPlaceholder("Search templates"), "steel");
    expect(document.body.textContent).toContain("Product shot");
    await changeSelect(document.querySelector<HTMLSelectElement>(".template-toolbar select")!, "studio");
    expect(document.body.textContent).toContain("Product shot");

    await click(document.querySelector<HTMLButtonElement>('.template-actions button[aria-label="Use template"]')!);
    expect(textAreaByLabel("Prompt").value).toBe("A crisp product shot on a steel table");
    expect(bridge.saveDraft).toHaveBeenCalled();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click(document.querySelector<HTMLButtonElement>('.template-actions button[aria-label="Delete"]')!);
    expect(bridge.deleteTemplate).toHaveBeenCalledWith("template-1");
    expect(document.body.textContent).not.toContain("Product shot");
  });

  it("picks a Gallery image as a reference asset", async () => {
    const asset = galleryAsset("gallery-product.png", { tags: ["product"] });
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>(".gallery-thumb")!);

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

  it("filters @ Gallery prompt chips by the active Gallery folder, tag, and search", async () => {
    const productFolder = galleryFolder("Product refs");
    const matching = galleryAsset("folder-match.png", { folderId: productFolder.id, tags: ["hero"] });
    const wrongFolder = galleryAsset("folder-miss.png", { tags: ["hero"] });
    const wrongTag = galleryAsset("tag-miss.png", { folderId: productFolder.id, tags: ["draft"] });
    const bridge = await renderApp(snapshot({
      galleryFolders: [productFolder],
      galleryAssets: [matching, wrongFolder, wrongTag]
    }));
    const promptInput = textAreaByLabel("Prompt");

    await openGalleryRail();
    await click(buttonByText("Product refs", ".gallery-folder-main"));
    await changeSelect(document.querySelector<HTMLSelectElement>(".gallery-toolbar select")!, "hero");
    await changeInput(inputByPlaceholder("Search Gallery"), "folder-match");

    await changeTextArea(promptInput, "Product hero @");
    expect(document.body.textContent).toContain("folder-match.png");
    expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain("folder-miss.png");
    expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain("tag-miss.png");
    await keyDown(promptInput, "Enter");

    expect(bridge.pickGalleryAsset).toHaveBeenCalledWith(matching.id);
    expect(document.body.textContent).toContain("@ folder-match.png");
  });

  it("adds a history result to Gallery", async () => {
    const result = imageAsset("history-result.png");
    const job = geminiJob(0, { outputs: [result] });
    const bridge = await renderApp(snapshot({ history: [job] }));

    await click(buttonByText("Add to Gallery", ".history-action-button"));

    expect(bridge.addHistoryAssetToGallery).toHaveBeenCalledWith(result.path, null);
    expect(document.body.textContent).toContain("Added to Gallery.");

    await openGalleryRail();
    expect(document.body.textContent).toContain("history.png");
  });

  it("edits Gallery tags and updates the visible filter state", async () => {
    const asset = galleryAsset("gallery-tags.png", { tags: ["old"] });
    const bridge = await renderApp(snapshot({ galleryAssets: [asset] }));

    await openGalleryRail();
    await click(document.querySelector<HTMLButtonElement>('.gallery-actions button[aria-label="Edit tags"]')!);
    await changeInput(document.querySelector<HTMLInputElement>(".gallery-tag-editor input")!, "product, hero");
    await click(document.querySelector<HTMLButtonElement>('.gallery-tag-editor button[aria-label="Save tags"]')!);

    expect(bridge.updateGalleryAsset).toHaveBeenCalledWith(asset.id, { tags: ["product", "hero"] });
    expect(document.body.textContent).toContain("Gallery tags updated.");
    expect(document.body.textContent).toContain("product");
    expect(document.body.textContent).toContain("hero");
  });

  it("creates Gallery folders, imports and moves assets, then deletes folders back to Uncategorized", async () => {
    const bridge = await renderApp(snapshot());
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await openGalleryRail();
    await changeInput(inputByPlaceholder("New folder"), "Product refs");
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Create folder"]')!);

    expect(bridge.createGalleryFolder).toHaveBeenCalledWith({ name: "Product refs" });
    expect(document.body.textContent).toContain("Product refs");

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Import to Gallery"]')!);
    expect(bridge.importToGallery).toHaveBeenCalledWith(undefined, "folder-product-refs");
    expect(document.body.textContent).toContain("imported.png");

    await changeSelect(document.querySelector<HTMLSelectElement>(".gallery-folder-select")!, "");
    expect(bridge.moveGalleryAsset).toHaveBeenLastCalledWith("gallery_imported.png", null);
    expect(document.body.textContent).toContain("Gallery image moved.");

    await changeInput(inputByPlaceholder("Search Gallery"), "imported");
    await changeSelect(document.querySelector<HTMLSelectElement>(".gallery-toolbar select")!, "");
    expect(document.body.textContent).toContain("No matching Gallery images.");

    await click(buttonByText("Uncategorized", ".gallery-folder-button"));
    expect(document.body.textContent).toContain("imported.png");

    await changeSelect(document.querySelector<HTMLSelectElement>(".gallery-folder-select")!, "folder-product-refs");
    expect(bridge.moveGalleryAsset).toHaveBeenLastCalledWith("gallery_imported.png", "folder-product-refs");
    expect(document.body.textContent).toContain("No matching Gallery images.");

    await changeInput(inputByPlaceholder("Search Gallery"), "");
    await click(buttonByText("Product refs", ".gallery-folder-main"));
    expect(document.body.textContent).toContain("imported.png");

    const folderDelete = document.querySelector<HTMLButtonElement>('button[aria-label="Delete folder"]')!;
    await click(folderDelete);

    expect(bridge.deleteGalleryFolder).toHaveBeenCalledWith("folder-product-refs");
    expect(document.body.textContent).toContain("Uncategorized");
    expect(document.body.textContent).toContain("imported.png");
  });

  it("confirms before deleting a Gallery image", async () => {
    const asset = galleryAsset("gallery-delete.png");
    const bridge = await renderApp(snapshot({ galleryAssets: [asset], history: [geminiJob(0)] }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await openGalleryRail();
    expect(buttonByText("Recent jobs", ".right-rail-tabs button").textContent).toContain("1");
    await click(document.querySelector<HTMLButtonElement>('.gallery-actions button[aria-label="Delete"]')!);

    expect(confirmSpy).toHaveBeenCalledWith('Delete Gallery image "gallery-delete.png"?');
    expect(bridge.removeGalleryAsset).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await click(document.querySelector<HTMLButtonElement>('.gallery-actions button[aria-label="Delete"]')!);

    expect(bridge.removeGalleryAsset).toHaveBeenCalledWith(asset.id);
    expect(document.body.textContent).not.toContain("gallery-delete.png");
    await click(buttonByText("Recent jobs", ".right-rail-tabs button"));
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
    expect(document.body.textContent).toContain("Only upload images you have permission to use");
    expect(buttonByText("Upload mask")).toBeTruthy();
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
    expect(document.body.textContent).toContain("Show all 8");
    expect(document.body.textContent).toContain("Nano Banana 3");

    await click(buttonByText("Show all 8"));

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
    await click(document.querySelector<HTMLButtonElement>(".gallery-thumb")!);
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
    expect(buttonByText("Show all 10")).toBeTruthy();
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

  const activeConfig = () => currentSnapshot.providers.find(p => p.id === currentSnapshot.activeProviderId) ?? currentSnapshot.providers[0];

  return {
    getSnapshot: vi.fn(async () => currentSnapshot),
    saveConfig: vi.fn(async (input) => {
      const config = activeConfig();
      const nextConfig: ProviderConfig = {
        ...config,
        kind: input.kind ?? config.kind,
        name: input.name ?? config.name,
        baseURL: input.baseURL,
        defaultModel: input.defaultModel,
        defaultSize: input.defaultSize,
        defaultQuality: input.defaultQuality,
        timeoutMs: input.timeoutMs,
        activeLaunchId: input.activeLaunchId ?? config.activeLaunchId,
        activeModelId: input.activeModelId ?? config.activeModelId,
        apiKeySaved: config.apiKeySaved || Boolean(input.apiKey?.trim()),
        updatedAt: now
      };
      currentSnapshot = {
        ...currentSnapshot,
        providers: currentSnapshot.providers.map(p => p.id === currentSnapshot.activeProviderId ? nextConfig : p)
      };
      return nextConfig;
    }),
    discoverModels: vi.fn(async () => activeConfig()),
    clearApiKey: vi.fn(async () => {
      const config = activeConfig();
      return { ...config, apiKeySaved: false, discoveredModels: [] };
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
      const folder = galleryFolder(input.name);
      currentSnapshot = { ...currentSnapshot, galleryFolders: [folder, ...currentSnapshot.galleryFolders] };
      return folder;
    }),
    renameGalleryFolder: vi.fn(async (id, input) => {
      const folder = currentSnapshot.galleryFolders.find((item) => item.id === id) ?? galleryFolder(input.name, { id });
      const updated = { ...folder, name: input.name.trim(), updatedAt: now };
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
    addHistoryAssetToGallery: vi.fn(async (_assetPath, folderId) => {
      const asset = galleryAsset("history.png", { source: "result", folderId: folderId ?? null });
      currentSnapshot = { ...currentSnapshot, galleryAssets: [asset, ...currentSnapshot.galleryAssets] };
      return asset;
    }),
    updateGalleryAsset: vi.fn(async (id, patch) => {
      const asset = currentSnapshot.galleryAssets.find((item) => item.id === id) ?? galleryAsset("missing.png", { id });
      const updated = { ...asset, tags: patch.tags ?? asset.tags, folderId: "folderId" in patch ? patch.folderId ?? null : asset.folderId ?? null, updatedAt: now };
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
    openAssetFolder: vi.fn(async () => undefined),
    checkForUpdates: vi.fn(async () => updateCheckResult),
    downloadAndInstallUpdate: vi.fn(async () => ({ version: "0.0.0", filePath: "/tmp/update", message: "opened" })),
    deleteJob: vi.fn(async () => initialSnapshot.history),
    clearHistory: vi.fn(async () => []),
    onJobEvent: vi.fn(() => () => undefined),
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
  if (!button) throw new Error("Current API access button was not found.");
  return button;
}

async function openSavedApiAccess() {
  await click(buttonByText("Saved configurations", ".compact-toggle"));
}

async function openTemplateDialog() {
  await click(buttonByText("Prompt templates", ".prompt-template-button"));
}

async function openGalleryRail() {
  const tab = document.querySelectorAll<HTMLButtonElement>(".right-rail-tabs button")[1];
  if (!tab) throw new Error("Gallery rail tab was not found.");
  await click(tab);
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
  if (!form) throw new Error("API access add form was not found.");
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
