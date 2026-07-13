import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GalleryAsset, GalleryAssetPatch, GalleryFolder, GalleryFolderDeleteResult, GalleryFolderInput } from "../shared/types.js";

export type GalleryDuplicateAction = "cancel" | "replace" | "copy";

export interface GalleryStateSlice {
  galleryFolders: GalleryFolder[];
  galleryAssets: GalleryAsset[];
}

export interface GalleryMutationContext {
  galleryDir: string;
  now?: () => string;
  createFolderId?: () => string;
  createAssetId?: () => string;
  duplicateAction?: GalleryDuplicateAction;
}

export interface GalleryImportResult {
  assets: GalleryAsset[];
  skipped: Array<{ path: string; reason: string; existingAssetId?: string }>;
  replacedAssetIds: string[];
}

export interface GalleryImportOptions {
  source?: GalleryAsset["source"];
  tags?: string[];
  sourceJobId?: string;
  sourceAssetId?: string;
}

export interface GalleryPathResult {
  asset: GalleryAsset;
  path: string;
}

export interface GalleryExportResult {
  asset: GalleryAsset;
  sourcePath: string;
  exportedPath: string;
  replaced: boolean;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_GALLERY_FOLDER_NAME_BYTES = 120;
const MAX_GALLERY_FILE_NAME_BYTES = 180;
const WINDOWS_RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

function nowIso(context: GalleryMutationContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function createFolderId(context: GalleryMutationContext): string {
  return context.createFolderId?.() ?? `gallery_folder_${randomUUID()}`;
}

function createAssetId(context: GalleryMutationContext): string {
  return context.createAssetId?.() ?? `gallery_${randomUUID()}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sameResolvedPath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

async function copyOrMoveFile(sourcePath: string, targetPath: string, removeSource = false): Promise<void> {
  if (sameResolvedPath(sourcePath, targetPath)) return;
  await ensureDir(path.dirname(targetPath));
  if (removeSource) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isNodeError(error) || (error.code !== "EXDEV" && error.code !== "EEXIST")) {
        throw error;
      }
    }
  }
  await fs.copyFile(sourcePath, targetPath);
  if (removeSource) {
    await fs.unlink(sourcePath).catch(() => undefined);
  }
}

function isIgnoredGalleryEntryName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === ".ds_store" || normalized === "thumbs.db" || normalized === "desktop.ini";
}

function isReservedWindowsFileName(name: string): boolean {
  const baseName = name.split(".")[0]?.toUpperCase();
  return Boolean(baseName && WINDOWS_RESERVED_FILE_NAMES.has(baseName));
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const tag = item.trim();
    if (!tag || seen.has(tag)) return [];
    seen.add(tag);
    return [tag];
  });
}

function mergeTags(current: string[], incoming: unknown): string[] {
  return normalizeTags([...current, ...normalizeTags(incoming)]);
}

function mimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function fileContentHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function filePathHash(filePath: string): string {
  return createHash("sha256").update(path.resolve(filePath)).digest("hex");
}

export function normalizeManagedRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Gallery 资源路径无效。");
  }
  return segments.join("/");
}

export function resolveManagedGalleryPath(galleryDir: string, fileName: string): string {
  const normalizedFileName = normalizeManagedRelativePath(fileName);
  const resolved = path.resolve(galleryDir, ...normalizedFileName.split("/"));
  const relative = path.relative(path.resolve(galleryDir), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("无法操作：资源不属于 CrossGen 管理目录。");
  }
  return resolved;
}

export async function assertManagedGalleryFile(galleryDir: string, fileName: string): Promise<string> {
  const resolved = resolveManagedGalleryPath(galleryDir, fileName);
  const realGalleryDir = await fs.realpath(galleryDir);
  const realAssetPath = await fs.realpath(resolved);
  const relative = path.relative(realGalleryDir, realAssetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("无法操作：资源不属于 CrossGen 管理目录。");
  }
  const stat = await fs.stat(realAssetPath);
  if (!stat.isFile()) {
    throw new Error("无法操作：资源不是文件。");
  }
  return resolved;
}

function normalizeGalleryFolderName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeGalleryFolderColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

function normalizeGalleryFolderInput(input: GalleryFolderInput | undefined): { name: string; color?: string; hasColor: boolean } {
  const name = normalizeGalleryFolderName(input?.name);
  if (!name) throw new Error("Gallery 文件夹名称不能为空。");
  if (name.includes("/") || name.includes("\\")) throw new Error("Gallery 文件夹名称不能包含路径分隔符。");
  if (/[<>:"|?*\x00-\x1F]/.test(name)) throw new Error("Gallery 文件夹名称包含非法字符。");
  if (name.endsWith(".") || name.endsWith(" ")) throw new Error("Gallery 文件夹名称不能以空格或句点结尾。");
  if (isIgnoredGalleryEntryName(name) || isReservedWindowsFileName(name)) throw new Error("Gallery 文件夹名称不可用于托管目录。");
  if (Buffer.byteLength(name, "utf8") > MAX_GALLERY_FOLDER_NAME_BYTES) throw new Error("Gallery 文件夹名称过长。");
  return {
    name,
    color: normalizeGalleryFolderColor(input?.color),
    hasColor: Object.prototype.hasOwnProperty.call(input ?? {}, "color")
  };
}

function galleryFolderForId(state: GalleryStateSlice, folderId: string | null | undefined): GalleryFolder | undefined {
  if (!folderId) return undefined;
  return state.galleryFolders.find((folder) => folder.id === folderId);
}

function normalizeGalleryFolderId(state: GalleryStateSlice, folderId?: unknown): string | null {
  if (folderId === undefined || folderId === null || folderId === "" || folderId === "null") return null;
  if (typeof folderId !== "string") throw new Error("Gallery 文件夹不存在。");
  const normalized = folderId.trim();
  if (!normalized) return null;
  if (!state.galleryFolders.some((folder) => folder.id === normalized)) {
    throw new Error("Gallery 文件夹不存在。");
  }
  return normalized;
}

function galleryFolderDiskName(folder: GalleryFolder): string {
  return normalizeGalleryFolderName(folder.name);
}

function galleryFolderSegments(state: GalleryStateSlice, folder: GalleryFolder): string[] {
  const byId = new Map(state.galleryFolders.map((item) => [item.id, item]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: GalleryFolder | undefined = folder;
  while (current) {
    if (visited.has(current.id)) throw new Error("Gallery 文件夹层级存在循环。");
    visited.add(current.id);
    segments.unshift(galleryFolderDiskName(current));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments;
}

function galleryFolderRelativePath(state: GalleryStateSlice, folder: GalleryFolder): string {
  return galleryFolderSegments(state, folder).join("/");
}

function galleryFolderRelativePathForId(state: GalleryStateSlice, folderId: string | null | undefined): string {
  const folder = galleryFolderForId(state, folderId);
  return folder ? galleryFolderRelativePath(state, folder) : "";
}

function galleryFolderAbsolutePath(context: GalleryMutationContext, state: GalleryStateSlice, folder: GalleryFolder): string {
  return resolveManagedGalleryPath(context.galleryDir, galleryFolderRelativePath(state, folder));
}

function galleryAssetBaseName(asset: GalleryAsset): string {
  return path.posix.basename(normalizeManagedRelativePath(asset.fileName));
}

function isGalleryFolderDescendant(state: GalleryStateSlice, folderId: string, maybeAncestorId: string): boolean {
  const byId = new Map(state.galleryFolders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let current = byId.get(folderId)?.parentId ?? null;
  while (current) {
    if (current === maybeAncestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

function galleryFolderSubtreeIds(state: GalleryStateSlice, folderId: string): Set<string> {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.galleryFolders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function normalizeGalleryFolderParentId(state: GalleryStateSlice, parentId?: unknown, movingFolderId?: string): string | null {
  const normalized = normalizeGalleryFolderId(state, parentId);
  if (movingFolderId && normalized) {
    if (normalized === movingFolderId || isGalleryFolderDescendant(state, normalized, movingFolderId)) {
      throw new Error("不能将文件夹移动到自身或其子文件夹。");
    }
  }
  return normalized;
}

function normalizeGalleryAssetNameInput(value: unknown, currentName: string): string {
  const rawName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!rawName) throw new Error("Gallery 图片名称不能为空。");
  if (rawName.includes("/") || rawName.includes("\\")) throw new Error("Gallery 图片名称不能包含路径分隔符。");
  if (/[<>:"|?*\x00-\x1F]/.test(rawName)) throw new Error("Gallery 图片名称包含非法字符。");
  if (rawName.endsWith(".") || rawName.endsWith(" ")) throw new Error("Gallery 图片名称不能以空格或句点结尾。");

  const currentExt = path.posix.extname(currentName).toLowerCase();
  const inputExt = path.posix.extname(rawName).toLowerCase();
  const nextName = inputExt ? rawName : `${rawName}${currentExt || ".png"}`;
  const nextExt = path.posix.extname(nextName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(nextExt)) throw new Error("Gallery 图片名称必须使用 png、jpg、jpeg 或 webp 扩展名。");
  if (isIgnoredGalleryEntryName(nextName) || isReservedWindowsFileName(nextName)) throw new Error("Gallery 图片名称不可用于托管目录。");
  if (Buffer.byteLength(nextName, "utf8") > MAX_GALLERY_FILE_NAME_BYTES) throw new Error("Gallery 图片名称过长。");
  normalizeManagedRelativePath(nextName);
  return nextName;
}

async function uniqueGalleryRelativePath(galleryDir: string, desiredRelPath: string, sourcePath?: string): Promise<string> {
  const normalized = normalizeManagedRelativePath(desiredRelPath);
  const folderName = path.posix.dirname(normalized) === "." ? "" : path.posix.dirname(normalized);
  const baseName = path.posix.basename(normalized, path.posix.extname(normalized));
  const ext = path.posix.extname(normalized);

  for (let index = 0; index < 1000; index += 1) {
    const fileName = index === 0 ? `${baseName}${ext}` : `${baseName}-${index}${ext}`;
    const candidate = folderName ? `${folderName}/${fileName}` : fileName;
    const targetPath = resolveManagedGalleryPath(galleryDir, candidate);
    if (sourcePath && sameResolvedPath(sourcePath, targetPath)) return candidate;
    if (!(await pathExists(targetPath))) return candidate;
  }

  throw new Error("无法创建唯一的 Gallery 文件名。");
}

async function ensureGalleryFolderDirs(context: GalleryMutationContext, state: GalleryStateSlice): Promise<void> {
  await ensureDir(context.galleryDir);
  for (const folder of state.galleryFolders) {
    await ensureDir(galleryFolderAbsolutePath(context, state, folder));
  }
}

async function moveGalleryAssetFileToFolder(context: GalleryMutationContext, state: GalleryStateSlice, asset: GalleryAsset, folderId: string | null): Promise<GalleryAsset> {
  const currentRelPath = normalizeManagedRelativePath(asset.fileName);
  const folder = galleryFolderForId(state, folderId);
  const folderRelPath = folder ? galleryFolderRelativePath(state, folder) : "";
  const desiredNextRelPath = folderRelPath ? `${folderRelPath}/${galleryAssetBaseName(asset)}` : galleryAssetBaseName(asset);
  if (currentRelPath === desiredNextRelPath) {
    return { ...asset, folderId, updatedAt: nowIso(context) };
  }

  const currentPath = resolveManagedGalleryPath(context.galleryDir, currentRelPath);
  const nextRelPath = await uniqueGalleryRelativePath(context.galleryDir, desiredNextRelPath, currentPath);
  const nextPath = resolveManagedGalleryPath(context.galleryDir, nextRelPath);
  if (await pathExists(currentPath)) {
    await copyOrMoveFile(currentPath, nextPath, true);
  }
  return {
    ...asset,
    fileName: nextRelPath,
    folderId,
    updatedAt: nowIso(context)
  };
}

async function renameGalleryAssetFile(context: GalleryMutationContext, state: GalleryStateSlice, asset: GalleryAsset, originalName: unknown): Promise<GalleryAsset> {
  const currentRelPath = normalizeManagedRelativePath(asset.fileName);
  const currentBaseName = galleryAssetBaseName(asset);
  const nextBaseName = normalizeGalleryAssetNameInput(originalName, currentBaseName);
  if (nextBaseName.toLowerCase() === currentBaseName.toLowerCase() && nextBaseName === asset.originalName) {
    return asset;
  }

  const folderRelPath = path.posix.dirname(currentRelPath) === "." ? "" : path.posix.dirname(currentRelPath);
  const desiredRelPath = folderRelPath ? `${folderRelPath}/${nextBaseName}` : nextBaseName;
  const currentPath = resolveManagedGalleryPath(context.galleryDir, currentRelPath);
  const nextRelPath = await uniqueGalleryRelativePath(context.galleryDir, desiredRelPath, currentPath);
  const nextPath = resolveManagedGalleryPath(context.galleryDir, nextRelPath);
  if (await pathExists(currentPath)) {
    await copyOrMoveFile(currentPath, nextPath, true);
  }
  const stat = await fs.stat(nextPath).catch(() => null);
  return {
    ...asset,
    fileName: nextRelPath,
    originalName: path.posix.basename(nextRelPath),
    mimeType: mimeTypeForFile(nextPath),
    sizeBytes: stat?.size ?? asset.sizeBytes,
    modifiedAt: stat?.mtime.toISOString() ?? asset.modifiedAt
  };
}

function sameGalleryFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

async function findDuplicateGalleryAsset(state: GalleryStateSlice, context: GalleryMutationContext, folderId: string | null, contentHash: string, sourcePathHash?: string): Promise<GalleryAsset | undefined> {
  for (const asset of state.galleryAssets) {
    if (!sameGalleryFolder(asset.folderId, folderId)) continue;
    if (sourcePathHash && asset.sourcePathHash === sourcePathHash) return asset;
    if (asset.contentHash === contentHash) return asset;
    if (asset.contentHash) continue;
    const assetPath = resolveManagedGalleryPath(context.galleryDir, normalizeManagedRelativePath(asset.fileName));
    if (!(await pathExists(assetPath))) continue;
    try {
      if ((await fileContentHash(assetPath)) === contentHash) return asset;
    } catch {
      // Ignore unreadable stale files while checking duplicates.
    }
  }
  return undefined;
}

function applyGalleryAssetCreateResult(state: GalleryStateSlice, result: { asset: GalleryAsset | null; replacedAssetId?: string }): GalleryStateSlice {
  if (!result.asset) return state;
  if (result.replacedAssetId) {
    return {
      ...state,
      galleryAssets: state.galleryAssets.map((asset) => asset.id === result.replacedAssetId ? result.asset! : asset)
    };
  }
  return {
    ...state,
    galleryAssets: [result.asset, ...state.galleryAssets]
  };
}

async function createGalleryAssetFromFile(
  state: GalleryStateSlice,
  context: GalleryMutationContext,
  sourcePath: string,
  folderId: string | null,
  options: GalleryImportOptions = {}
): Promise<{ asset: GalleryAsset | null; replacedAssetId?: string; skipped?: { reason: string; existingAssetId?: string } }> {
  if (!isImagePath(sourcePath)) {
    return { asset: null, skipped: { reason: "unsupported_file_type" } };
  }
  await ensureGalleryFolderDirs(context, state);
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("Gallery 只能导入图片文件。");
  const originalName = path.basename(sourcePath);
  const contentHash = await fileContentHash(sourcePath);
  const sourcePathHash = filePathHash(sourcePath);
  const source = options.source ?? "import";
  const tags = normalizeTags(options.tags);
  const duplicate = await findDuplicateGalleryAsset(state, context, folderId, contentHash, sourcePathHash);
  if (duplicate) {
    const duplicateAction = context.duplicateAction ?? "cancel";
    if (duplicateAction === "cancel") {
      return { asset: null, skipped: { reason: "duplicate", existingAssetId: duplicate.id } };
    }
    if (duplicateAction === "replace") {
      const targetPath = resolveManagedGalleryPath(context.galleryDir, normalizeManagedRelativePath(duplicate.fileName));
      await ensureDir(path.dirname(targetPath));
      if (!sameResolvedPath(sourcePath, targetPath)) await fs.copyFile(sourcePath, targetPath);
      const nextStat = await fs.stat(targetPath);
      return {
        replacedAssetId: duplicate.id,
        asset: {
          ...duplicate,
          originalName,
          mimeType: mimeTypeForFile(sourcePath),
          sizeBytes: nextStat.size,
          tags: mergeTags(duplicate.tags, tags),
          source,
          updatedAt: nowIso(context),
          contentHash,
          sourcePathHash,
          sourceJobId: options.sourceJobId,
          sourceAssetId: options.sourceAssetId,
          modifiedAt: nextStat.mtime.toISOString()
        }
      };
    }
  }

  const folder = galleryFolderForId(state, folderId);
  const folderName = folder ? galleryFolderRelativePath(state, folder) : "";
  const desiredRelPath = folderName ? `${folderName}/${originalName}` : originalName;
  const fileName = await uniqueGalleryRelativePath(context.galleryDir, desiredRelPath);
  const targetPath = resolveManagedGalleryPath(context.galleryDir, fileName);
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
  return {
    asset: {
      id: createAssetId(context),
      fileName,
      originalName: path.posix.basename(fileName),
      mimeType: mimeTypeForFile(sourcePath),
      sizeBytes: stat.size,
      folderId,
      tags,
      source,
      createdAt: nowIso(context),
      updatedAt: nowIso(context),
      contentHash,
      sourcePathHash,
      sourceJobId: options.sourceJobId,
      sourceAssetId: options.sourceAssetId,
      modifiedAt: stat.mtime.toISOString()
    }
  };
}

export async function createGalleryFolder(state: GalleryStateSlice, context: GalleryMutationContext, input: GalleryFolderInput): Promise<{ state: GalleryStateSlice; folder: GalleryFolder }> {
  const { name, color } = normalizeGalleryFolderInput(input);
  const parentId = normalizeGalleryFolderParentId(state, input?.parentId);
  if (state.galleryFolders.some((folder) => (folder.parentId ?? null) === parentId && folder.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Gallery 文件夹名称已存在。");
  }
  const now = nowIso(context);
  const folder: GalleryFolder = {
    id: createFolderId(context),
    name,
    parentId,
    color,
    createdAt: now,
    updatedAt: now
  };
  const nextState = { ...state, galleryFolders: [folder, ...state.galleryFolders] };
  await ensureDir(galleryFolderAbsolutePath(context, nextState, folder));
  return { state: nextState, folder };
}

export async function renameGalleryFolder(state: GalleryStateSlice, context: GalleryMutationContext, id: string, input: GalleryFolderInput): Promise<{ state: GalleryStateSlice; folder: GalleryFolder }> {
  const folder = state.galleryFolders.find((item) => item.id === id);
  if (!folder) throw new Error("Gallery 文件夹不存在。");
  const { name, color, hasColor } = normalizeGalleryFolderInput(input);
  const parentId = Object.prototype.hasOwnProperty.call(input ?? {}, "parentId")
    ? normalizeGalleryFolderParentId(state, input?.parentId, id)
    : folder.parentId ?? null;
  if (state.galleryFolders.some((item) => item.id !== id && (item.parentId ?? null) === parentId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Gallery 文件夹名称已存在。");
  }

  const updated: GalleryFolder = {
    ...folder,
    name,
    parentId,
    color: hasColor ? color : folder.color,
    updatedAt: nowIso(context)
  };
  const oldDir = galleryFolderAbsolutePath(context, state, folder);
  const nextFolders = state.galleryFolders.map((item) => item.id === id ? updated : item);
  const nextFolderState = { ...state, galleryFolders: nextFolders };
  const newDir = galleryFolderAbsolutePath(context, nextFolderState, updated);
  if (!sameResolvedPath(oldDir, newDir)) {
    await ensureDir(path.dirname(newDir));
    if (await pathExists(oldDir)) {
      await fs.rename(oldDir, newDir);
    } else {
      await ensureDir(newDir);
    }
  }

  const subtreeIds = galleryFolderSubtreeIds(state, id);
  const galleryAssets = state.galleryAssets.map((asset) => {
    if (!asset.folderId || !subtreeIds.has(asset.folderId)) return asset;
    return {
      ...asset,
      fileName: normalizeManagedRelativePath(path.posix.join(galleryFolderRelativePathForId(nextFolderState, asset.folderId), galleryAssetBaseName(asset))),
      updatedAt: updated.updatedAt
    };
  });
  return {
    state: {
      ...state,
      galleryFolders: nextFolders,
      galleryAssets
    },
    folder: updated
  };
}

export async function moveGalleryFolder(state: GalleryStateSlice, context: GalleryMutationContext, id: string, parentId: string | null): Promise<{ state: GalleryStateSlice; folder: GalleryFolder }> {
  const folder = state.galleryFolders.find((item) => item.id === id);
  if (!folder) throw new Error("Gallery 文件夹不存在。");
  return renameGalleryFolder(state, context, id, { name: folder.name, color: folder.color, parentId });
}

export async function deleteGalleryFolder(state: GalleryStateSlice, context: GalleryMutationContext, id: string): Promise<{ state: GalleryStateSlice; result: GalleryFolderDeleteResult }> {
  const folder = state.galleryFolders.find((item) => item.id === id);
  if (!folder) throw new Error("Gallery 文件夹不存在。");
  const subtreeIds = galleryFolderSubtreeIds(state, id);
  const movedAssets: GalleryAsset[] = [];
  for (const asset of state.galleryAssets) {
    movedAssets.push(asset.folderId && subtreeIds.has(asset.folderId) ? await moveGalleryAssetFileToFolder(context, state, asset, null) : asset);
  }
  const nextState: GalleryStateSlice = {
    ...state,
    galleryFolders: state.galleryFolders.filter((candidate) => !subtreeIds.has(candidate.id)),
    galleryAssets: movedAssets.map((asset) => asset.folderId && subtreeIds.has(asset.folderId) ? { ...asset, folderId: null, updatedAt: nowIso(context) } : asset)
  };
  await fs.rm(galleryFolderAbsolutePath(context, state, folder), { recursive: true, force: true }).catch(() => undefined);
  return {
    state: nextState,
    result: {
      folders: nextState.galleryFolders,
      assets: nextState.galleryAssets
    }
  };
}

export async function importGalleryAssets(
  state: GalleryStateSlice,
  context: GalleryMutationContext,
  sourcePaths: string[],
  folderId?: string | null,
  options: GalleryImportOptions = {}
): Promise<{ state: GalleryStateSlice; result: GalleryImportResult }> {
  let nextState = state;
  const targetFolderId = normalizeGalleryFolderId(state, folderId);
  const result: GalleryImportResult = {
    assets: [],
    skipped: [],
    replacedAssetIds: []
  };

  for (const sourcePath of sourcePaths) {
    if (typeof sourcePath !== "string" || !sourcePath.trim()) continue;
    const created = await createGalleryAssetFromFile(nextState, context, path.resolve(sourcePath), targetFolderId, options);
    if (created.skipped) {
      result.skipped.push({ path: sourcePath, reason: created.skipped.reason, existingAssetId: created.skipped.existingAssetId });
      continue;
    }
    if (!created.asset) continue;
    result.assets.push(created.asset);
    if (created.replacedAssetId) result.replacedAssetIds.push(created.replacedAssetId);
    nextState = applyGalleryAssetCreateResult(nextState, created);
  }

  return { state: nextState, result };
}

export async function updateGalleryAsset(state: GalleryStateSlice, context: GalleryMutationContext, id: string, patch: GalleryAssetPatch = {}): Promise<{ state: GalleryStateSlice; asset: GalleryAsset }> {
  const normalizedPatch = patch && typeof patch === "object" ? patch : {};
  const asset = state.galleryAssets.find((item) => item.id === id);
  if (!asset) throw new Error("Gallery 资源不存在。");
  const hasTagsPatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "tags");
  const hasFolderPatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "folderId");
  const hasNamePatch = Object.prototype.hasOwnProperty.call(normalizedPatch, "originalName");
  const movedAsset = hasFolderPatch
    ? await moveGalleryAssetFileToFolder(context, state, asset, normalizeGalleryFolderId(state, normalizedPatch.folderId))
    : asset;
  const renamedAsset = hasNamePatch
    ? await renameGalleryAssetFile(context, state, movedAsset, normalizedPatch.originalName)
    : movedAsset;
  const updated: GalleryAsset = {
    ...renamedAsset,
    tags: hasTagsPatch ? normalizeTags(normalizedPatch.tags) : renamedAsset.tags,
    updatedAt: nowIso(context)
  };
  return {
    state: { ...state, galleryAssets: state.galleryAssets.map((item) => item.id === id ? updated : item) },
    asset: updated
  };
}

export async function removeGalleryAsset(state: GalleryStateSlice, context: GalleryMutationContext, id: string): Promise<{ state: GalleryStateSlice; assets: GalleryAsset[]; removed?: GalleryAsset }> {
  const asset = state.galleryAssets.find((item) => item.id === id);
  const galleryAssets = state.galleryAssets.filter((item) => item.id !== id);
  if (asset) {
    const filePath = resolveManagedGalleryPath(context.galleryDir, asset.fileName);
    await fs.unlink(filePath).catch(() => undefined);
  }
  return {
    state: { ...state, galleryAssets },
    assets: galleryAssets,
    removed: asset
  };
}

export async function resolveGalleryAssetPath(state: GalleryStateSlice, context: GalleryMutationContext, id: string): Promise<GalleryPathResult> {
  const asset = state.galleryAssets.find((item) => item.id === id);
  if (!asset) throw new Error("Gallery 资源不存在。");
  return {
    asset,
    path: await assertManagedGalleryFile(context.galleryDir, asset.fileName)
  };
}

export async function exportGalleryAsset(
  state: GalleryStateSlice,
  context: GalleryMutationContext,
  id: string,
  targetPath: string,
  options: { replace?: boolean } = {}
): Promise<GalleryExportResult> {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("导出路径不能为空。");
  }
  const { asset, path: sourcePath } = await resolveGalleryAssetPath(state, context, id);
  const resolvedTarget = path.resolve(targetPath);
  const targetStat = await fs.stat(resolvedTarget).catch(() => null);
  const finalTarget = targetStat?.isDirectory() ? path.join(resolvedTarget, asset.originalName) : resolvedTarget;
  if (sameResolvedPath(sourcePath, finalTarget)) {
    throw new Error("导出路径不能与原文件相同。");
  }
  const exists = await pathExists(finalTarget);
  if (exists && !options.replace) {
    throw new Error("导出目标已存在，请使用 --replace 明确覆盖。");
  }
  await ensureDir(path.dirname(finalTarget));
  await fs.copyFile(sourcePath, finalTarget);
  return {
    asset,
    sourcePath,
    exportedPath: finalTarget,
    replaced: exists
  };
}

export function getGalleryAssetPublicMetadata(asset: GalleryAsset) {
  return {
    id: asset.id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    kind: asset.kind ?? "image",
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    folderId: asset.folderId ?? null,
    tags: asset.tags,
    source: asset.source,
    sourceJobId: asset.sourceJobId,
    sourceAssetId: asset.sourceAssetId,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    modifiedAt: asset.modifiedAt,
    hasContentHash: Boolean(asset.contentHash),
    hasSourcePathHash: Boolean(asset.sourcePathHash)
  };
}
