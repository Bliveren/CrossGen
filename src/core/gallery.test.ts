import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGalleryFolder,
  exportGalleryAsset,
  importGalleryAssets,
  removeGalleryAsset,
  resolveGalleryAssetPath,
  type GalleryMutationContext,
  type GalleryStateSlice
} from "./gallery";

function state(patch: Partial<GalleryStateSlice> = {}): GalleryStateSlice {
  return {
    galleryFolders: [],
    galleryAssets: [],
    ...patch
  };
}

async function tempContext(): Promise<{ dir: string; galleryDir: string; context: GalleryMutationContext }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crossgen-gallery-core-"));
  const galleryDir = path.join(dir, "gallery");
  return {
    dir,
    galleryDir,
    context: {
      galleryDir,
      now: () => "2026-07-14T00:00:00.000Z",
      createFolderId: () => "folder_1",
      createAssetId: () => "asset_1"
    }
  };
}

describe("gallery core mutations", () => {
  it("rejects illegal and Windows-reserved folder names", async () => {
    const { context } = await tempContext();

    await expect(createGalleryFolder(state(), context, { name: "../bad" })).rejects.toThrow("不能包含路径分隔符");
    await expect(createGalleryFolder(state(), context, { name: "CON" })).rejects.toThrow("不可用于托管目录");
  });

  it("creates folders and imports image assets into managed Gallery paths", async () => {
    const { dir, galleryDir, context } = await tempContext();
    const sourcePath = path.join(dir, "source.png");
    await writeFile(sourcePath, Buffer.from("image-one"));

    const createdFolder = await createGalleryFolder(state(), context, { name: "Campaign" });
    const imported = await importGalleryAssets(createdFolder.state, context, [sourcePath], createdFolder.folder.id);

    expect(imported.result.assets).toHaveLength(1);
    expect(imported.result.assets[0]).toMatchObject({
      id: "asset_1",
      originalName: "source.png",
      folderId: "folder_1",
      source: "import"
    });
    const managedPath = path.join(galleryDir, "Campaign", "source.png");
    await expect(readFile(managedPath, "utf8")).resolves.toBe("image-one");
  });

  it("imports generated result assets with source metadata", async () => {
    const { dir, context } = await tempContext();
    const sourcePath = path.join(dir, "result.png");
    await writeFile(sourcePath, Buffer.from("generated-image"));

    const createdFolder = await createGalleryFolder(state(), context, { name: "Campaign" });
    const imported = await importGalleryAssets(createdFolder.state, context, [sourcePath], createdFolder.folder.id, {
      source: "result",
      sourceJobId: "job_1",
      sourceAssetId: "history_asset_1",
      tags: ["generated", "generated"]
    });

    expect(imported.result.assets[0]).toMatchObject({
      id: "asset_1",
      source: "result",
      folderId: "folder_1",
      tags: ["generated"],
      sourceJobId: "job_1",
      sourceAssetId: "history_asset_1"
    });
  });

  it("handles duplicate imports with cancel, copy, and replace actions", async () => {
    const { dir, context } = await tempContext();
    const sourcePath = path.join(dir, "source.png");
    const replacementPath = path.join(dir, "replacement.png");
    await writeFile(sourcePath, Buffer.from("same-image"));
    await writeFile(replacementPath, Buffer.from("same-image"));

    const imported = await importGalleryAssets(state(), context, [sourcePath]);
    const duplicateCancel = await importGalleryAssets(imported.state, { ...context, duplicateAction: "cancel" }, [replacementPath]);
    const duplicateCopy = await importGalleryAssets(imported.state, { ...context, duplicateAction: "copy", createAssetId: () => "asset_2" }, [replacementPath]);
    const duplicateReplace = await importGalleryAssets(imported.state, { ...context, duplicateAction: "replace" }, [replacementPath]);

    expect(duplicateCancel.result.assets).toHaveLength(0);
    expect(duplicateCancel.result.skipped[0]).toMatchObject({ reason: "duplicate", existingAssetId: "asset_1" });
    expect(duplicateCopy.result.assets[0]).toMatchObject({ id: "asset_2", originalName: "replacement.png" });
    expect(duplicateReplace.result.replacedAssetIds).toEqual(["asset_1"]);
    expect(duplicateReplace.result.assets[0].id).toBe("asset_1");
  });

  it("requires replace for exporting over an existing file", async () => {
    const { dir, context } = await tempContext();
    const sourcePath = path.join(dir, "source.png");
    const targetPath = path.join(dir, "exported.png");
    await writeFile(sourcePath, Buffer.from("source-image"));
    await writeFile(targetPath, Buffer.from("old"));
    const imported = await importGalleryAssets(state(), context, [sourcePath]);

    await expect(exportGalleryAsset(imported.state, context, "asset_1", targetPath)).rejects.toThrow("--replace");
    const exported = await exportGalleryAsset(imported.state, context, "asset_1", targetPath, { replace: true });

    expect(exported).toMatchObject({ exportedPath: targetPath, replaced: true });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("source-image");
  });

  it("rejects managed asset symlinks that resolve outside the Gallery root", async () => {
    const { dir, galleryDir, context } = await tempContext();
    const outsidePath = path.join(dir, "outside.png");
    await writeFile(outsidePath, Buffer.from("outside"));
    await writeFile(path.join(dir, "source.png"), Buffer.from("inside"));
    const imported = await importGalleryAssets(state(), context, [path.join(dir, "source.png")]);
    await removeGalleryAsset(imported.state, context, "asset_1");
    await symlink(outsidePath, path.join(galleryDir, "source.png"));

    await expect(resolveGalleryAssetPath(imported.state, context, "asset_1")).rejects.toThrow("不属于 CrossGen 管理目录");
  });
});
