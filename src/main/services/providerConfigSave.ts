import type { FocusedLaunchId, ProviderConfig, ProviderConfigInput } from "../../shared/types.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_IMAGE_PARAMS,
  defaultStreamingPartialsEnabled,
  normalizeBaseURL
} from "../../shared/validation.js";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID,
  getFocusedModelDefinition
} from "../../shared/modelCatalog.js";
import type { StoredProviderConfig } from "./stateMigration.js";

export function providerDisplayName(kind: StoredProviderConfig["kind"]): string {
  if (kind === "gemini") return "Gemini";
  if (kind === "custom") return "Custom";
  return "OpenAI";
}

export function buildProviderConfigForSave(current: StoredProviderConfig, input: ProviderConfigInput, now: string): StoredProviderConfig {
  const kind = input.kind ?? current.kind;
  const providerChanged = kind !== current.kind;
  const defaultModel = defaultModelForProvider(kind, input.defaultModel);
  const baseURL = normalizeBaseURL(input.baseURL || defaultBaseURLForProvider(kind, current.baseURL));
  const name = input.name?.trim() || (providerChanged ? providerDisplayName(kind) : current.name);
  const discoveryInvalidated = providerChanged || baseURL !== current.baseURL;
  const requestedLaunchId = input.activeLaunchId;
  const activeLaunchId = activeLaunchForProvider(kind, requestedLaunchId ?? (providerChanged ? undefined : current.activeLaunchId));
  const activeModelId = requestedLaunchId ? input.activeModelId?.trim() || defaultModelForLaunch(requestedLaunchId, defaultModel) : defaultModel;
  const streamingPartialsEnabled = typeof input.streamingPartialsEnabled === "boolean"
    ? input.streamingPartialsEnabled
    : discoveryInvalidated
      ? defaultStreamingPartialsEnabled(kind, baseURL)
      : current.streamingPartialsEnabled ?? defaultStreamingPartialsEnabled(kind, baseURL);
  const nextConfig: StoredProviderConfig = {
    ...current,
    kind,
    name,
    baseURL,
    defaultModel,
    defaultSize: input.defaultSize.trim() || DEFAULT_IMAGE_PARAMS.size,
    defaultQuality: input.defaultQuality,
    timeoutMs: input.timeoutMs,
    streamingPartialsEnabled,
    activeLaunchId,
    activeModelId,
    discoveredModels: discoveryInvalidated ? [] : current.discoveredModels,
    lastModelDiscoveryAt: discoveryInvalidated ? undefined : current.lastModelDiscoveryAt,
    lastModelDiscoveryError: discoveryInvalidated ? undefined : current.lastModelDiscoveryError,
    openAIImageRouting: discoveryInvalidated ? undefined : current.openAIImageRouting,
    updatedAt: now
  };

  return nextConfig;
}

function defaultBaseURLForProvider(kind: StoredProviderConfig["kind"], previousBaseURL: string): string {
  if (kind === "gemini") return DEFAULT_GEMINI_BASE_URL;
  if (kind === "custom") return previousBaseURL || DEFAULT_BASE_URL;
  return DEFAULT_BASE_URL;
}

function defaultModelForProvider(kind: StoredProviderConfig["kind"], requestedModel: string): string {
  const model = requestedModel.trim();
  if (kind === "gemini") return model && model !== DEFAULT_IMAGE_PARAMS.model ? model : NANO_BANANA_3_MODEL_ID;
  if (model) return model;
  if (kind === "custom") return "";
  return DEFAULT_IMAGE_PARAMS.model;
}

function activeLaunchForProvider(kind: StoredProviderConfig["kind"], requestedLaunchId: ProviderConfigInput["activeLaunchId"]): ProviderConfig["activeLaunchId"] {
  if (requestedLaunchId) return requestedLaunchId;
  if (kind === "gemini") return NANO_BANANA_3_LAUNCH_ID;
  if (kind === "custom") return GENERAL_LAUNCH_ID;
  return GPT_IMAGE_2_LAUNCH_ID;
}

function defaultModelForLaunch(launchId: FocusedLaunchId, fallback: string): string {
  const definition = getFocusedModelDefinition(launchId);
  if (!definition || definition.launchId === GENERAL_LAUNCH_ID) return fallback;
  return definition.defaultModelId;
}
