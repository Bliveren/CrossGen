export type WindowsReleaseVerificationMode = "full-install" | "package-smoke";

const modeEnvKey = "IMAGE2TOOLS_WINDOWS_VERIFY_MODE";

const modeAliases = new Map<string, WindowsReleaseVerificationMode>([
  ["full", "full-install"],
  ["full-install", "full-install"],
  ["install", "full-install"],
  ["installer", "full-install"],
  ["package", "package-smoke"],
  ["package-smoke", "package-smoke"],
  ["smoke", "package-smoke"],
  ["ci", "package-smoke"]
]);

export function resolveWindowsReleaseVerificationMode(
  env: Record<string, string | undefined> = {}
): WindowsReleaseVerificationMode {
  const rawMode = env[modeEnvKey]?.trim();
  if (!rawMode) {
    return "full-install";
  }

  const resolvedMode = modeAliases.get(rawMode.toLowerCase());
  if (!resolvedMode) {
    throw new Error(
      `Invalid ${modeEnvKey} value "${rawMode}". Use "full-install" or "package-smoke".`
    );
  }
  return resolvedMode;
}

export function shouldRunSilentInstallCycle(mode: WindowsReleaseVerificationMode): boolean {
  return mode === "full-install";
}
