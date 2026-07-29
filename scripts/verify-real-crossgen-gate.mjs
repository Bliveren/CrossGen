#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);

const acceptCost =
  process.env.CROSSGEN_REAL_PROVIDER_ACCEPT_COST === "1" ||
  process.env.IMAGE2TOOLS_REAL_PROVIDER_ACCEPT_COST === "1";

const dryRun =
  process.env.CROSSGEN_REAL_PROVIDER_DRY_RUN === "1" ||
  process.env.IMAGE2TOOLS_REAL_PROVIDER_DRY_RUN === "1";

const allowDiagnosticFailures =
  process.env.CROSSGEN_REAL_PROVIDER_ALLOW_DIAGNOSTIC_FAILURES === "1" ||
  process.env.IMAGE2TOOLS_REAL_PROVIDER_ALLOW_DIAGNOSTIC_FAILURES === "1";

const timeoutMs = Math.max(
  30_000,
  Number(
    process.env.CROSSGEN_REAL_PROVIDER_TIMEOUT_MS ??
      process.env.IMAGE2TOOLS_REAL_PROVIDER_TIMEOUT_MS ??
      process.env.IMAGE2TOOLS_TIMEOUT_MS ??
      240_000
  )
);

const outputRoot = path.resolve(process.env.CROSSGEN_REAL_PROVIDER_OUTPUT_DIR ?? "real-api-artifacts", "crossgen-gate");
const cliCommand = process.env.CROSSGEN_REAL_CLI_COMMAND ?? process.execPath;
const cliPrefixArgs = parseJsonArrayEnv("CROSSGEN_REAL_CLI_ARGS") ?? ["dist/cli/crossgen.js"];
const fallbackProviderId = process.env.CROSSGEN_REAL_PROVIDER_ID ?? "";
const openAIProviderId = process.env.CROSSGEN_REAL_OPENAI_PROVIDER_ID ?? process.env.IMAGE2TOOLS_REAL_OPENAI_PROVIDER_ID ?? "";
const geminiProviderId = process.env.CROSSGEN_REAL_GEMINI_PROVIDER_ID ?? process.env.IMAGE2TOOLS_REAL_GEMINI_PROVIDER_ID ?? "";
const openAIModel = process.env.CROSSGEN_REAL_OPENAI_MODEL ?? process.env.IMAGE2TOOLS_REAL_OPENAI_MODEL ?? "";
const geminiModel = process.env.CROSSGEN_REAL_GEMINI_MODEL ?? process.env.IMAGE2TOOLS_REAL_GEMINI_MODEL ?? "";

function requireAcceptance() {
  if (!acceptCost && !dryRun) {
    throw new Error("Refusing to make paid real provider calls. Set CROSSGEN_REAL_PROVIDER_ACCEPT_COST=1 to run the CrossGen saved-config gate, or CROSSGEN_REAL_PROVIDER_DRY_RUN=1 for no-cost configuration preflight.");
  }
}

function parseJsonArrayEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error(`${name} must be a JSON string array.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function runCli(args, options = {}) {
  const commandArgs = [...cliPrefixArgs, ...args, "--json"];
  try {
    const { stdout, stderr } = await execFileAsync(cliCommand, commandArgs, {
      cwd: process.cwd(),
      timeout: options.timeoutMs ?? timeoutMs + 60_000,
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "0"
      }
    });
    return parseCliJson(stdout, stderr, args.join(" "));
  } catch (error) {
    const stdout = error?.stdout ?? "";
    const stderr = error?.stderr ?? "";
    const parsed = parseCliJson(stdout, stderr, args.join(" "), false);
    if (parsed) return parsed;
    throw new Error(`CLI command failed: ${args.join(" ")}\n${redact(stderr || error?.message || String(error))}`);
  }
}

function parseCliJson(stdout, stderr, label, throwOnInvalid = true) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  const candidate = [...lines].reverse().find((line) => line.trim().startsWith("{"));
  if (!candidate) {
    if (!throwOnInvalid) return null;
    throw new Error(`CLI command did not return JSON for ${label}: ${redact(stderr || stdout).slice(0, 1000)}`);
  }
  try {
    return JSON.parse(candidate);
  } catch (error) {
    if (!throwOnInvalid) return null;
    throw new Error(`CLI command returned invalid JSON for ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED_API_KEY]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/gi, "$1[REDACTED]");
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

function png(width, height, pixel) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const nextPixel = typeof pixel === "function" ? pixel(x, y, width, height) : pixel;
      raw[offset] = nextPixel[0];
      raw[offset + 1] = nextPixel[1];
      raw[offset + 2] = nextPixel[2];
      raw[offset + 3] = nextPixel[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function maskPixel(x, y, width, height) {
  const x0 = Math.floor(width * 0.28);
  const x1 = Math.floor(width * 0.72);
  const y0 = Math.floor(height * 0.28);
  const y1 = Math.floor(height * 0.72);
  const inCenter = x >= x0 && x <= x1 && y >= y0 && y <= y1;
  return [255, 255, 255, inCenter ? 0 : 255];
}

async function writeFixtureImages(outputDir) {
  const sourcePath = path.join(outputDir, "source.png");
  const maskPath = path.join(outputDir, "guided-region-mask.png");
  await writeFile(sourcePath, png(192, 192, [230, 202, 74, 255]));
  await writeFile(maskPath, png(192, 192, maskPixel));
  return { sourcePath, maskPath };
}

function requireOk(envelope, label) {
  if (envelope?.ok) return envelope.data;
  const error = envelope?.error;
  throw new Error(`${label} returned ${error?.code ?? "UNKNOWN"}: ${error?.message ?? JSON.stringify(envelope).slice(0, 800)}`);
}

function providerArgs(provider) {
  return provider?.id ? ["--provider", provider.id] : [];
}

function modelArgs(model) {
  return model ? ["--model", model] : [];
}

function waitArgs() {
  return ["--wait", "--wait-ms", String(timeoutMs)];
}

function resultFromJob(gate, envelope, startedAt) {
  if (!envelope?.ok) {
    return failureResult(gate, startedAt, envelope?.error?.code ?? "cli_error", envelope?.error?.message ?? "CLI command failed.", envelope?.error?.help ?? []);
  }
  const data = envelope.data ?? {};
  const job = data.execution?.job ?? data.job;
  const historyJob = job?.historyJob;
  const queueItem = job?.queueItem;
  const status = historyJob?.status ?? queueItem?.status ?? data.status ?? "unknown";
  const diagnostic = historyJob?.diagnostic ?? queueItem?.diagnostic;
  const outputCount = Number(historyJob?.outputCount ?? 0);
  const durationMs = Number(historyJob?.durationMs ?? queueItem?.elapsedMs ?? 0);
  if (status === "succeeded" && outputCount > 0) {
    return {
      gate: gate.id,
      providerKind: gate.providerKind,
      model: gate.model || historyJob?.modelId || queueItem?.modelId || null,
      operation: gate.operation,
      routeSelection: "crossgen-auto",
      resolvedRoute: diagnostic?.route ?? queueItem?.route ?? null,
      inputImageCount: gate.inputImageCount,
      mask: gate.mask,
      timeoutSeconds: Math.round(timeoutMs / 1000),
      attemptCount: Number(queueItem?.attemptIndex ?? diagnostic?.attemptIndex ?? 1),
      elapsedSeconds: durationMs > 0 ? Number((durationMs / 1000).toFixed(2)) : secondsSince(startedAt),
      result: "pass",
      outputCount,
      outputIds: historyJob?.outputs?.map((output) => output.id) ?? [],
      historyJobId: data.historyJobId ?? historyJob?.id ?? null,
      queueId: data.queueId ?? queueItem?.queueId ?? null,
      diagnosticCategory: null,
      userVisibleNextActions: []
    };
  }
  const diagnosticCategory = diagnostic?.category ?? categoryFromStatus(status);
  return failureResult(
    gate,
    startedAt,
    diagnosticCategory,
    diagnostic?.message ?? historyJob?.error ?? queueItem?.error ?? `Job ended with status ${status}.`,
    diagnostic?.nextActions ?? [],
    {
      status,
      historyJobId: data.historyJobId ?? historyJob?.id ?? null,
      queueId: data.queueId ?? queueItem?.queueId ?? null
    }
  );
}

function categoryFromStatus(status) {
  if (status === "cancelled") return "cancelled";
  if (status === "interrupted") return "interrupted";
  return "unknown";
}

function failureResult(gate, startedAt, diagnosticCategory, message, nextActions = [], extra = {}) {
  return {
    gate: gate.id,
    providerKind: gate.providerKind,
    model: gate.model || null,
    operation: gate.operation,
    routeSelection: "crossgen-auto",
    resolvedRoute: null,
    inputImageCount: gate.inputImageCount,
    mask: gate.mask,
    timeoutSeconds: Math.round(timeoutMs / 1000),
    attemptCount: 1,
    elapsedSeconds: secondsSince(startedAt),
    result: diagnosticGateResult(diagnosticCategory),
    outputCount: 0,
    diagnosticCategory,
    errorSummary: redact(message),
    userVisibleNextActions: Array.isArray(nextActions) ? nextActions : [],
    ...extra
  };
}

function diagnosticGateResult(category) {
  if (["billing", "rate_limit", "safety", "unsupported_capability", "route_unsupported", "provider_empty_output"].includes(category)) {
    return "diagnostic-required";
  }
  return "blocker";
}

function secondsSince(startedAt) {
  return Number(((Date.now() - startedAt) / 1000).toFixed(2));
}

async function runGate(gate, args) {
  const startedAt = Date.now();
  console.log(`${gate.id}: ${args[0]} ${gate.operation}, timeout ${Math.round(timeoutMs / 1000)}s.`);
  try {
    const envelope = await runCli(args, { timeoutMs: timeoutMs + 90_000 });
    return resultFromJob(gate, envelope, startedAt);
  } catch (error) {
    return failureResult(gate, startedAt, "cli_error", error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  requireAcceptance();
  const outputDir = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });
  const fixtures = await writeFixtureImages(outputDir);

  const doctor = requireOk(await runCli(["doctor", "--agent"]), "doctor --agent");
  if (!doctor.apiKeyAvailable) {
    throw new Error("CrossGen saved-config gate requires a configured provider API key. doctor --agent reported apiKeyAvailable=false.");
  }
  const providerList = requireOk(await runCli(["provider", "list"]), "provider list");
  const providers = Array.isArray(providerList.providers) ? providerList.providers : [];

  const activeProvider = doctor.activeProvider ?? {};
  const openAIProvider = selectOpenAIProvider(providers, activeProvider);
  const geminiProvider = selectGeminiProvider(providers, activeProvider);
  const results = [];
  if (!openAIProvider) {
    results.push(missingProviderResult("G1-crossgen-text-to-image", "openai-compatible", "text-to-image"));
    results.push(missingProviderResult("G2-crossgen-image-to-image", "openai-compatible", "image-to-image"));
    results.push(missingProviderResult("G3-crossgen-guided-region", "openai-compatible", "guided-region", true));
  }
  if (!geminiProvider) {
    results.push(missingProviderResult("G4-crossgen-gemini-text-to-image", "gemini-compatible", "text-to-image"));
    results.push(missingProviderResult("G5-crossgen-gemini-image-to-image", "gemini-compatible", "image-to-image"));
  }

  const gates = [
    ...openAIGates(openAIProvider, fixtures),
    ...geminiGates(geminiProvider, fixtures)
  ];
  if (dryRun) {
    results.push(...gates.map(dryRunResult));
  } else {
    for (const gate of gates) {
      results.push(await runGate(gate, gate.args));
    }
  }

  const summary = {
    schemaVersion: 1,
    release: "v0.3.2",
    acceptanceId: randomUUID(),
    verifiedAt: new Date().toISOString(),
    commit: currentCommit(),
    command: cliCommand,
    cliArgs: cliPrefixArgs,
    dataDir: doctor.dataDir,
    stateFound: doctor.stateFound,
    activeProvider: doctor.activeProvider,
    selectedProviders: {
      openAI: publicSelectedProvider(openAIProvider),
      gemini: publicSelectedProvider(geminiProvider)
    },
    timeoutMs,
    dryRun,
    allowDiagnosticFailures,
    gates: results
  };
  const summaryPath = path.join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));

  const blockers = results.filter((result) => result.result === "blocker");
  const diagnostics = results.filter((result) => result.result === "diagnostic-required");
  console.log(`CrossGen saved-config gate summary: ${summaryPath}`);
  console.log(`CrossGen saved-config gate pass count: ${results.filter((result) => result.result === "pass").length}/${results.length}`);
  if (dryRun) {
    console.log("CrossGen saved-config gate dry-run completed without submitting generation jobs.");
    return;
  }
  if (diagnostics.length > 0) {
    console.log(`CrossGen saved-config gate diagnostic-required count: ${diagnostics.length}`);
  }
  if (blockers.length > 0) {
    throw new Error(`CrossGen saved-config gate has ${blockers.length} blocker(s). Summary: ${summaryPath}`);
  }
  if (diagnostics.length > 0 && !allowDiagnosticFailures) {
    throw new Error(`CrossGen saved-config gate produced diagnostic-required results. Review UI diagnostics and rerun with CROSSGEN_REAL_PROVIDER_ALLOW_DIAGNOSTIC_FAILURES=1 only after product acceptance. Summary: ${summaryPath}`);
  }
  console.log("CrossGen saved-config gate completed.");
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

function openAIGates(provider, fixtures) {
  if (!provider) return [];
  const model = openAIModel || provider.activeModelId || provider.defaultModel || "";
  return [
    {
      id: "G1-crossgen-text-to-image",
      providerKind: provider.kind ?? "openai-compatible",
      model,
      operation: "text-to-image",
      inputImageCount: 0,
      mask: false,
      args: [
        "generate",
        "--prompt",
        "Create a simple square app icon for an AI image workspace. Use a clean red circle centered on a neutral background.",
        "--folder",
        "null",
        ...providerArgs(provider),
        ...modelArgs(openAIModel),
        ...waitArgs(),
        "--yes"
      ]
    },
    {
      id: "G2-crossgen-image-to-image",
      providerKind: provider.kind ?? "openai-compatible",
      model,
      operation: "image-to-image",
      inputImageCount: 1,
      mask: false,
      args: [
        "edit",
        "--prompt",
        "Use the attached yellow square reference image. Create a more polished yellow square app icon while preserving the square composition.",
        "--input",
        fixtures.sourcePath,
        "--folder",
        "null",
        ...providerArgs(provider),
        ...modelArgs(openAIModel),
        ...waitArgs(),
        "--yes"
      ]
    },
    {
      id: "G3-crossgen-guided-region",
      providerKind: provider.kind ?? "openai-compatible",
      model,
      operation: "guided-region",
      inputImageCount: 1,
      mask: true,
      args: [
        "edit",
        "--prompt",
        "Use the transparent center of the mask to change only the center guided region into a bright green circle. Keep the rest stable.",
        "--input",
        fixtures.sourcePath,
        "--mask",
        fixtures.maskPath,
        "--folder",
        "null",
        ...providerArgs(provider),
        ...modelArgs(openAIModel),
        ...waitArgs(),
        "--yes"
      ]
    }
  ];
}

function geminiGates(provider, fixtures) {
  if (!provider) return [];
  const model = geminiModel || provider.activeModelId || provider.defaultModel || "";
  return [
    {
      id: "G4-crossgen-gemini-text-to-image",
      providerKind: "gemini-compatible",
      model,
      operation: "text-to-image",
      inputImageCount: 0,
      mask: false,
      args: [
        "generate",
        "--prompt",
        "Create a clean product-style icon for a desktop AI image management tool on a neutral background.",
        "--folder",
        "null",
        ...providerArgs(provider),
        ...modelArgs(geminiModel),
        ...waitArgs(),
        "--yes"
      ]
    },
    {
      id: "G5-crossgen-gemini-image-to-image",
      providerKind: "gemini-compatible",
      model,
      operation: "image-to-image",
      inputImageCount: 1,
      mask: false,
      args: [
        "edit",
        "--prompt",
        "Edit the attached yellow square into a cleaner product shot while preserving the square composition.",
        "--input",
        fixtures.sourcePath,
        "--folder",
        "null",
        ...providerArgs(provider),
        ...modelArgs(geminiModel),
        ...waitArgs(),
        "--yes"
      ]
    }
  ];
}

function selectOpenAIProvider(providers, activeProvider) {
  const activeFullProvider = providers.find((provider) => provider.id === activeProvider?.id);
  return selectProviderById(providers, openAIProviderId || fallbackProviderId, isOpenAIProvider) ??
    (isOpenAIProvider(activeFullProvider) ? activeFullProvider : null) ??
    providers.find(isOpenAIProvider) ??
    null;
}

function selectGeminiProvider(providers, activeProvider) {
  const activeFullProvider = providers.find((provider) => provider.id === activeProvider?.id);
  return selectProviderById(providers, geminiProviderId || fallbackProviderId, isGeminiProvider) ??
    (isGeminiProvider(activeFullProvider) ? activeFullProvider : null) ??
    providers.find(isGeminiProvider) ??
    null;
}

function selectProviderById(providers, id, predicate) {
  if (!id) return null;
  return providers.find((provider) => provider.id === id && predicate(provider)) ?? null;
}

function isOpenAIProvider(provider) {
  if (!provider?.enabled || !provider.apiKeySaved) return false;
  return provider.kind === "openai" || provider.activeLaunchId === "gpt-image-2" || /gpt-image/i.test(provider.activeModelId ?? provider.defaultModel ?? "");
}

function isGeminiProvider(provider) {
  if (!provider?.enabled || !provider.apiKeySaved) return false;
  return provider.kind === "gemini" || /gemini|banana/i.test(`${provider.activeLaunchId ?? ""} ${provider.activeModelId ?? ""} ${provider.defaultModel ?? ""}`);
}

function publicSelectedProvider(provider) {
  if (!provider) return null;
  return {
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    activeLaunchId: provider.activeLaunchId,
    activeModelId: provider.activeModelId,
    defaultModel: provider.defaultModel,
    apiKeySaved: Boolean(provider.apiKeySaved)
  };
}

function missingProviderResult(gate, providerKind, operation, mask = false) {
  return {
    gate,
    providerKind,
    model: null,
    operation,
    routeSelection: "crossgen-auto",
    resolvedRoute: null,
    inputImageCount: operation === "text-to-image" ? 0 : 1,
    mask,
    timeoutSeconds: Math.round(timeoutMs / 1000),
    attemptCount: 0,
    elapsedSeconds: 0,
    result: "blocker",
    outputCount: 0,
    diagnosticCategory: "config_missing",
    errorSummary: `No enabled saved ${providerKind} provider configuration was found for this required gate.`,
    userVisibleNextActions: ["Configure a matching provider in CrossGen, then rerun the real provider gate."]
  };
}

function dryRunResult(gate) {
  return {
    gate: gate.id,
    providerKind: gate.providerKind,
    model: gate.model || null,
    operation: gate.operation,
    routeSelection: "crossgen-auto",
    resolvedRoute: null,
    inputImageCount: gate.inputImageCount,
    mask: gate.mask,
    timeoutSeconds: Math.round(timeoutMs / 1000),
    attemptCount: 0,
    elapsedSeconds: 0,
    result: "dry-run",
    outputCount: 0,
    diagnosticCategory: null,
    errorSummary: null,
    userVisibleNextActions: ["Rerun with CROSSGEN_REAL_PROVIDER_ACCEPT_COST=1 to submit this paid gate."]
  };
}
