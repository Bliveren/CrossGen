import type { DiscoveredModel, FocusedLaunchId, FocusedModelDefinition, ProviderKind } from "./types.js";

export const GPT_IMAGE_2_LAUNCH_ID = "gpt-image-2" as const;
export const GPT_IMAGE_2_MODEL_ID = "gpt-image-2" as const;
export const NANO_BANANA_3_LAUNCH_ID = "nano-banana-3" as const;
export const NANO_BANANA_3_MODEL_ID = "gemini-3.1-flash-image" as const;
export const GEMINI_3_PRO_IMAGE_MODEL_ID = "gemini-3-pro-image" as const;
export const GENERAL_LAUNCH_ID = "general" as const;
export const GENERAL_MODEL_ID = "general" as const;

const GENERAL_IMAGE_MODEL_MARKERS = [
  "image",
  "imagen",
  "dall-e",
  "dalle",
  "stable-diffusion",
  "sdxl",
  "flux",
  "recraft"
] as const;

export const FOCUSED_MODEL_CATALOG = [
  {
    launchId: GPT_IMAGE_2_LAUNCH_ID,
    displayName: "GPT Image 2",
    providerKind: "openai",
    modelIds: [GPT_IMAGE_2_MODEL_ID],
    defaultModelId: GPT_IMAGE_2_MODEL_ID,
    capabilities: {
      generate: true,
      edit: true,
      inpaint: "exact-mask",
      referenceImages: true,
      multiTurn: false,
      streamingPartials: true,
      outputText: false,
      configurableOutputFormat: true,
      configurableResolution: "openai-size",
      supportsThinking: false,
      supportsSearchGrounding: false
    }
  },
  {
    launchId: NANO_BANANA_3_LAUNCH_ID,
    displayName: "Nano Banana 3",
    providerKind: "gemini",
    modelIds: [NANO_BANANA_3_MODEL_ID, GEMINI_3_PRO_IMAGE_MODEL_ID],
    defaultModelId: NANO_BANANA_3_MODEL_ID,
    capabilities: {
      generate: true,
      edit: true,
      inpaint: "guided-region",
      referenceImages: true,
      multiTurn: true,
      streamingPartials: false,
      outputText: true,
      configurableOutputFormat: false,
      configurableResolution: "gemini-resolution-aspect",
      supportsThinking: true,
      supportsSearchGrounding: true
    }
  },
  {
    launchId: GENERAL_LAUNCH_ID,
    displayName: "General",
    providerKind: "custom",
    modelIds: [GENERAL_MODEL_ID],
    defaultModelId: GENERAL_MODEL_ID,
    capabilities: {
      generate: true,
      edit: false,
      inpaint: false,
      referenceImages: false,
      multiTurn: false,
      streamingPartials: false,
      outputText: false,
      configurableOutputFormat: false,
      configurableResolution: "none",
      supportsThinking: false,
      supportsSearchGrounding: false
    }
  }
] as const satisfies readonly FocusedModelDefinition[];

export function getFocusedModelDefinition(launchId: FocusedLaunchId): FocusedModelDefinition | undefined {
  return FOCUSED_MODEL_CATALOG.find((definition) => definition.launchId === launchId);
}

export function getFocusedModelsForProvider(providerKind: ProviderKind): FocusedModelDefinition[] {
  if (providerKind === "custom") {
    return FOCUSED_MODEL_CATALOG.filter((definition) => definition.launchId === GENERAL_LAUNCH_ID);
  }
  return FOCUSED_MODEL_CATALOG.filter(
    (definition) => definition.providerKind === providerKind || definition.launchId === GENERAL_LAUNCH_ID
  );
}

export function getModelDisplayName(launchId: FocusedLaunchId, modelId: string): string {
  const definition = getFocusedModelDefinition(launchId);
  if (!definition) return modelId;
  return definition.launchId === GENERAL_LAUNCH_ID ? modelId || definition.displayName : definition.displayName;
}

export function isGeneralFallbackProvider(providerKind: ProviderKind): boolean {
  return providerKind === "gemini" || providerKind === "openai" || providerKind === "custom";
}

export function isOpenAICompatibleGeneralFallbackProvider(providerKind: ProviderKind): providerKind is "openai" | "custom" {
  return providerKind === "openai" || providerKind === "custom";
}

export function generalFallbackSupportsReferenceImages(providerKind: ProviderKind): boolean {
  return providerKind === "gemini";
}

export function isFocusedImageModelId(providerKind: ProviderKind, modelId: string): boolean {
  const normalizedId = normalizeModelId(modelId);
  return FOCUSED_MODEL_CATALOG.some(
    (definition) =>
      definition.launchId !== GENERAL_LAUNCH_ID &&
      definition.providerKind === providerKind &&
      definition.modelIds.some((id) => normalizeModelId(id) === normalizedId)
  );
}

export function getProviderKindForFocusedModelId(modelId: string): ProviderKind | undefined {
  const normalizedId = normalizeModelId(modelId);
  return FOCUSED_MODEL_CATALOG.find(
    (definition) =>
      definition.launchId !== GENERAL_LAUNCH_ID &&
      definition.modelIds.some((id) => normalizeModelId(id) === normalizedId)
  )?.providerKind;
}

export function isPotentialGeneralImageModel(model: DiscoveredModel): boolean {
  if (isFocusedImageModelId(model.providerKind, model.id)) return false;
  const haystack = normalizeModelId([model.id, model.displayName].filter(Boolean).join(" "));
  return GENERAL_IMAGE_MODEL_MARKERS.some((marker) => haystack.includes(marker));
}

export function getGeneralImageModelCandidate(discoveredModels: DiscoveredModel[], providerKind: ProviderKind): DiscoveredModel | undefined {
  if (!isGeneralFallbackProvider(providerKind)) return undefined;
  return discoveredModels.find((model) => model.providerKind === providerKind && isPotentialGeneralImageModel(model));
}

export function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^models\//, "");
}
