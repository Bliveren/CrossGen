import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createJsonStateStore } from "./stateStore";

describe("stateStore", () => {
  it("writes, reads and recovers from backup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-state-"));
    const statePath = path.join(tempDir, "state.json");
    const backupPath = `${statePath}.bak`;
    const store = createJsonStateStore({
      statePath,
      backupPath,
      lockPath: `${statePath}.lock`,
      defaultState: { version: 1, value: 0 },
      normalize: (value) => value as { version: number; value: number }
    });

    await store.write({ version: 1, value: 42 });
    expect(await store.read()).toEqual({ version: 1, value: 42 });
    expect(JSON.parse(await readFile(statePath, "utf8"))).toMatchObject({ version: 1, value: 42 });

    await store.write({ version: 1, value: 7 });
    await rm(statePath, { force: true });
    expect(await store.read()).toEqual({ version: 1, value: 42 });
    await rm(tempDir, { recursive: true, force: true });
  });

  it("retries the state file rename on a transient EPERM", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-state-"));
    const statePath = path.join(tempDir, "state.json");
    const store = createJsonStateStore({
      statePath,
      backupPath: `${statePath}.bak`,
      lockPath: `${statePath}.lock`,
      defaultState: { version: 1, value: 0 },
      normalize: (value) => value as { version: number; value: number }
    });
    await store.write({ version: 1, value: 1 });

    const fsMod = await import("node:fs");
    const renameSpy = vi.spyOn(fsMod.promises, "rename");
    renameSpy.mockImplementationOnce(async () => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });

    try {
      await expect(store.write({ version: 1, value: 2 })).resolves.toBeUndefined();
      expect(renameSpy).toHaveBeenCalledTimes(2);
      expect(await store.read()).toEqual({ version: 1, value: 2 });
    } finally {
      renameSpy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
