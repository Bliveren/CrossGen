import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { GenerationJob, ImageAsset, ImageParams, InputAsset, JobProgressEvent, UsageDetails } from "../../shared/types.js";
import {
  dataUrlToBase64,
  extensionForFormat,
  mimeTypeForFormat,
  shouldSendCompression,
  validateMaskMimeType,
  validateMaskSourceFormat
} from "../../shared/validation.js";

export interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  usage?: UsageDetails;
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

interface ApiErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export interface OpenAIImageRuntime {
  fetch: typeof fetch;
  imagesDir: string;
  ensureDir: (dirPath: string) => Promise<void>;
  sendJobEvent: (event: JobProgressEvent) => void;
}

export function buildEndpoint(baseURL: string, endpoint: "/images/generations" | "/images/edits" | "/models"): string {
  return `${baseURL.trim().replace(/\/+$/, "")}${endpoint}`;
}

export function baseRequestBody(params: ImageParams, prompt: string): Record<string, string | number | boolean> {
  const body: Record<string, string | number | boolean> = {
    model: params.model,
    prompt,
    size: params.size,
    quality: params.quality,
    output_format: params.outputFormat,
    n: params.n,
    stream: params.stream,
    moderation: params.moderation
  };

  if (params.stream) {
    body.partial_images = params.partialImages;
  }

  if (shouldSendCompression(params.outputFormat)) {
    body.output_compression = params.outputCompression;
  }

  if (params.background !== "auto") {
    body.background = params.background;
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

export async function runOpenAIImageJob(
  job: GenerationJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  if (job.mode === "generate") {
    return runGeneration(job, apiKey, baseURL, runtime);
  }
  return runEdit(job, apiKey, baseURL, runtime);
}

async function runGeneration(
  job: GenerationJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  const response = await fetchWithTimeout(
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

  return handleImagesResponse(response, job, "image_generation", runtime);
}

async function runEdit(
  job: GenerationJob,
  apiKey: string,
  baseURL: string,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
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

  const response = await fetchWithTimeout(
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

  return handleImagesResponse(response, job, "image_edit", runtime);
}

async function assetToBlob(asset: InputAsset): Promise<Blob> {
  const content = await fs.readFile(asset.path);
  return new Blob([content], { type: asset.mimeType });
}

async function handleImagesResponse(
  response: Response,
  job: GenerationJob,
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
  job: GenerationJob,
  runtime: OpenAIImageRuntime
): Promise<GenerationJob> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(await readUnexpectedImageResponse(response, "JSON 图片结果"));
  }

  let payload: ImagesResponse;
  try {
    payload = (await response.json()) as ImagesResponse;
  } catch {
    throw new Error("OpenAI API 返回的图片结果不是有效 JSON。请检查 Base URL 是否指向 OpenAI 兼容的 /v1 接口。");
  }
  const outputs = await saveImageItems(job, payload.data ?? [], "result", runtime);

  if (outputs.length === 0) {
    throw new Error("OpenAI API 没有返回可保存的图片。");
  }

  return {
    ...job,
    outputs,
    usage: payload.usage,
    status: "succeeded",
    updatedAt: new Date().toISOString()
  };
}

async function readApiError(response: Response): Promise<string> {
  const requestId = response.headers.get("x-request-id");
  const requestSuffix = requestId ? ` Request ID: ${requestId}` : "";
  const fallback = `OpenAI API 请求失败：HTTP ${response.status}.${requestSuffix}`;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as ApiErrorPayload;
      const message = payload.error?.message ?? payload.error?.code ?? payload.error?.type;
      return message ? `OpenAI API 请求失败：${message}${requestSuffix}` : fallback;
    }

    const text = await response.text();
    return text.trim() ? `OpenAI API 请求失败：${redactLikelySecrets(text.trim())}${requestSuffix}` : fallback;
  } catch {
    return fallback;
  }
}

async function readUnexpectedImageResponse(response: Response, expected: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const text = redactLikelySecrets((await response.text()).trim()).slice(0, 240);
  const suffix = text ? ` 响应开头：${text}` : "";
  return `OpenAI API 返回了非预期响应，期望 ${expected}，实际 Content-Type: ${contentType}.${suffix}`;
}

function redactLikelySecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted");
}

async function handleStreamResponse(
  response: Response,
  job: GenerationJob,
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
      throw new Error(`OpenAI API 请求失败：${event.error.message}`);
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
  job: GenerationJob,
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
  params: ImageParams,
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
    createdAt: new Date().toISOString()
  };
}
