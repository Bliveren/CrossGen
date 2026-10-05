/**
 * Packaged CLI smoke for the v0.3.5 General OpenAI-compatible reference edit
 * gate. It proves both sides of the gate against a local mock provider:
 *
 *  A. exact-id edit route evidence present -> the packaged CLI submits a
 *     multipart /images/edits request and saves the result;
 *  B. no evidence -> the packaged CLI fails closed with CAPABILITY_UNSUPPORTED
 *     and the provider receives no edit request at all.
 *
 * No real provider credential or paid request is involved.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_LAUNCHER = path.join(
  ROOT,
  "release",
  "mac-arm64",
  "CrossGen.app",
  "Contents",
  "Resources",
  "cli",
  "crossgen"
);
const LAUNCHER = process.env.CROSSGEN_SMOKE_CLI_COMMAND?.trim() || DEFAULT_LAUNCHER;
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
const MOCK_API_KEY = "sk-mock-general-smoke";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCli(dataDir, args, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(LAUNCHER, args, {
      env: {
        ...process.env,
        CROSSGEN_DATA_DIR: dataDir,
        CROSSGEN_USER_DATA_DIR: dataDir
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Packaged CLI timed out after ${timeoutMs}ms: ${args.join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const jsonLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .pop();
      let payload;
      if (jsonLine) {
        try {
          payload = JSON.parse(jsonLine);
        } catch {
          payload = undefined;
        }
      }
      resolve({ code, stdout, stderr, payload });
    });
  });
}

function createMockProviderServer() {
  const editRequests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      if (request.method === "POST" && (request.url ?? "").endsWith("/images/edits")) {
        editRequests.push({
          contentType: String(request.headers["content-type"] ?? ""),
          body: body.toString("latin1")
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  return { server, editRequests };
}

function stateFor(baseURL, { withEvidence }) {
  const now = new Date(0).toISOString();
  const encodedKey = Buffer.from(MOCK_API_KEY, "utf8").toString("base64");
  return {
    version: 3,
    providers: [
      {
        id: "default",
        kind: "openai",
        name: "Mock General",
        baseURL,
        enabled: true,
        defaultModel: "dall-e-3",
        defaultSize: "1024x1024",
        defaultQuality: "low",
        timeoutMs: 30000,
        streamingPartialsEnabled: false,
        discoveredModels: [
          {
            id: "dall-e-3",
            providerKind: "openai",
            availability: "listed",
            raw: { capabilities: { image_generation: true } }
          }
        ],
        lastModelDiscoveryAt: now,
        activeLaunchId: "general",
        activeModelId: "dall-e-3",
        ...(withEvidence
          ? {
              openAIImageRouting: {
                modelId: "dall-e-3",
                preferredEditRoute: "image-api",
                preferredEditRouteVerified: false,
                probes: [
                  {
                    route: "image-api",
                    mode: "edit",
                    modelId: "dall-e-3",
                    endpoint: "/images/edits",
                    ok: true,
                    verified: false,
                    latencyMs: 5,
                    status: 400
                  }
                ],
                updatedAt: now
              }
            }
          : {}),
        updatedAt: now,
        encryptedApiKey: `plain:${encodedKey}`,
        encryption: "localFallback"
      }
    ],
    activeProviderId: "default",
    history: [],
    promptTemplates: [],
    galleryFolders: [],
    galleryAssets: [],
    queueConfig: { maxGlobalRunning: 1, providerConcurrency: {} }
  };
}

async function writeScenario(dataDir, baseURL, { withEvidence }) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "image2tools-state.v1.json"),
    `${JSON.stringify(stateFor(baseURL, { withEvidence }), null, 2)}\n`,
    "utf8"
  );
  const referencePath = path.join(dataDir, "reference.png");
  await writeFile(referencePath, Buffer.from(TINY_PNG_BASE64, "base64"));
  return referencePath;
}

function editArgs(referencePath, idempotencyKey) {
  return [
    "edit",
    "--prompt",
    "general packaged smoke edit",
    "--input",
    referencePath,
    "--model",
    "dall-e-3",
    "--folder",
    "null",
    "--idempotency-key",
    idempotencyKey,
    "--yes",
    "--wait",
    "--wait-ms",
    "15000",
    "--json"
  ];
}

async function main() {
  const { server, editRequests } = createMockProviderServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Mock provider server did not expose a port.");
  const baseURL = `http://127.0.0.1:${address.port}/v1`;

  const confirmedDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-general-confirmed-"));
  const blockedDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-general-blocked-"));
  try {
    // Scenario A: confirmed exact-id edit route evidence.
    const confirmedReference = await writeScenario(confirmedDir, baseURL, { withEvidence: true });
    const confirmed = await runCli(confirmedDir, editArgs(confirmedReference, "general-smoke-confirmed"));
    assert(confirmed.code === 0, `Confirmed General edit exited ${confirmed.code}.\n${confirmed.stderr}`);
    assert(confirmed.payload?.ok === true, `Confirmed General edit did not return ok=true: ${confirmed.stdout}`);
    assert(editRequests.length === 1, `Expected exactly one /images/edits request, saw ${editRequests.length}.`);
    assert(
      editRequests[0].contentType.includes("multipart/form-data"),
      `Expected multipart/form-data, saw ${editRequests[0].contentType}.`
    );
    assert(
      editRequests[0].body.includes('name="model"') &&
        editRequests[0].body.includes("dall-e-3") &&
        editRequests[0].body.includes('name="image"'),
      "Multipart edit request did not carry the model and image fields."
    );

    // Scenario B: no evidence -> fail closed before any request leaves the app.
    const blockedReference = await writeScenario(blockedDir, baseURL, { withEvidence: false });
    const blocked = await runCli(blockedDir, editArgs(blockedReference, "general-smoke-blocked"));
    assert(blocked.code === 4, `Unconfirmed General edit should exit 4, saw ${blocked.code}.\n${blocked.stderr}`);
    assert(blocked.payload?.ok === false, `Unconfirmed General edit did not return ok=false: ${blocked.stdout}`);
    assert(
      blocked.payload?.error?.code === "CAPABILITY_UNSUPPORTED",
      `Unconfirmed General edit returned ${blocked.payload?.error?.code}.`
    );
    assert(
      String(blocked.payload?.error?.message ?? "").includes("尚未确认参考图编辑路由"),
      `Unconfirmed General edit message was: ${blocked.payload?.error?.message}`
    );
    assert(editRequests.length === 1, "Unconfirmed General edit must not reach the provider.");

    console.log(
      JSON.stringify(
        {
          ok: true,
          scenarios: [
            "confirmed exact-id edit route submitted multipart /images/edits",
            "unconfirmed route blocked with CAPABILITY_UNSUPPORTED before any provider request"
          ]
        },
        null,
        2
      )
    );
  } finally {
    await rm(confirmedDir, { recursive: true, force: true });
    await rm(blockedDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
