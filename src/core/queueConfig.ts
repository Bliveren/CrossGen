import type { QueueRuntimeConfig } from "../shared/types.js";

export const MIN_QUEUE_CONCURRENCY = 1;
export const MAX_QUEUE_CONCURRENCY = 8;

export const DEFAULT_QUEUE_RUNTIME_CONFIG: QueueRuntimeConfig = {
  maxGlobalRunning: 1,
  providerConcurrency: {}
};

export interface QueueRuntimeConfigPatch {
  maxGlobalRunning?: number;
  providerConcurrency?: Record<string, number>;
  clearProviderIds?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeQueueConcurrencyValue(value: unknown, fallback = MIN_QUEUE_CONCURRENCY): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(MAX_QUEUE_CONCURRENCY, Math.max(MIN_QUEUE_CONCURRENCY, parsed));
}

export function normalizeQueueRuntimeConfig(value: unknown): QueueRuntimeConfig {
  if (!isRecord(value)) return structuredClone(DEFAULT_QUEUE_RUNTIME_CONFIG);
  const providerConcurrency: Record<string, number> = {};
  if (isRecord(value.providerConcurrency)) {
    for (const [providerId, concurrency] of Object.entries(value.providerConcurrency)) {
      const normalizedProviderId = providerId.trim();
      if (!normalizedProviderId) continue;
      providerConcurrency[normalizedProviderId] = normalizeQueueConcurrencyValue(concurrency);
    }
  }
  return {
    maxGlobalRunning: normalizeQueueConcurrencyValue(value.maxGlobalRunning, DEFAULT_QUEUE_RUNTIME_CONFIG.maxGlobalRunning),
    providerConcurrency
  };
}

export function applyQueueRuntimeConfigPatch(current: QueueRuntimeConfig, patch: QueueRuntimeConfigPatch): QueueRuntimeConfig {
  const nextProviderConcurrency = { ...current.providerConcurrency };
  for (const providerId of patch.clearProviderIds ?? []) {
    const normalizedProviderId = providerId.trim();
    if (normalizedProviderId) delete nextProviderConcurrency[normalizedProviderId];
  }
  for (const [providerId, concurrency] of Object.entries(patch.providerConcurrency ?? {})) {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) continue;
    nextProviderConcurrency[normalizedProviderId] = normalizeQueueConcurrencyValue(concurrency);
  }
  return {
    maxGlobalRunning:
      patch.maxGlobalRunning === undefined
        ? normalizeQueueConcurrencyValue(current.maxGlobalRunning, DEFAULT_QUEUE_RUNTIME_CONFIG.maxGlobalRunning)
        : normalizeQueueConcurrencyValue(patch.maxGlobalRunning, DEFAULT_QUEUE_RUNTIME_CONFIG.maxGlobalRunning),
    providerConcurrency: nextProviderConcurrency
  };
}
