#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 5 });
}

function isSet(name) {
  return Boolean(process.env[name]?.trim());
}

async function readPackageBuildConfig() {
  const raw = await readFile("package.json", "utf8");
  const pkg = JSON.parse(raw);
  return {
    mac: pkg.build?.mac ?? {},
    scripts: pkg.scripts ?? {}
  };
}

async function findCodeSigningIdentities() {
  if (process.platform !== "darwin") {
    return { ok: false, message: "macOS signing readiness can only be checked on macOS." };
  }
  const { stdout } = await run("security", ["find-identity", "-v", "-p", "codesigning"]);
  const match = /(\d+) valid identities found/.exec(stdout);
  const count = match ? Number(match[1]) : 0;
  return {
    ok: count > 0,
    count,
    message: count > 0 ? `${count} valid code signing identity/identities found.` : "No valid code signing identities found."
  };
}

async function main() {
  const checks = [];
  const identity = await findCodeSigningIdentities();
  checks.push(identity);

  const { mac: macConfig, scripts } = await readPackageBuildConfig();
  const signedPackageScript = String(scripts["package:mac:signed"] ?? "");
  const hasSignedPackageOverride =
    signedPackageScript.includes("-c.mac.identity") && signedPackageScript.includes("-c.mac.notarize=true");
  if ((macConfig.identity === null || macConfig.identity === "-") && !hasSignedPackageOverride) {
    checks.push({
      ok: false,
      message: "package.json does not provide a Developer ID signed/notarized packaging override."
    });
  } else if (macConfig.identity === "-") {
    checks.push({
      ok: true,
      message: "package.json uses ad-hoc signing for local preview builds and provides package:mac:signed to override mac.identity and enable notarization."
    });
  } else if (macConfig.identity === null) {
    checks.push({
      ok: true,
      message: "package.json keeps unsigned builds as the default and provides package:mac:signed to override mac.identity and enable notarization."
    });
  }

  const envChecks = [
    ["CSC_NAME", "Code signing identity override"],
    ["APPLE_ID", "Apple ID for notarization"],
    ["APPLE_APP_SPECIFIC_PASSWORD", "Apple app-specific password for notarization"],
    ["APPLE_TEAM_ID", "Apple developer team ID"]
  ].map(([name, label]) => ({
    ok: isSet(name),
    message: `${label}: ${isSet(name) ? "set" : "unset"} (${name})`
  }));

  checks.push(...envChecks);

  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "missing"} - ${check.message}`);
  }

  if (checks.some((check) => !check.ok)) {
    throw new Error("macOS signing readiness is incomplete. No signing or notarization was attempted.");
  }

  console.log("macOS signing readiness checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
