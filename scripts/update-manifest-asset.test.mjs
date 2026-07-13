// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/update-manifest-asset.mjs");
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

describe("update manifest asset helper", () => {
  it("prints a manifest asset with sha256 and sizeBytes", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-update-asset-"));
    try {
      const artifactPath = path.join(tempRoot, "CrossGen-0.2.0-mac-arm64.dmg");
      const bytes = Buffer.from("signed artifact bytes");
      await writeFile(artifactPath, bytes);

      const result = await run([
        "--file",
        artifactPath,
        "--platform",
        "darwin",
        "--arch",
        "arm64",
        "--url",
        "https://github.com/Bliveren/CrossGen/releases/download/v0.2.0/CrossGen-0.2.0-mac-arm64.dmg"
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        platform: "darwin",
        arch: "arm64",
        url: "https://github.com/Bliveren/CrossGen/releases/download/v0.2.0/CrossGen-0.2.0-mac-arm64.dmg",
        fileName: "CrossGen-0.2.0-mac-arm64.dmg",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.length
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-HTTPS release URLs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image2tools-update-asset-"));
    try {
      const artifactPath = path.join(tempRoot, "CrossGen-Setup.exe");
      await writeFile(artifactPath, "installer");

      const result = await run([
        "--file",
        artifactPath,
        "--platform",
        "win32",
        "--url",
        "http://example.com/CrossGen-Setup.exe"
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("HTTPS");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
