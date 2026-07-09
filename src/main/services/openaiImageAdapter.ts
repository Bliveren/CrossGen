import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ConnectionTestResult,
  DiscoveredModel,
  GenerationJob,
  ImageAsset,
  InputAsset,
  OpenAIImageParams,
  RunJobRequest,
  UsageDetails
} from "../../shared/types.js";
import {
  dataUrlToBase64,
  extensionForFormat,
  isOpenAIImageParams,
  mimeTypeForFormat,
  shouldSendCompression,
  validateMaskMimeType,
  validateMaskSourceFormat,
  validateOpenAIRunJobRequest,
  defaultStreamingPartialsEnabled
} from "../../shared/validation.js";
import type { ImageJobRuntime, ImageProviderAdapter, ImageProviderRuntime } from "./imageProviderAdapter.js";
import { firstString, isRecord, readProviderApiError, readProviderJsonResponse, redactLikelySecrets } from "./providerHttp.js";
import type { StoredProviderConfig } from "./stateMigration.js";

export interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  output?: unknown[];
  usage?: UsageDetails;
}

interface ModelsResponse {
  data?: unknown[];
}

export interface ImageStreamEvent {
  type?: string;
  b64_json?: string;
  url?: string;
  data?: Array<{ b64_json?: string; url?: string }>;
  partial_image_index?: number;
  usage?: UsageDetails;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

interface JsonImagesResult {
  outputs: ImageAsset[];
  usage?: UsageDetails;
  emptyReason?: string;
  retryableEmpty?: boolean;
}

interface OpenAIStreamOptions {
  streamingPartialsEnabled?: boolean;
}

type JsonImageFetchPurpose = "empty-retry" | "backfill";
type EditImageFieldName = "image[]" | "image";

export type OpenAIImageRuntime = ImageJobRuntime;
export type OpenAIImageJob = GenerationJob & { params: OpenAIImageParams };

export const openaiImageAdapter: ImageProviderAdapter = {
  kind: "openai",
  discoverModels: discoverOpenAIModels,
  testConnection: testOpenAIConnection,
  validateJob(request: RunJobRequest) {
    return validateOpenAIRunJobRequest(request);
  },
  runJob(job: GenerationJob, apiKey: string, config: StoredProviderConfig, runtime: ImageJobRuntime) {
    return runOpenAIImageJob(asOpenAIImageJob(job), apiKey, config.baseURL, runtime, {
      streamingPartialsEnabled: config.streamingPartialsEnabled ?? defaultStreamingPartialsEnabled(config.kind, config.baseURL)
    });
  }
};

export function buildEndpoint(baseURL: string, endpoint: "/images/generations" | "/images/edits" | "/models"): string {
  return `${baseURL.trim().replace(/\/+$/, "")}${endpoint}`;
}

export function asOpenAIImageJob(job: GenerationJob): OpenAIImageJob {
  if (!isOpenAIImageParams(job.params)) {
    throw new Error("当前版本尚未接入该模型运行时。");
  }
  return job as OpenAIImageJob;
}

export function normalizeOpenAIRequestParams(params: OpenAIImageParams): OpenAIImageParams {
  if (!params.stream || params.n <= 1) return params;
  return {
    ...params,
    stream: false,
    partialImages: 0
  };
}

export function baseRequestBody(params: OpenAIImageParams, prompt: string): Record<string, string | number | boolean> {
  const requestParams = normalizeOpenAIRequestParams(params);
  const body: Record<string, string | number | boolean> = {
    model: requestParams.model,
    prompt,
    size: requestParams.size,
    quality: requestParams.quality,
    output_format: requestParams.outputFormat,
    n: requestParams.n,
    stream: requestParams.stream,
    moderation: requestParams.moderation
  };

  if (requestParams.stream) {
    body.partial_images = requestParams.partialImages;
  }

  if (shouldSendCompression(requestParams.outputFormat)) {
    body.output_compression = requestParams.outputCompression;
  }

  if (requestParams.background !== "auto") {
    body.background = requestParams.background;
  }

  return body;
}

export function openAIEditPrompt(job: OpenAIImageJob): string {
  const referenceCount = job.inputAssets.length;
  const referenceLabel = referenceCount === 1 ? "reference image" : "reference images";
  const lines = [
    job.prompt.trim(),
    "",
    "Attached reference guidance:",
    `- The request includes ${referenceCount} attached ${referenceLabel}. Use the attached image content as visual input; do not ignore it.`,
    "- Reflect the visible subjects, style, colors, layout, and salient details from the reference image content where they are relevant to the user's prompt.",
    "- If the user's prompt asks for changes, apply those changes while keeping reference-derived details where applicable.",
    "- If the prompt describes conflict or action, keep it stylized and non-graphic, with no blood, gore, injury detail, or explicit harm."
  ];

  if (job.maskAsset) {
    lines.push("- A mask is attached. Use it as guidance for the editable area on the first reference image and keep unmasked regions stable where possible.");
  }

  return lines.join("\n");
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请稍后重试或调高超时时间。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverOpenAIModels(
  config: StoredProviderConfig,
  apiKey: string,
  runtime: ImageProviderRuntime
): Promise<DiscoveredModel[]> {
  const response = await fetchWithTimeout(
    runtime.fetch,
    buildEndpoint(config.baseURL, "/models"),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    },
    Math.min(config.timeoutMs, 30000)
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return readModelsResponse(response);
}

export async function testOpenAIConnection(
  config: StoredProviderConfig,
  apiKey: string,
  runtime: ImageProviderRuntime
): Promise<ConnectionTestResult> {
  try {
    const response = await fetchWithTimeout(
      runtime.fetch,
      buildEndpoint(config.baseURL, "/models"),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      },
      Math.min(config.timeoutMs, 30000)
    );

    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      return {
        ok: false,
        message: await readApiError(response),
        status: response.status,
        requestId
      };
    }

    return {
      ok: true,
      message: "连接成功。",
      status: response.status,
      requestId
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizeAdapterError(error)
    };
  }
}

export async function runOpenAIImageJob(
  job: OpenAIImageJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime,
  options: OpenAIStreamOptions = {}
): Promise<GenerationJob> {
  const requestJob = normalizeOpenAIJobParams(job, {
    streamingPartialsEnabled: options.streamingPartialsEnabled ?? defaultStreamingPartialsEnabled("openai", baseURL)
  });
  if (requestJob.mode === "generate") {
    return runGeneration(requestJob, apiKey, baseURL, runtime);
  }
  return runEdit(requestJob, apiKey, baseURL, runtime);
}

export function normalizeOpenAIJobParams(job: OpenAIImageJob, options: OpenAIStreamOptions = {}): OpenAIImageJob {
  let params = normalizeOpenAIRequestParams(job.params);
  const canStream = job.mode === "generate" && options.streamingPartialsEnabled === true;
  if (params.stream && !canStream) {
    params = { ...params, stream: false, partialImages: 0 };
  }
  return params === job.params ? job : { ...job, params };
}

async function runGeneration(
  job: OpenAIImageJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  const response = await fetchGenerationResponse(job, apiKey, baseURL, runtime);

  if (!job.params.stream) {
    return handleJsonGenerationImagesWithFallback(
      response,
      job,
      runtime,
      (nextJob) => fetchGenerationResponse(nextJob, apiKey, baseURL, runtime),
      (streamJob) => fetchGenerationResponse(streamJob, apiKey, baseURL, runtime)
    );
  }

  if (!response.ok && shouldRetryNonStreamAfterStreamFailure(response.status)) {
    const streamError = await readApiError(response.clone());
    const fallbackJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        stream: false,
        partialImages: 0
      }
    };
    try {
      const fallbackResponse = await fetchGenerationResponse(fallbackJob, apiKey, baseURL, runtime);
      return handleJsonImagesWithBackfill(fallbackResponse, fallbackJob, runtime, (nextJob) => fetchGenerationResponse(nextJob, apiKey, baseURL, runtime));
    } catch (error) {
      throw new Error(`${streamError}；已尝试降级为非流式请求但仍失败：${normalizeAdapterError(error)}`);
    }
  }

  return handleImagesResponse(response, job, "image_generation", runtime);
}

function shouldRetryNonStreamAfterStreamFailure(status: number): boolean {
  return status === 400 || status === 406 || status === 415 || status === 422;
}

async function fetchGenerationResponse(
  job: OpenAIImageJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime
): Promise<Response> {
  return fetchWithTimeout(
    runtime.fetch,
    buildEndpoint(baseURL, "/images/generations"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: job.params.stream ? "text/event-stream" : "application/json"
      },
      body: JSON.stringify(baseRequestBody(job.params, job.prompt))
    },
    job.params.timeoutMs
  );
}

async function runEdit(
  job: OpenAIImageJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  validateEditJob(job);

  const response = await fetchEditResponse(job, apiKey, baseURL, runtime);

  if (!job.params.stream) {
    return handleJsonEditImagesWithFallback(response, job, runtime, (nextJob, purpose) => {
      const imageFieldName = purpose === "empty-retry" ? "image" : "image[]";
      return fetchEditResponse(nextJob, apiKey, baseURL, runtime, imageFieldName);
    }, (streamJob) => fetchEditResponse(streamJob, apiKey, baseURL, runtime, "image[]"));
  }

  return handleImagesResponse(response, job, "image_edit", runtime);
}

function validateEditJob(job: OpenAIImageJob): void {
  if (job.inputAssets.length === 0) {
    throw new Error(job.mode === "inpaint" ? "局部重绘至少需要一张源图。" : "图像编辑至少需要一张源图。");
  }
  if (job.mode === "inpaint" && !job.maskAsset) {
    throw new Error("局部重绘需要提供 mask。");
  }
  if (job.maskAsset) {
    const maskType = validateMaskMimeType(job.maskAsset.mimeType);
    if (!maskType.ok) {
      throw new Error(maskType.message ?? "Mask format is invalid.");
    }
    const sourceFormat = validateMaskSourceFormat(job.inputAssets[0]?.mimeType, job.maskAsset.mimeType);
    if (!sourceFormat.ok) {
      throw new Error(sourceFormat.message ?? "Mask format is invalid.");
    }
  }
}

async function fetchEditResponse(
  job: OpenAIImageJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime,
  imageFieldName: EditImageFieldName = "image[]"
): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(baseRequestBody(job.params, openAIEditPrompt(job)))) {
    form.append(key, String(value));
  }

  for (const asset of job.inputAssets) {
    form.append(imageFieldName, await assetToBlob(asset), asset.name);
  }

  if (job.maskAsset) {
    form.append("mask", await assetToBlob(job.maskAsset), job.maskAsset.name);
  }

  return fetchWithTimeout(
    runtime.fetch,
    buildEndpoint(baseURL, "/images/edits"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: job.params.stream ? "text/event-stream" : "application/json"
      },
      body: form
    },
    job.params.timeoutMs
  );
}

async function assetToBlob(asset: InputAsset): Promise<Blob> {
  const content = await fs.readFile(asset.path);
  return new Blob([content], { type: asset.mimeType });
}

async function handleImagesResponse(
  response: Response,
  job: OpenAIImageJob,
  eventPrefix: "image_generation" | "image_edit",
  runtime: OpenAIImageRuntime,
  firstIndex = 0
): Promise<GenerationJob> {
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  if (job.params.stream) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return handleJsonImagesResponse(response, job, runtime);
    }
    return handleStreamResponse(response, job, eventPrefix, runtime, firstIndex);
  }

  return handleJsonImagesResponse(response, job, runtime);
}

async function handleJsonImagesResponse(
  response: Response,
  job: OpenAIImageJob,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  const { outputs, usage, emptyReason } = await readAndSaveJsonImagesResponse(response, job, runtime, 0, job.params.n);

  if (outputs.length === 0) {
    throw new Error(noSavableOpenAIImageMessage(emptyReason));
  }

  return {
    ...job,
    outputs,
    usage,
    status: "succeeded",
    updatedAt: new Date().toISOString()
  };
}

async function handleJsonImagesWithBackfill(
  response: Response,
  job: OpenAIImageJob,
  runtime: OpenAIImageRuntime,
  fetchAdditional: (job: OpenAIImageJob, purpose: JsonImageFetchPurpose) => Promise<Response>
): Promise<GenerationJob> {
  const requestedCount = Math.max(1, job.params.n);
  const firstResult = await readAndSaveJsonImagesResponse(response, job, runtime, 0, requestedCount);
  const outputs = [...firstResult.outputs];
  let usage = firstResult.usage;
  let emptyReason = firstResult.emptyReason;

  if (outputs.length === 0 && firstResult.retryableEmpty) {
    const retryJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        n: requestedCount,
        stream: false,
        partialImages: 0
      }
    };
    const retryResponse = await fetchAdditional(retryJob, "empty-retry");
    const retryResult = await readAndSaveJsonImagesResponse(retryResponse, job, runtime, 0, requestedCount);
    outputs.push(...retryResult.outputs);
    usage = mergeUsageDetails(usage, retryResult.usage);
    emptyReason = retryResult.emptyReason
      ? `${retryResult.emptyReason}；已自动重试 1 次，仍未收到图片。`
      : "已自动重试 1 次，仍未收到图片。";
  }

  if (outputs.length === 0) {
    throw new Error(noSavableOpenAIImageMessage(emptyReason));
  }

  while (outputs.length < requestedCount) {
    const remainingCount = requestedCount - outputs.length;
    const nextJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        n: remainingCount,
        stream: false,
        partialImages: 0
      }
    };
    const nextResponse = await fetchAdditional(nextJob, "backfill");
    const nextResult = await readAndSaveJsonImagesResponse(nextResponse, job, runtime, outputs.length, remainingCount);
    if (nextResult.outputs.length === 0) {
      break;
    }
    outputs.push(...nextResult.outputs);
    usage = mergeUsageDetails(usage, nextResult.usage);
  }

  if (outputs.length < requestedCount) {
    throw new Error(`OpenAI API 返回图片数量不足：请求 ${requestedCount} 张，实际收到 ${outputs.length} 张。`);
  }

  return {
    ...job,
    outputs,
    usage,
    status: "succeeded",
    updatedAt: new Date().toISOString()
  };
}

async function handleJsonGenerationImagesWithFallback(
  response: Response,
  job: OpenAIImageJob,
  runtime: OpenAIImageRuntime,
  fetchAdditional: (job: OpenAIImageJob, purpose: JsonImageFetchPurpose) => Promise<Response>,
  fetchStreamFallback: (job: OpenAIImageJob) => Promise<Response>
): Promise<GenerationJob> {
  const requestedCount = Math.max(1, job.params.n);
  const firstResult = await readAndSaveJsonImagesResponse(response, job, runtime, 0, requestedCount);
  const outputs = [...firstResult.outputs];
  let usage = firstResult.usage;
  let emptyReason = firstResult.emptyReason;

  if (outputs.length > 0) {
    return completeJsonBackfill(job, outputs, usage, runtime, fetchAdditional);
  }

  if (firstResult.retryableEmpty) {
    const retryJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        n: requestedCount,
        stream: false,
        partialImages: 0
      }
    };
    const retryResponse = await fetchAdditional(retryJob, "empty-retry");
    const retryResult = await readAndSaveJsonImagesResponse(retryResponse, job, runtime, 0, requestedCount);
    outputs.push(...retryResult.outputs);
    usage = mergeUsageDetails(usage, retryResult.usage);
    emptyReason = retryResult.emptyReason
      ? `${retryResult.emptyReason}；已自动重试 1 次，仍未收到图片。`
      : "已自动重试 1 次，仍未收到图片。";

    if (outputs.length > 0) {
      return completeJsonBackfill(job, outputs, usage, runtime, fetchAdditional);
    }

    try {
      while (countFinalOutputs(outputs) < requestedCount) {
        const firstIndex = countFinalOutputs(outputs);
        const streamJob: OpenAIImageJob = {
          ...job,
          params: {
            ...job.params,
            n: 1,
            stream: true,
            partialImages: 1
          }
        };
        const streamResponse = await fetchStreamFallback(streamJob);
        const streamResult = await handleImagesResponse(streamResponse, streamJob, "image_generation", runtime, firstIndex);
        const finalCountBefore = countFinalOutputs(outputs);
        outputs.push(...streamResult.outputs);
        usage = mergeUsageDetails(usage, streamResult.usage);
        if (countFinalOutputs(outputs) <= finalCountBefore) break;
      }

      if (countFinalOutputs(outputs) >= requestedCount) {
        return {
          ...job,
          outputs,
          usage,
          status: "succeeded",
          updatedAt: new Date().toISOString()
        };
      }
    } catch (error) {
      emptyReason = `${emptyReason ?? ""}；已尝试流式生成兜底但仍失败：${normalizeAdapterError(error)}`;
    }
  }

  throw new Error(noSavableOpenAIImageMessage(emptyReason));
}

async function handleJsonEditImagesWithFallback(
  response: Response,
  job: OpenAIImageJob,
  runtime: OpenAIImageRuntime,
  fetchAdditional: (job: OpenAIImageJob, purpose: JsonImageFetchPurpose) => Promise<Response>,
  fetchStreamFallback: (job: OpenAIImageJob) => Promise<Response>
): Promise<GenerationJob> {
  const requestedCount = Math.max(1, job.params.n);
  const firstResult = await readAndSaveJsonImagesResponse(response, job, runtime, 0, requestedCount);
  const outputs = [...firstResult.outputs];
  let usage = firstResult.usage;
  let emptyReason = firstResult.emptyReason;

  if (outputs.length > 0) {
    return completeJsonBackfill(job, outputs, usage, runtime, fetchAdditional);
  }

  if (firstResult.retryableEmpty) {
    const retryJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        n: requestedCount,
        stream: false,
        partialImages: 0
      }
    };
    const retryResponse = await fetchAdditional(retryJob, "empty-retry");
    const retryResult = await readAndSaveJsonImagesResponse(retryResponse, job, runtime, 0, requestedCount);
    outputs.push(...retryResult.outputs);
    usage = mergeUsageDetails(usage, retryResult.usage);
    emptyReason = retryResult.emptyReason
      ? `${retryResult.emptyReason}；已自动重试 1 次，仍未收到图片。`
      : "已自动重试 1 次，仍未收到图片。";

    if (outputs.length > 0) {
      return completeJsonBackfill(job, outputs, usage, runtime, fetchAdditional);
    }

    const streamJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        n: requestedCount,
        stream: true,
        partialImages: 1
      }
    };
    try {
      const streamResponse = await fetchStreamFallback(streamJob);
      const streamResult = await handleImagesResponse(streamResponse, streamJob, "image_edit", runtime);
      return {
        ...streamResult,
        usage: mergeUsageDetails(usage, streamResult.usage),
        params: job.params
      };
    } catch (error) {
      emptyReason = `${emptyReason ?? ""}；已尝试流式编辑兜底但仍失败：${normalizeAdapterError(error)}`;
    }
  }

  throw new Error(noSavableOpenAIImageMessage(emptyReason));
}

function countFinalOutputs(outputs: ImageAsset[]): number {
  return outputs.filter((asset) => asset.sourceType === "result").length;
}

async function completeJsonBackfill(
  job: OpenAIImageJob,
  initialOutputs: ImageAsset[],
  initialUsage: UsageDetails | undefined,
  runtime: OpenAIImageRuntime,
  fetchAdditional: (job: OpenAIImageJob, purpose: JsonImageFetchPurpose) => Promise<Response>
): Promise<GenerationJob> {
  const requestedCount = Math.max(1, job.params.n);
  const outputs = [...initialOutputs];
  let usage = initialUsage;

  while (outputs.length < requestedCount) {
    const remainingCount = requestedCount - outputs.length;
    const nextJob: OpenAIImageJob = {
      ...job,
      params: {
        ...job.params,
        n: remainingCount,
        stream: false,
        partialImages: 0
      }
    };
    const nextResponse = await fetchAdditional(nextJob, "backfill");
    const nextResult = await readAndSaveJsonImagesResponse(nextResponse, job, runtime, outputs.length, remainingCount);
    if (nextResult.outputs.length === 0) break;
    outputs.push(...nextResult.outputs);
    usage = mergeUsageDetails(usage, nextResult.usage);
  }

  if (outputs.length < requestedCount) {
    throw new Error(`OpenAI API 返回图片数量不足：请求 ${requestedCount} 张，实际收到 ${outputs.length} 张。`);
  }

  return {
    ...job,
    outputs,
    usage,
    status: "succeeded",
    updatedAt: new Date().toISOString()
  };
}

async function readAndSaveJsonImagesResponse(
  response: Response,
  job: OpenAIImageJob,
  runtime: OpenAIImageRuntime,
  firstIndex: number,
  maxResults: number
): Promise<JsonImagesResult> {
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(await readUnexpectedOpenAIResponse(response, "JSON 图片结果"));
  }

  let payload: ImagesResponse;
  try {
    payload = (await response.json()) as ImagesResponse;
  } catch {
    throw new Error("OpenAI API 返回的图片结果不是有效 JSON。请检查 Base URL 是否指向 OpenAI 兼容的 /v1 接口。");
  }
  const imageItems = collectImageItemsFromPayload(payload).slice(0, maxResults);
  const outputs = await saveImageItems(job, imageItems, "result", runtime, firstIndex);

  return {
    outputs,
    usage: payload.usage,
    emptyReason: outputs.length === 0 ? describeNoImagePayload(payload) : undefined,
    retryableEmpty: outputs.length === 0 ? isRetryableEmptyImagePayload(payload) : false
  };
}

function mergeUsageDetails(current: UsageDetails | undefined, next: UsageDetails | undefined): UsageDetails | undefined {
  if (!current) return next;
  if (!next) return current;
  const details = mergeUsageTokenDetails(current.input_tokens_details, next.input_tokens_details);
  return {
    total_tokens: sumOptionalNumbers(current.total_tokens, next.total_tokens),
    input_tokens: sumOptionalNumbers(current.input_tokens, next.input_tokens),
    output_tokens: sumOptionalNumbers(current.output_tokens, next.output_tokens),
    ...(details ? { input_tokens_details: details } : {})
  };
}

function mergeUsageTokenDetails(
  current: UsageDetails["input_tokens_details"],
  next: UsageDetails["input_tokens_details"]
): UsageDetails["input_tokens_details"] | undefined {
  if (!current) return next;
  if (!next) return current;
  const textTokens = sumOptionalNumbers(current.text_tokens, next.text_tokens);
  const imageTokens = sumOptionalNumbers(current.image_tokens, next.image_tokens);
  return {
    ...(textTokens === undefined ? {} : { text_tokens: textTokens }),
    ...(imageTokens === undefined ? {} : { image_tokens: imageTokens })
  };
}

function sumOptionalNumbers(current: number | undefined, next: number | undefined): number | undefined {
  if (current === undefined && next === undefined) return undefined;
  return (current ?? 0) + (next ?? 0);
}

type OpenAIImageItem = { b64_json?: string; url?: string };

const IMAGE_STRING_KEYS = new Set([
  "b64_json",
  "b64",
  "base64",
  "base64_json",
  "base64_data",
  "binary",
  "data",
  "image",
  "image_data",
  "image_base64",
  "imageBase64",
  "result"
]);

const IMAGE_URL_KEYS = new Set(["url", "uri", "image_url", "imageUrl", "image_uri", "imageUri"]);

const PRIORITY_NESTED_IMAGE_KEYS = new Set([
  "artifact",
  "artifacts",
  "body",
  "choices",
  "content",
  "data",
  "extra_fields",
  "extraFields",
  "generation",
  "generations",
  "image",
  "images",
  "inline_data",
  "inlineData",
  "message",
  "output",
  "outputs",
  "payload",
  "response",
  "result",
  "results"
]);

function collectImageItemsFromPayload(payload: unknown): OpenAIImageItem[] {
  const items: OpenAIImageItem[] = [];

  const pushItem = (item: OpenAIImageItem) => {
    if (!item.b64_json && !item.url) return;
    items.push(item);
  };

  const pushBase64OrDataUrl = (value: string) => {
    const trimmed = normalizeImageString(value);
    if (!trimmed) return;
    if (trimmed.startsWith("data:image/")) {
      pushItem({ url: trimmed });
      return;
    }
    pushItem({ b64_json: trimmed });
  };

  const pushImageLikeString = (value: string, key: string, parentType: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("data:image/")) {
      pushItem({ url: trimmed });
      return;
    }

    if (isLikelyHttpUrl(trimmed) && (IMAGE_URL_KEYS.has(key) || /image/i.test(key) || /image/i.test(parentType))) {
      pushItem({ url: trimmed });
      return;
    }

    if (shouldTreatAsImageBase64(trimmed, key, parentType)) {
      pushBase64OrDataUrl(trimmed);
    }
  };

  const visit = (value: unknown, key = "", parentType = "", depth = 0) => {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, parentType, depth + 1);
      return;
    }

    if (typeof value === "string") {
      const parsedJson = parseMaybeJsonImageContainer(value, key, parentType);
      if (parsedJson !== undefined) {
        visit(parsedJson, key, parentType, depth + 1);
      }
      if ((IMAGE_URL_KEYS.has(key) || (key === "source" && /image/i.test(parentType))) && value.trim()) {
        pushItem({ url: value.trim() });
      }
      if (key === "result" && /image_(?:generation|edit)_call|image/i.test(parentType)) {
        pushBase64OrDataUrl(value);
      }
      pushImageLikeString(value, key, parentType);
      return;
    }

    if (!isRecord(value)) return;

    const type = typeof value.type === "string" ? value.type : parentType;
    const handledStringKeys = new Set<string>();
    const handleStringField = (fieldKey: string, fieldValue: string, forceImage = false) => {
      handledStringKeys.add(fieldKey);
      const parsedJson = parseMaybeJsonImageContainer(fieldValue, fieldKey, type);
      if (parsedJson !== undefined) {
        visit(parsedJson, fieldKey, type, depth + 1);
      }
      if (forceImage) {
        pushBase64OrDataUrl(fieldValue);
        return;
      }
      pushImageLikeString(fieldValue, fieldKey, type);
    };

    if (typeof value.b64_json === "string") handleStringField("b64_json", value.b64_json, true);
    if (typeof value.image_base64 === "string") handleStringField("image_base64", value.image_base64, true);
    if (typeof value.base64 === "string") handleStringField("base64", value.base64, true);
    if (typeof value.result === "string") {
      if (/image_(?:generation|edit)_call|image/i.test(type)) {
        handleStringField("result", value.result, true);
      } else {
        handleStringField("result", value.result);
      }
    }
    if (typeof value.url === "string" && value.url.trim()) {
      handledStringKeys.add("url");
      pushItem({ url: value.url.trim() });
    }
    if (typeof value.uri === "string" && value.uri.trim()) handleStringField("uri", value.uri);
    if (typeof value.image === "string") handleStringField("image", value.image);
    if (typeof value.image_data === "string") handleStringField("image_data", value.image_data);
    if (typeof value.imageData === "string") handleStringField("imageData", value.imageData);
    if (typeof value.b64 === "string") handleStringField("b64", value.b64);
    if (typeof value.base64_data === "string") handleStringField("base64_data", value.base64_data);
    if (typeof value.base64Data === "string") handleStringField("base64Data", value.base64Data);

    if (typeof value.image_url === "string" && value.image_url.trim()) {
      handledStringKeys.add("image_url");
      pushItem({ url: value.image_url.trim() });
    } else if (isRecord(value.image_url) && typeof value.image_url.url === "string" && value.image_url.url.trim()) {
      pushItem({ url: value.image_url.url.trim() });
    }

    const mimeType = typeof value.mimeType === "string" ? value.mimeType : typeof value.mime_type === "string" ? value.mime_type : "";
    if (typeof value.data === "string") {
      handleStringField("data", value.data, /^image\//i.test(mimeType) || key === "inlineData" || /inlineData|image/i.test(type));
    }

    for (const nestedKey of PRIORITY_NESTED_IMAGE_KEYS) {
      if (nestedKey in value && typeof value[nestedKey] !== "string") {
        visit(value[nestedKey], nestedKey, type, depth + 1);
      }
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      if (PRIORITY_NESTED_IMAGE_KEYS.has(childKey) && typeof childValue !== "string") continue;
      if (typeof childValue === "string" && handledStringKeys.has(childKey)) continue;
      visit(childValue, childKey, type, depth + 1);
    }
  };

  visit(payload);
  return items;
}

function parseMaybeJsonImageContainer(value: string, key: string, parentType: string): unknown {
  if (!shouldInspectStringContainer(key, parentType)) return undefined;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function shouldInspectStringContainer(key: string, parentType: string): boolean {
  return PRIORITY_NESTED_IMAGE_KEYS.has(key) || /image|result|output|response|payload|extra/i.test(key) || /image|result|output|response|payload|extra/i.test(parentType);
}

function normalizeImageString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  return trimmed.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
}

function shouldTreatAsImageBase64(value: string, key: string, parentType: string): boolean {
  if (!IMAGE_STRING_KEYS.has(key) && !/image/i.test(key) && !/image/i.test(parentType)) return false;
  return isLikelyImageBase64(value);
}

function isLikelyImageBase64(value: string): boolean {
  const normalized = normalizeImageString(value);
  if (normalized.length < 64) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(normalized)) return false;
  return (
    normalized.startsWith("iVBORw0KGgo") ||
    normalized.startsWith("/9j/") ||
    normalized.startsWith("UklGR") ||
    normalized.startsWith("R0lGOD") ||
    normalized.startsWith("Qk") ||
    normalized.startsWith("SUkq") ||
    normalized.startsWith("TU0AK")
  );
}

function isLikelyHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function noSavableOpenAIImageMessage(reason?: string): string {
  return reason
    ? `OpenAI API 没有返回可保存的图片。可能被安全策略拦截，或兼容接口未返回图片字段。${reason}`
    : "OpenAI API 没有返回可保存的图片。可能被安全策略拦截，或兼容接口未返回图片字段。";
}

function describeNoImagePayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const details: string[] = [];
  const rootKeys = Object.keys(payload).slice(0, 10);
  if (rootKeys.length === 0) {
    details.push("空 JSON 对象");
  } else {
    details.push(`顶层字段：${rootKeys.join(",")}`);
  }

  if (Array.isArray(payload.data)) {
    const firstKeys = payload.data
      .slice(0, 3)
      .filter(isRecord)
      .map((item) => Object.keys(item).slice(0, 6).join(","))
      .filter(Boolean);
    details.push(`data ${payload.data.length} 项${firstKeys.length ? `，字段：${firstKeys.join(" / ")}` : ""}`);
  } else if (isRecord(payload.data)) {
    details.push(`data 字段：${Object.keys(payload.data).slice(0, 8).join(",")}`);
  } else if ("data" in payload) {
    details.push(`data 类型：${describePrimitiveValue(payload.data)}`);
  }

  if (Array.isArray(payload.output)) {
    const outputTypes = payload.output
      .slice(0, 4)
      .map((item) => isRecord(item) && typeof item.type === "string" ? item.type : typeof item)
      .join(", ");
    details.push(`output ${payload.output.length} 项${outputTypes ? `，类型：${outputTypes}` : ""}`);
  }

  for (const key of ["images", "artifacts", "generations", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const firstKeys = value
        .slice(0, 3)
        .filter(isRecord)
        .map((item) => Object.keys(item).slice(0, 6).join(","))
        .filter(Boolean);
      details.push(`${key} ${value.length} 项${firstKeys.length ? `，字段：${firstKeys.join(" / ")}` : ""}`);
    }
  }

  if (isRecord(payload.usage)) {
    const usageKeys = Object.keys(payload.usage).slice(0, 8);
    if (usageKeys.length > 0) details.push(`usage 字段：${usageKeys.join(",")}`);
    if (typeof payload.usage.num_input_images === "number") {
      details.push(`输入图片数：${payload.usage.num_input_images}`);
    } else if (isSimpleDiagnosticValue(payload.usage.num_input_images)) {
      details.push(`输入图片数：${describePrimitiveValue(payload.usage.num_input_images)}`);
    }
  }

  if (isRecord(payload.extra_fields)) {
    const extraKeys = Object.keys(payload.extra_fields).slice(0, 10);
    details.push(`extra_fields 字段：${extraKeys.length ? extraKeys.join(",") : "空对象"}`);
    const extraSummary = summarizeExtraFields(payload.extra_fields);
    if (extraSummary) details.push(`extra_fields 摘要：${extraSummary}`);
  } else if ("extra_fields" in payload) {
    details.push(`extra_fields 类型：${describePrimitiveValue(payload.extra_fields)}`);
  }

  const textDetails = collectOpenAITextDiagnostics(payload);
  if (textDetails.length > 0) {
    details.push(`文本信息：${textDetails.slice(0, 2).join(" / ")}`);
  }

  return details.length > 0 ? `响应摘要：${details.join("；")}` : undefined;
}

function isRetryableEmptyImagePayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (collectOpenAITextDiagnostics(payload).length > 0) return false;
  if (!("data" in payload) || !(payload.data == null || (Array.isArray(payload.data) && payload.data.length === 0))) return false;
  if (!isRecord(payload.extra_fields)) return false;
  return (
    "provider" in payload.extra_fields ||
    "routing_info" in payload.extra_fields ||
    "provider_response_headers" in payload.extra_fields ||
    "resolved_model_used" in payload.extra_fields
  );
}

function summarizeExtraFields(extraFields: Record<string, unknown>): string {
  const details: string[] = [];
  for (const key of ["request_type", "provider", "original_model_requested", "resolved_model_used", "latency", "chunk_index"]) {
    const value = extraFields[key];
    if (isSimpleDiagnosticValue(value)) {
      details.push(`${key}=${describePrimitiveValue(value)}`);
    }
  }

  const dropped = extraFields.dropped_compat_plugin_params;
  if (Array.isArray(dropped)) {
    const values = dropped.map((item) => describePrimitiveValue(item)).filter(Boolean).slice(0, 8);
    if (values.length > 0) details.push(`dropped=${values.join(",")}`);
  } else if (isRecord(dropped)) {
    const keys = Object.keys(dropped).slice(0, 8);
    if (keys.length > 0) details.push(`dropped字段=${keys.join(",")}`);
  } else if (isSimpleDiagnosticValue(dropped)) {
    details.push(`dropped=${describePrimitiveValue(dropped)}`);
  }

  if (isRecord(extraFields.provider_response_headers)) {
    const headerDetails = summarizeProviderResponseHeaders(extraFields.provider_response_headers);
    if (headerDetails) details.push(`headers=${headerDetails}`);
  }

  return details.join("，");
}

function summarizeProviderResponseHeaders(headers: Record<string, unknown>): string {
  const preferredKeys = [
    "content-type",
    "x-request-id",
    "openai-processing-ms",
    "cf-ray",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests"
  ];
  const details: string[] = [];
  for (const key of preferredKeys) {
    const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
    if (isSimpleDiagnosticValue(value)) {
      details.push(`${key}:${describePrimitiveValue(value)}`);
    }
  }
  if (details.length > 0) return details.join(",");
  return Object.keys(headers).slice(0, 8).join(",");
}

function isSimpleDiagnosticValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function describePrimitiveValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "string") {
    const trimmed = redactLikelySecrets(value.trim()).replace(/\s+/g, " ");
    return trimmed ? `string(${trimmed.slice(0, 80)})` : "空字符串";
  }
  return typeof value;
}

function collectOpenAITextDiagnostics(payload: unknown): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const interestingKeys = new Set([
    "blocked_reason",
    "category",
    "code",
    "detail",
    "details",
    "error",
    "finish_reason",
    "finishReason",
    "message",
    "reason",
    "refusal",
    "safety",
    "safety_reason",
    "status",
    "text",
    "warning"
  ]);

  const push = (value: string) => {
    const text = redactLikelySecrets(value.trim()).replace(/\s+/g, " ").slice(0, 180);
    if (!text || seen.has(text)) return;
    seen.add(text);
    values.push(text);
  };

  const visit = (value: unknown, key = "", parentType = "", depth = 0) => {
    if (depth > 6 || value == null || values.length >= 4) return;
    if (typeof value === "string") {
      if (interestingKeys.has(key) || (parentType === "output_text" && key !== "type")) push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, parentType, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    const type = typeof value.type === "string" ? value.type : parentType;
    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey, type, depth + 1);
    }
  };

  visit(payload);
  return values;
}

async function readModelsResponse(response: Response): Promise<DiscoveredModel[]> {
  const payload = await readProviderJsonResponse<ModelsResponse>(response, {
    responseLabel: "OpenAI API",
    expected: "JSON 模型列表",
    invalidJsonMessage: "OpenAI API 返回的模型列表不是有效 JSON。请检查 Base URL 是否指向 OpenAI 兼容的 /v1 接口。"
  });

  const data = Array.isArray(payload.data) ? payload.data : [];
  return data.flatMap((item): DiscoveredModel[] => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    return [
      {
        id: item.id.trim(),
        providerKind: "openai",
        displayName: item.id.trim(),
        raw: item
      }
    ];
  });
}

async function readApiError(response: Response): Promise<string> {
  return readProviderApiError(response, {
    fallbackMessage: (status, requestSuffix) => `OpenAI API 请求失败：HTTP ${status}.${requestSuffix}`,
    formatMessage: (message, requestSuffix) => `OpenAI API 请求失败：${message}${requestSuffix}`,
    extractJsonMessage(payload) {
      if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
      return firstString(payload.error.message, payload.error.code, payload.error.type);
    }
  });
}

async function readUnexpectedOpenAIResponse(response: Response, expected: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const text = redactLikelySecrets((await response.text()).trim()).slice(0, 240);
  const suffix = text ? ` 响应开头：${text}` : "";
  return `OpenAI API 返回了非预期响应，期望 ${expected}，实际 Content-Type: ${contentType}.${suffix}`;
}

function normalizeAdapterError(error: unknown): string {
  if (error instanceof Error) return redactLikelySecrets(error.message);
  return redactLikelySecrets(String(error));
}

async function handleStreamResponse(
  response: Response,
  job: OpenAIImageJob,
  eventPrefix: "image_generation" | "image_edit",
  runtime: OpenAIImageRuntime,
  firstIndex = 0
): Promise<GenerationJob> {
  if (!response.body) {
    throw new Error("OpenAI API 返回了空的流式响应。");
  }

  const outputs: ImageAsset[] = [];
  let usage: UsageDetails | undefined;
  let partialIndex = firstIndex;
  let resultIndex = firstIndex;

  await parseSSE(response.body, async (event) => {
    if (event.error?.message) {
      throw new Error(`OpenAI API 请求失败：${redactLikelySecrets(event.error.message)}`);
    }

    const type = event.type ?? "";
    const isPartial = type === `${eventPrefix}.partial_image` || type.endsWith(".partial_image");
    const sourceType = isPartial ? "partial" : "result";
    const index = isPartial ? event.partial_image_index ?? partialIndex++ : resultIndex++;
    const items = event.data?.length ? event.data : [{ b64_json: event.b64_json, url: event.url }];
    const images = await saveImageItems(job, items, sourceType, runtime, index);
    if (images.length === 0) return;
    outputs.push(...images);

    if (event.usage) {
      usage = event.usage;
    }

    if (isPartial) {
      runtime.sendJobEvent({
        jobId: job.id,
        type: "partial",
        partialIndex: index,
        image: images[0]
      });
    }
  });

  const finalOutputs = outputs.filter((asset) => asset.sourceType === "result");
  if (finalOutputs.length === 0) {
    throw new Error("OpenAI API 没有返回最终图片。");
  }

  return {
    ...job,
    outputs,
    usage,
    status: "succeeded",
    updatedAt: new Date().toISOString()
  };
}

export async function parseSSE(body: ReadableStream<Uint8Array>, onEvent: (event: ImageStreamEvent) => Promise<void>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      await processSSEBlock(part, onEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processSSEBlock(buffer, onEvent);
  }
}

async function saveImageItems(
  job: OpenAIImageJob,
  items: Array<{ b64_json?: string; url?: string }>,
  sourceType: "result" | "partial",
  runtime: OpenAIImageRuntime,
  firstIndex = 0
): Promise<ImageAsset[]> {
  const outputs: ImageAsset[] = [];
  for (const [offset, item] of items.entries()) {
    const b64Json = await imageItemToBase64(item);
    if (b64Json) {
      outputs.push(await saveBase64Image(job.id, b64Json, job.params, sourceType, firstIndex + offset, runtime));
    }
  }
  return outputs;
}

async function imageItemToBase64(item: { b64_json?: string; url?: string }): Promise<string | null> {
  if (item.b64_json) return item.b64_json;
  if (!item.url) return null;
  if (item.url.startsWith("data:image/")) {
    return dataUrlToBase64(item.url);
  }

  const response = await fetch(item.url);
  if (!response.ok) {
    throw new Error(`OpenAI API 返回了图片 URL，但下载失败：HTTP ${response.status}。`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

async function processSSEBlock(block: string, onEvent: (event: ImageStreamEvent) => Promise<void>): Promise<void> {
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return;

  try {
    await onEvent(JSON.parse(data) as ImageStreamEvent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("无法解析 OpenAI 流式响应。");
    }
    throw error;
  }
}

async function saveBase64Image(
  jobId: string,
  b64Json: string,
  params: OpenAIImageParams,
  sourceType: "result" | "partial",
  index: number,
  runtime: OpenAIImageRuntime
): Promise<ImageAsset> {
  await runtime.ensureDir(runtime.imagesDir);
  const ext = extensionForFormat(params.outputFormat);
  const mimeType = mimeTypeForFormat(params.outputFormat);
  const fileName = `${jobId}-${sourceType}-${index}.${ext}`;
  const filePath = path.join(runtime.imagesDir, fileName);
  await fs.writeFile(filePath, Buffer.from(b64Json, "base64"));

  return {
    id: `img_${randomUUID()}`,
    jobId,
    path: filePath,
    fileName,
    mimeType,
    sourceType,
    createdAt: new Date().toISOString(),
    transientPreview: {
      dataUrl: `data:${mimeType};base64,${b64Json}`
    }
  };
}
