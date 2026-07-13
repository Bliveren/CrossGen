import type { GenerationQueueItem, GenerationQueueWorkerHost, JobStatus, QueueErrorCategory } from "../shared/types.js";
import type { QueueHostIdentity, QueueStore } from "./queueStore.js";

export interface GenerationQueueFailureClassification {
  category: QueueErrorCategory;
  retryable: boolean;
}

export interface GenerationQueueExecutionResult<TValue = unknown> {
  status?: Extract<JobStatus, "succeeded" | "failed" | "cancelled">;
  value?: TValue;
  historyJobId?: string;
  outputAssetIds?: string[];
  partialAssetIds?: string[];
  error?: string;
  errorCategory?: QueueErrorCategory;
  retryable?: boolean;
}

export interface ClassifyGenerationQueueFailureInput {
  item: GenerationQueueItem;
  error?: unknown;
  result?: GenerationQueueExecutionResult;
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
  classifyFailure?: (input: ClassifyGenerationQueueFailureInput) => GenerationQueueFailureClassification;
  retryBackoffMs?: (item: GenerationQueueItem, classification: GenerationQueueFailureClassification) => number;
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

function defaultFailureClassification(): GenerationQueueFailureClassification {
  return { category: "unknown", retryable: false };
}

function defaultRetryBackoffMs(item: GenerationQueueItem): number {
  return Math.min(30000, 1000 * 2 ** Math.max(0, item.attempt - 1));
}

function mergeUnique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
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

async function refreshClaimedItemHeartbeat(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  host: QueueHostIdentity,
  nowMs: number,
  leaseMs: number
): Promise<void> {
  await queueStore.mutate((queue) => {
    const heartbeatAt = iso(nowMs);
    const leaseExpiresAt = iso(nowMs + leaseMs);
    const workerHost: GenerationQueueWorkerHost = {
      hostId: host.hostId,
      kind: host.kind,
      processId: host.processId,
      mode: "generate",
      heartbeatAt,
      leaseExpiresAt
    };
    const workerHosts = [...queue.workerHosts];
    const hostIndex = workerHosts.findIndex((candidate) => candidate.hostId === host.hostId);
    if (hostIndex >= 0) workerHosts[hostIndex] = workerHost;
    else workerHosts.push(workerHost);
    return {
      ...queue,
      updatedAt: heartbeatAt,
      workerHosts,
      items: queue.items.map((current) =>
        current.queueId === item.queueId && current.status === "running" && current.workerHostId === host.hostId
          ? {
              ...current,
              updatedAt: heartbeatAt,
              workerHeartbeatAt: heartbeatAt,
              workerLeaseExpiresAt: leaseExpiresAt
            }
          : current
      )
    };
  });
}

function startClaimedItemHeartbeat(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  host: QueueHostIdentity,
  leaseMs: number,
  now: () => number
): () => void {
  const intervalMs = Math.max(50, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void refreshClaimedItemHeartbeat(queueStore, item, host, now(), leaseMs).catch(() => undefined);
  }, intervalMs);
  return () => clearInterval(timer);
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
          nextRunAt: undefined,
          updatedAt: iso(nowMs),
          lastError: result.error,
          lastErrorCategory: result.errorCategory,
          lastErrorRetryable: result.retryable,
          historyJobId: result.historyJobId ?? current.historyJobId,
          outputAssetIds: result.outputAssetIds ?? current.outputAssetIds,
          partialAssetIds: result.partialAssetIds ?? current.partialAssetIds,
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

async function scheduleRetry(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  message: string,
  classification: GenerationQueueFailureClassification,
  retryBackoffMs: number,
  nowMs: number
): Promise<GenerationQueueItem | undefined> {
  if (!classification.retryable || item.cancelRequested || item.attempt >= item.maxAttempts) return undefined;
  let requeued: GenerationQueueItem | undefined;
  await queueStore.mutate((queue) => ({
    ...queue,
    updatedAt: iso(nowMs),
    items: queue.items.map((current) => {
      if (current.queueId !== item.queueId) return current;
      requeued = {
        ...current,
        status: "queued",
        stage: "queued",
        nextRunAt: iso(nowMs + Math.max(0, retryBackoffMs)),
        updatedAt: iso(nowMs),
        lastError: message,
        lastErrorCategory: classification.category,
        lastErrorRetryable: classification.retryable,
        completedAt: undefined,
        workerHostId: undefined,
        workerProcessId: undefined,
        workerHeartbeatAt: undefined,
        workerLeaseExpiresAt: undefined
      };
      return requeued;
    })
  }));
  return requeued;
}

async function failClaimedItem<TValue = unknown>(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  error: unknown,
  nowMs: number,
  classification: GenerationQueueFailureClassification
): Promise<GenerationQueueExecutionResult<TValue>> {
  const message = error instanceof Error ? error.message : String(error);
  await completeClaimedItem(
    queueStore,
    item,
    {
      status: "failed",
      error: message,
      errorCategory: classification.category,
      retryable: classification.retryable,
      historyJobId: item.historyJobId,
      outputAssetIds: item.outputAssetIds,
      partialAssetIds: item.partialAssetIds
    },
    nowMs
  );
  return {
    status: "failed",
    error: message,
    errorCategory: classification.category,
    retryable: classification.retryable,
    historyJobId: item.historyJobId,
    outputAssetIds: item.outputAssetIds,
    partialAssetIds: item.partialAssetIds
  };
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
  const stopHeartbeat = startClaimedItemHeartbeat(options.queueStore, item, options.host, leaseMs, now);
  try {
    await markClaimedItemStage(options.queueStore, item.queueId, now());
    const execution = await options.executeItem(item, controller.signal);
    if (execution.status === "failed") {
      const classification = options.classifyFailure?.({ item, result: execution }) ?? defaultFailureClassification();
      const retryItem = await scheduleRetry(
        options.queueStore,
        item,
        execution.error ?? "Generation failed.",
        classification,
        (options.retryBackoffMs ?? defaultRetryBackoffMs)(item, classification),
        now()
      );
      if (retryItem) {
        return {
          claimed: true,
          item: retryItem,
          execution: {
            ...execution,
            errorCategory: classification.category,
            retryable: classification.retryable
          }
        };
      }
      execution.errorCategory = execution.errorCategory ?? classification.category;
      execution.retryable = execution.retryable ?? classification.retryable;
    }
    const completed = await completeClaimedItem(options.queueStore, item, execution, now());
    return { claimed: true, item: completed, execution };
  } catch (error) {
    const classification = options.classifyFailure?.({ item, error }) ?? defaultFailureClassification();
    const message = error instanceof Error ? error.message : String(error);
    const retryItem = await scheduleRetry(
      options.queueStore,
      item,
      message,
      classification,
      (options.retryBackoffMs ?? defaultRetryBackoffMs)(item, classification),
      now()
    );
    if (retryItem) {
      return {
        claimed: true,
        item: retryItem,
        execution: {
          status: "failed",
          error: message,
          errorCategory: classification.category,
          retryable: classification.retryable,
          historyJobId: item.historyJobId,
          outputAssetIds: item.outputAssetIds,
          partialAssetIds: item.partialAssetIds
        }
      };
    }
    const execution = await failClaimedItem<TValue>(options.queueStore, item, error, now(), classification);
    return { claimed: true, item, execution };
  } finally {
    stopHeartbeat();
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
    if (result.claimed && result.item && !TERMINAL_STATUSES.has(result.item.status)) {
      await sleep(pollIntervalMs);
      continue;
    }
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

export async function recordGenerationQueuePartialOutput(queueStore: QueueStore, queueId: string, assetIds: string[], now = Date.now): Promise<GenerationQueueItem | undefined> {
  const incoming = mergeUnique(assetIds);
  if (incoming.length === 0) return undefined;
  let updated: GenerationQueueItem | undefined;
  await queueStore.mutate((queue) => {
    const nowIso = iso(now());
    return {
      ...queue,
      updatedAt: nowIso,
      items: queue.items.map((item) => {
        if (item.queueId !== queueId) return item;
        updated = {
          ...item,
          updatedAt: nowIso,
          partialAssetIds: mergeUnique([...item.partialAssetIds, ...incoming]),
          outputAssetIds: mergeUnique([...item.outputAssetIds, ...incoming])
        };
        return updated;
      })
    };
  });
  return updated;
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
