import type { DiscoveredModel, ProviderKind } from "../../shared/types.js";
import { getProviderKindForFocusedModelId } from "../../shared/modelCatalog.js";
import { DEFAULT_GEMINI_BASE_URL, normalizeBaseURL } from "../../shared/validation.js";
import { buildEndpoint, fetchWithTimeout } from "./openaiImage.js";

interface OpenAIModelsResponse {
  data?: unknown;
}

interface GeminiModelsResponse {
  models?: unknown;
}

interface ApiErrorPayload {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    status?: unknown;
  };
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  status: number;
  requestId?: string;
  inferredProviderKind?: ProviderKind;
}

export interface ModelDiscoveryRuntime {
  fetch: typeof fetch;
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
  const results: Array<{ providerKind: ProviderKind; result: ModelDiscoveryResult }> = [];
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

  const resultsWithModels = results.filter((result) => result.result.models.length > 0);
  const selectedProviderHasModels = resultsWithModels.some((result) => result.providerKind === providerKind);

  return {
    models: uniqueModels(results.flatMap((result) => result.result.models)),
    status: results[0]?.result.status ?? 200,
    requestId: results.find((result) => result.result.requestId)?.result.requestId,
    inferredProviderKind: !selectedProviderHasModels && resultsWithModels.length === 1 ? resultsWithModels[0]?.providerKind : undefined
  };
}

export function sanitizeModelDiscoveryError(error: unknown, apiKey?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactLikelySecrets(raw, apiKey).replace(/\s+/g, " ").trim();
}

function discoveryProviderOrder(providerKind: ProviderKind): ProviderKind[] {
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
  return {
    models: uniqueModels(parseOpenAIModels(payload, providerKind)),
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? undefined
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
  return {
    models: uniqueModels(parseGeminiModels(payload)),
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? undefined
  };
}

function parseOpenAIModels(payload: OpenAIModelsResponse, providerKind: ProviderKind): DiscoveredModel[] {
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    const id = item.id.trim();
    return [
      {
        id,
        providerKind: getProviderKindForFocusedModelId(id) ?? providerKind,
        displayName: id,
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
    const id = normalizeGeminiModelId(rawId || rawName);
    if (!id) return [];
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
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

function uniqueModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const result: DiscoveredModel[] = [];
  for (const model of models) {
    const key = `${model.providerKind}:${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

async function readApiError(response: Response, label: string, apiKey?: string): Promise<string> {
  const requestId = response.headers.get("x-request-id");
  const requestSuffix = requestId ? ` Request ID: ${requestId}` : "";
  const fallback = `${label} failed: HTTP ${response.status}.${requestSuffix}`;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as ApiErrorPayload;
      const message = firstString(payload.error?.message, payload.error?.code, payload.error?.type, payload.error?.status);
      return message ? `${label} failed: ${redactLikelySecrets(message, apiKey)}${requestSuffix}` : fallback;
    }

    const text = (await response.text()).trim();
    return text ? `${label} failed: ${redactLikelySecrets(text, apiKey)}${requestSuffix}` : fallback;
  } catch {
    return fallback;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function redactLikelySecrets(value: string, apiKey?: string): string {
  let result = value;
  if (apiKey) {
    result = result.split(apiKey).join("[redacted-api-key]");
  }
  return result
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted")
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, "AIza...redacted")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted-api-key]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted-api-key]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
