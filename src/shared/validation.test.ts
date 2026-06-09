import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_GEMINI_IMAGE_PARAMS,
  DEFAULT_GENERAL_IMAGE_PARAMS,
  MAX_GPT_IMAGE_INPUTS,
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
  validateMaskSourceFormat,
  validateProviderConfigInput,
  validateRunJobRequest,
  validateWorkspaceDraftInput
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

  it("validates provider-specific image param union members", () => {
    expect(validateImageParams(DEFAULT_IMAGE_PARAMS).ok).toBe(true);
    expect(validateImageParams(DEFAULT_GEMINI_IMAGE_PARAMS).ok).toBe(true);
    expect(validateImageParams(DEFAULT_GENERAL_IMAGE_PARAMS).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_GEMINI_IMAGE_PARAMS, aspectRatio: "2:1" }).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_GEMINI_IMAGE_PARAMS, outputCount: 2 }).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_GENERAL_IMAGE_PARAMS, outputCount: 2 }).ok).toBe(false);
  });

  it("rejects malformed runtime params without throwing", () => {
    expect(validateImageParams(null as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, model: null } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, size: null } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, stream: "true" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, n: Number.NaN } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, partialImages: Number.POSITIVE_INFINITY } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, timeoutMs: Number.NaN } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, outputCompression: Number.NEGATIVE_INFINITY } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, n: 1.5 } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, partialImages: 1.5 } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, timeoutMs: 30000.5 } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, outputCompression: 50.5 } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
  });

  it("normalizes base URLs and compression behavior", () => {
    expect(normalizeBaseURL("https://api.openai.com/v1///")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseURL("https://proxy.example.com//v1")).toBe("https://proxy.example.com/v1");
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
    expect(getValidationError(DEFAULT_GEMINI_IMAGE_PARAMS, "Make a compact icon set")).toContain("尚未接入");
    expect(getValidationError(DEFAULT_GENERAL_IMAGE_PARAMS, "Make a compact icon set")).toContain("尚未接入");
  });

  it("rejects malformed prompt, API key, and base URL runtime inputs", () => {
    expect(validateApiKey(null).ok).toBe(false);
    expect(getValidationError(DEFAULT_IMAGE_PARAMS, null as unknown as string)).toContain("Prompt");
    expect(normalizeBaseURL(null)).toBe("https://api.openai.com/v1");
    expect(redactSecret(null)).toBe("");
    expect(validateGptImage2Size(null).ok).toBe(false);
  });

  it("validates provider config input from IPC before persistence", () => {
    const valid = {
      baseURL: "https://api.openai.com/v1",
      defaultModel: "gpt-image-2",
      defaultSize: "1024x1024",
      defaultQuality: "auto",
      timeoutMs: 240000
    };

    expect(validateProviderConfigInput(valid).ok).toBe(true);
    expect(validateProviderConfigInput({ ...valid, kind: "openai", activeLaunchId: "gpt-image-2", activeModelId: "gpt-image-2" }).ok).toBe(true);
    expect(validateProviderConfigInput(null as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, kind: "anthropic" } as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, baseURL: null } as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, defaultModel: "gpt-image-1.5" } as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, defaultSize: "512x512" } as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, defaultQuality: "standard" } as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, timeoutMs: Number.NaN } as never).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, apiKey: null } as never).ok).toBe(false);
  });

  it("validates job and draft IPC request shapes", () => {
    const job = {
      mode: "generate",
      prompt: "Prompt",
      inputPaths: [],
      params: DEFAULT_IMAGE_PARAMS
    };
    const draft = {
      mode: "edit",
      prompt: "Draft prompt",
      params: DEFAULT_IMAGE_PARAMS,
      inputAssets: [],
      brushSize: 72
    };

    expect(validateRunJobRequest(job).ok).toBe(true);
    expect(validateWorkspaceDraftInput(draft).ok).toBe(true);
    expect(validateRunJobRequest(null).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "compose" } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, prompt: null } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, inputPaths: ["a.png", 1] } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, maskPath: 123 } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, maskDataUrl: 123 } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, params: { ...DEFAULT_IMAGE_PARAMS, n: 1.5 } } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, inputPaths: ["/tmp/a.png"] } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, maskPath: "/tmp/mask.png" } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "edit", inputPaths: [] } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "edit", inputPaths: ["/tmp/a.png"] } as never).ok).toBe(true);
    expect(validateRunJobRequest({ ...job, mode: "edit", inputPaths: ["/tmp/a.txt"] } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "edit", inputPaths: ["/tmp/a.png"], maskPath: "/tmp/mask.png" } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "inpaint", inputPaths: ["/tmp/a.png"] } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "inpaint", inputPaths: ["/tmp/a.png"], maskPath: "/tmp/mask.jpg" } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "inpaint", inputPaths: ["/tmp/a.png"], maskPath: "/tmp/mask.png" } as never).ok).toBe(true);
    expect(validateRunJobRequest({ ...job, mode: "inpaint", inputPaths: ["/tmp/a.png"], maskDataUrl: "data:image/png;base64,abc" } as never).ok).toBe(true);
    expect(validateRunJobRequest({ ...job, mode: "inpaint", inputPaths: ["/tmp/a.png"], maskDataUrl: "data:image/jpeg;base64,abc" } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, mode: "inpaint", inputPaths: ["/tmp/a.png"], maskDataUrl: "not-a-data-url" } as never).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, params: DEFAULT_GEMINI_IMAGE_PARAMS })).toMatchObject({
      ok: false,
      message: "当前版本尚未接入该模型运行时。"
    });
    expect(validateRunJobRequest({ ...job, params: DEFAULT_GENERAL_IMAGE_PARAMS })).toMatchObject({
      ok: false,
      message: "当前版本尚未接入该模型运行时。"
    });
    expect(
      validateRunJobRequest({
        ...job,
        mode: "edit",
        inputPaths: Array.from({ length: MAX_GPT_IMAGE_INPUTS }, (_, index) => `/tmp/${index}.png`)
      }).ok
    ).toBe(true);
    expect(
      validateRunJobRequest({
        ...job,
        mode: "edit",
        inputPaths: Array.from({ length: MAX_GPT_IMAGE_INPUTS + 1 }, (_, index) => `/tmp/${index}.png`)
      }).ok
    ).toBe(false);
    expect(validateWorkspaceDraftInput(null).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, mode: "compose" } as never).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, prompt: null } as never).ok).toBe(false);
    expect(
      validateWorkspaceDraftInput({
        ...draft,
        inputAssets: Array.from({ length: MAX_GPT_IMAGE_INPUTS }, (_, index) => ({
          id: String(index),
          name: "a.png",
          path: "/tmp/a.png",
          mimeType: "image/png",
          sizeBytes: 1
        }))
      }).ok
    ).toBe(true);
    expect(
      validateWorkspaceDraftInput({
        ...draft,
        inputAssets: Array.from({ length: MAX_GPT_IMAGE_INPUTS + 1 }, (_, index) => ({
          id: String(index),
          name: "a.png",
          path: "/tmp/a.png",
          mimeType: "image/png",
          sizeBytes: 1
        }))
      }).ok
    ).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, inputAssets: [1] } as never).ok).toBe(false);
    const asset = {
      id: "1",
      name: "a.png",
      path: "/tmp/a.png",
      mimeType: "image/png",
      sizeBytes: 1
    };
    expect(validateWorkspaceDraftInput({ ...draft, inputAssets: [{ ...asset, dataUrl: 123 }] } as never).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, inputAssets: [{ ...asset, width: 0 }] } as never).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, inputAssets: [{ ...asset, height: 1.5 }] } as never).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, maskAsset: { id: 1 } } as never).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, maskDataUrl: 123 } as never).ok).toBe(false);
    expect(validateWorkspaceDraftInput({ ...draft, brushSize: 0 } as never).ok).toBe(false);
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
