import { describe, expect, it } from "vitest";
import { buildCrossGenCliLaunchPlan } from "./crossgen";

function existsAt(paths: string[]) {
  const existing = new Set(paths);
  return (path: string) => existing.has(path);
}

describe("crossgen binary launcher", () => {
  it("forwards CLI commands through a local Electron runtime", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--version", "--json"],
      env: {},
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt(["/repo/crossgen/node_modules/.bin/electron"])
    });

    expect(plan).toMatchObject({
      command: "/repo/crossgen/node_modules/.bin/electron",
      args: ["/repo/crossgen", "--cli", "--version", "--json"],
      source: "local-electron"
    });
  });

  it("starts MCP mode without adding the CLI sentinel", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--mcp"],
      env: {},
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt(["/repo/crossgen/node_modules/.bin/electron"])
    });

    expect(plan.args).toEqual(["/repo/crossgen", "--mcp"]);
  });

  it("maps --data-dir to both current and legacy runtime env aliases", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["--data-dir", "/tmp/crossgen-agent", "doctor", "--agent", "--json"],
      env: {},
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt(["/repo/crossgen/node_modules/.bin/electron"])
    });

    expect(plan.env.CROSSGEN_DATA_DIR).toBe("/tmp/crossgen-agent");
    expect(plan.env.CROSSGEN_USER_DATA_DIR).toBe("/tmp/crossgen-agent");
    expect(plan.args).toEqual(["/repo/crossgen", "--cli", "doctor", "--agent", "--json"]);
  });

  it("prefers an explicit installed app executable over Electron", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["models", "list", "--json"],
      env: {
        CROSSGEN_APP_EXECUTABLE: " /Applications/CrossGen.app/Contents/MacOS/CrossGen "
      },
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt(["/repo/crossgen/node_modules/.bin/electron"])
    });

    expect(plan).toMatchObject({
      command: "/Applications/CrossGen.app/Contents/MacOS/CrossGen",
      args: ["--cli", "models", "list", "--json"],
      source: "env-app"
    });
  });

  it("uses CROSSGEN_ELECTRON_BIN before repository and installed app discovery", () => {
    const plan = buildCrossGenCliLaunchPlan({
      argv: ["config", "status", "--json"],
      env: {
        CROSSGEN_ELECTRON_BIN: "/custom/electron"
      },
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt([])
    });

    expect(plan).toMatchObject({
      command: "/custom/electron",
      args: ["/repo/crossgen", "--cli", "config", "status", "--json"],
      source: "env-electron"
    });
  });

  it("throws a direct setup hint when no runtime can be found", () => {
    expect(() => buildCrossGenCliLaunchPlan({
      argv: ["--version", "--json"],
      env: {},
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt([])
    })).toThrow(/pnpm install|CROSSGEN_ELECTRON_BIN|CROSSGEN_APP_EXECUTABLE/);
  });

  it("requires a value for --data-dir", () => {
    expect(() => buildCrossGenCliLaunchPlan({
      argv: ["--data-dir"],
      env: {},
      platform: "darwin",
      packageRoot: "/repo/crossgen",
      fileExists: existsAt(["/repo/crossgen/node_modules/.bin/electron"])
    })).toThrow("Missing value for --data-dir.");
  });
});
