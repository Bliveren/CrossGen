import { DEFAULT_QUEUE_RUNTIME_CONFIG, normalizeQueueRuntimeConfig } from "./queueConfig.js";
import type {
  GenerationQueueFile,
  GenerationQueueItem,
  GenerationQueueWorkerHost,
  JobStatus,
  QueueRuntimeConfig,
  QueueSnapshot,
  QueueTaskSummary,
  QueueWorkerSummary,
  TaskDiagnostic
} from "../shared/types.js";

export interface BuildQueueSnapshotOptions {
  now?: number | (() => number);
  recentLimit?: number;
  statusLimit?: number;
  promptPreviewLength?: number;
}

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "failed", "cancelled", "interrupted"]);
const RETRYABLE_TERMINAL_STATUSES = new Set<JobStatus>(["failed", "cancelled", "interrupted"]);

function nowMs(option: BuildQueueSnapshotOptions["now"]): number {
  if (typeof option === "function") return option();
  if (typeof option === "number") return option;
  return Date.now();
}

function safeDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveDuration(startMs: number | undefined, endMs: number | undefined): number | undefined {
  if (startMs === undefined || endMs === undefined) return undefined;
  return Math.max(0, endMs - startMs);
}

function promptPreview(prompt: string, maxLength: number): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function isRetryable(item: GenerationQueueItem): boolean {
  return RETRYABLE_TERMINAL_STATUSES.has(item.status);
}

function chargedRetryRisk(item: GenerationQueueItem): boolean {
  return isRetryable(item) && item.attempt > 0;
}

function attemptIndex(item: GenerationQueueItem): number {
  if (item.status === "queued") {
    return Math.max(1, Math.min(item.maxAttempts, item.attempt + 1));
  }
  return Math.max(1, item.attempt);
}

function itemSortMs(item: GenerationQueueItem): number {
  return safeDateMs(item.completedAt) ?? safeDateMs(item.updatedAt) ?? safeDateMs(item.startedAt) ?? safeDateMs(item.createdAt) ?? 0;
}

function nextActionsFor(item: GenerationQueueItem): string[] | undefined {
  if (!item.lastError && !item.lastErrorCategory) return undefined;
  if (item.lastErrorCategory === "auth") return ["Check the selected API key and provider configuration before retrying."];
  if (item.lastErrorCategory === "quota") return ["Check provider balance or quota before retrying."];
  if (item.lastErrorCategory === "unsupported") return ["Switch to a model or route that supports this generation mode."];
  if (item.lastErrorCategory === "safety") return ["Revise the prompt or input image before retrying."];
  if (item.lastErrorCategory === "cancelled") return ["Retry only if you want to submit a new provider request."];
  if (item.lastErrorRetryable === false) return ["Inspect the error before retrying; the last failure was classified as non-retryable."];
  if (isRetryable(item)) return ["Retry may submit a new paid provider request."];
  return undefined;
}

function diagnosticFor(item: GenerationQueueItem): TaskDiagnostic | undefined {
  const retryable = isRetryable(item);
  const diagnostic: TaskDiagnostic = {
    error: item.lastError,
    errorCategory: item.lastErrorCategory,
    retryable,
    chargedRetryRisk: chargedRetryRisk(item),
    nextActions: nextActionsFor(item)
  };
  return diagnostic.error || diagnostic.errorCategory || diagnostic.retryable || diagnostic.chargedRetryRisk
    ? diagnostic
    : undefined;
}

export function buildQueueTaskSummary(
  item: GenerationQueueItem,
  options: BuildQueueSnapshotOptions = {}
): QueueTaskSummary {
  const generatedMs = nowMs(options.now);
  const previewLength = options.promptPreviewLength ?? 180;
  const createdMs = safeDateMs(item.createdAt) ?? generatedMs;
  const startedMs = safeDateMs(item.startedAt);
  const completedMs = safeDateMs(item.completedAt);
  const effectiveEndMs = TERMINAL_STATUSES.has(item.status) ? completedMs ?? safeDateMs(item.updatedAt) : generatedMs;
  const elapsedMs = positiveDuration(startedMs ?? (TERMINAL_STATUSES.has(item.status) ? createdMs : undefined), effectiveEndMs);
  const completedAttempts = item.status === "queued" ? item.attempt : Math.max(0, item.attempt);
  const maxAttempts = Math.max(1, item.maxAttempts);
  const summary: QueueTaskSummary = {
    queueId: item.queueId,
    source: item.source,
    providerId: item.providerId,
    status: item.status,
    stage: item.stage,
    mode: item.request.mode,
    promptPreview: promptPreview(item.request.prompt, previewLength),
    inputCount: item.request.inputPaths.length,
    hasMask: Boolean(item.request.maskPath || item.request.maskDataUrl),
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    nextRunAt: item.nextRunAt,
    elapsedMs,
    ageMs: Math.max(0, generatedMs - createdMs),
    attempt: item.attempt,
    attemptIndex: attemptIndex(item),
    maxAttempts,
    completedAttempts,
    remainingAttempts: Math.max(0, maxAttempts - item.attempt),
    retryable: isRetryable(item),
    chargedRetryRisk: chargedRetryRisk(item),
    canCancel: item.status === "queued" || item.status === "running",
    cancelRequested: item.cancelRequested,
    workerHostId: item.workerHostId,
    workerProcessId: item.workerProcessId,
    workerHeartbeatAt: item.workerHeartbeatAt,
    workerLeaseExpiresAt: item.workerLeaseExpiresAt,
    historyJobId: item.historyJobId,
    outputAssetIds: item.outputAssetIds,
    partialAssetIds: item.partialAssetIds,
    galleryAssetIds: item.galleryAssetIds,
    targetGalleryFolderId: item.targetGalleryFolderId ?? null,
    executionKind: item.executionKind,
    remoteProviderStatus: item.remoteProviderStatus,
    lastPollAt: item.lastPollAt,
    localStep: item.localStep,
    outputMediaKinds: item.outputMediaKinds,
    sourceAssetIds: item.sourceAssetIds,
    requestId: item.requestId,
    correlationId: item.correlationId,
    diagnostic: diagnosticFor(item)
  };
  return summary;
}

function buildWorkerSummary(host: GenerationQueueWorkerHost, generatedMs: number): QueueWorkerSummary {
  const heartbeatMs = safeDateMs(host.heartbeatAt);
  const leaseMs = safeDateMs(host.leaseExpiresAt);
  const online = leaseMs !== undefined && leaseMs > generatedMs;
  return {
    hostId: host.hostId,
    kind: host.kind,
    processId: host.processId,
    mode: host.mode,
    heartbeatAt: host.heartbeatAt,
    leaseExpiresAt: host.leaseExpiresAt,
    online,
    lastHeartbeatAgeMs: positiveDuration(heartbeatMs, generatedMs),
    leaseRemainingMs: online && leaseMs !== undefined ? leaseMs - generatedMs : undefined
  };
}

function limitStatus(items: QueueTaskSummary[], limit: number): QueueTaskSummary[] {
  return items.slice(0, Math.max(0, limit));
}

export function buildQueueSnapshot(
  queue: GenerationQueueFile,
  queueConfig: QueueRuntimeConfig = DEFAULT_QUEUE_RUNTIME_CONFIG,
  options: BuildQueueSnapshotOptions = {}
): QueueSnapshot {
  const generatedMs = nowMs(options.now);
  const generatedAt = new Date(generatedMs).toISOString();
  const normalizedConfig = normalizeQueueRuntimeConfig(queueConfig);
  const statusLimit = options.statusLimit ?? 20;
  const recentLimit = options.recentLimit ?? 20;
  const summaries = queue.items
    .map((item) => ({ item, summary: buildQueueTaskSummary(item, { ...options, now: generatedMs }) }))
    .sort((a, b) => itemSortMs(a.item) - itemSortMs(b.item) || a.item.queueId.localeCompare(b.item.queueId))
    .map(({ summary }) => summary);

  const byRecent = [...summaries].sort((a, b) => {
    const aMs = safeDateMs(a.completedAt) ?? safeDateMs(a.updatedAt) ?? safeDateMs(a.startedAt) ?? safeDateMs(a.createdAt) ?? 0;
    const bMs = safeDateMs(b.completedAt) ?? safeDateMs(b.updatedAt) ?? safeDateMs(b.startedAt) ?? safeDateMs(b.createdAt) ?? 0;
    return bMs - aMs || a.queueId.localeCompare(b.queueId);
  });
  const queued = summaries.filter((item) => item.status === "queued");
  const running = summaries.filter((item) => item.status === "running");
  const succeeded = byRecent.filter((item) => item.status === "succeeded");
  const failed = byRecent.filter((item) => item.status === "failed");
  const cancelled = byRecent.filter((item) => item.status === "cancelled");
  const interrupted = byRecent.filter((item) => item.status === "interrupted");
  const workers = queue.workerHosts.map((host) => buildWorkerSummary(host, generatedMs));
  const runningGlobal = running.length;

  return {
    schemaVersion: 1,
    updatedAt: queue.updatedAt,
    generatedAt,
    counts: {
      total: queue.items.length,
      active: queued.length + running.length,
      terminal: queue.items.length - queued.length - running.length,
      queued: queued.length,
      running: running.length,
      succeeded: succeeded.length,
      succeededRecent: succeeded.length,
      failed: failed.length,
      cancelled: cancelled.length,
      interrupted: interrupted.length,
      retryable: summaries.filter((item) => item.retryable).length,
      cancelRequested: summaries.filter((item) => item.cancelRequested).length
    },
    concurrency: {
      maxGlobal: normalizedConfig.maxGlobalRunning,
      runningGlobal,
      availableGlobal: Math.max(0, normalizedConfig.maxGlobalRunning - runningGlobal),
      providerConcurrency: normalizedConfig.providerConcurrency
    },
    workers: {
      total: workers.length,
      online: workers.filter((host) => host.online).length,
      offline: workers.filter((host) => !host.online).length,
      hosts: workers
    },
    queued: limitStatus(queued, statusLimit),
    running: limitStatus(running, statusLimit),
    succeededRecent: limitStatus(succeeded, statusLimit),
    failed: limitStatus(failed, statusLimit),
    cancelled: limitStatus(cancelled, statusLimit),
    interrupted: limitStatus(interrupted, statusLimit),
    recentJobs: limitStatus(byRecent, recentLimit)
  };
}
