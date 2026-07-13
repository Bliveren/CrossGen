import { describe, expect, it } from "vitest";
import { coerceLegacyImageAssetKind, isImageMediaKind, mediaKindsContainImage, normalizeAssetKind, normalizeMediaKind } from "./mediaTypes";

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

    expect(coerceLegacyImageAssetKind({ id: "a" }).kind).toBe("image");
    expect(coerceLegacyImageAssetKind({ id: "b", kind: "video" }).kind).toBe("video");
  });

  it("detects image presence in kind lists", () => {
    expect(mediaKindsContainImage(["animated-gif"])).toBe(false);
    expect(mediaKindsContainImage(["video", "image"])).toBe(true);
    expect(mediaKindsContainImage(undefined)).toBe(false);
  });
});
