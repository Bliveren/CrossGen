#!/usr/bin/env node
/**
 * No-cost AIHub model availability probe.
 *
 * This command only reads /models and individual model metadata endpoints. It
 * never submits an image-generation request, so it is safe to rerun while a
 * release gate is waiting for a provider to expose target models.
 */

const baseURL = (
  process.env.IMAGE2TOOLS_AIHUB_BASE_URL ??
  process.env.AIHUB_BASE_URL ??
  process.env.IMAGE2TOOLS_BASE_URL ??
  ""
).replace(/\/+$/, "");

const apiKey =
  process.env.IMAGE2TOOLS_AIHUB_API_KEY ??
  process.env.AIHUB_API_KEY ??
  process.env.IMAGE2TOOLS_API_KEY ??
  "";

const timeoutMs = Math.max(
  5_000,
  Number(process.env.IMAGE2TOOLS_AIHUB_MODEL_PROBE_TIMEOUT_MS ?? 30_000)
);

const targetModels = [
  "gpt-image-2.5",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "nano-banana-3"
];

function requireConfiguration() {
  if (!baseURL) {
    throw new Error(
      "Missing IMAGE2TOOLS_AIHUB_BASE_URL, AIHUB_BASE_URL, or IMAGE2TOOLS_BASE_URL."
    );
  }
  if (!apiKey) {
    throw new Error(
      "Missing IMAGE2TOOLS_AIHUB_API_KEY, AIHUB_API_KEY, or IMAGE2TOOLS_API_KEY."
    );
  }
}

function withTimeout(label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out.`)), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function endpoint(pathname) {
  return `${baseURL}${pathname}`;
}

function parseJSON(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function summarizePayload(payload) {
  const error = payload?.error;
  if (!error || typeof error !== "object") return {};
  return {
    errorCode: typeof error.code === "string" ? error.code : null,
    errorType: typeof error.type === "string" ? error.type : null,
    message: typeof error.message === "string" ? error.message.slice(0, 240) : null
  };
}

async function getJSON(label, pathname) {
  const timeout = withTimeout(label);
  try {
    const response = await fetch(endpoint(pathname), {
      method: "GET",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      payload: parseJSON(text),
      contentType: response.headers.get("content-type")?.split(";")[0] ?? null
    };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `${label} timed out after ${timeoutMs}ms.`
      : error instanceof Error
        ? error.message
        : String(error);
    return { status: null, ok: false, payload: null, error: message };
  } finally {
    timeout.clear();
  }
}

function modelIdsFromPayload(payload) {
  return [...new Set(
    (payload?.data ?? payload?.models ?? [])
      .map((model) => model?.id ?? model?.name?.replace(/^models\//, ""))
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim())
  )];
}

async function main() {
  requireConfiguration();

  const modelsResponse = await getJSON("AIHub models", "/models");
  if (!modelsResponse.payload && !modelsResponse.error) {
    throw new Error(
      `AIHub /models returned non-JSON HTTP ${modelsResponse.status ?? "unknown"}.`
    );
  }
  if (modelsResponse.error) {
    throw new Error(modelsResponse.error);
  }

  const availableModelIds = modelIdsFromPayload(modelsResponse.payload);
  const imageModelIds = availableModelIds.filter((id) => /image|gemini|banana/i.test(id));
  const probes = {};

  for (const model of targetModels) {
    const response = await getJSON(`AIHub model ${model}`, `/models/${encodeURIComponent(model)}`);
    probes[model] = {
      listed: availableModelIds.includes(model),
      status: response.status,
      ok: response.ok,
      ...summarizePayload(response.payload),
      ...(response.error ? { transportError: response.error } : {})
    };
  }

  const result = {
    checkedAt: new Date().toISOString(),
    endpoint: `${baseURL}/models`,
    requestType: "read-only",
    availableImageModels: imageModelIds,
    targetModels: probes
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
