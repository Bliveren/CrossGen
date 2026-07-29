import { describe, expect, it } from "vitest";
import { buildQueueSnapshot, buildQueueTaskSummary } from "./queueSnapshot.js";
import type { GenerationQueueFile, GenerationQueueItem, GenerationQueueWorkerHost } from "../shared/types.js";

const NOW = Date.parse("2026-07-29T08:00:00.000Z");

function item(patch: Partial<GenerationQueueItem> = {}): GenerationQueueItem {
  return {
    queueId: patch.queueId ?? "queue-1",
    source: patch.source ?? "desktop",
    providerId: patch.providerId ?? "provider-1",
    request: patch.request ?? {
      mode: "generate",
      prompt: "create a blue product hero image",
      inputPaths: [],
      params: {
        providerKind: "openai",
        launchId: "gpt-image-2",
        model: "gpt-image-2",
        imageRoute: "auto",
        size: "1024x1024",
        quality: "auto",
        outputFormat: "png",
        outputCompression: 100,
        background: "auto",
        n: 1,
        stream: false,
        partialImages: 0,
        moderation: "auto",
        timeoutMs: 1000
      }
    },
    status: patch.status ?? "queued",
    priority: patch.priority ?? 0,
    attempt: patch.attempt ?? 0,
    maxAttempts: patch.maxAttempts ?? 2,
    createdAt: patch.createdAt ?? "2026-07-29T07:59:00.000Z",
    startedAt: patch.startedAt,
    updatedAt: patch.updatedAt ?? "2026-07-29T07:59:00.000Z",
    completedAt: patch.completedAt,
    nextRunAt: patch.nextRunAt,
    lastError: patch.lastError,
    lastErrorCategory: patch.lastErrorCategory,
    lastErrorRetryable: patch.lastErrorRetryable,
    historyJobId: patch.historyJobId,
    outputAssetIds: patch.outputAssetIds ?? [],
    partialAssetIds: patch.partialAssetIds ?? [],
    galleryAssetIds: patch.galleryAssetIds ?? [],
    targetGalleryFolderId: patch.targetGalleryFolderId,
    cancelRequested: patch.cancelRequested ?? false,
    costConfirmed: patch.costConfirmed ?? true,
    workerHostId: patch.workerHostId,
    workerProcessId: patch.workerProcessId,
    workerHeartbeatAt: patch.workerHeartbeatAt,
    workerLeaseExpiresAt: patch.workerLeaseExpiresAt,
    executionKind: patch.executionKind ?? "sync-provider",
    stage: patch.stage ?? "queued",
    remoteProviderStatus: patch.remoteProviderStatus,
    lastPollAt: patch.lastPollAt,
    localStep: patch.localStep,
    sourceAssetIds: patch.sourceAssetIds ?? [],
    outputMediaKinds: patch.outputMediaKinds ?? ["image"],
    requestId: patch.requestId,
    correlationId: patch.correlationId
  };
}

function host(patch: Partial<GenerationQueueWorkerHost> = {}): GenerationQueueWorkerHost {
  return {
    hostId: patch.hostId ?? "host-online",
    kind: patch.kind ?? "desktop",
    processId: patch.processId ?? 123,
    mode: "generate",
    heartbeatAt: patch.heartbeatAt ?? "2026-07-29T07:59:50.000Z",
    leaseExpiresAt: patch.leaseExpiresAt ?? "2026-07-29T08:00:30.000Z"
  };
}

describe("queue snapshot", () => {
  it("summarizes queue counts, concurrency, live workers, elapsed time, and retryability", () => {
    const queue: GenerationQueueFile = {
      schemaVersion: 1,
      updatedAt: "2026-07-29T08:00:00.000Z",
      workerHosts: [
        host(),
        host({
          hostId: "host-offline",
          heartbeatAt: "2026-07-29T07:00:00.000Z",
          leaseExpiresAt: "2026-07-29T07:01:00.000Z"
        })
      ],
      items: [
        item({ queueId: "queue-queued", status: "queued" }),
        item({
          queueId: "queue-running",
          status: "running",
          stage: "calling_provider",
          attempt: 1,
          startedAt: "2026-07-29T07:59:30.000Z",
          workerHostId: "host-online",
          workerProcessId: 123,
          workerHeartbeatAt: "2026-07-29T07:59:50.000Z",
          workerLeaseExpiresAt: "2026-07-29T08:00:30.000Z"
        }),
        item({
          queueId: "queue-succeeded",
          status: "succeeded",
          attempt: 1,
          startedAt: "2026-07-29T07:58:00.000Z",
          completedAt: "2026-07-29T07:58:45.000Z",
          updatedAt: "2026-07-29T07:58:45.000Z"
        }),
        item({
          queueId: "queue-failed",
          status: "failed",
          attempt: 2,
          startedAt: "2026-07-29T07:57:00.000Z",
          completedAt: "2026-07-29T07:57:20.000Z",
          updatedAt: "2026-07-29T07:57:20.000Z",
          lastError: "provider timeout",
          lastErrorCategory: "transient",
          lastErrorRetryable: true
        }),
        item({ queueId: "queue-cancelled", status: "cancelled", attempt: 1 }),
        item({ queueId: "queue-interrupted", status: "interrupted", attempt: 1 })
      ]
    };

    const snapshot = buildQueueSnapshot(queue, { maxGlobalRunning: 3, providerConcurrency: { "provider-1": 2 } }, { now: NOW });

    expect(snapshot.counts).toMatchObject({
      total: 6,
      active: 2,
      queued: 1,
      running: 1,
      succeeded: 1,
      succeededRecent: 1,
      failed: 1,
      cancelled: 1,
      interrupted: 1,
      retryable: 3
    });
    expect(snapshot.concurrency).toMatchObject({
      maxGlobal: 3,
      runningGlobal: 1,
      availableGlobal: 2,
      providerConcurrency: { "provider-1": 2 }
    });
    expect(snapshot.workers).toMatchObject({ total: 2, online: 1, offline: 1 });
    expect(snapshot.running[0]).toMatchObject({
      queueId: "queue-running",
      elapsedMs: 30000,
      attemptIndex: 1,
      canCancel: true,
      retryable: false
    });
    expect(snapshot.failed[0]).toMatchObject({
      queueId: "queue-failed",
      elapsedMs: 20000,
      retryable: true,
      chargedRetryRisk: true,
      diagnostic: {
        error: "provider timeout",
        errorCategory: "transient",
        retryable: true,
        chargedRetryRisk: true
      }
    });
  });

  it("reports the next queued attempt without mutating the legacy attempt count", () => {
    const summary = buildQueueTaskSummary(item({ status: "queued", attempt: 1, maxAttempts: 3 }), { now: NOW });

    expect(summary.attempt).toBe(1);
    expect(summary.attemptIndex).toBe(2);
    expect(summary.completedAttempts).toBe(1);
    expect(summary.remainingAttempts).toBe(2);
  });
});
