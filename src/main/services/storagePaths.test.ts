import { describe, expect, it } from "vitest";
import type { StorageSettings } from "../../shared/types";
import { storagePathForKind } from "./storagePaths";

const storage: StorageSettings = {
  historyDir: "/tmp/history",
  galleryDir: "/tmp/gallery",
  mediaRoot: "/tmp/media"
};

describe("storage paths", () => {
  it("resolves each configured storage kind independently", () => {
    expect(storagePathForKind(storage, "history", "/tmp/default-media")).toBe("/tmp/history");
    expect(storagePathForKind(storage, "gallery", "/tmp/default-media")).toBe("/tmp/gallery");
    expect(storagePathForKind(storage, "media", "/tmp/default-media")).toBe("/tmp/media");
  });

  it("falls back to the default media root when state predates mediaRoot", () => {
    const legacyStorage: StorageSettings = {
      historyDir: "/tmp/history",
      galleryDir: "/tmp/gallery"
    };
    expect(storagePathForKind(legacyStorage, "media", "/tmp/default-media")).toBe("/tmp/default-media");
  });
});
