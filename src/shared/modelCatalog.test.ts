import { describe, expect, it } from "vitest";
import {
  FOCUSED_MODEL_CATALOG,
  GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID,
  GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
  GEMINI_3_PRO_IMAGE_MODEL_ID,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ALIAS,
  NANO_BANANA_3_MODEL_ID,
  generalFallbackSupportsReferenceImages,
  getFocusedModelDefinition,
  getFocusedModelsForProvider,
  getGeneralImageModelCandidate,
  getModelDisplayName,
  geminiProviderModelDisplayName,
  isGeneralFallbackProvider,
  isGeminiImageModelId,
  normalizeGeminiImageModelId
} from "./modelCatalog";

describe("focused model catalog", () => {
  it("defines the phase 1 focused launches", () => {
    expect(FOCUSED_MODEL_CATALOG.map((definition) => definition.launchId)).toEqual([
      GPT_IMAGE_2_LAUNCH_ID,
      GPT_IMAGE_2_5_LAUNCH_ID,
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
    expect(getFocusedModelDefinition(GPT_IMAGE_2_5_LAUNCH_ID)).toMatchObject({
      displayName: "GPT Image 2.5",
      providerKind: "openai",
      defaultModelId: GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
      capabilities: {
        inpaint: "exact-mask",
        multiTurn: true,
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
      modelIds: [
        GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
        GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID,
        GEMINI_3_PRO_IMAGE_MODEL_ID
      ],
      capabilities: {
        inpaint: "guided-region",
        outputText: true,
        configurableResolution: "gemini-resolution-aspect",
        supportsThinking: true,
        supportsSearchGrounding: true
      }
    });
  });

  it("keeps the product launch label while exposing real Gemini Image model names", () => {
    expect(geminiProviderModelDisplayName(GEMINI_3_1_FLASH_IMAGE_MODEL_ID))
      .toBe("Gemini 3.1 Flash Image");
    expect(geminiProviderModelDisplayName(GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID))
      .toBe("Gemini 3.1 Flash Image Lite");
    expect(geminiProviderModelDisplayName(GEMINI_3_PRO_IMAGE_MODEL_ID))
      .toBe("Gemini 3 Pro Image");
    expect(getModelDisplayName(NANO_BANANA_3_LAUNCH_ID, GEMINI_3_1_FLASH_IMAGE_MODEL_ID))
      .toBe("Nano Banana 3 · Gemini 3.1 Flash Image");
    expect(getModelDisplayName(NANO_BANANA_3_LAUNCH_ID, GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID))
      .toBe("Gemini 3.1 Flash Image Lite");
    expect(getModelDisplayName(NANO_BANANA_3_LAUNCH_ID, GEMINI_3_PRO_IMAGE_MODEL_ID))
      .toBe("Gemini 3 Pro Image");
  });

  it("canonicalizes the legacy Nano Banana alias without relabeling other Gemini models", () => {
    expect(NANO_BANANA_3_MODEL_ALIAS).toBe(NANO_BANANA_3_LAUNCH_ID);
    expect(normalizeGeminiImageModelId(NANO_BANANA_3_MODEL_ALIAS)).toBe(NANO_BANANA_3_MODEL_ID);
    expect(isGeminiImageModelId(NANO_BANANA_3_MODEL_ALIAS)).toBe(true);
    expect(getModelDisplayName(NANO_BANANA_3_LAUNCH_ID, NANO_BANANA_3_MODEL_ALIAS))
      .toBe("Nano Banana 3 · Gemini 3.1 Flash Image");
    expect(normalizeGeminiImageModelId(GEMINI_3_PRO_IMAGE_MODEL_ID)).toBe(GEMINI_3_PRO_IMAGE_MODEL_ID);
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
      GPT_IMAGE_2_5_LAUNCH_ID,
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
    expect(getGeneralImageModelCandidate([
      { id: "paint-model", providerKind: "custom", raw: { capabilities: { image_generation: true } } }
    ], "custom")?.id).toBe("paint-model");
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
