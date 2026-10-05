import {
  GENERAL_LAUNCH_ID,
  findDiscoveredImageModel,
  focusedLaunchIdForModel,
  hasCompletedModelDiscovery,
  hasGeneralEditRouteEvidence,
  isOpenAICompatibleGeneralFallbackProvider
} from "../../shared/modelCatalog.js";
import { GENERAL_EDIT_UNCONFIRMED_MESSAGE } from "../../shared/validation.js";
import type { RunJobRequest } from "../../shared/types.js";
import type { StoredProviderConfig } from "./stateMigration.js";

const GENERAL_EDIT_DISABLED_MESSAGE =
  "General OpenAI 兼容兜底参考图编辑已被 feature flag 关闭。";

/**
 * Main-process kill switch for the General reference-edit capability. The
 * default is evidence-gated (enabled only with exact-id route evidence);
 * setting CROSSGEN_GENERAL_EDIT_ENABLED=0 forces the prompt-only fallback.
 */
export function isGeneralReferenceEditEnabled(): boolean {
  const value = process.env.CROSSGEN_GENERAL_EDIT_ENABLED?.trim().toLowerCase();
  return value !== "0" && value !== "false";
}

export function canRunRequestWithConfig(request: RunJobRequest, config: StoredProviderConfig): boolean {
  // A provider kind only describes the transport/configuration. It is not
  // proof that this API key can run an arbitrary model in that family.
  if (!hasCompletedModelDiscovery(config)) return false;

  const discoveredModel = findDiscoveredImageModel(
    config.discoveredModels,
    request.params.providerKind,
    request.params.model
  );
  if (!discoveredModel) return false;

  // Keep the launch family derived from the exact discovered model id. This
  // prevents an old GPT Image 2.5 draft from being sent as GPT Image 2 (or
  // vice versa), and keeps Gemini image models on the Nano Banana workflow.
  const expectedLaunchId =
    focusedLaunchIdForModel(discoveredModel.providerKind, discoveredModel.id) ?? GENERAL_LAUNCH_ID;
  if (request.params.launchId !== expectedLaunchId) return false;

  // General OpenAI-compatible editing is only valid with exact-id edit route
  // evidence. Gemini General fallback keeps its native reference support.
  if (
    request.params.launchId === GENERAL_LAUNCH_ID &&
    isOpenAICompatibleGeneralFallbackProvider(request.params.providerKind) &&
    request.mode !== "generate"
  ) {
    return (
      isGeneralReferenceEditEnabled() &&
      hasGeneralEditRouteEvidence(
        config.openAIImageRouting,
        request.params.providerKind,
        discoveredModel.id
      )
    );
  }
  return true;
}

/**
 * Returns the user-facing reason when a General OpenAI-compatible edit request
 * is blocked because the exact model id has no route evidence yet.
 */
export function generalReferenceEditBlockReason(
  request: RunJobRequest,
  config: StoredProviderConfig
): string | undefined {
  if (request.params.launchId !== GENERAL_LAUNCH_ID) return undefined;
  if (!isOpenAICompatibleGeneralFallbackProvider(request.params.providerKind)) return undefined;
  if (request.mode === "generate") return undefined;
  if (!isGeneralReferenceEditEnabled()) return GENERAL_EDIT_DISABLED_MESSAGE;
  if (hasGeneralEditRouteEvidence(config.openAIImageRouting, request.params.providerKind, request.params.model)) {
    return undefined;
  }
  return GENERAL_EDIT_UNCONFIRMED_MESSAGE;
}
