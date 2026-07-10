import type {
  ConnectionTestResult,
  DiscoveredModel,
  GenerationJob,
  JobProgressEvent,
  ProviderKind,
  RunJobRequest
} from "../../shared/types.js";
import type { ValidationResult } from "../../shared/validation.js";
import type { StoredProviderConfig } from "./stateMigration.js";

export interface ImageProviderRuntime {
  fetch: typeof fetch;
}

export interface ImageJobRuntime extends ImageProviderRuntime {
  imagesDir: string;
  ensureDir: (dirPath: string) => Promise<void>;
  sendJobEvent: (event: JobProgressEvent) => void;
  abortSignal?: AbortSignal;
}

export interface ImageProviderAdapter {
  kind: ProviderKind;
  discoverModels(config: StoredProviderConfig, apiKey: string, runtime: ImageProviderRuntime): Promise<DiscoveredModel[]>;
  testConnection(config: StoredProviderConfig, apiKey: string, runtime: ImageProviderRuntime): Promise<ConnectionTestResult>;
  validateJob(request: RunJobRequest): ValidationResult;
  runJob(job: GenerationJob, apiKey: string, config: StoredProviderConfig, runtime: ImageJobRuntime): Promise<GenerationJob>;
}
