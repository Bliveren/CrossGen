import { describe, expect, it } from "vitest";
import {
  FOCUSED_MODEL_CATALOG,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID,
  getFocusedModelDefinition,
  getFocusedModelsForProvider,
  getGeneralImageModelCandidate,
  getModelDisplayName
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

  it("selects only safe non-focused image-like models for General fallback", () => {
    const openAIModels = [
      { id: "gpt-image-2", providerKind: "openai" as const },
      { id: "gpt-4.1", providerKind: "openai" as const },
      { id: "dall-e-3", providerKind: "openai" as const }
    ];
    const geminiModels = [
      { id: NANO_BANANA_3_MODEL_ID, providerKind: "gemini" as const },
      { id: "gemini-3-pro-image", providerKind: "gemini" as const, displayName: "Gemini image model" }
    ];

    expect(getGeneralImageModelCandidate(openAIModels, "openai")).toBeUndefined();
    expect(getGeneralImageModelCandidate(geminiModels, "gemini")?.id).toBe("gemini-3-pro-image");
    expect(getGeneralImageModelCandidate([{ id: "gpt-4.1", providerKind: "openai" }], "openai")).toBeUndefined();
  });
});
