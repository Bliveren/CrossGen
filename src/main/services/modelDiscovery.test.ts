import { describe, expect, it, vi } from "vitest";
import { discoverModels, discoverModelsAcrossProviders, discoveryProviderOrder, sanitizeModelDiscoveryError } from "./modelDiscovery";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_test"
    }
  });
}

describe("model discovery", () => {
  it("discovers OpenAI-compatible models", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [{ id: "gpt-image-2", object: "model" }] }));

    const result = await discoverModels("openai", "https://api.openai.com/v1", "sk-test-key-that-is-long-enough", 30000, {
      fetch: fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key-that-is-long-enough"
        })
      })
    );
    expect(result.models).toEqual([
      expect.objectContaining({
        id: "gpt-image-2",
        providerKind: "openai"
      })
    ]);
  });

  it("classifies focused model ids discovered from an OpenAI-compatible model list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: "gpt-image-2", object: "model" }, { id: "gemini-3.1-flash-image", object: "model" }, { id: "gemini-3-pro-image", object: "model" }]
      })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, { fetch: fetchImpl });

    expect(result.models).toEqual([
      expect.objectContaining({ id: "gpt-image-2", providerKind: "openai" }),
      expect.objectContaining({ id: "gemini-3.1-flash-image", providerKind: "gemini" }),
      expect.objectContaining({ id: "gemini-3-pro-image", providerKind: "gemini" })
    ]);
  });

  it("discovers Gemini models and normalizes resource names", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "models/gemini-3.1-flash-image",
            displayName: "Gemini 3.1 Flash Image",
            description: "Image model"
          }
        ]
      })
    );

    const result = await discoverModels("gemini", "http://127.0.0.1:8788/v1beta", "mock-gemini-key", 30000, {
      fetch: fetchImpl
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://127.0.0.1:8788/v1beta/models?key=mock-gemini-key");
    expect(result.models).toEqual([
      expect.objectContaining({
        id: "gemini-3.1-flash-image",
        providerKind: "gemini",
        displayName: "Gemini 3.1 Flash Image"
      })
    ]);
  });

  it("merges provider probes and infers a provider when the selected protocol fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("?key=")) {
        return jsonResponse({
          models: [{ name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" }]
        });
      }
      return jsonResponse({ error: { message: "OpenAI-compatible route unavailable for gateway-key" } }, 404);
    });

    const result = await discoverModelsAcrossProviders("openai", "https://gateway.example.com/v1beta", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.inferredProviderKind).toBe("gemini");
    expect(result.models).toEqual([expect.objectContaining({ id: "gemini-3.1-flash-image", providerKind: "gemini" })]);
  });

  it("tries all protocols for an unspecified (custom) provider", () => {
    expect(discoveryProviderOrder("custom")).toEqual(["openai", "gemini", "custom"]);
    expect(discoveryProviderOrder("openai")).toEqual(["openai", "gemini"]);
    expect(discoveryProviderOrder("gemini")).toEqual(["gemini", "openai"]);
  });

  it("sanitizes API keys from discovery errors", async () => {
    const apiKey = "AIzaSyD-mock-redaction-key-should-not-leak-0000";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: `API key not valid: ${apiKey}`
          }
        },
        403
      )
    );

    await expect(discoverModels("gemini", "http://127.0.0.1:8788/v1beta", apiKey, 30000, { fetch: fetchImpl })).rejects.toThrow(
      /redacted-api-key/
    );
    await expect(discoverModels("gemini", "http://127.0.0.1:8788/v1beta", apiKey, 30000, { fetch: fetchImpl })).rejects.not.toThrow(apiKey);
    expect(sanitizeModelDiscoveryError(new Error(`Bearer ${apiKey}`), apiKey)).not.toContain(apiKey);
  });
});
