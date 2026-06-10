import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InputAsset, JobProgressEvent, OpenAIImageParams } from "../../shared/types";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import type { StoredProviderConfig } from "./stateMigration";
import { baseRequestBody, buildEndpoint, normalizeOpenAIRequestParams, openaiImageAdapter, parseSSE, runOpenAIImageJob, type OpenAIImageJob } from "./openaiImageAdapter";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";

let tmpDir: string | null = null;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

function params(patch: Partial<OpenAIImageParams> = {}): OpenAIImageParams {
  return {
    ...DEFAULT_IMAGE_PARAMS,
    timeoutMs: 30000,
    ...patch
  };
}

function job(patch: Partial<OpenAIImageJob> = {}): OpenAIImageJob {
  const now = new Date(0).toISOString();
  return {
    id: "job_test",
    providerKind: "openai",
    providerId: "default",
    launchId: "gpt-image-2",
    modelId: "gpt-image-2",
    modelDisplayName: "GPT Image 2",
    mode: "generate",
    prompt: "Make a clean product render",
    inputAssets: [],
    params: params({ stream: false }),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    outputs: [],
    ...patch
  };
}

function config(patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  const now = new Date(0).toISOString();
  return {
    id: "default",
    kind: "openai",
    name: "OpenAI",
    baseURL: "https://api.test/v1",
    enabled: true,
    defaultModel: DEFAULT_IMAGE_PARAMS.model,
    defaultSize: DEFAULT_IMAGE_PARAMS.size,
    defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
    timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
    discoveredModels: [],
    activeLaunchId: "gpt-image-2",
    activeModelId: DEFAULT_IMAGE_PARAMS.model,
    updatedAt: now,
    encryption: "none",
    ...patch
  };
}

async function createRuntime(fetchImpl: typeof fetch) {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-openai-"));
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

describe("OpenAI image service", () => {
  it("builds gpt-image-2 request bodies without unsupported transparent background", () => {
    expect(buildEndpoint("https://example.test/v1///", "/images/generations")).toBe("https://example.test/v1/images/generations");
    expect(baseRequestBody(params({ outputFormat: "png", background: "auto", stream: true }), "prompt")).toEqual({
      model: "gpt-image-2",
      prompt: "prompt",
      size: "auto",
      quality: "auto",
      output_format: "png",
      n: 1,
      stream: true,
      moderation: "auto",
      partial_images: 2
    });
    expect(baseRequestBody(params({ outputFormat: "jpeg", outputCompression: 42, background: "opaque", stream: false }), "prompt")).toMatchObject({
      output_format: "jpeg",
      output_compression: 42,
      background: "opaque"
    });
    expect(baseRequestBody(params({ n: 4, stream: true, partialImages: 2 }), "prompt")).toMatchObject({
      n: 4,
      stream: false
    });
    expect(baseRequestBody(params({ n: 4, stream: true, partialImages: 2 }), "prompt")).not.toHaveProperty("partial_images");
    expect(normalizeOpenAIRequestParams(params({ n: 4, stream: true, partialImages: 2 }))).toMatchObject({
      n: 4,
      stream: false,
      partialImages: 0
    });
  });

  it("calls image generations and saves base64 results", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        data: [{ b64_json: tinyPngBase64 }],
        usage: { total_tokens: 3 }
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(requestUrl).toBe("https://api.test/v1/images/generations");
    expect(requestBody).toMatchObject({ model: "gpt-image-2", prompt: "Make a clean product render" });
    expect(result.status).toBe("succeeded");
    expect(result.outputs[0].fileName).toBe("job_test-result-0.png");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("runs OpenAI jobs through the provider adapter", async () => {
    let requestUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      requestUrl = String(url);
      return Response.json({ data: [{ b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await openaiImageAdapter.runJob(job(), "sk-test-key", config(), runtime);

    expect(openaiImageAdapter.kind).toBe("openai");
    expect(requestUrl).toBe("https://api.test/v1/images/generations");
    expect(result.status).toBe("succeeded");
  });

  it("tests OpenAI connections through the provider adapter", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/v1/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test-key");
      return Response.json({ data: [{ id: "gpt-image-2" }] }, { headers: { "x-request-id": "req_test" } });
    }) as typeof fetch;

    const result = await openaiImageAdapter.testConnection(config(), "sk-test-key", { fetch: fetchImpl });

    expect(result).toEqual({
      ok: true,
      message: "连接成功。",
      status: 200,
      requestId: "req_test"
    });
  });

  it("discovers OpenAI models through the provider adapter", async () => {
    const fetchImpl = (async () => Response.json({ data: [{ id: "gpt-image-2" }, { id: "text-only" }, { object: "missing-id" }] })) as typeof fetch;

    const models = await openaiImageAdapter.discoverModels(config(), "sk-test-key", { fetch: fetchImpl });

    expect(models).toEqual([
      {
        id: "gpt-image-2",
        providerKind: "openai",
        displayName: "gpt-image-2",
        raw: { id: "gpt-image-2" }
      },
      {
        id: "text-only",
        providerKind: "openai",
        displayName: "text-only",
        raw: { id: "text-only" }
      }
    ]);
  });

  it("saves all generated images when n returns multiple results", async () => {
    const fetchImpl = (async () => Response.json({
      data: [{ b64_json: tinyPngBase64 }, { b64_json: tinyPngBase64 }],
      usage: { total_tokens: 6 }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ n: 2, stream: false }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.outputs.map((asset) => asset.fileName)).toEqual(["job_test-result-0.png", "job_test-result-1.png"]);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
    await expect(readFile(result.outputs[1].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("uses non-stream JSON requests when multiple OpenAI outputs are requested", async () => {
    let requestAccept = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestAccept = new Headers(init?.headers).get("Accept") ?? "";
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        data: Array.from({ length: 4 }, () => ({ b64_json: tinyPngBase64 })),
        usage: { total_tokens: 12 }
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ n: 4, stream: true, partialImages: 2 }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(requestAccept).toBe("application/json");
    expect(requestBody).toMatchObject({ n: 4, stream: false });
    expect(requestBody).not.toHaveProperty("partial_images");
    expect(result.params).toMatchObject({ n: 4, stream: false, partialImages: 0 });
    expect(result.outputs.map((asset) => asset.fileName)).toEqual([
      "job_test-result-0.png",
      "job_test-result-1.png",
      "job_test-result-2.png",
      "job_test-result-3.png"
    ]);
  });

  it("backfills OpenAI outputs when a provider ignores n and returns one image at a time", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        data: [{ b64_json: tinyPngBase64 }],
        usage: { total_tokens: requestBodies.length }
      });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ n: 3, stream: true, partialImages: 2 }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(requestBodies.map((body) => body.n)).toEqual([3, 2, 1]);
    expect(requestBodies.every((body) => body.stream === false)).toBe(true);
    expect(result.params).toMatchObject({ n: 3, stream: false, partialImages: 0 });
    expect(result.usage?.total_tokens).toBe(6);
    expect(result.outputs.map((asset) => asset.fileName)).toEqual([
      "job_test-result-0.png",
      "job_test-result-1.png",
      "job_test-result-2.png"
    ]);
  });

  it("calls image edits with image and mask multipart fields", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-inputs-"));
    const sourcePath = path.join(tmpDir, "source.png");
    const maskPath = path.join(tmpDir, "mask.png");
    await writeFile(sourcePath, Buffer.from(tinyPngBase64, "base64"));
    await writeFile(maskPath, Buffer.from(tinyPngBase64, "base64"));
    const source: InputAsset = { id: "source", name: "source.png", path: sourcePath, mimeType: "image/png", sizeBytes: 1 };
    const mask: InputAsset = { id: "mask", name: "mask.png", path: maskPath, mimeType: "image/png", sizeBytes: 1 };
    let form: FormData | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      form = init?.body as FormData;
      return Response.json({ data: [{ b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await runOpenAIImageJob(
      job({
        mode: "inpaint",
        inputAssets: [source],
        maskAsset: mask,
        params: params({ stream: false })
      }),
      "sk-test-key",
      "https://api.test/v1",
      runtime
    );

    expect(form?.get("model")).toBe("gpt-image-2");
    expect(form?.get("prompt")).toBe("Make a clean product render");
    expect(form?.getAll("image")).toHaveLength(1);
    expect(form?.getAll("image[]")).toHaveLength(0);
    expect(form?.get("mask")).toBeInstanceOf(File);
  });

  it("uses image[] multipart fields for multi-image edits", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-inputs-"));
    const sourceAPath = path.join(tmpDir, "source-a.png");
    const sourceBPath = path.join(tmpDir, "source-b.png");
    await writeFile(sourceAPath, Buffer.from(tinyPngBase64, "base64"));
    await writeFile(sourceBPath, Buffer.from(tinyPngBase64, "base64"));
    const sourceA: InputAsset = { id: "source-a", name: "source-a.png", path: sourceAPath, mimeType: "image/png", sizeBytes: 1 };
    const sourceB: InputAsset = { id: "source-b", name: "source-b.png", path: sourceBPath, mimeType: "image/png", sizeBytes: 1 };
    let form: FormData | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      form = init?.body as FormData;
      return Response.json({ data: [{ b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await runOpenAIImageJob(
      job({
        mode: "edit",
        inputAssets: [sourceA, sourceB],
        params: params({ stream: false })
      }),
      "sk-test-key",
      "https://api.test/v1",
      runtime
    );

    expect(form?.getAll("image")).toHaveLength(0);
    expect(form?.getAll("image[]")).toHaveLength(2);
  });

  it("passes advanced gpt-image-2 parameters through multipart edit requests", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-inputs-"));
    const sourcePath = path.join(tmpDir, "source.png");
    await writeFile(sourcePath, Buffer.from(tinyPngBase64, "base64"));
    const source: InputAsset = { id: "source", name: "source.png", path: sourcePath, mimeType: "image/png", sizeBytes: 1 };
    let form: FormData | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      form = init?.body as FormData;
      return Response.json({ data: [{ b64_json: tinyPngBase64 }, { b64_json: tinyPngBase64 }, { b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await runOpenAIImageJob(
      job({
        mode: "edit",
        inputAssets: [source],
        params: params({
          size: "1024x1536",
          quality: "high",
          outputFormat: "jpeg",
          outputCompression: 55,
          background: "opaque",
          n: 3,
          moderation: "low",
          stream: false
        })
      }),
      "sk-test-key",
      "https://api.test/v1",
      runtime
    );

    expect(form?.get("size")).toBe("1024x1536");
    expect(form?.get("quality")).toBe("high");
    expect(form?.get("output_format")).toBe("jpeg");
    expect(form?.get("output_compression")).toBe("55");
    expect(form?.get("background")).toBe("opaque");
    expect(form?.get("n")).toBe("3");
    expect(form?.get("moderation")).toBe("low");
    expect(form?.get("partial_images")).toBeNull();
  });

  it("rejects mask requests when the source and mask formats differ", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-inputs-"));
    const sourcePath = path.join(tmpDir, "source.webp");
    const maskPath = path.join(tmpDir, "mask.png");
    await writeFile(sourcePath, Buffer.from(tinyPngBase64, "base64"));
    await writeFile(maskPath, Buffer.from(tinyPngBase64, "base64"));
    const source: InputAsset = { id: "source", name: "source.webp", path: sourcePath, mimeType: "image/webp", sizeBytes: 1 };
    const mask: InputAsset = { id: "mask", name: "mask.png", path: maskPath, mimeType: "image/png", sizeBytes: 1 };
    const { runtime } = await createRuntime((async () => Response.json({ data: [] })) as typeof fetch);

    await expect(
      runOpenAIImageJob(
        job({
          mode: "inpaint",
          inputAssets: [source],
          maskAsset: mask,
          params: params({ stream: false })
        }),
        "sk-test-key",
        "https://api.test/v1",
        runtime
      )
    ).rejects.toThrow("Mask format must match the first source image.");
  });

  it("parses streaming partial and final events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`event: image_generation.partial_image\ndata: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"${tinyPngBase64}"}\n\n`));
        controller.enqueue(encoder.encode(`event: image_generation.completed\ndata: {"type":"image_generation.completed","b64_json":"${tinyPngBase64}","usage":{"total_tokens":5}}\n\n`));
        controller.close();
      }
    });
    const fetchImpl = (async () => new Response(stream, { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    const { runtime, events } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.outputs.map((asset) => asset.sourceType)).toEqual(["partial", "result"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "partial", partialIndex: 0 });
    expect(result.usage?.total_tokens).toBe(5);
  });

  it("accepts JSON image payloads when streaming was requested", async () => {
    const fetchImpl = (async () =>
      Response.json(
        { data: [{ b64_json: tinyPngBase64 }], usage: { total_tokens: 4 } },
        { headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.outputs.map((asset) => asset.sourceType)).toEqual(["result"]);
    expect(result.usage?.total_tokens).toBe(4);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("parses nested streaming data image payloads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`event: image_edit.completed\ndata: {"type":"image_edit.completed","data":[{"b64_json":"${tinyPngBase64}"}]}\n\n`));
        controller.close();
      }
    });
    const fetchImpl = (async () => new Response(stream, { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ mode: "edit", inputAssets: [await sourceAsset()], params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.outputs.map((asset) => asset.sourceType)).toEqual(["result"]);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves data URL image payloads", async () => {
    const fetchImpl = (async () => Response.json({ data: [{ url: `data:image/png;base64,${tinyPngBase64}` }] })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("reports non-json image responses clearly", async () => {
    const fetchImpl = (async () => new Response("<!doctype html><title>Not found</title>", {
      headers: { "content-type": "text/html" }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime)).rejects.toThrow("非预期响应");
  });

  it("handles direct SSE parsing and invalid JSON errors", async () => {
    const received: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"image_edit.completed"}\n\n'));
        controller.close();
      }
    });

    await parseSSE(stream, async (event) => {
      received.push(event.type ?? "");
    });

    expect(received).toEqual(["image_edit.completed"]);
  });

  it("redacts API keys from API error text", async () => {
    const fetchImpl = (async () => new Response("failed for sk-abcdefghijklmnopqrstuvwxyz", { status: 401 })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime)).rejects.toThrow("sk-...redacted");
  });

  it("redacts API keys from JSON and streaming API errors", async () => {
    const jsonFetch = (async () =>
      Response.json({ error: { message: "failed for sk-abcdefghijklmnopqrstuvwxyz" } }, { status: 401 })) as typeof fetch;
    const { runtime: jsonRuntime } = await createRuntime(jsonFetch);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", jsonRuntime)).rejects.toThrow("sk-...redacted");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"error":{"message":"failed for sk-abcdefghijklmnopqrstuvwxyz"}}\n\n'));
        controller.close();
      }
    });
    const streamFetch = (async () => new Response(stream, { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    const { runtime: streamRuntime } = await createRuntime(streamFetch);

    await expect(runOpenAIImageJob(job({ params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", streamRuntime)).rejects.toThrow("sk-...redacted");
  });
});

async function sourceAsset(): Promise<InputAsset> {
  if (!tmpDir) {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "image2tools-inputs-"));
  }
  const sourcePath = path.join(tmpDir, "source.png");
  await writeFile(sourcePath, Buffer.from(tinyPngBase64, "base64"));
  return { id: "source", name: "source.png", path: sourcePath, mimeType: "image/png", sizeBytes: 1 };
}
