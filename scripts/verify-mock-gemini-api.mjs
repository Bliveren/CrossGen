#!/usr/bin/env node
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "127.0.0.1";
const baseURL = `http://${host}:${port}/v1beta`;
const apiKey = "mock-gemini-key";
const focusedModelId = "gemini-3.1-flash-image";
const generalModelId = "gemini-2.0-flash-preview-image-generation";
const tinyPngPrefix = "iVBORw0KGgoAAAANSUhEUg";
const sourceImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
const maskImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8DwQACfsD/QWf36QAAAAASUVORK5CYII=";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function endpoint(path, key = apiKey) {
  return `${baseURL}${path}?key=${encodeURIComponent(key)}`;
}

function startMockServer() {
  const server = spawn(process.execPath, ["scripts/mock-gemini-image-api.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: host },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { server, getOutput: () => output };
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint("/models"));
      if (response.ok) return;
    } catch {
      // Retry until the server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock Gemini server did not start at ${baseURL}`);
}

function partList(payload) {
  return payload?.candidates?.[0]?.content?.parts ?? [];
}

function assertGeminiImageResponse(payload, context) {
  const parts = partList(payload);
  const textPart = parts.find((part) => typeof part.text === "string");
  const imagePart = parts.find((part) => part.inlineData);
  assert(textPart?.text?.includes("Mock Gemini"), `${context} response did not include a text part`);
  assert(imagePart?.inlineData?.mimeType === "image/png", `${context} response did not include an image/png inlineData part`);
  assert(imagePart.inlineData.data?.startsWith(tinyPngPrefix), `${context} response did not include deterministic PNG base64`);
  assert(payload.candidates?.[0]?.finishReason === "STOP", `${context} response did not include STOP finishReason`);
}

async function verifyModels() {
  const response = await fetch(endpoint("/models"));
  assert(response.ok, `models failed with HTTP ${response.status}`);
  const payload = await response.json();
  const modelIds = (payload.models ?? []).map((model) => model.name?.replace(/^models\//, "") ?? model.id);
  assert(modelIds.includes(focusedModelId), "models response did not include gemini-3.1-flash-image");
  assert(modelIds.includes(generalModelId), "models response did not include a non-focused image model for General probing");
}

async function generateContent(modelId, body) {
  return fetch(endpoint(`/models/${encodeURIComponent(modelId)}:generateContent`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function verifyTextToImage() {
  const response = await generateContent(focusedModelId, {
    contents: [
      {
        role: "user",
        parts: [{ text: "Create a small deterministic mock image." }]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  });
  assert(response.ok, `text-to-image failed with HTTP ${response.status}`);
  assertGeminiImageResponse(await response.json(), "text-to-image");
}

async function verifyTextAndImageEdit() {
  const response = await generateContent(focusedModelId, {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Edit this image into a cleaner product shot." },
          {
            inlineData: {
              mimeType: "image/png",
              data: sourceImageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  });
  assert(response.ok, `text+image edit failed with HTTP ${response.status}`);
  assertGeminiImageResponse(await response.json(), "text+image edit");
}

async function verifyGuidedRegionRequest() {
  const response = await generateContent(focusedModelId, {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Only change the masked region; keep everything else stable." },
          {
            inlineData: {
              mimeType: "image/png",
              data: sourceImageBase64
            }
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: maskImageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  });
  assert(response.ok, `guided-region request failed with HTTP ${response.status}`);
  assertGeminiImageResponse(await response.json(), "guided-region");
}

async function recentMockRequests() {
  const response = await fetch(endpoint("/mock/requests"));
  assert(response.ok, `mock requests failed with HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data ?? [];
}

async function verifyRecordedRequests() {
  const requests = await recentMockRequests();
  const generateRequests = requests.filter((request) => request.modelId === focusedModelId);
  assert(generateRequests.length >= 3, "mock did not record the expected generateContent requests");
  assert(generateRequests.some((request) => request.inlineDataParts.length === 0), "mock did not record a text-to-image request");
  assert(generateRequests.some((request) => request.inlineDataParts.length === 1), "mock did not record a text+image edit request");
  assert(generateRequests.some((request) => request.inlineDataParts.length === 2), "mock did not record a guided-region request");
}

async function verifyErrorPaths() {
  const missingKeyResponse = await fetch(`${baseURL}/models`);
  assert(missingKeyResponse.status === 401, `missing key returned HTTP ${missingKeyResponse.status}, expected 401`);
  const missingKeyPayload = await missingKeyResponse.json();
  assert(missingKeyPayload.error?.status === "UNAUTHENTICATED", "missing key did not return Gemini-style UNAUTHENTICATED error");

  const invalidKeyResponse = await fetch(endpoint("/models", "bad"));
  assert(invalidKeyResponse.status === 403, `invalid key returned HTTP ${invalidKeyResponse.status}, expected 403`);
  const invalidKeyPayload = await invalidKeyResponse.json();
  assert(invalidKeyPayload.error?.message?.includes("redaction-key"), "invalid key error did not include the redaction fixture");

  const unsupportedModelResponse = await generateContent("gemini-unknown-image", {
    contents: [{ parts: [{ text: "unsupported" }] }]
  });
  assert(unsupportedModelResponse.status === 404, `unsupported model returned HTTP ${unsupportedModelResponse.status}, expected 404`);
  const unsupportedModelPayload = await unsupportedModelResponse.json();
  assert(unsupportedModelPayload.error?.status === "NOT_FOUND", "unsupported model did not return Gemini-style NOT_FOUND error");

  const malformedResponse = await fetch(endpoint(`/models/${focusedModelId}:generateContent`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json"
  });
  assert(malformedResponse.status === 400, `malformed JSON returned HTTP ${malformedResponse.status}, expected 400`);
  const malformedPayload = await malformedResponse.json();
  assert(malformedPayload.error?.status === "INVALID_ARGUMENT", "malformed JSON did not return Gemini-style INVALID_ARGUMENT error");
}

async function main() {
  const { server, getOutput } = startMockServer();
  try {
    await waitForServer();
    await verifyModels();
    await verifyTextToImage();
    await verifyTextAndImageEdit();
    await verifyGuidedRegionRequest();
    await verifyRecordedRequests();
    await verifyErrorPaths();
    console.log("Mock Gemini Image API verification passed.");
  } catch (error) {
    console.error(getOutput());
    throw error;
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
