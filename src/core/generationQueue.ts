import type { GenerationQueueFile, GenerationQueueItem, GenerationQueueWorkerHost, JobStatus, QueueErrorCategory } from "../shared/types.js";
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
  galleryAssetIds?: string[];
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
  completeItem?: (item: GenerationQueueItem, result: GenerationQueueExecutionResult<TValue>, nowMs: number) => Promise<GenerationQueueItem>;
}

export interface GenerationQueueRunResult<TValue = unknown> {
  claimed: boolean;
  item?: GenerationQueueItem;
  execution?: GenerationQueueExecutionResult<TValue>;
}

export interface GenerationQueueRetryResult {
  action: "retried" | "not_found" | "not_retryable";
  item?: GenerationQueueItem;
}

export interface RunGenerationQueueItemToCompletionOptions<TValue = unknown> extends RunNextGenerationQueueItemOptions<TValue> {
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
}

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "failed", "cancelled", "interrupted"]);
const RETRYABLE_TERMINAL_STATUSES = new Set<JobStatus>(["failed", "cancelled", "interrupted"]);

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
): Promise<boolean> {
  let cancelRequested = false;
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
      items: queue.items.map((current) => {
        if (current.queueId !== item.queueId || current.status !== "running" || current.workerHostId !== host.hostId) return current;
        cancelRequested = current.cancelRequested;
        return {
          ...current,
          updatedAt: heartbeatAt,
          workerHeartbeatAt: heartbeatAt,
          workerLeaseExpiresAt: leaseExpiresAt
        };
      })
    };
  });
  return cancelRequested;
}

function startClaimedItemHeartbeat(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  host: QueueHostIdentity,
  leaseMs: number,
  now: () => number,
  onCancelRequested?: () => void
): () => void {
  const intervalMs = Math.max(50, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void refreshClaimedItemHeartbeat(queueStore, item, host, now(), leaseMs)
      .then((cancelRequested) => {
        if (cancelRequested) onCancelRequested?.();
      })
      .catch(() => undefined);
  }, intervalMs);
  return () => clearInterval(timer);
}

async function claimedItemCancelRequested(queueStore: QueueStore, item: GenerationQueueItem): Promise<boolean> {
  const queue = await queueStore.read();
  const current = queue.items.find((candidate) => candidate.queueId === item.queueId);
  return Boolean(current?.cancelRequested);
}

function cancelledExecution<TValue = unknown>(
  item: GenerationQueueItem,
  error = "Generation cancelled.",
  result?: GenerationQueueExecutionResult<TValue>
): GenerationQueueExecutionResult<TValue> {
  return {
    ...result,
    status: "cancelled",
    error,
    errorCategory: "cancelled",
    retryable: false,
    historyJobId: result?.historyJobId ?? item.historyJobId,
    outputAssetIds: result?.outputAssetIds ?? item.outputAssetIds,
    partialAssetIds: result?.partialAssetIds ?? item.partialAssetIds,
    galleryAssetIds: result?.galleryAssetIds ?? item.galleryAssetIds
  };
}

export function completeGenerationQueueItemInQueue(
  queue: GenerationQueueFile,
  item: GenerationQueueItem,
  result: GenerationQueueExecutionResult,
  nowMs: number
): { queue: GenerationQueueFile; item: GenerationQueueItem } {
  let completed: GenerationQueueItem | undefined;
  const nowIso = iso(nowMs);
  const nextQueue = {
    ...queue,
    updatedAt: nowIso,
    items: queue.items.map((current) => {
      if (current.queueId !== item.queueId) return current;
      const status = normalizeTerminalStatus(result.status);
      completed = {
        ...current,
        status,
        stage: "finalizing",
        completedAt: nowIso,
        nextRunAt: undefined,
        updatedAt: nowIso,
        lastError: result.error,
        lastErrorCategory: result.errorCategory,
        lastErrorRetryable: result.retryable,
        historyJobId: result.historyJobId ?? current.historyJobId,
        outputAssetIds: result.outputAssetIds ?? current.outputAssetIds,
        partialAssetIds: result.partialAssetIds ?? current.partialAssetIds,
        galleryAssetIds: result.galleryAssetIds ?? current.galleryAssetIds,
        cancelRequested: status === "cancelled" ? true : current.cancelRequested,
        workerHostId: undefined,
        workerProcessId: undefined,
        workerHeartbeatAt: undefined,
        workerLeaseExpiresAt: undefined
      };
      return completed;
    })
  };
  return {
    queue: nextQueue,
    item: completed ?? item
  };
}

async function completeClaimedItem(
  queueStore: QueueStore,
  item: GenerationQueueItem,
  result: GenerationQueueExecutionResult,
  nowMs: number
): Promise<GenerationQueueItem> {
  let completed: GenerationQueueItem | undefined;
  await queueStore.mutate((queue) => {
    const next = completeGenerationQueueItemInQueue(queue, item, result, nowMs);
    completed = next.item;
    return next.queue;
  });
  return completed ?? item;
}

async function completeClaimedItemWithOptions<TValue>(
  options: RunNextGenerationQueueItemOptions<TValue>,
  item: GenerationQueueItem,
  result: GenerationQueueExecutionResult<TValue>,
  nowMs: number
): Promise<GenerationQueueItem> {
  if (options.completeItem) {
    return options.completeItem(item, result, nowMs);
  }
  return completeClaimedItem(options.queueStore, item, result, nowMs);
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
  options: RunNextGenerationQueueItemOptions<TValue>,
  item: GenerationQueueItem,
  error: unknown,
  nowMs: number,
  classification: GenerationQueueFailureClassification
): Promise<{ item: GenerationQueueItem; execution: GenerationQueueExecutionResult<TValue> }> {
  const message = error instanceof Error ? error.message : String(error);
  const execution: GenerationQueueExecutionResult<TValue> = {
    status: "failed",
    error: message,
    errorCategory: classification.category,
    retryable: classification.retryable,
    historyJobId: item.historyJobId,
    outputAssetIds: item.outputAssetIds,
    partialAssetIds: item.partialAssetIds,
    galleryAssetIds: item.galleryAssetIds
  };
  const completed = await completeClaimedItemWithOptions(
    options,
    item,
    execution,
    nowMs
  );
  return { item: completed, execution };
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
  const stopHeartbeat = startClaimedItemHeartbeat(options.queueStore, item, options.host, leaseMs, now, () => controller.abort());
  try {
    await markClaimedItemStage(options.queueStore, item.queueId, now());
    let execution = await options.executeItem(item, controller.signal);
    if (execution.status !== "cancelled" && (await claimedItemCancelRequested(options.queueStore, item))) {
      execution = cancelledExecution(item, execution.error ?? "Generation cancelled.", execution);
    }
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
    const completed = await completeClaimedItemWithOptions(options, item, execution, now());
    return { claimed: true, item: completed, execution };
  } catch (error) {
    if (await claimedItemCancelRequested(options.queueStore, item)) {
      const execution = cancelledExecution<TValue>(item, error instanceof Error ? error.message : "Generation cancelled.");
      const completed = await completeClaimedItemWithOptions(options, item, execution, now());
      return { claimed: true, item: completed, execution };
    }
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
          partialAssetIds: item.partialAssetIds,
          galleryAssetIds: item.galleryAssetIds
        }
      };
    }
    const failed = await failClaimedItem<TValue>(options, item, error, now(), classification);
    return { claimed: true, item: failed.item, execution: failed.execution };
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
    const next = requestGenerationQueueItemCancelInQueue(queue, queueId, now());
    updated = next.item;
    return next.queue;
  });
  return updated;
}

export function requestGenerationQueueItemCancelInQueue(
  queue: GenerationQueueFile,
  queueId: string,
  nowMs: number
): { queue: GenerationQueueFile; item?: GenerationQueueItem } {
  let updated: GenerationQueueItem | undefined;
  const nowIso = iso(nowMs);
  const nextQueue = {
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
  return { queue: nextQueue, item: updated };
}

export async function retryGenerationQueueItem(queueStore: QueueStore, lookupId: string, now = Date.now): Promise<GenerationQueueRetryResult> {
  const normalizedLookupId = lookupId.trim();
  if (!normalizedLookupId) return { action: "not_found" };
  let result: GenerationQueueRetryResult = { action: "not_found" };
  await queueStore.mutate((queue) => {
    const next = retryGenerationQueueItemInQueue(queue, normalizedLookupId, now());
    result = next.result;
    return next.queue;
  });
  return result;
}

export function retryGenerationQueueItemInQueue(
  queue: GenerationQueueFile,
  lookupId: string,
  nowMs: number
): { queue: GenerationQueueFile; result: GenerationQueueRetryResult } {
  const normalizedLookupId = lookupId.trim();
  if (!normalizedLookupId) {
    return { queue, result: { action: "not_found" } };
  }

  let found: GenerationQueueItem | undefined;
  let retried: GenerationQueueItem | undefined;
  const nowIso = iso(nowMs);
  const nextQueue = {
    ...queue,
    updatedAt: nowIso,
    items: queue.items.map((item) => {
      if (item.queueId !== normalizedLookupId && item.historyJobId !== normalizedLookupId) return item;
      found = item;
      if (!RETRYABLE_TERMINAL_STATUSES.has(item.status)) return item;
      retried = {
        ...item,
        status: "queued",
        stage: "queued",
        attempt: 0,
        startedAt: undefined,
        completedAt: undefined,
        nextRunAt: undefined,
        lastError: undefined,
        lastErrorCategory: undefined,
        lastErrorRetryable: undefined,
        outputAssetIds: [],
        partialAssetIds: [],
        galleryAssetIds: [],
        cancelRequested: false,
        workerHostId: undefined,
        workerProcessId: undefined,
        workerHeartbeatAt: undefined,
        workerLeaseExpiresAt: undefined,
        updatedAt: nowIso
      };
      return retried;
    })
  };

  if (retried) return { queue: nextQueue, result: { action: "retried", item: retried } };
  if (found) return { queue: nextQueue, result: { action: "not_retryable", item: found } };
  return { queue: nextQueue, result: { action: "not_found" } };
}
