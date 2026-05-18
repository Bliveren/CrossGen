#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dmgPath = path.resolve("release/Image2Tools-0.1.0-mac-arm64.dmg");
const appName = "Image2Tools.app";
const processName = "Image2Tools";
const appExecutable = "Contents/MacOS/Image2Tools";

function assertDarwin() {
  if (process.platform !== "darwin") {
    throw new Error("verify:release:mac can only run on macOS.");
  }
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 10,
    ...options
  });
}

function parseMountPoint(output) {
  const line = output
    .split("\n")
    .find((entry) => entry.includes("Apple_HFS") && entry.includes("/Volumes/"));
  if (!line) {
    throw new Error(`Could not find mounted volume in hdiutil output:\n${output}`);
  }
  const parts = line.split("\t").map((part) => part.trim()).filter(Boolean);
  const mountPoint = parts[parts.length - 1];
  if (!mountPoint?.startsWith("/Volumes/")) {
    throw new Error(`Could not parse mounted volume from hdiutil line: ${line}`);
  }
  return mountPoint;
}

async function attachDmg() {
  const { stdout } = await run("hdiutil", ["attach", "-nobrowse", "-readonly", dmgPath]);
  return parseMountPoint(stdout);
}

async function detachDmg(mountPoint) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await run("hdiutil", ["detach", mountPoint]);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function findPids(pattern) {
  try {
    const { stdout } = await run("pgrep", ["-f", pattern]);
    return stdout
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

async function waitForLaunch(executablePath) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const pids = await findPids(executablePath);
    if (pids.length > 0) {
      return pids;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged app did not launch from ${executablePath}`);
}

async function countWindowsForPid(pid) {
  const script = `tell application "System Events" to return count of windows of (first process whose unix id is ${pid})`;
  const { stdout } = await run("osascript", ["-e", script]);
  return Number(stdout.trim()) || 0;
}

async function countWindowsForProcessName() {
  const script = `
tell application "System Events"
  set totalWindows to 0
  repeat with candidate in (processes whose name is "${processName}")
    set totalWindows to totalWindows + (count of windows of candidate)
  end repeat
  return totalWindows
end tell`;
  const { stdout } = await run("osascript", ["-e", script]);
  return Number(stdout.trim()) || 0;
}

async function waitForMainWindow(initialPids, executablePath, baselineWindowCount) {
  const deadline = Date.now() + 10000;
  const pids = new Set(initialPids);
  let lastError;
  while (Date.now() < deadline) {
    for (const pid of await findPids(executablePath)) {
      pids.add(pid);
    }
    for (const pid of pids) {
      try {
        if ((await countWindowsForPid(pid)) > 0) {
          return pid;
        }
      } catch (error) {
        lastError = error;
      }
    }
    try {
      if ((await countWindowsForProcessName()) > baselineWindowCount) {
        return processName;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError instanceof Error ? ` Last accessibility error: ${lastError.message}` : "";
  throw new Error(`Packaged app launched but did not show a main window.${detail}`);
}

async function stopApp(executablePath) {
  const pids = await findPids(executablePath);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have exited between pgrep and kill.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function runInstallCycle(mountPoint, tempRoot, cycle) {
  const appPath = path.join(tempRoot, appName);
  const executablePath = path.join(appPath, appExecutable);
  await rm(appPath, { recursive: true, force: true });
  await cp(path.join(mountPoint, appName), appPath, { recursive: true });
  try {
    const baselineWindowCount = await countWindowsForProcessName();
    await run("open", ["-n", appPath]);
    const pids = await waitForLaunch(executablePath);
    const windowPid = await waitForMainWindow(pids, executablePath, baselineWindowCount);
    console.log(`Cycle ${cycle}: launched ${appPath} with pid ${pids.join(",")} and showed a main window on pid ${windowPid}.`);
  } finally {
    await stopApp(executablePath);
    await rm(appPath, { recursive: true, force: true });
  }
}

async function main() {
  assertDarwin();
  const tempRoot = await mkdtemp(path.join(tmpdir(), "Image2Tools-release-test-"));
  let mountPoint;
  try {
    mountPoint = await attachDmg();
    await runInstallCycle(mountPoint, tempRoot, 1);
    await runInstallCycle(mountPoint, tempRoot, 2);
    console.log("macOS release verification passed.");
  } finally {
    if (mountPoint) {
      await detachDmg(mountPoint);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
