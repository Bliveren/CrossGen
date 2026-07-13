import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGenerationQueueItem } from "./generation";
import { recordGenerationQueuePartialOutput, requestGenerationQueueItemCancel, runGenerationQueueItemToCompletion, runNextGenerationQueueItem } from "./generationQueue";
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
});
