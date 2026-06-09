import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationJob, JobProgressEvent, ProviderKind } from "../../shared/types";
import { DEFAULT_GENERAL_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS, DEFAULT_GEMINI_IMAGE_PARAMS } from "../../shared/validation";
import { generalImageAdapter, runGeneralImageJob, unsupportedGeneralProviderMessage } from "./generalImageAdapter";
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
    expect(generalImageAdapter.validateJob({ mode: "generate", prompt: "Prompt", inputPaths: [], params: job("custom", "image-model-x").params })).toMatchObject({
      ok: false,
      message: "当前 provider 暂未接入 General 运行时。"
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

  it("rejects OpenAI General fallback instead of routing DALL-E through GPT Image params", async () => {
    const { runtime } = await createRuntime((async () => Response.json({})) as typeof fetch);

    await expect(runGeneralImageJob(job("openai", "dall-e-3"), "sk-test-key", config("openai", "dall-e-3"), runtime)).rejects.toThrow(
      unsupportedGeneralProviderMessage("openai")
    );
  });

  it("rejects unsupported General provider fallback", async () => {
    const { runtime } = await createRuntime((async () => Response.json({})) as typeof fetch);

    await expect(runGeneralImageJob(job("custom", "image-model-x"), "custom-key", config("custom", "image-model-x"), runtime)).rejects.toThrow(
      unsupportedGeneralProviderMessage("custom")
    );
  });
});
