import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_GEMINI_IMAGE_PARAMS,
  DEFAULT_GENERAL_IMAGE_PARAMS,
  GPT_IMAGE_2_5_QUALITY_OPTIONS,
  GENERAL_PROMPT_ONLY_MESSAGE,
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
  stripTransientPreviewsFromJob,
  validateApiKey,
  shouldSendCompression,
  validateGptImage2Size,
  validateImageParams,
  validateMaskMimeType,
  validateMaskSourceFormat,
  validateGeneralRunJobRequest,
  validateProviderConfigInput,
  validateRunJobRequest,
  validateWorkspaceDraftInput
} from "./validation";
import {
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID
} from "./modelCatalog";
import type { GenerationJob } from "./types";
import type { SketchDocument } from "./types";
import { sketchDocumentHash } from "./sketch";

describe("gpt-image-2 validation", () => {
  it("accepts auto and supported popular sizes", () => {
    expect(validateGptImage2Size("auto").ok).toBe(true);
    expect(validateGptImage2Size("1024x1024").ok).toBe(true);
    expect(validateGptImage2Size("1536x1024").ok).toBe(true);
    expect(validateGptImage2Size("1536x864").ok).toBe(true);
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

  it("validates GPT Image 2.5 controls and disallows Chat Completions", () => {
    const base = {
      ...DEFAULT_IMAGE_PARAMS,
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      quality: "max" as const,
      background: "transparent" as const,
      outputFormat: "webp" as const,
      inputFidelity: "high" as const,
      imageRoute: "responses" as const
    };
    expect(validateImageParams(base).ok).toBe(true);
    expect(GPT_IMAGE_2_5_QUALITY_OPTIONS).toContain(base.quality);
    expect(validateImageParams({ ...base, imageRoute: "chat-completions" }).ok).toBe(false);
    expect(validateImageParams({ ...base, background: "transparent", outputFormat: "jpeg" }).ok).toBe(false);
    expect(validateImageParams({ ...base, inputFidelity: "high", model: "gpt-image-2" }).ok).toBe(false);
    expect(validateImageParams({ ...base, responsesAction: "auto" }).ok).toBe(true);
    expect(validateImageParams({ ...base, responsesAction: "invalid" } as unknown as typeof base).ok).toBe(false);
    expect(validateImageParams({ ...base, imageRoute: "image-api", responsesAction: "edit" }).ok).toBe(false);
    expect(validateImageParams({ ...base, imageRoute: "image-api", responsesModel: "gpt-6-astra" }).ok).toBe(false);
    expect(validateImageParams({ ...base, inputImageDetail: "original" as const, previousImageGenerationCallId: "ig_previous" }).ok).toBe(true);
    expect(validateImageParams({ ...base, previousResponseId: "resp_previous", previousImageGenerationCallId: "ig_previous" }).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, responsesAction: "auto" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, responsesModel: "gpt-6-astra" }).ok).toBe(false);
    expect(validateImageParams({ ...base, user: "user_hash_123" }).ok).toBe(true);
    expect(validateImageParams({ ...base, user: "   " }).ok).toBe(false);
    expect(validateImageParams({ ...base, user: "u".repeat(64) }).ok).toBe(true);
    expect(validateImageParams({ ...base, user: "u".repeat(65) }).ok).toBe(false);
  });

  it("rejects Responses-only controls when batch generation requests multiple images", () => {
    expect(validateImageParams({
      ...DEFAULT_IMAGE_PARAMS,
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      n: 2,
      responsesAction: "generate"
    }).ok).toBe(false);
  });

  it("rejects invalid enum-like params from runtime state or IPC", () => {
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, imageRoute: "chat-completions" }).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, imageRoute: "responses" }).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, imageRoute: "image-api" }).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, quality: "standard" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, imageRoute: "legacy-images" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, outputFormat: "gif" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, background: "transparent" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, moderation: "strict" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, referenceImageMode: "silent-compress" } as unknown as typeof DEFAULT_IMAGE_PARAMS).ok).toBe(false);
  });

  it("validates provider-specific image param union members", () => {
    expect(validateImageParams(DEFAULT_IMAGE_PARAMS).ok).toBe(true);
    expect(validateImageParams(DEFAULT_GEMINI_IMAGE_PARAMS).ok).toBe(true);
    expect(validateImageParams(DEFAULT_GENERAL_IMAGE_PARAMS).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "gemini", model: "gemini-3-pro-image" }).ok).toBe(true);
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
    expect(getValidationError(DEFAULT_GEMINI_IMAGE_PARAMS, "Make a compact icon set")).toBeNull();
    expect(getValidationError({ ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "openai", model: "dall-e-3" }, "Make a compact icon set")).toBeNull();
    expect(getValidationError({ ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "custom", model: "flux-pro" }, "Make a compact icon set")).toBeNull();
    expect(getValidationError(DEFAULT_GENERAL_IMAGE_PARAMS, "Make a compact icon set")).toContain("请选择");
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
    expect(validateProviderConfigInput({ ...valid, kind: "openai", defaultModel: "dall-e-3", activeLaunchId: "general", activeModelId: "dall-e-3" }).ok).toBe(true);
    expect(validateProviderConfigInput({ ...valid, kind: "openai", defaultModel: NANO_BANANA_3_MODEL_ID, activeLaunchId: NANO_BANANA_3_LAUNCH_ID, activeModelId: NANO_BANANA_3_MODEL_ID }).ok).toBe(true);
    expect(validateProviderConfigInput({ ...valid, kind: "openai", defaultModel: "dall-e-3", activeLaunchId: "gpt-image-2", activeModelId: "dall-e-3" }).ok).toBe(false);
    expect(validateProviderConfigInput({ ...valid, kind: "gemini", defaultModel: "gemini-3.1-flash-image", activeLaunchId: "nano-banana-3" }).ok).toBe(true);
    expect(validateProviderConfigInput({ ...valid, kind: "custom", defaultModel: "image-model-x", activeLaunchId: "general" }).ok).toBe(true);
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
    expect(validateRunJobRequest({ ...job, params: DEFAULT_GEMINI_IMAGE_PARAMS }).ok).toBe(true);
    expect(validateRunJobRequest({ ...job, params: DEFAULT_GEMINI_IMAGE_PARAMS, inputPaths: ["/tmp/a.png"] }).ok).toBe(false);
    expect(validateRunJobRequest({ ...job, params: DEFAULT_GEMINI_IMAGE_PARAMS, mode: "edit", inputPaths: ["/tmp/a.png"] }).ok).toBe(true);
    expect(
      validateRunJobRequest({
        ...job,
        params: DEFAULT_GEMINI_IMAGE_PARAMS,
        mode: "inpaint",
        inputPaths: ["/tmp/a.jpg"],
        maskPath: "/tmp/mask.png"
      }).ok
    ).toBe(true);
    expect(
      validateRunJobRequest({
        ...job,
        params: DEFAULT_GEMINI_IMAGE_PARAMS,
        mode: "edit",
        inputPaths: ["/tmp/a.png"],
        maskPath: "/tmp/mask.png"
      }).ok
    ).toBe(false);
    expect(validateRunJobRequest({ ...job, params: DEFAULT_GENERAL_IMAGE_PARAMS })).toMatchObject({
      ok: false,
      message: "请选择可用的图片模型。"
    });
    expect(validateRunJobRequest({ ...job, params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "openai", model: "dall-e-3" } }).ok).toBe(true);
    expect(
      validateRunJobRequest({
        ...job,
        mode: "edit",
        inputPaths: ["/tmp/a.png"],
        params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "openai", model: "dall-e-3" }
      })
    ).toMatchObject({
      ok: false,
      message: GENERAL_PROMPT_ONLY_MESSAGE
    });
    expect(validateRunJobRequest({ ...job, params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "custom", model: "flux-pro" } }).ok).toBe(true);
    expect(validateRunJobRequest({ ...job, params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "gemini", model: "gemini-3-pro-image" } }).ok).toBe(true);
    expect(validateGeneralRunJobRequest({ ...job, params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "gemini", model: "gemini-3-pro-image" }, mode: "edit" })).toMatchObject({
      ok: false,
      message: "基础参考图编辑至少需要一张参考图。"
    });
    expect(
      validateGeneralRunJobRequest({
        ...job,
        params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "gemini", model: "gemini-3-pro-image" },
        mode: "inpaint",
        inputPaths: ["/tmp/a.png"],
        maskPath: "/tmp/mask.png"
      })
    ).toMatchObject({ ok: false, message: "General 首期不支持局部重绘。" });
    expect(
      validateGeneralRunJobRequest({
        ...job,
        params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "gemini", model: "gemini-3-pro-image" },
        mode: "edit",
        inputPaths: Array.from({ length: MAX_GPT_IMAGE_INPUTS + 1 }, (_, index) => `/tmp/${index}.png`)
      }).ok
    ).toBe(true);
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

  it("keeps Sketch as an edit-only input workflow and rejects General or masks", () => {
    const document: SketchDocument = {
      schemaVersion: 1,
      width: 1024,
      height: 1024,
      background: "white",
      strokes: [{
        id: "stroke_1",
        tool: "brush",
        color: "#1f2937",
        size: 8,
        opacity: 1,
        points: [{ x: 10, y: 10 }, { x: 200, y: 200 }]
      }]
    };
    const sketch = {
      artifactId: "sketch_1",
      width: document.width,
      height: document.height,
      background: document.background,
      strokeCount: 1,
      pointCount: 2,
      documentHash: sketchDocumentHash(document)
    };
    const request = {
      mode: "edit" as const,
      workflow: "sketch" as const,
      prompt: "Turn this sketch into a polished illustration.",
      inputPaths: ["/tmp/sketch_1.png"],
      params: DEFAULT_IMAGE_PARAMS,
      sketch
    };

    expect(validateRunJobRequest(request).ok).toBe(true);
    expect(validateRunJobRequest({ ...request, mode: "inpaint" }).ok).toBe(false);
    expect(validateRunJobRequest({ ...request, maskPath: "/tmp/mask.png" }).ok).toBe(false);
    expect(validateRunJobRequest({
      ...request,
      params: DEFAULT_GEMINI_IMAGE_PARAMS,
      inputPaths: ["/tmp/sketch_1.png"],
      sketch
    }).ok).toBe(true);
    expect(validateRunJobRequest({
      ...request,
      params: { ...DEFAULT_GENERAL_IMAGE_PARAMS, providerKind: "openai", model: "dall-e-3" },
      sketch
    }).ok).toBe(false);
    expect(validateWorkspaceDraftInput({
      mode: "edit",
      workflow: "sketch",
      prompt: "draft",
      params: DEFAULT_IMAGE_PARAMS,
      inputAssets: [],
      sketch: document,
      brushSize: 24
    }).ok).toBe(true);
    expect(validateWorkspaceDraftInput({
      mode: "edit",
      workflow: "standard",
      prompt: "draft",
      params: DEFAULT_IMAGE_PARAMS,
      inputAssets: [],
      sketch: document,
      brushSize: 24
    }).ok).toBe(false);
  });

  it("strips transient previews from generated jobs before persistence", () => {
    const job = {
      id: "job_test",
      name: "result.png",
      tags: [],
      providerKind: "openai",
      providerId: "default",
      launchId: "gpt-image-2",
      modelId: "gpt-image-2",
      modelDisplayName: "GPT Image 2",
      mode: "generate",
      prompt: "prompt",
      inputAssets: [],
      params: DEFAULT_IMAGE_PARAMS,
      status: "succeeded",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      outputs: [
        {
          id: "img_result",
          jobId: "job_test",
          path: "/tmp/result.png",
          fileName: "result.png",
          mimeType: "image/png",
          sourceType: "result",
          createdAt: new Date(0).toISOString(),
          transientPreview: {
            dataUrl: "data:image/png;base64,abc123"
          }
        }
      ]
    } satisfies GenerationJob;

    const stripped = stripTransientPreviewsFromJob(job);

    expect(stripped.outputs[0]).not.toHaveProperty("transientPreview");
    expect(stripped.outputs[0].path).toBe("/tmp/result.png");
    expect(JSON.stringify(stripped)).not.toContain("data:image/png;base64");
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
