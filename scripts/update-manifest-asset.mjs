#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const validPlatforms = new Set(["darwin", "win32", "linux", "all"]);

function usage() {
  return [
    "Usage:",
    "  node scripts/update-manifest-asset.mjs --file <path> --platform <darwin|win32|linux|all> --url <https-url> [--arch <arch>] [--file-name <name>]",
    "",
    "Outputs a docs/updates/latest.json asset entry with sha256 and sizeBytes."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}\n${usage()}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}\n${usage()}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function assertHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--url must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("--url must use HTTPS for release manifests.");
  }
}

async function buildAsset({ file, platform, url, arch, fileName }) {
  if (!file) throw new Error(`Missing --file.\n${usage()}`);
  if (!validPlatforms.has(platform)) {
    throw new Error(`--platform must be one of: ${[...validPlatforms].join(", ")}`);
  }
  if (!url) throw new Error(`Missing --url.\n${usage()}`);
  assertHttpsUrl(url);

  const filePath = path.resolve(file);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`--file must point to a regular file: ${filePath}`);
  }
  const bytes = await readFile(filePath);
  const asset = {
    platform,
    url,
    fileName: fileName?.trim() || path.basename(filePath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: fileStat.size
  };
  if (arch?.trim()) {
    asset.arch = arch.trim();
  }
  return asset;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asset = await buildAsset({
    file: args.file,
    platform: args.platform,
    url: args.url,
    arch: args.arch,
    fileName: args["file-name"]
  });
  console.log(JSON.stringify(asset, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
