import type { GenerationQueueItem, GenerationQueueWorkerHost, JobStatus } from "../shared/types.js";
import type { QueueHostIdentity, QueueStore } from "./queueStore.js";

export interface GenerationQueueExecutionResult<TValue = unknown> {
  status?: Extract<JobStatus, "succeeded" | "failed" | "cancelled">;
  value?: TValue;
  historyJobId?: string;
  outputAssetIds?: string[];
  error?: string;
}

export interface RunNextGenerationQueueItemOptions<TValue = unknown> {
  queueStore: QueueStore;
  host: QueueHostIdentity;
  executeItem: (item: GenerationQueueItem, abortSignal: AbortSignal) => Promise<GenerationQueueExecutionResult<TValue>>;
  queueId?: string;
  maxGlobalRunning?: number;
  providerConcurrency?: Record<string, number>;
  leaseMs?: number;
  now?: () => number;
  createAbortController?: () => AbortController;
  onStarted?: (item: GenerationQueueItem, controller: AbortController) => void;
  onFinished?: (item: GenerationQueueItem) => void;
}

export interface GenerationQueueRunResult<TValue = unknown> {
  claimed: boolean;
  item?: GenerationQueueItem;
  execution?: GenerationQueueExecutionResult<TValue>;
}

export interface RunGenerationQueueItemToCompletionOptions<TValue = unknown> extends RunNextGenerationQueueItemOptions<TValue> {
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
}

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "failed", "cancelled", "interrupted"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

function normalizeTerminalStatus(status: GenerationQueueExecutionResult["status"] | undefined): Extract<JobStatus, "succeeded" | "failed" | "cancelled"> {
  return status === "failed" || status === "cancelled" ? status : "succeeded";
}

function makeWorkerHost(host: QueueHostIdentity, nowMs: number, leaseMs: number): GenerationQueueWorkerHost {
  return {
    hostId: host.hostId,
    kind: host.kind,
    processId: host.processId,
    mode: "generate",
    heartbeatAt: iso(nowMs),
    leaseExpiresAt: iso(nowMs + leaseMs)
  };
}

async function markClaimedItemStage(queueStore: QueueStore, queueId: string, nowMs: number): Promise<void> {
  await queueStore.mutate((queue) => ({
    ...queue,
    updatedAt: iso(nowMs),
    items: queue.items.map((item) =>
      item.queueId === queueId
        ? {
            ...item,
            stage: "calling_provider",
            updatedAt: iso(nowMs)
          }
        : item
    )
  }));
}

async function completeClaimedItem(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  result: GenerationQueueExecutionResult,
  nowMs: number
): Promise<GenerationQueueItem> {
  let completed: GenerationQueueItem | undefined;
  await queueStore.mutate((queue) => {
    const next = {
      ...queue,
      updatedAt: iso(nowMs),
      items: queue.items.map((current) => {
        if (current.queueId !== item.queueId) return current;
        const status = normalizeTerminalStatus(result.status);
        completed = {
          ...current,
          status,
          stage: "finalizing",
          completedAt: iso(nowMs),
          updatedAt: iso(nowMs),
          lastError: result.error,
          historyJobId: result.historyJobId ?? current.historyJobId,
          outputAssetIds: result.outputAssetIds ?? current.outputAssetIds,
          cancelRequested: status === "cancelled" ? true : current.cancelRequested,
          workerHostId: undefined,
          workerProcessId: undefined,
          workerHeartbeatAt: undefined,
          workerLeaseExpiresAt: undefined
        };
        return completed;
      })
    };
    return next;
  });
  return completed ?? item;
}

async function failClaimedItem<TValue = unknown>(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  error: unknown,
  nowMs: number
): Promise<GenerationQueueExecutionResult<TValue>> {
  const message = error instanceof Error ? error.message : String(error);
  await completeClaimedItem(
    queueStore,
    item,
    {
      status: "failed",
      error: message,
      historyJobId: item.historyJobId,
      outputAssetIds: item.outputAssetIds
    },
    nowMs
  );
  return { status: "failed", error: message, historyJobId: item.historyJobId, outputAssetIds: item.outputAssetIds };
}

export async function runNextGenerationQueueItem<TValue = unknown>(
  options: RunNextGenerationQueueItemOptions<TValue>
): Promise<GenerationQueueRunResult<TValue>> {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? 30000;
  await options.queueStore.registerWorkerHeartbeat(makeWorkerHost(options.host, now(), leaseMs));
  const [item] = await options.queueStore.claimRunnableItems({
    host: options.host,
    limit: 1,
    queueId: options.queueId,
    maxGlobalRunning: options.maxGlobalRunning,
    providerConcurrency: options.providerConcurrency
  });
  if (!item) return { claimed: false };

  const controller = options.createAbortController?.() ?? new AbortController();
  options.onStarted?.(item, controller);
  try {
    await markClaimedItemStage(options.queueStore, item.queueId, now());
    const execution = await options.executeItem(item, controller.signal);
    const completed = await completeClaimedItem(options.queueStore, item, execution, now());
    return { claimed: true, item: completed, execution };
  } catch (error) {
    const execution = await failClaimedItem<TValue>(options.queueStore, item, error, now());
    return { claimed: true, item, execution };
  } finally {
    options.onFinished?.(item);
  }
}

export async function runGenerationQueueItemToCompletion<TValue = unknown>(
  options: RunGenerationQueueItemToCompletionOptions<TValue>
): Promise<GenerationQueueRunResult<TValue>> {
  const startedAt = (options.now ?? Date.now)();
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  while (true) {
    const result = await runNextGenerationQueueItem(options);
    if (result.claimed) return result;

    const queue = await options.queueStore.read();
    const item = queue.items.find((candidate) => candidate.queueId === options.queueId);
    if (!item) return { claimed: false };
    if (TERMINAL_STATUSES.has(item.status)) return { claimed: false, item };
    if (typeof options.waitTimeoutMs === "number" && (options.now ?? Date.now)() - startedAt >= options.waitTimeoutMs) {
      return { claimed: false, item };
    }
    await sleep(pollIntervalMs);
  }
}

export async function requestGenerationQueueItemCancel(queueStore: QueueStore, queueId: string, now = Date.now): Promise<GenerationQueueItem | undefined> {
  let updated: GenerationQueueItem | undefined;
  await queueStore.mutate((queue) => {
    const nowIso = iso(now());
    return {
      ...queue,
      updatedAt: nowIso,
      items: queue.items.map((item) => {
        if (item.queueId !== queueId) return item;
        if (item.status === "queued") {
          updated = {
            ...item,
            status: "cancelled",
            cancelRequested: true,
            completedAt: nowIso,
            updatedAt: nowIso
          };
          return updated;
        }
        if (item.status === "running") {
          updated = {
            ...item,
            cancelRequested: true,
            updatedAt: nowIso
          };
          return updated;
        }
        updated = item;
        return item;
      })
    };
  });
  return updated;
}
