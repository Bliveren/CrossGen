import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationJob } from "../../shared/types";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import {
  assertKnownOutputPath,
  assertManagedRegularFile,
  collectOwnedJobFilePaths,
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
    const imagesDir = "/tmp/image2tools/images";

    expect(normalizeManagedAssetPath(imagesDir, "/tmp/image2tools/images/result.png")).toBe("/tmp/image2tools/images/result.png");
    expect(normalizeManagedAssetPath(imagesDir, "/tmp/image2tools/images/../outside.png")).toBeNull();
    expect(normalizeManagedAssetPath(imagesDir, "/tmp/image2tools/images")).toBeNull();
  });

  it("requires output paths to belong to current history", () => {
    const imagesDir = "/tmp/image2tools/images";
    const knownPath = "/tmp/image2tools/images/result.png";
    const job = makeJob(imagesDir, knownPath);

    expect(assertKnownOutputPath(imagesDir, [job], knownPath)).toBe(knownPath);
    expect(() => assertKnownOutputPath(imagesDir, [job], "/tmp/image2tools/images/other.png")).toThrow("当前历史");
    expect(() => assertKnownOutputPath(imagesDir, [job], "/tmp/image2tools/other.png")).toThrow("管理目录");
  });

  it("rejects symlinks that resolve outside the managed images directory", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-assets-"));
    const imagesDir = path.join(tmpDir, "images");
    await mkdir(imagesDir);
    const outsidePath = path.join(tmpDir, "outside.txt");
    const linkPath = path.join(imagesDir, "linked.txt");
    await writeFile(outsidePath, "secret");
    await import("node:fs/promises").then((fs) => fs.symlink(outsidePath, linkPath));

    await expect(assertManagedRegularFile(imagesDir, linkPath)).rejects.toThrow("管理目录");
  });

  it("collects only generated files and locally persisted masks owned by a job", () => {
    const imagesDir = "/tmp/image2tools/images";
    const job = {
      ...makeJob(imagesDir),
      maskAsset: {
        id: "mask",
        name: "mask.png",
        path: "/tmp/image2tools/images/mask.png",
        mimeType: "image/png",
        sizeBytes: 1
      },
      inputAssets: [
        {
          id: "input",
          name: "source.png",
          path: "/Users/alive/source.png",
          mimeType: "image/png",
          sizeBytes: 1
        }
      ]
    };

    expect(collectOwnedJobFilePaths(imagesDir, job)).toEqual(["/tmp/image2tools/images/result.png", "/tmp/image2tools/images/mask.png"]);
  });
});
