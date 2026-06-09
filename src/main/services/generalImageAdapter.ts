import type {
  ConnectionTestResult,
  DiscoveredModel,
  GeminiImageParams,
  GenerationJob,
  ProviderKind,
  RunJobRequest
} from "../../shared/types.js";
import {
  DEFAULT_GEMINI_IMAGE_PARAMS,
  isGeneralImageParams,
  validateGeneralRunJobRequest
} from "../../shared/validation.js";
import { isGeneralFallbackProvider } from "../../shared/modelCatalog.js";
import type { ImageJobRuntime, ImageProviderAdapter } from "./imageProviderAdapter.js";
import { runGeminiImageJob } from "./geminiImageAdapter.js";
import type { StoredProviderConfig } from "./stateMigration.js";

export const generalImageAdapter: ImageProviderAdapter = {
  kind: "custom",
  discoverModels(): Promise<DiscoveredModel[]> {
    return Promise.resolve([]);
  },
  testConnection(): Promise<ConnectionTestResult> {
    return Promise.resolve({
      ok: false,
      message: unsupportedGeneralProviderMessage("custom")
    });
  },
  validateJob(request: RunJobRequest) {
    return validateGeneralRunJobRequest(request);
  },
  runJob(job: GenerationJob, apiKey: string, config: StoredProviderConfig, runtime: ImageJobRuntime) {
    return runGeneralImageJob(job, apiKey, config, runtime);
  }
};

export async function runGeneralImageJob(
  job: GenerationJob,
  apiKey: string,
  config: StoredProviderConfig,
  runtime: ImageJobRuntime
): Promise<GenerationJob> {
  if (!isGeneralImageParams(job.params)) {
    throw new Error("General 图片参数无效。");
  }
  if (!isGeneralFallbackProvider(job.params.providerKind)) {
    throw new Error(unsupportedGeneralProviderMessage(job.params.providerKind));
  }
  if (job.params.providerKind !== config.kind) {
    throw new Error("任务 provider 与当前服务配置不一致。请先切换并保存对应服务商。");
  }

  const providerJob = {
    ...job,
    params: toGeminiFallbackParams(job)
  };
  const result = await runGeminiImageJob(providerJob, apiKey, config.baseURL, runtime);
  return restoreGeneralJobIdentity(job, result);
}

export function unsupportedGeneralProviderMessage(providerKind: ProviderKind): string {
  const provider = providerKind === "gemini" ? "Gemini" : providerKind === "openai" ? "OpenAI" : "Custom";
  return `${provider} provider 暂未接入 General 运行时。`;
}

function toGeminiFallbackParams(job: GenerationJob): GeminiImageParams {
  return {
    ...DEFAULT_GEMINI_IMAGE_PARAMS,
    providerKind: "gemini",
    launchId: "nano-banana-3",
    model: job.params.model,
    outputCount: 1,
    searchGrounding: false,
    timeoutMs: job.params.timeoutMs
  };
}

function restoreGeneralJobIdentity(original: GenerationJob, result: GenerationJob): GenerationJob {
  return {
    ...result,
    providerKind: original.providerKind,
    launchId: original.launchId,
    modelId: original.modelId,
    modelDisplayName: original.modelDisplayName,
    params: original.params,
    providerMetadata: {
      ...result.providerMetadata,
      generalFallbackProvider: original.params.providerKind,
      generalFallbackModel: original.params.model
    }
  };
}
