import { promises as fs } from "node:fs";
import path from "node:path";
import type { GenerationJob } from "../../shared/types.js";

const NOT_MANAGED_MESSAGE = "无法操作：资源不属于 Image2Tools 管理目录。";
const NOT_IN_HISTORY_MESSAGE = "无法操作：资源不属于当前历史。";

export function normalizeManagedAssetPath(imagesDir: string, assetPath: string): string | null {
  if (!assetPath.trim()) return null;

  const root = path.resolve(imagesDir);
  const resolved = path.resolve(assetPath);
  const relative = path.relative(root, resolved);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

export function collectKnownOutputPaths(imagesDir: string, history: GenerationJob[]): Set<string> {
  const paths = new Set<string>();
  for (const job of history) {
    for (const asset of job.outputs) {
      const normalized = normalizeManagedAssetPath(imagesDir, asset.path);
      if (normalized) paths.add(normalized);
    }
  }
  return paths;
}

export function assertKnownOutputPath(imagesDir: string, history: GenerationJob[], assetPath: string): string {
  const normalized = normalizeManagedAssetPath(imagesDir, assetPath);
  if (!normalized) {
    throw new Error(NOT_MANAGED_MESSAGE);
  }

  if (!collectKnownOutputPaths(imagesDir, history).has(normalized)) {
    throw new Error(NOT_IN_HISTORY_MESSAGE);
  }

  return normalized;
}

export async function assertKnownRegularOutputPath(imagesDir: string, history: GenerationJob[], assetPath: string): Promise<string> {
  return assertManagedRegularFile(imagesDir, assertKnownOutputPath(imagesDir, history, assetPath));
}

export async function assertManagedRegularFile(imagesDir: string, assetPath: string): Promise<string> {
  const normalized = normalizeManagedAssetPath(imagesDir, assetPath);
  if (!normalized) {
    throw new Error(NOT_MANAGED_MESSAGE);
  }

  const realImagesDir = await fs.realpath(imagesDir);
  const realAssetPath = await fs.realpath(normalized);
  if (!normalizeManagedAssetPath(realImagesDir, realAssetPath)) {
    throw new Error(NOT_MANAGED_MESSAGE);
  }

  const stat = await fs.stat(realAssetPath);
  if (!stat.isFile()) {
    throw new Error("无法下载：资源不是文件。");
  }

  return normalized;
}

export async function assertManagedRegularFileInRoots(managedRoots: string[], assetPath: string): Promise<string> {
  for (const root of managedRoots) {
    const normalized = normalizeManagedAssetPath(root, assetPath);
    if (!normalized) continue;
    const realRoot = await fs.realpath(root);
    const realAssetPath = await fs.realpath(normalized);
    if (!normalizeManagedAssetPath(realRoot, realAssetPath)) {
      throw new Error(NOT_MANAGED_MESSAGE);
    }
    const stat = await fs.stat(realAssetPath);
    if (!stat.isFile()) {
      throw new Error("无法下载：资源不是文件。");
    }
    return normalized;
  }
  throw new Error(NOT_MANAGED_MESSAGE);
}

export function resolveManagedFileName(rootDir: string, fileName: string): string {
  if (!fileName.trim() || fileName.includes("/") || fileName.includes("\\") || path.isAbsolute(fileName)) {
    throw new Error(NOT_MANAGED_MESSAGE);
  }
  const resolved = path.resolve(rootDir, fileName);
  if (!normalizeManagedAssetPath(rootDir, resolved)) {
    throw new Error(NOT_MANAGED_MESSAGE);
  }
  return resolved;
}

export function collectOwnedJobFilePaths(imagesDir: string, job: GenerationJob): string[] {
  const ownedPaths: string[] = [];

  for (const asset of job.outputs) {
    const normalized = normalizeManagedAssetPath(imagesDir, asset.path);
    if (normalized) ownedPaths.push(normalized);
  }

  const maskPath = job.maskAsset ? normalizeManagedAssetPath(imagesDir, job.maskAsset.path) : null;
  if (maskPath) ownedPaths.push(maskPath);

  return ownedPaths;
}
