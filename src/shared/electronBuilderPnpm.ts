export function getPackageManagerSpecFromPackageJson(packageJson: unknown): string {
  if (!isRecord(packageJson) || typeof packageJson.packageManager !== "string" || !packageJson.packageManager.startsWith("pnpm@")) {
    throw new Error("package.json must declare packageManager as pnpm@<version> for reproducible packaging.");
  }
  return packageJson.packageManager;
}

export function createPnpmShellScript(packageManagerSpec: string): string {
  return `#!/usr/bin/env sh\nexec corepack ${packageManagerSpec} "$@"\n`;
}

export function createPnpmWindowsCmdScript(packageManagerSpec: string): string {
  return `@echo off\r\ncorepack ${packageManagerSpec} %*\r\n`;
}

export function createPnpmWindowsPowerShellScript(packageManagerSpec: string): string {
  return `#!/usr/bin/env pwsh\r\ncorepack "${packageManagerSpec}" @args\r\nexit $LASTEXITCODE\r\n`;
}

export function withPrependedPath(directory: string, env: Record<string, string | undefined>, delimiter: string): Record<string, string | undefined> {
  const currentPath = env.PATH ?? env.Path ?? "";
  return {
    ...env,
    PATH: currentPath ? `${directory}${delimiter}${currentPath}` : directory
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
