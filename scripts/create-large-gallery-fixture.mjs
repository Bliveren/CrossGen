#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixedStart = new Date("2026-01-01T00:00:00.000Z");
const extensionCycle = ["png", "jpg", "jpeg", "webp"];
const tagPool = ["generated", "reference", "product", "draft", "favorite", "mask", "edited", "archive"];

const profiles = {
  "gallery-small": {
    description: "Smoke-level Gallery fixture for fast validation.",
    folderCount: 18,
    assetCount: 180,
    maxDepth: 3,
    branchFactor: 3,
    imageWidth: 96,
    imageHeight: 72
  },
  "gallery-large": {
    description: "Large Gallery baseline fixture for scan, render, and thumbnail metrics.",
    folderCount: 96,
    assetCount: 2400,
    maxDepth: 5,
    branchFactor: 4,
    imageWidth: 128,
    imageHeight: 96
  },
  "gallery-deep": {
    description: "Nested folder and watcher stress fixture.",
    folderCount: 84,
    assetCount: 900,
    maxDepth: 14,
    branchFactor: 2,
    deepChainDepth: 14,
    imageWidth: 96,
    imageHeight: 96
  }
};

const jpeg1x1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  "base64"
);

const webp1x1 = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

function usage() {
  const profileList = Object.keys(profiles).join(", ");
  return [
    "Usage: node scripts/create-large-gallery-fixture.mjs [--profile gallery-large] [--output output/perf-fixtures/gallery-large] [--force]",
    "",
    `Profiles: ${profileList}`,
    "",
    "The output contains a temp Electron userData layout and never touches the real app userData directory."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    profile: "gallery-large",
    output: "",
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--profile") {
      args.profile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--output") {
      args.output = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!profiles[args.profile]) {
    throw new Error(`Unknown profile "${args.profile}". Available profiles: ${Object.keys(profiles).join(", ")}`);
  }
  args.output = path.resolve(repoRoot, args.output || path.join("output", "perf-fixtures", args.profile));
  return args;
}

function pad(value, width = 4) {
  return String(value).padStart(width, "0");
}

function isoAt(offsetSeconds) {
  return new Date(fixedStart.getTime() + offsetSeconds * 1000).toISOString();
}

function posixJoin(...segments) {
  return segments.filter(Boolean).join("/");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function solidPng(width, height, rgba) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * rowLength;
    raw[rowStart] = 0;
    for (let column = 0; column < width; column += 1) {
      const offset = rowStart + 1 + column * 4;
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }
  return Buffer.concat([
    header,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function imageBytesFor(index, ext, width, height) {
  if (ext === "jpg" || ext === "jpeg") return jpeg1x1;
  if (ext === "webp") return webp1x1;
  const rgba = [
    (37 * index + 41) % 256,
    (67 * index + 89) % 256,
    (97 * index + 131) % 256,
    255
  ];
  return solidPng(width, height, rgba);
}

function mimeTypeForExt(ext) {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function createFolders(profile) {
  const folders = [];
  let deepParent = "";
  if (profile.deepChainDepth) {
    for (let depth = 1; depth <= Math.min(profile.deepChainDepth, profile.folderCount); depth += 1) {
      const name = `Deep-${pad(depth, 2)}`;
      const relPath = posixJoin(deepParent, name);
      folders.push({
        relPath,
        parentRelPath: deepParent || null,
        name,
        depth
      });
      deepParent = relPath;
    }
  }
  const queue = [{ relPath: "", depth: 0 }];
  while (folders.length < profile.folderCount && queue.length > 0) {
    const parent = queue.shift();
    const remaining = profile.folderCount - folders.length;
    const childCount = Math.min(profile.branchFactor, remaining);
    for (let child = 0; child < childCount; child += 1) {
      const folderNumber = folders.length + 1;
      const name = `Set-${pad(parent.depth + 1, 2)}-${pad(child + 1, 2)}-${pad(folderNumber, 3)}`;
      const relPath = posixJoin(parent.relPath, name);
      folders.push({
        relPath,
        parentRelPath: parent.relPath || null,
        name,
        depth: parent.depth + 1
      });
      if (parent.depth + 1 < profile.maxDepth) {
        queue.push({ relPath, depth: parent.depth + 1 });
      }
      if (folders.length >= profile.folderCount) break;
    }
  }
  return folders;
}

function folderIdForIndex(index) {
  return `fixture_folder_${pad(index + 1, 4)}`;
}

function assetIdForIndex(index) {
  return `fixture_asset_${pad(index + 1, 5)}`;
}

function tagsForIndex(index) {
  const tags = [tagPool[index % tagPool.length]];
  if (index % 3 === 0) tags.push(tagPool[(index + 2) % tagPool.length]);
  if (index % 11 === 0) tags.push("duplicate-name");
  return [...new Set(tags)];
}

function baseNameForIndex(index) {
  if (index % 11 === 0) return `shared-subject-${pad(index % 33, 2)}`;
  if (index % 17 === 0) return `duplicate-scene-${pad(index % 51, 2)}`;
  return `fixture-image-${pad(index + 1, 5)}`;
}

async function assertOutputReady(outputDir, force) {
  if (force) {
    await fs.rm(outputDir, { recursive: true, force: true });
    return;
  }
  try {
    const entries = await fs.readdir(outputDir);
    if (entries.length > 0) {
      throw new Error(`Output directory already exists and is not empty: ${outputDir}. Use --force to replace it.`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = profiles[args.profile];
  const outputDir = args.output;
  const userDataDir = path.join(outputDir, "userData");
  const historyDir = path.join(userDataDir, "images");
  const galleryDir = path.join(userDataDir, "gallery");
  const statePath = path.join(userDataDir, "image2tools-state.v1.json");
  const manifestPath = path.join(outputDir, "manifest.json");

  await assertOutputReady(outputDir, args.force);
  await fs.mkdir(galleryDir, { recursive: true });
  await fs.mkdir(historyDir, { recursive: true });

  const folders = createFolders(profile);
  const folderByRelPath = new Map(folders.map((folder, index) => [folder.relPath, { ...folder, id: folderIdForIndex(index) }]));
  const folderRelPathById = new Map(folders.map((folder, index) => [folderIdForIndex(index), folder.relPath]));
  for (const folder of folders) {
    await fs.mkdir(path.join(galleryDir, ...folder.relPath.split("/")), { recursive: true });
  }

  const usedRelPaths = new Set();
  const assets = [];
  const sampleAssetRelPaths = [];
  let totalImageBytes = 0;

  for (let index = 0; index < profile.assetCount; index += 1) {
    const ext = extensionCycle[index % extensionCycle.length];
    const folder = index % 13 === 0 ? null : folders[index % folders.length];
    const baseName = baseNameForIndex(index);
    let fileName = `${baseName}.${ext}`;
    let relPath = posixJoin(folder?.relPath, fileName);
    let suffix = 1;
    while (usedRelPaths.has(relPath.toLowerCase())) {
      fileName = `${baseName}-${suffix}.${ext}`;
      relPath = posixJoin(folder?.relPath, fileName);
      suffix += 1;
    }
    usedRelPaths.add(relPath.toLowerCase());

    const bytes = imageBytesFor(index, ext, profile.imageWidth, profile.imageHeight);
    const filePath = path.join(galleryDir, ...relPath.split("/"));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    const modifiedAt = isoAt(index + 1);
    const modifiedDate = new Date(modifiedAt);
    await fs.utimes(filePath, modifiedDate, modifiedDate);
    totalImageBytes += bytes.length;
    if (sampleAssetRelPaths.length < 12) sampleAssetRelPaths.push(relPath);

    assets.push({
      id: assetIdForIndex(index),
      fileName: relPath,
      originalName: fileName,
      mimeType: mimeTypeForExt(ext),
      sizeBytes: bytes.length,
      width: ext === "png" ? profile.imageWidth : 1,
      height: ext === "png" ? profile.imageHeight : 1,
      folderId: folder ? folderByRelPath.get(folder.relPath)?.id ?? null : null,
      tags: tagsForIndex(index),
      source: "import",
      createdAt: isoAt(index + 1),
      updatedAt: isoAt(index + 1),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      modifiedAt
    });
  }

  const state = {
    version: 3,
    providers: [
      {
        id: "default",
        kind: "openai",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        enabled: true,
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        discoveredModels: [],
        activeLaunchId: "gpt-image-2",
        activeModelId: "gpt-image-2",
        updatedAt: new Date(0).toISOString(),
        encryption: "none"
      }
    ],
    activeProviderId: "default",
    history: [],
    promptTemplates: [],
    galleryFolders: folders.map((folder, index) => ({
      id: folderIdForIndex(index),
      name: folder.name,
      parentId: folder.parentRelPath ? folderByRelPath.get(folder.parentRelPath)?.id ?? null : null,
      createdAt: isoAt(index + 1),
      updatedAt: isoAt(index + 1)
    })).sort((a, b) => {
      const aRelPath = folderRelPathById.get(a.id) ?? a.name;
      const bRelPath = folderRelPathById.get(b.id) ?? b.name;
      return aRelPath.localeCompare(bRelPath);
    }),
    galleryAssets: assets.sort((a, b) => a.fileName.localeCompare(b.fileName)),
    storage: {
      historyDir,
      galleryDir
    }
  };

  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const stateStat = await fs.stat(statePath);
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/create-large-gallery-fixture.mjs",
    profile: args.profile,
    description: profile.description,
    repoRoot,
    outputDir,
    userDataDir,
    statePath,
    historyDir,
    galleryDir,
    folderCount: folders.length,
    assetCount: assets.length,
    totalImageBytes,
    stateBytes: stateStat.size,
    maxDepth: Math.max(...folders.map((folder) => folder.depth), 0),
    extensions: extensionCycle,
    sampleAssetRelPaths,
    sampleFolderRelPath: folders[Math.min(5, folders.length - 1)]?.relPath ?? null,
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length
    },
    commands: {
      regenerate: `node scripts/create-large-gallery-fixture.mjs --profile ${args.profile} --output ${path.relative(repoRoot, outputDir)} --force`,
      measure: `node scripts/measure-gallery-performance.mjs --fixture ${path.relative(repoRoot, outputDir)}`
    }
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    profile: args.profile,
    outputDir,
    userDataDir,
    galleryDir,
    statePath,
    manifestPath,
    folderCount: folders.length,
    assetCount: assets.length,
    stateBytes: stateStat.size,
    totalImageBytes
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
