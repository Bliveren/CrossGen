import {
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID
} from "../../shared/modelCatalog.js";
import type { OpenAIImageRoute, OpenAIImageRouteProbe, OpenAIImageRouting } from "../../shared/types.js";
import { buildEndpoint, fetchWithTimeout } from "./openaiImageAdapter.js";
import { redactLikelySecrets } from "./providerHttp.js";
import type { StoredProviderConfig } from "./stateMigration.js";

type ProbeMode = "generate" | "edit";
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
    return {
      endpoint: "/responses",
      body: {
        model,
        input: [],
        tools: [{ type: "image_generation", action: mode }]
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
  if (config.kind !== "openai" || config.activeLaunchId !== GPT_IMAGE_2_LAUNCH_ID) return config.openAIImageRouting;

  const model = config.activeModelId || config.defaultModel || GPT_IMAGE_2_MODEL_ID;
  const probeTimeoutMs = Math.min(Math.max(Math.floor(config.timeoutMs / 8), 2500), 8000);
  const routes: Array<[OpenAIImageRoute, ProbeMode]> = [
    ["image-api", "generate"],
    ["image-api", "edit"],
    ["responses", "edit"],
    ["responses", "generate"],
    ["chat-completions", "edit"],
    ["chat-completions", "generate"]
  ];
  const probes = await Promise.all(
    routes.map(([route, mode]) => probeOpenAIImageRoute(fetchImpl, config.baseURL, apiKey, probeTimeoutMs, route, mode, buildOpenAIImageRouteProbeRequest(route, mode, model)))
  );

  return {
    preferredGenerateRoute: preferredOpenAIImageRoute(probes, "generate"),
    preferredEditRoute: preferredOpenAIImageRoute(probes, "edit"),
    probes,
    updatedAt: nowIso()
  };
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
      latencyMs: Date.now() - startedAt,
      error: normalizeProbeError(error)
    };
  }
}

export function preferredOpenAIImageRoute(probes: OpenAIImageRouteProbe[], mode: ProbeMode): OpenAIImageRoute | undefined {
  const successfulCandidates = probes
    .filter((probe) => probe.mode === mode && isRouteProbeSuccessStatus(probe.status ?? 0))
    .sort((a, b) => routePreferenceScore(a) - routePreferenceScore(b));
  if (successfulCandidates[0]) return successfulCandidates[0].route;

  return "chat-completions";
}

function routePreferenceScore(probe: OpenAIImageRouteProbe): number {
  return probe.latencyMs;
}
