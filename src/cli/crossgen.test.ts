import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildCrossGenCliLaunchPlan } from "./crossgen";

function existsAt(paths: string[]) {
  const existing = new Set(paths);
  return (path: string) => existing.has(path);
}

const packageRoot = join("repo", "crossgen");
const localElectron = join(packageRoot, "node_modules", ".bin", "electron");
const localWindowsElectron = join(packageRoot, "node_modules", "electron", "dist", "electron.exe");
const localWindowsElectronCmd = join(packageRoot, "node_modules", ".bin", "electron.cmd");

describe("crossgen binary launcher", () => {
  it("forwards CLI commands through a local Electron runtime", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--version", "--json"],
      env: {},
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([localElectron])
    });

    expect(plan).toMatchObject({
      command: localElectron,
      args: [packageRoot, "--cli", "--version", "--json"],
      source: "local-electron"
    });
  });

  it("starts MCP mode without adding the CLI sentinel", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--mcp"],
      env: {},
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([localElectron])
    });

    expect(plan.args).toEqual([packageRoot, "--mcp"]);
  });

  it("prefers the Windows Electron executable over the cmd shim", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--version", "--json"],
      env: {},
      platform: "win32",
      packageRoot,
      fileExists: existsAt([localWindowsElectron, localWindowsElectronCmd])
    });

    expect(plan).toMatchObject({
      command: localWindowsElectron,
      args: [packageRoot, "--cli", "--version", "--json"],
      source: "local-electron"
    });
  });

  it("maps --data-dir to both current and legacy runtime env aliases", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--data-dir", "/tmp/crossgen-agent", "doctor", "--agent", "--json"],
      env: {},
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([localElectron])
    });

    expect(plan.env.CROSSGEN_DATA_DIR).toBe("/tmp/crossgen-agent");
    expect(plan.env.CROSSGEN_USER_DATA_DIR).toBe("/tmp/crossgen-agent");
    expect(plan.args).toEqual([packageRoot, "--cli", "doctor", "--agent", "--json"]);
  });

  it("prefers an explicit installed app executable over Electron", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["models", "list", "--json"],
      env: {
        CROSSGEN_APP_EXECUTABLE: " /Applications/CrossGen.app/Contents/MacOS/CrossGen "
      },
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([localElectron])
    });

    expect(plan).toMatchObject({
      command: "/Applications/CrossGen.app/Contents/MacOS/CrossGen",
      args: ["--cli", "models", "list", "--json"],
      source: "env-app"
    });
  });

  it("passes explicit runtime args before the CLI sentinel for installed apps", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["models", "list", "--json"],
      env: {
        CROSSGEN_APP_EXECUTABLE: "/Applications/CrossGen.app/Contents/MacOS/CrossGen",
        CROSSGEN_APP_EXTRA_ARGS: "--no-sandbox"
      },
      platform: "linux",
      packageRoot,
      fileExists: existsAt([localElectron])
    });

    expect(plan.args).toEqual(["--no-sandbox", "--cli", "models", "list", "--json"]);
  });

  it("parses JSON runtime args for local Electron command mode", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--version", "--json"],
      env: {
        CROSSGEN_APP_EXTRA_ARGS: "[\"--no-sandbox\",\"--disable-gpu\"]"
      },
      platform: "linux",
      packageRoot,
      fileExists: existsAt([localElectron])
    });

    expect(plan.args).toEqual(["--no-sandbox", "--disable-gpu", packageRoot, "--cli", "--version", "--json"]);
  });

  it("uses CROSSGEN_ELECTRON_BIN before repository and installed app discovery", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["config", "status", "--json"],
      env: {
        CROSSGEN_ELECTRON_BIN: "/custom/electron"
      },
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([])
    });

    expect(plan).toMatchObject({
      command: "/custom/electron",
      args: [packageRoot, "--cli", "config", "status", "--json"],
      source: "env-electron"
    });
  });

  it("throws a direct setup hint when no runtime can be found", () => {
    expect(() => buildCrossGenCliLaunchPlan({
      argv: ["--version", "--json"],
      env: {},
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([])
    })).toThrow(/pnpm install|CROSSGEN_ELECTRON_BIN|CROSSGEN_APP_EXECUTABLE/);
  });

  it("requires a value for --data-dir", () => {
    expect(() => buildCrossGenCliLaunchPlan({
      argv: ["--data-dir"],
      env: {},
      platform: "darwin",
      packageRoot,
      fileExists: existsAt([localElectron])
    })).toThrow("Missing value for --data-dir.");
  });
});
