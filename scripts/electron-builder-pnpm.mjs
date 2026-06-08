#!/usr/bin/env node
import { spawn } from "node:child_process";
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

export async function createPnpmWrapperScripts(directory, packageManagerSpec, platform = process.platform) {
  await writeFile(path.join(directory, "pnpm"), createPnpmShellScript(packageManagerSpec), { mode: 0o755 });

  if (platform === "win32") {
    await writeFile(path.join(directory, "pnpm.cmd"), createPnpmWindowsCmdScript(packageManagerSpec), "utf8");
    await writeFile(path.join(directory, "pnpm.ps1"), createPnpmWindowsPowerShellScript(packageManagerSpec), "utf8");
  }
}

async function runElectronBuilder(args) {
  const packageManagerSpec = await getPackageManagerSpec();
  const wrapperDir = await mkdtemp(path.join(tmpdir(), "image2tools-pnpm-wrapper-"));
  await createPnpmWrapperScripts(wrapperDir, packageManagerSpec);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn("electron-builder", args, {
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
    await rm(wrapperDir, { force: true, recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runElectronBuilder(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
