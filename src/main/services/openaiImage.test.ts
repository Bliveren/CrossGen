import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationJob, ImageParams, InputAsset, JobProgressEvent } from "../../shared/types";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import { baseRequestBody, buildEndpoint, parseSSE, runOpenAIImageJob } from "./openaiImage";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";

let tmpDir: string | null = null;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

function params(patch: Partial<ImageParams> = {}): ImageParams {
  return {
    ...DEFAULT_IMAGE_PARAMS,
    timeoutMs: 30000,
    ...patch
  };
}

function job(patch: Partial<GenerationJob> = {}): GenerationJob {
  const now = new Date(0).toISOString();
  return {
    id: "job_test",
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
    expect(form?.get("prompt")).toBe("Make a clean product render");
    expect(form?.getAll("image[]")).toHaveLength(1);
    expect(form?.get("mask")).toBeInstanceOf(File);
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
});
