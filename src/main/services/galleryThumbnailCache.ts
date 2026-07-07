import { createHash } from "node:crypto";
import path from "node:path";

export const DEFAULT_GALLERY_THUMBNAIL_SIZE = 256;

export interface GalleryThumbnailCacheInput {
  relPath: string;
  sizeBytes: number;
  modifiedMs: number;
  width?: number;
}

function normalizeThumbnailRelPath(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

export function galleryThumbnailCacheFileName(input: GalleryThumbnailCacheInput): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      relPath: normalizeThumbnailRelPath(input.relPath),
      sizeBytes: input.sizeBytes,
      modifiedMs: Math.trunc(input.modifiedMs),
      width: input.width ?? DEFAULT_GALLERY_THUMBNAIL_SIZE
    }))
    .digest("hex");
  return `${hash}.png`;
}

export function galleryThumbnailCachePath(cacheDir: string, input: GalleryThumbnailCacheInput): string {
  return path.join(cacheDir, galleryThumbnailCacheFileName(input));
}
