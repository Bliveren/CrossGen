import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InputAsset, JobProgressEvent, OpenAIImageParams } from "../../shared/types";
import { DEFAULT_BASE_URL, DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import type { StoredProviderConfig } from "./stateMigration";
import { baseRequestBody, buildEndpoint, normalizeOpenAIJobParams, normalizeOpenAIRequestParams, openaiImageAdapter, parseSSE, runOpenAIImageJob, type OpenAIImageJob } from "./openaiImageAdapter";

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
    streamingPartialsEnabled: false,
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
    expect(baseRequestBody(params({ outputFormat: "png", background: "auto", stream: true, partialImages: 2 }), "prompt")).toEqual({
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

  it("enables streaming only for supported generate jobs", () => {
    const directGenerateJob = normalizeOpenAIJobParams(job({ mode: "generate", params: params({ stream: true, partialImages: 2 }) }), {
      streamingPartialsEnabled: true
    });
    expect(directGenerateJob.params.stream).toBe(true);
    expect(directGenerateJob.params.partialImages).toBe(2);

    const gatewayGenerateJob = normalizeOpenAIJobParams(job({ mode: "generate", params: params({ stream: true, partialImages: 2 }) }), {
      streamingPartialsEnabled: false
    });
    expect(gatewayGenerateJob.params.stream).toBe(true);
    expect(gatewayGenerateJob.params.partialImages).toBe(2);

    const editJob = normalizeOpenAIJobParams(job({ mode: "edit", params: params({ stream: true, partialImages: 2 }) }), {
      streamingPartialsEnabled: true
    });
    expect(editJob.params.stream).toBe(false);
    expect(editJob.params.partialImages).toBe(0);

    const inpaintJob = normalizeOpenAIJobParams(job({ mode: "inpaint", params: params({ stream: true, partialImages: 3 }) }), {
      streamingPartialsEnabled: true
    });
    expect(inpaintJob.params.stream).toBe(false);
    expect(inpaintJob.params.partialImages).toBe(0);
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
    expect(result.outputs[0].transientPreview?.dataUrl).toBe(`data:image/png;base64,${tinyPngBase64}`);
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

  it("keeps OpenAI error prefixes and request ids through the provider adapter", async () => {
    const fetchImpl = (async () =>
      Response.json({ error: { message: "invalid key" } }, { status: 401, headers: { "x-request-id": "req_bad" } })) as typeof fetch;

    const result = await openaiImageAdapter.testConnection(config(), "sk-test-key", { fetch: fetchImpl });

    expect(result).toEqual({
      ok: false,
      message: "OpenAI API 请求失败：invalid key Request ID: req_bad",
      status: 401,
      requestId: "req_bad"
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

  it("honors explicit streaming on direct OpenAI and compatible gateways", async () => {
    const directBodies: Array<Record<string, unknown>> = [];
    const directFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      directBodies.push(JSON.parse(String(init?.body)));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "image_generation.completed", b64_json: tinyPngBase64 })}\n\n`));
          controller.close();
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { runtime: directRuntime } = await createRuntime(directFetch);

    await runOpenAIImageJob(job({ params: params({ stream: true, partialImages: 1 }) }), "sk-test-key", DEFAULT_BASE_URL, directRuntime);

    expect(directBodies[0]).toMatchObject({ stream: true, partial_images: 1 });

    const gatewayBodies: Array<Record<string, unknown>> = [];
    const gatewayFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      gatewayBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ data: [{ b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime: gatewayRuntime } = await createRuntime(gatewayFetch);

    await runOpenAIImageJob(job({ params: params({ stream: true, partialImages: 1 }) }), "sk-test-key", "https://api.test/v1", gatewayRuntime);

    expect(gatewayBodies[0]).toMatchObject({ stream: true, partial_images: 1 });
  });

  it("falls back to streaming generation events when compatible right-image JSON generations stay metadata-only", async () => {
    const requests: Array<{ accept: string; body: Record<string, unknown> }> = [];
    const emptyRightImagePayload = {
      model: "gpt-image-2",
      data: null,
      quality: "auto",
      size: "auto",
      usage: { num_input_images: 0 },
      extra_fields: {
        request_type: "image_generation",
        routing_info: { route: "test" },
        provider: "right-image",
        original_model_requested: "gpt-image-2",
        resolved_model_used: "gpt-image-2",
        latency: 1.2,
        chunk_index: 0,
        provider_response_headers: {
          "Cf-Cache-Status": "DYNAMIC",
          "Cf-Ray": "test-ray",
          Nel: "{}",
          "Report-To": "{}",
          "Server-Timing": "cf",
          Via: "test"
        }
      }
    };
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        accept: new Headers(init?.headers).get("Accept") ?? "",
        body: JSON.parse(String(init?.body))
      });
      if (requests.length < 3) {
        return Response.json(emptyRightImagePayload);
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`event: image_generation.completed\ndata: ${JSON.stringify({ type: "image_generation.completed", b64_json: tinyPngBase64, usage: { total_tokens: 7 } })}\n\n`));
          controller.close();
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ stream: false }) }), "sk-test-key", "https://api.test/v1", runtime);

    expect(requests).toEqual([
      { accept: "application/json", body: expect.objectContaining({ stream: false, n: 1 }) },
      { accept: "application/json", body: expect.objectContaining({ stream: false, n: 1 }) },
      { accept: "text/event-stream", body: expect.objectContaining({ stream: true, partial_images: 1, n: 1 }) }
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.params).toMatchObject({ stream: false, partialImages: 0 });
    expect(result.usage?.total_tokens).toBe(7);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
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

  it("calls image edits with image[] and mask multipart fields", async () => {
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
    expect(String(form?.get("prompt"))).toContain("Make a clean product render");
    expect(String(form?.get("prompt"))).toContain("The request includes 1 attached reference image.");
    expect(String(form?.get("prompt"))).toContain("A mask is attached.");
    expect(form?.getAll("image")).toHaveLength(0);
    expect(form?.getAll("image[]")).toHaveLength(1);
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
    expect(String(form?.get("prompt"))).toContain("The request includes 2 attached reference images.");
    expect(String(form?.get("prompt"))).toContain("Use the attached image content as visual input; do not ignore it.");
  });

  it("retries OpenAI-compatible edits with singular image fields after metadata-only empty responses", async () => {
    const source = await sourceAsset();
    const imageFieldNames: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      imageFieldNames.push(form.getAll("image[]").length > 0 ? "image[]" : form.getAll("image").length > 0 ? "image" : "missing");
      if (imageFieldNames.length === 1) {
        return Response.json({
          model: "gpt-image-2",
          data: null,
          usage: { num_input_images: 1 },
          extra_fields: {
            request_type: "image_edit",
            provider: "right-image",
            resolved_model_used: "gpt-image-2",
            provider_response_headers: { "cf-ray": "test-ray" }
          }
        });
      }
      return Response.json({ data: [{ b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(
      job({
        mode: "edit",
        inputAssets: [source],
        params: params({ stream: false })
      }),
      "sk-test-key",
      "https://api.test/v1",
      runtime
    );

    expect(imageFieldNames).toEqual(["image[]", "image"]);
    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("falls back to streaming edit events when compatible right-image JSON edits stay metadata-only", async () => {
    const source = await sourceAsset();
    const requests: Array<{ accept: string; imageFieldName: string; stream: string | null; partialImages: string | null }> = [];
    const emptyRightImagePayload = {
      model: "gpt-image-2",
      data: null,
      quality: "auto",
      size: "auto",
      usage: { num_input_images: 1 },
      extra_fields: {
        request_type: "image_edit",
        routing_info: { route: "test" },
        provider: "right-image",
        original_model_requested: "gpt-image-2",
        resolved_model_used: "gpt-image-2",
        latency: 1.2,
        chunk_index: 0,
        provider_response_headers: {
          "Cf-Cache-Status": "DYNAMIC",
          "Cf-Ray": "test-ray",
          Nel: "{}",
          "Report-To": "{}",
          "Server-Timing": "cf",
          Via: "test"
        }
      }
    };
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      requests.push({
        accept: new Headers(init?.headers).get("Accept") ?? "",
        imageFieldName: form.getAll("image[]").length > 0 ? "image[]" : form.getAll("image").length > 0 ? "image" : "missing",
        stream: form.get("stream")?.toString() ?? null,
        partialImages: form.get("partial_images")?.toString() ?? null
      });
      if (requests.length < 3) {
        return Response.json(emptyRightImagePayload);
      }
      const encoder = new TextEncoder();
      let pulled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled) {
            controller.error(new Error("terminated"));
            return;
          }
          pulled = true;
          controller.enqueue(encoder.encode(`event: image_edit.completed\ndata: ${JSON.stringify({ type: "image_edit.completed", b64_json: tinyPngBase64, usage: { total_tokens: 7 } })}\n\n`));
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(
      job({
        mode: "edit",
        inputAssets: [source],
        params: params({ stream: false })
      }),
      "sk-test-key",
      "https://api.test/v1",
      runtime
    );

    expect(requests).toEqual([
      { accept: "application/json", imageFieldName: "image[]", stream: "false", partialImages: null },
      { accept: "application/json", imageFieldName: "image", stream: "false", partialImages: null },
      { accept: "text/event-stream", imageFieldName: "image[]", stream: "true", partialImages: "1" }
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.params).toMatchObject({ stream: false, partialImages: 0 });
    expect(result.usage?.total_tokens).toBe(7);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("retries streaming edit fallback with singular image when image array streams terminate before a final image", async () => {
    const source = await sourceAsset();
    const requests: Array<{ accept: string; imageFieldName: string; stream: string | null; partialImages: string | null }> = [];
    const emptyRightImagePayload = {
      model: "gpt-image-2",
      data: null,
      quality: "auto",
      size: "auto",
      usage: { num_input_images: 1 },
      extra_fields: {
        request_type: "image_edit",
        routing_info: { route: "test" },
        provider: "right-image",
        original_model_requested: "gpt-image-2",
        resolved_model_used: "gpt-image-2",
        latency: 1.2,
        chunk_index: 0,
        provider_response_headers: { "Cf-Ray": "test-ray" }
      }
    };
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      requests.push({
        accept: new Headers(init?.headers).get("Accept") ?? "",
        imageFieldName: form.getAll("image[]").length > 0 ? "image[]" : form.getAll("image").length > 0 ? "image" : "missing",
        stream: form.get("stream")?.toString() ?? null,
        partialImages: form.get("partial_images")?.toString() ?? null
      });
      if (requests.length < 3) {
        return Response.json(emptyRightImagePayload);
      }
      if (requests.length === 3) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("terminated"));
          }
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`event: image_edit.completed\ndata: ${JSON.stringify({ type: "image_edit.completed", b64_json: tinyPngBase64, usage: { total_tokens: 11 } })}\n\n`));
          controller.close();
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(
      job({
        mode: "edit",
        inputAssets: [source],
        params: params({ stream: false })
      }),
      "sk-test-key",
      "https://api.test/v1",
      runtime
    );

    expect(requests).toEqual([
      { accept: "application/json", imageFieldName: "image[]", stream: "false", partialImages: null },
      { accept: "application/json", imageFieldName: "image", stream: "false", partialImages: null },
      { accept: "text/event-stream", imageFieldName: "image[]", stream: "true", partialImages: "1" },
      { accept: "text/event-stream", imageFieldName: "image", stream: "true", partialImages: "1" }
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.usage?.total_tokens).toBe(11);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
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
    let requestAccept = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestAccept = new Headers(init?.headers).get("Accept") ?? "";
      requestBody = JSON.parse(String(init?.body));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`event: image_generation.partial_image\ndata: ${JSON.stringify({ type: "image_generation.partial_image", partial_image_index: 0, b64_json: tinyPngBase64 })}\n\n`));
          controller.enqueue(encoder.encode(`event: image_generation.completed\ndata: ${JSON.stringify({ type: "image_generation.completed", b64_json: tinyPngBase64, usage: { total_tokens: 5 } })}\n\n`));
          controller.close();
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ stream: true, partialImages: 2 }) }), "sk-test-key", "https://api.test/v1", runtime, {
      streamingPartialsEnabled: true
    });

    expect(requestAccept).toBe("text/event-stream");
    expect(requestBody).toMatchObject({ stream: true, partial_images: 2 });
    expect(result.status).toBe("succeeded");
    expect(result.outputs.map((asset) => asset.sourceType)).toEqual(["partial", "result"]);
    expect(result.usage?.total_tokens).toBe(5);
  });

  it("accepts JSON image payloads when streaming was requested", async () => {
    const fetchImpl = (async () =>
      Response.json(
        { data: [{ b64_json: tinyPngBase64 }], usage: { total_tokens: 4 } },
        { headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", runtime, {
      streamingPartialsEnabled: true
    });

    expect(result.status).toBe("succeeded");
    expect(result.outputs.map((asset) => asset.sourceType)).toEqual(["result"]);
    expect(result.usage?.total_tokens).toBe(4);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("parses nested streaming data image payloads", async () => {
    const fetchImpl = (async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "image_generation.completed", data: [{ b64_json: tinyPngBase64 }] })}\n\n`));
          controller.close();
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ mode: "generate", params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", runtime, {
      streamingPartialsEnabled: true
    });

    expect(result.status).toBe("succeeded");
    expect(result.outputs.map((asset) => asset.sourceType)).toEqual(["result"]);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("falls back to non-stream generation when a stream request is rejected as incompatible", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      if (requestBodies.length === 1) {
        return Response.json({ error: { message: "stream is not supported by this endpoint" } }, { status: 400 });
      }
      return Response.json({ data: [{ b64_json: tinyPngBase64 }], usage: { total_tokens: 6 } });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job({ params: params({ stream: true, partialImages: 2 }) }), "sk-test-key", "https://api.test/v1", runtime, {
      streamingPartialsEnabled: true
    });

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toMatchObject({ stream: true, partial_images: 2 });
    expect(requestBodies[1]).toMatchObject({ stream: false });
    expect(requestBodies[1]).not.toHaveProperty("partial_images");
    expect(result.status).toBe("succeeded");
    expect(result.params).toMatchObject({ stream: false, partialImages: 0 });
  });

  it("saves data URL image payloads", async () => {
    const fetchImpl = (async () => Response.json({ data: [{ url: `data:image/png;base64,${tinyPngBase64}` }] })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves Responses-style image generation output results", async () => {
    const fetchImpl = (async () => Response.json({
      output: [
        {
          type: "image_generation_call",
          status: "completed",
          result: tinyPngBase64
        }
      ],
      usage: { total_tokens: 7 }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.usage?.total_tokens).toBe(7);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves compatible image payloads with nested image strings", async () => {
    const fetchImpl = (async () => Response.json({
      data: [
        {
          image: tinyPngBase64
        }
      ],
      usage: { total_tokens: 3 }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    expect(result.usage?.total_tokens).toBe(3);
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves compatible image payloads with raw images arrays", async () => {
    const fetchImpl = (async () => Response.json({
      images: [tinyPngBase64]
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves compatible image payloads with untyped result fields", async () => {
    const fetchImpl = (async () => Response.json({
      data: [
        {
          result: tinyPngBase64
        }
      ]
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves compatible image payloads nested under extra_fields", async () => {
    const fetchImpl = (async () => Response.json({
      model: "gpt-image-2",
      data: null,
      usage: { num_input_images: 2 },
      extra_fields: {
        response: {
          images: [{ b64_json: tinyPngBase64 }]
        }
      }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("saves compatible image payloads inside JSON string containers", async () => {
    const fetchImpl = (async () => Response.json({
      data: JSON.stringify({ images: [tinyPngBase64] })
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("retries compatible metadata-only empty responses once", async () => {
    let requestCount = 0;
    const fetchImpl = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return Response.json({
          model: "gpt-image-2",
          data: null,
          usage: { num_input_images: 2 },
          extra_fields: {
            provider: "compatible-router",
            resolved_model_used: "gpt-image-2",
            provider_response_headers: { "x-request-id": "req_test" }
          }
        });
      }
      return Response.json({ data: [{ b64_json: tinyPngBase64 }] });
    }) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    const result = await runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime);

    expect(requestCount).toBe(2);
    expect(result.status).toBe("succeeded");
    await expect(readFile(result.outputs[0].path)).resolves.toEqual(Buffer.from(tinyPngBase64, "base64"));
  });

  it("includes response diagnostics when no savable image is present", async () => {
    const fetchImpl = (async () => Response.json({
      output: [
        { type: "output_text", text: "The request was blocked by the safety system." }
      ]
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime)).rejects.toThrow(
      "响应摘要：顶层字段：output；output 1 项，类型：output_text；文本信息：The request was blocked by the safety system."
    );
  });

  it("includes structural diagnostics for empty compatible image responses", async () => {
    const fetchImpl = (async () => Response.json({
      created: 123,
      data: [{ revised_prompt: "clean render", content_filter_results: { filtered: true } }],
      usage: { num_input_images: 2 }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime)).rejects.toThrow(
      "响应摘要：顶层字段：created,data,usage；data 1 项，字段：revised_prompt,content_filter_results；usage 字段：num_input_images"
    );
  });

  it("includes data and extra_fields details for primitive empty responses", async () => {
    const fetchImpl = (async () => Response.json({
      model: "gpt-image-2",
      data: null,
      quality: "auto",
      size: "auto",
      usage: { num_input_images: 2 },
      extra_fields: {}
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime)).rejects.toThrow(
      "响应摘要：顶层字段：model,data,quality,size,usage,extra_fields；data 类型：null；usage 字段：num_input_images；输入图片数：2；extra_fields 字段：空对象"
    );
  });

  it("includes compatible router metadata after an empty retry stays empty", async () => {
    const fetchImpl = (async () => Response.json({
      model: "gpt-image-2",
      data: null,
      usage: { num_input_images: 2 },
      extra_fields: {
        request_type: "image_edit",
        provider: "compatible-router",
        original_model_requested: "gpt-image-2",
        resolved_model_used: "gpt-image-2",
        latency: 103.5,
        chunk_index: 0,
        dropped_compat_plugin_params: ["stream", "moderation"],
        provider_response_headers: { "x-request-id": "req_test" }
      }
    })) as typeof fetch;
    const { runtime } = await createRuntime(fetchImpl);

    await expect(runOpenAIImageJob(job(), "sk-test-key", "https://api.test/v1", runtime)).rejects.toThrow(
      "extra_fields 摘要：request_type=string(image_edit)，provider=string(compatible-router)，original_model_requested=string(gpt-image-2)，resolved_model_used=string(gpt-image-2)，latency=number，chunk_index=number，dropped=string(stream),string(moderation)，headers=x-request-id:string(req_test)；已自动重试 1 次"
    );
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

    await expect(runOpenAIImageJob(job({ params: params({ stream: true }) }), "sk-test-key", "https://api.test/v1", streamRuntime, {
      streamingPartialsEnabled: true
    })).rejects.toThrow("sk-...redacted");
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
