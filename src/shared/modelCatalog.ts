import type {
  DiscoveredModel,
  FocusedLaunchId,
  FocusedModelDefinition,
  ModelDiscoveryAvailability,
  ModelDiscoverySource,
  OpenAIImageRouting,
  ProviderKind
} from "./types.js";

export const GPT_IMAGE_2_LAUNCH_ID = "gpt-image-2" as const;
export const GPT_IMAGE_2_MODEL_ID = "gpt-image-2" as const;
export const GPT_IMAGE_2_SNAPSHOT_MODEL_ID = "gpt-image-2-2026-04-21" as const;
export const GPT_IMAGE_2_MODEL_IDS = [
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_SNAPSHOT_MODEL_ID
] as const;
export const GPT_IMAGE_2_5_LAUNCH_ID = "gpt-image-2.5" as const;
/**
 * Stable CrossGen launch id used by older drafts and AppLinks. This is a
 * product/workflow alias, not a provider model id. Provider discovery must
 * never promote this bare value to GPT Image 2.5 support; only the concrete
 * Sunburst/Flare ids (or a provider-listed dated snapshot) are authoritative.
 */
export const GPT_IMAGE_2_5_MODEL_ID = "gpt-image-2.5" as const;
export const GPT_IMAGE_2_5_SUNBURST_MODEL_ID = "gpt-image-2.5-sunburst" as const;
export const GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID = "gpt-image-2.5-sunburst-2026-09-08" as const;
export const GPT_IMAGE_2_5_FLARE_MODEL_ID = "gpt-image-2.5-flare" as const;
export const GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID = "gpt-image-2.5-flare-2026-09-08" as const;
/** Exact provider ids known to belong to the GPT Image 2.5 family. */
export const GPT_IMAGE_2_5_PROVIDER_MODEL_IDS = [
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID
] as const;
export const GPT_IMAGE_2_5_MODEL_IDS = [
  ...GPT_IMAGE_2_5_PROVIDER_MODEL_IDS
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
  /** A positive or negative image capability declaration was present. */
  explicitImage: boolean;
  /** At least one explicit image declaration denied image generation. */
  imageDenied: boolean;
  /** An output modality declaration explicitly included image output. */
  explicitOutputImage: boolean;
  /** An output modality declaration explicitly excluded image output. */
  explicitOutputNonImage: boolean;
  /** A positive or negative video capability declaration was present. */
  explicitVideo: boolean;
  /** At least one explicit video declaration denied video generation. */
  videoDenied: boolean;
  /** A positive text-output declaration was present. */
  explicitText: boolean;
  /** A media/output declaration that can disprove the name heuristic. */
  explicitMedia: boolean;
}

export interface ModelDiscoveryState {
  discoveredModels: DiscoveredModel[];
  apiKeySaved?: boolean;
  /**
   * Stored provider states keep the encrypted key on the same object while
   * public renderer snapshots expose `apiKeySaved`. Keeping this optional
   * field here lets the shared completion check reject a stale discovery
   * timestamp when the persisted key has since been removed.
   */
  encryptedApiKey?: string;
  lastModelDiscoveryAt?: string;
  lastModelDiscoveryError?: string;
}

/**
 * A normalized, user-facing inventory of the latest successful discovery.
 *
 * The raw `/models` row count is intentionally kept separate from the
 * confirmed image count. A gateway may return text, audio, video, or utility
 * models alongside image models, and those rows must never make a launch
 * appear available. The family arrays contain the exact provider ids that
 * support the corresponding launch.
 */
export interface DiscoveredModelInventory {
  total: number;
  image: number;
  video: number;
  unknown: number;
  gptImage2: string[];
  gptImage25: string[];
  otherImage: string[];
  /** CrossGen workflow aliases that are not provider support evidence. */
  compatibilityAliases: string[];
}

export interface DiscoveredModelClassification {
  /**
   * Provider id with a resource prefix removed, while preserving the
   * provider's original casing for display and wire requests.
   */
  exactModelId: string;
  /** Exact focused family inferred from provider kind + model id. */
  launchId?: FocusedLaunchId;
  /** Focused launch family, excluding the generic General fallback. */
  family?: Exclude<FocusedLaunchId, "general">;
  /**
   * A persisted CrossGen compatibility alias. This is intentionally separate
   * from `launchId`: an alias can restore old drafts but must not imply that
   * the provider exposes that focused model.
   */
  compatibilityAlias?: "gpt-image-2.5";
  /** Capability classification independent from launch availability. */
  imageCapable: boolean;
  /** Whether this row is safe to expose as a selectable launch target. */
  launchable: boolean;
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

// A model id can mention images while only understanding, captioning, or
// embedding them. These markers are only a fallback veto when the provider
// omitted explicit capability metadata; an explicit image-generation field
// remains authoritative. A provider display name is never used to add image
// capability because gateways frequently reuse or localize it incorrectly.
const GENERAL_NON_GENERATIVE_MODEL_MARKERS = [
  "image-to-text",
  "image2text",
  "image-to-audio",
  "image2audio",
  "caption",
  "captioner",
  "classifier",
  "classification",
  "embedding",
  "encoder",
  "moderation",
  "ocr",
  "rerank",
  "transcription",
  "understanding",
  "vision"
] as const;

export const FOCUSED_MODEL_CATALOG = [
  {
    launchId: GPT_IMAGE_2_LAUNCH_ID,
    displayName: "GPT Image 2",
    providerKind: "openai",
    modelIds: [...GPT_IMAGE_2_MODEL_IDS],
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
    const variantLabel = gptImage25VariantLabel(modelId);
    return variantLabel === definition.displayName ? definition.displayName : `${definition.displayName} · ${variantLabel}`;
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
  return isGptImage25ProviderModelId(modelId) || isGptImage25LaunchAlias(modelId);
}

/**
 * Match exact GPT Image 2.5 provider ids.
 *
 * `gpt-image-2.5` is deliberately excluded here. It remains a CrossGen launch
 * alias for old drafts/AppLinks, but a provider discovery row must use a
 * concrete Sunburst/Flare id or a valid dated snapshot before it proves GPT
 * Image 2.5 support.
 */
export function isGptImage25ProviderModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  if (GPT_IMAGE_2_5_MODEL_IDS.some((candidate) => normalizeModelId(candidate) === normalized)) return true;
  // Providers may expose a dated base snapshot as well as dated Sunburst or
  // Flare variants. The date is part of the provider id, so validate it
  // rather than accepting arbitrary suffixes that could be a different model.
  const snapshot = normalized.match(/^gpt-image-2\.5(?:-(?:sunburst|flare))?-(\d{4}-\d{2}-\d{2})$/);
  if (snapshot?.[1]) return isValidIsoDate(snapshot[1]);
  return false;
}

export function isGptImage25LaunchAlias(modelId: string): boolean {
  return normalizeModelId(modelId) === normalizeModelId(GPT_IMAGE_2_5_LAUNCH_ID);
}

function isValidIsoDate(value: string): boolean {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);
  if (!match?.groups) return false;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

/** Exact GPT Image 2 family matcher; GPT Image 2.5 never matches this. */
export function isGptImage2ModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  if (GPT_IMAGE_2_MODEL_IDS.some((candidate) => normalizeModelId(candidate) === normalized)) return true;
  const snapshot = normalized.match(/^gpt-image-2-(\d{4}-\d{2}-\d{2})$/);
  return Boolean(snapshot?.[1] && isValidIsoDate(snapshot[1]));
}

export function isGptImageModelId(modelId: string): boolean {
  return isGptImage2ModelId(modelId) || isGptImage25ModelId(modelId);
}

/** Normalize a model id using the id rules of the provider family that owns it. */
export function normalizeProviderModelId(providerKind: ProviderKind, modelId: string): string {
  return providerKind === "gemini" ? normalizeGeminiImageModelId(modelId) : normalizeModelId(modelId);
}

/**
 * Resolve a focused CrossGen launch only when the discovered provider family
 * agrees with the model family. A custom/unknown model intentionally falls
 * through to General instead of being promoted by a familiar model id.
 */
export function focusedLaunchIdForModel(providerKind: ProviderKind, modelId: string): FocusedLaunchId | undefined {
  const normalized = normalizeProviderModelId(providerKind, modelId);
  if (providerKind === "openai") {
    if (isGptImage2ModelId(normalized)) return GPT_IMAGE_2_LAUNCH_ID;
    if (isGptImage25ProviderModelId(normalized)) return GPT_IMAGE_2_5_LAUNCH_ID;
  }
  if (providerKind === "gemini" && isGeminiImageModelId(normalized)) {
    return NANO_BANANA_3_LAUNCH_ID;
  }
  return undefined;
}

/**
 * Classify a discovered row from its exact provider identity.
 *
 * `displayName` is deliberately not inspected here. Providers frequently
 * reuse or localize that field, while `id` is the only stable discriminator
 * for GPT Image 2 versus GPT Image 2.5. Availability is kept separate from
 * family identity so a listed/rejected row can still be shown as evidence
 * under the correct disabled launch.
 */
export function classifyDiscoveredModel(model: DiscoveredModel): DiscoveredModelClassification {
  const exactModelId = stripModelResourcePrefix(model.id);
  const launchId = focusedLaunchIdForModel(model.providerKind, exactModelId);
  const compatibilityAlias = isGptImage25LaunchAlias(exactModelId)
    ? GPT_IMAGE_2_5_MODEL_ID
    : undefined;
  const imageCapable = isDiscoveredImageModel(model);
  const launchable = imageCapable && (
    launchId !== undefined
      ? model.availability === "confirmed"
      : model.availability !== "rejected" && model.availability !== "inconclusive"
  );
  return {
    exactModelId,
    ...(launchId ? { launchId } : {}),
    ...(launchId && launchId !== GENERAL_LAUNCH_ID ? { family: launchId } : {}),
    ...(compatibilityAlias ? { compatibilityAlias } : {}),
    imageCapable,
    launchable
  };
}

/**
 * Resolve a display label from the provider family and the exact model id.
 * A fallback launch supplies the provider family only when the provider did
 * not persist one (for example, a legacy job). General is intentionally
 * treated as an explicit "unknown/custom" context so a custom model whose id
 * happens to resemble a focused model is not relabeled.
 */
export function getModelDisplayNameForProvider(
  providerKind: ProviderKind | undefined,
  modelId: string,
  fallbackLaunchId?: FocusedLaunchId
): string {
  const rawModelId = modelId.trim();
  if (!rawModelId) {
    if (fallbackLaunchId) {
      return getFocusedModelDefinition(fallbackLaunchId)?.displayName ?? "";
    }
    return "";
  }

  const fallbackProviderKind = fallbackLaunchId && fallbackLaunchId !== GENERAL_LAUNCH_ID
    ? getFocusedModelDefinition(fallbackLaunchId)?.providerKind
    : undefined;
  const inferredProviderKind = providerKind ??
    fallbackProviderKind ??
    (fallbackLaunchId === GENERAL_LAUNCH_ID ? undefined : getProviderKindForFocusedModelId(rawModelId));
  const focusedLaunchId = inferredProviderKind
    ? focusedLaunchIdForModel(inferredProviderKind, rawModelId)
    : undefined;
  if (focusedLaunchId) {
    return getModelDisplayName(
      focusedLaunchId,
      normalizeProviderModelId(inferredProviderKind!, rawModelId)
    );
  }

  return rawModelId;
}

/**
 * Use provider display names only when the discovered row belongs to the
 * matching focused family. If a gateway reuses a familiar id/display name
 * under another family, the exact id is the only non-misleading label.
 */
export function discoveredModelDisplayName(model: DiscoveredModel): string {
  const classification = classifyDiscoveredModel(model);
  const focusedLaunchId = classification.launchId;
  if (focusedLaunchId) {
    // A familiar id is not enough when the gateway explicitly denies image
    // output for this deployment. Keep the raw provider id visible instead
    // of presenting a focused product label that implies image support.
    if (!classification.launchable) return model.id;
    return getModelDisplayName(
      focusedLaunchId,
      normalizeProviderModelId(model.providerKind, classification.exactModelId)
    );
  }

  const knownProviderKind = getProviderKindForFocusedModelId(model.id);
  if (knownProviderKind && knownProviderKind !== model.providerKind) {
    return model.id;
  }

  const displayName = model.displayName?.trim();
  // A gateway can attach a stale product label to an unrelated custom model.
  // Never let that advisory label make a General row look like a supported
  // GPT Image/Nano Banana launch; the exact provider id is the only safe
  // fallback in that case.
  if (displayName && !looksLikeFocusedModelDisplayName(displayName)) {
    return displayName;
  }
  return model.id;
}

function looksLikeFocusedModelDisplayName(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.startsWith("gpt-image-2") ||
    normalized.startsWith("nano-banana-3") ||
    (normalized.startsWith("gemini-3") && normalized.includes("image"));
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

/**
 * Gemini General fallback supports reference images natively. The
 * OpenAI-compatible fallback only exposes edit/reference support after the
 * main process has confirmed the exact provider model id on the image edit
 * route; callers without evidence must stay prompt-only.
 */
export function generalFallbackSupportsReferenceImages(
  providerKind: ProviderKind,
  referenceEditConfirmed = false
): boolean {
  if (providerKind === "gemini") return true;
  if (!isOpenAICompatibleGeneralFallbackProvider(providerKind)) return false;
  return referenceEditConfirmed;
}

/**
 * General OpenAI-compatible edit evidence is a validation-only route probe
 * bound to the exact provider model id. A reachable edit route (2xx or a
 * validation-only 400/422 that does not reject the model) is enough to offer
 * the capability; explicit model rejection or a missing route is not.
 */
export function hasGeneralEditRouteEvidence(
  routing: OpenAIImageRouting | undefined,
  providerKind: ProviderKind,
  modelId: string
): boolean {
  if (!isOpenAICompatibleGeneralFallbackProvider(providerKind)) return false;
  const requested = normalizeProviderModelId(providerKind, modelId);
  if (!requested) return false;
  return (routing?.probes ?? []).some(
    (probe) =>
      probe.route === "image-api" &&
      probe.mode === "edit" &&
      probe.ok === true &&
      probe.modelUnavailable !== true &&
      normalizeProviderModelId(providerKind, probe.modelId ?? "") === requested
  );
}

export function isFocusedImageModelId(providerKind: ProviderKind, modelId: string): boolean {
  const normalizedId = providerKind === "gemini" ? normalizeGeminiImageModelId(modelId) : normalizeModelId(modelId);
  if (providerKind === "openai" && (isGptImage2ModelId(normalizedId) || isGptImage25ProviderModelId(normalizedId))) {
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
  if (isGptImage2ModelId(normalizedId) || isGptImage25ProviderModelId(normalizedId)) return "openai";
  return FOCUSED_MODEL_CATALOG.find(
    (definition) =>
      definition.launchId !== GENERAL_LAUNCH_ID &&
      definition.modelIds.some((id) => normalizeModelId(id) === normalizedId)
  )?.providerKind;
}

export function isPotentialGeneralImageModel(model: DiscoveredModel): boolean {
  // Do not expose a known GPT Image 2.5 id as a generic image model when a
  // gateway mis-tags it as custom/Gemini. OpenAI-compatible discovery
  // reclassifies exact ids to `providerKind: "openai"` before this fallback.
  if (isGptImage25LaunchAlias(model.id)) return false;
  if (isFocusedImageModelId(model.providerKind, model.id)) return false;
  const focusedProviderKind = getProviderKindForFocusedModelId(model.id);
  if (focusedProviderKind && focusedProviderKind !== model.providerKind && model.providerKind !== "custom") {
    return false;
  }
  const idHaystack = normalizeModelId(model.id);
  const displayNameHaystack = normalizeModelId(model.displayName ?? "");
  if (
    GENERAL_NON_GENERATIVE_MODEL_MARKERS.some((marker) =>
      idHaystack.includes(marker) || displayNameHaystack.includes(marker)
    )
  ) {
    return false;
  }
  // A provider display name is advisory and is frequently stale or reused
  // across deployments. It may veto an image-looking id when it explicitly
  // says "vision"/"captioner", but it must never be the positive evidence that
  // turns a generic provider id into an image-generation model.
  return GENERAL_IMAGE_MODEL_MARKERS.some((marker) => idHaystack.includes(marker));
}

/**
 * Read the capability metadata used by OpenAI-compatible gateways and Gemini.
 * Gateways disagree on the exact shape, so this intentionally accepts the
 * common key/array variants while ignoring free-form descriptions. This keeps
 * a text-only `/models` catalogue from being presented as image-capable.
 */
export function discoveredModelCapabilityHints(model: DiscoveredModel): DiscoveredModelCapabilityHints {
  const raw = model.raw;
  if (!raw || typeof raw !== "object") {
    return {
      image: false,
      video: false,
      explicit: false,
      explicitImage: false,
      imageDenied: false,
      explicitOutputImage: false,
      explicitOutputNonImage: false,
      explicitVideo: false,
      videoDenied: false,
      explicitText: false,
      explicitMedia: false
    };
  }

  let image = false;
  let video = false;
  let explicit = false;
  let explicitImage = false;
  let imageDenied = false;
  let explicitOutputImage = false;
  let explicitOutputNonImage = false;
  let explicitVideo = false;
  let videoDenied = false;
  let explicitText = false;
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
  const textTokens = [
    "text",
    "texts",
    "text-generation",
    "text_generation",
    "textgeneration",
    "text-only",
    "text_only",
    "textonly"
  ];
  const nonImageOutputTokens = [...textTokens, "audio", "audio-generation", "audio_generation", "audiogeneration"];
  // Directional task names need to be handled before the broad `image`
  // marker. `image-to-text` consumes an image but does not produce one,
  // whereas `text-to-image` is a real image-generation task.
  const imageOutputTaskTokens = [
    "text-to-image",
    "text2image",
    "image-generation",
    "image-generation-model",
    "image-generation-task",
    "generate-image",
    "generateimage",
    "image-output",
    "imageoutput"
  ];
  const imageInputOnlyTaskTokens = [
    "image-to-text",
    "image2text",
    "image-to-audio",
    "image2audio",
    "image-caption",
    "image-captioning",
    "image-classification",
    "image-embedding",
    "image-understanding",
    "vision",
    "vision-encoder",
    "vision-language"
  ];
  const capabilityKeys = new Set([
    "capabilities",
    "image",
    "images",
    "video",
    "videos",
    "text",
    "audio",
    "input",
    "inputs",
    "output",
    "outputs",
    "modalities",
    "input_modalities",
    "output_modalities",
    "inputmodalities",
    "outputmodalities",
    "supported_modalities",
    "supportedmodalities",
    "supported_input_modalities",
    "supportedinputmodalities",
    "supported_output_modalities",
    "supportedoutputmodalities",
    "supported_endpoints",
    "supportedendpoints",
    "supported_endpoint_types",
    "supportedendpointtypes",
    "supported_generation_methods",
    "supportedgenerationmethods",
    "supports",
    "supported",
    "enabled",
    "available",
    "generates",
    "generation_supported",
    "generationsupported",
    "generation_enabled",
    "generationenabled",
    "generation_modalities",
    "generationmodalities",
    "image_generation",
    "imagegeneration",
    "image_output",
    "imageoutput",
    "supports_image",
    "supportsimage",
    "supports_image_generation",
    "supportsimagegeneration",
    "image_generation_supported",
    "imagegenerationsupported",
    "video_generation",
    "videogeneration",
    "supports_video_generation",
    "supportsvideogeneration",
    "video_generation_supported",
    "videogenerationsupported",
    "text_generation",
    "textgeneration",
    "supports_text_generation",
    "supportstextgeneration",
    "text_generation_supported",
    "textgenerationsupported",
    "architecture",
    "modality",
    "type",
    "model_type",
    "modeltype",
    "tasks",
    "endpoints"
  ]);

  const normalizeToken = (value: string) =>
    value
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[\s./:]+/g, "-");
  const canonicalToken = (value: string) => normalizeToken(value).replace(/_/g, "-");
  const hasCapabilityToken = (value: string, tokens: readonly string[]) => {
    const canonicalValue = canonicalToken(value);
    return tokens.some((token) => {
      const normalizedToken = canonicalToken(token);
      return canonicalValue === normalizedToken ||
        canonicalValue.startsWith(`${normalizedToken}-`) ||
        canonicalValue.includes(`-${normalizedToken}-`) ||
        canonicalValue.endsWith(`-${normalizedToken}`);
    });
  };
  const hasAnyCapabilityToken = (value: string, tokens: readonly string[]) =>
    hasCapabilityToken(value, tokens);
  const hasExactOrDelimitedToken = (value: string, tokens: readonly string[]) => {
    const canonicalValue = canonicalToken(value);
    return tokens.some((token) => {
      const canonicalTokenValue = canonicalToken(token);
      return canonicalValue === canonicalTokenValue ||
        canonicalValue.startsWith(`${canonicalTokenValue}-`) ||
        canonicalValue.includes(`-${canonicalTokenValue}-`) ||
        canonicalValue.endsWith(`-${canonicalTokenValue}`);
    });
  };
  const isNegativeCapabilityValue = (value: string) =>
    /^(?:false|no|none|not|unsupported|disabled|unavailable)(?:-|$)/.test(value) ||
    /-(?:false|no|none|not|unsupported|disabled|unavailable)(?:-|$)/.test(value);
  const isPositiveCapabilityValue = (value: string) =>
    /^(?:true|yes|supported|enabled|available)(?:-|$)/.test(value) ||
    /-(?:true|yes|supported|enabled|available)(?:-|$)/.test(value);
  const capabilityStatusKeys = new Set([
    "supported",
    "supports",
    "enabled",
    "available",
    "generates",
    "generation-supported",
    "generation-enabled"
  ]);
  const isCapabilityStatusKey = (keyHint: string) =>
    capabilityStatusKeys.has(canonicalToken(keyHint));
  const isInputContext = (keyHint: string) => {
    const normalizedKey = canonicalToken(keyHint);
    return normalizedKey === "input" ||
      normalizedKey === "inputs" ||
      normalizedKey.startsWith("input-") ||
      normalizedKey.includes("-input-") ||
      normalizedKey.endsWith("-input");
  };
  const isOutputContext = (keyHint: string) => {
    const normalizedKey = canonicalToken(keyHint);
    return normalizedKey === "output" ||
      normalizedKey === "outputs" ||
      normalizedKey.startsWith("output-") ||
      normalizedKey.includes("-output-") ||
      normalizedKey.endsWith("-output") ||
      normalizedKey === "modalities" ||
      normalizedKey === "supported-modalities" ||
      normalizedKey === "generation-modalities";
  };
  const isOutputMediaDeclaration = (keyHint: string) => {
    const normalizedKey = canonicalToken(keyHint);
    return normalizedKey === "modalities" ||
      normalizedKey.endsWith("-modalities") ||
      normalizedKey === "type" ||
      normalizedKey === "model-type" ||
      normalizedKey === "modeltype" ||
      normalizedKey === "modality" ||
      normalizedKey === "architecture";
  };
  const inspectValue = (
    value: unknown,
    keyHint = "",
    inspectAllKeys = false,
    inheritedContext: "input" | "output" | "unknown" = "unknown",
    inheritedMedia: "image" | "video" | "text" | undefined = undefined
  ) => {
    const normalizedKey = canonicalToken(keyHint);
    const outputKey = isOutputContext(normalizedKey) &&
      (normalizedKey !== "modalities" || inheritedContext !== "input");
    const context = isInputContext(normalizedKey)
      ? "input"
      : outputKey
        ? "output"
        : inheritedContext;
    const inputContext = context === "input";
    const outputContext = context !== "input";
    const keyHasImage = hasAnyCapabilityToken(normalizedKey, imageTokens);
    const keyHasVideo = hasAnyCapabilityToken(normalizedKey, videoTokens);
    const keyHasText = hasAnyCapabilityToken(normalizedKey, textTokens);
    const mediaContext = keyHasImage
      ? "image"
      : keyHasVideo
        ? "video"
        : keyHasText
          ? "text"
          : inheritedMedia;

    if (typeof value === "boolean") {
      if (inputContext) return;
      if (mediaContext === "image" && isCapabilityStatusKey(normalizedKey)) {
        explicitImage = true;
        explicitMedia = true;
        if (value) image = true;
        else imageDenied = true;
      }
      if (mediaContext === "video" && isCapabilityStatusKey(normalizedKey)) {
        explicitVideo = true;
        if (value) {
          video = true;
          explicitMedia = true;
        } else videoDenied = true;
      }
      if (mediaContext === "text" && isCapabilityStatusKey(normalizedKey) && value) {
        explicitText = true;
        explicitMedia = true;
      }
      if (keyHasImage) {
        explicitImage = true;
        if (value) image = true;
        else imageDenied = true;
        explicitMedia = true;
      }
      if (keyHasVideo) {
        explicitVideo = true;
        if (value) {
          video = true;
          explicitMedia = true;
        } else videoDenied = true;
      }
      if (keyHasText && value) {
        explicitText = true;
        explicitMedia = true;
      }
      return;
    }
    if (typeof value === "string") {
      const token = canonicalToken(value);
      const negativeValue = isNegativeCapabilityValue(token);
      const positiveValue = isPositiveCapabilityValue(token);
      if (outputContext && mediaContext === "image" && isCapabilityStatusKey(normalizedKey)) {
        explicitImage = true;
        explicitMedia = true;
        if (negativeValue) imageDenied = true;
        else if (positiveValue) image = true;
      }
      if (outputContext && mediaContext === "video" && isCapabilityStatusKey(normalizedKey)) {
        explicitVideo = true;
        if (negativeValue) videoDenied = true;
        else if (positiveValue) {
          video = true;
          explicitMedia = true;
        }
      }
      if (outputContext && mediaContext === "text" && isCapabilityStatusKey(normalizedKey) && positiveValue) {
        explicitText = true;
        explicitMedia = true;
      }
      if (
        outputContext &&
        ["type", "model-type", "modeltype", "modality", "architecture"].includes(normalizedKey) &&
        ["text", "image", "video", "audio", "text-to-image", "text-to-video"].some((candidate) => token.includes(canonicalToken(candidate)))
      ) {
        explicitMedia = true;
      }
      if (outputContext && isOutputMediaDeclaration(normalizedKey)) {
        const isImageOutputTask = hasExactOrDelimitedToken(token, imageOutputTaskTokens);
        const isImageInputOnlyTask = hasExactOrDelimitedToken(token, imageInputOnlyTaskTokens);
        if (isImageOutputTask) {
          explicitOutputImage = true;
        } else if (isImageInputOnlyTask) {
          explicitOutputNonImage = true;
        } else if (hasAnyCapabilityToken(token, imageTokens)) {
          explicitOutputImage = true;
        }
        if (
          (!isImageOutputTask && !isImageInputOnlyTask && hasAnyCapabilityToken(token, nonImageOutputTokens)) ||
          token === "video"
        ) {
          explicitOutputNonImage = true;
        }
      }
      // An input-only directional task must never be promoted by the broad
      // `image` substring checks below.
      if (outputContext && hasExactOrDelimitedToken(token, imageInputOnlyTaskTokens)) {
        explicitMedia = true;
        return;
      }
      if (outputContext && keyHasImage) {
        explicitImage = true;
        if (!negativeValue) image = true;
        else imageDenied = true;
        explicitMedia = true;
      }
      if (outputContext && keyHasVideo) {
        explicitVideo = true;
        if (!negativeValue) {
          video = true;
          explicitMedia = true;
        } else videoDenied = true;
      }
      if (outputContext && hasAnyCapabilityToken(token, imageTokens) && !negativeValue) {
        image = true;
        explicitImage = true;
        explicitMedia = true;
      }
      if (outputContext && hasAnyCapabilityToken(token, imageTokens) && negativeValue) {
        explicitImage = true;
        imageDenied = true;
        explicitMedia = true;
      }
      if (outputContext && hasAnyCapabilityToken(token, videoTokens) && !negativeValue) {
        video = true;
        explicitVideo = true;
        explicitMedia = true;
      }
      if (outputContext && hasAnyCapabilityToken(token, videoTokens) && negativeValue) {
        explicitVideo = true;
        videoDenied = true;
      }
      if (outputContext && hasCapabilityToken(token, textTokens)) {
        if (!negativeValue) {
          explicitText = true;
          explicitMedia = true;
        }
      }
      if (outputContext && hasCapabilityToken(token, nonImageOutputTokens)) {
        explicitMedia = true;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) inspectValue(item, keyHint, inspectAllKeys, context, mediaContext);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeToken(key);
      const recognized = capabilityKeys.has(key.toLowerCase()) || capabilityKeys.has(normalizedKey.replace(/-/g, "_"));
      if (!recognized && !inspectAllKeys) continue;
      explicit = true;
      // Inspect one level below capability containers and their direct fields.
      const inspectNestedCapabilityFields = inspectAllKeys ||
        ["capabilities", "input", "inputs", "output", "outputs", "modalities", "input-modalities", "output-modalities",
          "supported-modalities", "supported-input-modalities", "supported-output-modalities", "generation-modalities",
          "supports", "supported", "enabled", "available", "generates", "generation-supported", "generation-enabled"]
          .includes(normalizedKey) ||
        normalizedKey.includes("modalit") ||
        normalizedKey.includes("generation");
      inspectValue(child, normalizedKey, inspectNestedCapabilityFields, context, mediaContext);
    }
  };

  inspectValue(raw);
  return {
    image,
    video,
    explicit,
    explicitImage,
    imageDenied,
    explicitOutputImage,
    explicitOutputNonImage,
    explicitVideo,
    videoDenied,
    explicitText,
    explicitMedia
  };
}

/** True when discovery metadata or the legacy model-id heuristic indicates image generation. */
export function isDiscoveredImageModel(model: DiscoveredModel): boolean {
  const hints = discoveredModelCapabilityHints(model);
  // An explicit output modality is stronger than a broad capability flag. A
  // text/audio/video-only output must not be promoted by an image-looking id.
  if (hints.explicitOutputImage) return hints.image && !hints.imageDenied;
  if (hints.explicitOutputNonImage) return false;
  // An explicit image declaration, including `image_generation: false`, is
  // authoritative for image support. Video-only and text-only declarations
  // also disprove image support, but `video_generation: false` does not.
  if (hints.explicitImage) return hints.image && !hints.imageDenied;
  if (hints.explicitMedia) return hints.image && !hints.imageDenied;
  if (hints.image) return true;
  // A video-only model must never be offered to the image runtime.
  if (hints.video) return false;
  // A focused model id returned by discovery is sufficient evidence of the
  // image family when the gateway omits capability metadata. Explicit
  // text-only metadata still wins through the branch above.
  if (isFocusedImageModelId(model.providerKind, model.id)) return true;
  return isPotentialGeneralImageModel(model);
}

/**
 * A rejected row remains useful discovery evidence (and is shown in the
 * details panel), but it must never satisfy a launch or runtime preflight.
 * Missing availability is the legacy state shape and means "listed".
 */
export function isDiscoveredModelLaunchable(model: DiscoveredModel): boolean {
  return classifyDiscoveredModel(model).launchable;
}

export function discoveredModelAvailability(model: DiscoveredModel): ModelDiscoveryAvailability {
  if (model.availability) return model.availability;
  return "listed";
}

/**
 * Older persisted rows predate source tracking and therefore mean
 * "provider-listed". Only the product-injected route candidates need an
 * explicit source marker.
 */
export function discoveredModelSource(model: DiscoveredModel): ModelDiscoverySource {
  return model.discoverySource ?? "provider-listed";
}

/**
 * A route candidate is not discovery evidence until its exact image route
 * returns a positive confirmation. Keep provider-listed rows (including
 * inconclusive/rejected rows) for explainable UI, but fail closed for
 * speculative product-owned candidates.
 */
export function isPersistedDiscoveryEvidence(model: DiscoveredModel): boolean {
  return discoveredModelSource(model) !== "route-candidate" ||
    discoveredModelAvailability(model) === "confirmed";
}

/**
 * Resolve the product launch represented by a discovered row only after the
 * row has passed the image-output capability classifier. The familiar model
 * id remains the source of truth for GPT Image 2 versus GPT Image 2.5; a
 * provider-supplied display name can never change this result. Any other
 * image-capable row is exposed through the General launch.
 */
export function discoveredLaunchIdForModel(model: DiscoveredModel): FocusedLaunchId | undefined {
  const classification = classifyDiscoveredModel(model);
  if (!classification.launchable) return undefined;
  return classification.launchId ?? GENERAL_LAUNCH_ID;
}

export function summarizeDiscoveredModels(models: readonly DiscoveredModel[]): DiscoveredModelInventory {
  const inventory: DiscoveredModelInventory = {
    total: models.length,
    image: 0,
    video: 0,
    unknown: 0,
    gptImage2: [],
    gptImage25: [],
    otherImage: [],
    compatibilityAliases: []
  };

  // Discovery responses are normally normalized before they reach the
  // renderer, but older state files may contain duplicate rows (for example
  // both `models/gpt-image-2.5` and `gpt-image-2.5`). Keep the inventory
  // consistent with the launch picker by counting each provider/model pair
  // once.
  const seen = new Set<string>();
  for (const model of models) {
    if (!isPersistedDiscoveryEvidence(model)) continue;
    const key = `${model.providerKind}:${normalizeProviderModelId(model.providerKind, model.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const classification = classifyDiscoveredModel(model);
    const imageCapable = classification.launchable;
    const hints = discoveredModelCapabilityHints(model);
    if (classification.compatibilityAlias) {
      inventory.compatibilityAliases.push(model.id);
    }
    if (imageCapable) {
      inventory.image += 1;
      const launchId = classification.launchId ?? GENERAL_LAUNCH_ID;
      if (launchId === GPT_IMAGE_2_LAUNCH_ID) {
        inventory.gptImage2.push(model.id);
      } else if (launchId === GPT_IMAGE_2_5_LAUNCH_ID) {
        inventory.gptImage25.push(model.id);
      } else {
        inventory.otherImage.push(model.id);
      }
    }
    if (hints.video) inventory.video += 1;
    if (!imageCapable && !hints.video) inventory.unknown += 1;
  }

  inventory.total = seen.size;
  return inventory;
}

export function findDiscoveredImageModel(
  models: DiscoveredModel[],
  providerKind: ProviderKind,
  modelId: string
): DiscoveredModel | undefined {
  const normalizedRequested = normalizeProviderModelId(providerKind, modelId);
  return models.find((model) =>
    model.providerKind === providerKind &&
    normalizeProviderModelId(providerKind, model.id) === normalizedRequested &&
    isDiscoveredModelLaunchable(model)
  );
}

export function hasCompletedModelDiscovery(state: ModelDiscoveryState): boolean {
  // A cached model array without a timestamp may come from an older state
  // format or a different API key. Treat it as unverified until a successful
  // discovery attempt records its completion time.
  const hasPersistedKey = state.apiKeySaved ??
    (Object.prototype.hasOwnProperty.call(state, "encryptedApiKey")
      ? Boolean(state.encryptedApiKey)
      : undefined);
  return hasPersistedKey !== false &&
    !state.lastModelDiscoveryError &&
    hasValidDiscoveryTimestamp(state.lastModelDiscoveryAt);
}

function hasValidDiscoveryTimestamp(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

export function getGeneralImageModelCandidate(discoveredModels: DiscoveredModel[], providerKind: ProviderKind): DiscoveredModel | undefined {
  if (!isGeneralFallbackProvider(providerKind)) return undefined;
  return discoveredModels.find((model) =>
    model.providerKind === providerKind &&
    !isFocusedImageModelId(model.providerKind, model.id) &&
    isDiscoveredModelLaunchable(model)
  );
}

export function normalizeModelId(value: string): string {
  return stripModelResourcePrefix(value).toLowerCase();
}

/** Remove provider resource prefixes while preserving the model's original casing. */
export function stripModelResourcePrefix(value: string): string {
  return value.trim().replace(/^models\//i, "");
}
