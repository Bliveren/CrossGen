#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPnpmShellScript,
  createPnpmWindowsCmdScript,
  createPnpmWindowsPowerShellScript,
  getPackageManagerSpecFromPackageJson,
  withPrependedPath
} from "../dist/shared/electronBuilderPnpm.js";

export async function getPackageManagerSpec(packageJsonPath = path.resolve("package.json")) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return getPackageManagerSpecFromPackageJson(packageJson);
}

export async function createPnpmWrapperScripts(directory, packageManagerSpec, platform = process.platform, fallbackPnpmCommand = "pnpm") {
  await writeFile(path.join(directory, "pnpm"), createPnpmShellScript(packageManagerSpec, fallbackPnpmCommand), { mode: 0o755 });

  if (platform === "win32") {
    await writeFile(path.join(directory, "pnpm.cmd"), createPnpmWindowsCmdScript(packageManagerSpec), "utf8");
    await writeFile(path.join(directory, "pnpm.ps1"), createPnpmWindowsPowerShellScript(packageManagerSpec), "utf8");
  }
}

async function runElectronBuilder(args) {
  const packageManagerSpec = await getPackageManagerSpec();
  const wrapperDir = await mkdtemp(path.join(tmpdir(), "image2tools-pnpm-wrapper-"));
  await createPnpmWrapperScripts(wrapperDir, packageManagerSpec, process.platform, await resolvePnpmFallbackCommand());

  // If CSC_NAME is set and notarize=true requested, inject identity via temp JSON config
  // to avoid shell quoting issues with spaces/parens in the identity string.
  let tempConfigDir = null;
  let finalArgs = [...args];
  const cscName = process.env.CSC_NAME;
  const isNotarize = args.includes("-c.mac.notarize=true");
  if (isNotarize && cscName && !args.some(a => a.startsWith("-c.mac.identity"))) {
    tempConfigDir = await mkdtemp(path.join(tmpdir(), "image2tools-eb-sign-"));
    const configPath = path.join(tempConfigDir, "sign.json");
    await writeFile(configPath, JSON.stringify({ mac: { identity: cscName } }));
    finalArgs = [...args, "--config", configPath];
  }

  try {
    await new Promise((resolve, reject) => {
      const child = spawn("electron-builder", finalArgs, {
        env: withPrependedPath(wrapperDir, process.env, path.delimiter),
        shell: true,
        stdio: "inherit"
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        code === 0 ? resolve() : reject(new Error(`electron-builder exited with code ${code ?? "null"}.`));
      });
    });
  } finally {
    if (tempConfigDir) await rm(tempConfigDir, { force: true, recursive: true });
    await rm(wrapperDir, { force: true, recursive: true });
  }
}

async function resolvePnpmFallbackCommand() {
  const fromPath = await findExecutableOnPath("pnpm");
  return fromPath ?? "pnpm";
}

async function findExecutableOnPath(commandName) {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, commandName);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runElectronBuilder(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
