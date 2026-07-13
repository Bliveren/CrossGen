import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueStore } from "./queueStore";
import { withStateQueueTransaction } from "./stateQueueTransaction";
import type { GenerationQueueItem } from "../shared/types";

interface TestState {
  version: number;
  history: string[];
}

function queueItem(queueId: string): GenerationQueueItem {
  const now = new Date().toISOString();
  return {
    queueId,
    source: "cli",
    providerId: "provider-1",
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
    outputMediaKinds: ["image"]
  };
}

describe("stateQueueTransaction", () => {
  it("writes state and queue under one lock", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-state-queue-tx-"));
    const statePath = path.join(tempDir, "state.json");
    const queuePath = path.join(tempDir, "queue.json");
    const lockPath = path.join(tempDir, ".crossgen-state.lock");

    const transaction = await withStateQueueTransaction<TestState, string>({
      lockPath,
      queuePath,
      state: {
        statePath,
        backupPath: `${statePath}.bak`,
        defaultState: { version: 1, history: [] },
        normalize: (value) => value as TestState
      }
    }, (context) => {
      context.updateState((state) => ({ ...state, history: ["job-1", ...state.history] }));
      context.updateQueue((queue) => ({
        ...queue,
        items: [queueItem("queue-1"), ...queue.items]
      }));
      return "created";
    });

    expect(transaction.result).toBe("created");
    expect(transaction.state.history).toEqual(["job-1"]);
    expect(transaction.queue.items.map((item) => item.queueId)).toEqual(["queue-1"]);

    const persisted = await withStateQueueTransaction<TestState, null>({
      lockPath,
      queuePath,
      state: {
        statePath,
        backupPath: `${statePath}.bak`,
        defaultState: { version: 1, history: [] },
        normalize: (value) => value as TestState
      }
    }, (context) => {
      expect(context.state.history).toEqual(["job-1"]);
      expect(context.queue.items.map((item) => item.queueId)).toEqual(["queue-1"]);
      return null;
    });
    expect(persisted.queue.items[0].status).toBe("queued");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("blocks regular queue mutations while a transaction holds the shared lock", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-state-queue-tx-"));
    const statePath = path.join(tempDir, "state.json");
    const queuePath = path.join(tempDir, "queue.json");
    const lockPath = path.join(tempDir, ".crossgen-state.lock");
    const queueStore = createQueueStore({ queuePath, lockPath });

    let releaseTransaction!: () => void;
    let transactionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      transactionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    const transaction = withStateQueueTransaction<TestState, null>({
      lockPath,
      queuePath,
      state: {
        statePath,
        backupPath: `${statePath}.bak`,
        defaultState: { version: 1, history: [] },
        normalize: (value) => value as TestState
      }
    }, async () => {
      transactionStarted();
      await release;
      return null;
    });

    await started;
    let appendSettled = false;
    const append = queueStore.appendItem(queueItem("queue-after")).then(() => {
      appendSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(appendSettled).toBe(false);

    releaseTransaction();
    await transaction;
    await append;
    expect((await queueStore.read()).items.map((item) => item.queueId)).toEqual(["queue-after"]);

    await rm(tempDir, { recursive: true, force: true });
  });
});
