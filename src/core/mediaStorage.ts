import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface ManagedMediaLayout {
  root: string;
  originalsDir: string;
  previewsDir: string;
  postersDir: string;
  tempDir: string;
}

export interface CleanupManagedMediaTempOptions {
  now?: number;
  maxAgeMs?: number;
}

export interface CleanupManagedMediaTempResult {
  scanned: number;
  removed: string[];
  retained: string[];
}

export interface ManagedMediaMigrationResult {
  sourceRoot: string;
  targetRoot: string;
  sourceRetained: boolean;
  copiedEntries: number;
}

export interface ManagedMediaMigrationOptions {
  /**
   * Test-only fault injection hooks. Production callers use the default fs
   * implementation; keeping the seam here lets rollback behavior be verified
   * without relying on platform-specific permission failures.
   */
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  remove?: (filePath: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  idFactory?: () => string;
}

const DEFAULT_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function resolveManagedMediaLayout(root: string): ManagedMediaLayout {
  const resolvedRoot = path.resolve(root);
  return {
    root: resolvedRoot,
    originalsDir: path.join(resolvedRoot, "originals"),
    previewsDir: path.join(resolvedRoot, "previews"),
    postersDir: path.join(resolvedRoot, "posters"),
    tempDir: path.join(resolvedRoot, "tmp")
  };
}

export async function ensureManagedMediaDirectories(root: string): Promise<ManagedMediaLayout> {
  const layout = resolveManagedMediaLayout(root);
  await Promise.all([
    fs.mkdir(layout.originalsDir, { recursive: true }),
    fs.mkdir(layout.previewsDir, { recursive: true }),
    fs.mkdir(layout.postersDir, { recursive: true }),
    fs.mkdir(layout.tempDir, { recursive: true })
  ]);
  return layout;
}

export function normalizeManagedMediaRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("媒体路径无效。");
  }
  return segments.join("/");
}

export function resolveManagedMediaPath(root: string, relativePath: string): string {
  const normalized = normalizeManagedMediaRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("媒体资源不属于 CrossGen 管理目录。");
  }
  return resolved;
}

export function mediaContentHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameResolvedPath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function copyDirectoryContents(sourceDir: string, targetDir: string): Promise<number> {
  if (!(await pathExists(sourceDir))) return 0;
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let copiedEntries = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copiedEntries += await copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copiedEntries += 1;
  }
  return copiedEntries;
}

/**
 * Copy a managed media root into a sibling directory using a staging swap.
 * The source is intentionally retained so a failed rollout can be reverted by
 * restoring the previous state value without losing the original files.
 */
export async function migrateManagedMediaRoot(
  sourceRoot: string,
  targetRoot: string,
  options: ManagedMediaMigrationOptions = {}
): Promise<ManagedMediaMigrationResult> {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (sameResolvedPath(source, target)) {
    await ensureManagedMediaDirectories(target);
    return { sourceRoot: source, targetRoot: target, sourceRetained: true, copiedEntries: 0 };
  }
  if (isPathWithin(source, target) || isPathWithin(target, source)) {
    throw new Error("媒体根目录不能嵌套在当前媒体根目录或其子目录中。");
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const rename = options.rename ?? fs.rename;
  const remove = options.remove ?? fs.rm;
  const idFactory = options.idFactory ?? randomUUID;
  const staging = path.join(path.dirname(target), `.crossgen-media-migration-${idFactory()}`);
  const backup = path.join(path.dirname(target), `.crossgen-media-backup-${idFactory()}`);
  let copiedEntries = 0;
  let targetMovedToBackup = false;
  let targetSwapCompleted = false;

  try {
    await ensureManagedMediaDirectories(staging);
    copiedEntries += await copyDirectoryContents(target, staging);
    copiedEntries += await copyDirectoryContents(source, staging);

    if (await pathExists(target)) {
      await rename(target, backup);
      targetMovedToBackup = true;
    }
    await rename(staging, target);
    targetSwapCompleted = true;
    // Cleanup is deliberately best effort after the atomic swap. A failure to
    // remove an old backup must not report migration failure after state can
    // safely point at the new target.
    await remove(backup, { recursive: true, force: true }).catch(() => undefined);
    return { sourceRoot: source, targetRoot: target, sourceRetained: true, copiedEntries };
  } catch (error) {
    await remove(staging, { recursive: true, force: true }).catch(() => undefined);
    if (!targetSwapCompleted && targetMovedToBackup && !(await pathExists(target)) && (await pathExists(backup))) {
      await rename(backup, target).catch(() => undefined);
    }
    throw error;
  }
}

export async function cleanupManagedMediaTemp(
  root: string,
  options: CleanupManagedMediaTempOptions = {}
): Promise<CleanupManagedMediaTempResult> {
  const layout = resolveManagedMediaLayout(root);
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_TEMP_MAX_AGE_MS;
  const result: CleanupManagedMediaTempResult = { scanned: 0, removed: [], retained: [] };

  let entries;
  try {
    entries = await fs.readdir(layout.tempDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    result.scanned += 1;
    const entryPath = path.join(layout.tempDir, entry.name);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat) continue;
    const ageMs = now - stat.mtimeMs;
    if (ageMs >= maxAgeMs) {
      await fs.rm(entryPath, { recursive: true, force: true });
      result.removed.push(entryPath);
    } else {
      result.retained.push(entryPath);
    }
  }
  return result;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
