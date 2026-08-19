import { normalizeModelId } from "../../shared/modelCatalog.js";
import type { RunJobRequest } from "../../shared/types.js";
import type { StoredProviderConfig } from "./stateMigration.js";

export function canRunRequestWithConfig(request: RunJobRequest, config: StoredProviderConfig): boolean {
  if (request.params.providerKind === config.kind) return true;

  const requestedModelId = normalizeModelId(request.params.model);
  const discoveredModelMatches = config.discoveredModels.some(
    (model) => model.providerKind === request.params.providerKind && normalizeModelId(model.id) === requestedModelId
  );
  if (discoveredModelMatches) return true;

  const configuredModelMatches = normalizeModelId(config.activeModelId || config.defaultModel) === requestedModelId;
  return request.params.launchId === config.activeLaunchId && configuredModelMatches;
}
