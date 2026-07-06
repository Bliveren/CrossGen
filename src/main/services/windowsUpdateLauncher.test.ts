import { describe, expect, it, vi } from "vitest";
import { buildWindowsUpdatePowerShellCommand, launchWindowsInstallerAndRestart } from "./windowsUpdateLauncher";

describe("Windows update launcher", () => {
  it("waits for the current app process before running the NSIS installer", () => {
    const command = buildWindowsUpdatePowerShellCommand({
      currentPid: 1234,
      executablePath: "C:\\Program Files\\CrossGen\\CrossGen.exe",
      installerPath: "C:\\Users\\Ada\\AppData\\Roaming\\CrossGen\\updates\\CrossGen-Setup.exe",
      waitSeconds: 45
    });

    expect(command).toContain("Wait-Process -Id 1234 -Timeout 45");
    expect(command).toContain("$installer = 'C:\\Users\\Ada\\AppData\\Roaming\\CrossGen\\updates\\CrossGen-Setup.exe'");
    expect(command).toContain("Get-CimInstance Win32_Process");
    expect(command).toContain("$_.ExecutablePath -and $_.ExecutablePath -ieq $app");
    expect(command).toContain("Start-Process -FilePath $installer -ArgumentList @('/S', '--updated')");
    expect(command).toContain("Start-Process -FilePath $app");
  });

  it("quotes single quotes in paths for PowerShell", () => {
    const command = buildWindowsUpdatePowerShellCommand({
      currentPid: 1234,
      executablePath: "C:\\Apps\\CrossGen\\CrossGen.exe",
      installerPath: "C:\\Users\\O'Brien\\updates\\CrossGen-Setup.exe"
    });

    expect(command).toContain("$installer = 'C:\\Users\\O''Brien\\updates\\CrossGen-Setup.exe'");
  });

  it("spawns a detached hidden PowerShell helper and then quits the app", () => {
    const unref = vi.fn();
    const spawnImpl = vi.fn(() => ({ unref })) as unknown as typeof import("node:child_process").spawn;
    const appQuit = vi.fn();
    const setTimeoutImpl = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });

    launchWindowsInstallerAndRestart("C:\\updates\\CrossGen-Setup.exe", {
      appQuit,
      currentPid: 5678,
      executablePath: "C:\\Apps\\CrossGen\\CrossGen.exe",
      helperCwd: "C:\\Temp",
      spawnImpl,
      setTimeoutImpl
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command"]),
      { cwd: "C:\\Temp", detached: true, stdio: "ignore", windowsHide: true }
    );
    const args = spawnImpl.mock.calls[0][1] as string[];
    expect(args.at(-1)).toContain("Wait-Process -Id 5678");
    expect(unref).toHaveBeenCalled();
    expect(setTimeoutImpl).toHaveBeenCalledWith(expect.any(Function), 50);
    expect(appQuit).toHaveBeenCalled();
  });
});
