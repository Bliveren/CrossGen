#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(rootDir, "dist", "cli", "crossgen.js");
const mockServerPath = path.join(rootDir, "scripts", "mock-openai-image-api.mjs");
const mockApiKey = "sk-mock-crossgen";
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
const smokeRoot = path.join(os.tmpdir(), `crossgen-cli-mcp-smoke-${process.pid}-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoSecret(text, label) {
  assert(!text.includes(mockApiKey), `${label} leaked the mock API key.`);
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function startMockServer(port) {
  const child = spawn(process.execPath, [mockServerPath], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { child, getOutput: () => output };
}

async function waitForMockServer(baseURL) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${mockApiKey}` }
      });
      if (response.ok) return;
    } catch {
      // Retry until the process is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock server did not become ready at ${baseURL}`);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve({ code: 1, stdout, stderr: `${stderr}\nSignal: ${signal}` });
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

function parseJsonLine(stdout, label) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const jsonLine = lines.find((line) => line.startsWith("{"));
  assert(jsonLine, `${label} did not print a JSON object.\nstdout:\n${stdout}`);
  return JSON.parse(jsonLine);
}

async function runCli(dataDir, args, options = {}) {
  const result = await runProcess(process.execPath, [cliPath, "--data-dir", dataDir, ...args], options);
  assertNoSecret(result.stdout, `CLI ${args.join(" ")} stdout`);
  assertNoSecret(result.stderr, `CLI ${args.join(" ")} stderr`);
  const expectedCode = options.expectedCode ?? 0;
  if (result.code !== expectedCode && !result.stdout.trim().startsWith("{")) {
    throw new Error(`CLI ${args.join(" ")} exited ${result.code}, expected ${expectedCode}, without JSON stdout.\nstderr:\n${result.stderr}`);
  }
  const payload = parseJsonLine(result.stdout, `CLI ${args.join(" ")}`);
  assert(result.code === expectedCode, `CLI ${args.join(" ")} exited ${result.code}, expected ${expectedCode}.\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  return payload;
}

function parseMcpResponses(stdout, label) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert(lines.length > 0, `${label} produced no MCP responses.`);
  return lines.map((line) => JSON.parse(line));
}

async function runMcp(dataDir, mode, requests) {
  const input = `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`;
  const result = await runProcess(process.execPath, [cliPath, "--data-dir", dataDir, "--mcp"], {
    input,
    env: { CROSSGEN_MCP_MODE: mode }
  });
  assertNoSecret(result.stdout, `MCP ${mode} stdout`);
  assertNoSecret(result.stderr, `MCP ${mode} stderr`);
  assert(result.code === 0, `MCP ${mode} exited ${result.code}.\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  return parseMcpResponses(result.stdout, `MCP ${mode}`);
}

async function writeMockState(dataDir, baseURL) {
  await mkdir(dataDir, { recursive: true });
  const encodedKey = Buffer.from(mockApiKey, "utf8").toString("base64");
  const now = new Date(0).toISOString();
  const state = {
    version: 3,
    providers: [{
      id: "default",
      kind: "openai",
      name: "Mock OpenAI",
      baseURL,
      enabled: true,
      defaultModel: "gpt-image-2",
      defaultSize: "1024x1024",
      defaultQuality: "low",
      timeoutMs: 30000,
      streamingPartialsEnabled: false,
      discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
      activeLaunchId: "gpt-image-2",
      activeModelId: "gpt-image-2",
      updatedAt: now,
      encryptedApiKey: `plain:${encodedKey}`,
      encryption: "localFallback"
    }],
    activeProviderId: "default",
    history: [],
    promptTemplates: [],
    galleryFolders: [],
    galleryAssets: [],
    queueConfig: { maxGlobalRunning: 1, providerConcurrency: {} }
  };
  await writeFile(path.join(dataDir, "image2tools-state.v1.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function writeTinyPng(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(tinyPngBase64, "base64"));
}

function assertCliOk(payload, label) {
  assert(payload.ok === true, `${label} did not return ok=true: ${JSON.stringify(payload)}`);
  assert(payload.schemaVersion === 1, `${label} returned unexpected schemaVersion.`);
  assert(typeof payload.requestId === "string" && payload.requestId, `${label} missing requestId.`);
  assert(payload.data && typeof payload.data === "object", `${label} missing data.`);
}

function mcpById(responses, id) {
  const response = responses.find((item) => item.id === id);
  assert(response, `Missing MCP response id ${id}.`);
  assert(!response.error, `MCP response ${id} failed: ${JSON.stringify(response.error)}`);
  return response;
}

function mcpStructuredData(response, label) {
  const structured = response.result?.structuredContent;
  assert(structured?.schemaVersion === 1, `${label} missing structured schemaVersion.`);
  assert(typeof structured.requestId === "string" && structured.requestId, `${label} missing structured requestId.`);
  assert(structured.data && typeof structured.data === "object", `${label} missing structured data.`);
  return structured.data;
}

function findGptImage2Model(modelsData) {
  return modelsData.providers?.flatMap((provider) => provider.models ?? []).find((item) => item.modelId === "gpt-image-2");
}

async function verifyCliFlow(baseURL) {
  const dataDir = path.join(smokeRoot, "cli-flow");
  await writeMockState(dataDir, baseURL);

  const version = await runCli(dataDir, ["--version", "--json"]);
  assertCliOk(version, "CLI version");
  assert(version.data.appName === "CrossGen", "CLI version returned wrong app name.");

  const doctor = await runCli(dataDir, ["doctor", "--agent", "--json"]);
  assertCliOk(doctor, "CLI doctor");
  assert(doctor.data.permissions?.mcpDefaultMode === "readonly", "doctor did not report readonly MCP default.");
  assert(Array.isArray(doctor.data.recommendedArgs) && doctor.data.recommendedArgs.includes("--mcp"), "doctor did not provide MCP args.");

  const models = await runCli(dataDir, ["models", "list", "--json"]);
  assertCliOk(models, "CLI models list");
  const model = findGptImage2Model(models.data);
  assert(model, "CLI models list did not expose gpt-image-2.");
  assert(model.capabilities?.mediaKinds?.includes("image"), "gpt-image-2 capability did not include image media kind.");
  assert(model.capabilities?.video === false, "gpt-image-2 capability must not expose video support in v0.3.1.");

  const asyncFailure = await runCli(dataDir, ["generate", "--prompt", "no live worker", "--yes", "--async", "--json"], { expectedCode: 4 });
  assert(asyncFailure.ok === false, "CLI async without live worker should fail.");
  assert(asyncFailure.error?.code === "NO_LIVE_QUEUE_WORKER", "CLI async without live worker returned the wrong error code.");

  const generation = await runCli(dataDir, [
    "generate",
    "--prompt",
    "mock cli smoke generation",
    "--folder",
    "null",
    "--idempotency-key",
    "cli-smoke-generation",
    "--yes",
    "--wait",
    "--wait-ms",
    "10000",
    "--json"
  ]);
  assertCliOk(generation, "CLI generate");
  assert(generation.data.execution?.terminal === true, "CLI generation did not reach a terminal state.");
  assert(generation.data.execution?.status === "succeeded", "CLI generation did not succeed.");
  const queueId = generation.data.queueId;
  const galleryAssetId = generation.data.execution?.job?.queueItem?.galleryAssetIds?.[0];
  assert(queueId, "CLI generation missing queue id.");
  assert(galleryAssetId, "CLI generation did not import output into Gallery.");

  const duplicate = await runCli(dataDir, [
    "generate",
    "--prompt",
    "mock cli smoke generation duplicate",
    "--folder",
    "null",
    "--idempotency-key",
    "cli-smoke-generation",
    "--yes",
    "--wait",
    "--wait-ms",
    "10000",
    "--json"
  ]);
  assertCliOk(duplicate, "CLI duplicate generation");
  assert(duplicate.data.duplicate === true, "CLI duplicate idempotency key created a second paid queue item.");
  assert(duplicate.data.queueId === queueId, "CLI duplicate idempotency key did not return the original queue id.");

  const jobStatus = await runCli(dataDir, ["job", "status", queueId, "--json"]);
  assertCliOk(jobStatus, "CLI job status");
  assert(jobStatus.data.job?.terminal === true, "CLI job status did not report terminal state.");

  const gallery = await runCli(dataDir, ["gallery", "list", "--json"]);
  assertCliOk(gallery, "CLI gallery list");
  assert(gallery.data.assets?.some((asset) => asset.id === galleryAssetId), "CLI gallery list did not include generated asset.");

  const pathFailure = await runCli(dataDir, ["asset", "path", galleryAssetId, "--json"], { expectedCode: 3 });
  assert(pathFailure.ok === false && pathFailure.error?.code === "CONFIRMATION_REQUIRED", "asset path should require explicit confirmation.");

  const exportPath = path.join(smokeRoot, "exports", "cli-generated.png");
  const assetExport = await runCli(dataDir, ["asset", "export", galleryAssetId, "--to", exportPath, "--yes", "--json"]);
  assertCliOk(assetExport, "CLI asset export");
  const exported = await stat(exportPath);
  assert(exported.size > 0, "CLI asset export wrote an empty file.");
}

async function verifyMcpFlow(baseURL) {
  const dataDir = path.join(smokeRoot, "mcp-flow");
  await writeMockState(dataDir, baseURL);
  const inputPath = path.join(smokeRoot, "inputs", "edit-source.png");
  await writeTinyPng(inputPath);

  const readonlyResponses = await runMcp(dataDir, "readonly", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_models_list", arguments: {} } }
  ]);
  const readonlyInit = mcpById(readonlyResponses, 1);
  assert(readonlyInit.result?.crossgen?.effectiveMode === "readonly", "MCP readonly did not initialize in readonly mode.");
  const readonlyTools = mcpById(readonlyResponses, 2).result?.tools?.map((tool) => tool.name) ?? [];
  assert(readonlyTools.includes("crossgen_models_list"), "MCP readonly missing models_list.");
  assert(!readonlyTools.includes("crossgen_generate_image"), "MCP readonly exposed generation tools.");
  const readonlyModels = mcpStructuredData(mcpById(readonlyResponses, 3), "MCP readonly models_list");
  assert(findGptImage2Model(readonlyModels), "MCP readonly models_list missing gpt-image-2.");

  const writeResponses = await runMcp(dataDir, "write", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ]);
  const writeTools = mcpById(writeResponses, 2).result?.tools?.map((tool) => tool.name) ?? [];
  assert(writeTools.includes("crossgen_asset_export"), "MCP write missing asset_export.");
  assert(!writeTools.includes("crossgen_generate_image"), "MCP write exposed generation tools.");

  const generateResponses = await runMcp(dataDir, "generate", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "crossgen_generate_image",
        arguments: {
          prompt: "mock mcp smoke generation",
          folderId: null,
          idempotencyKey: "mcp-smoke-generation",
          confirm: true,
          waitMs: 10000
        }
      }
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "crossgen_edit_image",
        arguments: {
          prompt: "mock mcp smoke edit",
          inputPaths: [inputPath],
          folderId: null,
          idempotencyKey: "mcp-smoke-edit",
          confirm: true,
          waitMs: 10000
        }
      }
    },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "crossgen_gallery_list", arguments: {} } }
  ]);
  const generateInit = mcpById(generateResponses, 1);
  assert(generateInit.result?.crossgen?.effectiveMode === "generate", "MCP generate did not initialize in generate mode.");
  const generateTools = mcpById(generateResponses, 2).result?.tools?.map((tool) => tool.name) ?? [];
  assert(generateTools.includes("crossgen_generate_image"), "MCP generate missing generate_image.");
  assert(generateTools.includes("crossgen_edit_image"), "MCP generate missing edit_image.");

  const mcpGenerated = mcpStructuredData(mcpById(generateResponses, 3), "MCP generate_image");
  assert(mcpGenerated.execution?.terminal === true, "MCP generate_image did not reach terminal state.");
  assert(mcpGenerated.execution?.status === "succeeded", "MCP generate_image did not succeed.");

  const mcpEdited = mcpStructuredData(mcpById(generateResponses, 4), "MCP edit_image");
  assert(mcpEdited.execution?.terminal === true, "MCP edit_image did not reach terminal state.");
  assert(mcpEdited.execution?.status === "succeeded", "MCP edit_image did not succeed.");

  const mcpGallery = mcpStructuredData(mcpById(generateResponses, 5), "MCP gallery_list");
  assert((mcpGallery.assets?.length ?? 0) >= 2, "MCP Gallery did not include generated and edited assets.");
  const assetId = mcpGallery.assets[0].id;
  const exportPath = path.join(smokeRoot, "exports", "mcp-asset.png");
  const exportResponses = await runMcp(dataDir, "write", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "crossgen_asset_export",
        arguments: { assetId, to: exportPath, confirm: true }
      }
    }
  ]);
  const mcpExport = mcpStructuredData(mcpById(exportResponses, 2), "MCP asset_export");
  assert(mcpExport.exportedPath === exportPath, "MCP asset_export returned the wrong export path.");
  const exported = await stat(exportPath);
  assert(exported.size > 0, "MCP asset_export wrote an empty file.");
}

async function main() {
  assert(existsSync(cliPath), "Missing dist/cli/crossgen.js. Run pnpm build:main before verify:cli-mcp-smoke.");
  const port = await findFreePort();
  const baseURL = `http://127.0.0.1:${port}/v1`;
  const mock = startMockServer(port);
  try {
    await waitForMockServer(baseURL);
    await verifyCliFlow(baseURL);
    await verifyMcpFlow(baseURL);
    console.log("CrossGen CLI/MCP smoke verification passed.");
  } catch (error) {
    console.error(mock.getOutput());
    throw error;
  } finally {
    mock.child.kill("SIGTERM");
    if (!process.env.CROSSGEN_KEEP_SMOKE_DATA) {
      await rm(smokeRoot, { recursive: true, force: true }).catch(() => undefined);
    } else {
      console.log(`Kept smoke data at ${smokeRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
