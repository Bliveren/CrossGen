import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueStore } from "./queueStore";
import type { GenerationQueueItem, GenerationQueueWorkerHost } from "../shared/types";

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
    partialAssetIds: [],
    galleryAssetIds: [],
    cancelRequested: false,
    costConfirmed: true,
    executionKind: "sync-provider",
    stage: "queued",
    sourceAssetIds: [],
    outputMediaKinds: ["image"],
    ...patch
  };
}

function workerHost(patch: Partial<GenerationQueueWorkerHost> = {}): GenerationQueueWorkerHost {
  const now = "2026-07-19T00:00:00.000Z";
  return {
    hostId: "host_1",
    kind: "desktop",
    processId: process.pid,
    mode: "generate",
    heartbeatAt: now,
    leaseExpiresAt: now,
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

    const item = queueItem({ targetGalleryFolderId: "folder-1", galleryAssetIds: ["gallery-1"] });

    await store.appendItem(item);
    const claimed = await store.claimRunnableItems({ host: { hostId: "host-1", kind: "desktop", processId: process.pid }, limit: 1 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempt).toBe(1);
    expect(claimed[0].targetGalleryFolderId).toBe("folder-1");
    expect(claimed[0].galleryAssetIds).toEqual(["gallery-1"]);

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

  it("keeps release default concurrency at one claim", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`,
      now: () => Date.parse("2026-07-13T00:00:00.000Z"),
      staleRunningAfterMs: 30000,
      leaseMs: 30000
    });

    await store.appendItem(queueItem({ queueId: "queue-1", providerId: "provider-1" }));
    await store.appendItem(queueItem({ queueId: "queue-2", providerId: "provider-2" }));

    const claimed = await store.claimRunnableItems({
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      limit: 2,
      maxGlobalRunning: 1
    });

    expect(claimed.map((item) => item.queueId)).toEqual(["queue-1"]);
    const queue = await store.read();
    expect(queue.items.map((item) => [item.queueId, item.status])).toEqual([
      ["queue-1", "running"],
      ["queue-2", "queued"]
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("serializes concurrent claims so two hosts cannot claim the same item", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`,
      now: () => Date.parse("2026-07-13T00:00:00.000Z"),
      staleRunningAfterMs: 30000,
      leaseMs: 30000
    });

    await store.appendItem(queueItem({ queueId: "queue-shared", providerId: "provider-1" }));

    const [hostOne, hostTwo] = await Promise.all([
      store.claimRunnableItems({
        host: { hostId: "host-1", kind: "desktop", processId: process.pid },
        limit: 1,
        queueId: "queue-shared",
        maxGlobalRunning: 2
      }),
      store.claimRunnableItems({
        host: { hostId: "host-2", kind: "mcp", processId: process.pid },
        limit: 1,
        queueId: "queue-shared",
        maxGlobalRunning: 2
      })
    ]);

    const claimed = [...hostOne, ...hostTwo];
    expect(claimed).toHaveLength(1);
    expect(claimed[0].queueId).toBe("queue-shared");
    expect(["host-1", "host-2"]).toContain(claimed[0].workerHostId);

    const queue = await store.read();
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      queueId: "queue-shared",
      status: "running",
      attempt: 1
    });
    expect(["host-1", "host-2"]).toContain(queue.items[0].workerHostId);

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

  it("does not claim items before nextRunAt", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`,
      now: () => Date.parse("2026-07-13T00:00:00.000Z")
    });

    await store.appendItem(queueItem({
      queueId: "queue-later",
      nextRunAt: "2026-07-13T00:01:00.000Z"
    }));
    await store.appendItem(queueItem({ queueId: "queue-now" }));

    const claimed = await store.claimRunnableItems({
      host: { hostId: "host-1", kind: "desktop", processId: process.pid },
      limit: 2
    });
    expect(claimed.map((item) => item.queueId)).toEqual(["queue-now"]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("prunes worker hosts older than 24 hours and caps retained hosts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-queue-"));
    const queuePath = path.join(tempDir, "queue.json");
    const nowMs = Date.parse("2026-07-19T12:00:00.000Z");
    const store = createQueueStore({
      queuePath,
      lockPath: `${queuePath}.lock`,
      now: () => nowMs
    });

    const workerHosts: GenerationQueueWorkerHost[] = [
      ...Array.from({ length: 3 }, (_, index) =>
        workerHost({
          hostId: `expired-${index + 1}`,
          heartbeatAt: "2026-07-17T11:59:59.000Z",
          leaseExpiresAt: `2026-07-18T11:59:5${index}.000Z`
        })
      ),
      ...Array.from({ length: 22 }, (_, index) =>
        workerHost({
          hostId: `recent-${index + 1}`,
          heartbeatAt: `2026-07-19T11:${String(index).padStart(2, "0")}:00.000Z`,
          leaseExpiresAt: `2026-07-19T11:${String(index).padStart(2, "0")}:30.000Z`
        })
      )
    ];

    await store.write({
      schemaVersion: 1,
      updatedAt: "2026-07-19T12:00:00.000Z",
      items: [],
      workerHosts
    });

    const queue = await store.read();
    expect(queue.workerHosts).toHaveLength(20);
    expect(queue.workerHosts.some((host) => host.hostId.startsWith("expired-"))).toBe(false);
    expect(queue.workerHosts.map((host) => host.hostId)).toEqual([
      "recent-22",
      "recent-21",
      "recent-20",
      "recent-19",
      "recent-18",
      "recent-17",
      "recent-16",
      "recent-15",
      "recent-14",
      "recent-13",
      "recent-12",
      "recent-11",
      "recent-10",
      "recent-9",
      "recent-8",
      "recent-7",
      "recent-6",
      "recent-5",
      "recent-4",
      "recent-3"
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });
});
