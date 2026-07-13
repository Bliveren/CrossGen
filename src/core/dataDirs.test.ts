import { describe, expect, it } from "vitest";
import { DEFAULT_LEGACY_USER_DATA_NAME, DEFAULT_STATE_FILE_NAME, resolveDataDirs, resolveUserDataDir } from "./dataDirs";

describe("dataDirs", () => {
  it("resolves user data and queue files from app data", () => {
    const userDataDir = resolveUserDataDir({ appDataDir: "/tmp/app-data" });
    expect(userDataDir).toBe("/tmp/app-data/Image2Tools");

    const dirs = resolveDataDirs({ appDataDir: "/tmp/app-data" });
    expect(dirs.statePath).toBe(`/tmp/app-data/${DEFAULT_LEGACY_USER_DATA_NAME}/${DEFAULT_STATE_FILE_NAME}`);
    expect(dirs.lockPath).toBe("/tmp/app-data/Image2Tools/.crossgen-state.lock");
    expect(dirs.queuePath).toBe("/tmp/app-data/Image2Tools/crossgen-queue.v1.json");
    expect(dirs.queueLockPath).toBe("/tmp/app-data/Image2Tools/.crossgen-queue.lock");
    expect(dirs.legacyImageRoots).toContain("/tmp/app-data/Image2Tools/images");
  });

  it("prefers explicit user data directories", () => {
    const dirs = resolveDataDirs({ appDataDir: "/tmp/app-data", userDataDir: "/tmp/custom-data" });
    expect(dirs.userDataDir).toBe("/tmp/custom-data");
    expect(dirs.statePath).toBe("/tmp/custom-data/image2tools-state.v1.json");
  });
});
