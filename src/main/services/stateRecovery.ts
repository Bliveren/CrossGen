import type { GenerationJob, GenerationQueueFile, GenerationQueueItem } from "../../shared/types.js";

export const INTERRUPTED_JOB_MESSAGE = "应用上次退出时任务仍在运行，已自动恢复为失败状态。";
const CANCELLED_JOB_MESSAGE = "任务已取消。";

export interface RecoveryResult {
  history: GenerationJob[];
  changed: boolean;
}

function queueItemByHistoryId(queue?: GenerationQueueFile): Map<string, GenerationQueueItem> {
  const byHistoryId = new Map<string, GenerationQueueItem>();
  for (const item of queue?.items ?? []) {
    if (item.historyJobId) byHistoryId.set(item.historyJobId, item);
  }
  return byHistoryId;
}

function recoverJobFromQueue(job: GenerationJob, item: GenerationQueueItem, recoveredAt: string): GenerationJob {
  if (item.status === "queued" || item.status === "running") return job;
  if (item.status === "cancelled") {
    return {
      ...job,
      status: "cancelled",
      error: item.lastError ?? CANCELLED_JOB_MESSAGE,
      updatedAt: item.updatedAt || recoveredAt
    };
  }
  if (item.status === "succeeded") return job;
  return {
    ...job,
    status: "failed",
    error: item.lastError ?? INTERRUPTED_JOB_MESSAGE,
    updatedAt: item.updatedAt || recoveredAt
  };
}

export function recoverInterruptedJobs(history: GenerationJob[], recoveredAt = new Date().toISOString(), queue?: GenerationQueueFile): RecoveryResult {
  let changed = false;
  const queueByHistoryId = queueItemByHistoryId(queue);
  const recovered = history.map((job) => {
    if (job.status !== "queued" && job.status !== "running") return job;
    const queueItem = queueByHistoryId.get(job.id);
    if (queueItem) {
      const next = recoverJobFromQueue(job, queueItem, recoveredAt);
      if (next !== job) changed = true;
      return next;
    }
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
