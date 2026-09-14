#!/usr/bin/env node
/**
 * AIHub-only real Sketch matrix.
 *
 * The command has a deliberate two-step gate:
 * 1. Read-only model discovery. If the target IDs are not exposed, no paid
 *    request is made and the result is recorded as pending.
 * 2. Explicit-cost-confirmed real calls. Once the target IDs are visible, the
 *    command exercises the same OpenAI-compatible chat route used by the
 *    approved AIHub evidence harness and records redacted operation metadata.
 *
 * This verifier is intentionally not a product-quality oracle. Image quality
 * still requires a product-owner review of the saved artifacts.
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const baseURL = (
  process.env.CROSSGEN_REAL_AIHUB_BASE_URL ??
  process.env.IMAGE2TOOLS_AIHUB_BASE_URL ??
  process.env.AIHUB_BASE_URL ??
  process.env.IMAGE2TOOLS_BASE_URL ??
  ""
).replace(/\/+$/, "");

const apiKey =
  process.env.CROSSGEN_REAL_AIHUB_API_KEY ??
  process.env.IMAGE2TOOLS_AIHUB_API_KEY ??
  process.env.AIHUB_API_KEY ??
  process.env.IMAGE2TOOLS_API_KEY ??
  "";

const timeoutMs = Math.max(
  30_000,
  finiteNumber(
    process.env.CROSSGEN_REAL_AIHUB_SKETCH_TIMEOUT_MS ??
      process.env.CROSSGEN_REAL_PROVIDER_TIMEOUT_MS ??
      240_000,
    240_000
  )
);

const maxAttempts = Math.max(
  1,
  Math.min(3, Math.floor(finiteNumber(process.env.CROSSGEN_REAL_AIHUB_SKETCH_MAX_ATTEMPTS, 2)))
);

const acceptCost =
  process.env.CROSSGEN_REAL_AIHUB_SKETCH_ACCEPT_COST === "1" ||
  process.env.CROSSGEN_REAL_PROVIDER_ACCEPT_COST === "1" ||
  process.env.IMAGE2TOOLS_REAL_AIHUB_ACCEPT_COST === "1";

const outputRoot = path.resolve(
  process.env.CROSSGEN_REAL_AIHUB_SKETCH_OUTPUT_DIR ?? "real-api-artifacts/aihub-sketch"
);

const gptTargetIds = [
  "gpt-image-2.5",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare"
];

const nanoAliasId = "nano-banana-3";
const nanoProviderModelIds = [
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image"
];
const nanoTargetIds = [nanoAliasId, ...nanoProviderModelIds];

const gptModel = process.env.CROSSGEN_REAL_AIHUB_GPT_SKETCH_MODEL ?? "gpt-image-2.5-sunburst";
const nanoModel = process.env.CROSSGEN_REAL_AIHUB_NANO_SKETCH_MODEL ?? nanoAliasId;

let requestCount = 0;

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireConfiguration() {
  if (!baseURL) {
    throw new Error(
      "Missing CROSSGEN_REAL_AIHUB_BASE_URL, IMAGE2TOOLS_AIHUB_BASE_URL, AIHUB_BASE_URL, or IMAGE2TOOLS_BASE_URL."
    );
  }
  if (!apiKey) {
    throw new Error(
      "Missing CROSSGEN_REAL_AIHUB_API_KEY, IMAGE2TOOLS_AIHUB_API_KEY, AIHUB_API_KEY, or IMAGE2TOOLS_API_KEY."
    );
  }
}

function redacted(value) {
  let text = String(value);
  if (apiKey) text = text.split(apiKey).join("[REDACTED_API_KEY]");
  if (baseURL) text = text.split(baseURL).join("[REDACTED_BASE_URL]");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED_API_KEY]")
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s_-]+/g, "data:image/[REDACTED_IMAGE_DATA]")
    .replace(/\bhttps?:\/\/[^\s"'<>)]*/g, "[REDACTED_URL]")
    .replace(/(?:\/Users\/|\/private\/tmp\/|\/tmp\/)[^\s"'<>)]*/g, "[REDACTED_LOCAL_PATH]");
}

function endpoint(pathname) {
  return `${baseURL}${pathname}`;
}

function sameOriginAsBaseURL(value) {
  try {
    return new URL(value).origin === new URL(baseURL).origin;
  } catch {
    return false;
  }
}

function withTimeout(label, milliseconds = timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${milliseconds}ms.`)),
    milliseconds
  );
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function isAbortError(error) {
  return error?.name === "AbortError" || /\babort(?:ed)?\b/i.test(error?.message ?? "");
}

function currentCommit() {
  const explicit = process.env.CROSSGEN_REAL_AIHUB_SKETCH_COMMIT?.trim();
  if (explicit) return explicit;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function rgbaPng(width, height, pixel) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixel(x, y, width, height);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function sketchPng(width = 256, height = 192) {
  return rgbaPng(width, height, (x, y, w, h) => {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const line = Math.abs(y - (h * 0.28 + (x / w) * h * 0.38)) < 2;
    const circle = Math.abs(Math.hypot(x - cx, y - cy * 1.08) - h * 0.25) < 2;
    const ground = Math.abs(y - h * 0.78) < 2;
    if (line || circle || ground) return [30, 30, 30, 255];
    return [250, 248, 242, 255];
  });
}

function referencePng(width = 256, height = 192) {
  return rgbaPng(width, height, (x, y, w, h) => {
    const inside = x > w * 0.26 && x < w * 0.74 && y > h * 0.18 && y < h * 0.82;
    const stripe = Math.floor((x + y) / 16) % 2 === 0;
    return inside ? (stripe ? [241, 99, 76, 255] : [255, 211, 92, 255]) : [245, 245, 245, 255];
  });
}

function dataUrl(buffer, mimeType = "image/png") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function imageContent(prompt, images) {
  return [
    { type: "text", text: prompt },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: dataUrl(image.buffer, image.mimeType) }
    }))
  ];
}

function collectStrings(value, output = [], depth = 0) {
  if (depth > 10 || value == null) return output;
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) collectStrings(child, output, depth + 1);
  }
  return output;
}

function extractImageRefs(text) {
  const refs = [];
  for (const match of text.matchAll(/!\[[^\]]*]\((<[^>]+>|data:image\/[^)\s]+|https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi)) {
    refs.push((match[1] ?? "").replace(/^<|>$/g, ""));
  }
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    refs.push(match[1] ?? "");
  }
  for (const match of text.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s_-]+/gi)) {
    refs.push((match[0] ?? "").replace(/\s+/g, ""));
  }
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'<>)]*\.(?:png|jpe?g|webp)(?:\?[^\s"'<>)]*)?/gi)) {
    refs.push(match[0] ?? "");
  }
  for (const match of text.matchAll(/!\[[^\]]*]\((<[^>]+>|https?:\/\/[^)\s]+)/gi)) {
    refs.push((match[1] ?? "").replace(/^<|>$/g, ""));
  }
  return [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
}

async function fetchImageRef(label, ref) {
  if (ref.startsWith("data:image/")) {
    const [, mimeType = "image/png", encoded = ""] =
      ref.match(/^data:([^;,]+);base64,(.*)$/i) ?? [];
    return { buffer: Buffer.from(encoded.replace(/\s+/g, ""), "base64"), mimeType };
  }
  const timeout = withTimeout(`${label} image download`, Math.min(timeoutMs, 30_000));
  try {
    const headers = sameOriginAsBaseURL(ref) ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await fetch(ref, {
      signal: timeout.signal,
      headers
    });
    if (!response.ok) throw new Error(`${label} image download failed with HTTP ${response.status}.`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type")?.split(";")[0] ?? "image/png"
    };
  } catch (error) {
    if (isAbortError(error)) throw new Error(`${label} image download timed out.`, { cause: error });
    throw error;
  } finally {
    timeout.clear();
  }
}

async function discoverModels() {
  const timeout = withTimeout("AIHub models", Math.min(timeoutMs, 30_000));
  try {
    const response = await fetch(endpoint("/models"), {
      signal: timeout.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` }
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`AIHub /models returned non-JSON HTTP ${response.status}.`);
    }
    if (!response.ok) {
      throw new Error(`AIHub /models failed with HTTP ${response.status}: ${redacted(JSON.stringify(payload).slice(0, 500))}`);
    }
    const models = (payload.data ?? payload.models ?? [])
      .map((item) => item?.id ?? item?.name?.replace(/^models\//, ""))
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim());
    return [...new Set(models)];
  } finally {
    timeout.clear();
  }
}

async function readChatImage(label, response) {
  if (!response.body) throw new Error(`${label} returned an empty response body.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let textBuffer = "";
  let eventCount = 0;
  let lastEventKeys = [];

  async function inspectText(value) {
    textBuffer = `${textBuffer}${value}`.slice(-64_000_000);
    const ref = extractImageRefs(textBuffer)[0];
    if (!ref) return null;
    const image = await fetchImageRef(label, ref);
    await reader.cancel().catch(() => undefined);
    return image;
  }

  async function inspectBlock(block) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return null;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return null;
    }
    eventCount += 1;
    lastEventKeys = Object.keys(event).slice(0, 12);
    return inspectText(collectStrings(event).join(""));
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const image = await inspectBlock(part);
      if (image) return { image, eventCount };
    }
  }
  buffer += decoder.decode();
  const trailing = await inspectBlock(buffer);
  if (trailing) return { image: trailing, eventCount };
  const fallback = await inspectText(buffer);
  if (fallback) return { image: fallback, eventCount };
  throw new Error(`${label} did not return a savable image; events=${eventCount}; keys=${lastEventKeys.join(",") || "none"}.`);
}

async function saveImage(label, image, outputDir) {
  const digest = sha256(image.buffer);
  const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
  const fileName = `${label}-${digest.slice(0, 12)}.${extension}`;
  await writeFile(path.join(outputDir, fileName), image.buffer);
  return {
    artifact: fileName,
    mimeType: image.mimeType,
    bytes: image.buffer.length,
    sha256: digest
  };
}

async function requestChatImage({ label, model, operation, prompt, images, outputDir, invalidModel = false, expectedFailure = false }) {
  const startedAt = Date.now();
  const selectedModel = invalidModel ? `${model}-invalid-recovery-probe` : model;
  const timeout = withTimeout(label);
  const result = {
    label,
    model,
    operation,
    route: "POST /chat/completions",
    inputImageCount: images.length,
    attemptCount: 1,
    retry: false,
    elapsedSeconds: null,
    output: null,
    result: "failed",
    diagnosticCategory: null,
    expectedFailure
  };
  try {
    requestCount += 1;
    const response = await fetch(endpoint("/chat/completions"), {
      method: "POST",
      signal: timeout.signal,
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        stream: true,
        params: {},
        features: { image_generation: false },
        messages: [{ role: "user", content: imageContent(prompt, images) }]
      })
    });
    if (!response.ok) {
      const errorBody = redacted((await response.text()).slice(0, 800));
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }
    if (expectedFailure) {
      await response.body?.cancel().catch(() => undefined);
      result.result = "unexpected-pass";
      result.elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
      result.error = "Expected the failure-recovery probe to fail, but the provider accepted the invalid model.";
      result.diagnosticCategory = "unexpected_success";
      return result;
    }
    const parsed = await readChatImage(label, response);
    result.output = await saveImage(label, parsed.image, outputDir);
    result.result = "pass";
    result.elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    return result;
  } catch (error) {
    result.elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    result.error = redacted(error instanceof Error ? error.message : String(error));
    result.diagnosticCategory = isAbortError(error) ? "timeout" : "provider_error";
    if (expectedFailure) {
      result.result = "expected-failure";
    }
    return result;
  } finally {
    timeout.clear();
  }
}

async function runOperationWithRetry(options) {
  const first = await requestChatImage(options);
  if (first.result === "pass") return first;
  if (options.invalidModel || maxAttempts < 2) return first;
  const second = await requestChatImage({ ...options, label: `${options.label}-retry` });
  second.attemptCount = 2;
  second.retry = true;
  second.recoveryFrom = first.diagnosticCategory;
  return second;
}

function targetAvailability(models) {
  return {
    gpt: {
      workflow: "gpt-image-2.5-sketch",
      requested: gptModel,
      listed: models.includes(gptModel),
      targetIdsListed: gptTargetIds.filter((id) => models.includes(id))
    },
    nano: {
      workflow: "nano-banana-3-sketch",
      requested: nanoModel,
      listed: models.includes(nanoModel),
      directAliasListed: models.includes(nanoAliasId),
      providerModelIdsListed: nanoProviderModelIds.filter((id) => models.includes(id)),
      targetIdsListed: nanoTargetIds.filter((id) => models.includes(id)),
      evidenceClass: nanoModel === nanoAliasId ? "direct-target-model" : "explicit-provider-model-for-nano-workflow",
      caveat: nanoModel === nanoAliasId
        ? null
        : "This run verifies CrossGen's Nano Banana 3 workflow using the explicitly configured Gemini provider model. It does not prove that AIHub exposes a model literally named nano-banana-3."
    }
  };
}

async function main() {
  requireConfiguration();
  const outputDir = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });

  const checkedAt = new Date().toISOString();
  const models = await discoverModels();
  const availability = targetAvailability(models);
  const summary = {
    schemaVersion: 1,
    acceptanceId: randomUUID(),
    checkedAt,
    commit: currentCommit(),
    provider: "aihub",
    baseURLSha256: sha256(Buffer.from(baseURL)),
    route: "POST /chat/completions",
    requestCount: 0,
    costConfirmed: acceptCost,
    availableImageModels: models.filter((id) => /image|gemini|banana/i.test(id)),
    targets: availability,
    qualityReviewRequired: true,
    operations: []
  };

  const missing = [availability.gpt, availability.nano]
    .filter((target) => !target.listed)
    .map((target) => target.requested);
  if (missing.length > 0) {
    summary.status = "pending-target-models";
    summary.blockedBy = "AIHub model discovery";
    summary.missingTargetModels = missing;
    summary.summary =
      "No paid image request was made because the configured AIHub account does not expose every selected target model.";
    const summaryPath = path.join(outputDir, "summary.json");
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`AIHub Sketch matrix pending: ${missing.join(", ")}`);
    console.log(`Summary: ${summaryPath}`);
    return;
  }

  if (!acceptCost) {
    summary.status = "blocked-cost-confirmation";
    summary.blockedBy = "explicit cost confirmation";
    summary.summary = "Target models are visible, but paid calls were not made without explicit cost confirmation.";
    const summaryPath = path.join(outputDir, "summary.json");
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.error(`AIHub Sketch matrix requires CROSSGEN_REAL_AIHUB_SKETCH_ACCEPT_COST=1. Summary: ${summaryPath}`);
    process.exitCode = 2;
    return;
  }

  const sketch = { mimeType: "image/png", buffer: sketchPng() };
  const reference = { mimeType: "image/png", buffer: referencePng() };
  await writeFile(path.join(outputDir, "input-sketch.png"), sketch.buffer);
  await writeFile(path.join(outputDir, "input-reference.png"), reference.buffer);

  const operations = [
    {
      label: "gpt-composition",
      model: gptModel,
      operation: "composition",
      prompt: "Complete the attached hand-drawn sketch into a polished editorial illustration. Preserve the composition, silhouette, relative placement, and perspective. Return only an image.",
      images: [sketch]
    },
    {
      label: "gpt-pose",
      model: gptModel,
      operation: "pose",
      prompt: "Complete the attached hand-drawn sketch into a finished character concept. Preserve the pose, gesture line, and spatial relationships. Return only an image.",
      images: [sketch]
    },
    {
      label: "gpt-reference",
      model: gptModel,
      operation: "sketch-plus-reference",
      prompt: "Complete the first attached hand-drawn sketch using the second image as a visual style and color reference. Preserve the sketch composition and pose. Return only an image.",
      images: [sketch, reference]
    },
    {
      label: "nano-composition",
      model: nanoModel,
      operation: "composition",
      prompt: "Complete the attached hand-drawn sketch into a polished editorial illustration. Preserve the composition, silhouette, relative placement, and perspective. Return only an image.",
      images: [sketch]
    },
    {
      label: "nano-pose",
      model: nanoModel,
      operation: "pose",
      prompt: "Complete the attached hand-drawn sketch into a finished character concept. Preserve the pose, gesture line, and spatial relationships. Return only an image.",
      images: [sketch]
    },
    {
      label: "nano-reference",
      model: nanoModel,
      operation: "sketch-plus-reference",
      prompt: "Complete the first attached hand-drawn sketch using the second image as a visual style and color reference. Preserve the sketch composition and pose. Return only an image.",
      images: [sketch, reference]
    }
  ];

  for (const operation of operations) {
    const result = await runOperationWithRetry({ ...operation, outputDir });
    summary.operations.push(result);
  }

  const recoveryProbe = await requestChatImage({
      label: "gpt-failure-recovery-initial",
      model: gptModel,
      operation: "failure-recovery-initial-invalid-model",
      prompt: "Return an image after completing the attached sketch.",
      images: [sketch],
      outputDir,
      invalidModel: true,
      expectedFailure: true
    });
  const recoveryRetry = await runOperationWithRetry({
    label: "gpt-failure-recovery",
    model: gptModel,
    operation: "failure-recovery-retry",
    prompt: "Return an image after completing the attached sketch.",
    images: [sketch],
    outputDir
  });
  recoveryRetry.recoveryFrom = recoveryProbe.diagnosticCategory;
  recoveryRetry.recoveryProbeResult = recoveryProbe.result;
  summary.operations.push(recoveryProbe, recoveryRetry);

  summary.requestCount = requestCount;
  summary.status = summary.operations.every((operation) => operation.result === "pass" || operation.result === "expected-failure")
    ? "awaiting-human-quality-review"
    : "failed";
  summary.summary =
    summary.status === "awaiting-human-quality-review"
      ? "All deterministic real AIHub Sketch calls returned savable images; product-owner quality review is still required."
      : "At least one real AIHub Sketch operation failed; inspect redacted diagnostics and retry metadata.";

  const summaryPath = path.join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`AIHub Sketch matrix summary: ${summaryPath}`);
  console.log(`Status: ${summary.status}`);
  console.log(`Operations: ${summary.operations.filter((operation) => operation.result === "pass").length}/${summary.operations.length} passed`);
  if (summary.status === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(redacted(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
