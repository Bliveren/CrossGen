import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { InputAsset, InputAssetCopyRequest } from "../../shared/types.js";

export const MAX_INPUT_ASSET_COPY_BYTES = 50 * 1024 * 1024;

type InputAssetCopyMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface InputAssetCopyImage {
  isEmpty: () => boolean;
  getSize: () => { width: number; height: number };
}

export interface SaveInputAssetCopyOptions {
  input: InputAssetCopyRequest;
  mediaRoot: string;
  decodeImage: (bytes: Uint8Array) => InputAssetCopyImage;
  createAsset: (filePath: string) => Promise<InputAsset>;
  maxBytes?: number;
  ensureDirectory?: (directory: string) => Promise<void>;
  writeFile?: (filePath: string, data: Uint8Array, options?: { flag?: string }) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  remove?: (filePath: string, options?: { force?: boolean }) => Promise<void>;
  fileToken?: () => string;
}

export function inputAssetCopySourceIdIsSafe(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,200}$/.test(value);
}

function inputAssetCopyMimeType(value: unknown): value is InputAssetCopyMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function inputAssetCopyFileExtension(mimeType: InputAssetCopyMimeType): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export function decodeInputAssetCopy(input: unknown, maxBytes = MAX_INPUT_ASSET_COPY_BYTES): { mimeType: InputAssetCopyMimeType; bytes: Buffer } {
  if (typeof input !== "string") {
    throw new Error("参考图副本内容无效。");
  }
  const value = input.trim();
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  if (!match || !inputAssetCopyMimeType(match[1])) {
    throw new Error("参考图副本必须是 png、jpg、jpeg 或 webp data URL。");
  }
  const payload = match[2].replace(/\s+/g, "");
  if (!payload) throw new Error("参考图副本内容为空。");
  if (payload.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error("参考图副本内容无效。");
  }
  if (payload.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error("参考图副本超过 50 MB 限制。");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0) throw new Error("参考图副本内容为空。");
  if (bytes.length > maxBytes) {
    throw new Error("参考图副本超过 50 MB 限制。");
  }
  return { mimeType: match[1], bytes };
}

function defaultWriteFile(filePath: string, data: Uint8Array, options?: { flag?: string }): Promise<void> {
  return fs.writeFile(filePath, data, options);
}

function defaultRemove(filePath: string, options?: { force?: boolean }): Promise<void> {
  return fs.rm(filePath, options);
}

export function inputAssetCopyOriginalName(input: InputAssetCopyRequest, extension: string): string {
  return typeof input.originalName === "string" && input.originalName.trim()
    ? path.basename(input.originalName.trim())
    : `reference-copy.${extension}`;
}

export async function saveInputAssetCopy(options: SaveInputAssetCopyOptions): Promise<InputAsset> {
  const input = options.input;
  if (!input || typeof input !== "object") {
    throw new Error("参考图副本请求无效。");
  }
  if (!inputAssetCopySourceIdIsSafe(input.sourceAssetId)) {
    throw new Error("参考图来源资产 ID 无效。");
  }
  if (input.sourceOperation !== "annotation" && input.sourceOperation !== "crop" && input.sourceOperation !== "import") {
    throw new Error("参考图副本来源操作无效。");
  }

  const { mimeType, bytes } = decodeInputAssetCopy(input.dataUrl, options.maxBytes);
  const image = options.decodeImage(bytes);
  if (image.isEmpty()) throw new Error("参考图副本无法读取。");
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) throw new Error("参考图副本尺寸无效。");

  const referencesDir = path.join(path.resolve(options.mediaRoot), "originals", "references");
  const ensureDirectory = options.ensureDirectory ?? ((directory: string) => fs.mkdir(directory, { recursive: true }));
  const writeFile = options.writeFile ?? defaultWriteFile;
  const rename = options.rename ?? fs.rename;
  const remove = options.remove ?? defaultRemove;
  await ensureDirectory(referencesDir);

  const extension = inputAssetCopyFileExtension(mimeType);
  const token = options.fileToken?.() ?? `${Date.now()}-${randomUUID()}`;
  const filePath = path.join(referencesDir, `reference-${token}.${extension}`);
  const tempPath = `${filePath}.tmp`;

  try {
    await writeFile(tempPath, bytes, { flag: "wx" });
    await rename(tempPath, filePath);
    const asset = await options.createAsset(filePath);
    return {
      ...asset,
      name: inputAssetCopyOriginalName(input, extension),
      sourceAssetId: input.sourceAssetId,
      sourceOperation: input.sourceOperation,
      previewUrl: `image2tools-asset://image?path=${encodeURIComponent(filePath)}`
    };
  } catch (error) {
    await remove(tempPath, { force: true }).catch(() => undefined);
    await remove(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
