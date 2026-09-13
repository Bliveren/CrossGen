#!/usr/bin/env node
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const baseURL = `http://${host}:${port}/v1`;
const apiKey = "sk-mock-crossgen";
const tinyPngPrefix = "iVBORw0KGgoAAAANSUhEUg";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startMockServer() {
  const server = spawn(process.execPath, ["scripts/mock-openai-image-api.mjs"], {
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
      const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (response.ok) return;
    } catch {
      // Retry until the server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock server did not start at ${baseURL}`);
}

async function verifyModels() {
  const response = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  assert(response.ok, `models failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.data?.[0]?.id === "gpt-image-2", "models response did not include gpt-image-2");
  assert(payload.data?.some((model) => model.id === "gpt-image-2.5-sunburst"), "models response did not include GPT Image 2.5 Sunburst");
  assert(payload.data?.some((model) => model.id === "gpt-image-2.5-flare"), "models response did not include GPT Image 2.5 Flare");
}

async function recentMockRequests() {
  const response = await fetch(`${baseURL}/mock/requests`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  assert(response.ok, `mock requests failed with HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data ?? [];
}

function fieldValue(request, name) {
  return request?.fields?.[name]?.[0];
}

function fieldValues(request, name) {
  return request?.fields?.[name] ?? [];
}

function latestRequest(requests, pathname) {
  return requests.findLast?.((item) => item.pathname === pathname) ?? [...requests].reverse().find((item) => item.pathname === pathname);
}

async function verifyJsonGeneration() {
  const response = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: "mock generation",
      size: "1536x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 42,
      background: "opaque",
      n: 2,
      stream: false,
      moderation: "low"
    })
  });
  assert(response.ok, `json generation failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.data?.[0]?.b64_json?.startsWith(tinyPngPrefix), "json generation did not return a PNG b64_json");

  const requests = await recentMockRequests();
  const request = latestRequest(requests, "/v1/images/generations");
  assert(fieldValue(request, "model") === "gpt-image-2", "json generation did not send model");
  assert(fieldValue(request, "size") === "1536x1024", "json generation did not send size");
  assert(fieldValue(request, "quality") === "medium", "json generation did not send quality");
  assert(fieldValue(request, "output_format") === "webp", "json generation did not send output_format");
  assert(fieldValue(request, "output_compression") === 42, "json generation did not send output_compression");
  assert(fieldValue(request, "background") === "opaque", "json generation did not send background");
  assert(fieldValue(request, "n") === 2, "json generation did not send n");
  assert(fieldValue(request, "moderation") === "low", "json generation did not send moderation");
}

async function verifyJson25Generation() {
  const response = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-2.5-sunburst-2026-09-08",
      prompt: "mock GPT Image 2.5 generation",
      size: "3840x2160",
      quality: "max",
      output_format: "webp",
      output_compression: 33,
      background: "transparent",
      n: 1,
      stream: false,
      partial_images: 0,
      moderation: "low"
    })
  });
  assert(response.ok, `GPT Image 2.5 generation failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.data?.[0]?.b64_json?.startsWith(tinyPngPrefix), "GPT Image 2.5 generation did not return a PNG b64_json");

  const requests = await recentMockRequests();
  const request = latestRequest(requests, "/v1/images/generations");
  assert(fieldValue(request, "model") === "gpt-image-2.5-sunburst-2026-09-08", "GPT Image 2.5 generation did not send snapshot model");
  assert(fieldValue(request, "quality") === "max", "GPT Image 2.5 generation did not send max quality");
  assert(fieldValue(request, "size") === "3840x2160", "GPT Image 2.5 generation did not send 4K size");
  assert(fieldValue(request, "background") === "transparent", "GPT Image 2.5 generation did not send transparent background");
  assert(fieldValue(request, "partial_images") === 0, "GPT Image 2.5 generation did not preserve partial_images=0");
}

async function verifySseGeneration() {
  const response = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ model: "gpt-image-2", prompt: "mock stream", stream: true })
  });
  assert(response.ok, `sse generation failed with HTTP ${response.status}`);
  const text = await response.text();
  assert(text.includes("image_generation.partial_image"), "sse generation missing partial event");
  assert(text.includes("image_generation.completed"), "sse generation missing completed event");
  assert(text.includes(tinyPngPrefix), "sse generation missing PNG payload");
}

async function verifyMultipartEdit() {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", "mock edit");
  form.append("size", "1024x1536");
  form.append("quality", "high");
  form.append("output_format", "jpeg");
  form.append("output_compression", "55");
  form.append("background", "opaque");
  form.append("n", "1");
  form.append("moderation", "low");
  form.append("stream", "false");
  form.append("image[]", new Blob([Buffer.from("mock")], { type: "image/png" }), "source.png");

  const response = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  assert(response.ok, `multipart edit failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.data?.[0]?.b64_json?.startsWith(tinyPngPrefix), "multipart edit did not return a PNG b64_json");

  const requests = await recentMockRequests();
  const request = latestRequest(requests, "/v1/images/edits");
  assert(fieldValue(request, "model") === "gpt-image-2", "multipart edit did not send model");
  assert(fieldValue(request, "size") === "1024x1536", "multipart edit did not send size");
  assert(fieldValue(request, "quality") === "high", "multipart edit did not send quality");
  assert(fieldValue(request, "output_format") === "jpeg", "multipart edit did not send output_format");
  assert(fieldValue(request, "output_compression") === "55", "multipart edit did not send output_compression");
  assert(fieldValue(request, "background") === "opaque", "multipart edit did not send background");
  assert(fieldValue(request, "n") === "1", "multipart edit did not send n");
  assert(fieldValue(request, "moderation") === "low", "multipart edit did not send moderation");
  assert(request?.fields?.["image[]"]?.length === 1, "multipart edit did not send one image[] field");
}

async function verifyMultipart25Edit() {
  const form = new FormData();
  form.append("model", "gpt-image-2.5-flare-2026-09-08");
  form.append("prompt", "mock GPT Image 2.5 edit");
  form.append("quality", "xhigh");
  form.append("output_format", "png");
  form.append("background", "transparent");
  form.append("input_fidelity", "high");
  form.append("n", "1");
  form.append("stream", "false");
  form.append("image", new Blob([Buffer.from("mock-source")], { type: "image/png" }), "source.png");

  const response = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  assert(response.ok, `GPT Image 2.5 multipart edit failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.data?.[0]?.b64_json?.startsWith(tinyPngPrefix), "GPT Image 2.5 multipart edit did not return a PNG b64_json");

  const requests = await recentMockRequests();
  const request = latestRequest(requests, "/v1/images/edits");
  assert(fieldValue(request, "model") === "gpt-image-2.5-flare-2026-09-08", "GPT Image 2.5 edit did not send snapshot model");
  assert(fieldValue(request, "quality") === "xhigh", "GPT Image 2.5 edit did not send xhigh quality");
  assert(fieldValue(request, "input_fidelity") === "high", "GPT Image 2.5 edit did not send input_fidelity");
  assert(fieldValue(request, "background") === "transparent", "GPT Image 2.5 edit did not send transparent background");
  assert(fieldValues(request, "image").length === 1, "GPT Image 2.5 edit did not send one image field");
}

async function verifyMultipartInpaint() {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", "mock inpaint with multiple image references");
  form.append("stream", "false");
  form.append("image[]", new Blob([Buffer.from("mock-source-a")], { type: "image/png" }), "source-a.png");
  form.append("image[]", new Blob([Buffer.from("mock-source-b")], { type: "image/png" }), "source-b.png");
  form.append("mask", new Blob([Buffer.from("mock-mask")], { type: "image/png" }), "mask.png");

  const response = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  assert(response.ok, `multipart inpaint failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.data?.[0]?.b64_json?.startsWith(tinyPngPrefix), "multipart inpaint did not return a PNG b64_json");

  const requests = await recentMockRequests();
  const request = latestRequest(requests, "/v1/images/edits");
  assert(fieldValue(request, "model") === "gpt-image-2", "multipart inpaint did not send model");
  assert(fieldValue(request, "prompt") === "mock inpaint with multiple image references", "multipart inpaint did not send prompt");
  assert(fieldValue(request, "stream") === "false", "multipart inpaint did not send stream=false");
  assert(fieldValues(request, "image[]").length === 2, "multipart inpaint did not send two image[] fields");
  assert(fieldValues(request, "mask").length === 1, "multipart inpaint did not send one mask field");
}

async function verifySseEdit() {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", "mock streaming edit");
  form.append("stream", "true");
  form.append("partial_images", "2");
  form.append("image[]", new Blob([Buffer.from("mock-source")], { type: "image/png" }), "source.png");

  const response = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  assert(response.ok, `sse edit failed with HTTP ${response.status}`);
  const text = await response.text();
  assert(text.includes("image_edit.partial_image"), "sse edit missing partial event");
  assert(text.includes("image_edit.completed"), "sse edit missing completed event");
  assert(text.includes(tinyPngPrefix), "sse edit missing PNG payload");
}

async function verifyResponsesJson() {
  const response = await fetch(`${baseURL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-6-astra",
      previous_response_id: "resp_previous_mock",
      input: [{ role: "user", content: [{ type: "input_text", text: "continue the edit" }] }],
      tools: [{
        type: "image_generation",
        model: "gpt-image-2.5-flare",
        action: "edit",
        quality: "xhigh",
        size: "2048x1152",
        output_format: "webp",
        output_compression: 48,
        background: "transparent",
        partial_images: 0,
        input_fidelity: "high"
      }]
    })
  });
  assert(response.ok, `Responses JSON failed with HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.id?.startsWith("resp_mock_"), "Responses JSON did not return a response id");
  assert(payload.output?.[0]?.type === "image_generation_call", "Responses JSON did not return an image generation call");

  const requests = await recentMockRequests();
  const request = latestRequest(requests, "/v1/responses");
  const tool = request?.fields?.tools?.[0]?.[0];
  assert(fieldValue(request, "model") === "gpt-6-astra", "Responses JSON did not send the mainline model");
  assert(fieldValue(request, "previous_response_id") === "resp_previous_mock", "Responses JSON did not send previous_response_id");
  assert(tool?.type === "image_generation", "Responses JSON did not send an image_generation tool");
  assert(tool?.model === "gpt-image-2.5-flare", "Responses JSON did not send the GPT Image 2.5 tool model");
  assert(tool?.action === "edit", "Responses JSON did not send the edit action");
  assert(tool?.quality === "xhigh", "Responses JSON did not send xhigh quality");
  assert(tool?.input_fidelity === "high", "Responses JSON did not send input_fidelity");
}

async function verifyResponsesSse() {
  const response = await fetch(`${baseURL}/responses`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-6-astra",
      input: "mock streamed GPT Image 2.5 generation",
      stream: true,
      tools: [{
        type: "image_generation",
        model: "gpt-image-2.5-sunburst",
        action: "generate",
        partial_images: 2
      }]
    })
  });
  assert(response.ok, `Responses SSE failed with HTTP ${response.status}`);
  const text = await response.text();
  assert(text.includes("image_generation_call.partial_image"), "Responses SSE missing partial event");
  assert(text.includes("image_generation_call.completed"), "Responses SSE missing completed event");
  assert(text.includes(tinyPngPrefix), "Responses SSE missing PNG payload");
}

async function main() {
  const { server, getOutput } = startMockServer();
  try {
    await waitForServer();
    await verifyModels();
    await verifyJsonGeneration();
    await verifyJson25Generation();
    await verifySseGeneration();
    await verifyMultipartEdit();
    await verifyMultipart25Edit();
    await verifyMultipartInpaint();
    await verifySseEdit();
    await verifyResponsesJson();
    await verifyResponsesSse();
    console.log("Mock OpenAI Image API verification passed.");
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
