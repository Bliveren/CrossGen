#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseDir = path.resolve("release");
const productName = "Image2Tools";
const processName = "Image2Tools";
const appExecutableName = `${productName}.exe`;
const installerPattern = /^Image2Tools-.*-win-.*\.exe$/;
const smokeTimeoutMs = Number(process.env.IMAGE2TOOLS_WINDOWS_SMOKE_TIMEOUT_MS ?? 12000);
const windowTimeoutMs = Number(process.env.IMAGE2TOOLS_WINDOWS_WINDOW_TIMEOUT_MS ?? 15000);

function assertWindows() {
  if (process.platform !== "win32") {
    throw new Error("verify:release:windows can only run on Windows.");
  }
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 10,
    windowsHide: true,
    ...options
  });
}

async function readChunk(filePath, position, length) {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findInstaller() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && installerPattern.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected one ${productName} Windows installer, found ${candidates.length}: ${candidates.join(", ") || "none"}`);
  }
  return candidates[0];
}

async function findUnpackedExecutable() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^win(?:-.+)?-unpacked$/.test(entry.name)) {
      continue;
    }
    const executablePath = path.join(releaseDir, entry.name, appExecutableName);
    if (await pathExists(executablePath)) {
      candidates.push(executablePath);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one unpacked Windows executable, found ${candidates.length}: ${candidates.join(", ") || "none"}`);
  }
  return candidates[0];
}

async function assertPeExecutable(filePath, label) {
  const dosHeader = await readChunk(filePath, 0, 0x40);
  if (dosHeader.length < 0x40 || dosHeader.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`Expected ${filePath} to start with a Windows MZ executable header.`);
  }

  const peOffset = dosHeader.readUInt32LE(0x3c);
  const peHeader = await readChunk(filePath, peOffset, 6);
  if (peHeader.length < 6 || peHeader.toString("ascii", 0, 4) !== "PE\u0000\u0000") {
    throw new Error(`Expected ${filePath} to contain a PE header.`);
  }

  const machine = peHeader.readUInt16LE(4);
  const machineName = new Map([
    [0x014c, "x86"],
    [0x8664, "x64"],
    [0xaa64, "arm64"]
  ]).get(machine);
  if (!machineName) {
    throw new Error(`Unsupported Windows PE machine type 0x${machine.toString(16)} for ${filePath}.`);
  }

  console.log(`${label}: ${filePath} (${machineName} PE)`);
}

async function runPowerShell(script, env = {}) {
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {
      ...process.env,
      ...env
    }
  });
}

async function findPidsByPath(executablePath, requireWindow = false) {
  const script = `
$ErrorActionPreference = "Stop"
$target = [System.IO.Path]::GetFullPath($env:IMAGE2TOOLS_EXE_PATH)
$requireWindow = $env:IMAGE2TOOLS_REQUIRE_WINDOW -eq "1"
Get-Process -Name "${processName}" -ErrorAction SilentlyContinue | Where-Object {
  try {
    $candidate = [System.IO.Path]::GetFullPath($_.Path)
    ($candidate -eq $target) -and ((-not $requireWindow) -or ($_.MainWindowHandle -ne 0))
  } catch {
    $false
  }
} | ForEach-Object { $_.Id }
`;
  const { stdout } = await runPowerShell(script, {
    IMAGE2TOOLS_EXE_PATH: executablePath,
    IMAGE2TOOLS_REQUIRE_WINDOW: requireWindow ? "1" : "0"
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function stopProcessTree(executablePath) {
  const pids = await findPidsByPath(executablePath);
  for (const pid of pids) {
    try {
      await run("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
    } catch {
      // Process may have exited between discovery and taskkill.
    }
  }
}

async function waitForPids(executablePath) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const pids = await findPidsByPath(executablePath);
    if (pids.length > 0) {
      return pids;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged app did not launch from ${executablePath}`);
}

async function waitForMainWindow(executablePath) {
  const deadline = Date.now() + windowTimeoutMs;
  while (Date.now() < deadline) {
    const pids = await findPidsByPath(executablePath, true);
    if (pids.length > 0) {
      return pids[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged app launched but did not show a main window within ${windowTimeoutMs}ms.`);
}

async function launchUnpackedApp(executablePath) {
  await stopProcessTree(executablePath);
  const child = spawn(executablePath, ["--disable-gpu"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  let earlyExitCode = null;
  let spawnError = null;
  child.on("exit", (code) => {
    earlyExitCode = code;
  });
  child.on("error", (error) => {
    spawnError = error;
  });

  try {
    const pids = await waitForPids(executablePath).catch((error) => {
      const detail = spawnError instanceof Error
        ? ` Spawn error: ${spawnError.message}`
        : earlyExitCode !== null
          ? ` Process exited with code ${earlyExitCode}.`
          : "";
      throw new Error(`${error.message}${detail}\n${output}`);
    });
    const windowPid = await waitForMainWindow(executablePath).catch((error) => {
      const detail = earlyExitCode !== null ? ` Process exited with code ${earlyExitCode}.` : "";
      throw new Error(`${error.message}${detail}\n${output}`);
    });
    await new Promise((resolve) => setTimeout(resolve, smokeTimeoutMs));
    const runningPids = await findPidsByPath(executablePath);
    if (runningPids.length === 0) {
      throw new Error(`Packaged app exited before the ${smokeTimeoutMs}ms smoke interval completed.\n${output}`);
    }
    const warningLines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (warningLines.length > 0) {
      console.log(`Unpacked Windows app emitted non-fatal output:\n${warningLines.join("\n")}`);
    }
    console.log(`Unpacked Windows app launched with pid ${pids.join(",")}, showed a main window on pid ${windowPid}, and stayed running for ${smokeTimeoutMs}ms.`);
  } finally {
    await stopProcessTree(executablePath);
    if (!child.killed) {
      child.kill();
    }
  }
}

async function main() {
  assertWindows();

  const installerPath = await findInstaller();
  const unpackedExecutable = await findUnpackedExecutable();

  await assertPeExecutable(installerPath, "Windows installer");
  await assertPeExecutable(unpackedExecutable, "Unpacked Windows app");
  await launchUnpackedApp(unpackedExecutable);
  console.log("Windows release verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
