import type { GenerationJob } from "../../shared/types.js";

export const INTERRUPTED_JOB_MESSAGE = "应用上次退出时任务仍在运行，已自动恢复为失败状态。";

export interface RecoveryResult {
  history: GenerationJob[];
  changed: boolean;
}

export function recoverInterruptedJobs(history: GenerationJob[], recoveredAt = new Date().toISOString()): RecoveryResult {
  let changed = false;
  const recovered = history.map((job) => {
    if (job.status !== "queued" && job.status !== "running") return job;
    changed = true;
    return {
      ...job,
      status: "failed" as const,
      error: INTERRUPTED_JOB_MESSAGE,
      updatedAt: recoveredAt
    };
  });

  return { history: recovered, changed };
}
