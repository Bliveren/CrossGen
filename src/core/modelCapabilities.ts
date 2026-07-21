import {
  FOCUSED_MODEL_CATALOG,
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  getFocusedModelsForProvider,
  getModelDisplayName,
  isFocusedImageModelId,
  isPotentialGeneralImageModel,
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

const IMAGE_MEDIA_KINDS: MediaKind[] = ["image"];

const NO_VIDEO_ROUTE: VideoRouteStrategy = "none";

function imageOnlyKinds(): MediaKind[] {
  return [...IMAGE_MEDIA_KINDS];
}

function focusedContractKind(launchId: FocusedLaunchId, providerKind: ProviderKind): ImageCapabilityContractKind {
  if (launchId === GPT_IMAGE_2_LAUNCH_ID) return "openai-image";
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

function selectionKeyForModel(launchId: FocusedLaunchId | undefined, providerKind: ProviderKind, modelId: string): string {
  return `${launchId ?? providerKind}:${normalizeModelId(modelId)}`;
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
  return {
    providerId,
    providerKind: definition.providerKind,
    modelId,
    displayName: getModelDisplayName(definition.launchId, modelId),
    launchId: definition.launchId,
    selectionKey: selectionKeyForModel(definition.launchId, definition.providerKind, modelId),
    source: definition.launchId === GENERAL_LAUNCH_ID ? "general-fallback" : "focused-catalog",
    capabilities: capabilityContractForFocusedModel(definition)
  };
}

function focusedDefinitionForModel(providerKind: ProviderKind, modelId: string): FocusedModelDefinition | undefined {
  const normalized = normalizeModelId(modelId);
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
    return summaryForFocusedModel(providerId, focusedDefinition, model.id);
  }

  const displayName = model.displayName?.trim() || model.id;
  if (isPotentialGeneralImageModel(model)) {
    return {
      providerId,
      providerKind: model.providerKind,
      modelId: model.id,
      displayName,
      selectionKey: selectionKeyForModel(undefined, model.providerKind, model.id),
      source: "discovered",
      capabilities: promptOnlyCapabilities(model.providerKind, "discovered")
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

export function listProviderModelCapabilitySummaries(provider: ProviderConfig): ModelCapabilitySummary[] {
  const summaries = new Map<string, ModelCapabilitySummary>();

  for (const definition of getFocusedModelsForProvider(provider.kind)) {
    summaries.set(`${definition.providerKind}:${normalizeModelId(definition.defaultModelId)}`, summaryForFocusedModel(provider.id, definition));
  }

  for (const model of provider.discoveredModels) {
    const summary = capabilitySummaryForDiscoveredModel(provider.id, model);
    summaries.set(`${summary.providerKind}:${normalizeModelId(summary.modelId)}`, summary);
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
