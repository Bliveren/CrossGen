import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationJob } from "../../shared/types";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import {
  assertKnownOutputPath,
  assertKnownRegularOutputPath,
  assertManagedRegularFile,
  assertManagedRegularFileInRoots,
  collectOwnedJobFilePaths,
  resolveManagedFileName,
  normalizeManagedAssetPath
} from "./assetOwnership";

let tmpDir: string | null = null;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

function makeJob(imagesDir: string, outputPath = path.join(imagesDir, "result.png")): GenerationJob {
  const now = new Date(0).toISOString();
  return {
    id: "job_test",
    name: "result.png",
    tags: [],
    providerKind: "openai",
    providerId: "default",
    launchId: "gpt-image-2",
    modelId: "gpt-image-2",
    modelDisplayName: "GPT Image 2",
    mode: "generate",
    prompt: "Test",
    inputAssets: [],
    params: DEFAULT_IMAGE_PARAMS,
    status: "succeeded",
    createdAt: now,
    updatedAt: now,
    outputs: [
      {
        id: "img_test",
        jobId: "job_test",
        path: outputPath,
        fileName: "result.png",
        mimeType: "image/png",
        sourceType: "result",
        createdAt: now
      }
    ]
  };
}

describe("asset ownership checks", () => {
  it("accepts only paths inside the managed images directory", () => {
    const imagesDir = path.join(os.tmpdir(), "image2tools", "images");
    const resultPath = path.join(imagesDir, "result.png");

    expect(normalizeManagedAssetPath(imagesDir, resultPath)).toBe(path.resolve(resultPath));
    expect(normalizeManagedAssetPath(imagesDir, path.join(imagesDir, "..", "outside.png"))).toBeNull();
    expect(normalizeManagedAssetPath(imagesDir, "/tmp/image2tools/images")).toBeNull();
  });

  it("requires output paths to belong to current history", () => {
    const imagesDir = path.join(os.tmpdir(), "image2tools", "images");
    const knownPath = path.join(imagesDir, "result.png");
    const job = makeJob(imagesDir, knownPath);

    expect(assertKnownOutputPath(imagesDir, [job], knownPath)).toBe(path.resolve(knownPath));
    expect(() => assertKnownOutputPath(imagesDir, [job], path.join(imagesDir, "other.png"))).toThrow("当前历史");
    expect(() => assertKnownOutputPath(imagesDir, [job], path.join(imagesDir, "..", "other.png"))).toThrow("管理目录");
  });

  it.skipIf(process.platform === "win32")("rejects symlinks that resolve outside the managed images directory", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-assets-"));
    const imagesDir = path.join(tmpDir, "images");
    await mkdir(imagesDir);
    const outsidePath = path.join(tmpDir, "outside.txt");
    const linkPath = path.join(imagesDir, "linked.txt");
    await writeFile(outsidePath, "secret");
    await import("node:fs/promises").then((fs) => fs.symlink(outsidePath, linkPath));

    await expect(assertManagedRegularFile(imagesDir, linkPath)).rejects.toThrow("管理目录");
  });

  it.skipIf(process.platform === "win32")("rejects known history outputs that are symlinks outside the managed images directory", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-assets-"));
    const imagesDir = path.join(tmpDir, "images");
    await mkdir(imagesDir);
    const outsidePath = path.join(tmpDir, "outside.png");
    const linkPath = path.join(imagesDir, "history-linked.png");
    await writeFile(outsidePath, "secret");
    await import("node:fs/promises").then((fs) => fs.symlink(outsidePath, linkPath));
    const job = makeJob(imagesDir, linkPath);

    expect(assertKnownOutputPath(imagesDir, [job], linkPath)).toBe(path.resolve(linkPath));
    await expect(assertKnownRegularOutputPath(imagesDir, [job], linkPath)).rejects.toThrow("管理目录");
  });

  it("collects only generated files and locally persisted masks owned by a job", () => {
    const imagesDir = path.join(os.tmpdir(), "image2tools", "images");
    const resultPath = path.join(imagesDir, "result.png");
    const maskPath = path.join(imagesDir, "mask.png");
    const job = {
      ...makeJob(imagesDir, resultPath),
      maskAsset: {
        id: "mask",
        name: "mask.png",
        path: maskPath,
        mimeType: "image/png",
        sizeBytes: 1
      },
      inputAssets: [
        {
          id: "input",
          name: "source.png",
          path: path.join(os.tmpdir(), "source.png"),
          mimeType: "image/png",
          sizeBytes: 1
        }
      ]
    };

    expect(collectOwnedJobFilePaths(imagesDir, job)).toEqual([path.resolve(resultPath), path.resolve(maskPath)]);
  });

  it("does not collect gallery files when cleaning up a job", () => {
    const imagesDir = path.join(os.tmpdir(), "image2tools", "images");
    const galleryDir = path.join(os.tmpdir(), "image2tools", "gallery");
    const job = {
      ...makeJob(imagesDir, path.join(imagesDir, "result.png")),
      outputs: [
        {
          ...makeJob(imagesDir).outputs[0],
          path: path.join(imagesDir, "result.png")
        },
        {
          ...makeJob(imagesDir, path.join(galleryDir, "gallery.png")).outputs[0],
          path: path.join(galleryDir, "gallery.png")
        }
      ]
    };

    expect(collectOwnedJobFilePaths(imagesDir, job)).toEqual([path.resolve(path.join(imagesDir, "result.png"))]);
  });

  it("resolves managed file names inside a root directory", () => {
    const root = path.join(os.tmpdir(), "image2tools", "gallery");
    expect(resolveManagedFileName(root, "sample.png")).toBe(path.resolve(root, "sample.png"));
    expect(resolveManagedFileName(root, "Product refs/sample.png")).toBe(path.resolve(root, "Product refs", "sample.png"));
    expect(() => resolveManagedFileName(root, "../escape.png")).toThrow("管理目录");
    expect(() => resolveManagedFileName(root, "folder/../escape.png")).toThrow("管理目录");
  });

  it.skipIf(process.platform === "win32")("checks managed files across multiple roots", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-assets-"));
    const imagesDir = path.join(tmpDir, "images");
    const galleryDir = path.join(tmpDir, "gallery");
    await mkdir(imagesDir);
    await mkdir(galleryDir);
    const filePath = path.join(galleryDir, "gallery.png");
    await writeFile(filePath, "gallery");

    await expect(assertManagedRegularFileInRoots([imagesDir, galleryDir], filePath)).resolves.toBe(path.resolve(filePath));
  });

  it.skipIf(process.platform === "win32")("rejects gallery symlinks that resolve outside multiple managed roots", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-assets-"));
    const imagesDir = path.join(tmpDir, "images");
    const galleryDir = path.join(tmpDir, "gallery");
    await mkdir(imagesDir);
    await mkdir(galleryDir);
    const outsidePath = path.join(tmpDir, "outside.png");
    const linkPath = path.join(galleryDir, "linked.png");
    await writeFile(outsidePath, "secret");
    await import("node:fs/promises").then((fs) => fs.symlink(outsidePath, linkPath));

    await expect(assertManagedRegularFileInRoots([imagesDir, galleryDir], linkPath)).rejects.toThrow("管理目录");
  });
});
