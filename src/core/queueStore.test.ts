import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueStore } from "./queueStore";
import type { GenerationQueueItem } from "../shared/types";

function queueItem(patch: Partial<GenerationQueueItem> = {}): GenerationQueueItem {
  const now = new Date().toISOString();
  return {
    queueId: "queue_1",
    source: "desktop",
    providerId: "default",
    request: {
      mode: "generate",
      prompt: "hello",
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
    status: "queued",
    priority: 0,
    attempt: 0,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
    outputAssetIds: [],
    cancelRequested: false,
    costConfirmed: true,
    executionKind: "sync-provider",
    stage: "queued",
    sourceAssetIds: [],
    outputMediaKinds: ["image"],
    ...patch
  };
}

describe("queueStore", () => {
  it("round-trips items and recovers stale running items", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`,
      now: () => Date.now(),
      staleRunningAfterMs: 10,
      leaseMs: 10
    });

    const item = queueItem();

    await store.appendItem(item);
    const claimed = await store.claimRunnableItems({ host: { hostId: "host-1", kind: "desktop", processId: process.pid }, limit: 1 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempt).toBe(1);

    const recovered = await store.recoverStaleRunningItems(Date.now() + 1000);
    expect(recovered.items[0].status).toBe("interrupted");
    expect(recovered.items[0].workerHostId).toBeUndefined();

    await rm(tempDir, { recursive: true, force: true });
  });

  it("honors global and provider concurrency while claiming", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`,
      now: () => Date.parse("2026-07-13T00:00:00.000Z"),
      staleRunningAfterMs: 30000,
      leaseMs: 30000
    });

    await store.appendItem(queueItem({
      queueId: "running-openai",
      providerId: "openai-provider",
      status: "running",
      workerHostId: "other-host",
      workerHeartbeatAt: "2026-07-13T00:00:00.000Z",
      workerLeaseExpiresAt: "2026-07-13T00:01:00.000Z"
    }));
    await store.appendItem(queueItem({ queueId: "queued-openai", providerId: "openai-provider" }));
    await store.appendItem(queueItem({ queueId: "queued-gemini", providerId: "gemini-provider" }));

    const none = await store.claimRunnableItems({
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      limit: 1,
      maxGlobalRunning: 1
    });
    expect(none).toHaveLength(0);

    const claimed = await store.claimRunnableItems({
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      limit: 2,
      maxGlobalRunning: 2,
      providerConcurrency: { "openai-provider": 1, "gemini-provider": 1 }
    });
    expect(claimed.map((item) => item.queueId)).toEqual(["queued-gemini"]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("can claim a specific queued item by id", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`
    });

    await store.appendItem(queueItem({ queueId: "queue-old", priority: 0 }));
    await store.appendItem(queueItem({ queueId: "queue-target", priority: 10 }));

    const claimed = await store.claimRunnableItems({
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      limit: 1,
      queueId: "queue-target"
    });
    expect(claimed.map((item) => item.queueId)).toEqual(["queue-target"]);

    const queue = await store.read();
    expect(queue.items.find((item) => item.queueId === "queue-old")?.status).toBe("queued");
    expect(queue.items.find((item) => item.queueId === "queue-target")?.status).toBe("running");

    await rm(tempDir, { recursive: true, force: true });
  });
});
