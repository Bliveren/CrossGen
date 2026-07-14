#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultEvidenceFile = "docs/release/evidence.json";
const allowedStatuses = new Set(["pending", "passed", "failed", "blocked"]);
// Gates that must exist in the ledger. Whether each blocks release readiness is
// driven by its own `required` flag in the evidence file, not by this list.
// macOS signing and notarization are tracked separately so a Developer ID signed
// artifact is not misreported as Apple-notarized.
const baseGateIds = [
  "real-openai-api",
  "real-gemini-api",
  "macos-signed",
  "macos-notarized",
  "windows-native-release",
  "linux-native-release",
  "update-manifest-assets"
];

const v031GateIds = [
  "product-owner-acceptance",
  "build-and-mock-verifiers",
  "cli-mcp-packaged-smoke",
  "agent-integration-smoke",
  "queue-concurrency-smoke",
  "gallery-mutation-smoke",
  "image-core-regression"
];

const v030ChecklistGuards = [
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Build signed macOS assets.",
    gateIds: ["macos-signed"]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Record Apple notarization status from actual notarization output.",
    gateIds: ["macos-notarized"]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Produce and validate Windows assets on native Windows.",
    gateIds: ["windows-native-release"]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Update `docs/updates/latest.json` using uploaded asset hash and size.",
    gateIds: ["update-manifest-assets"]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Update `docs/release/evidence.json` using actual release evidence.",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets"
    ]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Run all required verifiers, including release evidence with",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets"
    ]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Create and push `v0.3.0` tag.",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets"
    ]
  },
  {
    file: "docs/release/v0.3.0-preflight.md",
    text: "Create GitHub Release with assets matching the update manifest.",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets"
    ]
  }
];

const v031ChecklistGuards = [
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Obtain explicit product-owner approval after local installable package testing.",
    gateIds: ["product-owner-acceptance"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run `pnpm build` from the v0.3.1 release branch.",
    gateIds: ["build-and-mock-verifiers"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run `pnpm verify:mock-api`, `pnpm verify:mock-gemini-api`, and `pnpm verify:mock-model-discovery`.",
    gateIds: ["build-and-mock-verifiers"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run packaged CLI and MCP smoke against the packaged app.",
    gateIds: ["cli-mcp-packaged-smoke"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run agent integration smoke for Codex, Claude Code, and Cursor configuration output.",
    gateIds: ["agent-integration-smoke"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run queue concurrency smoke for default concurrency 1, explicit bounded concurrency 2, and two-host claim safety.",
    gateIds: ["queue-concurrency-smoke"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run Gallery mutation smoke for folder, asset, export, path-confirmation, duplicate, and concurrent mutation behavior.",
    gateIds: ["gallery-mutation-smoke"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run the image core regression checklist for generation, edit, inpaint, partial streaming, provider switching, Gallery, and editor workflows.",
    gateIds: ["image-core-regression"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Complete real OpenAI-compatible GPT Image acceptance.",
    gateIds: ["real-openai-api"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Complete real Gemini-compatible image acceptance.",
    gateIds: ["real-gemini-api"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Build and verify Developer ID signed macOS release assets.",
    gateIds: ["macos-signed"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Record Apple notarization status from actual notarization output.",
    gateIds: ["macos-notarized"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Produce and validate native Windows release assets.",
    gateIds: ["windows-native-release"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Produce and validate Linux release assets through CI.",
    gateIds: ["linux-native-release"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Update public release assets and `docs/updates/latest.json` from exact artifact hashes and sizes.",
    gateIds: ["update-manifest-assets"]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Run `pnpm verify:release-evidence -- --require-complete` on the final v0.3.1 release branch.",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "macos-signed",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets",
      "build-and-mock-verifiers",
      "cli-mcp-packaged-smoke",
      "agent-integration-smoke",
      "queue-concurrency-smoke",
      "gallery-mutation-smoke",
      "image-core-regression"
    ]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Create and push `v0.3.1` tag.",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "macos-signed",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets",
      "build-and-mock-verifiers",
      "cli-mcp-packaged-smoke",
      "agent-integration-smoke",
      "queue-concurrency-smoke",
      "gallery-mutation-smoke",
      "image-core-regression"
    ]
  },
  {
    file: "docs/release/v0.3.1-preflight.md",
    text: "Create GitHub Release with assets matching the update manifest.",
    gateIds: [
      "real-openai-api",
      "real-gemini-api",
      "macos-signed",
      "windows-native-release",
      "linux-native-release",
      "update-manifest-assets",
      "build-and-mock-verifiers",
      "cli-mcp-packaged-smoke",
      "agent-integration-smoke",
      "queue-concurrency-smoke",
      "gallery-mutation-smoke",
      "image-core-regression"
    ]
  }
];

const commonChecklistGuards = [
  {
    file: "CHECKLIST.md",
    text: "产品负责人已完成本地安装包实测并明确批准发布",
    gateIds: ["product-owner-acceptance"]
  },
  {
    file: "CHECKLIST.md",
    text: "仅输入 prompt 生成一张图（需真实 API Key）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "输入长 prompt 生成一张图（需真实 API Key）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "上传一张参考图后编辑（需真实 API Key）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "上传多张参考图后编辑（需真实 API Key）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "用 mask 对图局部重绘（需真实 API Key）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "OpenAI Key 可发现 `gpt-image-2`",
    gateIds: ["real-openai-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "OpenAI Key 可完成一次文生图",
    gateIds: ["real-openai-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "OpenAI Key 可完成一次参考图编辑",
    gateIds: ["real-openai-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "OpenAI Key 可完成一次 mask 局部重绘",
    gateIds: ["real-openai-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "Gemini Key 可发现 `gemini-3.1-flash-image`",
    gateIds: ["real-gemini-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "Gemini Key 可完成一次 Nano Banana 3 文生图",
    gateIds: ["real-gemini-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "Gemini Key 可完成一次 Nano Banana 3 参考图编辑",
    gateIds: ["real-gemini-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "Gemini Key 可完成一次 Nano Banana 3 局部引导编辑",
    gateIds: ["real-gemini-api"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "历史中能区分 OpenAI 与 Gemini 任务",
    gateIds: ["real-openai-api", "real-gemini-api"]
  }
];

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function isAtLeastVersion(value, minimum) {
  const current = parseVersion(value);
  const target = parseVersion(minimum);
  if (!current || !target) return false;
  for (const key of ["major", "minor", "patch"]) {
    if (current[key] > target[key]) return true;
    if (current[key] < target[key]) return false;
  }
  return true;
}

function knownGateIdsForRelease(releaseVersion) {
  if (isAtLeastVersion(releaseVersion, "0.3.1")) {
    return [...baseGateIds, ...v031GateIds];
  }
  return baseGateIds;
}

function checklistGuardsForRelease(releaseVersion) {
  if (isAtLeastVersion(releaseVersion, "0.3.1")) {
    return [...v031ChecklistGuards, ...commonChecklistGuards];
  }
  return [...v030ChecklistGuards, ...commonChecklistGuards];
}

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-release-evidence.mjs [--file <path>] [--expected-version <version>] [--require-complete]",
    "",
    "Validates docs/release/evidence.json. By default pending required gates are allowed.",
    "When --expected-version is omitted, package.json version is required.",
    "Use --require-complete before publishing a release."
  ].join("\n");
}

function parseArgs(argv) {
  const args = { file: defaultEvidenceFile, expectedVersion: null, requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--require-complete") {
      args.requireComplete = true;
      continue;
    }
    if (arg === "--file") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --file.\n${usage()}`);
      }
      args.file = value;
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --expected-version.\n${usage()}`);
      }
      args.expectedVersion = value;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}\n${usage()}`);
  }
  return args;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  assertNoSensitiveValues(raw, filePath);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertNoSensitiveValues(raw, filePath) {
  const checks = [
    {
      label: "OpenAI API key",
      pattern: /\bsk-(?:proj-)?(?!mock\b|test\b|\.{3})[A-Za-z0-9_-]{16,}\b/
    },
    {
      label: "Google API key",
      pattern: /\bAIza(?!\.\.\.redacted\b)[A-Za-z0-9_-]{20,}\b/
    },
    {
      label: "GitHub token",
      pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/
    },
    {
      label: "Bearer token",
      pattern: /\bBearer\s+(?!\[?redacted\b)[A-Za-z0-9._~+/=-]{16,}\b/i
    },
    {
      label: "private key block",
      pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
    },
    {
      label: "private home-directory path",
      pattern: /(?:\/Users\/[^/"'\s]+|\/home\/[^/"'\s]+|[A-Za-z]:\\Users\\[^\\/"'\s]+)/
    }
  ];
  for (const check of checks) {
    if (check.pattern.test(raw)) {
      throw new Error(`${filePath} appears to contain a ${check.label}; redact evidence before committing it.`);
    }
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertNullableString(value, label) {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }
}

function assertStringArray(value, label, { requireNonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  if (requireNonEmpty && value.length === 0) {
    throw new Error(`${label} must contain at least one item.`);
  }
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${label}[${index}]`);
  }
}

function assertIsoTimestamp(value, label) {
  assertNonEmptyString(value, label);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
}

function assertCommit(value, label) {
  assertNonEmptyString(value, label);
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full lowercase 40-character git commit SHA.`);
  }
}

function assertHttpsUrl(value, label) {
  assertNonEmptyString(value, label);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
}

function validateReference(reference, label) {
  assertObject(reference, label);
  assertNonEmptyString(reference.label, `${label}.label`);
  assertHttpsUrl(reference.url, `${label}.url`);
}

function validateArtifact(artifact, label) {
  assertObject(artifact, label);
  assertNonEmptyString(artifact.kind, `${label}.kind`);
  if ("path" in artifact) {
    assertNonEmptyString(artifact.path, `${label}.path`);
  }
  if ("url" in artifact) {
    assertHttpsUrl(artifact.url, `${label}.url`);
  }
  if (!("path" in artifact) && !("url" in artifact)) {
    throw new Error(`${label} must include path or url.`);
  }
  if ("public" in artifact && typeof artifact.public !== "boolean") {
    throw new Error(`${label}.public must be a boolean when present.`);
  }
  if ("description" in artifact) {
    assertNonEmptyString(artifact.description, `${label}.description`);
  }
}

function validateEvidence(evidence, label, status) {
  assertObject(evidence, label);
  assertNullableString(evidence.verifiedAt, `${label}.verifiedAt`);
  assertNullableString(evidence.commit, `${label}.commit`);
  assertNullableString(evidence.environment, `${label}.environment`);
  assertStringArray(evidence.commands, `${label}.commands`);
  assertNonEmptyString(evidence.summary, `${label}.summary`);

  if (!Array.isArray(evidence.references)) {
    throw new Error(`${label}.references must be an array.`);
  }
  evidence.references.forEach((reference, index) => validateReference(reference, `${label}.references[${index}]`));

  if (!Array.isArray(evidence.artifacts)) {
    throw new Error(`${label}.artifacts must be an array.`);
  }
  evidence.artifacts.forEach((artifact, index) => validateArtifact(artifact, `${label}.artifacts[${index}]`));

  if (status === "passed") {
    assertIsoTimestamp(evidence.verifiedAt, `${label}.verifiedAt`);
    assertCommit(evidence.commit, `${label}.commit`);
    assertNonEmptyString(evidence.environment, `${label}.environment`);
    assertStringArray(evidence.commands, `${label}.commands`, { requireNonEmpty: true });
  }
}

function validateLedger(ledger, expectedVersion, { requireComplete }) {
  assertObject(ledger, "release evidence");
  if (ledger.schemaVersion !== 1) {
    throw new Error("release evidence schemaVersion must be 1.");
  }
  assertNonEmptyString(ledger.releaseVersion, "release evidence releaseVersion");
  assertNonEmptyString(expectedVersion, "expected release version");
  if (ledger.releaseVersion !== expectedVersion) {
    throw new Error(`release evidence releaseVersion ${ledger.releaseVersion} does not match expected version ${expectedVersion}.`);
  }
  assertIsoTimestamp(ledger.lastUpdated, "release evidence lastUpdated");
  if (!Array.isArray(ledger.gates)) {
    throw new Error("release evidence gates must be an array.");
  }

  const knownGateIds = knownGateIdsForRelease(ledger.releaseVersion);
  const gatesById = new Map();
  for (const [index, gate] of ledger.gates.entries()) {
    const label = `release evidence gates[${index}]`;
    assertObject(gate, label);
    assertNonEmptyString(gate.id, `${label}.id`);
    if (gatesById.has(gate.id)) {
      throw new Error(`Duplicate release evidence gate id: ${gate.id}`);
    }
    if (!knownGateIds.includes(gate.id)) {
      throw new Error(`Unknown release evidence gate id: ${gate.id}`);
    }
    gatesById.set(gate.id, gate);
    assertNonEmptyString(gate.title, `${label}.title`);
    if (typeof gate.required !== "boolean") {
      throw new Error(`${label}.required must be a boolean.`);
    }
    if (!allowedStatuses.has(gate.status)) {
      throw new Error(`${label}.status must be one of: ${[...allowedStatuses].join(", ")}.`);
    }
    assertStringArray(gate.acceptanceCriteria, `${label}.acceptanceCriteria`, { requireNonEmpty: true });
    validateEvidence(gate.evidence, `${label}.evidence`, gate.status);
  }

  const missingGateIds = knownGateIds.filter((id) => !gatesById.has(id));
  if (missingGateIds.length > 0) {
    throw new Error(`Missing required release evidence gate(s): ${missingGateIds.join(", ")}`);
  }

  const incompleteRequiredGates = [...gatesById.values()].filter((gate) => gate.required && gate.status !== "passed");
  if (requireComplete && incompleteRequiredGates.length > 0) {
    throw new Error(`Required release evidence gates are not passed: ${incompleteRequiredGates.map((gate) => gate.id).join(", ")}`);
  }

  return {
    gatesById,
    passedRequiredCount: [...gatesById.values()].filter((gate) => gate.required && gate.status === "passed").length,
    requiredCount: [...gatesById.values()].filter((gate) => gate.required).length,
    incompleteRequiredGates
  };
}

async function validateChecklistAlignment(gatesById, releaseVersion) {
  const fileCache = new Map();
  const checklistGuards = checklistGuardsForRelease(releaseVersion);
  for (const guard of checklistGuards) {
    if (!fileCache.has(guard.file)) {
      fileCache.set(guard.file, await readFile(path.resolve(guard.file), "utf8"));
    }
    const fileText = fileCache.get(guard.file);
    const line = findChecklistLine(fileText, guard.text, guard.file);
    const isChecked = /^-\s+\[x\]\s+/.test(line);
    if (!isChecked) continue;

    const missingGateIds = guard.gateIds.filter((gateId) => gatesById.get(gateId)?.status !== "passed");
    if (missingGateIds.length > 0) {
      throw new Error(
        `${guard.file} marks "${guard.text}" complete before release evidence gate(s) passed: ${missingGateIds.join(", ")}`
      );
    }
  }
}

function findChecklistLine(fileText, text, file) {
  const matches = fileText.split(/\r?\n/).filter((line) => /^-\s+\[[ x]\]\s+/.test(line) && line.includes(text));
  if (matches.length === 0) {
    throw new Error(`${file} is missing guarded checklist item: ${text}`);
  }
  if (matches.length > 1) {
    throw new Error(`${file} has multiple guarded checklist items matching: ${text}`);
  }
  return matches[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidencePath = path.resolve(args.file);
  const packageJson = await readJson(path.resolve("package.json"));
  const expectedVersion = args.expectedVersion ?? packageJson.version;
  const ledger = await readJson(evidencePath);
  const result = validateLedger(ledger, expectedVersion, { requireComplete: args.requireComplete });
  await validateChecklistAlignment(result.gatesById, ledger.releaseVersion);

  console.log(`Release evidence validated: ${result.passedRequiredCount}/${result.requiredCount} required gate(s) passed.`);
  if (result.incompleteRequiredGates.length > 0) {
    console.log(`Pending required gate(s): ${result.incompleteRequiredGates.map((gate) => gate.id).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
