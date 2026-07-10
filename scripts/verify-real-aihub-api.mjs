#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const baseURL = (
  process.env.IMAGE2TOOLS_AIHUB_BASE_URL ??
  process.env.AIHUB_BASE_URL ??
  process.env.IMAGE2TOOLS_BASE_URL ??
  process.env.OPENAI_BASE_URL ??
  ""
).replace(/\/+$/, "");
const openAIKey = process.env.IMAGE2TOOLS_AIHUB_API_KEY ?? process.env.AIHUB_API_KEY ?? process.env.IMAGE2TOOLS_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const geminiKey = process.env.IMAGE2TOOLS_AIHUB_GEMINI_API_KEY ?? process.env.IMAGE2TOOLS_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? openAIKey;
const openAIModel = process.env.IMAGE2TOOLS_AIHUB_OPENAI_MODEL ?? "gpt-image-2";
const geminiModel = process.env.IMAGE2TOOLS_AIHUB_GEMINI_MODEL ?? process.env.IMAGE2TOOLS_GEMINI_MODEL ?? "gemini-3.1-flash-image";
const acceptOpenAICost = process.env.IMAGE2TOOLS_REAL_API_ACCEPT_COST === "1" || process.env.IMAGE2TOOLS_REAL_AIHUB_ACCEPT_COST === "1";
const acceptGeminiCost = process.env.IMAGE2TOOLS_REAL_GEMINI_API_ACCEPT_COST === "1" || process.env.IMAGE2TOOLS_REAL_AIHUB_ACCEPT_COST === "1";
const timeoutMs = Math.max(30000, Number(process.env.IMAGE2TOOLS_REAL_AIHUB_TIMEOUT_MS ?? process.env.IMAGE2TOOLS_TIMEOUT_MS ?? 240000));
const outputRoot = path.resolve("real-api-artifacts", "aihub");

function requireAcceptance() {
  if (!baseURL) throw new Error("Missing IMAGE2TOOLS_AIHUB_BASE_URL, AIHUB_BASE_URL, IMAGE2TOOLS_BASE_URL, or OPENAI_BASE_URL.");
  if (!openAIKey) throw new Error("Missing IMAGE2TOOLS_AIHUB_API_KEY, AIHUB_API_KEY, IMAGE2TOOLS_API_KEY, or OPENAI_API_KEY.");
  if (!geminiKey) throw new Error("Missing IMAGE2TOOLS_AIHUB_GEMINI_API_KEY, IMAGE2TOOLS_GEMINI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or OpenAI-compatible AIHub key.");
  if (!acceptOpenAICost || !acceptGeminiCost) {
    throw new Error("Refusing to make paid AIHub image calls. Set IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 and IMAGE2TOOLS_REAL_GEMINI_API_ACCEPT_COST=1, or IMAGE2TOOLS_REAL_AIHUB_ACCEPT_COST=1.");
  }
}

function redact(value) {
  let text = String(value);
  for (const secret of [openAIKey, geminiKey]) {
    if (secret) text = text.split(secret).join("[REDACTED_API_KEY]");
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED_API_KEY]");
}

function endpoint(pathname) {
  return `${baseURL}${pathname}`;
}

function withTimeout(label, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${ms}ms.`)), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

async function fetchJson(label, url, init, ms = timeoutMs) {
  const timeout = withTimeout(label, ms);
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${label} returned non-JSON response with HTTP ${response.status}: ${redact(text.slice(0, 500))}`);
    }
    if (!response.ok) {
      const message = payload?.error?.message ?? JSON.stringify(payload).slice(0, 500);
      throw new Error(`${label} failed with HTTP ${response.status}: ${redact(message)}`);
    }
    return payload;
  } catch (error) {
    if (isAbortError(error)) throw new Error(`${label} timed out after ${ms}ms.`);
    throw error;
  } finally {
    timeout.clear();
  }
}

function isAbortError(error) {
  return error?.name === "AbortError" || /\babort(?:ed)?\b/i.test(error?.message ?? "");
}

async function verifyModels() {
  const payload = await fetchJson("AIHub models", endpoint("/models"), {
    headers: { Authorization: `Bearer ${openAIKey}`, Accept: "application/json" }
  }, Math.min(timeoutMs, 30000));
  const ids = new Set((payload.data ?? payload.models ?? []).map((item) => item?.id ?? item?.name?.replace(/^models\//, "")).filter(Boolean));
  for (const model of [openAIModel, geminiModel]) {
    if (!ids.has(model)) {
      throw new Error(`AIHub models response did not include ${model}. Available image models: ${[...ids].filter((id) => /image|gemini|banana/i.test(id)).join(", ") || "none"}.`);
    }
  }
  return [...ids];
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
  const content = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: { url: dataUrl(image.buffer, image.mimeType) }
    });
  }
  return content;
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

function extractImageRefs(text) {
  const refs = [];
  for (const match of text.matchAll(/!\[[^\]]*]\((<[^>]+>|data:image\/[^)\s]+|https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi)) {
    refs.push(stripDelimiters(match[1] ?? ""));
  }
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    refs.push(match[1] ?? "");
  }
  for (const match of text.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s_-]+/gi)) {
    refs.push((match[0] ?? "").replace(/\s+/g, ""));
  }
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'<>)]*\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>)]*)?/gi)) {
    refs.push(match[0] ?? "");
  }
  return dedupe(refs.map((ref) => ref.trim()).filter(Boolean));
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

function responseTextFromEvent(event) {
  const strings = collectStrings(event).filter((text) =>
    text.includes("data:image/") ||
    text.includes("![") ||
    /https?:\/\//i.test(text) ||
    /^[A-Za-z0-9+/=_-]{80,}$/.test(text.trim())
  );
  return strings.join("");
}

async function fetchImageRef(label, ref, apiKey) {
  if (ref.startsWith("data:image/")) {
    const [, metadata = "image/png", base64 = ""] = ref.match(/^data:([^;,]+);base64,(.*)$/i) ?? [];
    return { buffer: Buffer.from(base64.replace(/\s+/g, ""), "base64"), mimeType: metadata };
  }
  if (/^[A-Za-z0-9+/=_-]{80,}$/.test(ref.trim())) {
    return { buffer: Buffer.from(ref.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64"), mimeType: "image/png" };
  }

  const timeout = withTimeout(`${label} image URL download`, Math.min(timeoutMs, 30000));
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
  return outputPath;
}

async function requestChatImage({ label, model, apiKey, prompt, images, outputDir }) {
  const startedAt = Date.now();
  console.log(`${label}: starting ${model} with ${images.length} input image(s).`);
  const timeout = withTimeout(label, timeoutMs);
  const response = await fetch(endpoint("/chat/completions"), {
    method: "POST",
    signal: timeout.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream"
    },
    body: JSON.stringify({
      model,
      stream: true,
      params: {},
      features: {
        image_generation: false
      },
      messages: [
        {
          role: "user",
          content: chatContent(prompt, images)
        }
      ]
    })
  }).catch((error) => {
    if (isAbortError(error)) throw new Error(`${label} timed out after ${timeoutMs}ms before response headers.`);
    throw error;
  });

  try {
    if (!response.ok) {
      const body = redact((await response.text()).slice(0, 800));
      throw new Error(`${label} failed with HTTP ${response.status}: ${body}`);
    }
    if (!response.body) throw new Error(`${label} returned an empty SSE body.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let textBuffer = "";
    let eventCount = 0;
    let lastEventKeys = [];
    const seenRefs = new Set();

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (isAbortError(error)) throw new Error(`${label} timed out after ${timeoutMs}ms while streaming.`);
        throw error;
      }
      const { done, value } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part
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
        for (const ref of extractImageRefs(textBuffer)) {
          if (seenRefs.has(ref)) continue;
          seenRefs.add(ref);
          const image = await fetchImageRef(label, ref, apiKey);
          if (image.buffer.length === 0) continue;
          const outputPath = await saveImage(label, image, outputDir);
          console.log(`${label}: saved image after ${Date.now() - startedAt}ms.`);
          await reader.cancel().catch(() => undefined);
          return {
            label,
            model,
            outputPath,
            elapsedMs: Date.now() - startedAt,
            eventCount,
            mimeType: image.mimeType,
            bytes: image.buffer.length
          };
        }
      }
    }

    throw new Error(`${label} did not return a savable image. SSE events: ${eventCount}; last event keys: ${lastEventKeys.join(",") || "none"}.`);
  } finally {
    timeout.clear();
  }
}

function trimTextBuffer(value) {
  const maxLength = 64_000_000;
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

async function main() {
  requireAcceptance();
  const outputDir = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });

  const source = { mimeType: "image/png", buffer: solidPng(192, 192, [230, 202, 74, 255]) };
  const mask = { mimeType: "image/png", buffer: maskPng(192, 192) };
  await writeFile(path.join(outputDir, "source.png"), source.buffer);
  await writeFile(path.join(outputDir, "guided-region-mask.png"), mask.buffer);

  const availableModels = await verifyModels();
  const results = [];
  results.push(await requestChatImage({
    label: "openai-generation",
    model: openAIModel,
    apiKey: openAIKey,
    prompt: "Create a simple square app icon for an AI image workspace. Use a clean red circle centered on a neutral background. Return an image.",
    images: [],
    outputDir
  }));
  results.push(await requestChatImage({
    label: "openai-reference-edit",
    model: openAIModel,
    apiKey: openAIKey,
    prompt: "Use the attached yellow square reference image. Create a more polished yellow square app icon while preserving the square composition. Return an image.",
    images: [source],
    outputDir
  }));
  results.push(await requestChatImage({
    label: "openai-guided-region-edit",
    model: openAIModel,
    apiKey: openAIKey,
    prompt: "Use the first image as the source and the second transparent-center image as guided-region mask. Change only the center guided region into a bright green circle, keeping the rest stable. Return an image.",
    images: [source, mask],
    outputDir
  }));
  results.push(await requestChatImage({
    label: "gemini-generation",
    model: geminiModel,
    apiKey: geminiKey,
    prompt: "Create a clean product-style icon for a desktop AI image management tool on a neutral background. Return an image.",
    images: [],
    outputDir
  }));
  results.push(await requestChatImage({
    label: "gemini-reference-edit",
    model: geminiModel,
    apiKey: geminiKey,
    prompt: "Edit the attached yellow square into a cleaner product shot while preserving the square composition. Return an image.",
    images: [source],
    outputDir
  }));
  results.push(await requestChatImage({
    label: "gemini-guided-region-edit",
    model: geminiModel,
    apiKey: geminiKey,
    prompt: "Use the first image as source and the second transparent-center image as a guided region. Change only that region into a bright green circle and keep the rest stable. Return an image.",
    images: [source, mask],
    outputDir
  }));

  const summary = {
    acceptanceId: randomUUID(),
    verifiedAt: new Date().toISOString(),
    baseURL,
    models: {
      openAI: openAIModel,
      gemini: geminiModel
    },
    timeoutMs,
    availableImageModels: availableModels.filter((id) => /image|gemini|banana/i.test(id)),
    results
  };
  const summaryPath = path.join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log("Real AIHub image acceptance passed.");
  console.log(`Artifacts saved in ${outputDir}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Acceptance id: ${summary.acceptanceId}`);
  for (const result of results) {
    console.log(`${result.label}: ${result.outputPath} (${result.elapsedMs}ms)`);
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
