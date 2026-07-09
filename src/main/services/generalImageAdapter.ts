import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ConnectionTestResult,
  DiscoveredModel,
  GeneralImageParams,
  GeminiImageParams,
  GenerationJob,
  ImageAsset,
  ProviderKind,
  RunJobRequest
} from "../../shared/types.js";
import {
  DEFAULT_GEMINI_IMAGE_PARAMS,
  GENERAL_PROMPT_ONLY_MESSAGE,
  dataUrlToBase64,
  isGeneralImageParams,
  normalizeImageMimeType,
  validateGeneralRunJobRequest
} from "../../shared/validation.js";
import { isGeneralFallbackProvider, isOpenAICompatibleGeneralFallbackProvider } from "../../shared/modelCatalog.js";
import type { ImageJobRuntime, ImageProviderAdapter } from "./imageProviderAdapter.js";
import { runGeminiImageJob } from "./geminiImageAdapter.js";
import { buildEndpoint, fetchWithTimeout } from "./openaiImageAdapter.js";
import type { StoredProviderConfig } from "./stateMigration.js";

interface OpenAICompatibleGeneralImagesResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  usage?: GenerationJob["usage"];
}

interface OpenAICompatibleGeneralApiErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

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

  if (job.params.providerKind === "gemini") {
    const providerJob = {
      ...job,
      params: toGeminiFallbackParams(job)
    };
    const result = await runGeminiImageJob(providerJob, apiKey, config.baseURL, runtime);
    return restoreGeneralJobIdentity(job, result);
  }

  if (isOpenAICompatibleGeneralFallbackProvider(job.params.providerKind)) {
    const result = await runOpenAICompatibleGeneralImageJob(job, apiKey, config.baseURL, runtime);
    return restoreGeneralJobIdentity(job, result);
  }

  throw new Error(unsupportedGeneralProviderMessage(job.params.providerKind));
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

export function buildOpenAICompatibleGeneralRequestBody(
  params: GeneralImageParams,
  prompt: string
): Record<string, string | number> {
  return {
    model: params.model,
    prompt,
    n: params.outputCount
  };
}

async function runOpenAICompatibleGeneralImageJob(
  job: GenerationJob,
  apiKey: string,
  baseURL: string,
  runtime: ImageJobRuntime
): Promise<GenerationJob> {
  if (!isGeneralImageParams(job.params) || !isOpenAICompatibleGeneralFallbackProvider(job.params.providerKind)) {
    throw new Error("General 图片参数无效。");
  }
  if (job.mode !== "generate" || job.inputAssets.length > 0 || job.maskAsset) {
    throw new Error(GENERAL_PROMPT_ONLY_MESSAGE);
  }

  const response = await fetchWithTimeout(
    runtime.fetch,
    buildEndpoint(baseURL, "/images/generations"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(buildOpenAICompatibleGeneralRequestBody(job.params, job.prompt))
    },
    job.params.timeoutMs
  );

  if (!response.ok) {
    throw new Error(await readOpenAICompatibleGeneralApiError(response, apiKey));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(await readUnexpectedOpenAICompatibleGeneralResponse(response, apiKey));
  }

  let payload: OpenAICompatibleGeneralImagesResponse;
  try {
    payload = (await response.json()) as OpenAICompatibleGeneralImagesResponse;
  } catch {
    throw new Error("OpenAI 兼容图片结果不是有效 JSON。请检查 Base URL 是否指向 OpenAI 兼容的 /v1 接口。");
  }

  const outputs = await saveOpenAICompatibleGeneralImages(job, payload.data ?? [], runtime);
  if (outputs.length === 0) {
    throw new Error("OpenAI 兼容 API 没有返回可保存的图片。");
  }

  return {
    ...job,
    outputs,
    usage: payload.usage,
    status: "succeeded",
    updatedAt: new Date().toISOString(),
    providerMetadata: {
      ...job.providerMetadata,
      generalFallbackContract: "openai-compatible-minimal"
    }
  };
}

async function saveOpenAICompatibleGeneralImages(
  job: GenerationJob,
  items: Array<{ b64_json?: string; url?: string }>,
  runtime: ImageJobRuntime
): Promise<ImageAsset[]> {
  const outputs: ImageAsset[] = [];
  for (const [index, item] of items.entries()) {
    const image = await openAICompatibleGeneralItemToBuffer(item, runtime);
    if (!image) continue;
    outputs.push(await saveOpenAICompatibleGeneralImage(job.id, image.buffer, image.mimeType, index, runtime));
  }
  return outputs;
}

async function openAICompatibleGeneralItemToBuffer(
  item: { b64_json?: string; url?: string },
  runtime: ImageJobRuntime
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (item.b64_json) {
    return { buffer: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" };
  }
  if (!item.url) return null;
  const dataUrlMimeType = mimeTypeFromImageDataUrl(item.url);
  if (item.url.startsWith("data:image/")) {
    return {
      buffer: Buffer.from(dataUrlToBase64(item.url), "base64"),
      mimeType: dataUrlMimeType ?? "image/png"
    };
  }

  const response = await runtime.fetch(item.url);
  if (!response.ok) {
    throw new Error(`OpenAI 兼容 API 返回了图片 URL，但下载失败：HTTP ${response.status}。`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: normalizeOutputMimeType(response.headers.get("content-type"))
  };
}

async function saveOpenAICompatibleGeneralImage(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  index: number,
  runtime: ImageJobRuntime
): Promise<ImageAsset> {
  await runtime.ensureDir(runtime.imagesDir);
  const normalizedMimeType = normalizeOutputMimeType(mimeType);
  const fileName = `${jobId}-result-${index}.${extensionForMimeType(normalizedMimeType)}`;
  const filePath = path.join(runtime.imagesDir, fileName);
  await fs.writeFile(filePath, buffer);

  return {
    id: `img_${randomUUID()}`,
    jobId,
    path: filePath,
    fileName,
    mimeType: normalizedMimeType,
    sourceType: "result",
    createdAt: new Date().toISOString(),
    transientPreview: {
      dataUrl: `data:${normalizedMimeType};base64,${buffer.toString("base64")}`
    }
  };
}

function mimeTypeFromImageDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl);
  return match ? normalizeOutputMimeType(match[1]) : null;
}

function normalizeOutputMimeType(value: string | null | undefined): "image/png" | "image/jpeg" | "image/webp" {
  const mimeType = normalizeImageMimeType(value?.split(";")[0]);
  if (mimeType === "image/jpeg" || mimeType === "image/webp") return mimeType;
  return "image/png";
}

function extensionForMimeType(mimeType: "image/png" | "image/jpeg" | "image/webp"): "png" | "jpg" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function readOpenAICompatibleGeneralApiError(response: Response, apiKey?: string): Promise<string> {
  const requestId = response.headers.get("x-request-id");
  const requestSuffix = requestId ? ` Request ID: ${requestId}` : "";
  const fallback = `OpenAI 兼容图片请求失败：HTTP ${response.status}.${requestSuffix}`;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as OpenAICompatibleGeneralApiErrorPayload;
      const message = payload.error?.message ?? payload.error?.code ?? payload.error?.type;
      return message ? `OpenAI 兼容图片请求失败：${redactLikelySecrets(message, apiKey)}${requestSuffix}` : fallback;
    }

    const text = (await response.text()).trim();
    return text ? `OpenAI 兼容图片请求失败：${redactLikelySecrets(text, apiKey)}${requestSuffix}` : fallback;
  } catch {
    return fallback;
  }
}

async function readUnexpectedOpenAICompatibleGeneralResponse(response: Response, apiKey?: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const text = redactLikelySecrets((await response.text()).trim(), apiKey).slice(0, 240);
  const suffix = text ? ` 响应开头：${text}` : "";
  return `OpenAI 兼容 API 返回了非预期响应，期望 JSON 图片结果，实际 Content-Type: ${contentType}.${suffix}`;
}

function redactLikelySecrets(value: string, apiKey?: string): string {
  const withoutActiveKey = apiKey ? value.split(apiKey).join("[redacted-api-key]") : value;
  return withoutActiveKey.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted");
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
