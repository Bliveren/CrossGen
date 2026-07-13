import { randomUUID } from "node:crypto";
import type { GenerationQueueItem, MediaKind, QueueSource, RunJobRequest } from "../shared/types.js";

export interface CreateGenerationQueueItemInput {
  source: QueueSource;
  providerId: string;
  request: RunJobRequest;
  costConfirmed: boolean;
  priority?: number;
  maxAttempts?: number;
  historyJobId?: string;
  sourceAssetIds?: string[];
  outputMediaKinds?: MediaKind[];
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
  now?: () => Date;
}

export function createGenerationQueueItem(input: CreateGenerationQueueItemInput): GenerationQueueItem {
  const now = (input.now ?? (() => new Date()))().toISOString();
  return {
    queueId: `queue_${randomUUID()}`,
    source: input.source,
    providerId: input.providerId,
    request: input.request,
    status: "queued",
    priority: input.priority ?? 0,
    attempt: 0,
    maxAttempts: input.maxAttempts ?? 1,
    createdAt: now,
    updatedAt: now,
    historyJobId: input.historyJobId,
    outputAssetIds: [],
    partialAssetIds: [],
    cancelRequested: false,
    costConfirmed: input.costConfirmed,
    executionKind: "sync-provider",
    stage: "queued",
    sourceAssetIds: input.sourceAssetIds ?? [],
    outputMediaKinds: input.outputMediaKinds ?? ["image"],
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    correlationId: input.correlationId
  };
}
