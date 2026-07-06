import path from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import type { GalleryAsset, GalleryFolder } from "../../shared/types.js";
import { resolveManagedFileName } from "./assetOwnership.js";
import type { AppStateFile } from "./stateMigration.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const IGNORED_GALLERY_ENTRY_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const MAX_GALLERY_FOLDER_DEPTH = 16;

export interface DiskGalleryFolder {
  relPath: string;
  parentRelPath: string | null;
  name: string;
}

export interface DiskGalleryAsset {
  relPath: string;
  folderRelPath: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface GalleryDiskReconcileOptions {
  now: string;
  createFolderId: () => string;
  createAssetId: () => string;
}

export interface ScanGalleryDiskOptions {
  rootRelPaths?: string[];
}

export type GalleryWatchHandle = Pick<FSWatcher, "close">;
export type GalleryWatchFn = (
  directory: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => GalleryWatchHandle;

export interface GalleryDiskWatchOptions {
  watchFn?: GalleryWatchFn;
  onWatchError?: (error: unknown) => void;
}

function toPosixRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function mimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function readDirEntries(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

export function isIgnoredGalleryEntryName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith(".") || normalized.endsWith(".tmp") || IGNORED_GALLERY_ENTRY_NAMES.has(normalized);
}

export function startGalleryDiskWatchers(
  galleryDir: string,
  folders: DiskGalleryFolder[],
  scheduleSync: (changedRelPath: string | null) => void,
  options: GalleryDiskWatchOptions = {}
): GalleryWatchHandle[] {
  const watchFn = options.watchFn ?? watch;
  const directories = [
    galleryDir,
    ...folders.map((folder) => resolveManagedFileName(galleryDir, folder.relPath))
  ];
  const watchers: GalleryWatchHandle[] = [];

  for (const directory of directories) {
    try {
      watchers.push(watchFn(directory, (_eventType, filename) => {
        if (!filename) {
          scheduleSync(null);
          return;
        }
        const name = String(filename);
        if (isIgnoredGalleryEntryName(name)) return;
        const directoryRelPath = path.relative(galleryDir, directory);
        const changedRelPath = directoryRelPath
          ? toPosixRelativePath(path.join(directoryRelPath, name))
          : name;
        try {
          scheduleSync(normalizeGalleryRelativePath(changedRelPath));
        } catch {
          scheduleSync(null);
        }
      }));
    } catch (error) {
      options.onWatchError?.(error);
    }
  }

  return watchers;
}

function normalizeGalleryRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid Gallery relative path.");
  }
  return segments.join("/");
}

export async function scanGalleryDisk(galleryDir: string, options: ScanGalleryDiskOptions = {}): Promise<{ folders: DiskGalleryFolder[]; assets: DiskGalleryAsset[] }> {
  const folders: DiskGalleryFolder[] = [];
  const assets: DiskGalleryAsset[] = [];
  const seenFolders = new Set<string>();
  const seenAssets = new Set<string>();

  async function scanFile(fileRelPath: string): Promise<void> {
    const normalizedRelPath = normalizeGalleryRelativePath(fileRelPath);
    if (seenAssets.has(normalizedRelPath.toLowerCase())) return;
    const fileName = path.posix.basename(normalizedRelPath);
    if (isIgnoredGalleryEntryName(fileName) || !IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return;
    const filePath = resolveManagedFileName(galleryDir, normalizedRelPath);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
    if (!stat.isFile()) return;
    seenAssets.add(normalizedRelPath.toLowerCase());
    const parentRelPath = path.posix.dirname(normalizedRelPath) === "." ? null : path.posix.dirname(normalizedRelPath);
    assets.push({
      relPath: normalizedRelPath,
      folderRelPath: parentRelPath,
      originalName: fileName,
      mimeType: mimeTypeForFile(filePath),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }

  async function scanDirectory(dirRelPath: string, depth: number): Promise<void> {
    if (depth > MAX_GALLERY_FOLDER_DEPTH) return;
    const dirPath = dirRelPath ? resolveManagedFileName(galleryDir, dirRelPath) : galleryDir;
    const entries = (await readDirEntries(dirPath)).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (isIgnoredGalleryEntryName(entry.name) || entry.isSymbolicLink()) continue;
      const relPath = dirRelPath ? `${dirRelPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const normalizedRelPath = normalizeGalleryRelativePath(relPath);
        if (!seenFolders.has(normalizedRelPath.toLowerCase())) {
          seenFolders.add(normalizedRelPath.toLowerCase());
          folders.push({
            relPath: normalizedRelPath,
            parentRelPath: dirRelPath ? normalizeGalleryRelativePath(dirRelPath) : null,
            name: entry.name
          });
        }
        await scanDirectory(normalizedRelPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      await scanFile(relPath);
    }
  }

  if (!options.rootRelPaths || options.rootRelPaths.length === 0) {
    await scanDirectory("", 0);
    return { folders, assets };
  }

  const rootRelPaths = [...new Set(options.rootRelPaths.map((item) => {
    try {
      return normalizeGalleryRelativePath(item);
    } catch {
      return "";
    }
  }).filter(Boolean))];

  for (const rootRelPath of rootRelPaths) {
    const rootName = path.posix.basename(rootRelPath);
    if (isIgnoredGalleryEntryName(rootName)) continue;
    const rootPath = resolveManagedFileName(galleryDir, rootRelPath);
    let stat;
    try {
      stat = await fs.lstat(rootPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!seenFolders.has(rootRelPath.toLowerCase())) {
        seenFolders.add(rootRelPath.toLowerCase());
        folders.push({
          relPath: rootRelPath,
          parentRelPath: path.posix.dirname(rootRelPath) === "." ? null : path.posix.dirname(rootRelPath),
          name: rootName
        });
      }
      await scanDirectory(rootRelPath, 1);
    } else if (stat.isFile()) {
      await scanFile(rootRelPath);
    }
  }

  return { folders, assets };
}

function normalizeGalleryFolderName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function galleryFolderRelativePath(state: AppStateFile, folder: GalleryFolder): string {
  const byId = new Map(state.galleryFolders.map((item) => [item.id, item]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: GalleryFolder | undefined = folder;
  while (current) {
    if (visited.has(current.id)) throw new Error("Gallery folder hierarchy contains a cycle.");
    visited.add(current.id);
    segments.unshift(normalizeGalleryFolderName(current.name));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments.join("/");
}

export function reconcileGalleryDiskState(
  inputState: AppStateFile,
  disk: { folders: DiskGalleryFolder[]; assets: DiskGalleryAsset[] },
  options: GalleryDiskReconcileOptions
): AppStateFile {
  const existingFolderByRelPath = new Map<string, GalleryFolder>();
  for (const folder of inputState.galleryFolders) {
    try {
      existingFolderByRelPath.set(galleryFolderRelativePath(inputState, folder).toLowerCase(), folder);
    } catch {
      // Ignore any bad legacy edge that migration did not already clean up.
    }
  }

  const folders: GalleryFolder[] = [];
  const relPathToFolderId = new Map<string, string>();
  const seenSiblingNames = new Set<string>();
  for (const diskFolder of disk.folders) {
    const parentId = diskFolder.parentRelPath ? relPathToFolderId.get(diskFolder.parentRelPath.toLowerCase()) ?? null : null;
    if (diskFolder.parentRelPath && !parentId) continue;
    const siblingKey = `${parentId ?? ""}\u0000${diskFolder.name.toLowerCase()}`;
    if (seenSiblingNames.has(siblingKey)) continue;
    seenSiblingNames.add(siblingKey);
    const existing = existingFolderByRelPath.get(diskFolder.relPath.toLowerCase());
    const folder: GalleryFolder = {
      id: existing?.id ?? options.createFolderId(),
      name: diskFolder.name,
      parentId,
      color: existing?.color,
      createdAt: existing?.createdAt ?? options.now,
      updatedAt: existing?.updatedAt ?? options.now
    };
    folders.push(folder);
    relPathToFolderId.set(diskFolder.relPath.toLowerCase(), folder.id);
  }

  const existingAssetByRelPath = new Map<string, GalleryAsset>();
  for (const asset of inputState.galleryAssets) {
    try {
      existingAssetByRelPath.set(normalizeGalleryRelativePath(asset.fileName).toLowerCase(), asset);
    } catch {
      // Drop invalid managed paths during disk reconciliation.
    }
  }

  const galleryAssets = disk.assets.map((diskAsset): GalleryAsset => {
    const existing = existingAssetByRelPath.get(diskAsset.relPath.toLowerCase());
    const folderId = diskAsset.folderRelPath ? relPathToFolderId.get(diskAsset.folderRelPath.toLowerCase()) ?? null : null;
    return {
      id: existing?.id ?? options.createAssetId(),
      fileName: diskAsset.relPath,
      originalName: existing?.originalName ?? diskAsset.originalName,
      mimeType: diskAsset.mimeType,
      sizeBytes: diskAsset.sizeBytes,
      width: existing?.width,
      height: existing?.height,
      folderId,
      tags: existing?.tags ?? [],
      source: existing?.source ?? "import",
      createdAt: existing?.createdAt ?? options.now,
      updatedAt: existing?.updatedAt ?? options.now,
      modifiedAt: diskAsset.modifiedAt
    };
  });

  return {
    ...inputState,
    galleryFolders: folders,
    galleryAssets
  };
}

function isPathWithin(rootRelPath: string, candidateRelPath: string): boolean {
  return candidateRelPath === rootRelPath || candidateRelPath.startsWith(`${rootRelPath}/`);
}

export function reconcileGalleryDiskChanges(
  inputState: AppStateFile,
  disk: { folders: DiskGalleryFolder[]; assets: DiskGalleryAsset[] },
  changedRelPaths: string[],
  options: GalleryDiskReconcileOptions
): AppStateFile {
  const roots = [...new Set(changedRelPaths.map((item) => {
    try {
      return normalizeGalleryRelativePath(item);
    } catch {
      return "";
    }
  }).filter(Boolean))];
  if (roots.length === 0) return inputState;

  const existingFolderByRelPath = new Map<string, GalleryFolder>();
  const existingFolderRelPathById = new Map<string, string>();
  for (const folder of inputState.galleryFolders) {
    try {
      const relPath = galleryFolderRelativePath(inputState, folder);
      existingFolderByRelPath.set(relPath.toLowerCase(), folder);
      existingFolderRelPathById.set(folder.id, relPath);
    } catch {
      // Ignore any bad legacy edge that migration did not already clean up.
    }
  }

  const existingAssetByRelPath = new Map<string, GalleryAsset>();
  for (const asset of inputState.galleryAssets) {
    try {
      existingAssetByRelPath.set(normalizeGalleryRelativePath(asset.fileName).toLowerCase(), asset);
    } catch {
      // Drop invalid managed paths during disk reconciliation.
    }
  }

  const diskFolderRelPaths = new Set(disk.folders.map((folder) => folder.relPath.toLowerCase()));
  const diskAssetRelPaths = new Set(disk.assets.map((asset) => asset.relPath.toLowerCase()));
  const folderRoots = roots.filter((root) => {
    const lower = root.toLowerCase();
    return (
      diskFolderRelPaths.has(lower) ||
      existingFolderByRelPath.has(lower) ||
      disk.folders.some((folder) => isPathWithin(root, folder.relPath)) ||
      inputState.galleryFolders.some((folder) => {
        const relPath = existingFolderRelPathById.get(folder.id);
        return relPath ? isPathWithin(root, relPath) : false;
      }) ||
      disk.assets.some((asset) => asset.relPath.startsWith(`${root}/`)) ||
      inputState.galleryAssets.some((asset) => {
        try {
          return normalizeGalleryRelativePath(asset.fileName).startsWith(`${root}/`);
        } catch {
          return false;
        }
      }) ||
      !IMAGE_EXTENSIONS.has(path.extname(root).toLowerCase())
    );
  });
  const assetRoots = roots.filter((root) => !folderRoots.includes(root));

  const isAffectedFolder = (folder: GalleryFolder): boolean => {
    const relPath = existingFolderRelPathById.get(folder.id);
    return Boolean(relPath && folderRoots.some((root) => isPathWithin(root, relPath)));
  };
  const isAffectedAsset = (asset: GalleryAsset): boolean => {
    let relPath = "";
    try {
      relPath = normalizeGalleryRelativePath(asset.fileName);
    } catch {
      return true;
    }
    return (
      folderRoots.some((root) => isPathWithin(root, relPath)) ||
      assetRoots.some((root) => relPath === root)
    );
  };

  const folders: GalleryFolder[] = inputState.galleryFolders.filter((folder) => !isAffectedFolder(folder));
  const relPathToFolderId = new Map<string, string>();
  const seenSiblingNames = new Set<string>();
  for (const folder of folders) {
    const relPath = existingFolderRelPathById.get(folder.id);
    if (relPath) relPathToFolderId.set(relPath.toLowerCase(), folder.id);
    seenSiblingNames.add(`${folder.parentId ?? ""}\u0000${folder.name.toLowerCase()}`);
  }

  for (const diskFolder of disk.folders) {
    const parentId = diskFolder.parentRelPath ? relPathToFolderId.get(diskFolder.parentRelPath.toLowerCase()) ?? null : null;
    if (diskFolder.parentRelPath && !parentId) continue;
    const siblingKey = `${parentId ?? ""}\u0000${diskFolder.name.toLowerCase()}`;
    if (seenSiblingNames.has(siblingKey)) continue;
    seenSiblingNames.add(siblingKey);
    const existing = existingFolderByRelPath.get(diskFolder.relPath.toLowerCase());
    const folder: GalleryFolder = {
      id: existing?.id ?? options.createFolderId(),
      name: diskFolder.name,
      parentId,
      color: existing?.color,
      createdAt: existing?.createdAt ?? options.now,
      updatedAt: existing?.updatedAt ?? options.now
    };
    folders.push(folder);
    relPathToFolderId.set(diskFolder.relPath.toLowerCase(), folder.id);
  }

  const galleryAssets = inputState.galleryAssets.filter((asset) => !isAffectedAsset(asset));
  for (const diskAsset of disk.assets) {
    const existing = existingAssetByRelPath.get(diskAsset.relPath.toLowerCase());
    const folderId = diskAsset.folderRelPath ? relPathToFolderId.get(diskAsset.folderRelPath.toLowerCase()) ?? null : null;
    if (diskAsset.folderRelPath && !folderId) continue;
    galleryAssets.push({
      id: existing?.id ?? options.createAssetId(),
      fileName: diskAsset.relPath,
      originalName: existing?.originalName ?? diskAsset.originalName,
      mimeType: diskAsset.mimeType,
      sizeBytes: diskAsset.sizeBytes,
      width: existing?.width,
      height: existing?.height,
      folderId,
      tags: existing?.tags ?? [],
      source: existing?.source ?? "import",
      createdAt: existing?.createdAt ?? options.now,
      updatedAt: existing?.updatedAt ?? options.now,
      modifiedAt: diskAsset.modifiedAt
    });
  }

  return {
    ...inputState,
    galleryFolders: folders,
    galleryAssets
  };
}
