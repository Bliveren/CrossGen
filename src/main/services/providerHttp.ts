export interface SecretRedactionOptions {
  apiKey?: string;
  redactOpenAIKeys?: boolean;
  redactGoogleKeys?: boolean;
  redactUrlApiKeys?: boolean;
  redactBearerTokens?: boolean;
}

export interface ProviderApiErrorOptions {
  requestIdHeaders?: readonly string[];
  redaction?: SecretRedactionOptions;
  fallbackMessage(status: number, requestSuffix: string): string;
  formatMessage(message: string, requestSuffix: string): string;
  extractJsonMessage(payload: unknown): string | undefined;
}

export interface ProviderJsonResponseOptions {
  responseLabel: string;
  expected: string;
  invalidJsonMessage: string;
  redaction?: SecretRedactionOptions;
}

const DEFAULT_REQUEST_ID_HEADERS = ["x-request-id"] as const;

export async function readProviderApiError(response: Response, options: ProviderApiErrorOptions): Promise<string> {
  const requestId = requestIdFromHeaders(response.headers, options.requestIdHeaders);
  const requestSuffix = requestId ? ` Request ID: ${requestId}` : "";
  const fallback = options.fallbackMessage(response.status, requestSuffix);

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      const message = options.extractJsonMessage(payload)?.trim();
      return message ? options.formatMessage(redactLikelySecrets(message, options.redaction), requestSuffix) : fallback;
    }

    const text = (await response.text()).trim();
    return text ? options.formatMessage(redactLikelySecrets(text, options.redaction), requestSuffix) : fallback;
  } catch {
    return fallback;
  }
}

export async function readProviderJsonResponse<T>(response: Response, options: ProviderJsonResponseOptions): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(await readUnexpectedProviderResponse(response, options));
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(options.invalidJsonMessage);
  }
}

export async function readUnexpectedProviderResponse(response: Response, options: ProviderJsonResponseOptions): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const text = redactLikelySecrets((await response.text()).trim(), options.redaction).slice(0, 240);
  const suffix = text ? ` 响应开头：${text}` : "";
  return `${options.responseLabel} 返回了非预期响应，期望 ${options.expected}，实际 Content-Type: ${contentType}.${suffix}`;
}

export function requestIdFromHeaders(headers: Headers, headerNames: readonly string[] = DEFAULT_REQUEST_ID_HEADERS): string | undefined {
  for (const headerName of headerNames) {
    const requestId = headers.get(headerName);
    if (requestId) return requestId;
  }
  return undefined;
}

export function redactLikelySecrets(value: string, options: SecretRedactionOptions = {}): string {
  let result = value;
  if (options.apiKey) {
    result = result.split(options.apiKey).join("[redacted-api-key]");
  }
  if (options.redactOpenAIKeys ?? true) {
    result = result.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted");
  }
  if (options.redactGoogleKeys) {
    result = result.replace(/AIza[A-Za-z0-9_-]{8,}/g, "AIza...redacted");
  }
  if (options.redactUrlApiKeys) {
    result = result.replace(/([?&]key=)[^&\s]+/gi, "$1[redacted-api-key]");
  }
  if (options.redactBearerTokens) {
    result = result.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted-api-key]");
  }
  return result;
}

export function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
