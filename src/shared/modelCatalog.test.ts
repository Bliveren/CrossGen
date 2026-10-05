import { describe, expect, it } from "vitest";
import type { OpenAIImageRouting } from "./types";
import {
  FOCUSED_MODEL_CATALOG,
  GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID,
  GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
  GEMINI_3_PRO_IMAGE_MODEL_ID,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_SNAPSHOT_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
  GPT_IMAGE_2_5_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ALIAS,
  NANO_BANANA_3_MODEL_ID,
  generalFallbackSupportsReferenceImages,
  hasGeneralEditRouteEvidence,
  classifyDiscoveredModel,
  discoveredModelDisplayName,
  discoveredModelCapabilityHints,
  discoveredLaunchIdForModel,
  getFocusedModelDefinition,
  getFocusedModelsForProvider,
  getGeneralImageModelCandidate,
  getModelDisplayName,
  getModelDisplayNameForProvider,
  geminiProviderModelDisplayName,
  focusedLaunchIdForModel,
  findDiscoveredImageModel,
  hasCompletedModelDiscovery,
  isGeneralFallbackProvider,
  isDiscoveredImageModel,
  isDiscoveredModelLaunchable,
  discoveredModelAvailability,
  discoveredModelSource,
  isGptImage2ModelId,
  isGptImage25ModelId,
  isGptImage25ProviderModelId,
  isGptImage25LaunchAlias,
  isGeminiImageModelId,
  normalizeGeminiImageModelId,
  summarizeDiscoveredModels,
  stripModelResourcePrefix
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
      modelIds: expect.arrayContaining([
        GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
        GPT_IMAGE_2_5_FLARE_MODEL_ID,
        GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID
      ]),
      capabilities: {
        inpaint: "exact-mask",
        multiTurn: true,
        streamingPartials: true,
        configurableResolution: "openai-size"
      }
    });
  });

  it("distinguishes the bare GPT Image 2.5 id from GPT Image 2", () => {
    expect(isGptImage2ModelId(GPT_IMAGE_2_MODEL_ID)).toBe(true);
    expect(isGptImage2ModelId("models/gpt-image-2")).toBe(true);
    expect(isGptImage2ModelId(GPT_IMAGE_2_5_MODEL_ID)).toBe(false);
    expect(isGptImage2ModelId("gpt-image-2.50")).toBe(false);
    expect(isGptImage25ModelId(GPT_IMAGE_2_5_MODEL_ID)).toBe(true);
    expect(isGptImage25ProviderModelId(GPT_IMAGE_2_5_MODEL_ID)).toBe(false);
    expect(isGptImage25LaunchAlias(GPT_IMAGE_2_5_MODEL_ID)).toBe(true);
    expect(isGptImage25ModelId(GPT_IMAGE_2_MODEL_ID)).toBe(false);
    expect(isGptImage25ModelId("gpt-image-2.5-2026-09-08")).toBe(true);
    expect(isGptImage25ProviderModelId("gpt-image-2.5-2026-09-08")).toBe(true);
    expect(isGptImage25ProviderModelId(GPT_IMAGE_2_5_SUNBURST_MODEL_ID)).toBe(true);
    expect(isGptImage25ProviderModelId(GPT_IMAGE_2_5_FLARE_MODEL_ID)).toBe(true);
    expect(isGptImage25ModelId("gpt-image-2.5-sunburst-2026-09-08")).toBe(true);
    expect(isGptImage25ModelId("gpt-image-2.5-flare-2026-09-08")).toBe(true);
    expect(isGptImage25ModelId("gpt-image-2.5-2026-02-29")).toBe(false);
    expect(isGptImage25ModelId("gpt-image-2.5-sunburst-2026-09-31")).toBe(false);
    expect(isGptImage25ModelId("gpt-image-2.50")).toBe(false);
    expect(getModelDisplayName(GPT_IMAGE_2_5_LAUNCH_ID, GPT_IMAGE_2_5_MODEL_ID)).toBe("GPT Image 2.5");
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai"
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_MODEL_ID,
      providerKind: "openai"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { output_modalities: ["text"] }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { capabilities: {} }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { capabilities: { text_generation: true } }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { capabilities: { context_window: 128000 } }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: "paint-model",
      providerKind: "custom",
      raw: { image: true }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: "paint-model",
      providerKind: "custom",
      raw: { image: false }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-captioner",
      providerKind: "custom"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-to-text",
      providerKind: "custom"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image2text",
      providerKind: "custom"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-to-audio",
      providerKind: "custom"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "text-to-image",
      providerKind: "custom"
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: "chat-model",
      providerKind: "custom",
      displayName: "GPT Image 2.5"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "paint-model",
      providerKind: "custom",
      displayName: "GPT Image 2.5"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-model",
      providerKind: "custom",
      displayName: "Vision encoder"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { image_generation: false }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { capabilities: { image_generation: false } }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { capabilities: { image_generation: { supported: false } } }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { capabilities: { image_generation: { enabled: true } } }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { supports: { image: false } }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { supported: { image: { enabled: false } } }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "paint-model",
      providerKind: "custom",
      raw: { supports: { image: true } }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { video_generation: false }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { video_generation: true }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { output_modalities: ["audio"] }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { image_generation: true, output_modalities: ["text"] }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-preview",
      providerKind: "custom",
      raw: { output_modalities: [{ type: "text" }] }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-preview",
      providerKind: "custom",
      raw: {
        image_generation: true,
        output_modalities: [{ type: "text" }]
      }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-preview",
      providerKind: "custom",
      raw: {
        image_generation: true,
        output_modalities: [{ type: "image" }]
      }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { image_generation: true, output_modalities: ["text", "image"] }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { output_modalities: [] }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: "image-to-text",
      providerKind: "custom",
      raw: { tasks: ["image-to-text"] }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "text-to-image",
      providerKind: "custom",
      raw: { tasks: ["text-to-image"] }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: "image-captioner",
      providerKind: "custom",
      raw: {
        capabilities: {
          input: { modalities: ["image"] },
          output: { modalities: ["text"] }
        }
      }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { image_generation: "false" }
    })).toBe(false);
    expect(discoveredModelCapabilityHints({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { image_generation: false, video_generation: false }
    })).toMatchObject({
      image: false,
      video: false,
      explicitImage: true,
      imageDenied: true,
      explicitVideo: true,
      videoDenied: true,
      explicitMedia: true
    });
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: {
        image_generation: true,
        output_modalities: ["image"],
        capabilities: { image_generation: false }
      }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "multimodal-captioner",
      providerKind: "custom",
      raw: {
        modalities: {
          input: ["image"],
          output: ["text"]
        }
      }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "image-captioner",
      providerKind: "custom",
      raw: {
        supportedInputModalities: ["image"],
        supportedOutputModalities: ["text"]
      }
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: "paint-model",
      providerKind: "custom",
      raw: {
        supportedInputModalities: ["image"],
        supportedOutputModalities: ["image"]
      }
    })).toBe(true);
    expect(isDiscoveredImageModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "gemini"
    })).toBe(false);
    expect(isDiscoveredImageModel({
      id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
      providerKind: "openai"
    })).toBe(false);
    expect(focusedLaunchIdForModel("openai", "models/gpt-image-2.5")).toBeUndefined();
    expect(stripModelResourcePrefix("Models/gpt-image-2.5")).toBe("gpt-image-2.5");
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

  it("derives a focused launch only from the matching provider family", () => {
    expect(focusedLaunchIdForModel("openai", GPT_IMAGE_2_MODEL_ID)).toBe(GPT_IMAGE_2_LAUNCH_ID);
    expect(focusedLaunchIdForModel("openai", GPT_IMAGE_2_SNAPSHOT_MODEL_ID)).toBe(GPT_IMAGE_2_LAUNCH_ID);
    expect(focusedLaunchIdForModel("openai", "gpt-image-2-2026-02-29")).toBeUndefined();
    expect(focusedLaunchIdForModel("openai", GPT_IMAGE_2_5_MODEL_ID)).toBeUndefined();
    expect(focusedLaunchIdForModel("openai", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)).toBe(GPT_IMAGE_2_5_LAUNCH_ID);
    expect(focusedLaunchIdForModel("gemini", GEMINI_3_PRO_IMAGE_MODEL_ID)).toBe(NANO_BANANA_3_LAUNCH_ID);
    expect(focusedLaunchIdForModel("custom", GPT_IMAGE_2_5_MODEL_ID)).toBeUndefined();
    expect(focusedLaunchIdForModel("gemini", GPT_IMAGE_2_5_MODEL_ID)).toBeUndefined();
  });

  it("derives labels from the exact model id instead of an advisory launch or display name", () => {
    expect(getModelDisplayNameForProvider("openai", GPT_IMAGE_2_MODEL_ID, GPT_IMAGE_2_5_LAUNCH_ID))
      .toBe("GPT Image 2");
    expect(getModelDisplayNameForProvider("openai", GPT_IMAGE_2_5_SUNBURST_MODEL_ID, GPT_IMAGE_2_LAUNCH_ID))
      .toBe("GPT Image 2.5 · Sunburst");
    expect(getModelDisplayNameForProvider("openai", GPT_IMAGE_2_5_MODEL_ID, GPT_IMAGE_2_LAUNCH_ID))
      .toBe(GPT_IMAGE_2_5_MODEL_ID);
    expect(getModelDisplayNameForProvider("custom", GPT_IMAGE_2_5_MODEL_ID, GENERAL_LAUNCH_ID))
      .toBe(GPT_IMAGE_2_5_MODEL_ID);
    expect(getModelDisplayNameForProvider(undefined, GPT_IMAGE_2_5_MODEL_ID, GENERAL_LAUNCH_ID))
      .toBe(GPT_IMAGE_2_5_MODEL_ID);
    expect(getModelDisplayNameForProvider(undefined, GEMINI_3_PRO_IMAGE_MODEL_ID, NANO_BANANA_3_LAUNCH_ID))
      .toBe("Gemini 3 Pro Image");
    expect(getModelDisplayNameForProvider("gemini", "", NANO_BANANA_3_LAUNCH_ID))
      .toBe("Nano Banana 3");
  });

  it("resolves discovered launch families from exact ids and capability evidence", () => {
    expect(discoveredLaunchIdForModel({
      id: "gpt-image-2",
      providerKind: "openai",
      displayName: "GPT Image 2.5",
      availability: "confirmed"
    })).toBe(GPT_IMAGE_2_LAUNCH_ID);
    expect(discoveredLaunchIdForModel({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      availability: "confirmed"
    })).toBe(GPT_IMAGE_2_5_LAUNCH_ID);
    expect(discoveredLaunchIdForModel({
      id: "gpt-image-2.5",
      providerKind: "openai",
      raw: { image_generation: false }
    })).toBeUndefined();
    expect(discoveredLaunchIdForModel({
      id: "paint-model",
      providerKind: "custom",
      raw: { image_generation: true }
    })).toBe(GENERAL_LAUNCH_ID);
    expect(discoveredLaunchIdForModel({
      id: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      availability: "confirmed"
    })).toBe(GPT_IMAGE_2_5_LAUNCH_ID);
  });

  it("classifies exact provider ids independently from display names and availability", () => {
    expect(classifyDiscoveredModel({
      id: GPT_IMAGE_2_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2.5",
      availability: "confirmed"
    })).toMatchObject({
      exactModelId: GPT_IMAGE_2_MODEL_ID,
      launchId: GPT_IMAGE_2_LAUNCH_ID,
      family: GPT_IMAGE_2_LAUNCH_ID,
      imageCapable: true,
      launchable: true
    });

    expect(classifyDiscoveredModel({
      id: GPT_IMAGE_2_5_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      availability: "listed"
    })).toMatchObject({
      exactModelId: GPT_IMAGE_2_5_MODEL_ID,
      imageCapable: false,
      launchable: false
    });

    expect(classifyDiscoveredModel({
      id: GPT_IMAGE_2_5_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      raw: { output_modalities: ["text"] },
      availability: "rejected"
    })).toMatchObject({
      exactModelId: GPT_IMAGE_2_5_MODEL_ID,
      imageCapable: false,
      launchable: false
    });
  });

  it("requires exact confirmation for focused launches while preserving legacy General rows", () => {
    const listed = {
      id: GPT_IMAGE_2_MODEL_ID,
      providerKind: "openai" as const,
      availability: "listed" as const
    };
    const inconclusive = {
      ...listed,
      availability: "inconclusive" as const
    };
    const rejected = {
      ...listed,
      availability: "rejected" as const,
      availabilityReason: "model_not_found"
    };
    const generalListed = {
      id: "paint-model",
      providerKind: "custom" as const,
      raw: { image_generation: true },
      availability: "listed" as const
    };

    expect(isDiscoveredImageModel(listed)).toBe(true);
    expect(isDiscoveredModelLaunchable(listed)).toBe(false);
    expect(isDiscoveredModelLaunchable(inconclusive)).toBe(false);
    expect(isDiscoveredModelLaunchable(rejected)).toBe(false);
    expect(isDiscoveredModelLaunchable(generalListed)).toBe(true);
    expect(isDiscoveredModelLaunchable({
      id: GPT_IMAGE_2_MODEL_ID,
      providerKind: "openai"
    })).toBe(false);
    expect(discoveredModelAvailability({ id: "legacy", providerKind: "custom" })).toBe("listed");
  });

  it("summarizes exact model families without trusting display names", () => {
    expect(summarizeDiscoveredModels([
      { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2.5", availability: "confirmed" },
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2", availability: "confirmed" },
      { id: GEMINI_3_PRO_IMAGE_MODEL_ID, providerKind: "gemini", availability: "confirmed" },
      { id: "gpt-4.1", providerKind: "openai" },
      { id: "veo-3", providerKind: "openai", raw: { video_generation: true } }
    ])).toEqual({
      total: 5,
      image: 3,
      video: 1,
      unknown: 1,
      gptImage2: [GPT_IMAGE_2_MODEL_ID],
      gptImage25: [GPT_IMAGE_2_5_SUNBURST_MODEL_ID],
      otherImage: [GEMINI_3_PRO_IMAGE_MODEL_ID],
      compatibilityAliases: []
    });
  });

  it("deduplicates legacy resource-prefixed rows in the discovery inventory", () => {
    expect(summarizeDiscoveredModels([
      { id: `models/${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}`, providerKind: "openai", availability: "confirmed" },
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2", availability: "confirmed" },
      { id: "gpt-image-2", providerKind: "openai", availability: "confirmed" },
      { id: "GPT-IMAGE-2", providerKind: "openai", availability: "confirmed" }
    ])).toEqual({
      total: 2,
      image: 2,
      video: 0,
      unknown: 0,
      gptImage2: ["gpt-image-2"],
      gptImage25: [`models/${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}`],
      otherImage: [],
      compatibilityAliases: []
    });
  });

  it("reports the bare GPT Image 2.5 compatibility alias separately from provider evidence", () => {
    const alias = {
      id: GPT_IMAGE_2_5_MODEL_ID,
      providerKind: "openai" as const,
      displayName: "GPT Image 2.5",
      availability: "listed" as const
    };

    const classification = classifyDiscoveredModel(alias);
    expect(classification).toMatchObject({
      compatibilityAlias: GPT_IMAGE_2_5_MODEL_ID,
      imageCapable: false,
      launchable: false
    });
    expect(classification.launchId).toBeUndefined();
    expect(classification.family).toBeUndefined();
    expect(summarizeDiscoveredModels([alias])).toEqual({
      total: 1,
      image: 0,
      video: 0,
      unknown: 1,
      gptImage2: [],
      gptImage25: [],
      otherImage: [],
      compatibilityAliases: [GPT_IMAGE_2_5_MODEL_ID]
    });
  });

  it("does not count an unconfirmed route candidate as discovery evidence", () => {
    const candidate = {
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai" as const,
      discoverySource: "route-candidate" as const,
      availability: "inconclusive" as const
    };
    expect(discoveredModelSource(candidate)).toBe("route-candidate");
    expect(summarizeDiscoveredModels([
      candidate,
      {
        id: GPT_IMAGE_2_MODEL_ID,
        providerKind: "openai",
        availability: "confirmed"
      }
    ])).toEqual({
      total: 1,
      image: 1,
      video: 0,
      unknown: 0,
      gptImage2: [GPT_IMAGE_2_MODEL_ID],
      gptImage25: [],
      otherImage: [],
      compatibilityAliases: []
    });
  });

  it("does not trust a familiar display name when the discovered provider family disagrees", () => {
    expect(discoveredModelDisplayName({
      id: GPT_IMAGE_2_5_MODEL_ID,
      providerKind: "custom",
      displayName: "GPT Image 2"
    })).toBe(GPT_IMAGE_2_5_MODEL_ID);
    expect(discoveredModelDisplayName({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      availability: "confirmed"
    })).toBe("GPT Image 2.5 · Sunburst");
    expect(discoveredModelDisplayName({
      id: GPT_IMAGE_2_5_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      raw: { image_generation: false }
    })).toBe(GPT_IMAGE_2_5_MODEL_ID);
    expect(discoveredModelDisplayName({
      id: "paint-model",
      providerKind: "custom",
      displayName: "GPT Image 2.5",
      raw: { image_generation: true }
    })).toBe("paint-model");
    expect(discoveredModelDisplayName({
      id: "paint-model",
      providerKind: "custom",
      displayName: "Nano Banana 3",
      raw: { image_generation: true }
    })).toBe("paint-model");
  });

  it("matches discovered models by provider family and canonical id", () => {
    const models = [
      { id: `models/${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}`, providerKind: "openai" as const, availability: "confirmed" as const },
      { id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID, providerKind: "gemini" as const, availability: "confirmed" as const },
      { id: "paint-model", providerKind: "custom" as const, displayName: "Paint image model", raw: { image_generation: true } }
    ];

    expect(findDiscoveredImageModel(models, "openai", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)?.id)
      .toBe(`models/${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}`);
    expect(findDiscoveredImageModel(models, "gemini", NANO_BANANA_3_MODEL_ALIAS)?.id).toBe(GEMINI_3_1_FLASH_IMAGE_MODEL_ID);
    expect(findDiscoveredImageModel(models, "openai", GEMINI_3_1_FLASH_IMAGE_MODEL_ID)).toBeUndefined();
    expect(findDiscoveredImageModel(models, "custom", "paint-model")?.id).toBe("paint-model");
  });

  it("treats discovery errors as unavailable even when stale model rows remain", () => {
    expect(hasCompletedModelDiscovery({
      discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      lastModelDiscoveryAt: "2026-09-14T00:00:00.000Z",
      lastModelDiscoveryError: "gateway unavailable"
    })).toBe(false);
    expect(hasCompletedModelDiscovery({
      discoveredModels: [],
      lastModelDiscoveryAt: "2026-09-14T00:00:00.000Z"
    })).toBe(true);
    expect(hasCompletedModelDiscovery({
      discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }]
    })).toBe(false);
    expect(hasCompletedModelDiscovery({
      discoveredModels: [],
      lastModelDiscoveryAt: "not-a-timestamp"
    })).toBe(false);
    expect(hasCompletedModelDiscovery({
      apiKeySaved: false,
      discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      lastModelDiscoveryAt: "2026-09-14T00:00:00.000Z"
    })).toBe(false);
    expect(hasCompletedModelDiscovery({
      encryptedApiKey: undefined,
      discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      lastModelDiscoveryAt: "2026-09-14T00:00:00.000Z"
    })).toBe(false);
    expect(hasCompletedModelDiscovery({
      encryptedApiKey: "plain:encrypted-key",
      discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      lastModelDiscoveryAt: "2026-09-14T00:00:00.000Z"
    })).toBe(true);
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
    expect(generalFallbackSupportsReferenceImages("openai", true)).toBe(true);
    expect(generalFallbackSupportsReferenceImages("custom", true)).toBe(true);
    expect(generalFallbackSupportsReferenceImages("gemini", false)).toBe(true);
  });

  it("requires exact-id edit route evidence for OpenAI-compatible General references", () => {
    const routing: OpenAIImageRouting = {
      modelId: "dall-e-3",
      preferredEditRoute: "image-api",
      probes: [
        {
          route: "image-api",
          mode: "edit",
          modelId: "dall-e-3",
          endpoint: "/images/edits",
          ok: true,
          verified: false,
          latencyMs: 12
        }
      ],
      updatedAt: new Date(0).toISOString()
    };

    expect(hasGeneralEditRouteEvidence(routing, "openai", "dall-e-3")).toBe(true);
    expect(hasGeneralEditRouteEvidence(routing, "openai", "flux-pro")).toBe(false);
    expect(hasGeneralEditRouteEvidence(routing, "gemini", "dall-e-3")).toBe(false);
    expect(
      hasGeneralEditRouteEvidence(
        { ...routing, probes: [{ ...routing.probes[0], modelUnavailable: true }] },
        "openai",
        "dall-e-3"
      )
    ).toBe(false);
    expect(hasGeneralEditRouteEvidence(undefined, "openai", "dall-e-3")).toBe(false);
  });
});
