import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueStore } from "./queueStore";
import type { GenerationQueueItem } from "../shared/types";

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

    const item: GenerationQueueItem = {
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      outputAssetIds: [],
      cancelRequested: false,
      costConfirmed: true,
      executionKind: "sync-provider",
      stage: "queued",
      sourceAssetIds: [],
      outputMediaKinds: ["image"]
    };

    await store.appendItem(item);
    const claimed = await store.claimRunnableItems({ host: { hostId: "host-1", kind: "desktop", processId: process.pid }, limit: 1 });
    expect(claimed).toHaveLength(1);

    const recovered = await store.recoverStaleRunningItems(Date.now() + 1000);
    expect(recovered.items[0].status).toBe("interrupted");
    expect(recovered.items[0].workerHostId).toBeUndefined();

    await rm(tempDir, { recursive: true, force: true });
  });
});
