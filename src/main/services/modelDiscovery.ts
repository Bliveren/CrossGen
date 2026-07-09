import type { DiscoveredModel, ProviderKind } from "../../shared/types.js";
import { getProviderKindForFocusedModelId } from "../../shared/modelCatalog.js";
import { DEFAULT_GEMINI_BASE_URL, normalizeBaseURL } from "../../shared/validation.js";
import { buildEndpoint, fetchWithTimeout } from "./openaiImageAdapter.js";
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
  return {
    models: uniqueModels(parseOpenAIModels(payload, providerKind)),
    status: response.status,
    requestId: requestIdFromHeaders(response.headers)
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
    requestId: requestIdFromHeaders(response.headers)
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
