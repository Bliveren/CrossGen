#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseDir = path.resolve("release");
const productName = "Image2Tools";
const appImagePattern = /^Image2Tools-.*-linux-.*\.AppImage$/;
const requireDirectAppImage = process.env.IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE === "1";
const smokeTimeoutMs = Number(process.env.IMAGE2TOOLS_LINUX_SMOKE_TIMEOUT_MS ?? 12000);

function assertLinux() {
  if (process.platform !== "linux") {
    throw new Error("verify:release:linux can only run on Linux.");
  }
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 20,
    ...options
  });
}

async function requireCommand(command) {
  try {
    await run("which", [command]);
  } catch {
    throw new Error(`Missing required command: ${command}`);
  }
}

async function findAppImage() {
  const { stdout } = await run("find", [releaseDir, "-maxdepth", "1", "-type", "f", "-name", "*.AppImage", "-print"]);
  const candidates = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((candidate) => appImagePattern.test(path.basename(candidate)));
  if (candidates.length !== 1) {
    throw new Error(`Expected one ${productName} Linux AppImage, found ${candidates.length}: ${candidates.join(", ") || "none"}`);
  }
  return candidates[0];
}

async function findUnpackedExecutable() {
  const { stdout } = await run("find", [releaseDir, "-maxdepth", "2", "-type", "f", "-path", "*/linux*-unpacked/image2tools", "-print"]);
  const candidates = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((candidate) => {
      const parentDir = path.basename(path.dirname(candidate));
      return parentDir === "linux-unpacked" || /^linux-.+-unpacked$/.test(parentDir);
    });
  if (candidates.length !== 1) {
    throw new Error(`Expected one unpacked Linux executable, found ${candidates.length}: ${candidates.join(", ") || "none"}`);
  }
  return candidates[0];
}

async function assertElfExecutable(filePath) {
  const { stdout } = await run("file", [filePath]);
  if (!stdout.includes("ELF 64-bit") || !stdout.includes("executable")) {
    throw new Error(`Expected ${filePath} to be a 64-bit ELF executable. file output:\n${stdout}`);
  }
  console.log(stdout.trim());
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function stopProcessTree(executablePath, signal = "SIGTERM") {
  const escapedPath = executablePath.replace(/[[\]\\.^$|?*+(){}]/g, "\\$&");
  const pids = await findPids(escapedPath);
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Process may have exited between pgrep and kill.
    }
  }
}

async function stopLaunchedApp(executablePath) {
  await stopProcessTree(executablePath, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await stopProcessTree(executablePath, "SIGKILL");
}

async function launchWithXvfb(executablePath, label) {
  const child = spawn("xvfb-run", ["-a", executablePath, "--no-sandbox"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  let exited = false;
  let exitCode = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  await new Promise((resolve) => setTimeout(resolve, smokeTimeoutMs));
  if (exited) {
    throw new Error(`${label} exited before the ${smokeTimeoutMs}ms smoke interval with code ${exitCode}.\n${output}`);
  }

  await stopLaunchedApp(executablePath);
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (!exited) child.kill("SIGKILL");

  const warningLines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("Failed to connect to the bus") && !line.includes("GPU process"));
  if (warningLines.length > 0) {
    console.log(`${label} emitted non-fatal output:\n${warningLines.join("\n")}`);
  }
  console.log(`${label} stayed running for ${smokeTimeoutMs}ms under Xvfb.`);
}

async function canRunDirectAppImage() {
  if (await pathExists("/dev/fuse")) {
    return { ok: true, reason: "" };
  }
  try {
    const { stdout } = await run("findmnt", ["-n", "-o", "FSTYPE", "/"]);
    const rootFs = stdout.trim();
    if (rootFs === "fuseblk") {
      return { ok: true, reason: "" };
    }
  } catch {
    // findmnt is a best-effort fallback for environments without /dev/fuse.
  }
  return {
    ok: false,
    reason: "Direct AppImage execution requires FUSE support, but /dev/fuse is not available."
  };
}

async function verifyDirectAppImageLaunch(appImagePath) {
  const directSupport = await canRunDirectAppImage();
  if (!directSupport.ok) {
    if (requireDirectAppImage) {
      throw new Error(directSupport.reason);
    }
    console.log(`${directSupport.reason} Skipping direct AppImage launch; set IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1 to make this mandatory.`);
    return;
  }
  await run("chmod", ["+x", appImagePath]);
  await launchWithXvfb(appImagePath, "Direct AppImage app");
}

async function verifyAppImageExtraction(appImagePath) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "Image2Tools-linux-appimage-"));
  try {
    await run("cp", [appImagePath, tempRoot]);
    const copiedAppImage = path.join(tempRoot, path.basename(appImagePath));
    await run("chmod", ["+x", copiedAppImage]);
    await run(copiedAppImage, ["--appimage-extract"], { cwd: tempRoot });
    const extractedExecutable = path.join(tempRoot, "squashfs-root", "image2tools");
    await assertElfExecutable(extractedExecutable);
    await launchWithXvfb(extractedExecutable, "Extracted AppImage app");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  assertLinux();
  await requireCommand("file");
  await requireCommand("find");
  await requireCommand("xvfb-run");

  const appImagePath = await findAppImage();
  const unpackedExecutable = await findUnpackedExecutable();

  await assertElfExecutable(appImagePath);
  await assertElfExecutable(unpackedExecutable);
  await launchWithXvfb(unpackedExecutable, "Unpacked Linux app");
  await verifyDirectAppImageLaunch(appImagePath);
  await verifyAppImageExtraction(appImagePath);
  console.log("Linux release verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
