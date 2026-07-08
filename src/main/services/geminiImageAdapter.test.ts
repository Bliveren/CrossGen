import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeminiImageParams, GenerationJob, InputAsset, JobProgressEvent } from "../../shared/types";
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_IMAGE_PARAMS } from "../../shared/validation";
import type { StoredProviderConfig } from "./stateMigration";
import {
  buildGeminiEndpoint,
  buildGeminiGenerateContentBody,
  buildGeminiGenerateContentEndpoint,
  discoverGeminiModels,
  geminiImageAdapter,
  geminiImageSizeForResolution,
  runGeminiImageJob
} from "./geminiImageAdapter";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
const tinyMaskBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8DwQACfsD/QWf36QAAAAASUVORK5CYII=";

let tmpDir: string | null = null;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

function params(patch: Partial<GeminiImageParams> = {}): GeminiImageParams {
  return {
    ...DEFAULT_GEMINI_IMAGE_PARAMS,
    timeoutMs: 30000,
    ...patch
  };
}

type GeminiTestJob = GenerationJob & { params: GeminiImageParams };

function job(patch: Partial<GeminiTestJob> = {}): GeminiTestJob {
  return {
    ...baseJob(),
    ...patch
  };
}

function baseJob(): GeminiTestJob {
  const now = new Date(0).toISOString();
  return {
    id: "job_gemini_test",
    name: "gemini.png",
    tags: [],
    providerKind: "gemini" as const,
    providerId: "gemini",
    launchId: "nano-banana-3" as const,
    modelId: "gemini-3.1-flash-image",
    modelDisplayName: "Nano Banana 3",
    mode: "generate" as const,
    prompt: "Make a clean product render",
    inputAssets: [],
    params: params(),
    status: "queued" as const,
    createdAt: now,
    updatedAt: now,
    outputs: []
  };
}

function config(patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  const now = new Date(0).toISOString();
  return {
    id: "gemini",
    kind: "gemini",
    name: "Gemini",
    baseURL: DEFAULT_GEMINI_BASE_URL,
    enabled: true,
    defaultModel: DEFAULT_GEMINI_IMAGE_PARAMS.model,
    defaultSize: "auto",
    defaultQuality: "auto",
    timeoutMs: DEFAULT_GEMINI_IMAGE_PARAMS.timeoutMs,
    discoveredModels: [],
    activeLaunchId: "nano-banana-3",
    activeModelId: DEFAULT_GEMINI_IMAGE_PARAMS.model,
    updatedAt: now,
    encryption: "none",
    ...patch
  };
}

async function createRuntime(fetchImpl: typeof fetch) {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-gemini-"));
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

describe("Gemini image adapter", () => {
  it("builds generateContent endpoints and request bodies", () => {
    expect(buildGeminiEndpoint("https://generativelanguage.googleapis.com/v1beta///", "/models")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models"
    );
    expect(buildGeminiGenerateContentEndpoint("https://api.test/v1beta///", "models/gemini-3.1-flash-image")).toBe(
      "https://api.test/v1beta/models/gemini-3.1-flash-image:generateContent"
    );
    expect(geminiImageSizeForResolution("0.5K")).toBe("512");

    const body = buildGeminiGenerateContentBody(params({ aspectRatio: "16:9", resolution: "2K", thinking: false, searchGrounding: true }), "prompt", [
      { mimeType: "image/png", data: "abc" }
    ]);

    expect(body).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [
            { text: expect.stringContaining("Final image aspect ratio: 16:9.") },
            { inlineData: { mimeType: "image/png", data: "abc" } }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: {
            aspectRatio: "16:9",
            imageSize: "2K"
          }
        },
        thinkingConfig: {
          thinkingBudget: 0
        }
      },
      tools: [{ googleSearch: {} }]
    });
    expect(body.contents[0]?.parts[0]?.text).toContain("prompt");
  });

  it("calls Gemini generateContent and saves inline image results with text metadata", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "Mock Gemini text-to-image response." },
                { inlineData: { mimeType: "image/png", data: tinyPngBase64 } }
              ]
            },
            finishReason: "STOP"
          }
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 2,
          totalTokenCount: 3
        },
        modelVersion: "gemini-3.1-flash-image"
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime);

    expect(requestUrl).toBe("https://api.test/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(requestUrl).not.toContain("mock-gemini-key");
    expect(requestHeaders.get("x-goog-api-key")).toBe("mock-gemini-key");
    expect(requestBody).toMatchObject({
      contents: [{ role: "user", parts: [{ text: expect.stringContaining("Make a clean product render") }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: { aspectRatio: "1:1", imageSize: "1K" }
        }
      }
    });
    const requestParts = (requestBody.contents as Array<{ parts: Array<{ text?: string }> }>)[0]?.parts ?? [];
    expect(requestParts[0]?.text).toContain("Final image aspect ratio: 1:1.");
    expect(result.status).toBe("succeeded");
    expect(result.outputs[0].fileName).toBe("job_gemini_test-result-0.png");
    expect(result.usage?.total_tokens).toBe(3);
    expect(result.providerMetadata).toMatchObject({
      geminiTextParts: ["Mock Gemini text-to-image response."],
      geminiFinishReasons: ["STOP"],
      geminiModelVersion: "gemini-3.1-flash-image"
    });
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves OpenAI-style base64 image payloads from Gemini-compatible gateways", async () => {
    const fetchImpl = (async () =>
      Response.json({
        data: [{ b64_json: tinyPngBase64, mime_type: "image/png" }]
      })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.outputs[0].fileName).toBe("job_gemini_test-result-0.png");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves data URL image payloads from Gemini-compatible gateways", async () => {
    const fetchImpl = (async () =>
      Response.json({
        data: [{ url: `data:image/png;base64,${tinyPngBase64}` }]
      })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.outputs[0].fileName).toBe("job_gemini_test-result-0.png");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("extracts Markdown data URL images from Gemini text parts", async () => {
    const fetchImpl = (async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: `![image](data:image/jpeg;base64,${tinyPngBase64})` }]
            },
            finishReason: "STOP"
          }
        ]
      })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.outputs[0]).toMatchObject({
      fileName: "job_gemini_test-result-0.jpg",
      mimeType: "image/jpeg"
    });
    expect(result.providerMetadata).toMatchObject({
      geminiTextParts: ["![image](data:image/jpeg;base64,[image data omitted])"],
      geminiFinishReasons: ["STOP"]
    });
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("downloads Gemini fileData image URLs before saving results", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url) === "https://files.example.com/generated.png") {
        return new Response(Buffer.from(tinyPngBase64, "base64"), { headers: { "content-type": "image/png" } });
      }
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ fileData: { mimeType: "image/png", fileUri: "https://files.example.com/generated.png" } }]
            }
          }
        ]
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("sends source and mask images as inlineData for guided-region inpaint", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-gemini-inputs-"));
    const sourcePath = path.join(tmpDir, "source.png");
    const maskPath = path.join(tmpDir, "mask.png");
    await writeFile(sourcePath, Buffer.from(tinyPngBase64, "base64"));
    await writeFile(maskPath, Buffer.from(tinyMaskBase64, "base64"));
    const source: InputAsset = { id: "source", name: "source.png", path: sourcePath, mimeType: "image/png", sizeBytes: 1 };
    const mask: InputAsset = { id: "mask", name: "mask.png", path: maskPath, mimeType: "image/png", sizeBytes: 1 };
    let parts: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
      parts = body.contents[0]?.parts ?? [];
      return Response.json({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: tinyPngBase64 } }] } }]
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await runGeminiImageJob(
      job({
        mode: "inpaint",
        inputAssets: [source],
        maskAsset: mask
      }),
      "mock-gemini-key",
      "https://api.test/v1beta",
      runtime
    );

    expect(parts).toHaveLength(3);
    expect(parts[0]?.text).toContain("Make a clean product render");
    expect(parts[0]?.text).toContain("Final image aspect ratio: 1:1.");
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: tinyPngBase64 } });
    expect(parts[2]).toEqual({ inlineData: { mimeType: "image/png", data: tinyMaskBase64 } });
  });

  it("tests connections and discovers generateContent models", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/v1beta/models");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("mock-gemini-key");
      return Response.json(
        {
          models: [
            {
              name: "models/gemini-3.1-flash-image",
              displayName: "Gemini 3.1 Flash Image",
              description: "Image model",
              supportedGenerationMethods: ["generateContent"]
            },
            {
              name: "models/text-only",
              supportedGenerationMethods: ["countTokens"]
            }
          ]
        },
        { headers: { "x-request-id": "mock_gemini_req" } }
      );
    }) as typeof fetch;

    await expect(geminiImageAdapter.testConnection(config({ baseURL: "https://api.test/v1beta" }), "mock-gemini-key", { fetch: fetchImpl })).resolves.toEqual({
      ok: true,
      message: "连接成功。",
      status: 200,
      requestId: "mock_gemini_req"
    });
    await expect(discoverGeminiModels(config({ baseURL: "https://api.test/v1beta" }), "mock-gemini-key", { fetch: fetchImpl })).resolves.toEqual([
      {
        id: "gemini-3.1-flash-image",
        providerKind: "gemini",
        displayName: "Gemini 3.1 Flash Image",
        description: "Image model",
        raw: {
          name: "models/gemini-3.1-flash-image",
          displayName: "Gemini 3.1 Flash Image",
          description: "Image model",
          supportedGenerationMethods: ["generateContent"]
        }
      }
    ]);
  });

  it("redacts OpenAI-style and Google API key-like strings from errors", async () => {
    const googleKey = ["AIza", "SyD", "-mock-redaction-key-should-not-leak-0000"].join("");
    const fetchImpl = (async () =>
      Response.json(
        { error: { message: `failed for sk-abcdefghijklmnopqrstuvwxyz and ${googleKey}` } },
        { status: 403 }
      )) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime)).rejects.toThrow("sk-...redacted");
    await expect(runGeminiImageJob(job(), "mock-gemini-key", "https://api.test/v1beta", runtime)).rejects.toThrow("AIza...redacted");
  });

  it("uses OpenAI-compatible timeout behavior", async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(
      runGeminiImageJob(job({ params: params({ timeoutMs: 1 }) }), "mock-gemini-key", "https://api.test/v1beta", runtime)
    ).rejects.toThrow("请求超时");
  });
});
