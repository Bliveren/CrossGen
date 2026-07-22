import { promises as fs } from "node:fs";
import path from "node:path";
import { withExclusiveFileLock } from "./fileLock.js";
import type {
  GenerationQueueFile,
  GenerationQueueItem,
  GenerationQueueWorkerHost,
  QueueErrorCategory,
  JobStatus,
  QueueExecutionKind,
  QueueStage
} from "../shared/types.js";

export interface QueueStoreOptions {
  queuePath: string;
  lockPath: string;
  timeoutMs?: number;
  staleLockMs?: number;
  staleRunningAfterMs?: number;
  leaseMs?: number;
  now?: () => number;
}

export interface QueueHostIdentity {
  hostId: string;
  kind: GenerationQueueWorkerHost["kind"];
  processId: number;
}

export interface ClaimRunnableItemsOptions {
  host: QueueHostIdentity;
  limit: number;
  queueId?: string;
  maxGlobalRunning?: number;
  providerConcurrency?: Record<string, number>;
}

export interface QueueStore {
  read(): Promise<GenerationQueueFile>;
  write(queue: GenerationQueueFile): Promise<void>;
  mutate(mutator: (queue: GenerationQueueFile) => GenerationQueueFile | Promise<GenerationQueueFile>): Promise<GenerationQueueFile>;
  recoverStaleRunningItems(now?: number): Promise<GenerationQueueFile>;
  registerWorkerHeartbeat(host: GenerationQueueWorkerHost): Promise<GenerationQueueFile>;
  claimRunnableItems(options: ClaimRunnableItemsOptions): Promise<GenerationQueueItem[]>;
  appendItem(item: GenerationQueueItem): Promise<GenerationQueueFile>;
}

const DEFAULT_QUEUE_FILE: GenerationQueueFile = {
  schemaVersion: 1,
  updatedAt: new Date(0).toISOString(),
  items: [],
  workerHosts: []
};

const WORKER_HOST_EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RETAINED_WORKER_HOSTS = 20;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function readQueueFile(queuePath: string): Promise<GenerationQueueFile> {
  try {
    const raw = JSON.parse(await fs.readFile(queuePath, "utf8")) as Partial<GenerationQueueFile>;
    return normalizeQueueFile(raw);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return structuredClone(DEFAULT_QUEUE_FILE);
    }
    throw error;
  }
}

export async function writeQueueFile(queuePath: string, queue: GenerationQueueFile): Promise<void> {
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  const tmpPath = `${queuePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, queuePath);
}

export function normalizeQueueFile(raw: Partial<GenerationQueueFile> | null | undefined): GenerationQueueFile {
  return {
    schemaVersion: 1,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    items: Array.isArray(raw?.items) ? raw!.items.map((item) => normalizeQueueItem(item as Partial<GenerationQueueItem>)) : [],
    workerHosts: Array.isArray(raw?.workerHosts) ? raw!.workerHosts.map((host) => normalizeQueueWorkerHost(host as Partial<GenerationQueueWorkerHost>)) : []
  };
}

function normalizeQueueItem(raw: Partial<GenerationQueueItem>): GenerationQueueItem {
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  return {
    queueId: typeof raw.queueId === "string" ? raw.queueId : `queue_${Math.random().toString(36).slice(2, 10)}`,
    source: raw.source === "desktop" || raw.source === "cli" || raw.source === "mcp" ? raw.source : "desktop",
    providerId: typeof raw.providerId === "string" ? raw.providerId : "default",
    request: raw.request as GenerationQueueItem["request"],
    status: normalizeJobStatus(raw.status),
    priority: typeof raw.priority === "number" ? raw.priority : 0,
    attempt: typeof raw.attempt === "number" ? raw.attempt : 0,
    maxAttempts: typeof raw.maxAttempts === "number" ? raw.maxAttempts : 1,
    createdAt,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
    nextRunAt: typeof raw.nextRunAt === "string" ? raw.nextRunAt : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    lastErrorCategory: normalizeQueueErrorCategory(raw.lastErrorCategory),
    lastErrorRetryable: typeof raw.lastErrorRetryable === "boolean" ? raw.lastErrorRetryable : undefined,
    historyJobId: typeof raw.historyJobId === "string" ? raw.historyJobId : undefined,
    outputAssetIds: Array.isArray(raw.outputAssetIds) ? raw.outputAssetIds.filter((value): value is string => typeof value === "string") : [],
    partialAssetIds: Array.isArray(raw.partialAssetIds) ? raw.partialAssetIds.filter((value): value is string => typeof value === "string") : [],
    galleryAssetIds: Array.isArray(raw.galleryAssetIds) ? raw.galleryAssetIds.filter((value): value is string => typeof value === "string") : [],
    targetGalleryFolderId: typeof raw.targetGalleryFolderId === "string" ? raw.targetGalleryFolderId : raw.targetGalleryFolderId === null ? null : undefined,
    cancelRequested: Boolean(raw.cancelRequested),
    costConfirmed: Boolean(raw.costConfirmed),
    workerHostId: typeof raw.workerHostId === "string" ? raw.workerHostId : undefined,
    workerProcessId: typeof raw.workerProcessId === "number" ? raw.workerProcessId : undefined,
    workerHeartbeatAt: typeof raw.workerHeartbeatAt === "string" ? raw.workerHeartbeatAt : undefined,
    workerLeaseExpiresAt: typeof raw.workerLeaseExpiresAt === "string" ? raw.workerLeaseExpiresAt : undefined,
    executionKind: normalizeExecutionKind(raw.executionKind),
    stage: normalizeQueueStage(raw.stage),
    remoteJobHandle: typeof raw.remoteJobHandle === "string" ? raw.remoteJobHandle : undefined,
    remoteProviderStatus: typeof raw.remoteProviderStatus === "string" ? raw.remoteProviderStatus : undefined,
    remoteExpiresAt: typeof raw.remoteExpiresAt === "string" ? raw.remoteExpiresAt : undefined,
    lastPollAt: typeof raw.lastPollAt === "string" ? raw.lastPollAt : undefined,
    localStep: typeof raw.localStep === "string" ? raw.localStep : undefined,
    sourceAssetIds: Array.isArray(raw.sourceAssetIds) ? raw.sourceAssetIds.filter((value): value is string => typeof value === "string") : [],
    outputMediaKinds: Array.isArray(raw.outputMediaKinds) ? raw.outputMediaKinds.filter(isMediaKind) : ["image"],
    idempotencyKey: typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : undefined,
    requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
    correlationId: typeof raw.correlationId === "string" ? raw.correlationId : undefined
  };
}

function normalizeQueueWorkerHost(raw: Partial<GenerationQueueWorkerHost>): GenerationQueueWorkerHost {
  const now = new Date().toISOString();
  return {
    hostId: typeof raw.hostId === "string" ? raw.hostId : `host_${Math.random().toString(36).slice(2, 10)}`,
    kind: raw.kind === "desktop" || raw.kind === "mcp" || raw.kind === "cli-worker" ? raw.kind : "desktop",
    processId: typeof raw.processId === "number" ? raw.processId : process.pid,
    mode: "generate",
    heartbeatAt: typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : now,
    leaseExpiresAt: typeof raw.leaseExpiresAt === "string" ? raw.leaseExpiresAt : now
  };
}

function normalizeJobStatus(value: unknown): JobStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "interrupted"
    ? value
    : "queued";
}

function normalizeExecutionKind(value: unknown): QueueExecutionKind {
  return value === "remote-poll" || value === "local-cpu" ? value : "sync-provider";
}

function normalizeQueueStage(value: unknown): QueueStage {
  return value === "claiming" || value === "calling_provider" || value === "awaiting_remote" || value === "downloading" || value === "postprocessing" || value === "finalizing"
    ? value
    : "queued";
}

function normalizeQueueErrorCategory(value: unknown): QueueErrorCategory | undefined {
  return value === "transient" ||
    value === "auth" ||
    value === "quota" ||
    value === "safety" ||
    value === "cancelled" ||
    value === "unsupported" ||
    value === "unknown"
    ? value
    : undefined;
}

function isMediaKind(value: unknown): value is "image" | "animated-gif" | "video" {
  return value === "image" || value === "animated-gif" || value === "video";
}

function cloneQueue(queue: GenerationQueueFile): GenerationQueueFile {
  return structuredClone(queue);
}

function hostTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function workerHostRecencyMs(host: GenerationQueueWorkerHost): number {
  return Math.max(hostTimestampMs(host.leaseExpiresAt), hostTimestampMs(host.heartbeatAt));
}

function pruneWorkerHosts(queue: GenerationQueueFile, nowMs: number): GenerationQueueFile {
  const staleLeaseCutoffMs = nowMs - WORKER_HOST_EXPIRED_RETENTION_MS;
  const next = cloneQueue(queue);
  next.workerHosts = next.workerHosts
    .filter((host) => {
      const leaseExpiresAt = hostTimestampMs(host.leaseExpiresAt);
      if (!Number.isFinite(leaseExpiresAt)) return workerHostRecencyMs(host) > staleLeaseCutoffMs;
      return leaseExpiresAt > staleLeaseCutoffMs;
    })
    .sort((a, b) => workerHostRecencyMs(b) - workerHostRecencyMs(a) || a.hostId.localeCompare(b.hostId))
    .slice(0, MAX_RETAINED_WORKER_HOSTS);
  return next;
}

function normalizeQueueForWrite(queue: GenerationQueueFile, nowMs: number): GenerationQueueFile {
  return pruneWorkerHosts(normalizeQueueFile(queue), nowMs);
}

function markStaleRunning(queue: GenerationQueueFile, nowMs: number, staleRunningAfterMs: number): GenerationQueueFile {
  const next = cloneQueue(queue);
  for (const item of next.items) {
    if (item.status !== "running") continue;
    const leaseExpiresAt = item.workerLeaseExpiresAt ? Date.parse(item.workerLeaseExpiresAt) : Number.NaN;
    const heartbeatAt = item.workerHeartbeatAt ? Date.parse(item.workerHeartbeatAt) : Number.NaN;
    const leaseExpired = Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= nowMs;
    const heartbeatStale = Number.isFinite(heartbeatAt) && nowMs - heartbeatAt >= staleRunningAfterMs;
    if (leaseExpired || heartbeatStale) {
      item.status = "interrupted";
      item.stage = "queued";
      item.workerHostId = undefined;
      item.workerHeartbeatAt = undefined;
      item.workerLeaseExpiresAt = undefined;
      item.completedAt = item.completedAt ?? new Date(nowMs).toISOString();
      item.updatedAt = new Date(nowMs).toISOString();
    }
  }
  next.updatedAt = new Date(nowMs).toISOString();
  return next;
}

function activeRunningItems(queue: GenerationQueueFile): GenerationQueueItem[] {
  return queue.items.filter((item) => item.status === "running");
}

function claimItems(queue: GenerationQueueFile, options: ClaimRunnableItemsOptions, nowMs: number, leaseMs: number): GenerationQueueItem[] {
  const runningItems = activeRunningItems(queue);
  const globalCapacity =
    typeof options.maxGlobalRunning === "number"
      ? Math.max(0, options.maxGlobalRunning - runningItems.length)
      : Number.POSITIVE_INFINITY;
  const claimLimit = Math.min(Math.max(0, options.limit), globalCapacity);
  if (claimLimit <= 0) return [];

  const runningByProvider = new Map<string, number>();
  for (const item of runningItems) {
    runningByProvider.set(item.providerId, (runningByProvider.get(item.providerId) ?? 0) + 1);
  }

  const eligible = queue.items
    .filter((item) => {
      if (item.status !== "queued" || item.cancelRequested) return false;
      if (options.queueId && item.queueId !== options.queueId) return false;
      const nextRunAt = item.nextRunAt ? Date.parse(item.nextRunAt) : Number.NaN;
      return !Number.isFinite(nextRunAt) || nextRunAt <= nowMs;
    })
    .sort((a, b) => a.priority - b.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const claimed: GenerationQueueItem[] = [];
  for (const item of eligible) {
    if (claimed.length >= claimLimit) break;
    const providerLimit = options.providerConcurrency?.[item.providerId];
    const providerRunning = runningByProvider.get(item.providerId) ?? 0;
    if (typeof providerLimit === "number" && providerRunning >= providerLimit) continue;

    item.status = "running";
    item.attempt += 1;
    item.startedAt = item.startedAt ?? new Date(nowMs).toISOString();
    item.updatedAt = new Date(nowMs).toISOString();
    item.workerHostId = options.host.hostId;
    item.workerProcessId = options.host.processId;
    item.workerHeartbeatAt = new Date(nowMs).toISOString();
    item.workerLeaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
    item.stage = "claiming";
    runningByProvider.set(item.providerId, providerRunning + 1);
    claimed.push(structuredClone(item));
  }
  if (claimed.length > 0) {
    queue.updatedAt = new Date(nowMs).toISOString();
  }
  return claimed;
}

export function createQueueStore(options: QueueStoreOptions): QueueStore {
  const timeoutMs = options.timeoutMs ?? 5000;
  const staleLockMs = options.staleLockMs ?? 30000;
  const staleRunningAfterMs = options.staleRunningAfterMs ?? 30000;
  const leaseMs = options.leaseMs ?? 30000;
  const now = options.now ?? Date.now;

  return {
    async read(): Promise<GenerationQueueFile> {
      return readQueueFile(options.queuePath);
    },
    async write(queue: GenerationQueueFile): Promise<void> {
      await withExclusiveFileLock(options.lockPath, async () => writeQueueFile(options.queuePath, normalizeQueueForWrite(queue, now())), {
        timeoutMs,
        staleLockMs
      });
    },
    async mutate(mutator: (queue: GenerationQueueFile) => GenerationQueueFile | Promise<GenerationQueueFile>): Promise<GenerationQueueFile> {
      return withExclusiveFileLock(
        options.lockPath,
        async () => {
          const current = await readQueueFile(options.queuePath);
          const next = normalizeQueueForWrite(await mutator(current), now());
          await writeQueueFile(options.queuePath, next);
          return next;
        },
        { timeoutMs, staleLockMs }
      );
    },
    async recoverStaleRunningItems(nowOverride = now()): Promise<GenerationQueueFile> {
      return withExclusiveFileLock(
        options.lockPath,
        async () => {
          const current = await readQueueFile(options.queuePath);
          const next = pruneWorkerHosts(markStaleRunning(current, nowOverride, staleRunningAfterMs), nowOverride);
          await writeQueueFile(options.queuePath, next);
          return next;
        },
        { timeoutMs, staleLockMs }
      );
    },
    async registerWorkerHeartbeat(host: GenerationQueueWorkerHost): Promise<GenerationQueueFile> {
      return withExclusiveFileLock(
        options.lockPath,
        async () => {
          const current = await readQueueFile(options.queuePath);
          const next = cloneQueue(current);
          const nowIso = new Date(now()).toISOString();
          const normalized: GenerationQueueWorkerHost = {
            hostId: host.hostId,
            kind: host.kind,
            processId: host.processId,
            mode: "generate",
            heartbeatAt: host.heartbeatAt || nowIso,
            leaseExpiresAt: host.leaseExpiresAt || nowIso
          };
          const index = next.workerHosts.findIndex((item) => item.hostId === normalized.hostId);
          if (index >= 0) next.workerHosts[index] = normalized;
          else next.workerHosts.push(normalized);
          next.updatedAt = nowIso;
          const pruned = pruneWorkerHosts(next, Date.parse(nowIso));
          await writeQueueFile(options.queuePath, pruned);
          return pruned;
        },
        { timeoutMs, staleLockMs }
      );
    },
    async claimRunnableItems(claimOptions: ClaimRunnableItemsOptions): Promise<GenerationQueueItem[]> {
      return withExclusiveFileLock(
        options.lockPath,
        async () => {
          const current = await readQueueFile(options.queuePath);
          const nowMs = now();
          const recovered = markStaleRunning(current, nowMs, staleRunningAfterMs);
          const claimed = claimItems(recovered, claimOptions, nowMs, leaseMs);
          const next = pruneWorkerHosts(recovered, nowMs);
          await writeQueueFile(options.queuePath, next);
          return claimed;
        },
        { timeoutMs, staleLockMs }
      );
    },
    async appendItem(item: GenerationQueueItem): Promise<GenerationQueueFile> {
      return withExclusiveFileLock(
        options.lockPath,
        async () => {
          const current = await readQueueFile(options.queuePath);
          const next = cloneQueue(current);
          next.items.push(normalizeQueueItem(item));
          const nowMs = now();
          next.updatedAt = new Date(nowMs).toISOString();
          const pruned = pruneWorkerHosts(next, nowMs);
          await writeQueueFile(options.queuePath, pruned);
          return pruned;
        },
        { timeoutMs, staleLockMs }
      );
    }
  };
}
