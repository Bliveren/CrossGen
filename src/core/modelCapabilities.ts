import {
  FOCUSED_MODEL_CATALOG,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  getFocusedModelsForProvider,
  getModelDisplayName,
  isFocusedImageModelId,
  discoveredModelCapabilityHints,
  isPotentialGeneralImageModel,
  isGptImage25ModelId,
  normalizeGeminiImageModelId,
  normalizeModelId
} from "../shared/modelCatalog.js";
import type {
  DiscoveredModel,
  FocusedLaunchId,
  FocusedModelDefinition,
  ImageCapabilityConfidence,
  ImageCapabilityContractKind,
  ImageModelCapabilities,
  ImageModelCapabilityContract,
  MediaKind,
  ProviderConfig,
  ProviderKind,
  VideoRouteStrategy
} from "../shared/types.js";

export type ModelCapabilitySource = "focused-catalog" | "discovered" | "general-fallback" | "unknown";

export interface ModelCapabilitySummary {
  providerId?: string;
  providerKind: ProviderKind;
  modelId: string;
  displayName: string;
  launchId?: FocusedLaunchId;
  selectionKey: string;
  source: ModelCapabilitySource;
  capabilities: ImageModelCapabilityContract;
}

export interface SketchCapabilityPreflight {
  ok: boolean;
  reason?: string;
  summary?: ModelCapabilitySummary;
}

const IMAGE_MEDIA_KINDS: MediaKind[] = ["image"];

const NO_VIDEO_ROUTE: VideoRouteStrategy = "none";

function imageOnlyKinds(): MediaKind[] {
  return [...IMAGE_MEDIA_KINDS];
}

function focusedContractKind(launchId: FocusedLaunchId, providerKind: ProviderKind): ImageCapabilityContractKind {
  if (launchId === GPT_IMAGE_2_LAUNCH_ID || launchId === GPT_IMAGE_2_5_LAUNCH_ID) return "openai-image";
  if (launchId === NANO_BANANA_3_LAUNCH_ID) return "gemini-generate-content";
  return providerKind === "gemini" ? "gemini-generate-content" : "openai-compatible-minimal";
}

function baseContract(
  capabilities: ImageModelCapabilities,
  contract: ImageCapabilityContractKind,
  confidence: ImageCapabilityConfidence
): ImageModelCapabilityContract {
  return {
    ...capabilities,
    asyncJob: false,
    mediaKinds: imageOnlyKinds(),
    outputAssetKinds: imageOnlyKinds(),
    requiresPublicUrl: false,
    supportsBase64Input: true,
    estimatedCostSignals: true,
    supportsLocalRuntime: false,
    animatedGif: false,
    video: false,
    videoRouteStrategy: NO_VIDEO_ROUTE,
    contract,
    confidence
  };
}

function discoveredContractForModel(model: DiscoveredModel): ImageModelCapabilityContract | undefined {
  const hints = discoveredModelCapabilityHints(model);
  const imageByName = isPotentialGeneralImageModel(model);
  // Explicit provider metadata takes precedence over the legacy name marker.
  // This prevents a catalogue entry such as "image-preview" with
  // `output_modalities: ["text"]` from being advertised as image-capable.
  const image = hints.explicitMedia ? hints.image : hints.image || imageByName;
  const video = hints.video;
  if (!image && !video) return hints.explicit ? unknownCapabilities() : undefined;

  const contract = baseContract(
    {
      generate: image,
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
    },
    model.providerKind === "gemini" ? "gemini-generate-content" : "openai-compatible-minimal",
    hints.explicit ? "discovered" : "discovered"
  );
  if (video) {
    contract.video = true;
    contract.videoRouteStrategy = model.providerKind === "openai" || model.providerKind === "custom"
      ? "openai-compatible-video-generations"
      : "provider-native";
    contract.mediaKinds = image ? ["image", "video"] : ["video"];
    contract.outputAssetKinds = image ? ["image", "video"] : ["video"];
    contract.asyncJob = true;
  }
  return contract;
}

function normalizeCapabilityModelId(
  launchId: FocusedLaunchId | undefined,
  providerKind: ProviderKind,
  modelId: string
): string {
  return launchId === NANO_BANANA_3_LAUNCH_ID || providerKind === "gemini"
    ? normalizeGeminiImageModelId(modelId)
    : normalizeModelId(modelId);
}

function selectionKeyForModel(launchId: FocusedLaunchId | undefined, providerKind: ProviderKind, modelId: string): string {
  return `${launchId ?? providerKind}:${normalizeCapabilityModelId(launchId, providerKind, modelId)}`;
}

function promptOnlyCapabilities(providerKind: ProviderKind, confidence: ImageCapabilityConfidence): ImageModelCapabilityContract {
  return baseContract(
    {
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
    },
    providerKind === "gemini" ? "gemini-generate-content" : "openai-compatible-minimal",
    confidence
  );
}

function unknownCapabilities(): ImageModelCapabilityContract {
  return baseContract(
    {
      generate: false,
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
    },
    "provider-native",
    "unknown"
  );
}

export function capabilityContractForFocusedModel(definition: FocusedModelDefinition): ImageModelCapabilityContract {
  if (definition.launchId === GENERAL_LAUNCH_ID) {
    return promptOnlyCapabilities(definition.providerKind, "assumed");
  }
  return baseContract(definition.capabilities, focusedContractKind(definition.launchId, definition.providerKind), "verified");
}

function summaryForFocusedModel(providerId: string | undefined, definition: FocusedModelDefinition, modelId = definition.defaultModelId): ModelCapabilitySummary {
  const canonicalModelId = normalizeCapabilityModelId(definition.launchId, definition.providerKind, modelId);
  return {
    providerId,
    providerKind: definition.providerKind,
    modelId: canonicalModelId,
    displayName: getModelDisplayName(definition.launchId, canonicalModelId),
    launchId: definition.launchId,
    selectionKey: selectionKeyForModel(definition.launchId, definition.providerKind, canonicalModelId),
    source: definition.launchId === GENERAL_LAUNCH_ID ? "general-fallback" : "focused-catalog",
    capabilities: capabilityContractForFocusedModel(definition)
  };
}

function focusedDefinitionForModel(providerKind: ProviderKind, modelId: string): FocusedModelDefinition | undefined {
  const normalized = normalizeCapabilityModelId(undefined, providerKind, modelId);
  if (providerKind === "openai" && isGptImage25ModelId(normalized)) {
    return FOCUSED_MODEL_CATALOG.find((definition) => definition.launchId === GPT_IMAGE_2_5_LAUNCH_ID);
  }
  return FOCUSED_MODEL_CATALOG.find(
    (definition) =>
      definition.launchId !== GENERAL_LAUNCH_ID &&
      definition.providerKind === providerKind &&
      definition.modelIds.some((candidate) => normalizeModelId(candidate) === normalized)
  );
}

export function capabilitySummaryForDiscoveredModel(providerId: string | undefined, model: DiscoveredModel): ModelCapabilitySummary {
  const focusedDefinition = focusedDefinitionForModel(model.providerKind, model.id);
  if (focusedDefinition) {
    const hints = discoveredModelCapabilityHints(model);
    // A gateway may reuse a known model id for a text-only deployment. Honor
    // an explicit modality declaration instead of treating the id as proof of
    // access to CrossGen's focused image runtime.
    if (hints.explicitMedia && !hints.image) {
      return {
        providerId,
        providerKind: model.providerKind,
        modelId: model.id,
        displayName: model.displayName?.trim() || model.id,
        selectionKey: selectionKeyForModel(undefined, model.providerKind, model.id),
        source: "unknown",
        capabilities: unknownCapabilities()
      };
    }
    return summaryForFocusedModel(providerId, focusedDefinition, model.id);
  }

  const displayName = model.displayName?.trim() || model.id;
  const discoveredContract = discoveredContractForModel(model);
  if (discoveredContract && (discoveredContract.generate || discoveredContract.video)) {
    return {
      providerId,
      providerKind: model.providerKind,
      modelId: model.id,
      displayName,
      selectionKey: selectionKeyForModel(undefined, model.providerKind, model.id),
      source: "discovered",
      capabilities: discoveredContract
    };
  }

  if (discoveredContract) {
    return {
      providerId,
      providerKind: model.providerKind,
      modelId: model.id,
      displayName,
      selectionKey: selectionKeyForModel(undefined, model.providerKind, model.id),
      source: "unknown",
      capabilities: discoveredContract
    };
  }

  return {
    providerId,
    providerKind: model.providerKind,
    modelId: model.id,
    displayName,
    selectionKey: selectionKeyForModel(undefined, model.providerKind, model.id),
    source: "unknown",
    capabilities: unknownCapabilities()
  };
}

/**
 * Sketch is an edit workflow, so a model id alone is never enough to enable it.
 * The id must be present in the latest discovery result and the discovered
 * contract must explicitly provide edit/reference-image support. This keeps a
 * focused catalogue entry from being mistaken for proof that the current API
 * key can actually use that model.
 */
export function preflightSketchCapability(
  provider: Pick<ProviderConfig, "id" | "discoveredModels" | "lastModelDiscoveryAt" | "lastModelDiscoveryError">,
  modelId: string
): SketchCapabilityPreflight {
  const normalizedRequestedModelId = normalizeModelId(modelId);
  if (!normalizedRequestedModelId) {
    return {
      ok: false,
      reason: "Sketch 需要先选择一个支持图像编辑和参考图输入的模型。"
    };
  }
  if (provider.lastModelDiscoveryError) {
    return {
      ok: false,
      reason: `当前 API Key 的模型探测失败，暂时不能确认 ${modelId} 支持 Sketch。${provider.lastModelDiscoveryError}`
    };
  }

  const discovered = provider.discoveredModels.find(
    (candidate) =>
      normalizeCapabilityModelId(undefined, candidate.providerKind, candidate.id) ===
      normalizeCapabilityModelId(undefined, candidate.providerKind, modelId)
  );
  if (!discovered) {
    const suffix = provider.lastModelDiscoveryError
      ? ` ${provider.lastModelDiscoveryError}`
      : provider.lastModelDiscoveryAt
        ? " 当前 API Key 的模型探测结果中未找到该模型。"
        : " 请先探测当前 API Key 可用的模型。";
    return {
      ok: false,
      reason: `当前 API Key 尚未确认 ${modelId} 支持 Sketch。${suffix}`
    };
  }

  const summary = capabilitySummaryForDiscoveredModel(provider.id, discovered);
  const capabilities = summary.capabilities;
  if (
    summary.source === "unknown" ||
    capabilities.confidence === "unknown" ||
    !capabilities.edit ||
    !capabilities.referenceImages ||
    capabilities.maxReferenceImages < 1
  ) {
    return {
      ok: false,
      summary,
      reason: `当前 API Key 已探测到 ${modelId}，但未声明支持 Sketch 所需的图像编辑和参考图输入能力。`
    };
  }

  return { ok: true, summary };
}

export function listProviderModelCapabilitySummaries(provider: ProviderConfig): ModelCapabilitySummary[] {
  const summaries = new Map<string, ModelCapabilitySummary>();

  for (const definition of getFocusedModelsForProvider(provider.kind)) {
    const summary = summaryForFocusedModel(provider.id, definition);
    summaries.set(summary.selectionKey, summary);
  }

  for (const model of provider.discoveredModels) {
    const summary = capabilitySummaryForDiscoveredModel(provider.id, model);
    summaries.set(summary.selectionKey, summary);
  }

  if (
    provider.activeLaunchId === GENERAL_LAUNCH_ID &&
    provider.activeModelId &&
    !isFocusedImageModelId(provider.kind, provider.activeModelId)
  ) {
    const activeGeneralKey = `${provider.kind}:${normalizeModelId(provider.activeModelId)}`;
    if (!summaries.has(activeGeneralKey)) {
      summaries.set(activeGeneralKey, {
        providerId: provider.id,
        providerKind: provider.kind,
        modelId: provider.activeModelId,
        displayName: provider.activeModelId,
        launchId: GENERAL_LAUNCH_ID,
        selectionKey: selectionKeyForModel(GENERAL_LAUNCH_ID, provider.kind, provider.activeModelId),
        source: "general-fallback",
        capabilities: promptOnlyCapabilities(provider.kind, "assumed")
      });
    }
  }

  return [...summaries.values()];
}
