#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(rootDir, "dist", "cli", "crossgen.js");
const smokeRoot = path.join(os.tmpdir(), `crossgen-agent-integration-smoke-${process.pid}-${Date.now()}`);
const mockApiKey = "sk-mock-crossgen-agent";
const clients = ["codex", "claude-code", "cursor"];
const modes = ["readonly", "write", "generate"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoSecret(text, label) {
  assert(!text.includes(mockApiKey), `${label} leaked the mock API key.`);
}

function assertNoDataDir(text, dataDir, label) {
  assert(!text.includes(dataDir), `${label} leaked the isolated data directory.`);
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
  assertNoDataDir(result.stdout, dataDir, `MCP ${mode} stdout`);
  assertNoDataDir(result.stderr, dataDir, `MCP ${mode} stderr`);
  assert(result.code === 0, `MCP ${mode} exited ${result.code}.\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  return parseMcpResponses(result.stdout, `MCP ${mode}`);
}

async function writeMockState(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const encodedKey = Buffer.from(mockApiKey, "utf8").toString("base64");
  const now = new Date(0).toISOString();
  const state = {
    version: 3,
    providers: [{
      id: "default",
      kind: "openai",
      name: "Mock OpenAI",
      baseURL: "http://127.0.0.1:65535/v1",
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

function assertCliOk(payload, label) {
  assert(payload.ok === true, `${label} did not return ok=true: ${JSON.stringify(payload)}`);
  assert(payload.schemaVersion === 1, `${label} returned unexpected schemaVersion.`);
  assert(typeof payload.requestId === "string" && payload.requestId, `${label} missing requestId.`);
  assert(payload.data && typeof payload.data === "object", `${label} missing data.`);
}

function mcpById(responses, id) {
  const response = responses.find((item) => item.id === id);
  assert(response, `Missing MCP response id ${id}.`);
  return response;
}

function toolNames(response) {
  return response.result?.tools?.map((tool) => tool.name) ?? [];
}

function assertToolError(response, code, label) {
  assert(!response.error, `${label} returned protocol error: ${JSON.stringify(response.error)}`);
  assert(response.result?.isError === true, `${label} did not return a tool error.`);
  const structured = response.result?.structuredContent;
  assert(structured?.schemaVersion === 1, `${label} missing structured schemaVersion.`);
  assert(typeof structured.requestId === "string" && structured.requestId, `${label} missing structured requestId.`);
  assert(structured.error?.code === code, `${label} returned ${structured.error?.code}, expected ${code}.`);
}

function expectedPermissions(mode) {
  return {
    readonly: true,
    write: mode === "write" || mode === "generate",
    generate: mode === "generate"
  };
}

async function verifyMcpConfig(dataDir) {
  for (const client of clients) {
    for (const mode of modes) {
      const payload = await runCli(dataDir, ["mcp", "config", "--client", client, "--mode", mode, "--json"]);
      assertCliOk(payload, `mcp config ${client} ${mode}`);
      const text = JSON.stringify(payload);
      assertNoDataDir(text, dataDir, `mcp config ${client} ${mode}`);
      assert(payload.data.client === client, `mcp config returned wrong client for ${client}.`);
      assert(payload.data.requestedMode === mode, `mcp config returned wrong requestedMode for ${mode}.`);
      assert(payload.data.mode === mode, `mcp config returned wrong effective mode for ${mode}.`);
      assert(payload.data.transport === "stdio", "mcp config must use stdio transport.");
      assert(Array.isArray(payload.data.args) && payload.data.args.includes("--mcp"), "mcp config did not include --mcp args.");
      assert(payload.data.env?.CROSSGEN_MCP_MODE === mode, "mcp config did not set CROSSGEN_MCP_MODE.");
      assert(JSON.stringify(payload.data.permissions) === JSON.stringify(expectedPermissions(mode)), `mcp config returned wrong permissions for ${mode}.`);
      assert(JSON.stringify(payload.data.supportedModes) === JSON.stringify(modes), "mcp config returned unexpected supportedModes.");
      if (mode === "generate") {
        assert(typeof payload.data.generateModeWarning === "string" && payload.data.generateModeWarning.includes("Generate mode"), "generate mode config missing warning.");
      } else {
        assert(!("generateModeWarning" in payload.data), `${mode} config should not include generateModeWarning.`);
      }
    }
  }
}

async function verifyMcpModeTools(dataDir) {
  const readonlyResponses = await runMcp(dataDir, "readonly", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ]);
  const readonlyInit = mcpById(readonlyResponses, 1);
  assert(readonlyInit.result?.crossgen?.effectiveMode === "readonly", "MCP readonly initialized in the wrong mode.");
  const readonlyTools = toolNames(mcpById(readonlyResponses, 2));
  assert(readonlyTools.includes("crossgen_config_status"), "MCP readonly missing config_status.");
  assert(readonlyTools.includes("crossgen_models_list"), "MCP readonly missing models_list.");
  assert(!readonlyTools.includes("crossgen_folder_create"), "MCP readonly exposed write tools.");
  assert(!readonlyTools.includes("crossgen_generate_image"), "MCP readonly exposed generation tools.");

  const writeResponses = await runMcp(dataDir, "write", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_asset_path", arguments: { assetId: "asset-1" } } }
  ]);
  const writeInit = mcpById(writeResponses, 1);
  assert(writeInit.result?.crossgen?.effectiveMode === "write", "MCP write initialized in the wrong mode.");
  const writeTools = toolNames(mcpById(writeResponses, 2));
  assert(writeTools.includes("crossgen_folder_create"), "MCP write missing folder_create.");
  assert(writeTools.includes("crossgen_queue_config_set"), "MCP write missing queue_config_set.");
  assert(writeTools.includes("crossgen_asset_export"), "MCP write missing asset_export.");
  assert(!writeTools.includes("crossgen_generate_image"), "MCP write exposed generation tools.");
  assertToolError(mcpById(writeResponses, 3), "CONFIRMATION_REQUIRED", "MCP asset_path without confirmation");

  const generateResponses = await runMcp(dataDir, "generate", [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_generate_image", arguments: { prompt: "agent smoke" } } }
  ]);
  const generateInit = mcpById(generateResponses, 1);
  assert(generateInit.result?.crossgen?.effectiveMode === "generate", "MCP generate initialized in the wrong mode.");
  const generateTools = toolNames(mcpById(generateResponses, 2));
  assert(generateTools.includes("crossgen_folder_create"), "MCP generate missing write tools.");
  assert(generateTools.includes("crossgen_generate_image"), "MCP generate missing generate_image.");
  assert(generateTools.includes("crossgen_edit_image"), "MCP generate missing edit_image.");
  assert(generateTools.includes("crossgen_job_cancel"), "MCP generate missing job_cancel.");
  assert(generateTools.includes("crossgen_job_retry"), "MCP generate missing job_retry.");
  assertToolError(mcpById(generateResponses, 3), "CONFIRMATION_REQUIRED", "MCP generate_image without confirmation");
}

async function verifyDoctor(dataDir) {
  const payload = await runCli(dataDir, ["doctor", "--agent", "--json"]);
  assertCliOk(payload, "doctor --agent");
  assert(payload.data.permissions?.mcpDefaultMode === "readonly", "doctor did not report readonly MCP default.");
  assert(payload.data.permissions?.paidGenerationRequiresConfirmation === true, "doctor did not report generation confirmation.");
  assert(payload.data.permissions?.pathDisclosureRequiresConfirmation === true, "doctor did not report path disclosure confirmation.");
  assert(payload.data.queueConfig?.maxGlobalRunning === 1, "doctor did not report default queue concurrency.");
}

async function main() {
  assert(existsSync(cliPath), "Missing dist/cli/crossgen.js. Run pnpm build:main before verify:agent-integration-smoke.");
  const dataDir = path.join(smokeRoot, "agent");
  try {
    await writeMockState(dataDir);
    await verifyDoctor(dataDir);
    await verifyMcpConfig(dataDir);
    await verifyMcpModeTools(dataDir);
    console.log("CrossGen agent integration smoke verification passed.");
  } finally {
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
