import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GalleryAsset, GalleryFolder } from "../../shared/types";
import { getDefaultState, type AppStateFile } from "./stateMigration";
import {
  diskGalleryFoldersFromState,
  galleryCollectionsChanged,
  isIgnoredGalleryEntryName,
  reconcileGalleryDiskChanges,
  reconcileGalleryDiskChangesWithResult,
  reconcileGalleryDiskState,
  reconcileGalleryDiskStateWithResult,
  scanGalleryDisk,
  startGalleryDiskWatchers,
  type DiskGalleryAsset,
  type DiskGalleryFolder,
  type GalleryWatchFn,
  type GalleryWatchHandle
} from "./galleryDiskSync";

const now = "2026-07-06T00:00:00.000Z";
const later = "2026-07-06T01:00:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "image2tools-gallery-sync-"));
  tempDirs.push(dir);
  return dir;
}

function state(patch: Partial<AppStateFile> = {}): AppStateFile {
  return {
    ...getDefaultState(),
    storage: {
      historyDir: "/tmp/history",
      galleryDir: "/tmp/gallery"
    },
    ...patch
  };
}

function folder(name: string, patch: Partial<GalleryFolder> = {}): GalleryFolder {
  return {
    id: `folder-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    parentId: null,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function asset(fileName: string, patch: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    id: `asset-${fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    fileName,
    originalName: fileName.split("/").at(-1) ?? fileName,
    mimeType: "image/png",
    sizeBytes: 1024,
    tags: [],
    source: "import",
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function reconcile(input: AppStateFile, folders: DiskGalleryFolder[], assets: DiskGalleryAsset[]): AppStateFile {
  let folderId = 0;
  let assetId = 0;
  return reconcileGalleryDiskState(input, { folders, assets }, {
    now: later,
    createFolderId: () => `new-folder-${folderId += 1}`,
    createAssetId: () => `new-asset-${assetId += 1}`
  });
}

function reconcileOptions() {
  let folderId = 0;
  let assetId = 0;
  return {
    now: later,
    createFolderId: () => `new-folder-${folderId += 1}`,
    createAssetId: () => `new-asset-${assetId += 1}`
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2500): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("gallery disk sync reconciliation", () => {
  it("scans real nested Gallery directories and ignores temp/system/symlink entries", async () => {
    const galleryDir = await makeTempDir();
    await mkdir(path.join(galleryDir, "Products", "Hero"), { recursive: true });
    await mkdir(path.join(galleryDir, ".hidden-folder"), { recursive: true });
    await writeFile(path.join(galleryDir, "Products", "Hero", "shot.png"), "png");
    await writeFile(path.join(galleryDir, "Products", "Hero", "draft.tmp"), "tmp");
    await writeFile(path.join(galleryDir, "Products", "Hero", ".hidden.png"), "hidden");
    await writeFile(path.join(galleryDir, "Products", "Hero", "notes.txt"), "text");
    await writeFile(path.join(galleryDir, "Products", "Hero", "Thumbs.db"), "system");
    await writeFile(path.join(galleryDir, "root.webp"), "webp");
    await symlink(path.join(galleryDir, "Products"), path.join(galleryDir, "LinkedProducts")).catch(() => undefined);

    const result = await scanGalleryDisk(galleryDir);

    expect(result.folders).toEqual([
      { relPath: "Products", parentRelPath: null, name: "Products" },
      { relPath: "Products/Hero", parentRelPath: "Products", name: "Hero" }
    ]);
    expect(result.assets.map((asset) => asset.relPath)).toEqual(["Products/Hero/shot.png", "root.webp"]);
    expect(result.assets.find((asset) => asset.relPath === "Products/Hero/shot.png")).toEqual(expect.objectContaining({
      folderRelPath: "Products/Hero",
      mimeType: "image/png",
      sizeBytes: 3
    }));
    expect(result.assets.find((asset) => asset.relPath === "root.webp")).toEqual(expect.objectContaining({
      folderRelPath: null,
      mimeType: "image/webp",
      sizeBytes: 4
    }));
  });

  it("supports scanning only changed files or subtrees", async () => {
    const galleryDir = await makeTempDir();
    await mkdir(path.join(galleryDir, "Products", "Hero"), { recursive: true });
    await mkdir(path.join(galleryDir, "Archive"), { recursive: true });
    await writeFile(path.join(galleryDir, "Products", "Hero", "shot.png"), "png");
    await writeFile(path.join(galleryDir, "Archive", "old.png"), "old");

    const fileResult = await scanGalleryDisk(galleryDir, { rootRelPaths: ["Products/Hero/shot.png"] });
    expect(fileResult.folders).toEqual([]);
    expect(fileResult.assets.map((asset) => asset.relPath)).toEqual(["Products/Hero/shot.png"]);

    const folderResult = await scanGalleryDisk(galleryDir, { rootRelPaths: ["Products"] });
    expect(folderResult.folders.map((folder) => folder.relPath)).toEqual(["Products", "Products/Hero"]);
    expect(folderResult.assets.map((asset) => asset.relPath)).toEqual(["Products/Hero/shot.png"]);
  });

  it("matches the watcher ignore policy for temporary and system names", () => {
    expect(isIgnoredGalleryEntryName(".DS_Store")).toBe(true);
    expect(isIgnoredGalleryEntryName("Thumbs.db")).toBe(true);
    expect(isIgnoredGalleryEntryName("desktop.ini")).toBe(true);
    expect(isIgnoredGalleryEntryName(".hidden.png")).toBe(true);
    expect(isIgnoredGalleryEntryName("upload.tmp")).toBe(true);
    expect(isIgnoredGalleryEntryName("photo.png")).toBe(false);
  });

  it("wires watchers for root and nested directories while ignoring transient events", () => {
    const listeners: Array<{ directory: string; listener: Parameters<GalleryWatchFn>[1] }> = [];
    const closed: string[] = [];
    const fakeWatch: GalleryWatchFn = (directory, listener) => {
      listeners.push({ directory, listener });
      return { close: () => closed.push(directory) };
    };
    let syncCount = 0;
    const galleryRoot = path.resolve("/gallery");
    const nestedGalleryPath = path.join(galleryRoot, "Products", "Hero");
    const watchers = startGalleryDiskWatchers(
      galleryRoot,
      [{ relPath: "Products/Hero", parentRelPath: "Products", name: "Hero" }],
      () => { syncCount += 1; },
      { watchFn: fakeWatch }
    );

    expect(listeners.map((item) => item.directory)).toEqual([galleryRoot, nestedGalleryPath]);

    listeners[0].listener("rename", ".DS_Store");
    listeners[0].listener("rename", "upload.tmp");
    listeners[0].listener("rename", "photo.png");

    expect(syncCount).toBe(1);
    watchers.forEach((watcher) => watcher.close());
    expect(closed).toEqual([galleryRoot, nestedGalleryPath]);
  });

  it("passes changed relative paths from watcher events", () => {
    const listeners: Array<{ directory: string; listener: Parameters<GalleryWatchFn>[1] }> = [];
    const fakeWatch: GalleryWatchFn = (directory, listener) => {
      listeners.push({ directory, listener });
      return { close: () => undefined };
    };
    const changed: Array<string | null> = [];
    startGalleryDiskWatchers(
      "/gallery",
      [{ relPath: "Products/Hero", parentRelPath: "Products", name: "Hero" }],
      (relPath) => changed.push(relPath),
      { watchFn: fakeWatch }
    );

    listeners[0].listener("rename", "root.png");
    listeners[1].listener("rename", "shot.png");
    listeners[1].listener("rename", null);

    expect(changed).toEqual(["root.png", "Products/Hero/shot.png", null]);
  });

  it("builds watcher folder entries from nested state folders", () => {
    const products = folder("Products", { id: "folder-products" });
    const hero = folder("Hero", { id: "folder-hero", parentId: products.id });
    const missingParent = folder("Orphan", { id: "folder-orphan", parentId: "missing-parent" });

    expect(diskGalleryFoldersFromState(state({ galleryFolders: [hero, missingParent, products] }))).toEqual([
      { relPath: "Products", parentRelPath: null, name: "Products" },
      { relPath: "Products/Hero", parentRelPath: "Products", name: "Hero" }
    ]);
  });

  it("receives real fs.watch events for non-ignored Gallery changes", async () => {
    const galleryDir = await makeTempDir();
    let syncCount = 0;
    const watchers: GalleryWatchHandle[] = startGalleryDiskWatchers(galleryDir, [], () => {
      syncCount += 1;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await mkdir(path.join(galleryDir, "watched-folder"));
      await writeFile(path.join(galleryDir, "watched.png"), "image");
      await waitFor(() => syncCount > 0, 5000);
    } finally {
      watchers.forEach((watcher) => watcher.close());
    }
  });

  it("rebuilds nested folders from disk while preserving matching metadata", () => {
    const products = folder("Products", { id: "folder-products", color: "#FFAA00" });
    const hero = folder("Hero", { id: "folder-hero", parentId: products.id });
    const existing = asset("Products/Hero/hero.png", {
      id: "asset-hero",
      folderId: hero.id,
      originalName: "Original hero",
      tags: ["product", "hero"],
      source: "result"
    });

    const result = reconcile(
      state({ galleryFolders: [products, hero], galleryAssets: [existing] }),
      [
        { relPath: "Products", parentRelPath: null, name: "Products" },
        { relPath: "Products/Hero", parentRelPath: "Products", name: "Hero" }
      ],
      [
        {
          relPath: "Products/Hero/hero.png",
          folderRelPath: "Products/Hero",
          originalName: "hero.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          modifiedAt: later
        }
      ]
    );

    expect(result.galleryFolders).toEqual([
      expect.objectContaining({ id: products.id, name: "Products", parentId: null, color: "#FFAA00" }),
      expect.objectContaining({ id: hero.id, name: "Hero", parentId: products.id })
    ]);
    expect(result.galleryAssets).toEqual([
      expect.objectContaining({
        id: existing.id,
        fileName: "Products/Hero/hero.png",
        folderId: hero.id,
        originalName: "Original hero",
        tags: ["product", "hero"],
        source: "result",
        sizeBytes: 2048,
        modifiedAt: later
      })
    ]);
  });

  it("does not mark full reconciliation dirty when Gallery collections are unchanged", () => {
    const products = folder("Products", { id: "folder-products" });
    const existing = asset("Products/hero.png", {
      id: "asset-hero",
      folderId: products.id,
      sizeBytes: 2048,
      modifiedAt: later
    });
    const input = state({ galleryFolders: [products], galleryAssets: [existing] });

    const result = reconcileGalleryDiskStateWithResult(
      input,
      {
        folders: [{ relPath: "Products", parentRelPath: null, name: "Products" }],
        assets: [{
          relPath: "Products/hero.png",
          folderRelPath: "Products",
          originalName: "hero.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          modifiedAt: later
        }]
      },
      reconcileOptions()
    );

    expect(galleryCollectionsChanged(input, result.state)).toBe(false);
    expect(result.changed).toBe(false);
  });

  it("adds new disk files and drops state entries that no longer exist on disk", () => {
    const staleFolder = folder("Stale", { id: "folder-stale" });
    const staleAsset = asset("Stale/gone.png", { id: "asset-stale", folderId: staleFolder.id });

    const result = reconcile(
      state({ galleryFolders: [staleFolder], galleryAssets: [staleAsset] }),
      [],
      [
        {
          relPath: "fresh.png",
          folderRelPath: null,
          originalName: "fresh.png",
          mimeType: "image/png",
          sizeBytes: 512,
          modifiedAt: later
        }
      ]
    );

    expect(result.galleryFolders).toEqual([]);
    expect(result.galleryAssets).toEqual([
      expect.objectContaining({
        id: "new-asset-1",
        fileName: "fresh.png",
        originalName: "fresh.png",
        folderId: null,
        tags: [],
        source: "import"
      })
    ]);
  });

  it("merges changed disk files without rebuilding unrelated folders", () => {
    const products = folder("Products", { id: "folder-products" });
    const archive = folder("Archive", { id: "folder-archive" });
    const existing = asset("Archive/old.png", { id: "asset-old", folderId: archive.id, tags: ["keep"] });

    const result = reconcileGalleryDiskChanges(
      state({ galleryFolders: [products, archive], galleryAssets: [existing] }),
      {
        folders: [],
        assets: [{
          relPath: "Products/new.png",
          folderRelPath: "Products",
          originalName: "new.png",
          mimeType: "image/png",
          sizeBytes: 256,
          modifiedAt: later
        }]
      },
      ["Products/new.png"],
      {
        now: later,
        createFolderId: () => "unused-folder",
        createAssetId: () => "asset-new"
      }
    );

    expect(result.galleryFolders).toEqual([products, archive]);
    expect(result.galleryAssets).toEqual([
      existing,
      expect.objectContaining({ id: "asset-new", fileName: "Products/new.png", folderId: products.id })
    ]);
  });

  it("does not mark incremental reconciliation dirty when the changed file metadata is unchanged", () => {
    const products = folder("Products", { id: "folder-products" });
    const existing = asset("Products/hero.png", {
      id: "asset-hero",
      folderId: products.id,
      sizeBytes: 2048,
      modifiedAt: later
    });
    const input = state({ galleryFolders: [products], galleryAssets: [existing] });

    const result = reconcileGalleryDiskChangesWithResult(
      input,
      {
        folders: [],
        assets: [{
          relPath: "Products/hero.png",
          folderRelPath: "Products",
          originalName: "hero.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          modifiedAt: later
        }]
      },
      ["Products/hero.png"],
      reconcileOptions()
    );

    expect(result.changed).toBe(false);
  });

  it("marks incremental reconciliation dirty when changed file metadata differs", () => {
    const products = folder("Products", { id: "folder-products" });
    const existing = asset("Products/hero.png", {
      id: "asset-hero",
      folderId: products.id,
      sizeBytes: 2048,
      modifiedAt: later
    });
    const input = state({ galleryFolders: [products], galleryAssets: [existing] });

    const result = reconcileGalleryDiskChangesWithResult(
      input,
      {
        folders: [],
        assets: [{
          relPath: "Products/hero.png",
          folderRelPath: "Products",
          originalName: "hero.png",
          mimeType: "image/png",
          sizeBytes: 4096,
          modifiedAt: "2026-07-06T02:00:00.000Z"
        }]
      },
      ["Products/hero.png"],
      reconcileOptions()
    );

    expect(result.changed).toBe(true);
  });

  it("reflects an incremental disk file rename as old removal and new file addition", () => {
    const products = folder("Products", { id: "folder-products" });
    const existing = asset("Products/old-name.png", { id: "asset-old", folderId: products.id, tags: ["drop"] });

    const result = reconcileGalleryDiskChanges(
      state({ galleryFolders: [products], galleryAssets: [existing] }),
      {
        folders: [],
        assets: [{
          relPath: "Products/new-name.png",
          folderRelPath: "Products",
          originalName: "new-name.png",
          mimeType: "image/png",
          sizeBytes: 512,
          modifiedAt: later
        }]
      },
      ["Products/old-name.png", "Products/new-name.png"],
      {
        now: later,
        createFolderId: () => "unused-folder",
        createAssetId: () => "asset-new"
      }
    );

    expect(result.galleryFolders).toEqual([products]);
    expect(result.galleryAssets).toEqual([
      expect.objectContaining({
        id: "asset-new",
        fileName: "Products/new-name.png",
        originalName: "new-name.png",
        folderId: products.id,
        tags: []
      })
    ]);
  });

  it("removes only the changed deleted subtree during incremental reconciliation", () => {
    const products = folder("Products", { id: "folder-products" });
    const hero = folder("Hero", { id: "folder-hero", parentId: products.id });
    const archive = folder("Archive", { id: "folder-archive" });
    const heroAsset = asset("Products/Hero/hero.png", { id: "asset-hero", folderId: hero.id });
    const archiveAsset = asset("Archive/old.png", { id: "asset-old", folderId: archive.id });

    const result = reconcileGalleryDiskChanges(
      state({ galleryFolders: [products, hero, archive], galleryAssets: [heroAsset, archiveAsset] }),
      { folders: [], assets: [] },
      ["Products/Hero"],
      {
        now: later,
        createFolderId: () => "unused-folder",
        createAssetId: () => "unused-asset"
      }
    );

    expect(result.galleryFolders).toEqual([products, archive]);
    expect(result.galleryAssets).toEqual([archiveAsset]);
  });
});
