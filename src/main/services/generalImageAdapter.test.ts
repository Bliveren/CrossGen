import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeneralImageParams, GenerationJob, JobProgressEvent, ProviderKind } from "../../shared/types";
import { DEFAULT_GENERAL_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS, DEFAULT_GEMINI_IMAGE_PARAMS, GENERAL_PROMPT_ONLY_MESSAGE } from "../../shared/validation";
import { buildOpenAICompatibleGeneralRequestBody, generalImageAdapter, runGeneralImageJob } from "./generalImageAdapter";
import type { StoredProviderConfig } from "./stateMigration";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";

let tmpDir: string | null = null;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

function job(providerKind: ProviderKind = "gemini", model = "gemini-3-pro-image", patch: Partial<GenerationJob> = {}): GenerationJob {
  const now = new Date(0).toISOString();
  return {
    id: "job_general_test",
    name: "general.png",
    tags: [],
    providerKind,
    providerId: providerKind,
    launchId: "general",
    modelId: model,
    modelDisplayName: model,
    mode: "generate",
    prompt: "Make a clean product render",
    inputAssets: [],
    params: {
      ...DEFAULT_GENERAL_IMAGE_PARAMS,
      providerKind,
      model,
      timeoutMs: 30000
    },
    status: "queued",
    createdAt: now,
    updatedAt: now,
    outputs: [],
    ...patch
  };
}

function config(providerKind: ProviderKind = "gemini", model = "gemini-3-pro-image", patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  const now = new Date(0).toISOString();
  return {
    id: providerKind,
    kind: providerKind,
    name: providerKind,
    baseURL: providerKind === "gemini" ? "https://api.test/v1beta" : "https://api.test/v1",
    enabled: true,
    defaultModel: model,
    defaultSize: DEFAULT_IMAGE_PARAMS.size,
    defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
    timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
    discoveredModels: [],
    activeLaunchId: "general",
    activeModelId: model,
    updatedAt: now,
    encryption: "none",
    ...patch
  };
}

async function createRuntime(fetchImpl: typeof fetch) {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-general-"));
  const events: JobProgressEvent[] = [];
  return {
    runtime: {
      fetch: fetchImpl,
      imagesDir: tmpDir,
      ensureDir: async (dirPath: string) => {
        await import("node:fs/promises").then((fs) => fs.mkdir(dirPath, { recursive: true }));
      },
      sendJobEvent: (event: JobProgressEvent) => events.push(event)
    },
    events
  };
}

describe("General image adapter", () => {
  it("validates the minimal General request envelope", () => {
    expect(generalImageAdapter.validateJob({ mode: "generate", prompt: "Prompt", inputPaths: [], params: job().params }).ok).toBe(true);
    expect(generalImageAdapter.validateJob({ mode: "inpaint", prompt: "Prompt", inputPaths: ["/tmp/a.png"], maskPath: "/tmp/mask.png", params: job().params })).toMatchObject({
      ok: false,
      message: "General 首期不支持局部重绘。"
    });
    expect(generalImageAdapter.validateJob({ mode: "generate", prompt: "Prompt", inputPaths: [], params: job("openai", "dall-e-3").params }).ok).toBe(true);
    expect(generalImageAdapter.validateJob({ mode: "generate", prompt: "Prompt", inputPaths: [], params: job("custom", "flux-pro").params }).ok).toBe(true);
    expect(generalImageAdapter.validateJob({ mode: "edit", prompt: "Prompt", inputPaths: ["/tmp/a.png"], params: job("openai", "dall-e-3").params })).toMatchObject({
      ok: false,
      message: GENERAL_PROMPT_ONLY_MESSAGE
    });
  });

  it("builds minimal OpenAI-compatible General request bodies", () => {
    expect(buildOpenAICompatibleGeneralRequestBody(job("openai", "dall-e-3").params as GeneralImageParams, "Prompt")).toEqual({
      model: "dall-e-3",
      prompt: "Prompt",
      n: 1
    });
  });

  it("runs Gemini General generation through generateContent with default image options", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: tinyPngBase64 } }]
            }
          }
        ]
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeneralImageJob(job(), "mock-gemini-key", config(), runtime);

    expect(requestUrl).toBe("https://api.test/v1beta/models/gemini-3-pro-image:generateContent");
    expect(requestBody).toMatchObject({
      generationConfig: {
        responseFormat: {
          image: {
            aspectRatio: DEFAULT_GEMINI_IMAGE_PARAMS.aspectRatio,
            imageSize: "1K"
          }
        }
      }
    });
    expect(result.launchId).toBe("general");
    expect(result.params).toMatchObject({ launchId: "general", providerKind: "gemini", model: "gemini-3-pro-image" });
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("runs OpenAI-compatible General generation without GPT Image 2-specific fields", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        data: [{ b64_json: tinyPngBase64 }],
        usage: { total_tokens: 5 }
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeneralImageJob(job("openai", "dall-e-3"), "sk-test-key", config("openai", "dall-e-3"), runtime);

    expect(requestUrl).toBe("https://api.test/v1/images/generations");
    expect(requestBody).toEqual({
      model: "dall-e-3",
      prompt: "Make a clean product render",
      n: 1
    });
    expect(requestBody).not.toHaveProperty("size");
    expect(requestBody).not.toHaveProperty("quality");
    expect(requestBody).not.toHaveProperty("output_format");
    expect(requestBody).not.toHaveProperty("moderation");
    expect(result.launchId).toBe("general");
    expect(result.params).toMatchObject({ launchId: "general", providerKind: "openai", model: "dall-e-3" });
    expect(result.outputs[0].transientPreview?.dataUrl).toBe(`data:image/png;base64,${tinyPngBase64}`);
    expect(result.providerMetadata).toMatchObject({
      generalFallbackContract: "openai-compatible-minimal",
      generalFallbackProvider: "openai",
      generalFallbackModel: "dall-e-3"
    });
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("runs Custom General generation through the same OpenAI-compatible minimal contract", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        data: [{ b64_json: tinyPngBase64 }]
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeneralImageJob(job("custom", "flux-pro"), "custom-key", config("custom", "flux-pro"), runtime);

    expect(requestUrl).toBe("https://api.test/v1/images/generations");
    expect(requestBody).toEqual({
      model: "flux-pro",
      prompt: "Make a clean product render",
      n: 1
    });
    expect(result.providerMetadata).toMatchObject({
      generalFallbackContract: "openai-compatible-minimal",
      generalFallbackProvider: "custom",
      generalFallbackModel: "flux-pro"
    });
  });

  it("redacts custom API keys from OpenAI-compatible General errors", async () => {
    const fetchImpl = (async () =>
      Response.json(
        {
          error: {
            message: "custom-secret-token-123456789 was rejected"
          }
        },
        { status: 401 }
      )) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runGeneralImageJob(job("custom", "flux-pro"), "custom-secret-token-123456789", config("custom", "flux-pro"), runtime)).rejects.toThrow(
      "[redacted-api-key] was rejected"
    );
    await expect(runGeneralImageJob(job("custom", "flux-pro"), "custom-secret-token-123456789", config("custom", "flux-pro"), runtime)).rejects.not.toThrow(
      "custom-secret-token-123456789"
    );
  });

  it("rejects OpenAI-compatible General reference edits before making a request", async () => {
    const fetchImpl = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(
      runGeneralImageJob(
        job("openai", "dall-e-3", {
          mode: "edit",
          inputAssets: [
            {
              id: "input_1",
              name: "source.png",
              path: "/tmp/source.png",
              mimeType: "image/png",
              sizeBytes: 1
            }
          ]
        }),
        "sk-test-key",
        config("openai", "dall-e-3"),
        runtime
      )
    ).rejects.toThrow(GENERAL_PROMPT_ONLY_MESSAGE);
  });
});
