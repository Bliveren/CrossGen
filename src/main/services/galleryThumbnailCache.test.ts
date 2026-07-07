import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GALLERY_THUMBNAIL_SIZE,
  galleryThumbnailCacheFileName,
  galleryThumbnailCachePath
} from "./galleryThumbnailCache";

describe("gallery thumbnail cache keys", () => {
  it("normalizes path separators for stable cache names", () => {
    const posix = galleryThumbnailCacheFileName({
      relPath: "Products/Hero/shot.png",
      sizeBytes: 1024,
      modifiedMs: 1234,
      width: DEFAULT_GALLERY_THUMBNAIL_SIZE
    });
    const windows = galleryThumbnailCacheFileName({
      relPath: "Products\\Hero\\shot.png",
      sizeBytes: 1024,
      modifiedMs: 1234,
      width: DEFAULT_GALLERY_THUMBNAIL_SIZE
    });

    expect(windows).toBe(posix);
    expect(posix).toMatch(/^[a-f0-9]{64}\.png$/);
  });

  it("invalidates cache names when source metadata or target size changes", () => {
    const base = {
      relPath: "Products/Hero/shot.png",
      sizeBytes: 1024,
      modifiedMs: 1234,
      width: DEFAULT_GALLERY_THUMBNAIL_SIZE
    };

    expect(galleryThumbnailCacheFileName({ ...base, sizeBytes: 2048 })).not.toBe(galleryThumbnailCacheFileName(base));
    expect(galleryThumbnailCacheFileName({ ...base, modifiedMs: 5678 })).not.toBe(galleryThumbnailCacheFileName(base));
    expect(galleryThumbnailCacheFileName({ ...base, width: 512 })).not.toBe(galleryThumbnailCacheFileName(base));
  });

  it("returns cache paths inside the configured cache directory", () => {
    const cacheDir = path.join("/tmp", "crossgen-thumbs");
    const cachePath = galleryThumbnailCachePath(cacheDir, {
      relPath: "Products/Hero/shot.png",
      sizeBytes: 1024,
      modifiedMs: 1234
    });

    expect(path.dirname(cachePath)).toBe(cacheDir);
    expect(path.basename(cachePath)).toMatch(/^[a-f0-9]{64}\.png$/);
  });
});
