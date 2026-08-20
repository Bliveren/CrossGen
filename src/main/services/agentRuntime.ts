import { accessSync, constants, existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  AgentActiveProviderStatus,
  AgentCliCommandStatus,
  AgentMcpClientName,
  AgentMcpMode,
  AgentRuntimeStatus
} from "../../shared/types.js";
import { buildCliMcpConfig, buildCliQueueConfig } from "../../cli/readonly.js";

interface BuildAgentRuntimeStatusOptions {
  appVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appExecutable: string;
  resourcesPath: string;
  dataDir: string;
  statePath: string;
  stateFound: boolean;
  activeProvider: AgentActiveProviderStatus | null;
  apiKeyAvailable: boolean;
  liveWorkerHosts: number;
  queueConfig: ReturnType<typeof buildCliQueueConfig>;
  envPath?: string;
  homeDir?: string;
}

interface PathCommandCandidate {
  path: string;
  target: string | null;
  broken: boolean;
}

const MCP_CLIENTS: AgentMcpClientName[] = ["codex", "claude-code", "cursor"];
const MCP_MODES: AgentMcpMode[] = ["readonly", "write", "generate"];

export function buildAgentRuntimeStatus(options: BuildAgentRuntimeStatusOptions): AgentRuntimeStatus {
  const runtimeKind = options.isPackaged ? "packaged" : "development";
  const launcherPath = runtimeKind === "packaged" ? packagedCliLauncherPath(options.resourcesPath, options.platform) : null;
  const launcherExists = Boolean(launcherPath && fileExecutable(launcherPath, options.platform));
  const pathEntries = pathEntriesFromEnv(options.envPath);
  const commandCandidate = findCrossgenOnPath(pathEntries, options.platform);
  const status = resolveCliStatus({
    runtimeKind,
    commandCandidate,
    launcherPath,
    launcherExists,
    platform: options.platform
  });
  const cliPrefix = preferredCliPrefix({
    status,
    commandCandidate,
    launcherPath,
    launcherExists,
    appExecutable: options.appExecutable,
    platform: options.platform
  });
  const linkCommand = buildLinkCommand(launcherPath, options.homeDir, options.platform);
  const unlinkCommand = buildUnlinkCommand(options.homeDir, options.platform);
  const repairHint = cliRepairHint(status);

  return {
    schemaVersion: 1,
    appVersion: options.appVersion,
    runtimeKind,
    cliExecutable: options.appExecutable,
    mcpCommand: options.appExecutable,
    recommendedArgs: ["--mcp"],
    appExecutable: options.appExecutable,
    packagedExecutable: options.isPackaged ? options.appExecutable : null,
    dataDir: options.dataDir,
    statePath: options.statePath,
    stateFound: options.stateFound,
    activeProvider: options.activeProvider,
    apiKeyAvailable: options.apiKeyAvailable,
    liveWorkerHost: options.liveWorkerHosts > 0,
    liveWorkerHosts: options.liveWorkerHosts,
    queueConfig: options.queueConfig,
    cli: {
      commandName: "crossgen",
      status,
      commandPath: commandCandidate?.path ?? null,
      commandTarget: commandCandidate?.target ?? null,
      launcherPath,
      launcherExists,
      pathEntryCount: pathEntries.length,
      linkCommand,
      unlinkCommand,
      repairHint
    },
    mcp: {
      command: options.appExecutable,
      args: ["--mcp"],
      defaultMode: "readonly",
      configs: MCP_CLIENTS.flatMap((client) =>
        MCP_MODES.map((mode) => {
          const config = buildCliMcpConfig({ client, mode, command: options.appExecutable });
          return {
            client,
            mode,
            format: config.format,
            json: JSON.stringify(config, null, 2),
            snippet: config.snippet
          };
        })
      )
    },
    commands: {
      version: `${cliPrefix} --version --json`,
      doctor: `${cliPrefix} doctor --agent --json`,
      configStatus: `${cliPrefix} config status --json`,
      modelsList: `${cliPrefix} models list --json`,
      queueStatus: `${cliPrefix} queue status --json`,
      mcpCodexReadonly: `${cliPrefix} mcp config --client codex --mode readonly --json`,
      mcpCodexGenerate: `${cliPrefix} mcp config --client codex --mode generate --json`
    },
    permissions: {
      cliMode: "readonly",
      mcpDefaultMode: "readonly",
      writeModeRequiresExplicitEnable: true,
      generateModeRequiresExplicitEnable: true,
      paidGenerationRequiresConfirmation: true,
      pathDisclosureRequiresConfirmation: true
    },
    knownLimitations: [
      "MCP hosts should call the current CrossGen app executable directly with --mcp; they do not need the CLI link.",
      "The packaged CLI launcher does not require Node.js, npm, pnpm, or a global package.",
      "PATH detection only reports the environment visible to the current CrossGen process.",
      "Async generation requires a live worker host: the desktop app, MCP generate mode, or a waiting CLI worker.",
      "Without a live worker, queued async generation returns NO_LIVE_QUEUE_WORKER instead of pretending it will continue in the background.",
      "CLI --wait executes the queued job in the current process; MCP generate mode can keep a worker alive and supports short waitMs completion waits.",
      "Generate mode can submit paid provider requests and requires explicit confirmation."
    ],
    nextActions: nextActionsForStatus(status)
  };
}

function packagedCliLauncherPath(resourcesPath: string, platform: NodeJS.Platform): string {
  return path.join(resourcesPath, "cli", platform === "win32" ? "crossgen.cmd" : "crossgen");
}

function pathEntriesFromEnv(envPath = ""): string[] {
  return envPath.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function executableNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["crossgen.cmd", "crossgen.exe", "crossgen"] : ["crossgen"];
}

function findCrossgenOnPath(pathEntries: string[], platform: NodeJS.Platform): PathCommandCandidate | null {
  for (const directory of pathEntries) {
    for (const name of executableNames(platform)) {
      const candidate = path.join(directory, name);
      const inspected = inspectPathCommand(candidate, platform);
      if (inspected) return inspected;
    }
  }
  return null;
}

function inspectPathCommand(candidate: string, platform: NodeJS.Platform): PathCommandCandidate | null {
  try {
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink()) {
      const rawTarget = readlinkSync(candidate);
      const target = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(path.dirname(candidate), rawTarget);
      return { path: candidate, target, broken: !existsSync(target) };
    }
    if (!fileExecutable(candidate, platform)) return null;
    return { path: candidate, target: candidate, broken: false };
  } catch {
    return null;
  }
}

function fileExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    accessSync(filePath, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCliStatus(input: {
  runtimeKind: AgentRuntimeStatus["runtimeKind"];
  commandCandidate: PathCommandCandidate | null;
  launcherPath: string | null;
  launcherExists: boolean;
  platform: NodeJS.Platform;
}): AgentCliCommandStatus {
  if (input.runtimeKind === "development") return "development";
  if (!input.launcherExists) return "launcher-missing";
  if (!input.commandCandidate) return "not-found";
  if (input.commandCandidate.broken) return "stale";
  if (input.launcherPath && sameFile(input.commandCandidate.target ?? input.commandCandidate.path, input.launcherPath, input.platform)) {
    return "ready";
  }
  return "custom";
}

function sameFile(left: string, right: string, platform: NodeJS.Platform): boolean {
  const leftResolved = realPathOrSelf(left);
  const rightResolved = realPathOrSelf(right);
  return normalizePathForCompare(leftResolved, platform) === normalizePathForCompare(rightResolved, platform);
}

function realPathOrSelf(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function normalizePathForCompare(filePath: string, platform: NodeJS.Platform): string {
  const normalized = path.normalize(filePath);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function preferredCliPrefix(input: {
  status: AgentCliCommandStatus;
  commandCandidate: PathCommandCandidate | null;
  launcherPath: string | null;
  launcherExists: boolean;
  appExecutable: string;
  platform: NodeJS.Platform;
}): string {
  if (input.status === "ready") return "crossgen";
  if (input.launcherPath && input.launcherExists) return quoteShellArg(input.launcherPath, input.platform);
  return `${quoteShellArg(input.appExecutable, input.platform)} --cli`;
}

function buildLinkCommand(launcherPath: string | null, homeDir: string | undefined, platform: NodeJS.Platform): string | null {
  if (!launcherPath || platform === "win32") return null;
  const target = homeDir ? path.join(homeDir, ".local", "bin", "crossgen") : "~/.local/bin/crossgen";
  return `mkdir -p ${quoteShellArg(path.dirname(target), platform)} && ln -sfn ${quoteShellArg(launcherPath, platform)} ${quoteShellArg(target, platform)}`;
}

function buildUnlinkCommand(homeDir: string | undefined, platform: NodeJS.Platform): string | null {
  if (platform === "win32") return null;
  const target = homeDir ? path.join(homeDir, ".local", "bin", "crossgen") : "~/.local/bin/crossgen";
  return `rm ${quoteShellArg(target, platform)}`;
}

function quoteShellArg(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cliRepairHint(status: AgentCliCommandStatus): string {
  switch (status) {
    case "ready":
      return "`crossgen` resolves to the packaged launcher for this CrossGen install.";
    case "development":
      return "Development runtime detected. Use the app executable with --cli, or build/package before validating the no-Node launcher.";
    case "launcher-missing":
      return "The packaged CLI launcher was not found in the current app resources.";
    case "not-found":
      return "`crossgen` was not found on PATH. MCP can still call the app executable directly.";
    case "stale":
      return "`crossgen` appears to be a broken link. Recreate it from the current app location.";
    case "custom":
      return "`crossgen` exists on PATH but does not point to the current packaged launcher.";
  }
}

function nextActionsForStatus(status: AgentCliCommandStatus): string[] {
  const common = [
    "Use the MCP config command for the target agent client and selected permission mode.",
    "Use generate mode only when the agent should be allowed to submit paid image work."
  ];
  if (status === "ready" || status === "custom") return common;
  if (status === "development") {
    return [
      "Run pnpm build:main before using the repository CLI wrapper in development.",
      "Validate packaged no-Node CLI behavior from a packaged candidate before release.",
      ...common
    ];
  }
  return [
    "Copy the repair command if you want a global `crossgen` shell command.",
    "MCP setup can skip PATH and call the current app executable directly with --mcp.",
    ...common
  ];
}
