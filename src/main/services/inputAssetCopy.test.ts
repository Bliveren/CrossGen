import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputAsset, InputAssetCopyRequest } from "../../shared/types";
import {
  decodeInputAssetCopy,
  MAX_INPUT_ASSET_COPY_BYTES,
  saveInputAssetCopy,
  type InputAssetCopyImage
} from "./inputAssetCopy";

const pngPayload = "iVBORw0KGgo=";
const baseRequest: InputAssetCopyRequest = {
  dataUrl: `data:image/png;base64,${pngPayload}`,
  originalName: "nested/reference-edited.png",
  sourceAssetId: "asset_source_1",
  sourceOperation: "annotation"
};

const validImage: InputAssetCopyImage = {
  isEmpty: () => false,
  getSize: () => ({ width: 128, height: 96 })
};

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "crossgen-input-copy-"));
  tempRoots.push(root);
  return root;
}

function asset(filePath: string): InputAsset {
  return {
    id: "asset_copy_1",
    name: path.basename(filePath),
    path: filePath,
    mimeType: "image/png",
    sizeBytes: 8,
    width: 128,
    height: 96
  };
}

function save(root: string, patch: Partial<InputAssetCopyRequest> = {}, options: Partial<Parameters<typeof saveInputAssetCopy>[0]> = {}) {
  return saveInputAssetCopy({
    input: { ...baseRequest, ...patch },
    mediaRoot: root,
    decodeImage: () => validImage,
    createAsset: async (filePath) => asset(filePath),
    fileToken: () => "fixed-token",
    ...options
  });
}

describe("input asset copy service", () => {
  it("decodes supported image data URLs and rejects malformed payloads", () => {
    expect(decodeInputAssetCopy(baseRequest.dataUrl)).toEqual({
      mimeType: "image/png",
      bytes: Buffer.from(pngPayload, "base64")
    });
    expect(() => decodeInputAssetCopy("data:image/svg+xml;base64,AAAA")).toThrow("png、jpg、jpeg 或 webp");
    expect(() => decodeInputAssetCopy("data:image/png;base64,%%%")).toThrow("内容无效");
    expect(() => decodeInputAssetCopy("data:image/png;base64,")).toThrow("内容为空");
  });

  it("writes a managed immutable copy with provenance and a basename-only display name", async () => {
    const root = await tempRoot();
    const result = await save(root);
    const expectedPath = path.join(root, "originals", "references", "reference-fixed-token.png");

    expect(result).toMatchObject({
      path: expectedPath,
      name: "reference-edited.png",
      sourceAssetId: "asset_source_1",
      sourceOperation: "annotation",
      previewUrl: `image2tools-asset://image?path=${encodeURIComponent(expectedPath)}`
    });
    await expect(readFile(expectedPath)).resolves.toEqual(Buffer.from(pngPayload, "base64"));
    await expect(readdir(path.join(root, "originals", "references"))).resolves.toEqual(["reference-fixed-token.png"]);
  });

  it("supports JPEG and WebP extensions without changing provenance", async () => {
    const root = await tempRoot();
    const jpeg = await save(root, {
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
      sourceOperation: "crop"
    });
    expect(jpeg.path).toMatch(/reference-fixed-token\.jpg$/);
    expect(jpeg.sourceOperation).toBe("crop");

    const webp = await save(root, {
      dataUrl: "data:image/webp;base64,aGVsbG8=",
      sourceOperation: "import"
    }, { fileToken: () => "webp-token" });
    expect(webp.path).toMatch(/reference-webp-token\.webp$/);
    expect(webp.sourceOperation).toBe("import");
  });

  it("rejects unsafe source IDs, unsupported operations, and oversized decoded data before writing", async () => {
    const root = await tempRoot();
    const decodeImage = vi.fn(() => validImage);
    await expect(saveInputAssetCopy({
      input: { ...baseRequest, sourceAssetId: "../escape" },
      mediaRoot: root,
      decodeImage,
      createAsset: async (filePath) => asset(filePath),
      maxBytes: MAX_INPUT_ASSET_COPY_BYTES
    })).rejects.toThrow("来源资产 ID");
    await expect(save(root, { sourceOperation: "unknown" as InputAssetCopyRequest["sourceOperation"] })).rejects.toThrow("来源操作");
    await expect(saveInputAssetCopy({
      input: { ...baseRequest, dataUrl: "data:image/png;base64,AAAAAA==" },
      mediaRoot: root,
      decodeImage,
      createAsset: async (filePath) => asset(filePath),
      maxBytes: 3
    })).rejects.toThrow("超过 50 MB");
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it("rejects empty or invalid decoded images", async () => {
    const root = await tempRoot();
    await expect(saveInputAssetCopy({
      input: baseRequest,
      mediaRoot: root,
      decodeImage: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }),
      createAsset: async (filePath) => asset(filePath)
    })).rejects.toThrow("无法读取");
    await expect(saveInputAssetCopy({
      input: baseRequest,
      mediaRoot: root,
      decodeImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 0, height: 10 }) }),
      createAsset: async (filePath) => asset(filePath)
    })).rejects.toThrow("尺寸无效");
  });

  it("cleans temporary and published files if writing or asset materialization fails", async () => {
    const root = await tempRoot();
    await expect(saveInputAssetCopy({
      input: baseRequest,
      mediaRoot: root,
      decodeImage: () => validImage,
      createAsset: async () => {
        throw new Error("asset metadata failed");
      },
      fileToken: () => "materialize-failure"
    })).rejects.toThrow("asset metadata failed");

    const references = path.join(root, "originals", "references");
    expect(await readdir(references).catch(() => [])).toEqual([]);

    await expect(saveInputAssetCopy({
      input: baseRequest,
      mediaRoot: root,
      decodeImage: () => validImage,
      createAsset: async (filePath) => asset(filePath),
      fileToken: () => "rename-failure",
      rename: async () => {
        throw new Error("rename failed");
      }
    })).rejects.toThrow("rename failed");
    expect(await readdir(references).catch(() => [])).toEqual([]);
  });
});
