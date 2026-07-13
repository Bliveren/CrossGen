import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGenerationQueueItem } from "./generation";
import {
  recordGenerationQueuePartialOutput,
  requestGenerationQueueItemCancel,
  retryGenerationQueueItem,
  runGenerationQueueItemToCompletion,
  runNextGenerationQueueItem
} from "./generationQueue";
import { createQueueStore } from "./queueStore";

function request() {
  return {
    mode: "generate" as const,
    prompt: "hello",
    inputPaths: [],
    params: {
      providerKind: "openai" as const,
      launchId: "gpt-image-2" as const,
      model: "gpt-image-2",
      imageRoute: "auto" as const,
      size: "1024x1024",
      quality: "auto" as const,
      outputFormat: "png" as const,
      outputCompression: 100,
      background: "auto" as const,
      n: 1,
      stream: false,
      partialImages: 0,
      moderation: "auto" as const,
      timeoutMs: 1000
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("generationQueue", () => {
  it("claims, executes, and completes an item", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-1"
    });
    await store.appendItem(item);

    const result = await runNextGenerationQueueItem({
      queueStore: store,
      queueId: item.queueId,
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      maxGlobalRunning: 1,
      executeItem: async (_item, signal) => {
        expect(signal.aborted).toBe(false);
        return {
          status: "succeeded",
          historyJobId: "job-1",
          outputAssetIds: ["asset-1"],
          value: { ok: true }
        };
      }
    });

    expect(result.claimed).toBe(true);
    expect(result.execution?.value).toEqual({ ok: true });
    const queue = await store.read();
    expect(queue.items[0]).toMatchObject({
      status: "succeeded",
      historyJobId: "job-1",
      outputAssetIds: ["asset-1"],
      workerHostId: undefined
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("refreshes running item heartbeat during long executions", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-1"
    });
    await store.appendItem(item);

    let claimedLeaseExpiresAt = "";
    await runNextGenerationQueueItem({
      queueStore: store,
      queueId: item.queueId,
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      leaseMs: 300,
      executeItem: async () => {
        await sleep(170);
        const queue = await store.read();
        const running = queue.items.find((candidate) => candidate.queueId === item.queueId);
        expect(Date.parse(running?.workerLeaseExpiresAt ?? "")).toBeGreaterThan(Date.parse(claimedLeaseExpiresAt));
        return { status: "succeeded", historyJobId: "job-1", outputAssetIds: ["asset-1"] };
      },
      onStarted: (claimed) => {
        claimedLeaseExpiresAt = claimed.workerLeaseExpiresAt ?? "";
      }
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("marks thrown executions as failed", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-1"
    });
    await store.appendItem(item);

    const result = await runNextGenerationQueueItem({
      queueStore: store,
      queueId: item.queueId,
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      executeItem: async () => {
        throw new Error("provider failed");
      }
    });

    expect(result.execution).toMatchObject({ status: "failed", error: "provider failed" });
    const queue = await store.read();
    expect(queue.items[0]).toMatchObject({ status: "failed", lastError: "provider failed" });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("records queued and running cancel requests", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const queued = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true
    });
    await store.appendItem(queued);

    const cancelled = await requestGenerationQueueItemCancel(store, queued.queueId);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelRequested).toBe(true);

    const running = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true
    });
    await store.appendItem(running);
    await store.claimRunnableItems({ host: { hostId: "host-1", kind: "desktop", processId: process.pid }, limit: 1, queueId: running.queueId });

    const requested = await requestGenerationQueueItemCancel(store, running.queueId);
    expect(requested?.status).toBe("running");
    expect(requested?.cancelRequested).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("aborts running workers when durable cancel is requested", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-1"
    });
    await store.appendItem(item);

    const result = await runNextGenerationQueueItem({
      queueStore: store,
      queueId: item.queueId,
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      leaseMs: 150,
      onStarted: () => {
        setTimeout(() => {
          void requestGenerationQueueItemCancel(store, item.queueId);
        }, 20);
      },
      executeItem: async (_item, signal) => {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("cancel was not observed")), 1000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );
        });
        throw new Error("provider aborted");
      }
    });

    expect(result.execution).toMatchObject({
      status: "cancelled",
      error: "provider aborted",
      errorCategory: "cancelled",
      retryable: false
    });
    const queue = await store.read();
    expect(queue.items[0]).toMatchObject({
      status: "cancelled",
      cancelRequested: true,
      workerHostId: undefined,
      workerHeartbeatAt: undefined,
      workerLeaseExpiresAt: undefined
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("requeues retryable failures until maxAttempts is reached", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-1",
      maxAttempts: 2
    });
    await store.appendItem(item);

    let calls = 0;
    const result = await runGenerationQueueItemToCompletion({
      queueStore: store,
      queueId: item.queueId,
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      pollIntervalMs: 0,
      classifyFailure: () => ({ category: "transient", retryable: true }),
      retryBackoffMs: () => 0,
      executeItem: async () => {
        calls += 1;
        if (calls === 1) return { status: "failed", error: "rate limited" };
        return { status: "succeeded", historyJobId: "job-1", outputAssetIds: ["asset-final"], value: { ok: true } };
      }
    });

    expect(result.item?.status).toBe("succeeded");
    expect(calls).toBe(2);
    const queue = await store.read();
    expect(queue.items[0]).toMatchObject({
      status: "succeeded",
      attempt: 2,
      outputAssetIds: ["asset-final"]
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not retry non-retryable failures", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      maxAttempts: 3
    });
    await store.appendItem(item);

    const result = await runNextGenerationQueueItem({
      queueStore: store,
      queueId: item.queueId,
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      classifyFailure: () => ({ category: "auth", retryable: false }),
      executeItem: async () => ({ status: "failed", error: "unauthorized" })
    });

    expect(result.item?.status).toBe("failed");
    const queue = await store.read();
    expect(queue.items[0]).toMatchObject({
      status: "failed",
      attempt: 1,
      lastError: "unauthorized",
      lastErrorCategory: "auth",
      lastErrorRetryable: false
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("records partial outputs without duplicating asset ids", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true
    });
    await store.appendItem(item);

    await recordGenerationQueuePartialOutput(store, item.queueId, ["partial-1", "partial-1", "partial-2"]);
    const queue = await store.read();
    expect(queue.items[0].partialAssetIds).toEqual(["partial-1", "partial-2"]);
    expect(queue.items[0].outputAssetIds).toEqual(["partial-1", "partial-2"]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("requeues retryable terminal items and clears stale execution state", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const item = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-1"
    });
    await store.appendItem({
      ...item,
      status: "failed",
      stage: "finalizing",
      attempt: 2,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
      nextRunAt: "2026-01-01T00:01:00.000Z",
      lastError: "provider failed",
      lastErrorCategory: "transient",
      lastErrorRetryable: true,
      outputAssetIds: ["asset-old"],
      partialAssetIds: ["partial-old"],
      galleryAssetIds: ["gallery-old"],
      cancelRequested: true,
      workerHostId: "host-old",
      workerProcessId: 1234,
      workerHeartbeatAt: "2026-01-01T00:00:05.000Z",
      workerLeaseExpiresAt: "2026-01-01T00:01:05.000Z"
    });

    const result = await retryGenerationQueueItem(store, "job-1", () => Date.parse("2026-01-01T00:02:00.000Z"));

    expect(result.action).toBe("retried");
    expect(result.item).toMatchObject({
      queueId: item.queueId,
      historyJobId: "job-1",
      status: "queued",
      stage: "queued",
      attempt: 0,
      outputAssetIds: [],
      partialAssetIds: [],
      galleryAssetIds: [],
      cancelRequested: false,
      workerHostId: undefined
    });
    expect(result.item?.startedAt).toBeUndefined();
    expect(result.item?.completedAt).toBeUndefined();
    expect(result.item?.nextRunAt).toBeUndefined();
    expect(result.item?.lastError).toBeUndefined();
    expect(result.item?.lastErrorCategory).toBeUndefined();
    expect(result.item?.lastErrorRetryable).toBeUndefined();
    expect(result.item?.workerProcessId).toBeUndefined();
    expect(result.item?.workerHeartbeatAt).toBeUndefined();
    expect(result.item?.workerLeaseExpiresAt).toBeUndefined();

    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not retry non-terminal or succeeded items", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-generation-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({ queuePath, lockPath: `${queuePath}.lock` });
    const queued = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-queued"
    });
    const succeeded = createGenerationQueueItem({
      source: "desktop",
      providerId: "provider-1",
      request: request(),
      costConfirmed: true,
      historyJobId: "job-succeeded"
    });
    await store.appendItem(queued);
    await store.appendItem({
      ...succeeded,
      status: "succeeded",
      stage: "finalizing",
      completedAt: "2026-01-01T00:00:10.000Z",
      outputAssetIds: ["asset-1"]
    });

    const queuedResult = await retryGenerationQueueItem(store, queued.queueId);
    const succeededResult = await retryGenerationQueueItem(store, "job-succeeded");
    const missingResult = await retryGenerationQueueItem(store, "missing-job");

    expect(queuedResult).toMatchObject({ action: "not_retryable", item: { queueId: queued.queueId, status: "queued" } });
    expect(succeededResult).toMatchObject({ action: "not_retryable", item: { queueId: succeeded.queueId, status: "succeeded" } });
    expect(missingResult).toEqual({ action: "not_found" });

    await rm(tempDir, { recursive: true, force: true });
  });
});
