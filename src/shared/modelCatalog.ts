import type { DiscoveredModel, FocusedLaunchId, FocusedModelDefinition, ProviderKind } from "./types.js";

export const GPT_IMAGE_2_LAUNCH_ID = "gpt-image-2" as const;
export const GPT_IMAGE_2_MODEL_ID = "gpt-image-2" as const;
export const NANO_BANANA_3_LAUNCH_ID = "nano-banana-3" as const;
export const NANO_BANANA_3_MODEL_ID = "gemini-3.1-flash-image" as const;
export const GEMINI_3_PRO_IMAGE_MODEL_ID = "gemini-3-pro-image" as const;
export const GENERAL_LAUNCH_ID = "general" as const;
export const GENERAL_MODEL_ID = "general" as const;

/**
 * Capability hints advertised by a provider's model-discovery response.
 * `explicit` means the response contained a recognized capability/modalities
 * field; an id/display-name heuristic alone is deliberately not explicit.
 */
export interface DiscoveredModelCapabilityHints {
  image: boolean;
  video: boolean;
  explicit: boolean;
  /** A modality/capability declaration that can disprove the name heuristic. */
  explicitMedia: boolean;
}

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
      maxReferenceImages: 16,
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
      maxReferenceImages: 2,
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
      maxReferenceImages: 0,
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

/**
 * Read the capability metadata used by OpenAI-compatible gateways and Gemini.
 * Gateways disagree on the exact shape, so this intentionally accepts the
 * common key/array variants while ignoring free-form descriptions. This keeps
 * a text-only `/models` catalogue from being presented as image-capable.
 */
export function discoveredModelCapabilityHints(model: DiscoveredModel): DiscoveredModelCapabilityHints {
  const raw = model.raw;
  if (!raw || typeof raw !== "object") return { image: false, video: false, explicit: false, explicitMedia: false };

  let image = false;
  let video = false;
  let explicit = false;
  let explicitMedia = false;

  const imageTokens = [
    "image",
    "images",
    "image-generation",
    "image-generation-model",
    "image-generation-task",
    "image_generation",
    "imagegeneration",
    "text-to-image",
    "text2image",
    "generate-image",
    "generateimage",
    "dall-e"
  ];
  const videoTokens = [
    "video",
    "videos",
    "video-generation",
    "video_generation",
    "videogeneration",
    "text-to-video",
    "text2video",
    "generate-video",
    "generatevideos"
  ];
  const capabilityKeys = new Set([
    "capabilities",
    "modalities",
    "input_modalities",
    "output_modalities",
    "inputmodalities",
    "outputmodalities",
    "supported_modalities",
    "supportedmodalities",
    "supported_endpoints",
    "supportedendpoints",
    "supported_endpoint_types",
    "supportedendpointtypes",
    "supported_generation_methods",
    "supportedgenerationmethods",
    "tasks",
    "endpoints"
  ]);

  const normalizeToken = (value: string) => value.trim().toLowerCase().replace(/[\s./:]+/g, "-");
  const inspectValue = (value: unknown, keyHint = "", inspectAllKeys = false) => {
    if (typeof value === "boolean") {
      if (!value) return;
      const normalizedKey = normalizeToken(keyHint);
      if (normalizedKey.includes("image") || normalizedKey.includes("video") || normalizedKey.includes("modalit")) {
        explicitMedia = true;
      }
      if (imageTokens.some((token) => normalizedKey.includes(token))) image = true;
      if (videoTokens.some((token) => normalizedKey.includes(token))) video = true;
      return;
    }
    if (typeof value === "string") {
      const token = normalizeToken(value);
      if (imageTokens.some((candidate) => token.includes(candidate))) image = true;
      if (videoTokens.some((candidate) => token.includes(candidate))) video = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) inspectValue(item, keyHint, inspectAllKeys);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeToken(key);
      const recognized = capabilityKeys.has(key.toLowerCase()) || capabilityKeys.has(normalizedKey.replace(/-/g, "_"));
      if (!recognized && !inspectAllKeys) continue;
      explicit = true;
      if (
        normalizedKey.includes("modalit") ||
        normalizedKey.includes("image") ||
        normalizedKey.includes("video") ||
        (normalizedKey === "capabilities" && typeof child === "object" && child !== null)
      ) {
        explicitMedia = true;
      }
      // Inspect one level below capability containers and their direct fields.
      inspectValue(child, normalizedKey, inspectAllKeys || normalizedKey === "capabilities");
    }
  };

  inspectValue(raw);
  return { image, video, explicit, explicitMedia };
}

/** True when discovery metadata or the legacy model-id heuristic indicates image generation. */
export function isDiscoveredImageModel(model: DiscoveredModel): boolean {
  const hints = discoveredModelCapabilityHints(model);
  if (hints.explicitMedia) return hints.image;
  if (hints.image) return true;
  // A video-only model must never be offered to the image runtime.
  if (hints.video) return false;
  return isPotentialGeneralImageModel(model);
}

export function getGeneralImageModelCandidate(discoveredModels: DiscoveredModel[], providerKind: ProviderKind): DiscoveredModel | undefined {
  if (!isGeneralFallbackProvider(providerKind)) return undefined;
  return discoveredModels.find((model) => model.providerKind === providerKind && isPotentialGeneralImageModel(model));
}

export function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^models\//, "");
}
