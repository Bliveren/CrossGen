import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ConnectionTestResult,
  DiscoveredModel,
  GeminiImageParams,
  GeminiResolution,
  GenerationJob,
  ImageAsset,
  InputAsset,
  RunJobRequest,
  UsageDetails
} from "../../shared/types.js";
import {
  dataUrlToBase64,
  isGeminiImageParams,
  normalizeImageMimeType,
  validateGeminiRunJobRequest
} from "../../shared/validation.js";
import type { ImageJobRuntime, ImageProviderAdapter, ImageProviderRuntime } from "./imageProviderAdapter.js";
import { fetchWithTimeout } from "./openaiImageAdapter.js";
import type { StoredProviderConfig } from "./stateMigration.js";

export interface GeminiInlineData {
  mimeType: string;
  data: string;
}

export interface GeminiGenerateContentPart {
  text?: string;
  inlineData?: GeminiInlineData;
}

export interface GeminiGenerateContentBody {
  contents: Array<{
    role: "user";
    parts: GeminiGenerateContentPart[];
  }>;
  generationConfig: {
    responseModalities: ["TEXT", "IMAGE"];
    responseFormat: {
      image: {
        aspectRatio: GeminiImageParams["aspectRatio"];
        imageSize: "512" | "1K" | "2K" | "4K";
      };
    };
    thinkingConfig?: {
      thinkingBudget: 0;
    };
  };
  tools?: Array<{
    googleSearch: Record<string, never>;
  }>;
}

interface GeminiModelsResponse {
  models?: unknown[];
}

interface GeminiGenerateContentResponse {
  candidates?: unknown[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

interface GeminiApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

type GeminiImageJob = GenerationJob & { params: GeminiImageParams };
type GeminiImageRuntime = ImageJobRuntime;

export const geminiImageAdapter: ImageProviderAdapter = {
  kind: "gemini",
  discoverModels: discoverGeminiModels,
  testConnection: testGeminiConnection,
  validateJob(request: RunJobRequest) {
    return validateGeminiRunJobRequest(request);
  },
  runJob(job: GenerationJob, apiKey: string, config: StoredProviderConfig, runtime: ImageJobRuntime) {
    return runGeminiImageJob(asGeminiImageJob(job), apiKey, config.baseURL, runtime);
  }
};

export function buildGeminiEndpoint(baseURL: string, endpoint: "/models"): string {
  return `${baseURL.trim().replace(/\/+$/, "")}${endpoint}`;
}

export function buildGeminiGenerateContentEndpoint(baseURL: string, model: string): string {
  const modelId = model.trim().replace(/^models\//, "");
  return `${buildGeminiEndpoint(baseURL, "/models")}/${encodeURIComponent(modelId)}:generateContent`;
}

export function geminiImageSizeForResolution(resolution: GeminiResolution): "512" | "1K" | "2K" | "4K" {
  return resolution === "0.5K" ? "512" : resolution;
}

export function buildGeminiGenerateContentBody(
  params: GeminiImageParams,
  prompt: string,
  inlineDataParts: GeminiInlineData[] = []
): GeminiGenerateContentBody {
  const generationConfig: GeminiGenerateContentBody["generationConfig"] = {
    responseModalities: ["TEXT", "IMAGE"],
    responseFormat: {
      image: {
        aspectRatio: params.aspectRatio,
        imageSize: geminiImageSizeForResolution(params.resolution)
      }
    }
  };

  if (!params.thinking) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const body: GeminiGenerateContentBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, ...inlineDataParts.map((inlineData) => ({ inlineData }))]
      }
    ],
    generationConfig
  };

  if (params.searchGrounding) {
    body.tools = [{ googleSearch: {} }];
  }

  return body;
}

export function asGeminiImageJob(job: GenerationJob): GeminiImageJob {
  if (!isGeminiImageParams(job.params)) {
    throw new Error("当前版本尚未接入该模型运行时。");
  }
  return job as GeminiImageJob;
}

export async function discoverGeminiModels(
  config: StoredProviderConfig,
  apiKey: string,
  runtime: ImageProviderRuntime
): Promise<DiscoveredModel[]> {
  const response = await fetchWithTimeout(
    runtime.fetch,
    buildGeminiEndpoint(config.baseURL, "/models"),
    {
      method: "GET",
      headers: geminiJsonHeaders(apiKey)
    },
    Math.min(config.timeoutMs, 30000)
  );

  if (!response.ok) {
    throw new Error(await readGeminiApiError(response));
  }

  return readGeminiModelsResponse(response);
}

export async function testGeminiConnection(
  config: StoredProviderConfig,
  apiKey: string,
  runtime: ImageProviderRuntime
): Promise<ConnectionTestResult> {
  try {
    const response = await fetchWithTimeout(
      runtime.fetch,
      buildGeminiEndpoint(config.baseURL, "/models"),
      {
        method: "GET",
        headers: geminiJsonHeaders(apiKey)
      },
      Math.min(config.timeoutMs, 30000)
    );

    const requestId = requestIdFromHeaders(response.headers);
    if (!response.ok) {
      return {
        ok: false,
        message: await readGeminiApiError(response),
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
      message: normalizeGeminiAdapterError(error)
    };
  }
}

export async function runGeminiImageJob(
  job: GeminiImageJob,
  apiKey: string,
  baseURL: string,
  runtime: GeminiImageRuntime
): Promise<GenerationJob> {
  if (job.mode === "generate" && job.inputAssets.length > 0) {
    throw new Error("文生图不应携带输入图片。");
  }
  if ((job.mode === "edit" || job.mode === "inpaint") && job.inputAssets.length === 0) {
    throw new Error(job.mode === "inpaint" ? "局部重绘至少需要一张源图。" : "图像编辑至少需要一张源图。");
  }
  if (job.mode === "inpaint" && !job.maskAsset) {
    throw new Error("局部重绘需要提供 mask。");
  }

  const inlineDataParts = await inputAssetsToInlineDataParts(job.inputAssets, job.maskAsset);
  const response = await fetchWithTimeout(
    runtime.fetch,
    buildGeminiGenerateContentEndpoint(baseURL, job.params.model),
    {
      method: "POST",
      headers: geminiJsonHeaders(apiKey),
      body: JSON.stringify(buildGeminiGenerateContentBody(job.params, job.prompt, inlineDataParts))
    },
    job.params.timeoutMs
  );

  return handleGeminiGenerateContentResponse(response, job, runtime);
}

async function inputAssetsToInlineDataParts(inputAssets: InputAsset[], maskAsset?: InputAsset): Promise<GeminiInlineData[]> {
  const imageParts = await Promise.all(inputAssets.map(inputAssetToInlineData));
  if (!maskAsset) return imageParts;
  return [...imageParts, await inputAssetToInlineData(maskAsset)];
}

async function inputAssetToInlineData(asset: InputAsset): Promise<GeminiInlineData> {
  const mimeType = normalizeSupportedGeminiMimeType(asset.mimeType);
  if (asset.dataUrl) {
    return {
      mimeType,
      data: dataUrlToBase64(asset.dataUrl)
    };
  }
  const content = await fs.readFile(asset.path);
  return {
    mimeType,
    data: content.toString("base64")
  };
}

async function handleGeminiGenerateContentResponse(
  response: Response,
  job: GeminiImageJob,
  runtime: GeminiImageRuntime
): Promise<GenerationJob> {
  if (!response.ok) {
    throw new Error(await readGeminiApiError(response));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(await readUnexpectedGeminiResponse(response, "JSON 图片结果"));
  }

  let payload: GeminiGenerateContentResponse;
  try {
    payload = (await response.json()) as GeminiGenerateContentResponse;
  } catch {
    throw new Error("Gemini API 返回的图片结果不是有效 JSON。请检查 Base URL 是否指向 Gemini generateContent 接口。");
  }

  const parsed = collectGeminiResponseParts(payload);
  const outputs = await saveGeminiImages(job.id, parsed.images, runtime);
  if (outputs.length === 0) {
    throw new Error("Gemini API 没有返回可保存的图片。");
  }

  return {
    ...job,
    outputs,
    usage: usageFromGemini(payload.usageMetadata),
    providerMetadata: {
      ...job.providerMetadata,
      geminiTextParts: parsed.textParts,
      geminiFinishReasons: parsed.finishReasons,
      geminiModelVersion: payload.modelVersion,
      geminiRequest: {
        aspectRatio: job.params.aspectRatio,
        resolution: job.params.resolution,
        mode: job.mode
      }
    },
    status: "succeeded",
    updatedAt: new Date().toISOString()
  };
}

function collectGeminiResponseParts(payload: GeminiGenerateContentResponse): {
  images: GeminiInlineData[];
  textParts: string[];
  finishReasons: string[];
} {
  const images: GeminiInlineData[] = [];
  const textParts: string[] = [];
  const finishReasons: string[] = [];

  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.finishReason === "string" && candidate.finishReason.trim()) {
      finishReasons.push(candidate.finishReason.trim());
    }

    const content = isRecord(candidate.content) ? candidate.content : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text);
      }
      const inlineData = inlineDataFromResponsePart(part);
      if (inlineData) {
        images.push(inlineData);
      }
    }
  }

  return { images, textParts, finishReasons };
}

function inlineDataFromResponsePart(part: Record<string, unknown>): GeminiInlineData | null {
  const rawInlineData = isRecord(part.inlineData) ? part.inlineData : isRecord(part.inline_data) ? part.inline_data : undefined;
  if (!rawInlineData || typeof rawInlineData.data !== "string") return null;
  const mimeType = typeof rawInlineData.mimeType === "string" ? rawInlineData.mimeType : "image/png";
  return {
    mimeType: normalizeSupportedGeminiMimeType(mimeType),
    data: rawInlineData.data
  };
}

async function saveGeminiImages(jobId: string, images: GeminiInlineData[], runtime: GeminiImageRuntime): Promise<ImageAsset[]> {
  const outputs: ImageAsset[] = [];
  for (const [index, image] of images.entries()) {
    outputs.push(await saveBase64Image(jobId, image, index, runtime));
  }
  return outputs;
}

async function saveBase64Image(
  jobId: string,
  image: GeminiInlineData,
  index: number,
  runtime: GeminiImageRuntime
): Promise<ImageAsset> {
  await runtime.ensureDir(runtime.imagesDir);
  const mimeType = normalizeSupportedGeminiMimeType(image.mimeType);
  const fileName = `${jobId}-result-${index}.${extensionForMimeType(mimeType)}`;
  const filePath = path.join(runtime.imagesDir, fileName);
  await fs.writeFile(filePath, Buffer.from(image.data, "base64"));

  return {
    id: `img_${randomUUID()}`,
    jobId,
    path: filePath,
    fileName,
    mimeType,
    sourceType: "result",
    createdAt: new Date().toISOString()
  };
}

async function readGeminiModelsResponse(response: Response): Promise<DiscoveredModel[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(await readUnexpectedGeminiResponse(response, "JSON 模型列表"));
  }

  let payload: GeminiModelsResponse;
  try {
    payload = (await response.json()) as GeminiModelsResponse;
  } catch {
    throw new Error("Gemini API 返回的模型列表不是有效 JSON。请检查 Base URL 是否指向 Gemini API。");
  }

  const models = Array.isArray(payload.models) ? payload.models : [];
  return models.flatMap((item): DiscoveredModel[] => {
    if (!isRecord(item)) return [];
    const rawId = typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : "";
    const id = rawId.replace(/^models\//, "").trim();
    if (!id) return [];
    const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
    if (methods.length > 0 && !methods.includes("generateContent")) return [];
    return [
      {
        id,
        providerKind: "gemini",
        displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim() : id,
        description: typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined,
        raw: item
      }
    ];
  });
}

async function readGeminiApiError(response: Response): Promise<string> {
  const requestId = requestIdFromHeaders(response.headers);
  const requestSuffix = requestId ? ` Request ID: ${requestId}` : "";
  const fallback = `Gemini API 请求失败：HTTP ${response.status}.${requestSuffix}`;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as GeminiApiErrorPayload;
      const message = payload.error?.message ?? payload.error?.status ?? String(payload.error?.code ?? "");
      return message ? `Gemini API 请求失败：${redactLikelySecrets(message)}${requestSuffix}` : fallback;
    }

    const text = await response.text();
    return text.trim() ? `Gemini API 请求失败：${redactLikelySecrets(text.trim())}${requestSuffix}` : fallback;
  } catch {
    return fallback;
  }
}

async function readUnexpectedGeminiResponse(response: Response, expected: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const text = redactLikelySecrets((await response.text()).trim()).slice(0, 240);
  const suffix = text ? ` 响应开头：${text}` : "";
  return `Gemini API 返回了非预期响应，期望 ${expected}，实际 Content-Type: ${contentType}.${suffix}`;
}

function usageFromGemini(usage?: GeminiGenerateContentResponse["usageMetadata"]): UsageDetails | undefined {
  if (!usage) return undefined;
  return {
    input_tokens: usage.promptTokenCount,
    output_tokens: usage.candidatesTokenCount,
    total_tokens: usage.totalTokenCount
  };
}

function geminiJsonHeaders(apiKey: string): HeadersInit {
  return {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

function requestIdFromHeaders(headers: Headers): string | undefined {
  return headers.get("x-request-id") ?? headers.get("x-goog-request-id") ?? undefined;
}

function normalizeGeminiAdapterError(error: unknown): string {
  if (error instanceof Error) return redactLikelySecrets(error.message);
  return redactLikelySecrets(String(error));
}

function normalizeSupportedGeminiMimeType(mimeType: string): "image/png" | "image/jpeg" | "image/webp" {
  const normalized = normalizeImageMimeType(mimeType);
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp") return normalized;
  throw new Error("Gemini inline images must be PNG, JPEG, or WebP.");
}

function extensionForMimeType(mimeType: "image/png" | "image/jpeg" | "image/webp"): "png" | "jpg" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function redactLikelySecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted").replace(/AIza[A-Za-z0-9_-]{8,}/g, "AIza...redacted");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
