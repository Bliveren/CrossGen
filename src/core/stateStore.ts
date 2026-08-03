import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { withExclusiveFileLock } from "./fileLock.js";

export interface JsonStateStoreOptions<TState> {
  statePath: string;
  backupPath: string;
  lockPath: string;
  timeoutMs?: number;
  staleLockMs?: number;
  defaultState: TState;
  normalize: (value: unknown) => TState;
}

export interface JsonStateStore<TState> {
  read(): Promise<TState>;
  write(state: TState, options?: { updateBackup?: boolean }): Promise<void>;
  mutate(mutator: (state: TState) => TState | Promise<TState>): Promise<TState>;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}

export interface JsonStateFileAccessOptions<TState> {
  statePath: string;
  backupPath: string;
  defaultState: TState;
  normalize: (value: unknown) => TState;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Windows 上对已存在目标文件 rename 偶尔 EPERM（杀软/并发读短暂锁定），
// 有限次退避重试，避免状态写入失败导致任务扣费后仍显示失败。
const TRANSIENT_WRITE_ERRORS = new Set(["EPERM", "EBUSY", "EEXIST", "EACCES"]);

async function writeFileWithRetry(filePath: string, data: string, attempts = 5): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.writeFile(filePath, data, "utf8");
      return;
    } catch (error) {
      if (!isNodeError(error) || !TRANSIENT_WRITE_ERRORS.has(error.code ?? "")) throw error;
      lastError = error;
      await sleep(40 * (attempt + 1));
    }
  }
  throw lastError;
}

async function renameWithRetry(fromPath: string, toPath: string, attempts = 5): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(fromPath, toPath);
      return;
    } catch (error) {
      if (!isNodeError(error) || !TRANSIENT_WRITE_ERRORS.has(error.code ?? "")) throw error;
      lastError = error;
      await sleep(40 * (attempt + 1));
    }
  }
  throw lastError;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFileWithRetry(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
    await renameWithRetry(tmpPath, filePath);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function readJsonStateFile<TState>(options: JsonStateFileAccessOptions<TState>): Promise<TState> {
  try {
    return options.normalize(await readJsonFile(options.statePath));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      try {
        return options.normalize(await readJsonFile(options.backupPath));
      } catch {
        return structuredClone(options.defaultState);
      }
    }
    try {
      return options.normalize(await readJsonFile(options.backupPath));
    } catch {
      return structuredClone(options.defaultState);
    }
  }
}

export async function writeJsonStateFile<TState>(
  options: JsonStateFileAccessOptions<TState>,
  state: TState,
  writeOptions: { updateBackup?: boolean } = {}
): Promise<void> {
  if (writeOptions.updateBackup !== false) {
    await fs.copyFile(options.statePath, options.backupPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
  await writeJsonFile(options.statePath, state);
}

export function createJsonStateStore<TState>(options: JsonStateStoreOptions<TState>): JsonStateStore<TState> {
  const { statePath, backupPath, lockPath, normalize, defaultState } = options;
  const timeoutMs = options.timeoutMs ?? 5000;
  const staleLockMs = options.staleLockMs ?? 30000;

  async function readFromDisk(): Promise<TState> {
    return readJsonStateFile({ statePath, backupPath, normalize, defaultState });
  }

  return {
    async read(): Promise<TState> {
      return readFromDisk();
    },
    async write(state: TState, writeOptions: { updateBackup?: boolean } = {}): Promise<void> {
      await withExclusiveFileLock(
        lockPath,
        async () => {
          await writeJsonStateFile({ statePath, backupPath, normalize, defaultState }, state, writeOptions);
        },
        { timeoutMs, staleLockMs }
      );
    },
    async mutate(mutator: (state: TState) => TState | Promise<TState>): Promise<TState> {
      return withExclusiveFileLock(
        lockPath,
        async () => {
          const next = await mutator(await readFromDisk());
          await writeJsonStateFile({ statePath, backupPath, normalize, defaultState }, next);
          return next;
        },
        { timeoutMs, staleLockMs }
      );
    },
    async withLock<T>(operation: () => Promise<T>): Promise<T> {
      return withExclusiveFileLock(lockPath, operation, { timeoutMs, staleLockMs });
    }
  };
}
