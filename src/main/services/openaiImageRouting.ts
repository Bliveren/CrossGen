import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  isGptImage25LaunchAlias,
  isGptImage25ModelId,
  isGptImage25ProviderModelId,
  isGptImage2ModelId,
  normalizeModelId,
  stripModelResourcePrefix
} from "../../shared/modelCatalog.js";
import { DEFAULT_RESPONSES_MODEL } from "../../shared/validation.js";
import type { OpenAIImageRoute, OpenAIImageRouteProbe, OpenAIImageRouting } from "../../shared/types.js";
import { buildEndpoint, fetchWithTimeout } from "./openaiImageAdapter.js";
import { redactLikelySecrets } from "./providerHttp.js";
import type { StoredProviderConfig } from "./stateMigration.js";

type ProbeMode = "generate" | "edit" | "guided-region";
type ProbeEndpoint = "/images/generations" | "/images/edits" | "/responses" | "/chat/completions";

interface OpenAIImageRouteProbeRequest {
  endpoint: ProbeEndpoint;
  body: Record<string, unknown> | FormData;
}

function normalizeProbeError(error: unknown): string {
  if (error instanceof Error) return redactLikelySecrets(error.message);
  return redactLikelySecrets(String(error));
}

function parseProbeErrorPayload(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function probeResponseErrorMessage(text: string): string | undefined {
  const payload = parseProbeErrorPayload(text);
  if (!payload || typeof payload !== "object" || !Object.prototype.hasOwnProperty.call(payload, "error")) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const nestedError = record.error;
  if (typeof nestedError === "string" && nestedError.trim()) return redactLikelySecrets(nestedError.trim());
  if (nestedError && typeof nestedError === "object") {
    const nestedRecord = nestedError as Record<string, unknown>;
    const message = [nestedRecord.message, nestedRecord.code, nestedRecord.type]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (message) return redactLikelySecrets(message.trim());
  }
  const message = [record.message, record.code, record.type]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return message ? redactLikelySecrets(message.trim()) : "Provider returned an error payload.";
}

type ProbeModelErrorKind = "none" | "target-model-unavailable" | "other-model-unavailable";

interface ProbeModelError {
  kind: ProbeModelErrorKind;
  message?: string;
}

function classifyProbeModelError(
  status: number,
  text: string,
  targetModelId: string,
  primaryModelId: string
): ProbeModelError {
  const payload = parseProbeErrorPayload(text);
  const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : undefined;
  const nestedError = payloadRecord?.error;
  const record = nestedError && typeof nestedError === "object"
    ? nestedError as Record<string, unknown>
    : payloadRecord;
  const code = typeof record?.code === "string"
    ? record.code
    : typeof payloadRecord?.error_code === "string"
      ? payloadRecord.error_code
      : "";
  const type = typeof record?.type === "string" ? record.type : "";
  const message = typeof record?.message === "string"
    ? record.message
      : typeof payloadRecord?.message === "string"
        ? payloadRecord.message
        : text;
  const haystack = `${code} ${type} ${message}`.toLowerCase();
  const explicitModelCode = haystack.includes("model_not_found") ||
    haystack.includes("model-not-found");
  const modelMentioned = /\bmodel\b/.test(haystack);
  const looksLikeMissingModel = explicitModelCode ||
    (modelMentioned && (
      haystack.includes("model not found") ||
      haystack.includes("does not exist") ||
      haystack.includes("unknown model") ||
      haystack.includes("not found")
    ));

  if (!looksLikeMissingModel) return { kind: "none" };

  const target = normalizeUnavailableModelId(targetModelId);
  const primary = normalizeUnavailableModelId(primaryModelId);
  const mentionedModelIds = extractUnavailableModelIds(message);
  const redactedMessage = redactLikelySecrets(message || `HTTP ${status}`);

  if (mentionedModelIds.length > 0) {
    return target && mentionedModelIds.includes(target)
      ? { kind: "target-model-unavailable", message: redactedMessage }
      : { kind: "other-model-unavailable", message: redactedMessage };
  }

  // GPT Image 2.5 Responses probes use a mainline Responses model plus the
  // image model as a tool model. A model_not_found error without a concrete id
  // is ambiguous in that shape, so it must not veto the image model itself.
  if (target && (!primary || primary === target)) {
    return { kind: "target-model-unavailable", message: redactedMessage };
  }
  return { kind: "other-model-unavailable", message: redactedMessage };
}

function normalizeUnavailableModelId(value: string): string {
  return normalizeModelId(stripModelResourcePrefix(value));
}

function extractUnavailableModelIds(value: string): string[] {
  const result = new Set<string>();
  const collect = (match: RegExpExecArray | null) => {
    const candidate = match?.[1];
    if (!candidate) return;
    const normalized = normalizeUnavailableModelId(candidate.replace(/[.,;:]+$/, ""));
    if (isModelLikeErrorToken(normalized)) result.add(normalized);
  };
  const patterns = [
    /\bmodel(?:\s+id)?\s*(?:=|:|is|named|called)?\s*["'`“”]?([a-z0-9][a-z0-9._:/-]{2,})["'`“”]?/gi,
    /["'`“”]((?:models\/)?(?:gpt-image-2(?:\.5)?(?:-[a-z0-9.-]+)?|gpt-[a-z0-9][a-z0-9.-]*|gemini-[a-z0-9][a-z0-9.-]*|dall-e-[a-z0-9.-]+))["'`“”]/gi,
    /\b((?:models\/)?(?:gpt-image-2(?:\.5)?(?:-[a-z0-9.-]+)?|gpt-[a-z0-9][a-z0-9.-]*|gemini-[a-z0-9][a-z0-9.-]*|dall-e-[a-z0-9.-]+))\b/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) collect(match);
  }
  return [...result];
}

function isModelLikeErrorToken(value: string): boolean {
  if (!value) return false;
  if (["not", "does", "exist", "unknown", "found", "endpoint", "route", "model"].includes(value)) return false;
  return value.includes("-") || value.includes(".") || value.includes("/") || /^gpt\d/.test(value);
}

export function buildOpenAIImageRouteProbeRequest(route: OpenAIImageRoute, mode: ProbeMode, model: string): OpenAIImageRouteProbeRequest {
  const probeModel = normalizeProbeModelId(model);
  if (route === "image-api") {
    if (mode === "generate") {
      return {
        endpoint: "/images/generations",
        body: { model: probeModel }
      };
    }
    const form = new FormData();
    form.set("model", probeModel);
    return {
      endpoint: "/images/edits",
      body: form
    };
  }

  if (route === "responses") {
    const officialToolShape = isGptImage25ProviderModelId(probeModel);
    return {
      endpoint: "/responses",
      body: {
        model: officialToolShape ? DEFAULT_RESPONSES_MODEL : probeModel,
        input: [],
        tools: [{
          type: "image_generation",
          ...(officialToolShape ? { model: probeModel } : {}),
          action: mode === "guided-region" ? "edit" : mode
        }]
      }
    };
  }

  return {
    endpoint: "/chat/completions",
    body: {
      model: probeModel,
      stream: true,
      params: {},
      features: {
        image_generation: false
      },
      messages: []
    }
  };
}

function normalizeProbeModelId(model: string): string {
  // Discovery uses normalized ids only for family classification. The
  // provider request must retain the exact id returned by the gateway:
  // gateways can expose case-sensitive deployment ids and a lower-cased
  // `gpt-image-2.5` can otherwise be mistaken for a different deployment.
  const stripped = stripModelResourcePrefix(model);
  // The undated GPT Image 2.5 value is a CrossGen compatibility alias, not
  // provider evidence. `resolveProbeTarget` converts that alias to the
  // concrete default; real Sunburst/Flare and dated provider ids remain exact.
  return stripped;
}

export function isRouteProbeSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export function isRouteProbeReachableStatus(status: number): boolean {
  return isRouteProbeSuccessStatus(status) || status === 400 || status === 422;
}

export async function probeOpenAIImageRouting(
  config: StoredProviderConfig,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  nowIso: () => string = () => new Date().toISOString()
): Promise<OpenAIImageRouting | undefined> {
  if (!shouldProbeOpenAIImageRouting(config)) return config.openAIImageRouting;

  // A persisted launch is only a compatibility hint. When the config carries
  // an explicit provider model id, that exact id decides whether this probe is
  // GPT Image 2 or GPT Image 2.5. This prevents a stale launch field from
  // probing a GPT Image 2 deployment with the GPT Image 2.5 route matrix (or
  // vice versa).
  const isGeneralFallback = config.activeLaunchId === GENERAL_LAUNCH_ID;
  const probeTarget = isGeneralFallback
    ? {
        model: normalizeProbeModelId(config.activeModelId || config.defaultModel),
        gptImage25: false
      }
    : resolveProbeTarget(config);
  const model = probeTarget.model;
  const gptImage25 = probeTarget.gptImage25;
  const probeTimeoutMs = Math.min(Math.max(Math.floor(config.timeoutMs / 8), 2500), 8000);
  const routes: Array<[OpenAIImageRoute, ProbeMode]> = isGeneralFallback
    ? [["image-api", "edit"]]
    : gptImage25
    ? [
        ["image-api", "generate"],
        ["image-api", "edit"],
        ["image-api", "guided-region"],
        // A gateway may expose GPT Image 2.5 through the Responses image tool
        // while leaving the Images API unavailable. Keep this probe for model
        // existence only; normal auto routing remains Images API below.
        ["responses", "generate"]
      ]
    : [
        ["image-api", "generate"],
        ["image-api", "edit"],
        ["image-api", "guided-region"],
        ["responses", "edit"],
        ["responses", "guided-region"],
        ["responses", "generate"],
        ["chat-completions", "edit"],
        ["chat-completions", "guided-region"],
        ["chat-completions", "generate"]
      ];
  const probes = await Promise.all(
    routes.map(([route, mode]) => probeOpenAIImageRoute(fetchImpl, config.baseURL, apiKey, probeTimeoutMs, route, mode, buildOpenAIImageRouteProbeRequest(route, mode, model)))
  );
  if (isGeneralFallback) {
    return {
      modelId: normalizeProbeModelId(model),
      preferredEditRoute: "image-api",
      preferredEditRouteVerified: isPreferredRouteVerified(probes, "edit", "image-api"),
      probes,
      updatedAt: nowIso()
    };
  }
  const preferredGenerateRoute = gptImage25
    ? "image-api"
    : preferredOpenAIImageRoute(probes, "generate", "chat-completions");
  const preferredEditRoute = gptImage25
    ? "image-api"
    : preferredOpenAIImageRoute(probes, "edit", "chat-completions");
  const preferredGuidedEditRoute = gptImage25
    ? "image-api"
    : preferredOpenAIImageRoute(probes, "guided-region", "chat-completions");

  return {
    modelId: normalizeProbeModelId(model),
    // A successful Responses probe only proves that the endpoint accepted the
    // probe payload. It must not silently opt a normal GPT Image 2.5 request
    // into a potentially billable conversational image call. Responses is
    // selected only when the caller explicitly asks for it (or supplies a
    // continuation/Responses-only control).
    preferredGenerateRoute,
    preferredEditRoute,
    preferredGuidedEditRoute,
    // Verification must describe the route selected above. Re-running route
    // preference here can pick a different endpoint when probes finish with
    // equal/near-equal latency, which is especially misleading for GPT Image
    // 2.5 where Responses is probed for capability but never selected for
    // normal auto generation.
    preferredGenerateRouteVerified: isPreferredRouteVerified(probes, "generate", preferredGenerateRoute),
    preferredEditRouteVerified: isPreferredRouteVerified(probes, "edit", preferredEditRoute),
    preferredGuidedEditRouteVerified: isPreferredRouteVerified(probes, "guided-region", preferredGuidedEditRoute),
    probes,
    updatedAt: nowIso()
  };
}

function resolveProbeTarget(config: StoredProviderConfig): {
  model: string;
  gptImage25: boolean;
} {
  const activeModel = config.activeModelId?.trim() ?? "";
  const defaultModel = config.defaultModel?.trim() ?? "";
  const requestedModel = activeModel || defaultModel;

  if (requestedModel) {
    const normalizedModel = normalizeProbeModelId(requestedModel);
    if (isGptImage25ProviderModelId(normalizedModel)) {
      return { model: normalizedModel, gptImage25: true };
    }
    if (isGptImage25LaunchAlias(requestedModel)) {
      return {
        model: GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
        gptImage25: true
      };
    }
    if (isGptImage2ModelId(normalizedModel)) {
      return { model: normalizedModel, gptImage25: false };
    }
    // Unknown/custom provider ids are intentionally not promoted to either
    // focused family just because the saved launch says GPT Image 2.5.
    return { model: normalizedModel, gptImage25: false };
  }

  // Only an empty model can inherit the launch's default provider target.
  if (config.activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID) {
    return {
      model: GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
      gptImage25: true
    };
  }
  return {
    model: GPT_IMAGE_2_MODEL_ID,
    gptImage25: false
  };
}

function shouldProbeOpenAIImageRouting(config: StoredProviderConfig): boolean {
  if (config.activeLaunchId === GENERAL_LAUNCH_ID) {
    // General OpenAI-compatible fallback: probe the edit route for the exact
    // model so the main process can gate reference-image editing on evidence.
    if (config.kind !== "openai" && config.kind !== "custom") return false;
    return Boolean((config.activeModelId || config.defaultModel).trim());
  }
  if (config.kind === "openai") {
    return config.activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ||
      config.activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID ||
      isGptImage2ModelId(config.activeModelId || "") ||
      isGptImage25ModelId(config.activeModelId) ||
      isGptImage2ModelId(config.defaultModel || "") ||
      isGptImage25ModelId(config.defaultModel);
  }
  if (config.kind !== "custom") return false;
  const activeModelId = (config.activeModelId || "").trim().toLowerCase();
  const defaultModel = (config.defaultModel || "").trim().toLowerCase();
  const discoveredOpenAIImageModel = config.discoveredModels.some(
    (model) => model.providerKind === "openai" &&
      (isGptImage2ModelId(model.id) || isGptImage25ProviderModelId(model.id))
  );
  return config.activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ||
    config.activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID ||
    isGptImage2ModelId(activeModelId) ||
    isGptImage25ModelId(activeModelId) ||
    isGptImage2ModelId(defaultModel) ||
    isGptImage25ModelId(defaultModel) ||
    discoveredOpenAIImageModel;
}

export async function probeOpenAIImageRoute(
  fetchImpl: typeof fetch,
  baseURL: string,
  apiKey: string,
  timeoutMs: number,
  route: OpenAIImageRoute,
  mode: ProbeMode,
  request: OpenAIImageRouteProbeRequest
): Promise<OpenAIImageRouteProbe> {
  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: request.endpoint === "/chat/completions" ? "text/event-stream" : "application/json"
    };
    if (!(request.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetchWithTimeout(fetchImpl, buildEndpoint(baseURL, request.endpoint), {
      method: "POST",
      headers,
      body: request.body instanceof FormData ? request.body : JSON.stringify(request.body)
    }, timeoutMs);
    const latencyMs = Date.now() - startedAt;
    const responseText = await response.text().catch(() => "");
    const targetModelId = probeTargetModelId(route, request.body);
    const primaryModelId = probePrimaryModelId(request.body);
    const modelError = classifyProbeModelError(response.status, responseText, targetModelId, primaryModelId);
    const blockedByOtherModel = modelError.kind === "other-model-unavailable" ? modelError.message : undefined;
    // A few gateways return an application-level error envelope with HTTP
    // 200. Treat that as a failed probe rather than confirming the model.
    // 4xx validation responses remain reachable-but-unverified because the
    // lightweight probe intentionally omits the full image payload.
    const applicationError = isRouteProbeSuccessStatus(response.status)
      ? probeResponseErrorMessage(responseText)
      : undefined;
    const payloadInspection = inspectProbeResponsePayload(route, responseText, targetModelId);
    const responseModelMismatch = payloadInspection.mismatchedModelId
      ? `Provider returned model '${payloadInspection.mismatchedModelId}' for requested model '${targetModelId}'.`
      : undefined;
    const explicitTargetUnavailable = modelError.kind === "target-model-unavailable"
      ? modelError.message
      : responseModelMismatch;
    const reachable = !explicitTargetUnavailable && !blockedByOtherModel && !applicationError &&
      isRouteProbeReachableStatus(response.status);
    const verified = !explicitTargetUnavailable && !blockedByOtherModel && !applicationError &&
      isRouteProbeSuccessStatus(response.status) &&
      payloadInspection.positive;
    return {
      modelId: normalizeProbeModelId(targetModelId),
      route,
      mode,
      endpoint: request.endpoint,
      ok: reachable && !responseModelMismatch,
      verified,
      ...(payloadInspection.modelIdMatched !== undefined
        ? { modelIdConfirmed: payloadInspection.modelIdMatched }
        : {}),
      ...(explicitTargetUnavailable ? { modelUnavailable: true } : {}),
      latencyMs,
      status: response.status,
      error: reachable && !responseModelMismatch
        ? undefined
        : explicitTargetUnavailable ?? blockedByOtherModel ?? applicationError ?? `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      modelId: normalizeProbeModelId(probeTargetModelId(route, request.body)),
      route,
      mode,
      endpoint: request.endpoint,
      ok: false,
      verified: false,
      latencyMs: Date.now() - startedAt,
      error: normalizeProbeError(error)
    };
  }
}

/**
 * A successful HTTP status proves that a route is reachable, but not that the
 * requested model was accepted. Some OpenAI-compatible gateways return an
 * empty success envelope (`{ data: [] }`, `{ output: [] }`, or
 * `{ choices: [] }`) for unsupported requests. Treat those envelopes as
 * reachable-but-unverified so model discovery cannot enable a speculative
 * GPT Image 2/2.5 candidate on a generic 200 response.
 */
interface ProbeResponseInspection {
  positive: boolean;
  modelIdMatched?: boolean;
  mismatchedModelId?: string;
}

function inspectProbeResponsePayload(
  route: OpenAIImageRoute,
  responseText: string,
  targetModelId: string
): ProbeResponseInspection {
  if (!responseText.trim()) return { positive: false };
  const payloads: Record<string, unknown>[] = [];
  const payload = parseProbeErrorPayload(responseText);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    payloads.push(payload as Record<string, unknown>);
  } else {
    // A streaming provider may return SSE rather than a single JSON object.
    // Inspect each event rather than treating any `data:` line as proof:
    // `{ choices: [] }` is still an empty success envelope when streamed.
    for (const line of responseText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const eventText = trimmed.slice("data:".length).trim();
      if (!eventText || eventText === "[DONE]") continue;
      const eventPayload = parseProbeErrorPayload(eventText);
      if (eventPayload && typeof eventPayload === "object" && !Array.isArray(eventPayload)) {
        payloads.push(eventPayload as Record<string, unknown>);
      }
    }
  }

  const observedModelIds = new Set<string>();
  let positive = false;
  for (const record of payloads) {
    if (hasPositiveProbeRecord(route, record)) positive = true;
    for (const modelId of probeResponseModelIds(route, record)) {
      observedModelIds.add(modelId);
    }
  }
  const normalizedTarget = normalizeUnavailableModelId(targetModelId);
  const modelIdMatched = observedModelIds.size > 0
    ? [...observedModelIds].some((modelId) => normalizeUnavailableModelId(modelId) === normalizedTarget)
    : undefined;
  const mismatchedModelId = normalizedTarget
    ? [...observedModelIds]
      .find((modelId) => normalizeUnavailableModelId(modelId) !== normalizedTarget)
    : undefined;
  return {
    positive,
    ...(modelIdMatched !== undefined ? { modelIdMatched } : {}),
    ...(mismatchedModelId ? { mismatchedModelId } : {})
  };
}

function hasPositiveProbeRecord(route: OpenAIImageRoute, record: Record<string, unknown>): boolean {
  if (route === "image-api" && Array.isArray(record.data)) return record.data.length > 0;
  if (route === "responses" && Array.isArray(record.output)) return record.output.length > 0;
  if (route === "chat-completions" && Array.isArray(record.choices)) return record.choices.length > 0;
  return false;
}

/**
 * Extract only explicit deployment ids from a successful probe response.
 * Responses has a deliberate exception: its top-level `model` is the
 * conversational/mainline model, not the image tool model, so only output
 * image-generation items are inspected there.
 */
function probeResponseModelIds(route: OpenAIImageRoute, record: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value !== "string") return;
    const modelId = stripModelResourcePrefix(value);
    if (modelId) ids.add(modelId);
  };
  const collectDirect = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    collect(item.model);
    collect(item.model_id);
    collect(item.modelId);
  };

  if (route !== "responses") {
    collectDirect(record);
    const collectionKey = route === "image-api" ? "data" : "choices";
    const collection = record[collectionKey];
    if (Array.isArray(collection)) {
      for (const item of collection) collectDirect(item);
    }
    return [...ids];
  }

  const collectResponseOutput = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      collectDirect(item);
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const nestedItem = item as Record<string, unknown>;
        collectDirect(nestedItem.item);
      }
    }
  };

  collectResponseOutput(record.output);
  collectDirect(record.item);
  if (record.response && typeof record.response === "object" && !Array.isArray(record.response)) {
    const response = record.response as Record<string, unknown>;
    collectResponseOutput(response.output);
    collectDirect(response.item);
  }
  return [...ids];
}

function probeTargetModelId(route: OpenAIImageRoute, body: Record<string, unknown> | FormData): string {
  if (body instanceof FormData) return String(body.get("model") ?? "");
  if (route === "responses") {
    return String(
      (body.tools as Array<Record<string, unknown>> | undefined)?.[0]?.model ??
      body.model ??
      ""
    );
  }
  return String(body.model ?? "");
}

function probePrimaryModelId(body: Record<string, unknown> | FormData): string {
  if (body instanceof FormData) return String(body.get("model") ?? "");
  return String(body.model ?? "");
}

/**
 * A model is definitely unavailable only when every generate probe explicitly
 * rejects the exact model id. Transport failures and ordinary validation
 * errors remain inconclusive: a gateway may expose the model through another
 * route or require a fuller request body.
 */
export function isOpenAIImageModelUnavailable(routing: OpenAIImageRouting | undefined): boolean {
  if (!routing) return false;
  const generateProbes = routing.probes.filter((probe) => probe.mode === "generate");
  return generateProbes.length > 0 && generateProbes.every((probe) => probe.modelUnavailable === true);
}

export function preferredOpenAIImageRoute(
  probes: OpenAIImageRouteProbe[],
  mode: ProbeMode,
  fallback: OpenAIImageRoute = "chat-completions"
): OpenAIImageRoute | undefined {
  const successfulCandidates = probes
    .filter((probe) => probe.mode === mode && probe.ok && isRouteProbeSuccessStatus(probe.status ?? 0))
    .sort((a, b) => routePreferenceScore(a) - routePreferenceScore(b));
  if (successfulCandidates[0]) return successfulCandidates[0].route;

  return fallback;
}

export function preferredOpenAIImageRouteVerified(
  probes: OpenAIImageRouteProbe[],
  mode: ProbeMode,
  fallback: OpenAIImageRoute = "chat-completions"
): boolean {
  const route = preferredOpenAIImageRoute(probes, mode, fallback);
  return isPreferredRouteVerified(probes, mode, route);
}

function isPreferredRouteVerified(
  probes: OpenAIImageRouteProbe[],
  mode: ProbeMode,
  route: OpenAIImageRoute | undefined
): boolean {
  if (!route) return false;
  return probes.some((probe) =>
    probe.mode === mode &&
    probe.route === route &&
    probe.ok &&
    probe.verified === true
  );
}

function routePreferenceScore(probe: OpenAIImageRouteProbe): number {
  return probe.latencyMs;
}
