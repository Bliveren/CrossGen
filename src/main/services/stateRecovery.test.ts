import { describe, expect, it } from "vitest";
import type { GenerationJob } from "../../shared/types";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import { INTERRUPTED_JOB_MESSAGE, recoverInterruptedJobs } from "./stateRecovery";

function job(status: GenerationJob["status"]): GenerationJob {
  return {
    id: `job_${status}`,
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
});
