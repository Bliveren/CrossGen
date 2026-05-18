#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseDir = path.resolve("release");
const productName = "Image2Tools";
const processName = "Image2Tools";
const appExecutableName = `${productName}.exe`;
const installerPattern = /^Image2Tools-.*-win-.*\.exe$/;
const installerTimeoutMs = Number(process.env.IMAGE2TOOLS_WINDOWS_INSTALL_TIMEOUT_MS ?? 120000);
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

async function assertDirectory(directoryPath, label) {
  const directoryStat = await stat(directoryPath);
  if (!directoryStat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }
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

function parseJsonObject(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed[0] ?? null : parsed;
}

function stripIconPathSuffix(rawPath) {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/,-?\d+$/, "").replace(/^"(.+)"$/, "$1").replace(/^"|"$/g, "");
}

function parseExecutableFromCommand(command) {
  const trimmed = command?.trim();
  if (!trimmed) {
    return "";
  }
  const quotedMatch = /^"([^"]+\.exe)"/i.exec(trimmed);
  if (quotedMatch) {
    return quotedMatch[1];
  }
  const exeMatch = /^(.+?\.exe)(?:\s|$)/i.exec(trimmed);
  return exeMatch?.[1] ?? "";
}

async function findRegistryInstallEntry() {
  const script = `
$ErrorActionPreference = "Stop"
$roots = @(
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
)
$matches = @()
foreach ($root in $roots) {
  if (Test-Path $root) {
    $matches += Get-ChildItem $root -ErrorAction SilentlyContinue |
      ForEach-Object {
        try { Get-ItemProperty $_.PSPath } catch { $null }
      } |
      Where-Object { $_ -and ($_.DisplayName -eq "${productName}" -or $_.DisplayName -like "${productName} *") }
  }
}
$matches |
  Select-Object -First 1 DisplayName,InstallLocation,DisplayIcon,UninstallString,PSChildName |
  ConvertTo-Json -Compress
`;
  const { stdout } = await runPowerShell(script);
  return parseJsonObject(stdout);
}

function fallbackInstallExecutableCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  return [
    path.join(localAppData, "Programs", productName, appExecutableName),
    path.join(localAppData, "Programs", "image2tools", appExecutableName),
    programFiles ? path.join(programFiles, productName, appExecutableName) : "",
    programFiles ? path.join(programFiles, "image2tools", appExecutableName) : "",
    programFilesX86 ? path.join(programFilesX86, productName, appExecutableName) : "",
    programFilesX86 ? path.join(programFilesX86, "image2tools", appExecutableName) : ""
  ].filter(Boolean);
}

async function findInstalledExecutableFromEntry(entry) {
  const candidates = [];
  if (entry?.InstallLocation) {
    candidates.push(path.join(stripIconPathSuffix(entry.InstallLocation), appExecutableName));
  }
  if (entry?.DisplayIcon) {
    candidates.push(stripIconPathSuffix(entry.DisplayIcon));
  }
  candidates.push(...fallbackInstallExecutableCandidates());

  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) {
      return candidate;
    }
  }
  return "";
}

async function findUninstallerFromEntry(entry, installedExecutable) {
  const candidates = [];
  if (installedExecutable) {
    candidates.push(path.join(path.dirname(installedExecutable), `Uninstall ${productName}.exe`));
  }
  if (entry?.UninstallString) {
    candidates.push(parseExecutableFromCommand(entry.UninstallString));
  }

  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) {
      return candidate;
    }
  }
  return "";
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

async function launchApp(executablePath, label) {
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
      throw new Error(`${label} exited before the ${smokeTimeoutMs}ms smoke interval completed.\n${output}`);
    }
    const warningLines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (warningLines.length > 0) {
      console.log(`${label} emitted non-fatal output:\n${warningLines.join("\n")}`);
    }
    console.log(`${label} launched with pid ${pids.join(",")}, showed a main window on pid ${windowPid}, and stayed running for ${smokeTimeoutMs}ms.`);
  } finally {
    await stopProcessTree(executablePath);
    if (!child.killed) {
      child.kill();
    }
  }
}

async function waitForInstalledApp() {
  const deadline = Date.now() + installerTimeoutMs;
  while (Date.now() < deadline) {
    const entry = await findRegistryInstallEntry();
    const installedExecutable = await findInstalledExecutableFromEntry(entry);
    if (installedExecutable) {
      const uninstaller = await findUninstallerFromEntry(entry, installedExecutable);
      return { installedExecutable, uninstaller, entry };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Silent installer completed but ${productName} was not found in registry or expected install locations.`);
}

async function waitForUninstalled(installedExecutable) {
  const deadline = Date.now() + installerTimeoutMs;
  while (Date.now() < deadline) {
    const entry = await findRegistryInstallEntry();
    const executableStillExists = await pathExists(installedExecutable);
    if (!entry && !executableStillExists) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${productName} was still present after silent uninstall: ${installedExecutable}`);
}

async function runSilentUninstall(installedExecutable, uninstaller) {
  await stopProcessTree(installedExecutable);
  await run(uninstaller, ["/S"], { timeout: installerTimeoutMs });
  await waitForUninstalled(installedExecutable);
}

async function cleanupExistingInstall() {
  const entry = await findRegistryInstallEntry();
  const installedExecutable = await findInstalledExecutableFromEntry(entry);
  const uninstaller = await findUninstallerFromEntry(entry, installedExecutable);
  if (!installedExecutable && !uninstaller) {
    return;
  }
  if (!installedExecutable || !uninstaller) {
    throw new Error(`Found an existing ${productName} install but could not determine both executable and uninstaller paths.`);
  }
  console.log(`Removing existing ${productName} install before verification: ${installedExecutable}`);
  await runSilentUninstall(installedExecutable, uninstaller);
}

async function runSilentInstallCycle(installerPath) {
  await cleanupExistingInstall();
  console.log(`Running silent Windows installer: ${installerPath}`);
  await run(installerPath, ["/S"], { timeout: installerTimeoutMs });

  let installedExecutable = "";
  let uninstaller = "";
  try {
    const installResult = await waitForInstalledApp();
    installedExecutable = installResult.installedExecutable;
    uninstaller = installResult.uninstaller;
    if (!uninstaller) {
      throw new Error(`Silent install succeeded but no uninstaller was found for ${installedExecutable}.`);
    }

    const installDir = path.dirname(installedExecutable);
    await assertDirectory(installDir, "Installed app directory");
    await assertPeExecutable(installedExecutable, "Installed Windows app");
    await launchApp(installedExecutable, "Installed Windows app");

    console.log(`Installed ${installResult.entry?.DisplayName ?? productName} at ${installDir}.`);
  } finally {
    if (installedExecutable && uninstaller) {
      console.log(`Running silent Windows uninstaller: ${uninstaller}`);
      await runSilentUninstall(installedExecutable, uninstaller);
    }
  }
  console.log("Silent Windows install/uninstall cycle passed.");
}

async function main() {
  assertWindows();

  const installerPath = await findInstaller();
  const unpackedExecutable = await findUnpackedExecutable();

  await assertPeExecutable(installerPath, "Windows installer");
  await assertPeExecutable(unpackedExecutable, "Unpacked Windows app");
  await launchApp(unpackedExecutable, "Unpacked Windows app");
  await runSilentInstallCycle(installerPath);
  console.log("Windows release verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
