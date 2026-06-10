import { describe, expect, it } from "vitest";
import {
  FOCUSED_MODEL_CATALOG,
  GEMINI_3_PRO_IMAGE_MODEL_ID,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID,
  generalFallbackSupportsReferenceImages,
  getFocusedModelDefinition,
  getFocusedModelsForProvider,
  getGeneralImageModelCandidate,
  getModelDisplayName,
  isGeneralFallbackProvider
} from "./modelCatalog";

describe("focused model catalog", () => {
  it("defines the phase 1 focused launches", () => {
    expect(FOCUSED_MODEL_CATALOG.map((definition) => definition.launchId)).toEqual([
      GPT_IMAGE_2_LAUNCH_ID,
      NANO_BANANA_3_LAUNCH_ID,
      GENERAL_LAUNCH_ID
    ]);
    expect(getFocusedModelDefinition(GPT_IMAGE_2_LAUNCH_ID)).toMatchObject({
      displayName: "GPT Image 2",
      providerKind: "openai",
      defaultModelId: "gpt-image-2",
      capabilities: {
        inpaint: "exact-mask",
        streamingPartials: true,
        configurableResolution: "openai-size"
      }
    });
  });

  it("maps Nano Banana 3 to the selected Gemini model and guided-region editing", () => {
    expect(getFocusedModelDefinition(NANO_BANANA_3_LAUNCH_ID)).toMatchObject({
      displayName: "Nano Banana 3",
      providerKind: "gemini",
      defaultModelId: NANO_BANANA_3_MODEL_ID,
      modelIds: [NANO_BANANA_3_MODEL_ID, GEMINI_3_PRO_IMAGE_MODEL_ID],
      capabilities: {
        inpaint: "guided-region",
        outputText: true,
        configurableResolution: "gemini-resolution-aspect",
        supportsThinking: true,
        supportsSearchGrounding: true
      }
    });
  });

  it("includes General as a provider fallback without advanced capabilities", () => {
    expect(getFocusedModelDefinition(GENERAL_LAUNCH_ID)).toMatchObject({
      displayName: "General",
      capabilities: {
        generate: true,
        edit: false,
        inpaint: false,
        referenceImages: false,
        streamingPartials: false,
        configurableResolution: "none"
      }
    });
    expect(getFocusedModelsForProvider("openai").map((definition) => definition.launchId)).toEqual([
      GPT_IMAGE_2_LAUNCH_ID,
      GENERAL_LAUNCH_ID
    ]);
    expect(getModelDisplayName(GENERAL_LAUNCH_ID, "image-model-x")).toBe("image-model-x");
  });

  it("selects supported non-focused image-like models for General fallback", () => {
    const openAIModels = [
      { id: "gpt-image-2", providerKind: "openai" as const },
      { id: "gpt-4.1", providerKind: "openai" as const },
      { id: "dall-e-3", providerKind: "openai" as const }
    ];
    const geminiModels = [
      { id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" as const },
      { id: GEMINI_3_PRO_IMAGE_MODEL_ID, providerKind: "gemini" as const, displayName: "Gemini 3 Pro Image" },
      { id: "gemini-2.0-flash-preview-image-generation", providerKind: "gemini" as const, displayName: "Gemini image model" }
    ];
    const customModels = [
      { id: "chat-model", providerKind: "custom" as const },
      { id: "flux-pro", providerKind: "custom" as const, displayName: "Flux image generator" }
    ];

    expect(getGeneralImageModelCandidate(openAIModels, "openai")?.id).toBe("dall-e-3");
    expect(getGeneralImageModelCandidate(geminiModels, "gemini")?.id).toBe("gemini-2.0-flash-preview-image-generation");
    expect(getGeneralImageModelCandidate(customModels, "custom")?.id).toBe("flux-pro");
    expect(getGeneralImageModelCandidate([{ id: "gpt-4.1", providerKind: "openai" }], "openai")).toBeUndefined();
  });

  it("tracks provider-specific General reference support", () => {
    expect(isGeneralFallbackProvider("openai")).toBe(true);
    expect(isGeneralFallbackProvider("gemini")).toBe(true);
    expect(isGeneralFallbackProvider("custom")).toBe(true);
    expect(generalFallbackSupportsReferenceImages("gemini")).toBe(true);
    expect(generalFallbackSupportsReferenceImages("openai")).toBe(false);
    expect(generalFallbackSupportsReferenceImages("custom")).toBe(false);
  });
});
