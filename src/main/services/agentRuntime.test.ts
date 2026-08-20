import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentRuntimeStatus } from "./agentRuntime.js";

const queueConfig = {
  maxGlobalRunning: 1,
  providerConcurrency: {}
};

function options(root: string, patch: Record<string, unknown> = {}) {
  const resourcesPath = path.join(root, "resources");
  return {
    appVersion: "0.3.3",
    isPackaged: true,
    platform: "darwin" as NodeJS.Platform,
    appExecutable: path.join(root, "CrossGen.app", "Contents", "MacOS", "CrossGen"),
    resourcesPath,
    dataDir: path.join(root, "data"),
    statePath: path.join(root, "data", "image2tools-state.v1.json"),
    stateFound: true,
    activeProvider: {
      id: "provider-1",
      kind: "openai" as const,
      name: "OpenAI",
      enabled: true,
      activeLaunchId: "gpt-image-2" as const,
      activeModelId: "gpt-image-2"
    },
    apiKeyAvailable: true,
    liveWorkerHosts: 1,
    queueConfig,
    envPath: "",
    homeDir: path.join(root, "home"),
    ...patch
  };
}

describe("agent runtime status", () => {
  it("reports a packaged launcher and a ready PATH link", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgen-agent-runtime-"));
    const launcher = path.join(root, "resources", "cli", "crossgen");
    const link = path.join(root, "home", ".local", "bin", "crossgen");
    await mkdir(path.dirname(launcher), { recursive: true });
    await mkdir(path.dirname(link), { recursive: true });
    await writeFile(launcher, "#!/bin/sh\n", { mode: 0o755 });
    await symlink(launcher, link);

    const status = buildAgentRuntimeStatus(options(root, { envPath: path.dirname(link) }));

    expect(status.runtimeKind).toBe("packaged");
    expect(status.cli.status).toBe("ready");
    expect(status.cli.commandPath).toBe(link);
    expect(status.cli.commandTarget).toBe(launcher);
    expect(status.cli.launcherExists).toBe(true);
    expect(status.mcp.args).toEqual(["--mcp"]);
    expect(status.mcp.configs).toHaveLength(9);
    expect(status.mcp.configs.find((config) => config.client === "codex")?.format).toBe("codex-toml");
    expect(status.mcp.configs.find((config) => config.client === "codex")?.snippet).toContain("[mcp_servers.crossgen]");
    expect(status.mcp.configs.find((config) => config.client === "cursor")?.snippet).toContain("\"mcpServers\"");
    expect(status.queueConfig.maxGlobalRunning).toBe(1);
    expect(status.nextActions.length).toBeGreaterThan(0);
  });

  it("reports a stale link and emits a manual repair command without touching PATH", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgen-agent-runtime-"));
    const launcher = path.join(root, "resources", "cli", "crossgen");
    const link = path.join(root, "home", ".local", "bin", "crossgen");
    await mkdir(path.dirname(launcher), { recursive: true });
    await mkdir(path.dirname(link), { recursive: true });
    await writeFile(launcher, "#!/bin/sh\n", { mode: 0o755 });
    await symlink(path.join(root, "missing", "crossgen"), link);

    const status = buildAgentRuntimeStatus(options(root, { envPath: path.dirname(link) }));

    expect(status.cli.status).toBe("stale");
    expect(status.cli.linkCommand).toContain("ln -sfn");
    expect(status.cli.linkCommand).toContain(launcher);
    expect(status.cli.repairHint).toContain("broken link");
  });

  it("keeps development mode explicit and still exposes direct MCP configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgen-agent-runtime-"));
    const status = buildAgentRuntimeStatus(options(root, {
      isPackaged: false,
      envPath: "",
      liveWorkerHosts: 0
    }));

    expect(status.runtimeKind).toBe("development");
    expect(status.cli.status).toBe("development");
    expect(status.cli.launcherPath).toBeNull();
    expect(status.liveWorkerHost).toBe(false);
    expect(status.nextActions.join("\n")).toContain("pnpm build:main");
    expect(status.mcp.configs.find((config) => config.client === "cursor" && config.mode === "generate")?.snippet).toContain("--mcp");
  });
});
