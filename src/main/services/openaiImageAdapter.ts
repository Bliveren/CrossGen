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
  validateOpenAIRunJobRequest
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
}

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
    return runOpenAIImageJob(asOpenAIImageJob(job), apiKey, config.baseURL, runtime);
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
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  const requestJob = normalizeOpenAIJobParams(job);
  if (requestJob.mode === "generate") {
    return runGeneration(requestJob, apiKey, baseURL, runtime);
  }
  return runEdit(requestJob, apiKey, baseURL, runtime);
}

export function normalizeOpenAIJobParams(job: OpenAIImageJob): OpenAIImageJob {
  let params = normalizeOpenAIRequestParams(job.params);
  // 聚合器普遍不支持 SSE 流式响应；统一走非流式以兼容所有提供商。
  if (params.stream) {
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
    return handleJsonImagesWithBackfill(response, job, runtime, (nextJob) => fetchGenerationResponse(nextJob, apiKey, baseURL, runtime));
  }

  return handleImagesResponse(response, job, "image_generation", runtime);
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
    return handleJsonImagesWithBackfill(response, job, runtime, (nextJob) => fetchEditResponse(nextJob, apiKey, baseURL, runtime));
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
  runtime: OpenAIImageRuntime
): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(baseRequestBody(job.params, job.prompt))) {
    form.append(key, String(value));
  }

  const imageFieldName = job.inputAssets.length === 1 ? "image" : "image[]";
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
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  if (job.params.stream) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return handleJsonImagesResponse(response, job, runtime);
    }
    return handleStreamResponse(response, job, eventPrefix, runtime);
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
  fetchAdditional: (job: OpenAIImageJob) => Promise<Response>
): Promise<GenerationJob> {
  const requestedCount = Math.max(1, job.params.n);
  const firstResult = await readAndSaveJsonImagesResponse(response, job, runtime, 0, requestedCount);
  const outputs = [...firstResult.outputs];
  let usage = firstResult.usage;

  if (outputs.length === 0) {
    throw new Error(noSavableOpenAIImageMessage(firstResult.emptyReason));
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
    const nextResponse = await fetchAdditional(nextJob);
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

  return { outputs, usage: payload.usage, emptyReason: outputs.length === 0 ? describeNoImagePayload(payload) : undefined };
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

function collectImageItemsFromPayload(payload: unknown): OpenAIImageItem[] {
  const items: OpenAIImageItem[] = [];

  const pushItem = (item: OpenAIImageItem) => {
    if (!item.b64_json && !item.url) return;
    items.push(item);
  };

  const pushBase64OrDataUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("data:image/")) {
      pushItem({ url: trimmed });
      return;
    }
    pushItem({ b64_json: trimmed });
  };

  const visit = (value: unknown, key = "", parentType = "", depth = 0) => {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, parentType, depth + 1);
      return;
    }

    if (typeof value === "string") {
      if ((key === "url" || key === "image_url") && value.trim()) {
        pushItem({ url: value.trim() });
      }
      if (key === "result" && /image_(?:generation|edit)_call|image/i.test(parentType)) {
        pushBase64OrDataUrl(value);
      }
      return;
    }

    if (!isRecord(value)) return;

    const type = typeof value.type === "string" ? value.type : parentType;
    if (typeof value.b64_json === "string") pushBase64OrDataUrl(value.b64_json);
    if (typeof value.image_base64 === "string") pushBase64OrDataUrl(value.image_base64);
    if (typeof value.base64 === "string") pushBase64OrDataUrl(value.base64);
    if (typeof value.result === "string" && /image_(?:generation|edit)_call|image/i.test(type)) pushBase64OrDataUrl(value.result);
    if (typeof value.url === "string" && value.url.trim()) pushItem({ url: value.url.trim() });

    if (typeof value.image_url === "string" && value.image_url.trim()) {
      pushItem({ url: value.image_url.trim() });
    } else if (isRecord(value.image_url) && typeof value.image_url.url === "string" && value.image_url.url.trim()) {
      pushItem({ url: value.image_url.url.trim() });
    }

    const mimeType = typeof value.mimeType === "string" ? value.mimeType : typeof value.mime_type === "string" ? value.mime_type : "";
    if (typeof value.data === "string" && (/^image\//i.test(mimeType) || key === "inlineData" || /inlineData|image/i.test(type))) {
      pushBase64OrDataUrl(value.data);
    }

    for (const nestedKey of ["data", "output", "content", "images", "image", "result", "inlineData", "inline_data"]) {
      if (nestedKey in value && typeof value[nestedKey] !== "string") {
        visit(value[nestedKey], nestedKey, type, depth + 1);
      }
    }
  };

  visit(payload);
  return items;
}

function noSavableOpenAIImageMessage(reason?: string): string {
  return reason
    ? `OpenAI API 没有返回可保存的图片。可能被安全策略拦截，或兼容接口未返回图片字段。${reason}`
    : "OpenAI API 没有返回可保存的图片。可能被安全策略拦截，或兼容接口未返回图片字段。";
}

function describeNoImagePayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const details: string[] = [];

  if (Array.isArray(payload.data)) {
    const firstKeys = payload.data
      .slice(0, 3)
      .filter(isRecord)
      .map((item) => Object.keys(item).slice(0, 6).join(","))
      .filter(Boolean);
    details.push(`data ${payload.data.length} 项${firstKeys.length ? `，字段：${firstKeys.join(" / ")}` : ""}`);
  }

  if (Array.isArray(payload.output)) {
    const outputTypes = payload.output
      .slice(0, 4)
      .map((item) => isRecord(item) && typeof item.type === "string" ? item.type : typeof item)
      .join(", ");
    details.push(`output ${payload.output.length} 项${outputTypes ? `，类型：${outputTypes}` : ""}`);
  }

  const textDetails = collectOpenAITextDiagnostics(payload);
  if (textDetails.length > 0) {
    details.push(`文本信息：${textDetails.slice(0, 2).join(" / ")}`);
  }

  return details.length > 0 ? `响应摘要：${details.join("；")}` : undefined;
}

function collectOpenAITextDiagnostics(payload: unknown): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const interestingKeys = new Set(["message", "refusal", "reason", "status", "code", "finish_reason", "text"]);

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
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  if (!response.body) {
    throw new Error("OpenAI API 返回了空的流式响应。");
  }

  const outputs: ImageAsset[] = [];
  let usage: UsageDetails | undefined;
  let partialIndex = 0;
  let resultIndex = 0;

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
