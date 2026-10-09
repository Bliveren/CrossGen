import { describe, expect, it, vi } from "vitest";
import {
  addFocusedOpenAIImageCandidates,
  discoverModels,
  discoverModelsAcrossProviders,
  discoveryProviderOrder,
  probeDiscoveredModelAvailability,
  retainVerifiedDiscoveryEvidence,
  sanitizeModelDiscoveryError,
  selectActiveLaunchForDiscovery
} from "./modelDiscovery";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_FLARE_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
  GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  isDiscoveredModelLaunchable
} from "../../shared/modelCatalog";

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
  it("adds independent GPT Image 2 and 2.5 candidates only for OpenAI-compatible transports", () => {
    const models = [{ id: "text-model", providerKind: "custom" as const }];

    expect(addFocusedOpenAIImageCandidates(models, "custom")).toEqual([
      models[0],
      expect.objectContaining({
        id: GPT_IMAGE_2_MODEL_ID,
        providerKind: "openai",
        displayName: "GPT Image 2"
      }),
      expect.objectContaining({
        id: GPT_IMAGE_2_5_FLARE_MODEL_ID,
        providerKind: "openai",
        displayName: "GPT Image 2.5 · Flare"
      }),
      expect.objectContaining({
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        providerKind: "openai",
        displayName: "GPT Image 2.5 · Sunburst"
      })
    ]);

    expect(addFocusedOpenAIImageCandidates(models, "gemini")).toBe(models);
  });

  it("does not duplicate an exact focused id already returned by the provider", () => {
    const models = [{
      id: GPT_IMAGE_2_MODEL_ID,
      providerKind: "openai" as const,
      displayName: "Provider label"
    }];

    const result = addFocusedOpenAIImageCandidates(models, "openai");

    expect(result.filter((model) => model.id === GPT_IMAGE_2_MODEL_ID)).toHaveLength(1);
    expect(result.find((model) => model.id === GPT_IMAGE_2_MODEL_ID)?.displayName).toBe("Provider label");
  });

  it("never injects the bare GPT Image 2.5 launch alias as provider evidence", () => {
    const result = addFocusedOpenAIImageCandidates([], "openai");

    expect(result.map((model) => model.id)).toEqual([
      GPT_IMAGE_2_MODEL_ID,
      GPT_IMAGE_2_5_FLARE_MODEL_ID,
      GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    ]);
    expect(result.every((model) => model.discoverySource === "route-candidate")).toBe(true);
  });

  it("keeps provider-listed evidence but drops unconfirmed route candidates before persistence", () => {
    expect(retainVerifiedDiscoveryEvidence([
      { id: "text-model", providerKind: "custom", availability: "inconclusive" },
      {
        id: GPT_IMAGE_2_MODEL_ID,
        providerKind: "openai",
        discoverySource: "route-candidate",
        availability: "inconclusive"
      },
      {
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        providerKind: "openai",
        discoverySource: "route-candidate",
        availability: "confirmed"
      },
      {
        id: GPT_IMAGE_2_5_FLARE_MODEL_ID,
        providerKind: "openai",
        discoverySource: "route-candidate",
        availability: "rejected"
      }
    ])).toEqual([
      { id: "text-model", providerKind: "custom", availability: "inconclusive" },
      {
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        providerKind: "openai",
        discoverySource: "route-candidate",
        availability: "confirmed"
      }
    ]);
  });

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

  it("keeps provider model ids exact while retaining advisory display names", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{
          id: "gpt-image-2.5",
          display_name: "GPT Image 2",
          object: "model"
        }]
      })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models).toEqual([
      expect.objectContaining({
        id: "gpt-image-2.5",
        providerKind: "openai",
        displayName: "GPT Image 2"
      })
    ]);
  });

  it("preserves capability metadata from OpenAI-compatible gateways", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "paint-model", capabilities: { image_generation: true } },
          { id: "veo-3", capabilities: { video_generation: true } }
        ]
      })
    );

    const result = await discoverModels("custom", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models[0]?.raw).toEqual(expect.objectContaining({ capabilities: { image_generation: true } }));
    expect(result.models[1]?.raw).toEqual(expect.objectContaining({ capabilities: { video_generation: true } }));
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

  it("preserves a provider-listed bare GPT Image 2.5 row without promoting it to a focused launch", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: "gpt-image-2" }, { id: "gpt-image-2.5" }]
      })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, { fetch: fetchImpl });

    expect(result.models.map((model) => model.id)).toEqual(["gpt-image-2", "gpt-image-2.5"]);
    expect(result.models.map((model) => model.providerKind)).toEqual(["openai", "openai"]);
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, result.models.map((model) => ({ ...model, availability: "confirmed" as const })), "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_MODEL_ID,
      defaultModel: GPT_IMAGE_2_MODEL_ID
    });
  });

  it("selects dated GPT Image 2.5 base and variant snapshots as GPT Image 2.5", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, [{
      id: "gpt-image-2.5-2026-09-08",
      providerKind: "openai",
      displayName: "GPT Image 2",
      availability: "confirmed"
    }], "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: "gpt-image-2.5-2026-09-08",
      defaultModel: "gpt-image-2.5-2026-09-08"
    });

    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, [{
      id: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
      providerKind: "openai",
      displayName: "GPT Image 2",
      availability: "confirmed"
    }], "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID
    });
  });

  it("normalizes an OpenAI-compatible resource prefix without changing the focused family", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: "Models/GPT-IMAGE-2.5-SUNBURST", display_name: "GPT Image 2" }]
      })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models).toEqual([
      expect.objectContaining({
        id: "GPT-IMAGE-2.5-SUNBURST",
        providerKind: "openai"
      })
    ]);
  });

  it("deduplicates model ids case-insensitively within a provider response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: [{ id: "GPT-IMAGE-2.5-SUNBURST" }, { id: "gpt-image-2.5-sunburst" }] })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models).toHaveLength(1);
  });

  it("ignores non-model OpenAI catalogue objects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "gpt-image-2.5", object: "permission" },
          { id: "gpt-image-2", object: "model" }
        ]
      })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models.map((model) => model.id)).toEqual(["gpt-image-2"]);
  });

  it("ignores empty OpenAI resource ids after stripping the models prefix", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "models/", object: "model" },
          { id: "gpt-image-2", object: "model" }
        ]
      })
    );

    const result = await discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models.map((model) => model.id)).toEqual(["gpt-image-2"]);
  });

  it("selects the exact discovered GPT Image family", () => {
    const baseConfig = {
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: "gpt-image-2",
      defaultModel: "gpt-image-2"
    };

    expect(selectActiveLaunchForDiscovery(baseConfig, [
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", availability: "confirmed" }
    ], "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });

    expect(selectActiveLaunchForDiscovery(baseConfig, [
      { id: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID, providerKind: "openai", availability: "confirmed" }
    ], "openai").activeLaunchId).toBe(GPT_IMAGE_2_5_LAUNCH_ID);

    expect(selectActiveLaunchForDiscovery({
      ...baseConfig,
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_LAUNCH_ID,
      defaultModel: GPT_IMAGE_2_5_LAUNCH_ID
    }, [
      { id: "gpt-image-2", providerKind: "openai", availability: "confirmed" }
    ], "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: "gpt-image-2",
      defaultModel: "gpt-image-2"
    });
  });

  it("prefers the configured provider family when a gateway returns the same id more than once", () => {
    const models = [
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "custom" as const, availability: "confirmed" as const },
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" as const, availability: "confirmed" as const }
    ];

    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai"
    }, models, "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });
  });

  it("keeps a custom-family duplicate in General unless OpenAI is explicitly inferred", () => {
    const models = [
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" as const, availability: "confirmed" as const },
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "custom" as const, availability: "confirmed" as const }
    ];

    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "custom"
    }, models, "custom")).toEqual({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });

    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "custom"
    }, models, "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });
  });

  it("chooses a stable focused default when discovery order changes", () => {
    const selection = selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, [
      { id: "gpt-image-2", providerKind: "openai", availability: "confirmed" },
      { id: "gpt-image-2.5-flare", providerKind: "openai", availability: "confirmed" },
      { id: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID, providerKind: "openai", availability: "confirmed" },
      { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", availability: "confirmed" },
      { id: "gpt-image-2.5", providerKind: "openai", availability: "confirmed" }
    ], "openai");

    expect(selection).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });
  });

  it("does not select a focused id explicitly declared text-only", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    }, [{
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      raw: { output_modalities: ["text"] }
    }], "openai")).toEqual({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    });
  });

  it("does not classify a focused id under the wrong provider family", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    }, [{
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "gemini"
    }, {
      id: "paint-model",
      providerKind: "custom",
      displayName: "Paint image model",
      raw: { image_generation: true }
    }], "gemini")).toEqual({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "paint-model",
      defaultModel: "paint-model"
    });
  });

  it("does not promote a custom model row with a focused-looking id", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, [{
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "custom",
      displayName: "GPT Image 2"
    }], "custom")).toEqual({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });
  });

  it("uses provider-specific model normalization when retaining the active model", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "nano-banana-3",
      defaultModel: "nano-banana-3",
      providerKind: "gemini"
    }, [{
      id: "nano-banana-3",
      providerKind: "openai",
      availability: "confirmed"
    }, {
      id: "gemini-3.1-flash-image",
      providerKind: "gemini",
      availability: "confirmed"
    }], "gemini")).toEqual({
      activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
      activeModelId: "gemini-3.1-flash-image",
      defaultModel: "gemini-3.1-flash-image"
    });
  });

  it("classifies focused models returned by a custom OpenAI-compatible gateway", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, [{
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      availability: "confirmed"
    }], "custom")).toMatchObject({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });
  });

  it("falls back to a discovered Gemini image model when an OpenAI-compatible gateway has no GPT Image model", () => {
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "",
      defaultModel: ""
    }, [{
      id: "gpt-4.1",
      providerKind: "openai"
    }, {
      id: "gemini-3.1-flash-image",
      providerKind: "gemini",
      availability: "confirmed"
    }], "openai")).toMatchObject({
      activeLaunchId: "nano-banana-3",
      activeModelId: "gemini-3.1-flash-image",
      defaultModel: "gemini-3.1-flash-image"
    });
  });

  it("discovers Gemini models and normalizes resource names", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "models/gemini-3.1-flash-image",
            displayName: "Gemini 3.1 Flash Image",
            description: "Image model",
            supportedGenerationMethods: ["generateContent"]
          },
          {
            name: "models/gemini-3.1-flash-lite-image",
            displayName: "Gemini 3.1 Flash Image Lite",
            description: "Image model",
            supportedGenerationMethods: ["generateContent"]
          },
          {
            name: "models/gemini-3-pro-image",
            displayName: "Gemini 3 Pro Image",
            description: "Image model",
            supportedGenerationMethods: ["generateContent"]
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
      }),
      expect.objectContaining({
        id: "gemini-3.1-flash-lite-image",
        providerKind: "gemini",
        displayName: "Gemini 3.1 Flash Image Lite"
      }),
      expect.objectContaining({
        id: "gemini-3-pro-image",
        providerKind: "gemini",
        displayName: "Gemini 3 Pro Image"
      })
    ]);
  });

  it("filters Gemini utility-only models from image discovery", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "models/gemini-3.1-flash-image",
            displayName: "Gemini 3.1 Flash Image",
            supportedGenerationMethods: ["countTokens"]
          },
          {
            name: "models/gemini-3-pro-image",
            displayName: "Gemini 3 Pro Image",
            supportedGenerationMethods: ["generateContent", "countTokens"]
          }
        ]
      })
    );

    const result = await discoverModels("gemini", "http://127.0.0.1:8788/v1beta", "mock-gemini-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models.map((model) => model.id)).toEqual(["gemini-3-pro-image"]);
  });

  it("rejects an OpenAI discovery error returned with HTTP 200", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        error: {
          code: "model_not_found",
          message: "The provider returned a model discovery error"
        }
      })
    );

    await expect(
      discoverModels("openai", "https://gateway.example.com/v1", "gateway-key", 30000, { fetch: fetchImpl })
    ).rejects.toThrow("model discovery failed: The provider returned a model discovery error");
  });

  it("rejects a Gemini discovery error returned with HTTP 200", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        error: {
          status: "PERMISSION_DENIED",
          message: "The Gemini provider rejected this model discovery request"
        }
      })
    );

    await expect(
      discoverModels("gemini", "http://127.0.0.1:8788/v1beta", "mock-gemini-key", 30000, { fetch: fetchImpl })
    ).rejects.toThrow("Gemini model discovery failed: The Gemini provider rejected this model discovery request");
  });

  it("accepts Gemini generateContent method spelling variants", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "Models/gemini-3.1-flash-image",
            displayName: "Gemini 3.1 Flash Image",
            supportedGenerationMethods: ["GENERATE_CONTENT"]
          },
          {
            name: "models/gemini-3-pro-image",
            displayName: "Gemini 3 Pro Image",
            supportedGenerationMethods: ["generate_content", "count_tokens"]
          },
          {
            name: "models/gemini-2.0-flash",
            supportedGenerationMethods: ["count_tokens"]
          }
        ]
      })
    );

    const result = await discoverModels("gemini", "http://127.0.0.1:8788/v1beta", "mock-gemini-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image",
      "gemini-3-pro-image"
    ]);
  });

  it("confirms a focused model only when metadata and an exact lightweight route agree", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      init?.method === "GET"
        ? jsonResponse({ id: GPT_IMAGE_2_MODEL_ID })
        : jsonResponse({ data: [{ b64_json: "probe" }] })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: GPT_IMAGE_2_MODEL_ID,
        availability: "confirmed"
      })
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models/gpt-image-2",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gateway-key"
        })
      })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: GPT_IMAGE_2_MODEL_ID })
      })
    );
  });

  it("accepts a validation-only image route when metadata echoes the same exact model", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      init?.method === "GET"
        ? jsonResponse({ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID })
        : jsonResponse({ error: { message: "Missing required parameter: prompt" } }, 400)
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      availability: "confirmed"
    });
  });

  it("rejects GPT Image 2 when exact metadata explicitly denies image output", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: GPT_IMAGE_2_MODEL_ID,
        output_modalities: ["text"],
        image_generation: false
      })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_MODEL_ID,
      availability: "rejected",
      availabilityReason: "Metadata endpoint explicitly denies image output for this model."
    });
    expect(isDiscoveredModelLaunchable(result[0]!)).toBe(false);
  });

  it("rejects GPT Image 2.5 when exact metadata is text-only even if the display name is correct", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        display_name: "GPT Image 2.5",
        capabilities: { output_modalities: ["text"] }
      })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2.5" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      availability: "rejected",
      availabilityReason: "Metadata endpoint explicitly denies image output for this model."
    });
    expect(isDiscoveredModelLaunchable(result[0]!)).toBe(false);
  });

  it("does not confirm a focused model when metadata echoes a different id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: GPT_IMAGE_2_MODEL_ID })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "rejected",
      availabilityReason: "Metadata endpoint returned a different model id."
    });
  });

  it("does not treat an OpenAI-compatible metadata name as the exact model id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({
          name: "GPT Image 2.5",
          display_name: "GPT Image 2.5"
        });
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({ error: { message: "Missing required parameter: prompt" } }, 400);
      }
      return jsonResponse({ error: { message: "route unavailable" } }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      availability: "inconclusive",
      availabilityReason: "Metadata endpoint did not return an exact model id."
    });
  });

  it("does not let a display name override a mismatched OpenAI model id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: GPT_IMAGE_2_MODEL_ID,
        name: "GPT Image 2.5",
        display_name: "GPT Image 2.5"
      })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      availability: "rejected",
      availabilityReason: "Metadata endpoint returned a different model id."
    });
  });

  it("rejects GPT Image 2 when metadata echoes GPT Image 2.5", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2.5" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_MODEL_ID,
      availability: "rejected",
      availabilityReason: "Metadata endpoint returned a different model id."
    });
    expect(isDiscoveredModelLaunchable(result[0]!)).toBe(false);
  });

  it("keeps successful metadata without an exact id echo inconclusive unless the route probe verifies it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({ object: "model" });
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({ data: [{ b64_json: "probe", model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID }] });
      }
      return jsonResponse({ error: { message: "route unavailable" } }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "confirmed"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID })
      })
    );
  });

  it("keeps successful metadata without an exact id echo inconclusive when no route verifies it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({ object: "model" });
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({ error: { message: "Missing required parameter: prompt" } }, 400);
      }
      return jsonResponse({ error: { message: "Missing required parameter: input" } }, 400);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "inconclusive"
    });
  });

  it("keeps a provider-listed GPT Image 2.5 row selectable when only an empty 2xx envelope is seen", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({ message: "model endpoint not found" }, 404);
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ error: { message: "route unavailable" } }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      availability: "inconclusive"
    });
    // The row was listed by the provider, so it stays selectable: an
    // inconclusive probe must not make a listed model unusable.
    expect(isDiscoveredModelLaunchable(result[0]!)).toBe(true);
  });

  it("marks an exact model_not_found response as rejected", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      jsonResponse({
        error: {
          code: "model_not_found",
          message: "The model 'gpt-image-2' does not exist"
        }
      }, init?.method === "GET" ? 200 : 404)
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "rejected",
      availabilityReason: "The model 'gpt-image-2' does not exist"
    });
  });

  it("lets an exact image route override an inconsistent metadata model_not_found response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({
          error: {
            code: "model_not_found",
            message: `The model '${GPT_IMAGE_2_MODEL_ID}' does not exist`
          }
        });
      }
      if (target.endsWith("/chat/completions")) {
        return jsonResponse({ choices: [{ message: { content: "" } }] });
      }
      return jsonResponse({
        error: {
          code: "model_not_found",
          message: `The model '${GPT_IMAGE_2_MODEL_ID}' does not exist`
        }
      }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_MODEL_ID,
      availability: "confirmed"
    });
  });

  it("marks a message-only model does not exist response as rejected even when the id contains hyphens", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      jsonResponse({
        error: {
          message: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
        }
      }, init?.method === "GET" ? 200 : 404)
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "rejected",
      availabilityReason: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
    });
  });

  it("keeps a missing metadata endpoint inconclusive", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: "model endpoint not found" }, 404)
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "inconclusive",
      availabilityReason: "model endpoint not found"
    });
  });

  it("does not confirm GPT Image 2.5 from prompt validation when metadata is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({ message: "model endpoint not found" }, 404);
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({ error: { message: "Missing required parameter: prompt" } }, 400);
      }
      return jsonResponse({ error: { message: "Missing required parameter: input" } }, 400);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2" }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "inconclusive",
      availabilityReason: "model endpoint not found"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID })
      })
    );
  });

  it("uses route probes to reject an exact GPT Image 2.5 row and fall back to GPT Image 2", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        if (target.endsWith(`/models/${GPT_IMAGE_2_MODEL_ID}`)) {
          return jsonResponse({ id: GPT_IMAGE_2_MODEL_ID });
        }
        return jsonResponse({ message: "model endpoint not found" }, 404);
      }
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        tools?: Array<{ model?: string }>;
      };
      const requestedModel = requestBody.tools?.[0]?.model ?? requestBody.model;
      if (requestedModel === GPT_IMAGE_2_MODEL_ID) {
        return jsonResponse({ error: { message: "Missing required parameter: prompt" } }, 400);
      }
      return jsonResponse({
        error: {
          code: "model_not_found",
          message: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
        }
      }, 400);
    });

    const models = await probeDiscoveredModelAvailability(
      [
        { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2" },
        { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2.5" }
      ],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(models.find((model) => model.id === GPT_IMAGE_2_5_SUNBURST_MODEL_ID)).toMatchObject({
      availability: "rejected",
      availabilityReason: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
    });
    expect(models.find((model) => model.id === GPT_IMAGE_2_MODEL_ID)).toMatchObject({
      availability: "confirmed"
    });
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai"
    }, models, "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_MODEL_ID,
      defaultModel: GPT_IMAGE_2_MODEL_ID
    });
  });

  it("keeps GPT Image 2 and 2.5 availability independent when only GPT Image 2 is routed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        const modelId = target.endsWith(`/models/${GPT_IMAGE_2_MODEL_ID}`)
          ? GPT_IMAGE_2_MODEL_ID
          : GPT_IMAGE_2_5_SUNBURST_MODEL_ID;
        return jsonResponse({ id: modelId });
      }
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        tools?: Array<{ model?: string }>;
      };
      const requestedModel = requestBody.tools?.[0]?.model ?? requestBody.model;
      if (requestedModel === GPT_IMAGE_2_MODEL_ID) {
        return jsonResponse({ error: { message: "Missing required parameter: prompt" } }, 400);
      }
      return jsonResponse({
        error: {
          code: "model_not_found",
          message: `The model '${GPT_IMAGE_2_5_SUNBURST_MODEL_ID}' does not exist`
        }
      }, 400);
    });

    const models = await probeDiscoveredModelAvailability(
      [
        { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2.5" },
        { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2" }
      ],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(models).toEqual([
      expect.objectContaining({
        id: GPT_IMAGE_2_MODEL_ID,
        displayName: "GPT Image 2.5",
        availability: "confirmed"
      }),
      expect.objectContaining({
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        displayName: "GPT Image 2",
        availability: "rejected"
      })
    ]);
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai"
    }, models, "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_MODEL_ID,
      defaultModel: GPT_IMAGE_2_MODEL_ID
    });
  });

  it("keeps GPT Image 2 and 2.5 availability independent when only GPT Image 2.5 is routed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        const modelId = target.endsWith(`/models/${GPT_IMAGE_2_MODEL_ID}`)
          ? GPT_IMAGE_2_MODEL_ID
          : GPT_IMAGE_2_5_SUNBURST_MODEL_ID;
        return jsonResponse({ id: modelId });
      }
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        tools?: Array<{ model?: string }>;
      };
      const requestedModel = requestBody.tools?.[0]?.model ?? requestBody.model;
      if (requestedModel === GPT_IMAGE_2_5_SUNBURST_MODEL_ID) {
        return jsonResponse({ data: [{ b64_json: "probe" }] });
      }
      return jsonResponse({
        error: {
          code: "model_not_found",
          message: `The model '${GPT_IMAGE_2_MODEL_ID}' does not exist`
        }
      }, 400);
    });

    const models = await probeDiscoveredModelAvailability(
      [
        { id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2.5" },
        { id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, providerKind: "openai", displayName: "GPT Image 2" }
      ],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(models.find((model) => model.id === GPT_IMAGE_2_MODEL_ID)).toMatchObject({
      availability: "rejected"
    });
    expect(models.find((model) => model.id === GPT_IMAGE_2_5_SUNBURST_MODEL_ID)).toMatchObject({
      availability: "confirmed"
    });
    expect(selectActiveLaunchForDiscovery({
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_MODEL_ID,
      defaultModel: GPT_IMAGE_2_MODEL_ID,
      providerKind: "openai"
    }, models, "openai")).toEqual({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
    });
  });

  it("confirms GPT Image 2.5 only when an exact lightweight route probe is verified", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({ message: "model endpoint not found" }, 404);
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({
          data: [{ b64_json: "probe", model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID }]
        });
      }
      return jsonResponse({ error: { message: "route unavailable" } }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        providerKind: "openai",
        displayName: "GPT Image 2",
        discoverySource: "route-candidate"
      }],
      "custom",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      providerKind: "openai",
      availability: "confirmed",
      availabilityReason: "Confirmed by an exact image route; this model was not listed by the provider."
    });
  });

  it("does not confirm an unlisted route candidate when the gateway returns a generic image payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "GET") {
        return jsonResponse({ message: "model endpoint not found" }, 404);
      }
      if (target.endsWith("/images/generations")) {
        return jsonResponse({ data: [{ b64_json: "probe" }] });
      }
      return jsonResponse({ error: { message: "route unavailable" } }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        providerKind: "openai",
        discoverySource: "route-candidate"
      }],
      "openai",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      availability: "inconclusive"
    });
    expect(isDiscoveredModelLaunchable(result[0]!)).toBe(false);
  });

  it("confirms a Gemini image model through the Gemini metadata endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ name: `models/${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}` })
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID, providerKind: "gemini" }],
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta",
      "gemini-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
      availability: "confirmed"
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}?key=gemini-key`
    );
  });

  it("deduplicates Gemini's legacy Nano Banana alias with its provider model id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          { name: "models/nano-banana-3", displayName: "Nano Banana 3", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", supportedGenerationMethods: ["generateContent"] }
        ]
      })
    );

    const result = await discoverModels("gemini", "http://127.0.0.1:8788/v1beta", "mock-gemini-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.id).toBe("gemini-3.1-flash-image");
  });

  it("uses a fallback protocol and infers a provider when the selected protocol fails", async () => {
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
    expect(result.transportProviderKind).toBe("gemini");
    expect(result.models).toEqual([expect.objectContaining({ id: "gemini-3.1-flash-image", providerKind: "gemini" })]);
    expect(result.status).toBe(200);
    expect(result.requestId).toBe("req_test");
  });

  it("keeps the primary protocol catalogue when both protocol probes return image models", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("?key=")) {
        return jsonResponse({
          models: [{ name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" }]
        });
      }
      return jsonResponse({
        data: [{ id: "gpt-image-2", object: "model" }]
      });
    });

    const result = await discoverModelsAcrossProviders("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.inferredProviderKind).toBeUndefined();
    expect(result.transportProviderKind).toBe("openai");
    expect(result.models.map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(result.models[0]?.providerKind).toBe("openai");
  });

  it("retains an alternate protocol catalogue for stale primary focused rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("?key=")) {
        return jsonResponse({
          models: [{ name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" }]
        });
      }
      return jsonResponse({
        data: [{ id: GPT_IMAGE_2_MODEL_ID, object: "model" }]
      });
    });

    const result = await discoverModelsAcrossProviders("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.models.map((model) => model.id)).toEqual([GPT_IMAGE_2_MODEL_ID]);
    expect(result.alternateResults).toEqual([
      expect.objectContaining({
        transportProviderKind: "gemini",
        models: [expect.objectContaining({
          id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
          providerKind: "gemini"
        })]
      })
    ]);
  });

  it("uses a fallback protocol only when the primary catalogue has no runnable image model", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("?key=")) {
        return jsonResponse({
          models: [{ name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" }]
        });
      }
      return jsonResponse({
        data: [{ id: "gpt-4.1", object: "model" }]
      });
    });

    const result = await discoverModelsAcrossProviders("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.inferredProviderKind).toBe("gemini");
    expect(result.transportProviderKind).toBe("gemini");
    expect(result.models.map((model) => model.id)).toEqual(["gemini-3.1-flash-image"]);
  });

  it("keeps an OpenAI-compatible transport when its catalogue returns Gemini-family ids", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("?key=")) {
        return jsonResponse({
          models: [{ name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" }]
        });
      }
      return jsonResponse({
        data: [{ id: "gemini-3.1-flash-image", object: "model" }]
      });
    });

    const result = await discoverModelsAcrossProviders("custom", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.transportProviderKind).toBe("custom");
    expect(result.inferredProviderKind).toBeUndefined();
    expect(result.models).toEqual([
      expect.objectContaining({
        id: "gemini-3.1-flash-image",
        providerKind: "gemini"
      })
    ]);
  });

  it("probes a Gemini-family row through the configured OpenAI-compatible transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "GET") {
        return jsonResponse({ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID });
      }
      return jsonResponse({ choices: [{ message: { content: "" } }] });
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID, providerKind: "gemini" }],
      "custom",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
      availability: "confirmed"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://gateway.example.com/v1/models/${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gateway-key",
          Accept: "application/json"
        })
      })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(`"model":"${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}"`)
      })
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("?key=");
  });

  it("does not treat an OpenAI-compatible Gemini metadata name as the exact model id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "GET") {
        return jsonResponse({
          name: `models/${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}`,
          displayName: "Gemini 3.1 Flash Image"
        });
      }
      return jsonResponse({ error: { message: "route unavailable" } }, 404);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID, providerKind: "gemini" }],
      "custom",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
      availability: "inconclusive",
      availabilityReason: "Metadata endpoint did not return an exact model id."
    });
  });

  it("does not confirm a Gemini fallback row from metadata alone", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      init?.method === "GET"
        ? jsonResponse({ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID })
        : jsonResponse({ error: { message: "route unavailable" } }, 404)
    );

    const result = await probeDiscoveredModelAvailability(
      [{ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID, providerKind: "gemini" }],
      "gemini",
      "https://gateway.example.com/v1beta",
      "gateway-key",
      30000,
      { fetch: fetchImpl },
      "openai"
    );

    expect(result[0]).toMatchObject({
      id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID,
      availability: "inconclusive",
      availabilityReason: "Metadata endpoint confirmed the model id, but the configured transport did not verify image generation."
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/v1beta/chat/completions",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("rejects a Gemini model when the configured compatible transport rejects the exact id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "GET") {
        return jsonResponse({ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID });
      }
      return jsonResponse({
        error: {
          code: "model_not_found",
          message: `The model '${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}' does not exist`
        }
      }, 400);
    });

    const result = await probeDiscoveredModelAvailability(
      [{ id: GEMINI_3_1_FLASH_IMAGE_MODEL_ID, providerKind: "gemini" }],
      "custom",
      "https://gateway.example.com/v1",
      "gateway-key",
      30000,
      { fetch: fetchImpl }
    );

    expect(result[0]).toMatchObject({
      availability: "rejected",
      availabilityReason: `The model '${GEMINI_3_1_FLASH_IMAGE_MODEL_ID}' does not exist`
    });
  });

  it("does not treat a primary focused id with explicit image denial as runnable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("?key=")) {
        return jsonResponse({
          models: [{ name: "models/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" }]
        });
      }
      return jsonResponse({
        data: [{ id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID, object: "model", image_generation: false }]
      });
    });

    const result = await discoverModelsAcrossProviders("openai", "https://gateway.example.com/v1", "gateway-key", 30000, {
      fetch: fetchImpl
    });

    expect(result.inferredProviderKind).toBe("gemini");
    expect(result.models.map((model) => model.id)).toEqual(["gemini-3.1-flash-image"]);
  });

  it("keeps custom on a single OpenAI-compatible probe plus Gemini", () => {
    expect(discoveryProviderOrder("custom")).toEqual(["custom", "gemini"]);
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
