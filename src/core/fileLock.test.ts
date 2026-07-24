import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLockContentionError, withExclusiveFileLock } from "./fileLock";

describe("fileLock", () => {
  it("treats Windows EPERM as lock contention", () => {
    expect(isLockContentionError(Object.assign(new Error("denied"), { code: "EPERM" }))).toBe(process.platform === "win32");
  });

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

  it("does not reclaim a fresh lock owned by a live process", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-lock-live-"));
    const lockPath = path.join(tempDir, "state.lock");
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, "utf8");

    await expect(withExclusiveFileLock(lockPath, async () => undefined, { timeoutMs: 30, staleLockMs: 1000, pollMs: 5 })).rejects.toThrow(`Timed out acquiring lock: ${lockPath}`);
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({ pid: process.pid });
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reclaims an expired lock even if its pid has been reused by a live process", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-lock-reused-pid-"));
    const lockPath = path.join(tempDir, "state.lock");
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - 10000 })}\n`, "utf8");
    const oldDate = new Date(Date.now() - 10000);
    await utimes(lockPath, oldDate, oldDate);

    await withExclusiveFileLock(lockPath, async () => undefined, { timeoutMs: 1000, staleLockMs: 1, pollMs: 5 });
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reclaims a lock owned by a dead process without waiting for stale timeout", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-lock-dead-"));
    const lockPath = path.join(tempDir, "state.lock");
    await writeFile(lockPath, `${JSON.stringify({ pid: 99999999, acquiredAt: Date.now() })}\n`, "utf8");

    await withExclusiveFileLock(lockPath, async () => undefined, { timeoutMs: 1000, staleLockMs: 30000, pollMs: 5 });
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(tempDir, { recursive: true, force: true });
  });
});
