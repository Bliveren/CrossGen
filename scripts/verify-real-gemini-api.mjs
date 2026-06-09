#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const model = process.env.IMAGE2TOOLS_GEMINI_MODEL ?? "gemini-3.1-flash-image";
const baseURL = (process.env.IMAGE2TOOLS_GEMINI_BASE_URL ?? process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const apiKey = process.env.IMAGE2TOOLS_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
const acceptCost = process.env.IMAGE2TOOLS_REAL_GEMINI_API_ACCEPT_COST === "1";
const outputRoot = path.resolve("real-api-artifacts", "gemini");

function requireAcceptance() {
  if (!apiKey) {
    throw new Error("Missing IMAGE2TOOLS_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY. No real Gemini API calls were made.");
  }
  if (!acceptCost) {
    throw new Error(
      "Refusing to make paid real Gemini image calls. Set IMAGE2TOOLS_REAL_GEMINI_API_ACCEPT_COST=1 to run Nano Banana 3 discovery, generation, reference editing, and guided-region acceptance."
    );
  }
}

function redactSecrets(value) {
  let redacted = String(value);
  if (apiKey) {
    redacted = redacted.split(apiKey).join("[REDACTED_GEMINI_API_KEY]");
  }
  return redacted
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GEMINI_API_KEY]")
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^"',\s]+/gi, "$1[REDACTED]");
}

function endpoint(pathname, params = {}) {
  const url = new URL(`${baseURL}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("key", apiKey);
  return url;
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(redactSecrets(`${label} returned non-JSON response with HTTP ${response.status}: ${text.slice(0, 500)}`));
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? JSON.stringify(payload).slice(0, 500);
    throw new Error(redactSecrets(`${label} failed with HTTP ${response.status}: ${message}`));
  }
  return payload;
}

async function verifyModels() {
  let pageToken = "";
  const modelIds = new Set();

  do {
    const response = await fetch(endpoint("/models", { pageSize: 1000, pageToken }));
    const payload = await parseJsonResponse(response, "models");
    for (const item of payload.models ?? []) {
      const id = item.id ?? item.name?.replace(/^models\//, "");
      if (id) modelIds.add(id);
    }
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  if (!modelIds.has(model)) {
    throw new Error(`models response did not include ${model}.`);
  }
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

function createPng({ width, height, color, mask = false }) {
  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel + 1;
  const raw = Buffer.alloc(rowLength * height);
  const centerX0 = Math.floor(width * 0.28);
  const centerX1 = Math.floor(width * 0.72);
  const centerY0 = Math.floor(height * 0.28);
  const centerY1 = Math.floor(height * 0.72);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * bytesPerPixel;
      const inCenter = x >= centerX0 && x <= centerX1 && y >= centerY0 && y <= centerY1;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = mask && inCenter ? 0 : 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function mimeExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function saveB64(label, b64, mimeType, outputDir) {
  const buffer = Buffer.from(b64, "base64");
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const outputPath = path.join(outputDir, `${label}-${digest}.${mimeExtension(mimeType)}`);
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function saveGeminiOutputs(label, payload, outputDir) {
  const parts = (payload.candidates ?? []).flatMap((candidate) => candidate?.content?.parts ?? []);
  const imageParts = parts
    .map((part) => part.inlineData ?? part.inline_data)
    .filter((part) => part?.data && part?.mimeType);
  if (imageParts.length === 0) {
    throw new Error(`${label} did not return any inline image parts.`);
  }

  const textParts = parts.map((part) => part.text).filter((part) => typeof part === "string" && part.trim());
  if (textParts.length > 0) {
    await writeFile(path.join(outputDir, `${label}-text-parts.json`), JSON.stringify(textParts, null, 2));
  }

  const outputs = [];
  for (const [index, image] of imageParts.entries()) {
    outputs.push(await saveB64(`${label}-${index + 1}`, image.data, image.mimeType, outputDir));
  }
  return outputs;
}

async function generateContent(label, prompt, inlineImages, outputDir) {
  const response = await fetch(endpoint(`/models/${encodeURIComponent(model)}:generateContent`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...inlineImages.map((image) => ({
              inlineData: {
                mimeType: image.mimeType,
                data: image.buffer.toString("base64")
              }
            }))
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    })
  });

  const payload = await parseJsonResponse(response, label);
  return saveGeminiOutputs(label, payload, outputDir);
}

async function main() {
  requireAcceptance();
  const outputDir = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });

  const source = createPng({ width: 512, height: 512, color: [224, 235, 244] });
  const mask = createPng({ width: 512, height: 512, color: [255, 255, 255], mask: true });
  await writeFile(path.join(outputDir, "source.png"), source);
  await writeFile(path.join(outputDir, "guided-region-mask.png"), mask);

  await verifyModels();
  const sourceImage = { mimeType: "image/png", buffer: source };
  const maskImage = { mimeType: "image/png", buffer: mask };
  const outputs = [
    ...(await generateContent("generation", "Create a clean product-style icon for a desktop image editing tool on a neutral background.", [], outputDir)),
    ...(await generateContent("reference-edit", "Edit this reference into a cleaner product shot while preserving the square composition.", [sourceImage], outputDir)),
    ...(await generateContent(
      "guided-region-edit",
      "Use the transparent area in the second image as a guided region. Change only that area into a bright green circle and keep the rest stable.",
      [sourceImage, maskImage],
      outputDir
    ))
  ];

  console.log("Real Gemini / Nano Banana 3 API acceptance passed.");
  for (const output of outputs) {
    console.log(output);
  }
  console.log(`Artifacts saved in ${outputDir}`);
  console.log(`Acceptance id: ${randomUUID()}`);
}

main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
