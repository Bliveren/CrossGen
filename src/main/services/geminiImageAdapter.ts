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
import {
  firstString,
  isRecord,
  readProviderApiError,
  readProviderJsonResponse,
  redactLikelySecrets,
  requestIdFromHeaders,
  type SecretRedactionOptions
} from "./providerHttp.js";
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
    imageConfig: {
      aspectRatio: GeminiImageParams["aspectRatio"];
      imageSize: "512" | "1K" | "2K" | "4K";
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
  data?: unknown;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

type GeminiImageJob = GenerationJob & { params: GeminiImageParams };
type GeminiImageRuntime = ImageJobRuntime;
type GeminiImageSource = GeminiInlineData & { url?: string };

const GEMINI_SECRET_REDACTION: SecretRedactionOptions = { redactGoogleKeys: true };
const GEMINI_REQUEST_ID_HEADERS = ["x-request-id", "x-goog-request-id"] as const;

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
    imageConfig: {
      aspectRatio: params.aspectRatio,
      imageSize: geminiImageSizeForResolution(params.resolution)
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

    const requestId = requestIdFromHeaders(response.headers, GEMINI_REQUEST_ID_HEADERS);
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
    throw new Error(geminiNoImageMessage(parsed));
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
  images: GeminiImageSource[];
  textParts: string[];
  finishReasons: string[];
} {
  const images: GeminiImageSource[] = [];
  const textParts: string[] = [];
  const finishReasons: string[] = [];

  images.push(...openAIStyleImagesFromGeminiPayload(payload));

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
        textParts.push(textPartForMetadata(part.text));
        images.push(...imageSourcesFromText(part.text));
      }
      const imageSource = imageSourceFromResponsePart(part);
      if (imageSource) {
        images.push(imageSource);
      }
    }
  }

  return { images, textParts, finishReasons };
}

function openAIStyleImagesFromGeminiPayload(payload: GeminiGenerateContentResponse): GeminiImageSource[] {
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item): GeminiImageSource[] => {
    if (!isRecord(item)) return [];
    const data = firstString(item.b64_json, item.b64Json, item.base64, item.data);
    const url = firstString(item.url, item.uri);
    const mimeType = firstString(item.mimeType, item.mime_type, item.mime);
    const fallbackMimeType = mimeTypeFromUrl(data) ?? mimeTypeFromUrl(url) ?? "image/png";
    if (data) return [{ mimeType: normalizeGeminiResponseMimeType(mimeType, fallbackMimeType), data }];
    if (url) return [{ mimeType: normalizeGeminiResponseMimeType(mimeType, fallbackMimeType), data: "", url }];
    return [];
  });
}

function imageSourceFromResponsePart(part: Record<string, unknown>): GeminiImageSource | null {
  const rawInlineData = isRecord(part.inlineData) ? part.inlineData : isRecord(part.inline_data) ? part.inline_data : undefined;
  if (rawInlineData) {
    const data = firstString(rawInlineData.data, rawInlineData.b64_json, rawInlineData.b64Json, rawInlineData.base64, rawInlineData.bytesBase64Encoded);
    const mimeType = firstString(rawInlineData.mimeType, rawInlineData.mime_type, rawInlineData.mime);
    if (data) {
      return {
        mimeType: normalizeGeminiResponseMimeType(mimeType, mimeTypeFromUrl(data) ?? "image/png"),
        data
      };
    }
  }

  const rawFileData = isRecord(part.fileData) ? part.fileData : isRecord(part.file_data) ? part.file_data : undefined;
  const url = rawFileData
    ? firstString(rawFileData.fileUri, rawFileData.file_uri, rawFileData.uri, rawFileData.url)
    : firstString(part.fileUri, part.file_uri, part.url, part.uri);
  if (!url) return null;
  const mimeType = rawFileData ? firstString(rawFileData.mimeType, rawFileData.mime_type, rawFileData.mime) : undefined;
  const fallbackMimeType = mimeTypeFromUrl(url) ?? "image/png";
  return {
    mimeType: normalizeGeminiResponseMimeType(mimeType, fallbackMimeType),
    data: "",
    url
  };
}

function imageSourcesFromText(text: string): GeminiImageSource[] {
  const sources: GeminiImageSource[] = [];

  // 1. 内嵌 base64 data URL：data:image/png;base64,...
  for (const match of text.matchAll(dataImageUrlPattern())) {
    const mimeType = normalizeGeminiResponseMimeType(match[1], "image/png");
    sources.push({
      mimeType,
      data: `data:${mimeType};base64,${match[2] ?? ""}`
    });
  }

  // 2. Markdown 图片链接：![...](https://...png)
  //    部分聚合站会把图片 URL 嵌在 text part 里而不是用 inlineData
  for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi)) {
    const url = match[1];
    if (!url) continue;
    const fallbackMimeType = mimeTypeFromUrl(url) ?? "image/png";
    sources.push({ mimeType: fallbackMimeType, data: "", url });
  }

  return sources;
}

function textPartForMetadata(text: string): string {
  return text
    .trim()
    .replace(dataImageUrlPattern(), (_match, mimeType: string) => `data:${mimeType};base64,[image data omitted]`)
    .replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, "[image url omitted]");
}

function dataImageUrlPattern(): RegExp {
  return /data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/_=-]+)/gi;
}

async function saveGeminiImages(jobId: string, images: GeminiImageSource[], runtime: GeminiImageRuntime): Promise<ImageAsset[]> {
  const outputs: ImageAsset[] = [];
  for (const [index, image] of images.entries()) {
    outputs.push(await saveBase64Image(jobId, image, index, runtime));
  }
  return outputs;
}

async function saveBase64Image(
  jobId: string,
  image: GeminiImageSource,
  index: number,
  runtime: GeminiImageRuntime
): Promise<ImageAsset> {
  await runtime.ensureDir(runtime.imagesDir);
  const mimeType = normalizeSupportedGeminiMimeType(image.mimeType);
  const fileName = `${jobId}-result-${index}.${extensionForMimeType(mimeType)}`;
  const filePath = path.join(runtime.imagesDir, fileName);
  await fs.writeFile(filePath, Buffer.from(await geminiImageSourceToBase64(image, runtime), "base64"));

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

async function geminiImageSourceToBase64(image: GeminiImageSource, runtime: GeminiImageRuntime): Promise<string> {
  if (image.data) return image.data.startsWith("data:image/") ? dataUrlToBase64(image.data) : image.data;
  if (!image.url) return "";
  if (image.url.startsWith("data:image/")) return dataUrlToBase64(image.url);
  const response = await fetchWithTimeout(
    runtime.fetch,
    image.url,
    {
      method: "GET",
      headers: {
        Accept: image.mimeType
      }
    },
    30000
  );
  if (!response.ok) {
    throw new Error(`Gemini API 返回了图片 URL，但下载失败：HTTP ${response.status}。`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

async function readGeminiModelsResponse(response: Response): Promise<DiscoveredModel[]> {
  const payload = await readProviderJsonResponse<GeminiModelsResponse>(response, {
    responseLabel: "Gemini API",
    expected: "JSON 模型列表",
    invalidJsonMessage: "Gemini API 返回的模型列表不是有效 JSON。请检查 Base URL 是否指向 Gemini API。",
    redaction: GEMINI_SECRET_REDACTION
  });

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
  return readProviderApiError(response, {
    requestIdHeaders: GEMINI_REQUEST_ID_HEADERS,
    redaction: GEMINI_SECRET_REDACTION,
    fallbackMessage: (status, requestSuffix) => `Gemini API 请求失败：HTTP ${status}.${requestSuffix}`,
    formatMessage: (message, requestSuffix) => `Gemini API 请求失败：${message}${requestSuffix}`,
    extractJsonMessage(payload) {
      if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
      const code = payload.error.code;
      return firstString(payload.error.message, payload.error.status, typeof code === "number" ? String(code) : code);
    }
  });
}

async function readUnexpectedGeminiResponse(response: Response, expected: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "unknown";
  const text = redactLikelySecrets((await response.text()).trim(), GEMINI_SECRET_REDACTION).slice(0, 240);
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

function mimeTypeFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const dataUrlMatch = /^data:([^;,]+)/i.exec(url);
  if (dataUrlMatch?.[1]) return dataUrlMatch[1];
  const normalizedUrl = url.toLowerCase().split(/[?#]/)[0] ?? "";
  if (normalizedUrl.endsWith(".jpg") || normalizedUrl.endsWith(".jpeg")) return "image/jpeg";
  if (normalizedUrl.endsWith(".webp")) return "image/webp";
  if (normalizedUrl.endsWith(".png")) return "image/png";
  return undefined;
}

function geminiNoImageMessage(parsed: { textParts: string[]; finishReasons: string[] }): string {
  const details = [
    parsed.finishReasons.length > 0 ? `finishReason: ${parsed.finishReasons.join(", ")}` : "",
    parsed.textParts.length > 0 ? `text: ${parsed.textParts.join(" ").slice(0, 160)}` : ""
  ].filter(Boolean);
  return details.length > 0 ? `Gemini API 没有返回可保存的图片。${details.join("；")}` : "Gemini API 没有返回可保存的图片。";
}

function normalizeGeminiAdapterError(error: unknown): string {
  if (error instanceof Error) return redactLikelySecrets(error.message, GEMINI_SECRET_REDACTION);
  return redactLikelySecrets(String(error), GEMINI_SECRET_REDACTION);
}

function normalizeSupportedGeminiMimeType(mimeType: string): "image/png" | "image/jpeg" | "image/webp" {
  const normalized = normalizeImageMimeType(mimeType);
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp") return normalized;
  throw new Error("Gemini inline images must be PNG, JPEG, or WebP.");
}

function normalizeGeminiResponseMimeType(mimeType: string | undefined, fallback: string): "image/png" | "image/jpeg" | "image/webp" {
  try {
    return normalizeSupportedGeminiMimeType(mimeType ?? fallback);
  } catch {
    return normalizeSupportedGeminiMimeType(fallback);
  }
}

function extensionForMimeType(mimeType: "image/png" | "image/jpeg" | "image/webp"): "png" | "jpg" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}
