// @vitest-environment node
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/verify-release-evidence.mjs");
const execFileAsync = promisify(execFile);
const checklistFiles = ["CHECKLIST.md", "MULTI_MODEL_CHECKLIST.md", "docs/release/v0.3.0-preflight.md"];

async function run(args, options = {}) {
  try {
    const result = await execFileAsync("node", [scriptPath, ...args], options);
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return {
        exitCode: Number(error.code),
        stdout: "stdout" in error ? String(error.stdout ?? "") : "",
        stderr: "stderr" in error ? String(error.stderr ?? "") : ""
      };
    }
    throw error;
  }
}

function passedEvidence(summary) {
  return {
    verifiedAt: "2026-06-09T12:00:00.000Z",
    commit: "d40a84ebf7e66fe2509546d4fff7fe8cdbe972f9",
    environment: "CI fixture",
    commands: ["pnpm verify:mock-api"],
    references: [{ label: "GitHub Actions run", url: "https://github.com/Bliveren/image2tools/actions/runs/1" }],
    artifacts: [{ kind: "local-directory", path: "real-api-artifacts/", public: false, description: "Ignored verifier output." }],
    summary
  };
}

function completeLedger() {
  const gateIds = [
    "real-openai-api",
    "real-gemini-api",
    "macos-signed",
    "macos-notarized",
    "windows-native-release",
    "linux-native-release",
    "update-manifest-assets"
  ];
  return {
    schemaVersion: 1,
    releaseVersion: "0.3.0",
    lastUpdated: "2026-06-09T12:00:00.000Z",
    gates: gateIds.map((id) => ({
      id,
      title: `Fixture ${id}`,
      required: true,
      status: "passed",
      acceptanceCriteria: [`${id} passed`],
      evidence: passedEvidence(`${id} evidence recorded with redacted values only.`)
    }))
  };
}

describe("release evidence verifier", () => {
  it("validates the staged release evidence ledger", async () => {
    const result = await run([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Release evidence validated: 0/5 required gate(s) passed.");
    expect(result.stdout).toContain(
      "Pending required gate(s): real-openai-api, real-gemini-api, windows-native-release, linux-native-release, update-manifest-assets"
    );
  });

  it("fails --require-complete for the staged release candidate", async () => {
    const result = await run(["--require-complete"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Required release evidence gates are not passed");
    expect(result.stderr).toContain("real-openai-api");
    expect(result.stderr).toContain("update-manifest-assets");
  });

  it("fails --require-complete when a required gate is still pending", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-release-evidence-"));
    try {
      const ledger = completeLedger();
      const pendingGate = ledger.gates.find((gate) => gate.id === "real-openai-api");
      pendingGate.status = "pending";
      pendingGate.evidence = {
        verifiedAt: null,
        commit: null,
        environment: null,
        commands: [],
        references: [{ label: "tracker", url: "https://github.com/Bliveren/image2tools/issues/1" }],
        artifacts: [],
        summary: "Pending real API acceptance."
      };
      const filePath = path.join(tempRoot, "evidence.json");
      await writeFile(filePath, JSON.stringify(ledger, null, 2));

      const result = await run(["--file", filePath, "--require-complete"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Required release evidence gates are not passed");
      expect(result.stderr).toContain("real-openai-api");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a complete redacted evidence ledger", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-release-evidence-"));
    try {
      const filePath = path.join(tempRoot, "evidence.json");
      await writeFile(filePath, JSON.stringify(completeLedger(), null, 2));

      const result = await run(["--file", filePath, "--require-complete"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Release evidence validated: 7/7 required gate(s) passed.");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects secret-looking values in evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-release-evidence-"));
    try {
      const ledger = completeLedger();
      ledger.gates[0].evidence.summary = `Unexpected key ${["sk", "live", "abcdefghijklmnopqrstuvwxyz123456"].join("-")}`;
      const filePath = path.join(tempRoot, "evidence.json");
      await writeFile(filePath, JSON.stringify(ledger, null, 2));

      const result = await run(["--file", filePath]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("OpenAI API key");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects checklist completion before matching evidence passes", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-release-evidence-"));
    try {
      await copyChecklistFixture(tempRoot);
      await copyFile(path.resolve("package.json"), path.join(tempRoot, "package.json"));
      const scriptsDir = path.join(tempRoot, "scripts");
      await mkdir(scriptsDir, { recursive: true });
      await copyFile(scriptPath, path.join(scriptsDir, "verify-release-evidence.mjs"));

      const docsReleaseDir = path.join(tempRoot, "docs", "release");
      await mkdir(docsReleaseDir, { recursive: true });

      // Use a synthetic evidence with macos-notarized still pending.
      const ledger = completeLedger();
      const notarizationGate = ledger.gates.find((gate) => gate.id === "macos-notarized");
      notarizationGate.status = "pending";
      notarizationGate.evidence = {
        verifiedAt: null,
        commit: null,
        environment: null,
        commands: [],
        references: [{ label: "tracker", url: "https://github.com/Bliveren/image2tools/issues/3" }],
        artifacts: [],
        summary: "Pending signing and notarization."
      };
      await writeFile(path.join(docsReleaseDir, "evidence.json"), JSON.stringify(ledger, null, 2));

      const checklistPath = path.join(tempRoot, "docs", "release", "v0.3.0-preflight.md");
      const checklist = await readFile(checklistPath, "utf8");
      await writeFile(
        checklistPath,
        checklist.replace(
          "- [ ] Record Apple notarization status from actual notarization output.",
          "- [x] Record Apple notarization status from actual notarization output."
        )
      );

      const result = await run([], { cwd: tempRoot });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Record Apple notarization status from actual notarization output.");
      expect(result.stderr).toContain("macos-notarized");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

async function copyChecklistFixture(tempRoot) {
  for (const file of checklistFiles) {
    await mkdir(path.dirname(path.join(tempRoot, file)), { recursive: true });
    await copyFile(path.resolve(file), path.join(tempRoot, file));
  }
}
