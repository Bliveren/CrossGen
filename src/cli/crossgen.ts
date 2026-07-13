#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CrossGenCliLaunchPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  source: "env-app" | "env-electron" | "local-electron" | "installed-app";
}

export interface CrossGenCliLaunchOptions {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  packageRoot?: string;
  fileExists?: (path: string) => boolean;
}

interface ParsedCrossGenArgs {
  args: string[];
  dataDir?: string;
  mcpMode: boolean;
}

function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function parseCrossGenArgs(argv: string[]): ParsedCrossGenArgs {
  const args: string[] = [];
  let dataDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --data-dir.");
      dataDir = value;
      index += 1;
      continue;
    }
    args.push(arg);
  }
  return {
    args,
    dataDir,
    mcpMode: args[0] === "--mcp"
  };
}

function commandIfExists(path: string, fileExists: (path: string) => boolean): string | null {
  return fileExists(path) ? path : null;
}

function localElectronCommand(packageRoot: string, platform: NodeJS.Platform, fileExists: (path: string) => boolean): string | null {
  const executable = platform === "win32" ? "electron.cmd" : "electron";
  return commandIfExists(join(packageRoot, "node_modules", ".bin", executable), fileExists);
}

function installedAppCommands(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return ["/Applications/CrossGen.app/Contents/MacOS/CrossGen"];
  }
  if (platform === "win32") {
    return [
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "crossgen", "CrossGen.exe") : "",
      env.ProgramFiles ? join(env.ProgramFiles, "crossgen", "CrossGen.exe") : "",
      env["ProgramFiles(x86)"] ? join(env["ProgramFiles(x86)"]!, "crossgen", "CrossGen.exe") : ""
    ].filter(Boolean);
  }
  return ["/usr/bin/crossgen", "/usr/local/bin/crossgen", "/opt/CrossGen/crossgen"].filter((candidate) => candidate !== process.argv[1]);
}

export function buildCrossGenCliLaunchPlan(options: CrossGenCliLaunchOptions): CrossGenCliLaunchPlan {
  const env = { ...(options.env ?? process.env) };
  const platform = options.platform ?? process.platform;
  const packageRoot = options.packageRoot ?? defaultPackageRoot();
  const fileExists = options.fileExists ?? existsSync;
  const parsed = parseCrossGenArgs(options.argv);
  if (parsed.dataDir) {
    env.CROSSGEN_DATA_DIR = parsed.dataDir;
    env.CROSSGEN_USER_DATA_DIR = parsed.dataDir;
  }

  const forwardedArgs = parsed.mcpMode ? parsed.args : ["--cli", ...parsed.args];
  if (env.CROSSGEN_APP_EXECUTABLE?.trim()) {
    return {
      command: env.CROSSGEN_APP_EXECUTABLE.trim(),
      args: forwardedArgs,
      env,
      source: "env-app"
    };
  }
  if (env.CROSSGEN_ELECTRON_BIN?.trim()) {
    return {
      command: env.CROSSGEN_ELECTRON_BIN.trim(),
      args: [packageRoot, ...forwardedArgs],
      env,
      source: "env-electron"
    };
  }

  const electron = localElectronCommand(packageRoot, platform, fileExists);
  if (electron) {
    return {
      command: electron,
      args: [packageRoot, ...forwardedArgs],
      env,
      source: "local-electron"
    };
  }

  for (const candidate of installedAppCommands(env, platform)) {
    if (commandIfExists(candidate, fileExists)) {
      return {
        command: candidate,
        args: forwardedArgs,
        env,
        source: "installed-app"
      };
    }
  }

  throw new Error(
    "CrossGen CLI could not find an Electron runtime or installed CrossGen app. Run from the repository after pnpm install, set CROSSGEN_ELECTRON_BIN, or set CROSSGEN_APP_EXECUTABLE."
  );
}

export async function runCrossGenCli(argv = process.argv.slice(2)): Promise<number> {
  let plan: CrossGenCliLaunchPlan;
  try {
    plan = buildCrossGenCliLaunchPlan({ argv });
  } catch (error) {
    process.stderr.write(`crossgen failed to prepare: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      stdio: "inherit",
      env: plan.env
    });
    child.on("error", (error) => {
      process.stderr.write(`crossgen failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.stderr.write(`crossgen exited due to signal ${signal}\n`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCrossGenCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
