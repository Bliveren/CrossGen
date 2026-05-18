#!/usr/bin/env node
import http from "node:http";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-request-id": `mock_${Date.now()}`
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function hasField(bodyText, name) {
  if (bodyText.includes(`name="${name}"`)) return true;
  try {
    const payload = JSON.parse(bodyText);
    return Object.hasOwn(payload, name);
  } catch {
    return false;
  }
}

function validateImageRequest(pathname, bodyText) {
  if (!hasField(bodyText, "model")) {
    return "Missing model field";
  }
  if (!hasField(bodyText, "prompt")) {
    return "Missing prompt field";
  }
  if (pathname.endsWith("/edits") && !hasField(bodyText, "image[]") && !hasField(bodyText, "image") && !hasField(bodyText, "images")) {
    return "Missing edit image field";
  }
  return null;
}

function sendSse(response, prefix) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-request-id": `mock_${Date.now()}`
  });

  response.write(`event: ${prefix}.partial_image\n`);
  response.write(`data: ${JSON.stringify({ type: `${prefix}.partial_image`, partial_image_index: 0, b64_json: tinyPngBase64 })}\n\n`);
  response.write(`event: ${prefix}.completed\n`);
  response.write(`data: ${JSON.stringify({ type: `${prefix}.completed`, b64_json: tinyPngBase64, usage: { total_tokens: 1 } })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function wantsStream(request, bodyText) {
  return request.headers.accept?.includes("text/event-stream") || bodyText.includes('"stream":true') || bodyText.includes("name=\"stream\"\r\n\r\ntrue");
}

const server = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: { message: "Missing URL" } });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, { data: [{ id: "gpt-image-2", object: "model" }] });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/v1/images/generations" || url.pathname === "/v1/images/edits")) {
      const bodyText = await readText(request);
      const validationError = validateImageRequest(url.pathname, bodyText);
      if (validationError) {
        sendJson(response, 400, { error: { message: validationError } });
        return;
      }
      const prefix = url.pathname.endsWith("/edits") ? "image_edit" : "image_generation";
      if (wantsStream(request, bodyText)) {
        sendSse(response, prefix);
        return;
      }
      sendJson(response, 200, {
        data: [{ b64_json: tinyPngBase64 }],
        usage: { total_tokens: 1 }
      });
      return;
    }

    sendJson(response, 404, { error: { message: `No mock route for ${request.method} ${url.pathname}` } });
  } catch (error) {
    sendJson(response, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(port, host, () => {
  console.log(`Mock OpenAI Image API listening at http://${host}:${port}/v1`);
  console.log("Use any API key with at least 12 characters, for example sk-mock-image2tools.");
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
