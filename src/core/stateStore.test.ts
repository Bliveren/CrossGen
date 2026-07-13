import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
});
