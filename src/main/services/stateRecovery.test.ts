import { describe, expect, it } from "vitest";
import type { GenerationJob, GenerationQueueFile, GenerationQueueItem } from "../../shared/types";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import { INTERRUPTED_JOB_MESSAGE, recoverInterruptedJobs } from "./stateRecovery";

function job(status: GenerationJob["status"]): GenerationJob {
  return {
    id: `job_${status}`,
    name: `${status}.png`,
    tags: [],
    providerKind: "openai",
    providerId: "default",
    launchId: "gpt-image-2",
    modelId: "gpt-image-2",
    modelDisplayName: "GPT Image 2",
    mode: "generate",
    prompt: "Recover this job",
    inputAssets: [],
    params: DEFAULT_IMAGE_PARAMS,
    status,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    outputs: []
  };
}

function queueItem(status: GenerationQueueItem["status"], historyJobId = `job_${status}`): GenerationQueueItem {
  const now = new Date(0).toISOString();
  return {
    queueId: `queue_${status}`,
    source: "cli",
    providerId: "default",
    request: {
      mode: "generate",
      prompt: "Recover this job",
      inputPaths: [],
      params: DEFAULT_IMAGE_PARAMS
    },
    status,
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
    historyJobId
  };
}

function queue(items: GenerationQueueItem[]): GenerationQueueFile {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    items,
    workerHosts: []
  };
}

describe("state recovery", () => {
  it("marks queued and running jobs as failed on startup", () => {
    const result = recoverInterruptedJobs([job("queued"), job("running"), job("succeeded")], new Date(1).toISOString());

    expect(result.changed).toBe(true);
    expect(result.history.map((item) => item.status)).toEqual(["failed", "failed", "succeeded"]);
    expect(result.history[0].error).toBe(INTERRUPTED_JOB_MESSAGE);
    expect(result.history[1].updatedAt).toBe(new Date(1).toISOString());
    expect(result.history[2].error).toBeUndefined();
  });

  it("leaves settled jobs unchanged", () => {
    const failed = job("failed");
    const succeeded = job("succeeded");
    const result = recoverInterruptedJobs([failed, succeeded], new Date(1).toISOString());

    expect(result.changed).toBe(false);
    expect(result.history).toEqual([failed, succeeded]);
  });

  it("does not mark jobs failed when their queue item is still active", () => {
    const queued = job("queued");
    const running = job("running");
    const result = recoverInterruptedJobs(
      [queued, running],
      new Date(1).toISOString(),
      queue([
        queueItem("queued", queued.id),
        queueItem("running", running.id)
      ])
    );

    expect(result.changed).toBe(false);
    expect(result.history).toEqual([queued, running]);
  });

  it("recovers hanging jobs from terminal queue state when available", () => {
    const cancelled = job("queued");
    const interrupted = job("running");
    const result = recoverInterruptedJobs(
      [cancelled, interrupted],
      new Date(1).toISOString(),
      queue([
        queueItem("cancelled", cancelled.id),
        queueItem("interrupted", interrupted.id)
      ])
    );

    expect(result.changed).toBe(true);
    expect(result.history.map((item) => item.status)).toEqual(["cancelled", "failed"]);
    expect(result.history[0].error).toBe("任务已取消。");
    expect(result.history[1].error).toBe(INTERRUPTED_JOB_MESSAGE);
  });
});
