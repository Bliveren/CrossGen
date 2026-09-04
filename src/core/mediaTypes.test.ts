import { describe, expect, it } from "vitest";
import {
  coerceLegacyImageAssetKind,
  isImageAsset,
  isImageMediaKind,
  mediaKindsContainImage,
  normalizeAssetKind,
  normalizeMediaKind,
  normalizeOutputAssetValue
} from "./mediaTypes";

describe("mediaTypes", () => {
  it("defaults unknown legacy asset kinds to image", () => {
    expect(normalizeMediaKind(undefined)).toBe("image");
    expect(normalizeMediaKind(null)).toBe("image");
    expect(normalizeMediaKind("image")).toBe("image");
    expect(normalizeMediaKind("animated-gif")).toBe("animated-gif");
    expect(normalizeMediaKind("video")).toBe("video");
    expect(normalizeAssetKind(undefined)).toBe("image");
  });

  it("identifies image kinds and coerces legacy assets", () => {
    expect(isImageMediaKind("image")).toBe(true);
    expect(isImageMediaKind("video")).toBe(false);
    expect(isImageAsset(null)).toBe(false);
    expect(isImageAsset({
      id: "image",
      jobId: "job",
      path: "/tmp/image.png",
      fileName: "image.png",
      mimeType: "image/png",
      sourceType: "result",
      createdAt: new Date(0).toISOString()
    })).toBe(true);

    expect(coerceLegacyImageAssetKind({ id: "a" }).kind).toBe("image");
    expect(coerceLegacyImageAssetKind({ id: "b", kind: "video" }).kind).toBe("video");
  });

  it("normalizes output media metadata from legacy file names", () => {
    const asset = normalizeOutputAssetValue({
      id: "video-1",
      jobId: "job-1",
      path: "/tmp/video.mp4",
      fileName: "video.mp4",
      sourceType: "result",
      createdAt: new Date(0).toISOString()
    }, "fallback-job", new Date(0).toISOString());
    expect(asset).toMatchObject({
      id: "video-1",
      jobId: "job-1",
      kind: "video",
      mimeType: "video/mp4"
    });
  });

  it("falls back to the file extension when MIME metadata is generic", () => {
    const asset = normalizeOutputAssetValue({
      id: "gif-1",
      jobId: "job-1",
      path: "/tmp/animation.gif",
      fileName: "animation.gif",
      mimeType: "application/octet-stream",
      sourceType: "result"
    }, "fallback-job", new Date(0).toISOString());

    expect(asset).toMatchObject({
      kind: "animated-gif",
      mimeType: "application/octet-stream"
    });
  });

  it("detects image presence in kind lists", () => {
    expect(mediaKindsContainImage(["animated-gif"])).toBe(false);
    expect(mediaKindsContainImage(["video", "image"])).toBe(true);
    expect(mediaKindsContainImage(undefined)).toBe(false);
  });
});
