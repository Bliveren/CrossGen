import { pathToFileURL } from "node:url";

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

export const TARGET_MODELS = [
  "gpt-image-2",
  "gpt-image-2.5",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "nano-banana-3"
];

/**
 * These are provider ids, not CrossGen launch ids. The undated
 * `gpt-image-2.5` and `nano-banana-3` values are intentionally absent: they
 * are product/workflow aliases used for old drafts and AppLinks, and must not
 * turn a provider listing into evidence that the corresponding deployment is
 * runnable.
 */
export const GPT_IMAGE_2_5_PROVIDER_MODEL_IDS = Object.freeze([
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare"
]);

export const NANO_BANANA_3_PROVIDER_MODEL_IDS = Object.freeze([
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image"
]);

/**
 * CrossGen launch ids are not always provider wire ids. In particular,
 * `nano-banana-3` is a stable product/workflow alias for the Gemini Image
 * provider models below.
 */
export const TARGET_PROVIDER_MODEL_IDS = Object.freeze({
  "gpt-image-2": ["gpt-image-2"],
  "gpt-image-2.5": [...GPT_IMAGE_2_5_PROVIDER_MODEL_IDS],
  "gpt-image-2.5-sunburst": ["gpt-image-2.5-sunburst"],
  "gpt-image-2.5-flare": ["gpt-image-2.5-flare"],
  "nano-banana-3": [...NANO_BANANA_3_PROVIDER_MODEL_IDS]
});

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

export function isModelNotFoundPayload(payload) {
  const nestedError = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload.error
    : undefined;
  const error = nestedError !== undefined ? nestedError : payload;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    if ([error.code, error.type, error.status].some((value) =>
      typeof value === "string" && isExplicitModelNotFoundCode(value)
    )) {
      return true;
    }
    return [
      error.message,
      typeof payload?.message === "string" ? payload.message : null,
      typeof payload?.error === "string" ? payload.error : null
    ].some((value) => typeof value === "string" && isExplicitModelNotFoundMessage(value));
  }
  return [
    typeof error === "string" ? error : null,
    typeof payload?.message === "string" ? payload.message : null
  ].some((value) => typeof value === "string" && isExplicitModelNotFoundMessage(value));
}

function isExplicitModelNotFoundCode(value) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "model_not_found" ||
    normalized === "modelnotfound" ||
    normalized === "model_does_not_exist";
}

function isExplicitModelNotFoundMessage(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (/\bmodel\s+endpoint\s+(?:was\s+)?not\s+found\b/.test(normalized)) return false;
  if (/\b(?:route|endpoint)\s+(?:was\s+)?not\s+found\b/.test(normalized)) return false;
  return /\bunknown\s+model\b/.test(normalized) ||
    /\bmodel(?:\s+[a-z0-9./:]+)*\s+(?:(?:was|is)\s+not\s+found|does\s+not\s+exist|doesn't\s+exist|is\s+unknown|not\s+found)\b/.test(normalized) ||
    /\bmodel\s+not\s+found\b/.test(normalized);
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

export function canonicalModelId(value) {
  return String(value ?? "").trim().replace(/^models\//i, "").toLowerCase();
}

function metadataPayloadModelIds(payload) {
  const seen = new Set();
  const collect = (value) => {
    if (typeof value !== "string") return;
    const id = value.trim().replace(/^models\//i, "");
    if (id) seen.add(id);
  };
  const inspect = (value, depth = 0) => {
    if (!value || depth > 2) return;
    if (Array.isArray(value)) {
      for (const item of value) inspect(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    collect(value.id);
    collect(value.modelId);
    collect(value.model_id);
    collect(value.model);
    inspect(value.data, depth + 1);
  };
  inspect(payload);
  return [...seen];
}

export function metadataPayloadModelIdMatch(payload, requestedModelId) {
  const ids = metadataPayloadModelIds(payload);
  if (ids.length === 0) return "missing";
  const requestedId = canonicalModelId(requestedModelId);
  return ids.some((id) => canonicalModelId(id) === requestedId)
    ? "matched"
    : "mismatched";
}

function modelEntriesFromPayload(payload) {
  const collection = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  return collection.flatMap((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model)) return [];
    if (
      typeof model.object === "string" &&
      model.object.trim() &&
      model.object.trim().toLowerCase() !== "model"
    ) {
      return [];
    }
    // AIHub is probed through its OpenAI-compatible surface. Keep the
    // catalogue identity aligned with the runtime parser: `id` is the only
    // strong model identity field here. A `name` field is often a friendly
    // label (and can even be a stale GPT Image 2.5 label on another model).
    const rawId = typeof model.id === "string" ? model.id : "";
    const id = rawId.trim().replace(/^models\//i, "");
    return id ? [{ id, raw: model }] : [];
  });
}

function isValidIsoDate(value) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);
  if (!match?.groups) return false;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

/**
 * Match exact GPT Image 2 provider ids. A dated snapshot belongs to GPT
 * Image 2 only when its calendar date is valid; GPT Image 2.5 ids are kept in
 * a separate matcher below so discovery cannot silently cross the families.
 */
export function isGptImage2ProviderModelId(modelId) {
  const normalized = canonicalModelId(modelId);
  if (normalized === "gpt-image-2") return true;
  const snapshot = normalized.match(/^gpt-image-2-(\d{4}-\d{2}-\d{2})$/);
  return Boolean(snapshot?.[1] && isValidIsoDate(snapshot[1]));
}

export function modelFamily(modelId) {
  const normalized = canonicalModelId(modelId);
  if (isGptImage2ProviderModelId(normalized)) return "gpt-image-2";
  const gptImage25Snapshot = normalized.match(
    /^gpt-image-2\.5(?:-(?:sunburst|flare))?-(\d{4}-\d{2}-\d{2})$/
  );
  if (
    normalized === "gpt-image-2.5-sunburst" ||
    normalized === "gpt-image-2.5-flare" ||
    (gptImage25Snapshot?.[1] && isValidIsoDate(gptImage25Snapshot[1]))
  ) {
    return "gpt-image-2.5";
  }
  if (
    normalized === "gemini-3.1-flash-image" ||
    normalized === "gemini-3.1-flash-lite-image" ||
    normalized === "gemini-3-pro-image"
  ) {
    return "nano-banana-3";
  }
  return null;
}

/**
 * Resolve the product family for a launch target. Unlike `modelFamily`, this
 * helper deliberately accepts the CrossGen launch aliases because they are
 * keys in the report, not provider evidence.
 */
export function targetFamily(modelId) {
  const normalized = canonicalModelId(modelId);
  if (normalized === "gpt-image-2") return "gpt-image-2";
  if (normalized === "gpt-image-2.5" || modelFamily(normalized) === "gpt-image-2.5") {
    return "gpt-image-2.5";
  }
  if (normalized === "nano-banana-3" || modelFamily(normalized) === "nano-banana-3") {
    return "nano-banana-3";
  }
  return null;
}

export function isGptImage25ProviderModelId(modelId) {
  const normalized = canonicalModelId(modelId);
  if (
    normalized === "gpt-image-2.5-sunburst" ||
    normalized === "gpt-image-2.5-flare"
  ) {
    return true;
  }
  const snapshot = normalized.match(
    /^gpt-image-2\.5(?:-(?:sunburst|flare))?-(\d{4}-\d{2}-\d{2})$/
  );
  return Boolean(snapshot?.[1] && isValidIsoDate(snapshot[1]));
}

export function isGptImage25LaunchAlias(modelId) {
  return canonicalModelId(modelId) === "gpt-image-2.5";
}

export function isNanoBanana3ProviderModelId(modelId) {
  return NANO_BANANA_3_PROVIDER_MODEL_IDS.includes(canonicalModelId(modelId));
}

/**
 * Turn the two read-only signals into a conservative, user-facing result.
 *
 * `/models` is the only signal that can make a target eligible for launch.
 * The per-model endpoint is retained as supporting evidence. A gateway can
 * return `model_not_found` from `/models/{id}` while accepting the same exact
 * id on its real image route, so a read-only metadata probe records that
 * contradiction as `inconclusive` rather than claiming the model is absent.
 * A metadata response by itself must never create a launch option.
 */
export function classifyModelProbe(modelId, availableModelIds, response) {
  const modelIds = Array.isArray(availableModelIds)
    ? availableModelIds.filter((id) => typeof id === "string")
    : [];
  const requestedId = canonicalModelId(modelId);
  const listedAs = modelIds.find((id) => canonicalModelId(id) === requestedId) ?? null;
  const exactIdMatch = listedAs !== null;
  const modelNotFound = isModelNotFoundPayload(response?.payload);
  const metadataMatch = response?.ok && !modelNotFound
    ? metadataPayloadModelIdMatch(response.payload, modelId)
    : "missing";
  const errorPayload = Boolean(
    response?.payload &&
    typeof response.payload === "object" &&
    !Array.isArray(response.payload) &&
    Object.prototype.hasOwnProperty.call(response.payload, "error")
  );
  let metadataStatus;

  if (exactIdMatch && response?.error) {
    metadataStatus = "metadata-probe-error";
  } else if (exactIdMatch && modelNotFound) {
    metadataStatus = "listed-but-metadata-rejected";
  } else if (exactIdMatch && errorPayload) {
    metadataStatus = "listed-but-metadata-error";
  } else if (exactIdMatch && response?.ok && metadataMatch === "matched") {
    metadataStatus = "confirmed-by-metadata";
  } else if (exactIdMatch && response?.ok && metadataMatch === "mismatched") {
    metadataStatus = "listed-but-metadata-mismatch";
  } else if (exactIdMatch && response?.ok) {
    metadataStatus = "listed-but-metadata-unverified";
  } else if (exactIdMatch) {
    metadataStatus = "metadata-rejected";
  } else if (!exactIdMatch && response?.error) {
    metadataStatus = "metadata-probe-error";
  } else if (!exactIdMatch && modelNotFound) {
    metadataStatus = "not-listed";
  } else if (!exactIdMatch && response?.ok && metadataMatch === "matched") {
    metadataStatus = "metadata-confirmed-not-listed";
  } else if (!exactIdMatch && response?.ok && metadataMatch === "mismatched") {
    metadataStatus = "metadata-mismatch-not-listed";
  } else if (!exactIdMatch && response?.ok) {
    metadataStatus = "metadata-unverified-not-listed";
  } else {
    metadataStatus = "metadata-rejected";
  }

  const eligibleForLaunch = Boolean(exactIdMatch &&
    response?.ok &&
    !response?.error &&
    !modelNotFound &&
    !errorPayload &&
    metadataMatch === "matched" &&
    modelFamily(modelId) !== null);
  const availability = eligibleForLaunch
    ? "confirmed"
    : !exactIdMatch && modelNotFound
      ? "not-listed"
      : exactIdMatch && metadataMatch === "mismatched"
        ? "rejected"
        : "inconclusive";

  return {
    family: modelFamily(modelId),
    exactIdMatch,
    listed: exactIdMatch,
    listedAs,
    metadataMatch,
    errorPayload,
    metadataStatus,
    availability,
    eligibleForLaunch
  };
}

export function providerModelIdsForTarget(targetModel, availableModelIds = []) {
  const normalizedTarget = canonicalModelId(targetModel);
  const configured = TARGET_PROVIDER_MODEL_IDS[normalizedTarget] ?? [targetModel];
  const discoveredVariants = Array.isArray(availableModelIds)
    ? availableModelIds.filter((modelId) => providerModelMatchesTarget(targetModel, modelId))
    : [];
  return [...new Set([...configured, ...discoveredVariants])];
}

function providerModelMatchesTarget(targetModel, providerModelId) {
  const normalizedTarget = canonicalModelId(targetModel);
  const normalizedProviderModelId = canonicalModelId(providerModelId);
  if (normalizedTarget === "gpt-image-2") {
    return isGptImage2ProviderModelId(normalizedProviderModelId);
  }
  if (normalizedTarget === "gpt-image-2.5") {
    return isGptImage25ProviderModelId(normalizedProviderModelId);
  }
  if (normalizedTarget === "gpt-image-2.5-sunburst") {
    return normalizedProviderModelId === "gpt-image-2.5-sunburst" ||
      isDatedGptImage25Variant(normalizedProviderModelId, "sunburst");
  }
  if (normalizedTarget === "gpt-image-2.5-flare") {
    return normalizedProviderModelId === "gpt-image-2.5-flare" ||
      isDatedGptImage25Variant(normalizedProviderModelId, "flare");
  }
  if (normalizedTarget === "nano-banana-3") {
    return isNanoBanana3ProviderModelId(normalizedProviderModelId);
  }
  return normalizedProviderModelId === normalizedTarget;
}

function isDatedGptImage25Variant(modelId, variant) {
  const match = new RegExp(`^gpt-image-2\\.5-${variant}-(\\d{4}-\\d{2}-\\d{2})$`).exec(modelId);
  return Boolean(match?.[1] && isValidIsoDate(match[1]));
}

/**
 * Aggregate one product launch over the real provider ids that can represent
 * it. `listed` describes exact /models evidence; `eligibleForLaunch` requires
 * successful metadata for at least one exact provider id.
 */
export function aggregateTargetProbe(targetModel, availableModelIds, responsesByProviderModelId) {
  const providerModelIds = providerModelIdsForTarget(targetModel, availableModelIds);
  const probes = providerModelIds.map((providerModelId) => ({
    providerModelId,
    ...classifyModelProbe(
      providerModelId,
      availableModelIds,
      responsesByProviderModelId?.[providerModelId]
    )
  }));
  const listedProbes = probes.filter((probe) => probe.exactIdMatch);
  const confirmedProbes = probes.filter((probe) => probe.eligibleForLaunch);
  const rejectedProbes = probes.filter((probe) => probe.availability === "rejected");
  const allUnlisted = probes.length > 0 &&
    probes.every((probe) => probe.availability === "not-listed");
  const allListedCandidatesRejected = listedProbes.length > 0 &&
    listedProbes.length === rejectedProbes.length &&
    probes.every((probe) => probe.availability === "rejected" || probe.availability === "not-listed");
  const firstListed = listedProbes[0];
  const metadataStatus = confirmedProbes.length > 0
    ? "confirmed-by-metadata"
    : firstListed?.metadataStatus ?? (allUnlisted ? "not-listed" : "metadata-rejected");
  const availability = confirmedProbes.length > 0
    ? "confirmed"
    : allUnlisted
      ? "not-listed"
      : allListedCandidatesRejected
        ? "rejected"
      : "inconclusive";
  return {
    family: targetFamily(targetModel),
    providerModelIds,
    matchedProviderModelIds: listedProbes.map((probe) => probe.providerModelId),
    exactIdMatch: listedProbes.length > 0,
    listed: listedProbes.length > 0,
    listedAs: firstListed?.listedAs ?? null,
    metadataStatus,
    availability,
    eligibleForLaunch: confirmedProbes.length > 0,
    probes
  };
}

/**
 * Return exact provider ids that have enough read-only evidence to be used by
 * CrossGen. Product/workflow aliases are deliberately excluded: they are
 * useful in `launchableTargetModels`, but must never be sent as a provider
 * model id (for example `nano-banana-3`).
 */
export function confirmedProviderImageModelIds(targetProbes) {
  const confirmed = new Set();
  if (!targetProbes || typeof targetProbes !== "object") return [];
  for (const targetProbe of Object.values(targetProbes)) {
    if (!targetProbe || typeof targetProbe !== "object") continue;
    const probes = Array.isArray(targetProbe.probes) ? targetProbe.probes : [];
    for (const probe of probes) {
      if (!probe || typeof probe !== "object" || probe.eligibleForLaunch !== true) continue;
      const providerModelId = typeof probe.providerModelId === "string"
        ? probe.providerModelId.trim().replace(/^models\//i, "")
        : "";
      if (!providerModelId || providerModelId === "nano-banana-3") continue;
      if (modelFamily(providerModelId)) confirmed.add(providerModelId);
    }
  }
  return [...confirmed];
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

  const modelEntries = modelEntriesFromPayload(modelsResponse.payload);
  const availableModelIds = modelEntries.map((entry) => entry.id);
  const imageModelIds = modelEntries
    .filter((entry) =>
      modelFamily(entry.id) ||
      /(?:image|imagen|dall-e|dalle|flux|recraft|stable-diffusion|sdxl)/i.test(entry.id)
    )
    .map((entry) => entry.id);
  const probes = {};

  for (const model of TARGET_MODELS) {
    const providerModelIds = providerModelIdsForTarget(model, availableModelIds);
    const responsesByProviderModelId = {};
    for (const providerModelId of providerModelIds) {
      responsesByProviderModelId[providerModelId] = await getJSON(
        `AIHub model ${providerModelId}`,
        `/models/${encodeURIComponent(providerModelId)}`
      );
    }
    const classification = aggregateTargetProbe(
      model,
      availableModelIds,
      responsesByProviderModelId
    );
    probes[model] = {
      ...classification,
      providerProbes: Object.fromEntries(
        classification.probes.map((probe) => {
          const response = responsesByProviderModelId[probe.providerModelId] ?? {};
          return [
            probe.providerModelId,
            {
              ...probe,
              status: response.status,
              ok: response.ok,
              ...summarizePayload(response.payload),
              ...(response.error ? { transportError: response.error } : {})
            }
          ];
        })
      )
    };
  }

  const result = {
    checkedAt: new Date().toISOString(),
    endpoint: `${baseURL}/models`,
    requestType: "read-only",
    listedImageModels: imageModelIds,
    // Kept for compatibility with older evidence readers. This field means
    // "image-looking ids returned by /models", not permission to launch.
    availableImageModels: imageModelIds,
    // Exact provider ids with a matching /models row and successful metadata
    // evidence. These are the only image ids that the probe considers
    // launchable; workflow aliases are intentionally omitted.
    confirmedImageModels: confirmedProviderImageModelIds(probes),
    launchableImageModels: confirmedProviderImageModelIds(probes),
    targetModels: probes,
    confirmedTargetModels: TARGET_MODELS.filter((model) => probes[model]?.eligibleForLaunch),
    launchableTargetModels: TARGET_MODELS.filter((model) => probes[model]?.eligibleForLaunch),
    listedTargetModels: TARGET_MODELS.filter((model) => probes[model]?.listed),
    rejectedTargetModels: TARGET_MODELS.filter((model) => probes[model]?.availability === "rejected"),
    inconclusiveTargetModels: TARGET_MODELS.filter((model) => probes[model]?.availability === "inconclusive"),
    notListedTargetModels: TARGET_MODELS.filter((model) => probes[model]?.availability === "not-listed")
  };
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
