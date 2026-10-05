import type {
  DiscoveredModel,
  FocusedLaunchId,
  ModelDiscoveryAvailability,
  OpenAIImageRoute,
  ProviderKind
} from "../../shared/types.js";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GEMINI_IMAGE_DEFAULT_MODEL_ID,
  GEMINI_IMAGE_MODEL_IDS,
  NANO_BANANA_3_LAUNCH_ID,
  classifyDiscoveredModel,
  discoveredLaunchIdForModel,
  focusedLaunchIdForModel,
  getProviderKindForFocusedModelId,
  isDiscoveredImageModel,
  isDiscoveredModelLaunchable,
  isPersistedDiscoveryEvidence,
  normalizeGeminiImageModelId,
  normalizeProviderModelId,
  normalizeModelId,
  isGptImage2ModelId,
  stripModelResourcePrefix
} from "../../shared/modelCatalog.js";
import { DEFAULT_GEMINI_BASE_URL, normalizeBaseURL } from "../../shared/validation.js";
import { buildEndpoint, fetchWithTimeout } from "./openaiImageAdapter.js";
import {
  buildOpenAIImageRouteProbeRequest,
  isOpenAIImageModelUnavailable,
  probeOpenAIImageRoute
} from "./openaiImageRouting.js";
import {
  firstString,
  isRecord,
  optionalString,
  readProviderApiError,
  redactLikelySecrets,
  requestIdFromHeaders,
  type SecretRedactionOptions
} from "./providerHttp.js";

interface OpenAIModelsResponse {
  data?: unknown;
}

interface GeminiModelsResponse {
  models?: unknown;
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  status: number;
  requestId?: string;
  /**
   * Protocol that produced this catalogue. This is deliberately separate from
   * each row's `providerKind`: a custom/OpenAI-compatible gateway can return
   * Gemini-family model ids while the request must still use the gateway
   * protocol and credentials.
   */
  transportProviderKind: ProviderKind;
  /**
   * Backward-compatible hint used by launch selection when discovery had to
   * fall back to another protocol. It is not a persisted provider config kind.
   */
  inferredProviderKind?: ProviderKind;
  /**
   * Protocol catalogues that were not selected as the primary result. These
   * stay in memory so an exact availability probe can recover when the
   * primary `/models` response contains a stale focused model id.
   */
  alternateResults?: Array<{
    models: DiscoveredModel[];
    transportProviderKind: ProviderKind;
    inferredProviderKind?: ProviderKind;
  }>;
}

export interface ModelDiscoveryRuntime {
  fetch: typeof fetch;
}

export interface DiscoveredModelAvailabilityProbe {
  modelId: string;
  providerKind: ProviderKind;
  availability: ModelDiscoveryAvailability;
  reason?: string;
}

/**
 * Remove speculative route candidates that did not receive an exact positive
 * image-route confirmation. Provider-listed rows remain available as
 * explainable evidence even when their status is listed/inconclusive/rejected.
 */
export function retainVerifiedDiscoveryEvidence(models: DiscoveredModel[]): DiscoveredModel[] {
  return models.filter(isPersistedDiscoveryEvidence);
}

/**
 * A few OpenAI-compatible aggregators omit image deployments from `/models`
 * while still accepting the exact id on the image route. Keep arbitrary
 * provider rows authoritative, but add stable product-owned candidates so
 * GPT Image 2 and 2.5 can be verified independently of an incomplete list.
 *
 * These rows start as unconfirmed and are launchable only after the exact
 * provider id passes the lightweight route probe. Variant and dated ids are
 * never guessed here; they remain available only when the provider lists them.
 */
export function addFocusedOpenAIImageCandidates(
  models: DiscoveredModel[],
  providerKind: ProviderKind
): DiscoveredModel[] {
  if (providerKind === "gemini") return models;

  const candidates: DiscoveredModel[] = [
    {
      id: GPT_IMAGE_2_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      discoverySource: "route-candidate"
    },
    {
      id: GPT_IMAGE_2_5_FLARE_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2.5 · Flare",
      discoverySource: "route-candidate"
    },
    {
      id: GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2.5 · Sunburst",
      discoverySource: "route-candidate"
    }
  ];
  const seen = new Set(
    models.map((model) => `${model.providerKind}:${normalizeProviderModelId(model.providerKind, model.id)}`)
  );
  return [
    ...models,
    ...candidates.filter((model) => {
      const key = `${model.providerKind}:${normalizeProviderModelId(model.providerKind, model.id)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  ];
}

export interface ModelDiscoverySelectionConfig {
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  defaultModel: string;
  providerKind?: ProviderKind;
}

export interface ModelDiscoverySelection {
  activeLaunchId: FocusedLaunchId;
  activeModelId: string;
  defaultModel: string;
}

interface DiscoveryAttempt {
  providerKind: ProviderKind;
  result: ModelDiscoveryResult;
}

function preferredDiscoveredModel(
  models: DiscoveredModel[],
  launchId: FocusedLaunchId
): DiscoveredModel | undefined {
  const candidates = models.filter((model) =>
    discoveredLaunchIdForModel(model) === launchId &&
    isDiscoveredModelLaunchable(model)
  );
  if (candidates.length <= 1) return candidates[0];

  const normalizedIds = candidates.map((model) => normalizeProviderModelId(model.providerKind, model.id));
  const priorityForModel = (modelId: string): number => {
    const normalized = normalizeModelId(modelId);
    if (launchId === GPT_IMAGE_2_5_LAUNCH_ID) {
      const preferred = [
        GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
        GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        GPT_IMAGE_2_5_FLARE_MODEL_ID
      ].map(normalizeModelId);
      const exactIndex = preferred.indexOf(normalized);
      if (exactIndex >= 0) return exactIndex;
      if (normalized.includes("sunburst")) return 10;
      if (normalized.includes("flare")) return 11;
      return 20;
    }
    if (launchId === NANO_BANANA_3_LAUNCH_ID) {
      const exactIndex = GEMINI_IMAGE_MODEL_IDS
        .map(normalizeModelId)
        .indexOf(normalized);
      if (normalized === normalizeModelId(GEMINI_IMAGE_DEFAULT_MODEL_ID)) return 0;
      return exactIndex >= 0 ? exactIndex + 1 : 20;
    }
    return isGptImage2ModelId(normalized) ? 0 : 20;
  };

  let bestIndex = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    if (priorityForModel(normalizedIds[index] ?? "") < priorityForModel(normalizedIds[bestIndex] ?? "")) {
      bestIndex = index;
    }
  }
  return candidates[bestIndex];
}

/**
 * Select the active CrossGen launch from a successful provider discovery.
 * Explicit text-only metadata always wins over a familiar image-model id.
 */
export function selectActiveLaunchForDiscovery(
  config: ModelDiscoverySelectionConfig,
  models: DiscoveredModel[],
  inferredProviderKind: ProviderKind
): ModelDiscoverySelection {
  const currentModelId = config.activeModelId || config.defaultModel;
  const currentCandidates = currentModelId
    ? models.filter((model) =>
        normalizeProviderModelId(model.providerKind, model.id) ===
          normalizeProviderModelId(model.providerKind, currentModelId) &&
        isDiscoveredModelLaunchable(model)
      )
    : [];
  const currentModel = currentCandidates
    .map((model, index) => ({
      model,
      index,
      score: providerMatchScore(model.providerKind, config.providerKind, inferredProviderKind)
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)[0]?.model;
  const currentLaunchId = currentModel
    ? discoveredLaunchIdForModel(currentModel) ?? GENERAL_LAUNCH_ID
    : undefined;
  if (currentModel && currentLaunchId) {
    return {
      activeLaunchId: currentLaunchId,
      activeModelId: currentModel.id,
      defaultModel: currentModel.id
    };
  }

  const hasFocusedGeminiModel = models.some((model) =>
    discoveredLaunchIdForModel(model) === NANO_BANANA_3_LAUNCH_ID &&
    isDiscoveredModelLaunchable(model)
  );
  const hasFocusedOpenAIModel = models.some((model) =>
    (discoveredLaunchIdForModel(model) === GPT_IMAGE_2_LAUNCH_ID ||
      discoveredLaunchIdForModel(model) === GPT_IMAGE_2_5_LAUNCH_ID) &&
    isDiscoveredModelLaunchable(model)
  );
  if (
    inferredProviderKind === "gemini" ||
    (!hasFocusedOpenAIModel && hasFocusedGeminiModel)
  ) {
    const nanoModel = preferredDiscoveredModel(models, NANO_BANANA_3_LAUNCH_ID);
    if (nanoModel) {
      return {
        activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
        activeModelId: nanoModel.id,
        defaultModel: nanoModel.id
      };
    }
  }

  if (inferredProviderKind === "openai" || hasFocusedOpenAIModel) {
    const gpt25Model = preferredDiscoveredModel(models, GPT_IMAGE_2_5_LAUNCH_ID);
    if (gpt25Model) {
      return {
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        activeModelId: gpt25Model.id,
        defaultModel: gpt25Model.id
      };
    }
    const gptModel = preferredDiscoveredModel(models, GPT_IMAGE_2_LAUNCH_ID);
    if (gptModel) {
      return {
        activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
        activeModelId: gptModel.id,
        defaultModel: gptModel.id
      };
    }
  }

  const generalModel = models.find((model) =>
    discoveredLaunchIdForModel(model) === GENERAL_LAUNCH_ID &&
    isDiscoveredModelLaunchable(model)
  );
  if (generalModel) {
    return {
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: generalModel.id,
      defaultModel: generalModel.id
    };
  }

  // A successful discovery with no image-capable model must not leave the
  // previous focused model looking supported. Keep the provider in an empty
  // General state so the UI/CLI can clearly report that no runnable image
  // model was confirmed for this key.
  return {
    activeLaunchId: GENERAL_LAUNCH_ID,
    activeModelId: "",
    defaultModel: ""
  };
}

function providerMatchScore(
  modelProviderKind: ProviderKind,
  configuredProviderKind: ProviderKind | undefined,
  inferredProviderKind: ProviderKind
): number {
  if (configuredProviderKind && configuredProviderKind !== "custom") {
    return modelProviderKind === configuredProviderKind ? 0 : 10;
  }
  if (configuredProviderKind === "custom") {
    if (inferredProviderKind !== "custom" && modelProviderKind === inferredProviderKind) return 0;
    return modelProviderKind === "custom" ? 0 : 2;
  }
  if (inferredProviderKind && modelProviderKind === inferredProviderKind) return 0;
  return 5;
}

export async function discoverModels(
  providerKind: ProviderKind,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime
): Promise<ModelDiscoveryResult> {
  if (providerKind === "gemini") {
    return discoverGeminiModels(baseURL || DEFAULT_GEMINI_BASE_URL, apiKey, timeoutMs, runtime);
  }
  return discoverOpenAICompatibleModels(providerKind, baseURL, apiKey, timeoutMs, runtime);
}

export async function discoverModelsAcrossProviders(
  providerKind: ProviderKind,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime
): Promise<ModelDiscoveryResult> {
  const attempts = discoveryProviderOrder(providerKind);
  const results: DiscoveryAttempt[] = [];
  const errors: string[] = [];

  for (const attemptProviderKind of attempts) {
    try {
      results.push({
        providerKind: attemptProviderKind,
        result: await discoverModels(attemptProviderKind, baseURL, apiKey, timeoutMs, runtime)
      });
    } catch (error) {
      errors.push(`${providerLabel(attemptProviderKind)}: ${sanitizeModelDiscoveryError(error, apiKey)}`);
    }
  }

  if (results.length === 0) {
    throw new Error(errors.join(" | ") || "model discovery failed.");
  }

  const primaryResult = results.find((result) => result.providerKind === providerKind);
  const primaryHasImageModels = Boolean(
    primaryResult?.result.models.some((model) => isDiscoveredImageModel(model))
  );
  const fallbackResult = results.find((result) =>
    result.providerKind !== providerKind &&
    result.result.models.some((model) => isDiscoveredImageModel(model))
  );

  // A successful primary catalogue is authoritative for its configured
  // transport. Some gateways respond to both `/models` shapes (or return a
  // protocol-incompatible payload), so merging both catalogues would expose
  // models that the selected adapter cannot actually run. Only fall back to
  // another protocol when the primary response contains no runnable image
  // model at all.
  const selectedResult =
    (primaryHasImageModels ? primaryResult : fallbackResult ?? primaryResult) ??
    results.find((result) => result.result.models.length > 0) ??
    results[0];
  const inferredProviderKind =
    !primaryHasImageModels && selectedResult?.providerKind !== providerKind
      ? selectedResult?.providerKind
      : undefined;
  const alternateResults = results
    .filter((candidate) => candidate.result !== selectedResult?.result)
    .map((candidate) => ({
      models: uniqueModels(candidate.result.models),
      transportProviderKind:
        candidate.result.transportProviderKind ??
        candidate.providerKind,
      inferredProviderKind:
        candidate.providerKind !== providerKind &&
        candidate.result.models.some((model) => isDiscoveredImageModel(model))
          ? candidate.providerKind
          : undefined
    }))
    .filter((candidate) => candidate.models.length > 0);

  return {
    models: uniqueModels(selectedResult?.result.models ?? []),
    // Report the status/request id for the result that actually supplied the
    // usable model catalogue. Returning the first attempted protocol's 404
    // after a successful fallback made a valid Key look unhealthy in the UI.
    status: selectedResult?.result.status ?? 200,
    requestId: selectedResult?.result.requestId,
    transportProviderKind:
      selectedResult?.result.transportProviderKind ??
      selectedResult?.providerKind ??
      providerKind,
    inferredProviderKind,
    ...(alternateResults.length > 0 ? { alternateResults } : {})
  };
}

/**
 * Confirm the focused rows returned by `/models` without submitting a paid
 * generation request. The metadata endpoint is intentionally advisory:
 * gateways that do not expose it produce `inconclusive`, while an explicit
 * `model_not_found` response is only a veto when the configured image route
 * also rejects that exact provider id. Aggregators can expose a stale or
 * incomplete `/models/{id}` endpoint while accepting the same model on their
 * actual image route.
 */
export async function probeDiscoveredModelAvailability(
  models: DiscoveredModel[],
  transportProviderKind: ProviderKind,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime,
  runtimeProviderKind: ProviderKind = transportProviderKind
): Promise<DiscoveredModel[]> {
  const focusedModels = models.filter((model) => classifyDiscoveredModel(model).family !== undefined);
  if (focusedModels.length === 0) return models;

  const probes = await Promise.all(
    focusedModels.map((model) =>
      probeFocusedModelAvailability(
        model,
        transportProviderKind,
        runtimeProviderKind,
        baseURL,
        apiKey,
        timeoutMs,
        runtime
      )
    )
  );
  const probeByKey = new Map(
    probes.map((probe) => [
      `${probe.providerKind}:${normalizeProviderModelId(probe.providerKind, probe.modelId)}`,
      probe
    ])
  );

  return models.map((model) => {
    const probe = probeByKey.get(
      `${model.providerKind}:${normalizeProviderModelId(model.providerKind, model.id)}`
    );
    if (!probe) return model;
    return {
      ...model,
      availability: probe.availability,
      ...(probe.reason ? { availabilityReason: probe.reason } : {})
    };
  });
}

async function probeFocusedModelAvailability(
  model: DiscoveredModel,
  transportProviderKind: ProviderKind,
  runtimeProviderKind: ProviderKind,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime
): Promise<DiscoveredModelAvailabilityProbe> {
  const modelId = stripModelResourcePrefix(model.id);
  if (!isDiscoveredImageModel(model)) {
    return {
      modelId,
      providerKind: model.providerKind,
      availability: "rejected",
      reason: "Provider metadata explicitly denies image output for this model."
    };
  }

  // A fallback catalogue can be Gemini while the selected runtime is an
  // OpenAI-compatible gateway. Use the native Gemini metadata route only for
  // actual Gemini rows; GPT Image rows must retain the OpenAI-compatible path.
  const useGeminiProtocol = transportProviderKind === "gemini" && model.providerKind === "gemini";
  const endpoint = useGeminiProtocol
    ? (() => {
        const url = new URL(`${normalizeBaseURL(baseURL || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "")}/models/${encodeURIComponent(modelId)}`);
        url.searchParams.set("key", apiKey);
        return url.toString();
      })()
    : `${normalizeBaseURL(baseURL).replace(/\/+$/, "")}/models/${encodeURIComponent(modelId)}`;

  try {
    const response = await fetchWithTimeout(
      runtime.fetch,
      endpoint.toString(),
      {
        method: "GET",
        headers: useGeminiProtocol
          ? { Accept: "application/json" }
          : {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json"
            }
      },
      Math.min(timeoutMs, 10000)
    );
    const text = await response.text().catch(() => "");
    const payload = parseProbePayload(text);
    const metadataExplicitModelNotFound = isModelNotFoundPayload(payload, text);
    // `name: models/<id>` is a canonical identity only on the native Gemini
    // transport. An OpenAI-compatible gateway may classify a returned
    // Gemini-family row as `providerKind: "gemini"` while still using
    // `name` as a friendly label, so identity matching must follow the
    // transport protocol rather than the model family.
    const metadataIdentityProviderKind: ProviderKind =
      transportProviderKind === "gemini" ? "gemini" : transportProviderKind;
    const metadataMatch = response.ok && !hasErrorPayload(payload)
      ? metadataPayloadModelIdMatch(payload, metadataIdentityProviderKind, modelId)
      : "missing";
    const metadataCanConfirmRuntime = metadataMatch === "matched" &&
      canConfirmFocusedModelFromMetadata(model, transportProviderKind, runtimeProviderKind);
    if (metadataMatch === "matched") {
      // An exact model id proves that the provider recognized the requested
      // deployment, but it does not override an explicit capability veto in
      // the metadata response. Some gateways return the right id for a
      // text-only or vision-only deployment, which must remain disabled.
      const metadataModel: DiscoveredModel = {
        ...model,
        raw: payload
      };
      if (!isDiscoveredImageModel(metadataModel)) {
        return {
          modelId,
          providerKind: model.providerKind,
          availability: "rejected",
          reason: "Metadata endpoint explicitly denies image output for this model."
        };
      }
    }
    if (metadataMatch === "mismatched") {
      return {
        modelId,
        providerKind: model.providerKind,
        availability: "rejected",
        reason: "Metadata endpoint returned a different model id."
      };
    }
    const routeAvailability = await probeOpenAICompatibleFocusedModelAvailability(
      model,
      runtimeProviderKind,
      baseURL,
      apiKey,
      timeoutMs,
      runtime,
      // A metadata exact-id match lets a validation-only 400/422 response
      // confirm that this same deployment is reachable without starting a
      // paid generation. Without that exact match, only a successful 2xx
      // route response can confirm the row.
      metadataMatch === "matched"
    );
    if (routeAvailability?.availability === "confirmed" || routeAvailability?.availability === "rejected") {
      if (
        routeAvailability.availability === "confirmed" &&
        model.discoverySource === "route-candidate"
      ) {
        return {
          ...routeAvailability,
          reason: "Confirmed by an exact image route; this model was not listed by the provider."
        };
      }
      return routeAvailability;
    }
    if (metadataCanConfirmRuntime) {
      return {
        modelId,
        providerKind: model.providerKind,
        availability: "confirmed"
      };
    }
    return {
      modelId,
      providerKind: model.providerKind,
      availability: "inconclusive",
      reason: redactLikelySecrets(
        metadataMatch === "matched"
          ? "Metadata endpoint confirmed the model id, but the configured transport did not verify image generation."
          : metadataMatch === "missing" && response.ok && !hasErrorPayload(payload)
            ? "Metadata endpoint did not return an exact model id."
            : metadataExplicitModelNotFound
              ? "Metadata endpoint returned model_not_found for this listed id; the configured image route did not confirm or reject it."
            : extractProbeMessage(payload, text) || `HTTP ${response.status}`,
        modelDiscoveryRedaction(apiKey)
      )
    };
  } catch (error) {
    return {
      modelId,
      providerKind: model.providerKind,
      availability: "inconclusive",
      reason: sanitizeModelDiscoveryError(error, apiKey)
    };
  }
}

function canConfirmFocusedModelFromMetadata(
  model: DiscoveredModel,
  catalogTransportProviderKind: ProviderKind,
  runtimeProviderKind: ProviderKind
): boolean {
  // A Gemini model returned by a Gemini catalogue is only confirmed for the
  // native Gemini runtime. When an OpenAI-compatible config reaches Gemini
  // through a fallback catalogue, the actual adapter uses /chat/completions
  // and must be verified separately.
  if (model.providerKind === "gemini") {
    return catalogTransportProviderKind === "gemini" && runtimeProviderKind === "gemini";
  }

  // GPT Image rows are run through the OpenAI adapter. A Gemini catalogue
  // response cannot prove that the same endpoint accepts OpenAI image routes.
  // Even a native OpenAI `/models/{id}` echo is only catalogue evidence:
  // aggregators can return stale rows, so the exact image route must still be
  // probed before a focused GPT Image launch becomes selectable.
  if (model.providerKind === "openai") {
    return false;
  }

  return false;
}

async function probeOpenAICompatibleFocusedModelAvailability(
  model: DiscoveredModel,
  runtimeProviderKind: ProviderKind,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime,
  allowReachableValidation = false
): Promise<DiscoveredModelAvailabilityProbe | undefined> {
  if (runtimeProviderKind === "gemini") return undefined;

  const modelId = stripModelResourcePrefix(model.id);
  const routes: OpenAIImageRoute[] = model.providerKind === "gemini"
    ? ["chat-completions"]
    : focusedLaunchIdForModel("openai", modelId) === GPT_IMAGE_2_5_LAUNCH_ID
      ? ["image-api", "responses"]
      : ["image-api", "responses", "chat-completions"];
  const probes = await Promise.all(
    routes.map((route) =>
      probeOpenAIImageRoute(
        runtime.fetch,
        baseURL,
        apiKey,
        Math.min(Math.max(Math.floor(timeoutMs / 8), 2500), 8000),
        route,
        "generate",
        buildOpenAIImageRouteProbeRequest(route, "generate", modelId)
      )
    )
  );

  const exactRouteConfirmed = probes.some((probe) =>
    probe.verified === true &&
    (
      model.discoverySource !== "route-candidate" ||
      probe.modelIdConfirmed === true ||
      allowReachableValidation
    )
  );
  if (exactRouteConfirmed) {
    return {
      modelId,
      providerKind: model.providerKind,
      availability: "confirmed"
    };
  }
  // The probe intentionally omits prompt/image payloads, so a provider may
  // answer with a validation-only 400/422 even though it accepted the exact
  // model id. Treat that as confirmation only when the metadata endpoint also
  // echoed the same id; otherwise an ordinary validation error is not enough
  // to distinguish a runnable deployment from a stale catalogue row.
  if (allowReachableValidation && probes.some((probe) =>
    probe.ok && (probe.status === 400 || probe.status === 422)
  )) {
    return {
      modelId,
      providerKind: model.providerKind,
      availability: "confirmed"
    };
  }
  if (isOpenAIImageModelUnavailable({ modelId, probes, updatedAt: new Date(0).toISOString() })) {
    const reason = probes
      .filter((probe) => probe.mode === "generate" && probe.modelUnavailable)
      .map((probe) => probe.error)
      .find(Boolean);
    return {
      modelId,
      providerKind: model.providerKind,
      availability: "rejected",
      ...(reason ? { reason: redactLikelySecrets(reason, modelDiscoveryRedaction(apiKey)) } : {})
    };
  }
  return undefined;
}

function parseProbePayload(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

type MetadataModelIdMatch = "matched" | "mismatched" | "missing";

function metadataPayloadModelIdMatch(
  payload: unknown,
  providerKind: ProviderKind,
  requestedModelId: string
): MetadataModelIdMatch {
  const ids = metadataPayloadModelIds(payload, providerKind);
  if (ids.length === 0) return "missing";
  const requested = normalizeProviderModelId(providerKind, requestedModelId);
  return ids.some((id) => normalizeProviderModelId(providerKind, id) === requested)
    ? "matched"
    : "mismatched";
}

/**
 * Extract only fields that can identify the provider deployment.
 *
 * OpenAI-compatible gateways commonly return `name` or `display_name` as a
 * product label rather than the requested model id. Treating that label as an
 * exact id can turn a validation-only 400 into a false confirmation, which is
 * especially dangerous for the distinct GPT Image 2 and 2.5 families.
 *
 * Gemini's native model resource uses `name` (`models/<id>`) as its canonical
 * identifier, so that field is strong evidence only for the native Gemini
 * protocol. OpenAI-compatible responses may still use `model`, `model_id`, or
 * `modelId` as aliases for the exact deployment id.
 */
function metadataPayloadModelIds(payload: unknown, providerKind: ProviderKind): string[] {
  const strongIds = new Set<string>();
  const collectStrong = (value: unknown) => {
    if (typeof value !== "string") return;
    const stripped = stripModelResourcePrefix(value);
    if (stripped) strongIds.add(stripped);
  };
  const collectNativeGeminiName = (value: unknown) => {
    if (providerKind !== "gemini") return;
    collectStrong(value);
  };
  const inspect = (value: unknown, depth = 0) => {
    if (!value || depth > 2) return;
    if (Array.isArray(value)) {
      for (const item of value) inspect(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    collectStrong(value.id);
    collectNativeGeminiName(value.name);
    collectStrong(value.modelId);
    collectStrong(value.model_id);
    collectStrong(value.model);
    inspect(value.data, depth + 1);
  };
  inspect(payload);
  return [...strongIds];
}

function hasErrorPayload(payload: unknown): boolean {
  return isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, "error");
}

function extractProbeMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const nestedError = isRecord(payload.error) ? payload.error : undefined;
    const value = firstString(
      nestedError?.message,
      nestedError?.code,
      nestedError?.type,
      payload.message,
      payload.error
    );
    if (value) return value;
  }
  return fallback;
}

function isModelNotFoundPayload(payload: unknown, fallback: string): boolean {
  const record = isRecord(payload) ? payload : undefined;
  const nestedError = record && isRecord(record.error) ? record.error : undefined;
  const explicitCodes = [
    nestedError?.code,
    nestedError?.type,
    nestedError?.status,
    record?.code,
    record?.type,
    record?.status
  ].filter((value): value is string => typeof value === "string");
  if (explicitCodes.some(isExplicitModelNotFoundCode)) return true;

  const messages = [
    nestedError?.message,
    record?.message,
    typeof record?.error === "string" ? record.error : undefined,
    fallback
  ].filter((value): value is string => typeof value === "string");
  return messages.some(isExplicitModelNotFoundMessage);
}

function isExplicitModelNotFoundCode(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "model_not_found" ||
    normalized === "modelnotfound" ||
    normalized === "model_does_not_exist";
}

function isExplicitModelNotFoundMessage(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  // A missing metadata route is a gateway capability limitation, not proof
  // that the model itself is unavailable. Keep it inconclusive so the UI
  // does not turn a generic `/models/{id}` 404 into a false rejection.
  if (/\bmodel\s+endpoint\s+(?:was\s+)?not\s+found\b/.test(normalized)) return false;
  if (/\b(?:route|endpoint)\s+(?:was\s+)?not\s+found\b/.test(normalized)) return false;

  return /\bunknown\s+model\b/.test(normalized) ||
    /\bmodel(?:\s+[a-z0-9./:]+)*\s+(?:(?:was|is)\s+not\s+found|does\s+not\s+exist|doesn't\s+exist|is\s+unknown|not\s+found)\b/.test(normalized) ||
    /\bmodel\s+not\s+found\b/.test(normalized);
}

export function sanitizeModelDiscoveryError(error: unknown, apiKey?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactLikelySecrets(raw, modelDiscoveryRedaction(apiKey)).replace(/\s+/g, " ").trim();
}

export function discoveryProviderOrder(providerKind: ProviderKind): ProviderKind[] {
  // "custom" already uses the OpenAI-compatible protocol, so probing "openai" too would hit the
  // same /models endpoint twice and list generic models under both tags. The two protocols are
  // OpenAI-compatible (custom/openai) and Gemini, so ["custom", "gemini"] already covers both.
  if (providerKind === "gemini") return ["gemini", "openai"];
  if (providerKind === "custom") return ["custom", "gemini"];
  return ["openai", "gemini"];
}

function providerLabel(providerKind: ProviderKind): string {
  if (providerKind === "gemini") return "Gemini";
  if (providerKind === "custom") return "Custom";
  return "OpenAI-compatible";
}

async function discoverOpenAICompatibleModels(
  providerKind: ProviderKind,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime
): Promise<ModelDiscoveryResult> {
  const response = await fetchWithTimeout(
    runtime.fetch,
    buildEndpoint(normalizeBaseURL(baseURL), "/models"),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(await readApiError(response, "model discovery", apiKey));
  }

  const payload = (await response.json()) as OpenAIModelsResponse;
  const payloadError = readModelDiscoveryPayloadError(payload, "model discovery", apiKey);
  if (payloadError) throw new Error(payloadError);
  return {
    models: uniqueModels(parseOpenAIModels(payload, providerKind)),
    status: response.status,
    requestId: requestIdFromHeaders(response.headers),
    transportProviderKind: providerKind
  };
}

async function discoverGeminiModels(
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  runtime: ModelDiscoveryRuntime
): Promise<ModelDiscoveryResult> {
  const endpoint = new URL(`${normalizeBaseURL(baseURL).replace(/\/+$/, "")}/models`);
  endpoint.searchParams.set("key", apiKey);
  const response = await fetchWithTimeout(
    runtime.fetch,
    endpoint.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(await readApiError(response, "Gemini model discovery", apiKey));
  }

  const payload = (await response.json()) as GeminiModelsResponse;
  const payloadError = readModelDiscoveryPayloadError(payload, "Gemini model discovery", apiKey);
  if (payloadError) throw new Error(payloadError);
  return {
    models: uniqueModels(parseGeminiModels(payload)),
    status: response.status,
    requestId: requestIdFromHeaders(response.headers),
    transportProviderKind: "gemini"
  };
}

function parseOpenAIModels(payload: OpenAIModelsResponse, providerKind: ProviderKind): DiscoveredModel[] {
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    if (typeof item.object === "string" && item.object.trim().toLowerCase() !== "model") return [];
    const id = stripModelResourcePrefix(item.id);
    if (!id) return [];
    const description = optionalString(item.description);
    return [
      {
        id,
        providerKind: getProviderKindForFocusedModelId(id) ?? providerKind,
        displayName: optionalString(item.display_name) ?? optionalString(item.displayName) ?? id,
        ...(description ? { description } : {}),
        raw: item
      }
    ];
  });
}

function parseGeminiModels(payload: GeminiModelsResponse): DiscoveredModel[] {
  if (!Array.isArray(payload.models)) return [];
  return payload.models.flatMap((item) => {
    if (!isRecord(item)) return [];
    const rawName = typeof item.name === "string" ? item.name.trim() : "";
    const rawId = typeof item.id === "string" ? item.id.trim() : "";
    const id = normalizeGeminiImageModelId(normalizeGeminiModelId(rawId || rawName));
    if (!id) return [];
    const methods = Array.isArray(item.supportedGenerationMethods)
      ? item.supportedGenerationMethods
        .filter((method): method is string => typeof method === "string")
        .map((method) => method.trim().toLowerCase().replace(/[_-]/g, ""))
      : [];
    // Gemini exposes utility-only models (for example `countTokens`) in the
    // same catalogue. They are not runnable by CrossGen's image adapter, even
    // when a provider gives them an image-looking display name.
    if (methods.length > 0 && !methods.includes("generatecontent")) return [];
    return [
      {
        id,
        providerKind: "gemini",
        displayName: optionalString(item.displayName) ?? id,
        description: optionalString(item.description),
        raw: item
      }
    ];
  });
}

function normalizeGeminiModelId(value: string): string {
  return stripModelResourcePrefix(value);
}

function uniqueModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const result: DiscoveredModel[] = [];
  for (const model of models) {
    const key = `${model.providerKind}:${normalizeProviderModelId(model.providerKind, model.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

function readModelDiscoveryPayloadError(payload: unknown, label: string, apiKey?: string): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  const message = firstString(
    payload.error.message,
    payload.error.code,
    payload.error.type,
    payload.error.status
  );
  if (!message) return `${label} failed: provider returned an error payload.`;
  return `${label} failed: ${redactLikelySecrets(message, modelDiscoveryRedaction(apiKey))}`;
}

async function readApiError(response: Response, label: string, apiKey?: string): Promise<string> {
  return readProviderApiError(response, {
    redaction: modelDiscoveryRedaction(apiKey),
    fallbackMessage: (status, requestSuffix) => `${label} failed: HTTP ${status}.${requestSuffix}`,
    formatMessage: (message, requestSuffix) => `${label} failed: ${message}${requestSuffix}`,
    extractJsonMessage(payload) {
      if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
      return firstString(payload.error.message, payload.error.code, payload.error.type, payload.error.status);
    }
  });
}

function modelDiscoveryRedaction(apiKey?: string): SecretRedactionOptions {
  return {
    apiKey,
    redactGoogleKeys: true,
    redactUrlApiKeys: true,
    redactBearerTokens: true
  };
}
