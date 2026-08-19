import { describe, expect, it } from "vitest";
import {
  buildOpenAIImageRouteProbeRequest,
  isRouteProbeReachableStatus,
  preferredOpenAIImageRoute,
  probeOpenAIImageRoute,
  probeOpenAIImageRouting
} from "./openaiImageRouting";
import { defaultStoredConfig } from "./stateMigration";
import type { OpenAIImageRouteProbe } from "../../shared/types";

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
  });

  it("keeps text-to-image route verification separate from image-to-image verification", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body instanceof FormData ? { action: "edit" } : JSON.parse(String(init?.body));
      if (target.endsWith("/images/generations")) {
        return Response.json({ data: [] });
      }
      if (target.endsWith("/responses") && body.tools?.[0]?.action === "generate") {
        return Response.json({ output: [] });
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
