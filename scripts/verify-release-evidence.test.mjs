// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/verify-release-evidence.mjs");
const execFileAsync = promisify(execFile);

async function run(args) {
  try {
    const result = await execFileAsync("node", [scriptPath, ...args]);
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
    "macos-signed-notarized",
    "windows-native-release",
    "linux-native-release",
    "update-manifest-assets"
  ];
  return {
    schemaVersion: 1,
    releaseVersion: "0.2.0",
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
  it("validates the staged release evidence ledger with pending gates", async () => {
    const result = await run([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Release evidence validated: 0/6 required gate(s) passed.");
    expect(result.stdout).toContain("real-openai-api");
  });

  it("requires all release evidence gates when requested", async () => {
    const result = await run(["--require-complete"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Required release evidence gates are not passed");
  });

  it("accepts a complete redacted evidence ledger", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-release-evidence-"));
    try {
      const filePath = path.join(tempRoot, "evidence.json");
      await writeFile(filePath, JSON.stringify(completeLedger(), null, 2));

      const result = await run(["--file", filePath, "--require-complete"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Release evidence validated: 6/6 required gate(s) passed.");
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
});
