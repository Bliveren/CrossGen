import { withExclusiveFileLock } from "./fileLock.js";
import { readQueueFile, writeQueueFile, normalizeQueueFile } from "./queueStore.js";
import { readJsonStateFile, writeJsonStateFile, type JsonStateFileAccessOptions } from "./stateStore.js";
import type { GenerationQueueFile } from "../shared/types.js";

export interface StateQueueTransactionOptions<TState> {
  lockPath: string;
  state: JsonStateFileAccessOptions<TState>;
  queuePath: string;
  timeoutMs?: number;
  staleLockMs?: number;
  updateBackup?: boolean;
}

export interface StateQueueTransactionContext<TState> {
  state: TState;
  queue: GenerationQueueFile;
  setState: (next: TState) => void;
  setQueue: (next: GenerationQueueFile) => void;
  updateState: (updater: (state: TState) => TState) => TState;
  updateQueue: (updater: (queue: GenerationQueueFile) => GenerationQueueFile) => GenerationQueueFile;
}

export interface StateQueueTransactionResult<TState, TResult> {
  result: TResult;
  state: TState;
  queue: GenerationQueueFile;
}

export async function withStateQueueTransaction<TState, TResult>(
  options: StateQueueTransactionOptions<TState>,
  operation: (context: StateQueueTransactionContext<TState>) => TResult | Promise<TResult>
): Promise<StateQueueTransactionResult<TState, TResult>> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const staleLockMs = options.staleLockMs ?? 30000;

  return withExclusiveFileLock(
    options.lockPath,
    async () => {
      let state = await readJsonStateFile(options.state) as TState;
      let queue = await readQueueFile(options.queuePath);
      const context: StateQueueTransactionContext<TState> = {
        get state() {
          return state;
        },
        get queue() {
          return queue;
        },
        setState(next) {
          state = next;
        },
        setQueue(next) {
          queue = next;
        },
        updateState(updater) {
          state = updater(state);
          return state;
        },
        updateQueue(updater) {
          queue = updater(queue);
          return queue;
        }
      };
      const result = await operation(context);
      const normalizedQueue = normalizeQueueFile(queue);
      await writeJsonStateFile(options.state, state, { updateBackup: options.updateBackup });
      await writeQueueFile(options.queuePath, normalizedQueue);
      return {
        result,
        state,
        queue: normalizedQueue
      };
    },
    { timeoutMs, staleLockMs }
  );
}
