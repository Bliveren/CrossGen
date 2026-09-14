import type { DiscoveredModel, FocusedLaunchId, FocusedModelDefinition, ProviderKind } from "./types.js";

export const GPT_IMAGE_2_LAUNCH_ID = "gpt-image-2" as const;
export const GPT_IMAGE_2_MODEL_ID = "gpt-image-2" as const;
export const GPT_IMAGE_2_5_LAUNCH_ID = "gpt-image-2.5" as const;
export const GPT_IMAGE_2_5_SUNBURST_MODEL_ID = "gpt-image-2.5-sunburst" as const;
export const GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID = "gpt-image-2.5-sunburst-2026-09-08" as const;
export const GPT_IMAGE_2_5_FLARE_MODEL_ID = "gpt-image-2.5-flare" as const;
export const GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID = "gpt-image-2.5-flare-2026-09-08" as const;
export const GPT_IMAGE_2_5_MODEL_IDS = [
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID
] as const;
export const GPT_IMAGE_2_5_DEFAULT_MODEL_ID = GPT_IMAGE_2_5_SUNBURST_MODEL_ID;
export const NANO_BANANA_3_LAUNCH_ID = "nano-banana-3" as const;
/**
 * `nano-banana-3` is retained as the stable CrossGen launch/workflow id for
 * draft, history, and AppLink migration compatibility. These are the actual
 * Gemini Image provider model ids currently exposed by the approved gateways.
 */
export const GEMINI_3_1_FLASH_IMAGE_MODEL_ID = "gemini-3.1-flash-image" as const;
export const GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID = "gemini-3.1-flash-lite-image" as const;
export const GEMINI_3_PRO_IMAGE_MODEL_ID = "gemini-3-pro-image" as const;
export const GEMINI_IMAGE_MODEL_IDS = [
  GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
  GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID,
  GEMINI_3_PRO_IMAGE_MODEL_ID
] as const;
/** Legacy provider/workflow alias accepted in old drafts and AppLinks. */
export const NANO_BANANA_3_MODEL_ALIAS = NANO_BANANA_3_LAUNCH_ID;
/** @deprecated Use GEMINI_3_1_FLASH_IMAGE_MODEL_ID for provider requests. */
export const NANO_BANANA_3_MODEL_ID = GEMINI_3_1_FLASH_IMAGE_MODEL_ID;
export const GEMINI_IMAGE_DEFAULT_MODEL_ID = GEMINI_3_1_FLASH_IMAGE_MODEL_ID;
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
    launchId: GPT_IMAGE_2_5_LAUNCH_ID,
    displayName: "GPT Image 2.5",
    providerKind: "openai",
    modelIds: [...GPT_IMAGE_2_5_MODEL_IDS],
    defaultModelId: GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
    capabilities: {
      generate: true,
      edit: true,
      inpaint: "exact-mask",
      referenceImages: true,
      maxReferenceImages: 16,
      multiTurn: true,
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
    modelIds: [...GEMINI_IMAGE_MODEL_IDS],
    defaultModelId: GEMINI_IMAGE_DEFAULT_MODEL_ID,
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
  if (launchId === GPT_IMAGE_2_5_LAUNCH_ID) {
    return `${definition.displayName} · ${gptImage25VariantLabel(modelId)}`;
  }
  if (launchId === NANO_BANANA_3_LAUNCH_ID) {
    return geminiImageModelDisplayName(modelId);
  }
  return definition.launchId === GENERAL_LAUNCH_ID ? modelId || definition.displayName : definition.displayName;
}

export function geminiImageModelDisplayName(modelId: string): string {
  const providerDisplayName = geminiProviderModelDisplayName(modelId);
  const normalized = normalizeGeminiImageModelId(modelId);
  if (normalized === GEMINI_3_1_FLASH_IMAGE_MODEL_ID) {
    return `Nano Banana 3 · ${providerDisplayName}`;
  }
  return providerDisplayName;
}

export function geminiProviderModelDisplayName(modelId: string): string {
  const normalized = normalizeGeminiImageModelId(modelId);
  if (normalized === GEMINI_3_1_FLASH_IMAGE_MODEL_ID) return "Gemini 3.1 Flash Image";
  if (normalized === GEMINI_3_1_FLASH_LITE_IMAGE_MODEL_ID) return "Gemini 3.1 Flash Image Lite";
  if (normalized === GEMINI_3_PRO_IMAGE_MODEL_ID) return "Gemini 3 Pro Image";
  return modelId || "Gemini Image";
}

export function isGeminiImageModelId(modelId: string): boolean {
  const normalized = normalizeGeminiImageModelId(modelId);
  return GEMINI_IMAGE_MODEL_IDS.some((candidate) => normalizeModelId(candidate) === normalized);
}

/**
 * Convert the old CrossGen workflow/provider alias to the actual Gemini model
 * used on the wire. Unknown Gemini-compatible model ids are preserved so a
 * gateway can still expose them through General or an explicit configuration.
 */
export function normalizeGeminiImageModelId(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  return normalized === NANO_BANANA_3_MODEL_ALIAS ? GEMINI_IMAGE_DEFAULT_MODEL_ID : normalized;
}

export function isGptImage25ModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  return GPT_IMAGE_2_5_MODEL_IDS.some((candidate) => normalizeModelId(candidate) === normalized) ||
    /^gpt-image-2\.5-(?:sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?$/.test(normalized);
}

export function isGptImageModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  return normalized === normalizeModelId(GPT_IMAGE_2_MODEL_ID) || isGptImage25ModelId(normalized);
}

export function gptImage25VariantLabel(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  if (normalized.includes("flare")) return "Flare";
  if (normalized.includes("sunburst")) return "Sunburst";
  return "GPT Image 2.5";
}

export function getFocusedModelDisplayName(launchId: FocusedLaunchId, modelId: string): string {
  return getModelDisplayName(launchId, modelId);
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
  const normalizedId = providerKind === "gemini" ? normalizeGeminiImageModelId(modelId) : normalizeModelId(modelId);
  if (providerKind === "openai" && (normalizedId === normalizeModelId(GPT_IMAGE_2_MODEL_ID) || isGptImage25ModelId(normalizedId))) {
    return true;
  }
  return FOCUSED_MODEL_CATALOG.some(
    (definition) =>
      definition.launchId !== GENERAL_LAUNCH_ID &&
      definition.providerKind === providerKind &&
      definition.modelIds.some((id) => normalizeModelId(id) === normalizedId)
  );
}

export function getProviderKindForFocusedModelId(modelId: string): ProviderKind | undefined {
  const normalizedId = normalizeGeminiImageModelId(modelId);
  if (normalizedId === normalizeModelId(GPT_IMAGE_2_MODEL_ID) || isGptImage25ModelId(normalizedId)) return "openai";
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
    "architecture",
    "modality",
    "type",
    "model_type",
    "modeltype",
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
      if (
        ["type", "model-type", "modeltype", "modality", "architecture"].includes(normalizeToken(keyHint)) &&
        ["text", "image", "video", "audio", "text-to-image", "text-to-video"].some((candidate) => token.includes(candidate))
      ) {
        explicitMedia = true;
      }
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
  return discoveredModels.find((model) => model.providerKind === providerKind && isDiscoveredImageModel(model));
}

export function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^models\//, "");
}
