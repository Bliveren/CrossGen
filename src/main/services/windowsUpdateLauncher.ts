import { spawn } from "node:child_process";

interface LaunchWindowsInstallerOptions {
  appQuit?: () => void;
  currentPid?: number;
  executablePath?: string;
  helperCwd?: string;
  powerShellPath?: string;
  spawnImpl?: typeof spawn;
  setTimeoutImpl?: (callback: () => void, ms: number) => unknown;
  waitSeconds?: number;
}

interface WindowsUpdateCommandOptions {
  currentPid: number;
  executablePath: string;
  installerPath: string;
  waitSeconds?: number;
}

const DEFAULT_PROCESS_EXIT_WAIT_SECONDS = 120;

export function buildWindowsUpdatePowerShellCommand({
  currentPid,
  executablePath,
  installerPath,
  waitSeconds = DEFAULT_PROCESS_EXIT_WAIT_SECONDS
}: WindowsUpdateCommandOptions): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Wait-Process -Id ${currentPid} -Timeout ${waitSeconds}`,
    `$installer = ${quotePowerShellString(installerPath)}`,
    `$app = ${quotePowerShellString(executablePath)}`,
    `$deadline = (Get-Date).AddSeconds(${waitSeconds})`,
    "do {",
    "  $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $app })",
    "  if ($running.Count -eq 0) { break }",
    "  Start-Sleep -Milliseconds 500",
    "} while ((Get-Date) -lt $deadline)",
    "$process = Start-Process -FilePath $installer -ArgumentList @('/S', '--updated') -WindowStyle Hidden -Wait -PassThru",
    "Start-Process -FilePath $app"
  ].join("; ");
}

export function launchWindowsInstallerAndRestart(installerPath: string, options: LaunchWindowsInstallerOptions = {}): void {
  const spawnImpl = options.spawnImpl ?? spawn;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const appQuit = options.appQuit;
  const command = buildWindowsUpdatePowerShellCommand({
    installerPath,
    executablePath: options.executablePath ?? process.execPath,
    currentPid: options.currentPid ?? process.pid,
    waitSeconds: options.waitSeconds
  });

  const child = spawnImpl(
    options.powerShellPath ?? "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", command],
    {
      cwd: options.helperCwd ?? process.env.TEMP ?? process.env.SystemRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  child.unref();

  setTimeoutImpl(() => {
    appQuit?.();
  }, 50);
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
