import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEGACY_USER_DATA_NAME, DEFAULT_STATE_FILE_NAME, resolveDataDirs, resolveUserDataDir } from "./dataDirs";

describe("dataDirs", () => {
  it("resolves user data and queue files from app data", () => {
    const userDataDir = resolveUserDataDir({ appDataDir: "/tmp/app-data" });
    const expectedUserDataDir = path.join(path.resolve("/tmp/app-data"), "Image2Tools");
    expect(userDataDir).toBe(expectedUserDataDir);

    const dirs = resolveDataDirs({ appDataDir: "/tmp/app-data" });
    expect(dirs.statePath).toBe(path.join(path.resolve("/tmp/app-data"), DEFAULT_LEGACY_USER_DATA_NAME, DEFAULT_STATE_FILE_NAME));
    expect(dirs.lockPath).toBe(path.join(expectedUserDataDir, ".crossgen-state.lock"));
    expect(dirs.queuePath).toBe(path.join(expectedUserDataDir, "crossgen-queue.v1.json"));
    expect(dirs.queueLockPath).toBe(dirs.lockPath);
    expect(dirs.legacyImageRoots).toContain(path.join(expectedUserDataDir, "images"));
  });

  it("prefers explicit user data directories", () => {
    const dirs = resolveDataDirs({ appDataDir: "/tmp/app-data", userDataDir: "/tmp/custom-data" });
    const expectedUserDataDir = path.resolve("/tmp/custom-data");
    expect(dirs.userDataDir).toBe(expectedUserDataDir);
    expect(dirs.statePath).toBe(path.join(expectedUserDataDir, "image2tools-state.v1.json"));
  });
});
