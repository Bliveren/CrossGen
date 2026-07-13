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

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
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
