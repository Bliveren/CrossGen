#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const model = "gpt-image-2";
const baseURL = (process.env.IMAGE2TOOLS_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const apiKey = process.env.IMAGE2TOOLS_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const acceptCost = process.env.IMAGE2TOOLS_REAL_API_ACCEPT_COST === "1";
const outputRoot = path.resolve("real-api-artifacts");

function requireAcceptance() {
  if (!apiKey) {
    throw new Error("Missing IMAGE2TOOLS_API_KEY or OPENAI_API_KEY. No real API calls were made.");
  }
  if (!acceptCost) {
    throw new Error(
      "Refusing to make paid real Image API calls. Set IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 to run generation, edit, multi-image edit, and inpaint acceptance."
    );
  }
}

function endpoint(pathname) {
  return `${baseURL}${pathname}`;
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra
  };
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON response with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? JSON.stringify(payload).slice(0, 500);
    throw new Error(`${label} failed with HTTP ${response.status}: ${message}`);
  }
  return payload;
}

async function verifyModels() {
  const response = await fetch(endpoint("/models"), {
    headers: authHeaders()
  });
  const payload = await parseJsonResponse(response, "models");
  const hasModel = payload.data?.some((item) => item.id === model);
  if (!hasModel) {
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
  const centerX0 = Math.floor(width * 0.32);
  const centerX1 = Math.floor(width * 0.68);
  const centerY0 = Math.floor(height * 0.32);
  const centerY1 = Math.floor(height * 0.68);

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

function commonFields() {
  return {
    model,
    size: "1024x1024",
    quality: "low",
    output_format: "png",
    n: 1,
    stream: false,
    moderation: "auto"
  };
}

async function saveB64Image(label, payload, outputDir) {
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`${label} did not return data[0].b64_json.`);
  }
  const buffer = Buffer.from(b64, "base64");
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const outputPath = path.join(outputDir, `${label}-${digest}.png`);
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function requestGeneration(outputDir) {
  const response = await fetch(endpoint("/images/generations"), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      ...commonFields(),
      prompt: "A clean product-style icon of a small desktop image editing tool on a neutral background."
    })
  });
  const payload = await parseJsonResponse(response, "generation");
  return saveB64Image("generation", payload, outputDir);
}

async function requestEdit(outputDir, images, mask) {
  const form = new FormData();
  for (const [key, value] of Object.entries(commonFields())) {
    form.append(key, String(value));
  }
  form.append("prompt", mask ? "Replace the center area with a bright green circle." : "Turn the reference into a cleaner app icon mockup.");
  images.forEach((image, index) => {
    form.append("image[]", new Blob([image], { type: "image/png" }), `source-${index + 1}.png`);
  });
  if (mask) {
    form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");
  }

  const response = await fetch(endpoint("/images/edits"), {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const label = mask ? "inpaint" : images.length > 1 ? "multi-edit" : "single-edit";
  const payload = await parseJsonResponse(response, label);
  return saveB64Image(label, payload, outputDir);
}

async function main() {
  requireAcceptance();
  const outputDir = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });

  const sourceA = createPng({ width: 1024, height: 1024, color: [225, 237, 245] });
  const sourceB = createPng({ width: 1024, height: 1024, color: [236, 222, 204] });
  const mask = createPng({ width: 1024, height: 1024, color: [255, 255, 255], mask: true });
  await writeFile(path.join(outputDir, "source-a.png"), sourceA);
  await writeFile(path.join(outputDir, "source-b.png"), sourceB);
  await writeFile(path.join(outputDir, "mask.png"), mask);

  await verifyModels();
  const outputs = [
    await requestGeneration(outputDir),
    await requestEdit(outputDir, [sourceA]),
    await requestEdit(outputDir, [sourceA, sourceB]),
    await requestEdit(outputDir, [sourceA], mask)
  ];

  console.log("Real Image API acceptance passed.");
  for (const output of outputs) {
    console.log(output);
  }
  console.log(`Artifacts saved in ${outputDir}`);
  console.log(`Acceptance id: ${randomUUID()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
