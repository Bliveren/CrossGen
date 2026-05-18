import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PARAMS,
  dataUrlToBase64,
  extensionForFormat,
  getValidationError,
  maskMimeTypeForSource,
  mimeTypeForFormat,
  mimeTypeFromDataUrl,
  normalizeBaseURL,
  normalizeImageMimeType,
  redactSecret,
  validateApiKey,
  shouldSendCompression,
  validateGptImage2Size,
  validateImageParams,
  validateMaskMimeType,
  validateMaskSourceFormat
} from "./validation";

describe("gpt-image-2 validation", () => {
  it("accepts auto and supported popular sizes", () => {
    expect(validateGptImage2Size("auto").ok).toBe(true);
    expect(validateGptImage2Size("1024x1024").ok).toBe(true);
    expect(validateGptImage2Size("1536x1024").ok).toBe(true);
    expect(validateGptImage2Size("3840x2160").ok).toBe(true);
  });

  it("rejects sizes that violate gpt-image-2 constraints", () => {
    expect(validateGptImage2Size("1000x1000").ok).toBe(false);
    expect(validateGptImage2Size("4096x1024").ok).toBe(false);
    expect(validateGptImage2Size("1024x256").ok).toBe(false);
    expect(validateGptImage2Size("512x512").ok).toBe(false);
  });

  it("limits partial images and model choice", () => {
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, partialImages: 3 }).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, partialImages: 4 }).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, model: "gpt-image-1.5" }).ok).toBe(false);
  });

  it("rejects invalid enum-like params from runtime state or IPC", () => {
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, quality: "standard" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, outputFormat: "gif" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, background: "transparent" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, moderation: "strict" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
  });

  it("normalizes base URLs and compression behavior", () => {
    expect(normalizeBaseURL("https://api.openai.com/v1///")).toBe("https://api.openai.com/v1");
    expect(shouldSendCompression("png")).toBe(false);
    expect(shouldSendCompression("jpeg")).toBe(true);
    expect(shouldSendCompression("webp")).toBe(true);
  });

  it("validates prompt and API key inputs", () => {
    expect(validateApiKey("").ok).toBe(false);
    expect(validateApiKey("short").ok).toBe(false);
    expect(validateApiKey("sk-test-key-that-is-long-enough").ok).toBe(true);
    expect(getValidationError(DEFAULT_IMAGE_PARAMS, "")).toContain("prompt");
    expect(getValidationError(DEFAULT_IMAGE_PARAMS, "Make a compact icon set")).toBeNull();
  });

  it("maps formats and strips data URL prefixes", () => {
    expect(mimeTypeForFormat("png")).toBe("image/png");
    expect(mimeTypeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeTypeForFormat("webp")).toBe("image/webp");
    expect(extensionForFormat("jpeg")).toBe("jpg");
    expect(dataUrlToBase64("data:image/png;base64,abc123")).toBe("abc123");
    expect(dataUrlToBase64("abc123")).toBe("abc123");
  });

  it("validates mask MIME type and source format compatibility", () => {
    expect(normalizeImageMimeType(" image/JPG ")).toBe("image/jpeg");
    expect(validateMaskMimeType("image/png").ok).toBe(true);
    expect(validateMaskMimeType("image/webp").ok).toBe(true);
    expect(validateMaskMimeType("image/jpeg").ok).toBe(false);
    expect(validateMaskSourceFormat("image/png", "image/png").ok).toBe(true);
    expect(validateMaskSourceFormat("image/jpeg", "image/jpg").ok).toBe(false);
    expect(validateMaskSourceFormat("image/webp", "image/png").ok).toBe(false);
    expect(validateMaskSourceFormat("image/jpeg", "image/png").ok).toBe(false);
    expect(mimeTypeFromDataUrl("data:image/webp;base64,abc123")).toBe("image/webp");
    expect(mimeTypeFromDataUrl("abc123")).toBeNull();
    expect(maskMimeTypeForSource("image/webp")).toBe("image/webp");
    expect(maskMimeTypeForSource("image/jpeg")).toBe("image/png");
  });

  it("redacts secrets without leaking middle content", () => {
    expect(redactSecret("")).toBe("");
    expect(redactSecret("12345678")).toBe("****");
    expect(redactSecret("sk-abcdefghijklmnopqrstuvwxyz")).toBe("sk-a...wxyz");
  });
});
