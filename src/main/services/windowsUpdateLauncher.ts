import { spawn, type ChildProcess } from "node:child_process";

interface LaunchWindowsInstallerOptions {
  helperCwd?: string;
  installerArgs?: string[];
  spawnImpl?: typeof spawn;
}

export async function launchWindowsInstaller(installerPath: string, options: LaunchWindowsInstallerOptions = {}): Promise<void> {
  const spawnImpl = options.spawnImpl ?? spawn;
  const installerArgs = options.installerArgs ?? [];
  let child: ChildProcess;

  try {
    child = spawnImpl(installerPath, installerArgs, {
      cwd: options.helperCwd ?? process.env.TEMP ?? process.env.SystemRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
  } catch (error) {
    throw new Error(`无法启动 Windows 更新安装程序：${errorMessage(error)}`);
  }

  await waitForChildProcessSpawn(child);
  child.unref();
}

function waitForChildProcessSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      child.off("spawn", handleSpawn);
      child.off("error", handleError);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleSpawn = () => settle(resolve);
    const handleError = (error: Error) => settle(() => reject(new Error(`无法启动 Windows 更新安装程序：${errorMessage(error)}`)));

    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
