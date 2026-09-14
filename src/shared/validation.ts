import type {
  FocusedLaunchId,
  GeneralImageParams,
  GenerationJob,
  GeminiAspectRatio,
  GeminiImageParams,
  GeminiResolution,
  ImageBackground,
  ImageAsset,
  ImageFormat,
  ImageParams,
  ImageQuality,
  ModerationMode,
  OpenAIImageParams,
  ProviderKind,
  ReferenceImageMode,
  ResponsesInputImageDetail,
  ResponsesImageAction,
  RunJobRequest,
  SketchTaskMetadata
} from "./types.js";
import { isImageAsset } from "../core/mediaTypes.js";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID,
  generalFallbackSupportsReferenceImages,
  isGeneralFallbackProvider,
  isGeminiImageModelId,
  isGptImage25ModelId,
  isGptImageModelId
} from "./modelCatalog.js";
import { SKETCH_GUIDANCE_KEYS, validateSketchDocument, validateSketchTaskMetadata } from "./sketch.js";

export const GPT_IMAGE_2_MODEL = GPT_IMAGE_2_MODEL_ID;

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_RESPONSES_MODEL = "gpt-6-astra";
export const MAX_GPT_IMAGE_INPUTS = 16;
export const MAX_OPENAI_SAFETY_IDENTIFIER_LENGTH = 64;
export const GENERAL_PROMPT_ONLY_MESSAGE = "General OpenAI 兼容兜底仅支持纯提示词生成。";

export const DEFAULT_IMAGE_PARAMS: OpenAIImageParams = {
  providerKind: "openai",
  launchId: GPT_IMAGE_2_LAUNCH_ID,
  model: GPT_IMAGE_2_MODEL,
  imageRoute: "auto",
  referenceImageMode: "original",
  size: "auto",
  quality: "auto",
  outputFormat: "png",
  outputCompression: 100,
  background: "auto",
  n: 1,
  stream: false,
  partialImages: 0,
  moderation: "auto",
  timeoutMs: 240000
};

export const DEFAULT_GEMINI_IMAGE_PARAMS: GeminiImageParams = {
  providerKind: "gemini",
  launchId: NANO_BANANA_3_LAUNCH_ID,
  model: NANO_BANANA_3_MODEL_ID,
  referenceImageMode: "original",
  aspectRatio: "1:1",
  resolution: "1K",
  outputCount: 1,
  thinking: true,
  searchGrounding: false,
  timeoutMs: 240000
};

export const DEFAULT_GENERAL_IMAGE_PARAMS: GeneralImageParams = {
  providerKind: "custom",
  launchId: GENERAL_LAUNCH_ID,
  model: "",
  referenceImageMode: "original",
  outputCount: 1,
  timeoutMs: 240000
};

export const IMAGE_QUALITY_OPTIONS = ["auto", "low", "medium", "high"] as const satisfies readonly ImageQuality[];
export const GPT_IMAGE_2_5_QUALITY_OPTIONS = ["auto", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ImageQuality[];
export const IMAGE_FORMAT_OPTIONS = ["png", "jpeg", "webp"] as const satisfies readonly ImageFormat[];
export const IMAGE_BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"] as const satisfies readonly ImageBackground[];
export const MODERATION_MODE_OPTIONS = ["auto", "low"] as const satisfies readonly ModerationMode[];
export const RESPONSES_IMAGE_ACTION_OPTIONS = ["auto", "generate", "edit"] as const satisfies readonly ResponsesImageAction[];
export const RESPONSES_INPUT_IMAGE_DETAIL_OPTIONS = ["auto", "low", "high", "original"] as const satisfies readonly ResponsesInputImageDetail[];
export const REFERENCE_IMAGE_MODE_OPTIONS = ["original", "optimized"] as const satisfies readonly ReferenceImageMode[];
export const PROVIDER_KIND_OPTIONS = ["openai", "gemini", "custom"] as const satisfies readonly ProviderKind[];
export const FOCUSED_LAUNCH_OPTIONS = [GPT_IMAGE_2_LAUNCH_ID, GPT_IMAGE_2_5_LAUNCH_ID, NANO_BANANA_3_LAUNCH_ID, GENERAL_LAUNCH_ID] as const satisfies readonly FocusedLaunchId[];
export const GEMINI_ASPECT_RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"] as const satisfies readonly GeminiAspectRatio[];
export const GEMINI_RESOLUTION_OPTIONS = ["0.5K", "1K", "2K", "4K"] as const satisfies readonly GeminiResolution[];
const IMAGE_PATH_PATTERN = /\.(png|jpe?g|webp)$/i;

export function isGptImage25Launch(launchId: FocusedLaunchId | undefined): boolean {
  return launchId === GPT_IMAGE_2_5_LAUNCH_ID;
}

export function isGptImage25Params(params: unknown): params is OpenAIImageParams {
  return isRecord(params) &&
    params.providerKind === "openai" &&
    (params.launchId === GPT_IMAGE_2_5_LAUNCH_ID || isGptImage25ModelId(typeof params.model === "string" ? params.model : ""));
}

function qualityOptionsForOpenAIModel(model: string, launchId?: FocusedLaunchId): readonly ImageQuality[] {
  return isGptImage25Launch(launchId) || isGptImage25ModelId(model)
    ? GPT_IMAGE_2_5_QUALITY_OPTIONS
    : IMAGE_QUALITY_OPTIONS;
}

function backgroundOptionsForOpenAIModel(model: string, launchId?: FocusedLaunchId): readonly ImageBackground[] {
  return isGptImage25Launch(launchId) || isGptImage25ModelId(model)
    ? IMAGE_BACKGROUND_OPTIONS
    : ["auto", "opaque"] as const;
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function normalizeBaseURL(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BASE_URL;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BASE_URL;

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function isDirectOpenAIBaseURL(value: string): boolean {
  try {
    const url = new URL(normalizeBaseURL(value));
    return url.protocol === "https:" && url.hostname === "api.openai.com" && url.pathname.replace(/\/+$/, "") === "/v1";
  } catch {
    return false;
  }
}

export function defaultStreamingPartialsEnabled(kind: ProviderKind | undefined, baseURL: string): boolean {
  return false;
}

export function redactSecret(value: unknown): string {
  if (typeof value !== "string") return "";
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function validateApiKey(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { ok: false, message: "API Key 格式无效。" };
  }
  if (!value.trim()) {
    return { ok: false, message: "API Key 不能为空。" };
  }
  if (value.trim().length < 12) {
    return { ok: false, message: "API Key 看起来过短。" };
  }
  return { ok: true };
}

export function validatePrompt(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { ok: false, message: "Prompt 格式无效。" };
  }
  const length = value.trim().length;
  if (length === 0) {
    return { ok: false, message: "请输入 prompt。" };
  }
  if (length > 32000) {
    return { ok: false, message: "GPT Image prompt 不能超过 32000 字符。" };
  }
  return { ok: true };
}

export function parseImageSize(size: unknown): { width: number; height: number } | null {
  if (typeof size !== "string") return null;
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

export function validateGptImage2Size(size: unknown): ValidationResult {
  if (typeof size !== "string") {
    return { ok: false, message: "尺寸参数无效。" };
  }
  if (size === "auto") return { ok: true };
  const parsed = parseImageSize(size);
  if (!parsed) {
    return { ok: false, message: "尺寸需使用 auto 或 WIDTHxHEIGHT，例如 1536x1024。" };
  }
  const { width, height } = parsed;
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, message: "GPT Image 2 / 2.5 要求宽高都是 16 的倍数。" };
  }
  if (Math.max(width, height) > 3840) {
    return { ok: false, message: "GPT Image 2 / 2.5 最长边不能超过 3840px。" };
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 3) {
    return { ok: false, message: "GPT Image 2 / 2.5 长短边比例不能超过 3:1。" };
  }
  const pixels = width * height;
  if (pixels < 655360 || pixels > 8294400) {
    return { ok: false, message: "GPT Image 2 / 2.5 总像素需在 655,360 到 8,294,400 之间。" };
  }
  return { ok: true };
}

export function isOpenAIImageParams(params: unknown): params is OpenAIImageParams {
  return (
    isRecord(params) &&
    params.providerKind === "openai" &&
    (params.launchId === GPT_IMAGE_2_LAUNCH_ID || params.launchId === GPT_IMAGE_2_5_LAUNCH_ID) &&
    typeof params.model === "string" &&
    typeof params.size === "string" &&
    typeof params.stream === "boolean"
  );
}

export function isGeminiImageParams(params: unknown): params is GeminiImageParams {
  return (
    isRecord(params) &&
    params.providerKind === "gemini" &&
    params.launchId === NANO_BANANA_3_LAUNCH_ID &&
    typeof params.model === "string" &&
    typeof params.aspectRatio === "string" &&
    typeof params.resolution === "string"
  );
}

export function isGeneralImageParams(params: unknown): params is GeneralImageParams {
  return (
    isRecord(params) &&
    isOneOf(params.providerKind, PROVIDER_KIND_OPTIONS) &&
    params.launchId === GENERAL_LAUNCH_ID &&
    typeof params.model === "string"
  );
}

function paramsProviderKind(params: Record<string, unknown>): ProviderKind | undefined {
  return isOneOf(params.providerKind, PROVIDER_KIND_OPTIONS) ? params.providerKind : undefined;
}

function paramsLaunchId(params: Record<string, unknown>): FocusedLaunchId | undefined {
  return isOneOf(params.launchId, FOCUSED_LAUNCH_OPTIONS) ? params.launchId : undefined;
}

export function validateOpenAIImageParams(params: unknown): ValidationResult {
  if (!isRecord(params)) {
    return { ok: false, message: "参数格式无效。" };
  }
  if (params.providerKind !== undefined && params.providerKind !== "openai") {
    return { ok: false, message: "OpenAI 图片参数的 providerKind 必须为 openai。" };
  }
  if (params.launchId !== undefined && params.launchId !== GPT_IMAGE_2_LAUNCH_ID && params.launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: `OpenAI 图片参数的 launchId 必须为 ${GPT_IMAGE_2_LAUNCH_ID} 或 ${GPT_IMAGE_2_5_LAUNCH_ID}。` };
  }
  if (typeof params.model !== "string") {
    return { ok: false, message: "模型参数无效。" };
  }
  if (typeof params.size !== "string") {
    return { ok: false, message: "尺寸参数无效。" };
  }
  if (typeof params.stream !== "boolean") {
    return { ok: false, message: "流式预览参数无效。" };
  }
  const imageRoute = params.imageRoute ?? "auto";
  if (!isOneOf(imageRoute, ["auto", "image-api", "responses", "chat-completions"] as const)) {
    return { ok: false, message: "接口路径参数无效。" };
  }
  const model = params.model.trim();
  if (!isGptImageModelId(model)) {
    return { ok: false, message: `OpenAI 图片模型仅支持 ${GPT_IMAGE_2_MODEL} 或 GPT Image 2.5 的 Sunburst/Flare 模型。` };
  }
  const launchId = isGptImage25ModelId(model) ? GPT_IMAGE_2_5_LAUNCH_ID : GPT_IMAGE_2_LAUNCH_ID;
  if (params.launchId !== undefined && params.launchId !== launchId) {
    return { ok: false, message: "OpenAI 图片模型与启动模型不匹配。" };
  }
  if (launchId === GPT_IMAGE_2_5_LAUNCH_ID && imageRoute === "chat-completions") {
    return { ok: false, message: "GPT Image 2.5 不支持 Chat Completions，请使用 auto、image-api 或 responses。" };
  }
  if (params.user !== undefined && (typeof params.user !== "string" || !params.user.trim())) {
    return { ok: false, message: "安全标识不能为空。" };
  }
  if (typeof params.user === "string" && params.user.trim().length > MAX_OPENAI_SAFETY_IDENTIFIER_LENGTH) {
    return { ok: false, message: `安全标识不能超过 ${MAX_OPENAI_SAFETY_IDENTIFIER_LENGTH} 个字符。` };
  }
  const qualityOptions = qualityOptionsForOpenAIModel(model, launchId);
  if (!isOneOf(params.quality, qualityOptions)) {
    return { ok: false, message: launchId === GPT_IMAGE_2_5_LAUNCH_ID ? "GPT Image 2.5 质量参数需为 auto、low、medium、high、xhigh 或 max。" : "质量参数需为 auto、low、medium 或 high。" };
  }
  if (!isOneOf(params.outputFormat, IMAGE_FORMAT_OPTIONS)) {
    return { ok: false, message: "输出格式需为 png、jpeg 或 webp。" };
  }
  const backgroundOptions = backgroundOptionsForOpenAIModel(model, launchId);
  if (!isOneOf(params.background, backgroundOptions)) {
    return { ok: false, message: launchId === GPT_IMAGE_2_5_LAUNCH_ID ? "GPT Image 2.5 背景参数需为 auto、opaque 或 transparent。" : "GPT Image 2 背景参数需为 auto 或 opaque。" };
  }
  if (params.background === "transparent" && params.outputFormat !== "png" && params.outputFormat !== "webp") {
    return { ok: false, message: "透明背景只能与 PNG 或 WebP 输出格式一起使用。" };
  }
  if (params.inputFidelity !== undefined && !isOneOf(params.inputFidelity, ["low", "high"] as const)) {
    return { ok: false, message: "输入图保真度需为 low 或 high。" };
  }
  if (params.inputFidelity !== undefined && launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: "输入图保真度仅适用于 GPT Image 2.5。" };
  }
  if (params.responsesModel !== undefined && (typeof params.responsesModel !== "string" || !params.responsesModel.trim())) {
    return { ok: false, message: "Responses 主模型无效。" };
  }
  if (params.responsesModel !== undefined && launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: "Responses 主模型仅适用于 GPT Image 2.5。" };
  }
  if (params.responsesAction !== undefined && !isOneOf(params.responsesAction, RESPONSES_IMAGE_ACTION_OPTIONS)) {
    return { ok: false, message: "Responses 图像动作需为 auto、generate 或 edit。" };
  }
  if (params.responsesAction !== undefined && launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: "Responses 图像动作仅适用于 GPT Image 2.5。" };
  }
  if (params.previousResponseId !== undefined && (typeof params.previousResponseId !== "string" || !params.previousResponseId.trim())) {
    return { ok: false, message: "Responses 上一轮响应 ID 无效。" };
  }
  if (params.previousResponseId !== undefined && launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: "Responses 上一轮响应 ID 仅适用于 GPT Image 2.5。" };
  }
  if (params.previousImageGenerationCallId !== undefined && (typeof params.previousImageGenerationCallId !== "string" || !params.previousImageGenerationCallId.trim())) {
    return { ok: false, message: "Responses 图像生成调用 ID 无效。" };
  }
  if (params.previousImageGenerationCallId !== undefined && launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: "Responses 图像生成调用 ID 仅适用于 GPT Image 2.5。" };
  }
  if (params.inputImageDetail !== undefined && !isOneOf(params.inputImageDetail, RESPONSES_INPUT_IMAGE_DETAIL_OPTIONS)) {
    return { ok: false, message: "Responses 输入图细节需为 auto、low、high 或 original。" };
  }
  if (params.inputImageDetail !== undefined && launchId !== GPT_IMAGE_2_5_LAUNCH_ID) {
    return { ok: false, message: "Responses 输入图细节仅适用于 GPT Image 2.5。" };
  }
  if (params.inputImageDetail !== undefined && params.inputImageDetail !== "auto" && imageRoute === "image-api") {
    return { ok: false, message: "非 auto 的 Responses 输入图细节需要使用 Responses 路径。" };
  }
  const hasResponsesOnlyControls = Boolean(
    params.responsesModel?.trim() ||
    (params.responsesAction && params.responsesAction !== "auto") ||
    params.previousResponseId?.trim() ||
    params.previousImageGenerationCallId?.trim() ||
    (params.inputImageDetail && params.inputImageDetail !== "auto")
  );
  if (hasResponsesOnlyControls && imageRoute === "image-api") {
    return { ok: false, message: "Responses 专属参数需要使用 Responses 路径或 auto，不能与 Image API 一起使用。" };
  }
  if (params.previousResponseId !== undefined && params.previousImageGenerationCallId !== undefined) {
    return { ok: false, message: "Responses 续接只能选择 previous_response_id 或 image_generation_call_id 其中一种。" };
  }
  if (!isOneOf(params.moderation, MODERATION_MODE_OPTIONS)) {
    return { ok: false, message: "内容审核参数需为 auto 或 low。" };
  }
  if (params.referenceImageMode !== undefined && !isOneOf(params.referenceImageMode, REFERENCE_IMAGE_MODE_OPTIONS)) {
    return { ok: false, message: "参考图传输模式无效。" };
  }
  const size = validateGptImage2Size(params.size);
  if (!size.ok) return size;
  if (!isInteger(params.n) || params.n < 1 || params.n > 10) {
    return { ok: false, message: "生成数量需在 1 到 10 之间。" };
  }
  if (params.n > 1 && (
    imageRoute === "responses" ||
    params.previousResponseId !== undefined ||
    params.previousImageGenerationCallId !== undefined ||
    (params.inputImageDetail !== undefined && params.inputImageDetail !== "auto") ||
    (typeof params.responsesModel === "string" && params.responsesModel.trim().length > 0) ||
    (params.responsesAction !== undefined && params.responsesAction !== "auto")
  )) {
    return { ok: false, message: "Responses 多轮/动作参数仅支持生成 1 张图片；批量生成请清空这些参数或使用 Images API。" };
  }
  if (!isInteger(params.partialImages) || params.partialImages < 0 || params.partialImages > 3) {
    return { ok: false, message: "partial_images 需在 0 到 3 之间。" };
  }
  if (!isInteger(params.timeoutMs) || params.timeoutMs < 30000 || params.timeoutMs > 600000) {
    return { ok: false, message: "超时时间需在 30 到 600 秒之间。" };
  }
  if (!isInteger(params.outputCompression) || params.outputCompression < 0 || params.outputCompression > 100) {
    return { ok: false, message: "压缩率需在 0 到 100 之间。" };
  }
  return { ok: true };
}

export function validateGeminiImageParams(params: unknown): ValidationResult {
  if (!isRecord(params)) {
    return { ok: false, message: "参数格式无效。" };
  }
  if (params.providerKind !== "gemini") {
    return { ok: false, message: "Gemini 图片参数的 providerKind 必须为 gemini。" };
  }
  if (params.launchId !== NANO_BANANA_3_LAUNCH_ID) {
    return { ok: false, message: `Gemini 图片参数的 launchId 必须为 ${NANO_BANANA_3_LAUNCH_ID}。` };
  }
  if (typeof params.model !== "string" || !params.model.trim()) {
    return { ok: false, message: "模型参数无效。" };
  }
  if (params.referenceImageMode !== undefined && !isOneOf(params.referenceImageMode, REFERENCE_IMAGE_MODE_OPTIONS)) {
    return { ok: false, message: "参考图传输模式无效。" };
  }
  if (!isOneOf(params.aspectRatio, GEMINI_ASPECT_RATIO_OPTIONS)) {
    return { ok: false, message: "Gemini 图片比例参数无效。" };
  }
  if (!isOneOf(params.resolution, GEMINI_RESOLUTION_OPTIONS)) {
    return { ok: false, message: "Gemini 图片分辨率参数无效。" };
  }
  if (!isInteger(params.outputCount) || params.outputCount < 1 || params.outputCount > 1) {
    return { ok: false, message: "Gemini 首期输出数量固定为 1。" };
  }
  if (typeof params.thinking !== "boolean") {
    return { ok: false, message: "Gemini Thinking 参数无效。" };
  }
  if (typeof params.searchGrounding !== "boolean") {
    return { ok: false, message: "Gemini Search grounding 参数无效。" };
  }
  if (!isInteger(params.timeoutMs) || params.timeoutMs < 30000 || params.timeoutMs > 600000) {
    return { ok: false, message: "超时时间需在 30 到 600 秒之间。" };
  }
  return { ok: true };
}

export function validateGeneralImageParams(params: unknown): ValidationResult {
  if (!isRecord(params)) {
    return { ok: false, message: "参数格式无效。" };
  }
  if (!isOneOf(params.providerKind, PROVIDER_KIND_OPTIONS)) {
    return { ok: false, message: "General 图片参数的 providerKind 无效。" };
  }
  if (params.launchId !== GENERAL_LAUNCH_ID) {
    return { ok: false, message: `General 图片参数的 launchId 必须为 ${GENERAL_LAUNCH_ID}。` };
  }
  if (typeof params.model !== "string") {
    return { ok: false, message: "模型参数无效。" };
  }
  if (params.referenceImageMode !== undefined && !isOneOf(params.referenceImageMode, REFERENCE_IMAGE_MODE_OPTIONS)) {
    return { ok: false, message: "参考图传输模式无效。" };
  }
  if (!isInteger(params.outputCount) || params.outputCount < 1 || params.outputCount > 1) {
    return { ok: false, message: "General 首期输出数量固定为 1。" };
  }
  if (!isInteger(params.timeoutMs) || params.timeoutMs < 30000 || params.timeoutMs > 600000) {
    return { ok: false, message: "超时时间需在 30 到 600 秒之间。" };
  }
  return { ok: true };
}

export function validateImageParams(params: unknown): ValidationResult {
  if (!isRecord(params)) {
    return { ok: false, message: "参数格式无效。" };
  }

  const providerKind = paramsProviderKind(params);
  const launchId = paramsLaunchId(params);

  if (launchId === GENERAL_LAUNCH_ID) {
    return validateGeneralImageParams(params);
  }
  if (providerKind === "gemini" || launchId === NANO_BANANA_3_LAUNCH_ID) {
    return validateGeminiImageParams(params);
  }
  return validateOpenAIImageParams(params);
}

export function validateProviderConfigInput(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, message: "配置参数格式无效。" };
  }
  if (input.kind !== undefined && !isOneOf(input.kind, PROVIDER_KIND_OPTIONS)) {
    return { ok: false, message: "Provider 类型无效。" };
  }
  if (typeof input.baseURL !== "string") {
    return { ok: false, message: "Base URL 格式无效。" };
  }
  if (typeof input.defaultModel !== "string") {
    return { ok: false, message: "默认模型格式无效。" };
  }
  if (typeof input.defaultSize !== "string") {
    return { ok: false, message: "默认尺寸格式无效。" };
  }
  const kind = isOneOf(input.kind, PROVIDER_KIND_OPTIONS) ? input.kind : undefined;
  const activeLaunchId = isOneOf(input.activeLaunchId, FOCUSED_LAUNCH_OPTIONS) ? input.activeLaunchId : undefined;
  const defaultModel = input.defaultModel.trim();
  const isNanoModel = activeLaunchId === NANO_BANANA_3_LAUNCH_ID && isGeminiImageModelId(defaultModel);
  const isGpt25Model = activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID && isGptImage25ModelId(defaultModel);
  if ((kind === undefined || kind === "openai") && activeLaunchId !== GENERAL_LAUNCH_ID && !isNanoModel && !isGpt25Model && defaultModel && defaultModel !== DEFAULT_IMAGE_PARAMS.model) {
    return { ok: false, message: `默认模型仅支持 ${DEFAULT_IMAGE_PARAMS.model} 或 GPT Image 2.5 的 Sunburst/Flare 模型。` };
  }
  const defaultSize = input.defaultSize.trim();
  if (defaultSize) {
    const size = validateGptImage2Size(defaultSize);
    if (!size.ok) return size;
  }
  const defaultQualityOptions = activeLaunchId === GPT_IMAGE_2_5_LAUNCH_ID || isGptImage25ModelId(defaultModel)
    ? GPT_IMAGE_2_5_QUALITY_OPTIONS
    : IMAGE_QUALITY_OPTIONS;
  if (typeof input.defaultQuality !== "string" || !isOneOf(input.defaultQuality, defaultQualityOptions)) {
    return { ok: false, message: "默认质量参数无效。" };
  }
  if (!isInteger(input.timeoutMs) || input.timeoutMs < 30000 || input.timeoutMs > 600000) {
    return { ok: false, message: "默认超时时间需在 30 到 600 秒之间。" };
  }
  if (input.streamingPartialsEnabled !== undefined && typeof input.streamingPartialsEnabled !== "boolean") {
    return { ok: false, message: "流式预览配置无效。" };
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== "string") {
    return { ok: false, message: "API Key 格式无效。" };
  }
  if (input.activeLaunchId !== undefined && !activeLaunchId) {
    return { ok: false, message: "启动模型无效。" };
  }
  if (input.activeModelId !== undefined && typeof input.activeModelId !== "string") {
    return { ok: false, message: "活动模型 ID 无效。" };
  }
  return { ok: true };
}

export function validateInputAssetShape(asset: unknown): ValidationResult {
  if (!isRecord(asset)) {
    return { ok: false, message: "输入资源格式无效。" };
  }
  if (typeof asset.id !== "string") {
    return { ok: false, message: "输入资源 ID 无效。" };
  }
  if (typeof asset.name !== "string") {
    return { ok: false, message: "输入资源名称无效。" };
  }
  if (typeof asset.path !== "string") {
    return { ok: false, message: "输入资源路径无效。" };
  }
  if (typeof asset.mimeType !== "string") {
    return { ok: false, message: "输入资源 MIME 类型无效。" };
  }
  if (!isInteger(asset.sizeBytes) || asset.sizeBytes < 0) {
    return { ok: false, message: "输入资源大小无效。" };
  }
  if (asset.dataUrl !== undefined && typeof asset.dataUrl !== "string") {
    return { ok: false, message: "输入资源数据无效。" };
  }
  if (asset.previewUrl !== undefined && typeof asset.previewUrl !== "string") {
    return { ok: false, message: "输入资源预览地址无效。" };
  }
  if (asset.width !== undefined && (!isInteger(asset.width) || asset.width < 1)) {
    return { ok: false, message: "输入资源宽度无效。" };
  }
  if (asset.height !== undefined && (!isInteger(asset.height) || asset.height < 1)) {
    return { ok: false, message: "输入资源高度无效。" };
  }
  if (asset.role !== undefined && asset.role !== "reference" && asset.role !== "sketch") {
    return { ok: false, message: "输入资源角色无效。" };
  }
  if (asset.artifactId !== undefined && (typeof asset.artifactId !== "string" || !asset.artifactId.trim())) {
    return { ok: false, message: "输入资源 artifact ID 无效。" };
  }
  if (asset.documentHash !== undefined && (typeof asset.documentHash !== "string" || !/^[0-9a-f]{8,128}$/i.test(asset.documentHash))) {
    return { ok: false, message: "输入资源文档 hash 无效。" };
  }
  if (asset.sourceAssetId !== undefined && (typeof asset.sourceAssetId !== "string" || !asset.sourceAssetId.trim())) {
    return { ok: false, message: "输入资源来源 ID 无效。" };
  }
  if (asset.sourceOperation !== undefined && !["sketch", "annotation", "crop", "import"].includes(asset.sourceOperation as string)) {
    return { ok: false, message: "输入资源来源操作无效。" };
  }
  if (asset.parentArtifactId !== undefined && (
    typeof asset.parentArtifactId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,120}$/.test(asset.parentArtifactId)
  )) {
    return { ok: false, message: "输入资源父 artifact ID 无效。" };
  }
  if (asset.guidance !== undefined && (
    !Array.isArray(asset.guidance) ||
    asset.guidance.some((item) => !SKETCH_GUIDANCE_KEYS.includes(item as (typeof SKETCH_GUIDANCE_KEYS)[number]))
  )) {
    return { ok: false, message: "输入资源 Sketch 引导设置无效。" };
  }
  return { ok: true };
}

function hasOpenAIParamsShape(params: unknown): boolean {
  if (!isRecord(params)) return false;
  const providerKind = paramsProviderKind(params);
  const launchId = paramsLaunchId(params);
  return (providerKind === undefined || providerKind === "openai") &&
    (launchId === undefined || launchId === GPT_IMAGE_2_LAUNCH_ID || launchId === GPT_IMAGE_2_5_LAUNCH_ID);
}

function hasGeminiParamsShape(params: unknown): boolean {
  if (!isRecord(params)) return false;
  const providerKind = paramsProviderKind(params);
  const launchId = paramsLaunchId(params);
  return launchId === NANO_BANANA_3_LAUNCH_ID || (providerKind === "gemini" && launchId !== GENERAL_LAUNCH_ID);
}

function hasGeneralParamsShape(params: unknown): boolean {
  if (!isRecord(params)) return false;
  return paramsLaunchId(params) === GENERAL_LAUNCH_ID;
}

function validateRunJobRequestBase(request: unknown): ValidationResult {
  if (!isRecord(request)) {
    return { ok: false, message: "任务请求格式无效。" };
  }
  if (request.mode !== "generate" && request.mode !== "edit" && request.mode !== "inpaint") {
    return { ok: false, message: "任务模式无效。" };
  }
  if (typeof request.prompt !== "string") {
    return { ok: false, message: "Prompt 格式无效。" };
  }
  if (!Array.isArray(request.inputPaths) || request.inputPaths.some((item) => typeof item !== "string")) {
    return { ok: false, message: "输入图片路径无效。" };
  }
  if (request.inputPaths.some((item) => !IMAGE_PATH_PATTERN.test(item))) {
    return { ok: false, message: "输入图片必须是 PNG、JPEG 或 WebP。" };
  }
  const workflow = request.workflow;
  if (workflow !== undefined && workflow !== "standard" && workflow !== "sketch") {
    return { ok: false, message: "图片工作流无效。" };
  }
  if (workflow === "standard" && request.sketch !== undefined) {
    return { ok: false, message: "standard 工作流不能携带 Sketch metadata。" };
  }
  if (workflow !== "sketch" && request.sketch !== undefined) {
    return { ok: false, message: "Sketch metadata 需要使用 sketch 工作流。" };
  }
  if (workflow === "sketch") {
    if (request.mode !== "edit") return { ok: false, message: "Sketch 工作流必须使用 edit 模式。" };
    if (request.inputPaths.length === 0) return { ok: false, message: "Sketch 工作流至少需要一张输入图。" };
    if (request.maskPath || request.maskDataUrl) return { ok: false, message: "Sketch 工作流不能携带 mask。" };
    const sketchValidation = validateSketchTaskMetadata(request.sketch);
    if (!sketchValidation.ok) return sketchValidation;
  }
  return { ok: true };
}

export function validateOpenAIRunJobRequest(request: unknown): ValidationResult {
  const base = validateRunJobRequestBase(request);
  if (!base.ok) return base;
  if (!isRecord(request)) {
    return { ok: false, message: "任务请求格式无效。" };
  }
  const inputPaths = request.inputPaths as string[];
  if (inputPaths.length > MAX_GPT_IMAGE_INPUTS) {
    return { ok: false, message: `GPT Image 2 输入图片不能超过 ${MAX_GPT_IMAGE_INPUTS} 张。` };
  }
  if (request.mode === "generate" && inputPaths.length > 0) {
    return { ok: false, message: "文生图不应携带输入图片。" };
  }
  if ((request.mode === "edit" || request.mode === "inpaint") && inputPaths.length === 0) {
    return { ok: false, message: request.mode === "inpaint" ? "局部重绘至少需要一张源图。" : "图像编辑至少需要一张源图。" };
  }
  if (request.maskPath !== undefined && typeof request.maskPath !== "string") {
    return { ok: false, message: "Mask 路径无效。" };
  }
  if (typeof request.maskPath === "string" && request.maskPath && !/\.(png|webp)$/i.test(request.maskPath)) {
    return { ok: false, message: "Mask 必须是 PNG 或 WebP。" };
  }
  if (request.maskDataUrl !== undefined && typeof request.maskDataUrl !== "string") {
    return { ok: false, message: "Mask 数据无效。" };
  }
  if (typeof request.maskDataUrl === "string" && request.maskDataUrl) {
    const maskMimeType = mimeTypeFromDataUrl(request.maskDataUrl);
    if (!maskMimeType) {
      return { ok: false, message: "Mask 数据必须是 PNG 或 WebP data URL。" };
    }
    const maskType = validateMaskMimeType(maskMimeType);
    if (!maskType.ok) return maskType;
  }
  const hasMask = Boolean(request.maskPath || request.maskDataUrl);
  if (request.mode !== "inpaint" && hasMask) {
    return { ok: false, message: "只有局部重绘可以携带 mask。" };
  }
  if (request.mode === "inpaint" && !hasMask) {
    return { ok: false, message: "局部重绘需要提供 mask。" };
  }
  if (isRecord(request) && request.workflow === "sketch" && inputPaths.length > MAX_GPT_IMAGE_INPUTS) {
    return { ok: false, message: `Sketch 输入图片不能超过 ${MAX_GPT_IMAGE_INPUTS} 张。` };
  }
  return validateOpenAIImageParams(request.params);
}

export function validateGeminiRunJobRequest(request: unknown): ValidationResult {
  const base = validateRunJobRequestBase(request);
  if (!base.ok) return base;
  if (!isRecord(request)) {
    return { ok: false, message: "任务请求格式无效。" };
  }
  const inputPaths = request.inputPaths as string[];
  if (request.mode === "generate" && inputPaths.length > 0) {
    return { ok: false, message: "文生图不应携带输入图片。" };
  }
  if ((request.mode === "edit" || request.mode === "inpaint") && inputPaths.length === 0) {
    return { ok: false, message: request.mode === "inpaint" ? "局部重绘至少需要一张源图。" : "图像编辑至少需要一张源图。" };
  }
  if (request.maskPath !== undefined && typeof request.maskPath !== "string") {
    return { ok: false, message: "Mask 路径无效。" };
  }
  if (typeof request.maskPath === "string" && request.maskPath && !/\.(png|webp)$/i.test(request.maskPath)) {
    return { ok: false, message: "Mask 必须是 PNG 或 WebP。" };
  }
  if (request.maskDataUrl !== undefined && typeof request.maskDataUrl !== "string") {
    return { ok: false, message: "Mask 数据无效。" };
  }
  if (typeof request.maskDataUrl === "string" && request.maskDataUrl) {
    const maskMimeType = mimeTypeFromDataUrl(request.maskDataUrl);
    if (!maskMimeType) {
      return { ok: false, message: "Mask 数据必须是 PNG 或 WebP data URL。" };
    }
    const maskType = validateMaskMimeType(maskMimeType);
    if (!maskType.ok) return maskType;
  }
  const hasMask = Boolean(request.maskPath || request.maskDataUrl);
  if (request.mode !== "inpaint" && hasMask) {
    return { ok: false, message: "只有局部重绘可以携带 mask。" };
  }
  if (request.mode === "inpaint" && !hasMask) {
    return { ok: false, message: "局部重绘需要提供 mask。" };
  }
  if (isRecord(request) && request.workflow === "sketch" && inputPaths.length > 2) {
    return { ok: false, message: "Nano Banana 3 的 Sketch 最多携带 2 张参考图。" };
  }
  return validateGeminiImageParams(request.params);
}

export function validateGeneralRunJobRequest(request: unknown): ValidationResult {
  const base = validateRunJobRequestBase(request);
  if (!base.ok) return base;
  if (!isRecord(request)) {
    return { ok: false, message: "任务请求格式无效。" };
  }

  const params = validateGeneralImageParams(request.params);
  if (!params.ok) return params;
  if (!isGeneralImageParams(request.params)) {
    return { ok: false, message: "General 图片参数无效。" };
  }
  if (!isGeneralFallbackProvider(request.params.providerKind)) {
    return { ok: false, message: "当前 provider 暂未接入 General 运行时。" };
  }
  if (request.workflow === "sketch") {
    return { ok: false, message: "General 当前不支持 Sketch 输入。" };
  }
  if (!request.params.model.trim()) {
    return { ok: false, message: "请选择可用的图片模型。" };
  }

  const inputPaths = request.inputPaths as string[];
  if (request.mode === "inpaint") {
    return { ok: false, message: "General 首期不支持局部重绘。" };
  }
  if (request.maskPath || request.maskDataUrl) {
    return { ok: false, message: "General 首期不支持 mask 参数。" };
  }
  if (generalFallbackSupportsReferenceImages(request.params.providerKind)) {
    if (request.mode === "generate" && inputPaths.length > 0) {
      return { ok: false, message: "文生图不应携带输入图片。" };
    }
    if (request.mode === "edit" && inputPaths.length === 0) {
      return { ok: false, message: "基础参考图编辑至少需要一张参考图。" };
    }
    return { ok: true };
  }
  if (request.mode !== "generate" || inputPaths.length > 0) {
    return { ok: false, message: GENERAL_PROMPT_ONLY_MESSAGE };
  }
  return { ok: true };
}

export function validateRunJobRequest(request: unknown): ValidationResult {
  const base = validateRunJobRequestBase(request);
  if (!base.ok) return base;
  if (!isRecord(request)) {
    return { ok: false, message: "任务请求格式无效。" };
  }

  if (hasOpenAIParamsShape(request.params)) {
    return validateOpenAIRunJobRequest(request);
  }
  if (hasGeminiParamsShape(request.params)) {
    return validateGeminiRunJobRequest(request);
  }
  if (hasGeneralParamsShape(request.params)) {
    return validateGeneralRunJobRequest(request);
  }

  const params = validateImageParams(request.params);
  if (!params.ok) return params;
  return { ok: false, message: "当前版本尚未接入该模型运行时。" };
}

export function validateWorkspaceDraftInput(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, message: "草稿格式无效。" };
  }
  if (input.mode !== "generate" && input.mode !== "edit" && input.mode !== "inpaint") {
    return { ok: false, message: "草稿模式无效。" };
  }
  if (input.workflow !== undefined && input.workflow !== "standard" && input.workflow !== "sketch") {
    return { ok: false, message: "草稿工作流无效。" };
  }
  if (typeof input.prompt !== "string") {
    return { ok: false, message: "草稿 Prompt 无效。" };
  }
  if (!Array.isArray(input.inputAssets)) {
    return { ok: false, message: "草稿输入资源无效。" };
  }
  if (hasOpenAIParamsShape(input.params) && input.inputAssets.length > MAX_GPT_IMAGE_INPUTS) {
    return { ok: false, message: `草稿输入资源不能超过 ${MAX_GPT_IMAGE_INPUTS} 张。` };
  }
  for (const asset of input.inputAssets) {
    const assetValidation = validateInputAssetShape(asset);
    if (!assetValidation.ok) return assetValidation;
  }
  if (input.maskAsset !== undefined && input.maskAsset !== null) {
    const maskValidation = validateInputAssetShape(input.maskAsset);
    if (!maskValidation.ok) return maskValidation;
  }
  if (input.maskDataUrl !== undefined && typeof input.maskDataUrl !== "string") {
    return { ok: false, message: "草稿 Mask 数据无效。" };
  }
  if (input.sketchGuidance !== undefined && (
    !Array.isArray(input.sketchGuidance) ||
    input.sketchGuidance.some((item) => !SKETCH_GUIDANCE_KEYS.includes(item as (typeof SKETCH_GUIDANCE_KEYS)[number]))
  )) {
    return { ok: false, message: "草稿 Sketch 引导设置无效。" };
  }
  if (input.sketch !== undefined) {
    if (input.workflow !== "sketch") {
      return { ok: false, message: "Sketch 草稿需要使用 sketch 工作流。" };
    }
    if (input.mode !== "edit") {
      return { ok: false, message: "Sketch 草稿必须使用 edit 模式。" };
    }
    if (input.maskAsset || input.maskDataUrl) {
      return { ok: false, message: "Sketch 草稿不能携带 mask。" };
    }
    const sketchValidation = validateSketchDocument(input.sketch);
    if (!sketchValidation.ok) return sketchValidation;
  }
  if (input.workflow === "sketch" && input.sketch === undefined) {
    return { ok: false, message: "Sketch 草稿缺少文档。" };
  }
  if (input.workflow === "sketch" && input.params && isRecord(input.params) && input.params.launchId === GENERAL_LAUNCH_ID) {
    return { ok: false, message: "General 当前不支持 Sketch 草稿。" };
  }
  if (!isInteger(input.brushSize) || input.brushSize < 1) {
    return { ok: false, message: "画笔大小无效。" };
  }
  return validateImageParams(input.params);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function normalizeImageMimeType(mimeType?: string): string {
  const normalized = mimeType?.trim().toLowerCase() ?? "";
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

export function validateMaskMimeType(maskMimeType?: string): ValidationResult {
  const normalizedMask = normalizeImageMimeType(maskMimeType);
  if (!normalizedMask) return { ok: true };
  if (normalizedMask !== "image/png" && normalizedMask !== "image/webp") {
    return { ok: false, message: "Mask must be PNG or WebP with alpha." };
  }
  return { ok: true };
}

export function validateMaskSourceFormat(sourceMimeType?: string, maskMimeType?: string): ValidationResult {
  const normalizedSource = normalizeImageMimeType(sourceMimeType);
  const normalizedMask = normalizeImageMimeType(maskMimeType);
  if (!normalizedSource || !normalizedMask) return { ok: true };
  if (normalizedSource !== "image/png" && normalizedSource !== "image/webp") {
    return { ok: false, message: "Mask-based inpaint requires the first source image to be PNG or WebP." };
  }
  if (normalizedSource !== normalizedMask) {
    return { ok: false, message: "Mask format must match the first source image." };
  }
  return { ok: true };
}

export function mimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  return match ? normalizeImageMimeType(match[1]) : null;
}

export function maskMimeTypeForSource(sourceMimeType?: string): "image/png" | "image/webp" {
  return normalizeImageMimeType(sourceMimeType) === "image/webp" ? "image/webp" : "image/png";
}

export function shouldSendCompression(format: ImageFormat): boolean {
  return format === "jpeg" || format === "webp";
}

export function mimeTypeForFormat(format: ImageFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

export function extensionForFormat(format: ImageFormat): string {
  if (format === "jpeg") return "jpg";
  return format;
}

export function dataUrlToBase64(dataUrl: string): string {
  const marker = ";base64,";
  const index = dataUrl.indexOf(marker);
  if (index === -1) return dataUrl;
  return dataUrl.slice(index + marker.length);
}

export function stripTransientPreviewFromImageAsset(asset: ImageAsset): ImageAsset {
  if (!asset.transientPreview) return asset;
  const { transientPreview: _transientPreview, ...persistentAsset } = asset;
  return persistentAsset;
}

export function stripTransientPreviewsFromJob(job: GenerationJob): GenerationJob {
  if (!job.outputs.some((asset) => isImageAsset(asset) && asset.transientPreview)) return job;
  return {
    ...job,
    outputs: job.outputs.map((asset) => isImageAsset(asset) ? stripTransientPreviewFromImageAsset(asset) : asset)
  };
}

/**
 * History and Gallery persist only provider-final outputs. Partial frames are
 * progress artifacts owned by the queue and renderer; keeping them in the
 * durable job would make history grow with every streamed preview.
 */
export function stripTransientOutputsFromJob(job: GenerationJob): GenerationJob {
  const withoutTransientPreviews = stripTransientPreviewsFromJob(job);
  if (
    withoutTransientPreviews === job &&
    !job.outputs.some((asset) => asset.sourceType === "partial")
  ) {
    return withoutTransientPreviews;
  }
  return {
    ...withoutTransientPreviews,
    outputs: withoutTransientPreviews.outputs.filter((asset) => asset.sourceType !== "partial")
  };
}

export function getValidationError(params: ImageParams, prompt: string): string | null {
  const promptResult = validatePrompt(prompt);
  if (!promptResult.ok) return promptResult.message ?? "Prompt 无效。";
  if (isOpenAIImageParams(params)) {
    const paramResult = validateOpenAIImageParams(params);
    if (!paramResult.ok) return paramResult.message ?? "参数无效。";
    return null;
  }
  if (isGeminiImageParams(params)) {
    const paramResult = validateGeminiImageParams(params);
    if (!paramResult.ok) return paramResult.message ?? "参数无效。";
    return null;
  }
  if (isGeneralImageParams(params)) {
    const paramResult = validateGeneralImageParams(params);
    if (!paramResult.ok) return paramResult.message ?? "参数无效。";
    if (!isGeneralFallbackProvider(params.providerKind)) return "当前 provider 暂未接入 General 运行时。";
    if (!params.model.trim()) return "请选择可用的图片模型。";
    return null;
  }
  return "当前版本尚未接入该模型运行时。";
}
