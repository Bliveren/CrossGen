import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withExclusiveFileLock } from "./fileLock";

describe("fileLock", () => {
  it("serializes access and releases the lock file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-lock-"));
    const lockPath = path.join(tempDir, "state.lock");
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let firstTask: Promise<void>;
    const firstStarted = new Promise<void>((resolve) => {
      firstTask = withExclusiveFileLock(
        lockPath,
        async () => {
          events.push("first-start");
          resolve();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
          events.push("first-end");
        },
        { timeoutMs: 1000, staleLockMs: 1000, pollMs: 10 }
      );
    });

    await firstStarted;

    const second = withExclusiveFileLock(
        lockPath,
        async () => {
          events.push("second-start");
          events.push("second-end");
        },
        { timeoutMs: 1000, staleLockMs: 1000, pollMs: 10 }
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    releaseFirst?.();
    await Promise.all([firstTask!, second]);

    expect(events.indexOf("first-end")).toBeLessThan(events.indexOf("second-start"));
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(tempDir, { recursive: true, force: true });
  });
});
