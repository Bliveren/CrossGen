import type { ImageFormat, ImageParams } from "./types.js";

export const GPT_IMAGE_2_MODEL = "gpt-image-2";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  model: GPT_IMAGE_2_MODEL,
  size: "auto",
  quality: "auto",
  outputFormat: "png",
  outputCompression: 100,
  background: "auto",
  n: 1,
  stream: true,
  partialImages: 2,
  moderation: "auto",
  timeoutMs: 240000
};

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function normalizeBaseURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URL;
}

export function redactSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function validateApiKey(value: string): ValidationResult {
  if (!value.trim()) {
    return { ok: false, message: "API Key 不能为空。" };
  }
  if (value.trim().length < 12) {
    return { ok: false, message: "API Key 看起来过短。" };
  }
  return { ok: true };
}

export function validatePrompt(value: string): ValidationResult {
  const length = value.trim().length;
  if (length === 0) {
    return { ok: false, message: "请输入 prompt。" };
  }
  if (length > 32000) {
    return { ok: false, message: "GPT Image prompt 不能超过 32000 字符。" };
  }
  return { ok: true };
}

export function parseImageSize(size: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

export function validateGptImage2Size(size: string): ValidationResult {
  if (size === "auto") return { ok: true };
  const parsed = parseImageSize(size);
  if (!parsed) {
    return { ok: false, message: "尺寸需使用 auto 或 WIDTHxHEIGHT，例如 1536x1024。" };
  }
  const { width, height } = parsed;
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, message: "GPT Image 2 要求宽高都是 16 的倍数。" };
  }
  if (Math.max(width, height) > 3840) {
    return { ok: false, message: "GPT Image 2 最长边不能超过 3840px。" };
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 3) {
    return { ok: false, message: "GPT Image 2 长短边比例不能超过 3:1。" };
  }
  const pixels = width * height;
  if (pixels < 655360 || pixels > 8294400) {
    return { ok: false, message: "GPT Image 2 总像素需在 655,360 到 8,294,400 之间。" };
  }
  return { ok: true };
}

export function validateImageParams(params: ImageParams): ValidationResult {
  if (params.model.trim() !== GPT_IMAGE_2_MODEL) {
    return { ok: false, message: `MVP 仅支持 ${GPT_IMAGE_2_MODEL}。` };
  }
  const size = validateGptImage2Size(params.size);
  if (!size.ok) return size;
  if (params.n < 1 || params.n > 10) {
    return { ok: false, message: "生成数量需在 1 到 10 之间。" };
  }
  if (params.partialImages < 0 || params.partialImages > 3) {
    return { ok: false, message: "partial_images 需在 0 到 3 之间。" };
  }
  if (params.timeoutMs < 30000 || params.timeoutMs > 600000) {
    return { ok: false, message: "超时时间需在 30 到 600 秒之间。" };
  }
  if (params.outputCompression < 0 || params.outputCompression > 100) {
    return { ok: false, message: "压缩率需在 0 到 100 之间。" };
  }
  return { ok: true };
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

export function getValidationError(params: ImageParams, prompt: string): string | null {
  const promptResult = validatePrompt(prompt);
  if (!promptResult.ok) return promptResult.message ?? "Prompt 无效。";
  const paramResult = validateImageParams(params);
  if (!paramResult.ok) return paramResult.message ?? "参数无效。";
  return null;
}
