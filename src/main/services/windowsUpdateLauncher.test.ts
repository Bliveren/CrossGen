import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { launchWindowsInstaller } from "./windowsUpdateLauncher";

describe("Windows update launcher", () => {
  it("opens the installer visibly without quitting the current app", async () => {
    const child = mockChildProcess();
    const spawnImpl = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const pending = launchWindowsInstaller("C:\\updates\\CrossGen-Setup.exe", {
      helperCwd: "C:\\Temp",
      spawnImpl
    });

    child.emit("spawn");
    await pending;

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\updates\\CrossGen-Setup.exe",
      [],
      { cwd: "C:\\Temp", detached: true, stdio: "ignore", windowsHide: false }
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it("passes optional installer arguments to the visible installer", async () => {
    const child = mockChildProcess();
    const spawnImpl = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const pending = launchWindowsInstaller("C:\\updates\\CrossGen-Setup.exe", {
      installerArgs: ["/currentuser"],
      spawnImpl
    });

    child.emit("spawn");
    await pending;

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\updates\\CrossGen-Setup.exe",
      ["/currentuser"],
      expect.objectContaining({ detached: true, windowsHide: false })
    );
  });

  it("rejects when Windows cannot start the installer", async () => {
    const child = mockChildProcess();
    const spawnImpl = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const pending = launchWindowsInstaller("C:\\updates\\CrossGen-Setup.exe", { spawnImpl });

    child.emit("error", new Error("blocked by policy"));

    await expect(pending).rejects.toThrow("blocked by policy");
    expect(child.unref).not.toHaveBeenCalled();
  });
});

function mockChildProcess() {
  const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  child.unref = vi.fn();
  return child;
}
