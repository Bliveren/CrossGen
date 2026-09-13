import {
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  isGptImage25ModelId
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

export function buildOpenAIImageRouteProbeRequest(route: OpenAIImageRoute, mode: ProbeMode, model: string): OpenAIImageRouteProbeRequest {
  if (route === "image-api") {
    if (mode === "generate") {
      return {
        endpoint: "/images/generations",
        body: { model }
      };
    }
    const form = new FormData();
    form.set("model", model);
    return {
      endpoint: "/images/edits",
      body: form
    };
  }

  if (route === "responses") {
    const officialToolShape = isGptImage25ModelId(model);
    return {
      endpoint: "/responses",
      body: {
        model: officialToolShape ? DEFAULT_RESPONSES_MODEL : model,
        input: [],
        tools: [{
          type: "image_generation",
          ...(officialToolShape ? { model } : {}),
          action: mode === "guided-region" ? "edit" : mode
        }]
      }
    };
  }

  return {
    endpoint: "/chat/completions",
    body: {
      model,
      stream: true,
      params: {},
      features: {
        image_generation: false
      },
      messages: []
    }
  };
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

  const model = config.activeModelId || config.defaultModel || GPT_IMAGE_2_MODEL_ID;
  const gptImage25 = isGptImage25ModelId(model) ||
    config.activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID ||
    isGptImage25ModelId(config.defaultModel);
  const probeTimeoutMs = Math.min(Math.max(Math.floor(config.timeoutMs / 8), 2500), 8000);
  const routes: Array<[OpenAIImageRoute, ProbeMode]> = gptImage25
    ? [
        ["image-api", "generate"],
        ["image-api", "edit"],
        ["image-api", "guided-region"]
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

  return {
    // A successful Responses probe only proves that the endpoint accepted the
    // probe payload. It must not silently opt a normal GPT Image 2.5 request
    // into a potentially billable conversational image call. Responses is
    // selected only when the caller explicitly asks for it (or supplies a
    // continuation/Responses-only control).
    preferredGenerateRoute: gptImage25
      ? "image-api"
      : preferredOpenAIImageRoute(probes, "generate", "chat-completions"),
    preferredEditRoute: gptImage25
      ? "image-api"
      : preferredOpenAIImageRoute(probes, "edit", "chat-completions"),
    preferredGuidedEditRoute: gptImage25
      ? "image-api"
      : preferredOpenAIImageRoute(probes, "guided-region", "chat-completions"),
    preferredGenerateRouteVerified: gptImage25
      ? preferredOpenAIImageRouteVerified(probes, "generate", "image-api")
      : preferredOpenAIImageRouteVerified(probes, "generate", "chat-completions"),
    preferredEditRouteVerified: gptImage25
      ? preferredOpenAIImageRouteVerified(probes, "edit", "image-api")
      : preferredOpenAIImageRouteVerified(probes, "edit", "chat-completions"),
    preferredGuidedEditRouteVerified: gptImage25
      ? preferredOpenAIImageRouteVerified(probes, "guided-region", "image-api")
      : preferredOpenAIImageRouteVerified(probes, "guided-region", "chat-completions"),
    probes,
    updatedAt: nowIso()
  };
}

function shouldProbeOpenAIImageRouting(config: StoredProviderConfig): boolean {
  if (config.kind === "openai") {
    return config.activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ||
      config.activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID ||
      isGptImage25ModelId(config.activeModelId) ||
      isGptImage25ModelId(config.defaultModel);
  }
  if (config.kind !== "custom") return false;
  const activeModelId = (config.activeModelId || "").trim().toLowerCase();
  const defaultModel = (config.defaultModel || "").trim().toLowerCase();
  const discoveredOpenAIImageModel = config.discoveredModels.some(
    (model) => model.providerKind === "openai" &&
      (model.id.trim().toLowerCase() === GPT_IMAGE_2_MODEL_ID.toLowerCase() || isGptImage25ModelId(model.id))
  );
  return config.activeLaunchId === GPT_IMAGE_2_LAUNCH_ID ||
    config.activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID ||
    activeModelId === GPT_IMAGE_2_MODEL_ID.toLowerCase() ||
    isGptImage25ModelId(activeModelId) ||
    defaultModel === GPT_IMAGE_2_MODEL_ID.toLowerCase() ||
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
    const reachable = isRouteProbeReachableStatus(response.status);
    return {
      route,
      mode,
      endpoint: request.endpoint,
      ok: reachable,
      verified: isRouteProbeSuccessStatus(response.status),
      latencyMs,
      status: response.status,
      error: reachable ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
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

export function preferredOpenAIImageRoute(
  probes: OpenAIImageRouteProbe[],
  mode: ProbeMode,
  fallback: OpenAIImageRoute = "chat-completions"
): OpenAIImageRoute | undefined {
  const successfulCandidates = probes
    .filter((probe) => probe.mode === mode && isRouteProbeSuccessStatus(probe.status ?? 0))
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
  return probes.some((probe) => probe.mode === mode && probe.route === route && isRouteProbeSuccessStatus(probe.status ?? 0));
}

function routePreferenceScore(probe: OpenAIImageRouteProbe): number {
  return probe.latencyMs;
}
