#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultEvidenceFile = "docs/release/evidence.json";
const allowedStatuses = new Set(["pending", "passed", "failed", "blocked"]);
const requiredGateIds = [
  "real-openai-api",
  "real-gemini-api",
  "macos-signed-notarized",
  "windows-native-release",
  "linux-native-release",
  "update-manifest-assets"
];
const checklistGuards = [
  {
    file: "TODO.md",
    text: "用真实 API Key 做一次实际生成、编辑、局部重绘手工验收",
    gateIds: ["real-openai-api"]
  },
  {
    file: "TODO.md",
    text: "用真实 Gemini Key 完成 Nano Banana 3 生成、参考图编辑、局部引导编辑和下载/历史验收",
    gateIds: ["real-gemini-api"]
  },
  {
    file: "TODO.md",
    text: "完成签名、公证并补充正式分发资产 URL / hash / size 证据",
    gateIds: ["macos-signed-notarized", "update-manifest-assets"]
  },
  {
    file: "TODO.md",
    text: "非 macOS 平台安装验证；Windows 与原生 Linux 桌面 shell 行为仍待验证",
    gateIds: ["windows-native-release", "linux-native-release"]
  },
  {
    file: "CHECKLIST.md",
    text: "文本提示可成功出图（需真实 API Key 手工验收）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "单图编辑可用（需真实 API Key 手工验收）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "多图参考编辑可用（需真实 API Key 手工验收）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "局部重绘可用（需真实 API Key 手工验收）",
    gateIds: ["real-openai-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "Windows 原生安装与启动验证完成",
    gateIds: ["windows-native-release"]
  },
  {
    file: "CHECKLIST.md",
    text: "Linux 原生桌面 AppImage 直接运行、下载、打开文件夹行为验证完成",
    gateIds: ["linux-native-release"]
  },
  {
    file: "CHECKLIST.md",
    text: "Gemini / Nano Banana 3 真实 API 验收完成（已有受成本保护 verifier，仍需真实 Key 跑通并记录证据）",
    gateIds: ["real-gemini-api"]
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
    file: "CHECKLIST.md",
    text: "真实 OpenAI / Gemini 外部验收完成",
    gateIds: ["real-openai-api", "real-gemini-api"]
  },
  {
    file: "CHECKLIST.md",
    text: "正式更新 manifest 已补充分发资产 URL、hash 和 size",
    gateIds: ["update-manifest-assets"]
  },
  {
    file: "MULTI_MODEL_CHECKLIST.md",
    text: "`v0.2.0` 发布前完成至少一轮真实 OpenAI / Gemini API 外部验收",
    gateIds: ["real-openai-api", "real-gemini-api"]
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

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-release-evidence.mjs [--file <path>] [--require-complete]",
    "",
    "Validates docs/release/evidence.json. By default pending required gates are allowed.",
    "Use --require-complete before publishing a release."
  ].join("\n");
}

function parseArgs(argv) {
  const args = { file: defaultEvidenceFile, requireComplete: false };
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

function validateLedger(ledger, packageJson, { requireComplete }) {
  assertObject(ledger, "release evidence");
  if (ledger.schemaVersion !== 1) {
    throw new Error("release evidence schemaVersion must be 1.");
  }
  assertNonEmptyString(ledger.releaseVersion, "release evidence releaseVersion");
  if (ledger.releaseVersion !== packageJson.version) {
    throw new Error(`release evidence releaseVersion ${ledger.releaseVersion} does not match package version ${packageJson.version}.`);
  }
  assertIsoTimestamp(ledger.lastUpdated, "release evidence lastUpdated");
  if (!Array.isArray(ledger.gates)) {
    throw new Error("release evidence gates must be an array.");
  }

  const gatesById = new Map();
  for (const [index, gate] of ledger.gates.entries()) {
    const label = `release evidence gates[${index}]`;
    assertObject(gate, label);
    assertNonEmptyString(gate.id, `${label}.id`);
    if (gatesById.has(gate.id)) {
      throw new Error(`Duplicate release evidence gate id: ${gate.id}`);
    }
    if (!requiredGateIds.includes(gate.id)) {
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

  const missingGateIds = requiredGateIds.filter((id) => !gatesById.has(id));
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

async function validateChecklistAlignment(gatesById) {
  const fileCache = new Map();
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
  const ledger = await readJson(evidencePath);
  const result = validateLedger(ledger, packageJson, { requireComplete: args.requireComplete });
  await validateChecklistAlignment(result.gatesById);

  console.log(`Release evidence validated: ${result.passedRequiredCount}/${result.requiredCount} required gate(s) passed.`);
  if (result.incompleteRequiredGates.length > 0) {
    console.log(`Pending required gate(s): ${result.incompleteRequiredGates.map((gate) => gate.id).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
