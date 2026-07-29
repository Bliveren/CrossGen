#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const baseURL = (
  process.env.CROSSGEN_REAL_PROVIDER_BASE_URL ??
  process.env.IMAGE2TOOLS_REAL_PROVIDER_BASE_URL ??
  process.env.IMAGE2TOOLS_AIHUB_BASE_URL ??
  process.env.AIHUB_BASE_URL ??
  process.env.IMAGE2TOOLS_BASE_URL ??
  process.env.OPENAI_BASE_URL ??
  ""
).replace(/\/+$/, "");

const openAIKey =
  process.env.CROSSGEN_REAL_PROVIDER_API_KEY ??
  process.env.IMAGE2TOOLS_REAL_PROVIDER_API_KEY ??
  process.env.IMAGE2TOOLS_AIHUB_API_KEY ??
  process.env.AIHUB_API_KEY ??
  process.env.IMAGE2TOOLS_API_KEY ??
  process.env.OPENAI_API_KEY ??
  "";

const geminiKey =
  process.env.CROSSGEN_REAL_PROVIDER_GEMINI_API_KEY ??
  process.env.IMAGE2TOOLS_REAL_PROVIDER_GEMINI_API_KEY ??
  process.env.IMAGE2TOOLS_AIHUB_GEMINI_API_KEY ??
  process.env.IMAGE2TOOLS_GEMINI_API_KEY ??
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  openAIKey;

const openAIModel =
  process.env.CROSSGEN_REAL_OPENAI_MODEL ??
  process.env.IMAGE2TOOLS_REAL_OPENAI_MODEL ??
  process.env.IMAGE2TOOLS_AIHUB_OPENAI_MODEL ??
  "gpt-image-2";

const geminiModel =
  process.env.CROSSGEN_REAL_GEMINI_MODEL ??
  process.env.IMAGE2TOOLS_REAL_GEMINI_MODEL ??
  process.env.IMAGE2TOOLS_AIHUB_GEMINI_MODEL ??
  process.env.IMAGE2TOOLS_GEMINI_MODEL ??
  "gemini-3.1-flash-image";

const acceptCost =
  process.env.CROSSGEN_REAL_PROVIDER_ACCEPT_COST === "1" ||
  process.env.IMAGE2TOOLS_REAL_PROVIDER_ACCEPT_COST === "1" ||
  process.env.IMAGE2TOOLS_REAL_AIHUB_ACCEPT_COST === "1";

const allowDiagnosticFailures =
  process.env.CROSSGEN_REAL_PROVIDER_ALLOW_DIAGNOSTIC_FAILURES === "1" ||
  process.env.IMAGE2TOOLS_REAL_PROVIDER_ALLOW_DIAGNOSTIC_FAILURES === "1";

const timeoutMs = Math.max(
  30_000,
  Number(
    process.env.CROSSGEN_REAL_PROVIDER_TIMEOUT_MS ??
      process.env.IMAGE2TOOLS_REAL_PROVIDER_TIMEOUT_MS ??
      process.env.IMAGE2TOOLS_REAL_AIHUB_TIMEOUT_MS ??
      process.env.IMAGE2TOOLS_TIMEOUT_MS ??
      240_000
  )
);

const outputRoot = path.resolve(process.env.CROSSGEN_REAL_PROVIDER_OUTPUT_DIR ?? "real-api-artifacts", "provider-gate");

function requireAcceptance() {
  if (!baseURL) {
    throw new Error(
      "Missing CROSSGEN_REAL_PROVIDER_BASE_URL, IMAGE2TOOLS_REAL_PROVIDER_BASE_URL, IMAGE2TOOLS_BASE_URL, or OPENAI_BASE_URL. No real API calls were made."
    );
  }
  if (!openAIKey) {
    throw new Error(
      "Missing CROSSGEN_REAL_PROVIDER_API_KEY, IMAGE2TOOLS_REAL_PROVIDER_API_KEY, IMAGE2TOOLS_API_KEY, or OPENAI_API_KEY. No real API calls were made."
    );
  }
  if (!geminiKey) {
    throw new Error(
      "Missing CROSSGEN_REAL_PROVIDER_GEMINI_API_KEY, IMAGE2TOOLS_REAL_PROVIDER_GEMINI_API_KEY, IMAGE2TOOLS_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY. No real API calls were made."
    );
  }
  if (!acceptCost) {
    throw new Error("Refusing to make paid real provider calls. Set CROSSGEN_REAL_PROVIDER_ACCEPT_COST=1 to run the v0.3.2 provider gate.");
  }
}

function redacted(value) {
  let text = String(value);
  for (const secret of [openAIKey, geminiKey, baseURL]) {
    if (secret) text = text.split(secret).join(secret === baseURL ? "[REDACTED_BASE_URL]" : "[REDACTED_API_KEY]");
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED_API_KEY]");
}

function endpoint(pathname) {
  return `${baseURL}${pathname}`;
}

function baseURLIdentity() {
  return {
    type: process.env.CROSSGEN_REAL_PROVIDER_BASE_URL_TYPE ?? "compatible-gateway",
    sha256: createHash("sha256").update(baseURL).digest("hex")
  };
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function withTimeout(label, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${ms}ms.`)), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function isAbortError(error) {
  return error?.name === "AbortError" || /\babort(?:ed)?\b/i.test(error?.message ?? "");
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

function solidPng(width, height, rgba) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
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

function maskPng(width, height) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  const x0 = Math.floor(width * 0.28);
  const x1 = Math.floor(width * 0.72);
  const y0 = Math.floor(height * 0.28);
  const y1 = Math.floor(height * 0.72);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const inCenter = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      raw[offset] = 255;
      raw[offset + 1] = 255;
      raw[offset + 2] = 255;
      raw[offset + 3] = inCenter ? 0 : 255;
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

function dataUrl(buffer, mimeType = "image/png") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function chatContent(prompt, images = []) {
  return [
    { type: "text", text: prompt },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: dataUrl(image.buffer, image.mimeType) }
    }))
  ];
}

function collectStrings(value, out = [], depth = 0) {
  if (depth > 10 || value == null) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) collectStrings(child, out, depth + 1);
  }
  return out;
}

function stripDelimiters(value) {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
}

function dedupe(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function extractImageRefs(text) {
  const refs = [];
  for (const match of text.matchAll(/!\[[^\]]*]\((<[^>]+>|data:image\/[^)\s]+|https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi)) {
    refs.push(stripDelimiters(match[1] ?? ""));
  }
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    refs.push(match[1] ?? "");
  }
  for (const match of text.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi)) {
    refs.push(match[0] ?? "");
  }
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'<>)]*\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>)]*)?/gi)) {
    refs.push(match[0] ?? "");
  }
  return dedupe(refs.map((ref) => ref.trim()).filter(Boolean));
}

function responseTextFromEvent(event) {
  return collectStrings(event)
    .filter((text) => text.includes("data:image/") || text.includes("![") || /https?:\/\//i.test(text) || /^[A-Za-z0-9+/=_-]{80,}$/.test(text.trim()))
    .join("");
}

function trimTextBuffer(value) {
  const maxLength = 64_000_000;
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

async function fetchImageRef(label, ref, apiKey) {
  if (ref.startsWith("data:image/")) {
    const [, metadata = "image/png", base64 = ""] = ref.match(/^data:([^;,]+);base64,(.*)$/i) ?? [];
    return { buffer: Buffer.from(base64.replace(/\s+/g, ""), "base64"), mimeType: metadata };
  }
  if (/^[A-Za-z0-9+/=_-]{80,}$/.test(ref.trim())) {
    return { buffer: Buffer.from(ref.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64"), mimeType: "image/png" };
  }

  const timeout = withTimeout(`${label} image URL download`, Math.min(timeoutMs, 30_000));
  try {
    const response = await fetch(ref, {
      signal: timeout.signal,
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) throw new Error(`${label} image URL download failed with HTTP ${response.status}.`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
  } catch (error) {
    if (isAbortError(error)) throw new Error(`${label} image URL download timed out.`);
    throw error;
  } finally {
    timeout.clear();
  }
}

async function saveImage(label, image, outputDir) {
  const digest = createHash("sha256").update(image.buffer).digest("hex").slice(0, 12);
  const ext = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
  const outputPath = path.join(outputDir, `${label}-${digest}.${ext}`);
  await writeFile(outputPath, image.buffer);
  return {
    path: outputPath,
    mimeType: image.mimeType,
    bytes: image.buffer.length,
    sha256: createHash("sha256").update(image.buffer).digest("hex")
  };
}

async function verifyModels(outputDir) {
  const startedAt = Date.now();
  try {
    const timeout = withTimeout("model discovery", Math.min(timeoutMs, 30_000));
    try {
      const response = await fetch(endpoint("/models"), {
        signal: timeout.signal,
        headers: { Authorization: `Bearer ${openAIKey}`, Accept: "application/json" }
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`models returned non-JSON response with HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      if (!response.ok) {
        throw new Error(`models failed with HTTP ${response.status}: ${(payload?.error?.message ?? JSON.stringify(payload)).slice(0, 500)}`);
      }
      const ids = dedupe((payload.data ?? payload.models ?? [])
        .map((item) => item?.id ?? item?.name?.replace(/^models\//, ""))
        .filter(Boolean));
      return {
        ok: true,
        elapsedSeconds: secondsSince(startedAt),
        openAIModelPresent: ids.includes(openAIModel),
        geminiModelPresent: ids.includes(geminiModel),
        imageModelCount: ids.filter((id) => /image|gemini|banana/i.test(id)).length,
        imageModels: ids.filter((id) => /image|gemini|banana/i.test(id)).slice(0, 30)
      };
    } finally {
      timeout.clear();
    }
  } catch (error) {
    const diagnostic = normalizeError(error);
    await writeFile(path.join(outputDir, "model-discovery-error.txt"), redacted(error instanceof Error ? error.message : String(error)));
    return {
      ok: false,
      elapsedSeconds: secondsSince(startedAt),
      diagnosticCategory: diagnostic.category,
      errorSummary: diagnostic.message
    };
  }
}

function secondsSince(startedAt) {
  return Number(((Date.now() - startedAt) / 1000).toFixed(2));
}

async function requestChatImage(gate, outputDir) {
  const startedAt = Date.now();
  const timeout = withTimeout(gate.id, timeoutMs);
  console.log(`${gate.id}: ${gate.model} ${gate.operation}, ${gate.images.length} input image(s), timeout ${Math.round(timeoutMs / 1000)}s.`);

  try {
    const response = await fetch(endpoint("/chat/completions"), {
      method: "POST",
      signal: timeout.signal,
      headers: {
        Authorization: `Bearer ${gate.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream, application/json"
      },
      body: JSON.stringify({
        model: gate.model,
        stream: true,
        params: {},
        features: {
          image_generation: false
        },
        messages: [
          {
            role: "user",
            content: chatContent(gate.prompt, gate.images)
          }
        ]
      })
    }).catch((error) => {
      if (isAbortError(error)) throw new Error(`${gate.id} timed out after ${timeoutMs}ms before response headers.`);
      throw error;
    });

    if (!response.ok) {
      const body = redacted((await response.text()).slice(0, 800));
      const error = new Error(`${gate.id} failed with HTTP ${response.status}: ${body}`);
      error.httpStatus = response.status;
      throw error;
    }
    if (!response.body) throw new Error(`${gate.id} returned an empty response body.`);

    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();
    const image = await imageFromResponseBody(gate.id, bodyText, contentType, gate.apiKey);
    const saved = await saveImage(gate.id, image, outputDir);
    console.log(`${gate.id}: saved image after ${Date.now() - startedAt}ms.`);
    return {
      gate: gate.id,
      providerKind: gate.providerKind,
      model: gate.model,
      operation: gate.operation,
      routeSelection: "chat-completions",
      resolvedRoute: "chat-completions",
      inputImageCount: gate.images.length,
      mask: gate.hasMask,
      timeoutSeconds: Math.round(timeoutMs / 1000),
      attemptCount: 1,
      elapsedSeconds: secondsSince(startedAt),
      result: "pass",
      outputCount: 1,
      outputs: [saved],
      diagnosticCategory: null,
      userVisibleNextActions: []
    };
  } catch (error) {
    const diagnostic = normalizeError(error);
    console.error(`${gate.id}: ${diagnostic.category}: ${redacted(diagnostic.message)}`);
    return {
      gate: gate.id,
      providerKind: gate.providerKind,
      model: gate.model,
      operation: gate.operation,
      routeSelection: "chat-completions",
      resolvedRoute: "chat-completions",
      inputImageCount: gate.images.length,
      mask: gate.hasMask,
      timeoutSeconds: Math.round(timeoutMs / 1000),
      attemptCount: 1,
      elapsedSeconds: secondsSince(startedAt),
      result: diagnostic.releaseGateResult,
      outputCount: 0,
      outputs: [],
      diagnosticCategory: diagnostic.category,
      errorSummary: redacted(diagnostic.message),
      userVisibleNextActions: diagnostic.nextActions
    };
  } finally {
    timeout.clear();
  }
}

async function imageFromResponseBody(label, bodyText, contentType, apiKey) {
  const refs = [];
  if (contentType.includes("text/event-stream") || bodyText.includes("\ndata:") || bodyText.startsWith("data:")) {
    let textBuffer = "";
    let eventCount = 0;
    let lastEventKeys = [];
    for (const block of bodyText.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      eventCount += 1;
      lastEventKeys = Object.keys(event).slice(0, 12);
      textBuffer = trimTextBuffer(`${textBuffer}${responseTextFromEvent(event)}`);
      refs.push(...extractImageRefs(textBuffer));
    }
    const first = dedupe(refs)[0];
    if (!first) {
      throw new Error(`${label} did not return a savable image. SSE events: ${eventCount}; last event keys: ${lastEventKeys.join(",") || "none"}.`);
    }
    return fetchImageRef(label, first, apiKey);
  }

  let payload;
  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new Error(`${label} returned non-JSON response without SSE image refs: ${bodyText.slice(0, 500)}`);
  }
  refs.push(...extractImageRefs(responseTextFromEvent(payload)));
  const first = dedupe(refs)[0];
  if (!first) {
    throw new Error(`${label} did not return a savable image. Top-level fields: ${Object.keys(payload).slice(0, 20).join(",") || "none"}.`);
  }
  return fetchImageRef(label, first, apiKey);
}

function normalizeError(error) {
  const message = redacted(error instanceof Error ? error.message : String(error));
  const httpStatus = error?.httpStatus;
  if (/\b(timeout|timed out|AbortError)\b/i.test(message)) {
    return diagnostic("timeout", message, "blocker", ["Increase the per-task timeout, reduce reference image size, or retry when the provider is responsive."]);
  }
  if (httpStatus === 401 || httpStatus === 403 || /\b(auth|unauthorized|forbidden|invalid api key|permission denied)\b/i.test(message)) {
    return diagnostic("auth", message, "blocker", ["Check the API key and provider Base URL."]);
  }
  if (/\b(balance|billing|quota|insufficient|payment|余额不足|额度不足)\b/i.test(message)) {
    return diagnostic("billing", message, "diagnostic-required", ["Check provider balance or quota before retrying."]);
  }
  if (httpStatus === 429 || /\b(rate limit|too many requests|限流)\b/i.test(message)) {
    return diagnostic("rate_limit", message, "diagnostic-required", ["Wait and retry later, or lower concurrency."]);
  }
  if (/\b(safety|moderation|policy|blocked)\b/i.test(message)) {
    return diagnostic("safety", message, "diagnostic-required", ["Adjust the prompt or input image and retry."]);
  }
  if (httpStatus === 400 || httpStatus === 404 || /\b(not support|unsupported|route|endpoint|not found|model.*not.*support)\b/i.test(message)) {
    return diagnostic("route_unsupported", message, "diagnostic-required", ["Switch to the chat route for compatible gateways, or choose a model/route that supports references and guided edits."]);
  }
  if (/\b(no savable image|did not return|empty output|data:\s*null|no image)\b/i.test(message)) {
    return diagnostic("provider_empty_output", message, "diagnostic-required", ["Check the selected route, model capability, input image count, and provider response compatibility."]);
  }
  if (/\b(network|ENOTFOUND|ECONNRESET|ECONNREFUSED|fetch failed)\b/i.test(message)) {
    return diagnostic("network", message, "blocker", ["Check network connectivity and provider Base URL."]);
  }
  return diagnostic("unknown", message, "blocker", ["Inspect provider logs or rerun with a smaller request."]);
}

function diagnostic(category, message, releaseGateResult, nextActions) {
  return { category, message, releaseGateResult, nextActions };
}

function buildGates(source, mask) {
  return [
    {
      id: "G1-openai-compatible-text-to-image-chat",
      providerKind: "openai-compatible",
      model: openAIModel,
      apiKey: openAIKey,
      operation: "text-to-image",
      hasMask: false,
      images: [],
      prompt: "Create a simple square app icon for an AI image workspace. Use a clean red circle centered on a neutral background. Return an image."
    },
    {
      id: "G2-openai-compatible-image-to-image-chat",
      providerKind: "openai-compatible",
      model: openAIModel,
      apiKey: openAIKey,
      operation: "image-to-image",
      hasMask: false,
      images: [source],
      prompt: "Use the attached yellow square reference image. Create a more polished yellow square app icon while preserving the square composition. Return an image."
    },
    {
      id: "G3-openai-compatible-guided-region-chat",
      providerKind: "openai-compatible",
      model: openAIModel,
      apiKey: openAIKey,
      operation: "guided-region",
      hasMask: true,
      images: [source, mask],
      prompt: "Use the first image as the source and the second transparent-center image as a guided-region mask. Change only the center guided region into a bright green circle, keeping the rest stable. Return an image."
    },
    {
      id: "G4-gemini-compatible-text-to-image-chat",
      providerKind: "gemini-compatible",
      model: geminiModel,
      apiKey: geminiKey,
      operation: "text-to-image",
      hasMask: false,
      images: [],
      prompt: "Create a clean product-style icon for a desktop AI image management tool on a neutral background. Return an image."
    },
    {
      id: "G5-gemini-compatible-image-to-image-chat",
      providerKind: "gemini-compatible",
      model: geminiModel,
      apiKey: geminiKey,
      operation: "image-to-image",
      hasMask: false,
      images: [source],
      prompt: "Edit the attached yellow square into a cleaner product shot while preserving the square composition. Return an image."
    }
  ];
}

async function main() {
  requireAcceptance();
  const outputDir = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });

  const source = { mimeType: "image/png", buffer: solidPng(192, 192, [230, 202, 74, 255]) };
  const mask = { mimeType: "image/png", buffer: maskPng(192, 192) };
  await writeFile(path.join(outputDir, "source.png"), source.buffer);
  await writeFile(path.join(outputDir, "guided-region-mask.png"), mask.buffer);

  const modelDiscovery = await verifyModels(outputDir);
  const gates = buildGates(source, mask);
  const results = [];
  for (const gate of gates) {
    results.push(await requestChatImage(gate, outputDir));
  }

  const summary = {
    schemaVersion: 1,
    release: "v0.3.2",
    acceptanceId: randomUUID(),
    verifiedAt: new Date().toISOString(),
    commit: currentCommit(),
    baseURL: baseURLIdentity(),
    timeoutMs,
    route: "chat-completions",
    allowDiagnosticFailures,
    modelDiscovery,
    gates: results
  };
  const summaryPath = path.join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));

  const blockers = results.filter((result) => result.result === "blocker");
  const diagnostics = results.filter((result) => result.result === "diagnostic-required");
  console.log(`Provider gate summary: ${summaryPath}`);
  console.log(`Provider gate pass count: ${results.filter((result) => result.result === "pass").length}/${results.length}`);
  if (diagnostics.length > 0) {
    console.log(`Provider gate diagnostic-required count: ${diagnostics.length}`);
  }
  if (blockers.length > 0) {
    throw new Error(`Provider gate has ${blockers.length} blocker(s). Summary: ${summaryPath}`);
  }
  if (diagnostics.length > 0 && !allowDiagnosticFailures) {
    throw new Error(`Provider gate produced diagnostic-required results. Review UI diagnostics and rerun with CROSSGEN_REAL_PROVIDER_ALLOW_DIAGNOSTIC_FAILURES=1 only after product acceptance. Summary: ${summaryPath}`);
  }
  console.log("Provider gate completed.");
}

main().catch((error) => {
  console.error(redacted(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
