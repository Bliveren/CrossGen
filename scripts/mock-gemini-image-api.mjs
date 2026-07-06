#!/usr/bin/env node
import http from "node:http";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "127.0.0.1";
const focusedModelId = "gemini-3.1-flash-image";
const generalModelId = "gemini-2.0-flash-preview-image-generation";
const modelIds = parseModelIds(process.env.MOCK_GEMINI_MODELS, [focusedModelId, generalModelId]);
const supportedModelIds = new Set(modelIds);
const recentRequests = [];

function parseModelIds(value, fallback) {
  const ids = String(value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^models\//, ""))
    .filter(Boolean);
  return ids.length > 0 ? ids : fallback;
}

function redactionFixtureKey() {
  return ["AIza", "SyD", "-mock-redaction-key-should-not-leak-0000"].join("");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-request-id": `mock_gemini_${Date.now()}`
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendGeminiError(response, status, statusText, message) {
  sendJson(response, status, {
    error: {
      code: status,
      message,
      status: statusText
    }
  });
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestApiKey(request, url) {
  const headerKey = request.headers["x-goog-api-key"];
  return url.searchParams.get("key") ?? (Array.isArray(headerKey) ? headerKey[0] : headerKey);
}

function validateApiKey(request, url) {
  const apiKey = requestApiKey(request, url);
  if (!apiKey) {
    return {
      status: 401,
      statusText: "UNAUTHENTICATED",
      message: "API key is required. Pass a mock Gemini key in the key query parameter."
    };
  }
  if (apiKey.length < 12 || /invalid|bad|expired/i.test(apiKey)) {
    return {
      status: 403,
      statusText: "PERMISSION_DENIED",
      message: `API key not valid. Redaction fixture: ${redactionFixtureKey()}`
    };
  }
  return null;
}

function modelResource(modelId) {
  return {
    name: `models/${modelId}`,
    id: modelId,
    version: modelId === focusedModelId ? "3.1" : "2.0",
    displayName: modelId === focusedModelId ? "Gemini 3.1 Flash Image" : "Gemini 2.0 Flash Preview Image Generation",
    description:
      modelId === focusedModelId
        ? "Mock Nano Banana 3 image model for CrossGen verification."
        : "Mock non-focused image generation model for General probing.",
    inputTokenLimit: 32768,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ["generateContent"]
  };
}

function parseGenerateContentBody(bodyText) {
  if (!bodyText.trim()) {
    return { error: "Malformed JSON body: request body is empty." };
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { error: "Malformed JSON body: request body must be valid JSON." };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Malformed Gemini body: expected a JSON object." };
  }
  if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
    return { error: "Malformed Gemini body: contents must be a non-empty array." };
  }

  const textParts = [];
  const imageParts = [];
  for (const content of payload.contents) {
    if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
      return { error: "Malformed Gemini body: each content item must include a parts array." };
    }
    for (const part of content.parts) {
      if (!part || typeof part !== "object") {
        return { error: "Malformed Gemini body: each part must be an object." };
      }
      if (typeof part.text === "string") {
        textParts.push(part.text);
        continue;
      }
      if (part.inlineData) {
        if (
          !part.inlineData ||
          typeof part.inlineData !== "object" ||
          typeof part.inlineData.mimeType !== "string" ||
          typeof part.inlineData.data !== "string"
        ) {
          return { error: "Malformed Gemini body: inlineData parts require mimeType and data strings." };
        }
        imageParts.push({
          mimeType: part.inlineData.mimeType,
          dataLength: part.inlineData.data.length
        });
        continue;
      }
      return { error: "Malformed Gemini body: parts must contain text or inlineData." };
    }
  }

  if (textParts.length === 0) {
    return { error: "Malformed Gemini body: at least one text part is required." };
  }

  return { payload, textParts, imageParts };
}

function recordGenerateContentRequest(pathname, modelId, parsed) {
  recentRequests.push({
    pathname,
    modelId,
    textParts: parsed.textParts,
    inlineDataParts: parsed.imageParts
  });
  recentRequests.splice(0, Math.max(0, recentRequests.length - 20));
}

function generationText(modelId, parsed) {
  if (parsed.imageParts.length >= 2) {
    return `Mock Gemini guided-region response for ${modelId}.`;
  }
  if (parsed.imageParts.length === 1) {
    return `Mock Gemini image edit response for ${modelId}.`;
  }
  return `Mock Gemini text-to-image response for ${modelId}.`;
}

function generateContentResponse(modelId, parsed) {
  return {
    candidates: [
      {
        index: 0,
        content: {
          role: "model",
          parts: [
            { text: generationText(modelId, parsed) },
            {
              inlineData: {
                mimeType: "image/png",
                data: tinyPngBase64
              }
            }
          ]
        },
        finishReason: "STOP"
      }
    ],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2
    },
    modelVersion: modelId
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendGeminiError(response, 400, "INVALID_ARGUMENT", "Missing URL.");
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
    const authError = validateApiKey(request, url);
    if (authError) {
      sendGeminiError(response, authError.status, authError.statusText, authError.message);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1beta/models") {
      sendJson(response, 200, {
        models: modelIds.map(modelResource)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1beta/mock/requests") {
      sendJson(response, 200, { data: recentRequests });
      return;
    }

    if (request.method === "POST") {
      const match = /^\/v1beta\/models\/([^/]+):generateContent$/.exec(url.pathname);
      if (match) {
        const modelId = decodeURIComponent(match[1]);
        if (!supportedModelIds.has(modelId)) {
          sendGeminiError(response, 404, "NOT_FOUND", `Model ${modelId} is not supported by the mock Gemini Image API.`);
          return;
        }

        const bodyText = await readText(request);
        const parsed = parseGenerateContentBody(bodyText);
        if (parsed.error) {
          sendGeminiError(response, 400, "INVALID_ARGUMENT", parsed.error);
          return;
        }

        recordGenerateContentRequest(url.pathname, modelId, parsed);
        sendJson(response, 200, generateContentResponse(modelId, parsed));
        return;
      }
    }

    sendGeminiError(response, 404, "NOT_FOUND", `No mock route for ${request.method} ${url.pathname}.`);
  } catch (error) {
    sendGeminiError(response, 500, "INTERNAL", error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  console.log(`Mock Gemini Image API listening at http://${host}:${port}/v1beta`);
  console.log("Use any mock API key with at least 12 characters, for example mock-gemini-key.");
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
