#!/usr/bin/env node
import { spawn } from "node:child_process";

const host = process.env.HOST ?? "127.0.0.1";
const openAIApiKey = "sk-mock-image2tools";
const geminiApiKey = "mock-gemini-key";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startMockServer(script, env) {
  const server = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: host, ...env },
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

async function stopMockServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => {
    server.once("exit", resolve);
    server.kill("SIGTERM");
    setTimeout(resolve, 1500).unref();
  });
}

async function waitForOpenAIModels(baseURL) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${openAIApiKey}` }
      });
      if (response.ok) return;
    } catch {
      // Retry until the server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock OpenAI discovery server did not start at ${baseURL}`);
}

async function waitForGeminiModels(baseURL) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/models?key=${encodeURIComponent(geminiApiKey)}`);
      if (response.ok) return;
    } catch {
      // Retry until the server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock Gemini discovery server did not start at ${baseURL}`);
}

async function withOpenAIMock(port, modelIds, callback) {
  const baseURL = `http://${host}:${port}/v1`;
  const { server, getOutput } = startMockServer("scripts/mock-openai-image-api.mjs", {
    PORT: String(port),
    MOCK_OPENAI_MODELS: modelIds.join(",")
  });
  try {
    await waitForOpenAIModels(baseURL);
    await callback(baseURL);
  } catch (error) {
    console.error(getOutput());
    throw error;
  } finally {
    await stopMockServer(server);
  }
}

async function withGeminiMock(port, modelIds, callback) {
  const baseURL = `http://${host}:${port}/v1beta`;
  const { server, getOutput } = startMockServer("scripts/mock-gemini-image-api.mjs", {
    PORT: String(port),
    MOCK_GEMINI_MODELS: modelIds.join(",")
  });
  try {
    await waitForGeminiModels(baseURL);
    await callback(baseURL);
  } catch (error) {
    console.error(getOutput());
    throw error;
  } finally {
    await stopMockServer(server);
  }
}

async function openAIModelIds(baseURL) {
  const response = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${openAIApiKey}` }
  });
  assert(response.ok, `OpenAI-compatible discovery failed with HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data ?? []).map((model) => model.id).filter(Boolean);
}

async function geminiModelIds(baseURL, key = geminiApiKey) {
  const response = await fetch(`${baseURL}/models?key=${encodeURIComponent(key)}`);
  assert(response.ok, `Gemini discovery failed with HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.models ?? []).map((model) => String(model.name ?? model.id ?? "").replace(/^models\//, "")).filter(Boolean);
}

function hasImageLikeCandidate(modelIds) {
  return modelIds.some((id) => /image|imagen|dall-e|dalle|stable-diffusion|sdxl|flux|recraft/i.test(id) && id !== "gpt-image-2" && id !== "gemini-3.1-flash-image");
}

async function verifyOpenAIFocusedDiscovery() {
  await withOpenAIMock(8791, ["gpt-image-2", "gpt-4.1"], async (baseURL) => {
    const ids = await openAIModelIds(baseURL);
    assert(ids.includes("gpt-image-2"), "OpenAI mock did not expose gpt-image-2");
  });
}

async function verifyOpenAIMissingFocusedDiscovery() {
  await withOpenAIMock(8792, ["gpt-4.1", "dall-e-3"], async (baseURL) => {
    const ids = await openAIModelIds(baseURL);
    assert(!ids.includes("gpt-image-2"), "OpenAI mock unexpectedly exposed gpt-image-2");
    assert(ids.includes("dall-e-3"), "OpenAI mock did not expose the non-focused image-like model fixture");
  });
}

async function verifyGeminiFocusedAndGeneralDiscovery() {
  await withGeminiMock(8793, ["gemini-3.1-flash-image", "gemini-2.0-flash-preview-image-generation"], async (baseURL) => {
    const ids = await geminiModelIds(baseURL);
    assert(ids.includes("gemini-3.1-flash-image"), "Gemini mock did not expose gemini-3.1-flash-image");
    assert(hasImageLikeCandidate(ids), "Gemini mock did not expose a non-focused image-like General candidate");
  });
}

async function verifyGeminiMissingFocusedDiscovery() {
  await withGeminiMock(8794, ["gemini-1.5-pro", "gemini-2.0-flash-preview-image-generation"], async (baseURL) => {
    const ids = await geminiModelIds(baseURL);
    assert(!ids.includes("gemini-3.1-flash-image"), "Gemini mock unexpectedly exposed gemini-3.1-flash-image");
    assert(hasImageLikeCandidate(ids), "Gemini mock did not retain the General image candidate fixture");
  });
}

async function verifyGeminiDiscoveryAuthErrors() {
  await withGeminiMock(8795, ["gemini-3.1-flash-image"], async (baseURL) => {
    const missingKey = await fetch(`${baseURL}/models`);
    assert(missingKey.status === 401, `Gemini missing-key discovery returned HTTP ${missingKey.status}, expected 401`);
    const invalidKey = await fetch(`${baseURL}/models?key=bad`);
    assert(invalidKey.status === 403, `Gemini invalid-key discovery returned HTTP ${invalidKey.status}, expected 403`);
    const payload = await invalidKey.json();
    assert(payload.error?.message?.includes("redaction-key"), "Gemini invalid-key error did not include the redaction fixture");
  });
}

async function main() {
  await verifyOpenAIFocusedDiscovery();
  await verifyOpenAIMissingFocusedDiscovery();
  await verifyGeminiFocusedAndGeneralDiscovery();
  await verifyGeminiMissingFocusedDiscovery();
  await verifyGeminiDiscoveryAuthErrors();
  console.log("Mock model discovery verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
