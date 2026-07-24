import { promises as fs } from "node:fs";
import path from "node:path";

export interface FileLockOptions {
  timeoutMs?: number;
  staleLockMs?: number;
  pollMs?: number;
  now?: () => number;
  pid?: number;
}

export interface FileLockHandle {
  path: string;
  acquiredAt: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_LOCK_MS = 30000;
const DEFAULT_POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readLockOwnerPid(lockPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 0 ? Number(parsed.pid) : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") return false;
    return true;
  }
}

async function removeLockFile(lockPath: string): Promise<boolean> {
  try {
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return true;
    return false;
  }
}

async function tryRemoveStaleLock(lockPath: string, staleLockMs: number, now: () => number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    if (now() - stat.mtimeMs >= staleLockMs) {
      return removeLockFile(lockPath);
    }
    const ownerPid = await readLockOwnerPid(lockPath);
    if (ownerPid !== null) {
      return isProcessAlive(ownerPid) ? false : removeLockFile(lockPath);
    }
    return false;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return true;
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function isLockContentionError(error: unknown): boolean {
  if (!isNodeError(error)) return false;
  if (error.code === "EEXIST") return true;
  return process.platform === "win32" && error.code === "EPERM";
}

async function acquireLock(lockPath: string, options: Required<Pick<FileLockOptions, "timeoutMs" | "staleLockMs" | "pollMs">> & Pick<FileLockOptions, "now" | "pid">): Promise<FileLockHandle> {
  const startedAt = (options.now ?? Date.now)();
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;

  await ensureParentDir(lockPath);

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(
          `${JSON.stringify({
            pid,
            acquiredAt: now(),
            host: `${pid}:${Math.random().toString(36).slice(2, 8)}`
          })}\n`,
          "utf8"
        );
      } finally {
        await handle.close();
      }
      return { path: lockPath, acquiredAt: now() };
    } catch (error) {
      if (!isLockContentionError(error)) throw error;
      const reclaimed = await tryRemoveStaleLock(lockPath, options.staleLockMs, now);
      if (reclaimed) continue;
      if (now() - startedAt > options.timeoutMs) {
        throw new Error(`Timed out acquiring lock: ${lockPath}`);
      }
      await sleep(options.pollMs);
    }
  }
}

export async function withExclusiveFileLock<T>(lockPath: string, operation: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const lock = await acquireLock(lockPath, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    staleLockMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
    pollMs: options.pollMs ?? DEFAULT_POLL_MS,
    now: options.now,
    pid: options.pid
  });

  try {
    return await operation();
  } finally {
    await fs.unlink(lock.path).catch(() => undefined);
  }
}
