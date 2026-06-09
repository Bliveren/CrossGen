#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseDir = path.resolve("release");
const dmgPattern = /^Image2Tools-.*-mac-.*\.dmg$/;
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

async function findDmg() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && dmgPattern.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected one Image2Tools macOS dmg, found ${candidates.length}: ${candidates.join(", ") || "none"}`);
  }
  return candidates[0];
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

async function attachDmg(dmgPath) {
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
  try {
    await run("hdiutil", ["detach", "-force", mountPoint]);
    return;
  } catch (error) {
    lastError = error;
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

async function listMainWindows() {
  const script = [
    "import CoreGraphics",
    "import Foundation",
    "let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []",
    "for window in windows {",
    `  let owner = window[kCGWindowOwnerName as String] as? String ?? ""`,
    `  guard owner == "${processName}" else { continue }`,
    `  let title = window[kCGWindowName as String] as? String ?? ""`,
    `  let pid = window[kCGWindowOwnerPID as String] as? Int32 ?? 0`,
    `  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]`,
    `  let width = bounds["Width"] as? Double ?? 0`,
    `  let height = bounds["Height"] as? Double ?? 0`,
    `  if width > 100 && height > 100 { print("\\(pid)|\\(title)|\\(Int(width))x\\(Int(height))") }`,
    "}"
  ].join("\n");
  const { stdout } = await run("swift", ["-e", script], { timeout: 10000, killSignal: "SIGKILL" });
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function waitForMainWindow(initialPids, executablePath) {
  const deadline = Date.now() + 20000;
  const pids = new Set(initialPids);
  let lastError;
  let lastPids = "";
  let lastWindows = "";
  while (Date.now() < deadline) {
    for (const pid of await findPids(executablePath)) {
      pids.add(pid);
    }
    lastPids = [...pids].join(",");
    try {
      const windows = await listMainWindows();
      lastWindows = windows.join("; ");
      const matchingWindow = windows.find((window) => {
        const [pid] = window.split("|");
        return pids.has(Number(pid));
      });
      if (matchingWindow) return matchingWindow;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError instanceof Error ? ` Last window enumeration error: ${lastError.message}` : "";
  throw new Error(`Packaged app launched but did not show a main window. Last pids: ${lastPids || "none"}. Last windows: ${lastWindows || "none"}.${detail}`);
}

async function stopApp(executablePath) {
  const appContentsPath = executablePath.slice(0, executablePath.indexOf("/Contents/") + "/Contents/".length);
  const pids = new Set([
    ...(await findPids(executablePath)),
    ...(appContentsPath ? await findPids(appContentsPath) : [])
  ]);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have exited between pgrep and kill.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const pid of await findPids(appContentsPath || executablePath)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may have exited between pgrep and kill.
    }
  }
}

async function runInstallCycle(mountPoint, tempRoot, cycle) {
  const appPath = path.join(tempRoot, appName);
  const executablePath = path.join(appPath, appExecutable);
  const logPath = path.join(tempRoot, `cycle-${cycle}.log`);
  await rm(appPath, { recursive: true, force: true });
  await run("ditto", [path.join(mountPoint, appName), appPath]);
  await run("codesign", ["--verify", "--deep", "--strict", appPath]);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    await run("open", ["-n", appPath]);
    const pids = await waitForLaunch(executablePath);
    let window;
    try {
      window = await waitForMainWindow(pids, executablePath);
    } catch (error) {
      let logTail = "";
      try {
        logTail = (await readFile(logPath, "utf8")).slice(-4000);
      } catch {
        logTail = "";
      }
      const suffix = logTail ? `\nApp log tail:\n${logTail}` : "";
      throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
    }
    console.log(`Cycle ${cycle}: launched ${appPath} with pid ${pids.join(",")} and showed a main window (${window}).`);
  } finally {
    await stopApp(executablePath);
    await rm(appPath, { recursive: true, force: true });
  }
}

async function main() {
  assertDarwin();
  const tempRoot = await mkdtemp(path.join("/tmp", "Image2Tools-release-test-"));
  let mountPoint;
  try {
    const dmgPath = await findDmg();
    mountPoint = await attachDmg(dmgPath);
    await runInstallCycle(mountPoint, tempRoot, 1);
    await runInstallCycle(mountPoint, tempRoot, 2);
    console.log("macOS release verification passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    if (mountPoint) {
      await detachDmg(mountPoint);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
