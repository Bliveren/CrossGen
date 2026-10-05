import {
  GENERAL_LAUNCH_ID,
  findDiscoveredImageModel,
  focusedLaunchIdForModel,
  hasCompletedModelDiscovery
} from "../../shared/modelCatalog.js";
import type { RunJobRequest } from "../../shared/types.js";
import type { StoredProviderConfig } from "./stateMigration.js";

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
  return request.params.launchId === expectedLaunchId;
}
