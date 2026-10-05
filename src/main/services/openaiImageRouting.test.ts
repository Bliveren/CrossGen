import { describe, expect, it } from "vitest";
import {
  buildOpenAIImageRouteProbeRequest,
  isRouteProbeReachableStatus,
  isOpenAIImageModelUnavailable,
  preferredOpenAIImageRoute,
  probeOpenAIImageRoute,
  probeOpenAIImageRouting
} from "./openaiImageRouting";
import { defaultStoredConfig } from "./stateMigration";
import type { OpenAIImageRouteProbe } from "../../shared/types";
import {
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID
} from "../../shared/modelCatalog";

describe("OpenAI image route probing", () => {
  it("builds lightweight probe requests that do not trigger full image generation", () => {
    expect(buildOpenAIImageRouteProbeRequest("image-api", "generate", "gpt-image-2")).toEqual({
      endpoint: "/images/generations",
      body: { model: "gpt-image-2" }
    });

    const editProbe = buildOpenAIImageRouteProbeRequest("image-api", "edit", "gpt-image-2");
    expect(editProbe.endpoint).toBe("/images/edits");
    expect(editProbe.body).toBeInstanceOf(FormData);
    expect((editProbe.body as FormData).get("model")).toBe("gpt-image-2");
    expect((editProbe.body as FormData).has("image")).toBe(false);

    expect(buildOpenAIImageRouteProbeRequest("responses", "edit", "gpt-image-2")).toMatchObject({
      endpoint: "/responses",
      body: {
        model: "gpt-image-2",
        input: [],
        tools: [{ type: "image_generation", action: "edit" }]
      }
    });

    expect(buildOpenAIImageRouteProbeRequest("responses", "guided-region", "gpt-image-2")).toMatchObject({
      endpoint: "/responses",
      body: {
        model: "gpt-image-2",
        input: [],
        tools: [{ type: "image_generation", action: "edit" }]
      }
    });

    expect(buildOpenAIImageRouteProbeRequest("chat-completions", "generate", "gpt-image-2")).toMatchObject({
      endpoint: "/chat/completions",
      body: {
        model: "gpt-image-2",
        stream: true,
        params: {},
        features: { image_generation: false },
        messages: []
      }
    });
  });

  it("marks validation rejections reachable without selecting them over successful probes", async () => {
    expect(isRouteProbeReachableStatus(400)).toBe(true);
    expect(isRouteProbeReachableStatus(422)).toBe(true);
    expect(isRouteProbeReachableStatus(500)).toBe(false);

    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "gpt-image-2",
        messages: []
      });
      return new Response("validation error", { status: 400 });
    }) as typeof fetch;
    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "chat-completions",
      "generate",
      buildOpenAIImageRouteProbeRequest("chat-completions", "generate", "gpt-image-2")
    );

    expect(probe).toMatchObject({
      modelId: "gpt-image-2",
      route: "chat-completions",
      endpoint: "/chat/completions",
      ok: true,
      verified: false,
      status: 400,
      error: undefined
    });

    const probes: OpenAIImageRouteProbe[] = [
      { route: "image-api", mode: "generate", endpoint: "/images/generations", ok: true, latencyMs: 10, status: 400 },
      { route: "responses", mode: "generate", endpoint: "/responses", ok: true, latencyMs: 20, status: 200 }
    ];
    expect(preferredOpenAIImageRoute(probes, "generate")).toBe("responses");
  });

  it("does not treat a model_not_found validation response as route reachability", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: {
        code: "model_not_found",
        type: "invalid_request_error",
        message: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
      }
    }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      modelUnavailable: true,
      status: 400,
      error: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
    });
    expect(isOpenAIImageModelUnavailable({
      probes: [probe],
      updatedAt: "2026-09-15T00:00:00.000Z"
    })).toBe(true);
  });

  it("does not verify a route when the gateway returns model_not_found with HTTP 200", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: {
        code: "model_not_found",
        message: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      modelUnavailable: true,
      status: 200,
      error: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
    });
    expect(preferredOpenAIImageRoute([probe], "generate")).toBe("chat-completions");
    expect(isOpenAIImageModelUnavailable({
      probes: [probe],
      updatedAt: "2026-09-15T00:00:00.000Z"
    })).toBe(true);
  });

  it("does not confirm a route when a gateway returns a generic error envelope with HTTP 200", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: {
        code: "unsupported_operation",
        message: "image generation is disabled for this account"
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", "gpt-image-2")
    );

    expect(probe).toMatchObject({
      modelId: "gpt-image-2",
      ok: false,
      verified: false,
      status: 200,
      error: "image generation is disabled for this account"
    });
    expect(probe.modelUnavailable).toBeUndefined();
    expect(isOpenAIImageModelUnavailable({
      probes: [probe],
      updatedAt: "2026-09-15T00:00:00.000Z"
    })).toBe(false);
  });

  it("keeps an empty success envelope reachable but unverified", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: true,
      verified: false,
      status: 200,
      error: undefined
    });
  });

  it("rejects a non-empty Images API response that explicitly names another model", async () => {
    const fetchImpl = (async () => Response.json({
      model: GPT_IMAGE_2_MODEL_ID,
      data: [{ b64_json: "probe" }]
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      modelUnavailable: true,
      error: `Provider returned model '${GPT_IMAGE_2_MODEL_ID}' for requested model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}'.`
    });
  });

  it("does not verify an empty Chat Completions SSE envelope", async () => {
    const fetchImpl = (async () => new Response(
      'data: {"choices":[]}\n\ndata: [DONE]\n',
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    )) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "chat-completions",
      "generate",
      buildOpenAIImageRouteProbeRequest("chat-completions", "generate", "gpt-image-2")
    );

    expect(probe).toMatchObject({
      modelId: "gpt-image-2",
      ok: true,
      verified: false,
      status: 200,
      error: undefined
    });
  });

  it("rejects a non-empty Chat Completions SSE response that names another model", async () => {
    const fetchImpl = (async () => new Response(
      `data: ${JSON.stringify({
        model: GPT_IMAGE_2_MODEL_ID,
        choices: [{ message: { content: "probe" } }]
      })}\n\ndata: [DONE]\n`,
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    )) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "chat-completions",
      "generate",
      buildOpenAIImageRouteProbeRequest("chat-completions", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      modelUnavailable: true,
      error: `Provider returned model '${GPT_IMAGE_2_MODEL_ID}' for requested model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}'.`
    });
  });

  it("ignores the Responses mainline model while checking the image tool output", async () => {
    const fetchImpl = (async () => Response.json({
      model: "gpt-6-astra",
      output: [{ type: "image_generation_call" }]
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "responses",
      "generate",
      buildOpenAIImageRouteProbeRequest("responses", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: true,
      verified: true,
      status: 200,
      error: undefined
    });
    expect(probe.modelIdConfirmed).toBeUndefined();
  });

  it("records an exact model-id echo from an image route", async () => {
    const fetchImpl = (async () => Response.json({
      data: [{ model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, b64_json: "probe" }]
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      ok: true,
      verified: true,
      modelIdConfirmed: true
    });
  });

  it("rejects a Responses image tool output that explicitly names another model", async () => {
    const fetchImpl = (async () => Response.json({
      model: "gpt-6-astra",
      output: [{
        type: "image_generation_call",
        model: GPT_IMAGE_2_MODEL_ID
      }]
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "responses",
      "generate",
      buildOpenAIImageRouteProbeRequest("responses", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      modelUnavailable: true,
      error: `Provider returned model '${GPT_IMAGE_2_MODEL_ID}' for requested model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}'.`
    });
  });

  it("verifies a non-empty Chat Completions SSE envelope", async () => {
    const fetchImpl = (async () => new Response(
      'data: {"choices":[{"message":{"content":"probe"}}]}\n\ndata: [DONE]\n',
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    )) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "chat-completions",
      "generate",
      buildOpenAIImageRouteProbeRequest("chat-completions", "generate", "gpt-image-2")
    );

    expect(probe).toMatchObject({
      modelId: "gpt-image-2",
      ok: true,
      verified: true,
      status: 200,
      error: undefined
    });
  });

  it("does not verify an SSE heartbeat or provider text event without an output envelope", async () => {
    const fetchImpl = (async () => new Response(
      "data: provider-heartbeat\n\ndata: image generation accepted\n\ndata: [DONE]\n",
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    )) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "chat-completions",
      "generate",
      buildOpenAIImageRouteProbeRequest("chat-completions", "generate", "gpt-image-2")
    );

    expect(probe).toMatchObject({
      modelId: "gpt-image-2",
      ok: true,
      verified: false,
      status: 200,
      error: undefined
    });
  });

  it("does not misclassify an endpoint error as a missing model", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: {
        code: "route_not_found",
        message: "The endpoint does not exist on this gateway"
      }
    }), {
      status: 404,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe.modelUnavailable).toBeUndefined();
    expect(probe.error).toBe("HTTP 404");
  });

  it("keeps the exact target model id on transport failures", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      error: "network down"
    });
  });

  it("recognizes a top-level model_not_found error from an OpenAI-compatible gateway", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      code: "model_not_found",
      message: `${GPT_IMAGE_2_5_SUNBURST_MODEL_ID} is unavailable`
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "image-api",
      "generate",
      buildOpenAIImageRouteProbeRequest("image-api", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      ok: false,
      verified: false,
      modelUnavailable: true,
      error: `${GPT_IMAGE_2_5_SUNBURST_MODEL_ID} is unavailable`
    });
  });

  it("does not treat a Responses mainline model error as GPT Image 2.5 being unavailable", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: {
        code: "model_not_found",
        message: "The model 'gpt-6-astra' does not exist"
      }
    }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const probe = await probeOpenAIImageRoute(
      fetchImpl,
      "https://api.test/v1",
      "sk-test",
      2500,
      "responses",
      "generate",
      buildOpenAIImageRouteProbeRequest("responses", "generate", GPT_IMAGE_2_5_SUNBURST_MODEL_ID)
    );

    expect(probe).toMatchObject({
      modelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      ok: false,
      verified: false,
      status: 400,
      error: "The model 'gpt-6-astra' does not exist"
    });
    expect(probe.modelUnavailable).toBeUndefined();
    expect(isOpenAIImageModelUnavailable({
      probes: [probe],
      updatedAt: "2026-09-15T00:00:00.000Z"
    })).toBe(false);
  });

  it("does not reject a model when at least one generate route is inconclusive", () => {
    expect(isOpenAIImageModelUnavailable({
      probes: [
        {
          route: "image-api",
          mode: "generate",
          endpoint: "/images/generations",
          ok: false,
          modelUnavailable: true,
          latencyMs: 1,
          status: 404
        },
        {
          route: "chat-completions",
          mode: "generate",
          endpoint: "/chat/completions",
          ok: false,
          latencyMs: 1,
          status: 500,
          error: "HTTP 500"
        }
      ],
      updatedAt: "2026-09-15T00:00:00.000Z"
    })).toBe(false);
  });

  it("builds the Responses tool shape for GPT Image 2.5 without using the image model as the mainline model", () => {
    expect(buildOpenAIImageRouteProbeRequest("responses", "edit", GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID)).toMatchObject({
      endpoint: "/responses",
      body: {
        model: "gpt-6-astra",
        input: [],
        tools: [{
          type: "image_generation",
          model: GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
          action: "edit"
        }]
      }
    });
  });

  it("removes resource prefixes while preserving the provider's exact model id", () => {
    expect(buildOpenAIImageRouteProbeRequest("image-api", "generate", "Models/GPT-IMAGE-2.5-SUNBURST")).toEqual({
      endpoint: "/images/generations",
      body: { model: "GPT-IMAGE-2.5-SUNBURST" }
    });
  });

  it("defaults GPT Image 2 probe preferences to chat when routes are only validation-reachable", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ error: { message: "validation error" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const routing = await probeOpenAIImageRouting(
      {
        ...defaultStoredConfig,
        baseURL: "https://api.test/v1",
        timeoutMs: 60000
      },
      "sk-test",
      fetchImpl,
      () => "2026-07-19T12:00:00.000Z"
    );

    expect(routing?.probes).toHaveLength(9);
    expect(routing?.probes.every((probe) => probe.ok)).toBe(true);
    expect(routing?.probes.every((probe) => probe.verified === false)).toBe(true);
    expect(routing?.preferredGenerateRoute).toBe("chat-completions");
    expect(routing?.preferredEditRoute).toBe("chat-completions");
    expect(routing?.preferredGuidedEditRoute).toBe("chat-completions");
    expect(routing?.preferredGenerateRouteVerified).toBe(false);
    expect(routing?.preferredEditRouteVerified).toBe(false);
    expect(routing?.preferredGuidedEditRouteVerified).toBe(false);
    expect(routing?.updatedAt).toBe("2026-07-19T12:00:00.000Z");
    expect(routing?.modelId).toBe("gpt-image-2");
    expect(routing?.probes.every((probe) => probe.modelId === "gpt-image-2")).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.test/v1/images/generations",
      "https://api.test/v1/images/edits",
      "https://api.test/v1/images/edits",
      "https://api.test/v1/responses",
      "https://api.test/v1/responses",
      "https://api.test/v1/responses",
      "https://api.test/v1/chat/completions",
      "https://api.test/v1/chat/completions",
      "https://api.test/v1/chat/completions"
    ]);
  });

  it("probes custom compatible providers when they already expose GPT Image 2", async () => {
    const requests: Array<string> = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ error: { message: "validation error" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const routing = await probeOpenAIImageRouting(
      {
        ...defaultStoredConfig,
        kind: "custom",
        baseURL: "https://api.test/v1",
        activeLaunchId: "gpt-image-2",
        activeModelId: "gpt-image-2",
        defaultModel: "gpt-image-2",
        discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
        timeoutMs: 60000
      },
      "sk-test",
      fetchImpl,
      () => "2026-07-19T12:00:00.000Z"
    );

    expect(routing?.probes).toHaveLength(9);
    expect(requests).toHaveLength(9);
    expect(routing?.preferredGenerateRoute).toBe("chat-completions");
    expect(routing?.preferredEditRoute).toBe("chat-completions");
    expect(routing?.preferredGuidedEditRoute).toBe("chat-completions");
    expect(routing?.modelId).toBe("gpt-image-2");
  });

  it("does not probe Chat Completions for GPT Image 2.5, including dated snapshots", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ error: { message: "validation error" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const routing = await probeOpenAIImageRouting(
      {
        ...defaultStoredConfig,
        baseURL: "https://api.test/v1",
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        activeModelId: GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
        defaultModel: GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
        timeoutMs: 60000
      },
      "sk-test",
      fetchImpl,
      () => "2026-09-10T02:00:00.000Z"
    );

    expect(routing?.probes).toHaveLength(4);
    expect(requests).toHaveLength(4);
    expect(requests.every((url) =>
      url.endsWith("/images/generations") ||
      url.endsWith("/images/edits") ||
      url.endsWith("/responses")
    )).toBe(true);
    expect(routing?.preferredGenerateRoute).toBe("image-api");
    expect(routing?.preferredEditRoute).toBe("image-api");
    expect(routing?.preferredGuidedEditRoute).toBe("image-api");
    expect(routing?.preferredGenerateRouteVerified).toBe(false);
    expect(routing?.modelId).toBe(GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID);
  });

  it("does not let a successful GPT Image 2.5 probe promote auto mode to Responses", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/images/generations")) {
        return Response.json({ data: [{ b64_json: "probe" }] });
      }
      return Response.json({ output: [] });
    }) as typeof fetch;

    const routing = await probeOpenAIImageRouting(
      {
        ...defaultStoredConfig,
        baseURL: "https://api.test/v1",
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        activeModelId: GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
        defaultModel: GPT_IMAGE_2_5_FLARE_SNAPSHOT_MODEL_ID,
        timeoutMs: 60000
      },
      "sk-test",
      fetchImpl,
      () => "2026-09-09T02:00:00.000Z"
    );

    expect(routing?.preferredGenerateRoute).toBe("image-api");
    expect(routing?.preferredEditRoute).toBe("image-api");
    expect(routing?.preferredGuidedEditRoute).toBe("image-api");
    expect(routing?.preferredGenerateRouteVerified).toBe(true);
  });

  it("keeps text-to-image route verification separate from image-to-image verification", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body instanceof FormData ? { action: "edit" } : JSON.parse(String(init?.body));
      if (target.endsWith("/images/generations")) {
        return Response.json({ data: [{ b64_json: "probe" }] });
      }
      if (target.endsWith("/responses") && body.tools?.[0]?.action === "generate") {
        return Response.json({ output: [{ type: "image_generation_call" }] });
      }
      return new Response(JSON.stringify({ error: { message: "route failed" } }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const routing = await probeOpenAIImageRouting(
      {
        ...defaultStoredConfig,
        baseURL: "https://api.test/v1",
        timeoutMs: 60000
      },
      "sk-test",
      fetchImpl,
      () => "2026-07-19T12:00:00.000Z"
    );

    expect(["image-api", "responses"]).toContain(routing?.preferredGenerateRoute);
    expect(routing?.preferredGenerateRouteVerified).toBe(true);
    expect(routing?.preferredEditRoute).toBe("chat-completions");
    expect(routing?.preferredEditRouteVerified).toBe(false);
    expect(routing?.preferredGuidedEditRoute).toBe("chat-completions");
    expect(routing?.preferredGuidedEditRouteVerified).toBe(false);
  });
});
