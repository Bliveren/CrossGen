import { describe, expect, it } from "vitest";
import { DEFAULT_GENERAL_IMAGE_PARAMS, DEFAULT_GEMINI_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS } from "../shared/validation";
import type { ProviderConfigInput } from "../shared/types";
import { buildProviderConfigForSave } from "./services/providerConfigSave";
import { canRunRequestWithConfig, generalReferenceEditBlockReason } from "./services/providerRequestMatch";
import { defaultStoredConfig, type StoredProviderConfig } from "./services/stateMigration";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID
} from "../shared/modelCatalog";

function savedConfig(patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  return {
    ...defaultStoredConfig,
    encryptedApiKey: "plain:c2stdZXN0LW9wZW5haS1rZXk=",
    encryption: "localFallback",
    discoveredModels: [{ id: "gpt-image-2", providerKind: "openai", availability: "confirmed" }],
    lastModelDiscoveryAt: "2026-06-09T01:02:03.000Z",
    lastModelDiscoveryError: "old discovery error",
    openAIImageRouting: {
      modelId: "gpt-image-2",
      preferredEditRoute: "chat-completions",
      probes: [{
        route: "chat-completions",
        mode: "edit",
        endpoint: "/chat/completions",
        ok: true,
        latencyMs: 80,
        status: 200
      }],
      updatedAt: "2026-06-09T01:02:03.000Z"
    },
    updatedAt: "2026-06-09T01:02:03.000Z",
    ...patch
  };
}

function input(patch: Partial<ProviderConfigInput> = {}): ProviderConfigInput {
  return {
    kind: "openai",
    baseURL: "https://api.openai.com/v1",
    defaultModel: DEFAULT_IMAGE_PARAMS.model,
    defaultSize: DEFAULT_IMAGE_PARAMS.size,
    defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
    timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
    activeLaunchId: "gpt-image-2",
    activeModelId: DEFAULT_IMAGE_PARAMS.model,
    ...patch
  };
}

describe("main config save builder", () => {
  it("preserves an existing key on same-provider saves without a new key", () => {
    const next = buildProviderConfigForSave(savedConfig({ streamingPartialsEnabled: true }), input(), "2026-06-09T02:00:00.000Z");

    expect(next.kind).toBe("openai");
    expect(next.encryptedApiKey).toBe("plain:c2stdZXN0LW9wZW5haS1rZXk=");
    expect(next.encryption).toBe("localFallback");
    expect(next.discoveredModels).toEqual([{ id: "gpt-image-2", providerKind: "openai", availability: "confirmed" }]);
    expect(next.lastModelDiscoveryAt).toBe("2026-06-09T01:02:03.000Z");
    expect(next.openAIImageRouting?.preferredEditRoute).toBe("chat-completions");
    expect(next.streamingPartialsEnabled).toBe(true);
  });

  it("invalidates route evidence when switching between GPT Image 2 and GPT Image 2.5", () => {
    const next = buildProviderConfigForSave(
      savedConfig({
        activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
        activeModelId: GPT_IMAGE_2_MODEL_ID,
        defaultModel: GPT_IMAGE_2_MODEL_ID,
        openAIImageRouting: {
          modelId: GPT_IMAGE_2_MODEL_ID,
          preferredGenerateRoute: "chat-completions",
          probes: [],
          updatedAt: "2026-06-09T01:02:03.000Z"
        }
      }),
      input({
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        activeModelId: GPT_IMAGE_2_5_MODEL_ID,
        defaultModel: GPT_IMAGE_2_5_MODEL_ID
      }),
      "2026-06-09T02:00:00.000Z"
    );

    expect(next.activeLaunchId).toBe(GPT_IMAGE_2_5_LAUNCH_ID);
    expect(next.activeModelId).toBe(GPT_IMAGE_2_5_DEFAULT_MODEL_ID);
    expect(next.openAIImageRouting).toBeUndefined();
  });

  it("does not preserve legacy route evidence without a bound model id", () => {
    const next = buildProviderConfigForSave(
      savedConfig({
        activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
        activeModelId: GPT_IMAGE_2_MODEL_ID,
        defaultModel: GPT_IMAGE_2_MODEL_ID,
        openAIImageRouting: {
          preferredGenerateRoute: "chat-completions",
          probes: [],
          updatedAt: "2026-06-09T01:02:03.000Z"
        }
      }),
      input({
        activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
        activeModelId: GPT_IMAGE_2_MODEL_ID,
        defaultModel: GPT_IMAGE_2_MODEL_ID
      }),
      "2026-06-09T02:00:00.000Z"
    );

    expect(next.openAIImageRouting).toBeUndefined();
  });

  it("invalidates discovery metadata when the same provider base URL changes", () => {
    const next = buildProviderConfigForSave(savedConfig(), input({ baseURL: "https://proxy.example.com/v1" }), "2026-06-09T02:00:00.000Z");

    expect(next.kind).toBe("openai");
    expect(next.encryptedApiKey).toBe("plain:c2stdZXN0LW9wZW5haS1rZXk=");
    expect(next.discoveredModels).toEqual([]);
    expect(next.lastModelDiscoveryAt).toBeUndefined();
    expect(next.lastModelDiscoveryError).toBeUndefined();
    expect(next.openAIImageRouting).toBeUndefined();
    expect(next.streamingPartialsEnabled).toBe(false);
  });

  it("invalidates discovery metadata when a new API key is submitted", () => {
    const next = buildProviderConfigForSave(
      savedConfig(),
      input({ apiKey: "sk-new-key-that-is-long-enough" }),
      "2026-06-09T02:00:00.000Z",
      true
    );

    expect(next.discoveredModels).toEqual([]);
    expect(next.lastModelDiscoveryAt).toBeUndefined();
    expect(next.lastModelDiscoveryError).toBeUndefined();
    expect(next.openAIImageRouting).toBeUndefined();
  });

  it("preserves saved key but clears the model selection when switching provider without a new key", () => {
    const next = buildProviderConfigForSave(
      savedConfig(),
      input({
        kind: "gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        defaultModel: "gemini-3.1-flash-image",
        activeLaunchId: "nano-banana-3",
        activeModelId: "gemini-3.1-flash-image"
      }),
      "2026-06-09T02:00:00.000Z"
    );

    expect(next.kind).toBe("gemini");
    expect(next.encryptedApiKey).toBe("plain:c2stdZXN0LW9wZW5haS1rZXk=");
    expect(next.encryption).toBe("localFallback");
    expect(next.activeLaunchId).toBe("general");
    expect(next.activeModelId).toBe("");
    expect(next.defaultModel).toBe("");
    expect(next.discoveredModels).toEqual([]);
    expect(next.lastModelDiscoveryAt).toBeUndefined();
    expect(next.lastModelDiscoveryError).toBeUndefined();
    expect(next.openAIImageRouting).toBeUndefined();
  });

  it("does not clear the key slot before a new provider key is encrypted", () => {
    const next = buildProviderConfigForSave(
      savedConfig(),
      input({
        kind: "gemini",
        apiKey: "mock-gemini-key",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        defaultModel: "gemini-3.1-flash-image",
        activeLaunchId: "nano-banana-3",
        activeModelId: "gemini-3.1-flash-image"
      }),
      "2026-06-09T02:00:00.000Z"
    );

    expect(next.kind).toBe("gemini");
    expect(next.encryptedApiKey).toBe("plain:c2stdZXN0LW9wZW5haS1rZXk=");
    expect(next.encryption).toBe("localFallback");
    expect(next.discoveredModels).toEqual([]);
    expect(next.lastModelDiscoveryAt).toBeUndefined();
  });

  it("does not trust an explicitly requested cross-provider launch before discovery", () => {
    const next = buildProviderConfigForSave(
      savedConfig(),
      input({
        kind: "gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        defaultModel: "gemini-3.1-flash-image",
        activeLaunchId: "gpt-image-2",
        activeModelId: "gpt-image-2"
      }),
      "2026-06-09T02:00:00.000Z"
    );

    expect(next.defaultModel).toBe("");
    expect(next.activeLaunchId).toBe("general");
    expect(next.activeModelId).toBe("");
  });

  it("does not trust a selected Nano Banana model until the new endpoint is discovered", () => {
    const next = buildProviderConfigForSave(
      savedConfig({ kind: "gemini" }),
      input({
        kind: "gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        defaultModel: "gemini-3-pro-image",
        activeLaunchId: "nano-banana-3",
        activeModelId: "gemini-3-pro-image"
      }),
      "2026-06-09T02:00:00.000Z"
    );

    expect(next.defaultModel).toBe("");
    expect(next.activeLaunchId).toBe("general");
    expect(next.activeModelId).toBe("");
  });

  it("allows custom providers to run discovered Gemini image models", () => {
    const provider: StoredProviderConfig = {
      ...savedConfig({
      kind: "custom",
      activeLaunchId: "gpt-image-2",
      activeModelId: "gpt-image-2",
      lastModelDiscoveryError: undefined,
      discoveredModels: [
        { id: "gemini-3.1-flash-image", providerKind: "gemini", availability: "confirmed" },
        { id: "gpt-image-2", providerKind: "openai", availability: "confirmed" }
        ]
      })
    };
    const request = {
      mode: "generate" as const,
      prompt: "test",
      inputPaths: [],
      params: {
        ...DEFAULT_GEMINI_IMAGE_PARAMS,
        providerKind: "gemini" as const,
        launchId: "nano-banana-3" as const,
        model: "gemini-3.1-flash-image"
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(true);
  });

  it("rejects a same-provider model that is absent from the latest discovery", () => {
    const provider = savedConfig({
      lastModelDiscoveryError: undefined,
      discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      activeModelId: GPT_IMAGE_2_5_MODEL_ID,
      defaultModel: GPT_IMAGE_2_5_MODEL_ID
    });
    const request = {
      mode: "generate" as const,
      prompt: "test",
      inputPaths: [],
      params: {
        ...DEFAULT_IMAGE_PARAMS,
        launchId: GPT_IMAGE_2_5_LAUNCH_ID,
        model: GPT_IMAGE_2_5_MODEL_ID
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(false);
  });

  it("rejects stale models after a discovery error even when provider kind matches", () => {
    const provider = savedConfig({
      discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
      activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
      activeModelId: "gpt-image-2",
      defaultModel: "gpt-image-2"
    });
    const request = {
      mode: "generate" as const,
      prompt: "test",
      inputPaths: [],
      params: {
        ...DEFAULT_IMAGE_PARAMS,
        model: "gpt-image-2"
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(false);
  });

  it("rejects a launch family that does not match the discovered model id", () => {
    const provider = savedConfig({
      lastModelDiscoveryError: undefined,
      discoveredModels: [{ id: GPT_IMAGE_2_MODEL_ID, providerKind: "openai" }]
    });
    const request = {
      mode: "generate" as const,
      prompt: "test",
      inputPaths: [],
      params: {
        ...DEFAULT_IMAGE_PARAMS,
        launchId: GPT_IMAGE_2_5_LAUNCH_ID,
        model: GPT_IMAGE_2_MODEL_ID
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(false);
  });

  it("blocks a General OpenAI-compatible edit without exact-id route evidence", () => {
    const provider = savedConfig({
      kind: "openai",
      lastModelDiscoveryError: undefined,
      discoveredModels: [{ id: "dall-e-3", providerKind: "openai", availability: "listed" }],
      openAIImageRouting: undefined,
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "dall-e-3",
      defaultModel: "dall-e-3"
    });
    const request = {
      mode: "edit" as const,
      prompt: "test",
      inputPaths: ["/tmp/a.png"],
      params: {
        ...DEFAULT_GENERAL_IMAGE_PARAMS,
        providerKind: "openai" as const,
        model: "dall-e-3"
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(false);
    expect(generalReferenceEditBlockReason(request, provider)).toContain("尚未确认参考图编辑路由");
  });

  it("allows a General OpenAI-compatible edit with exact-id edit route evidence", () => {
    const provider = savedConfig({
      kind: "openai",
      lastModelDiscoveryError: undefined,
      discoveredModels: [{ id: "dall-e-3", providerKind: "openai", availability: "listed" }],
      openAIImageRouting: {
        modelId: "dall-e-3",
        preferredEditRoute: "image-api",
        probes: [{
          route: "image-api",
          mode: "edit",
          modelId: "dall-e-3",
          endpoint: "/images/edits",
          ok: true,
          verified: false,
          latencyMs: 12
        }],
        updatedAt: "2026-06-09T01:02:03.000Z"
      },
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "dall-e-3",
      defaultModel: "dall-e-3"
    });
    const request = {
      mode: "edit" as const,
      prompt: "test",
      inputPaths: ["/tmp/a.png"],
      params: {
        ...DEFAULT_GENERAL_IMAGE_PARAMS,
        providerKind: "openai" as const,
        model: "dall-e-3"
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(true);
    expect(generalReferenceEditBlockReason(request, provider)).toBeUndefined();
  });

  it("honors the General reference edit kill switch even with route evidence", () => {
    const provider = savedConfig({
      kind: "openai",
      lastModelDiscoveryError: undefined,
      discoveredModels: [{ id: "dall-e-3", providerKind: "openai", availability: "listed" }],
      openAIImageRouting: {
        modelId: "dall-e-3",
        preferredEditRoute: "image-api",
        probes: [{
          route: "image-api",
          mode: "edit",
          modelId: "dall-e-3",
          endpoint: "/images/edits",
          ok: true,
          verified: false,
          latencyMs: 12
        }],
        updatedAt: "2026-06-09T01:02:03.000Z"
      },
      activeLaunchId: GENERAL_LAUNCH_ID,
      activeModelId: "dall-e-3",
      defaultModel: "dall-e-3"
    });
    const request = {
      mode: "edit" as const,
      prompt: "test",
      inputPaths: ["/tmp/a.png"],
      params: {
        ...DEFAULT_GENERAL_IMAGE_PARAMS,
        providerKind: "openai" as const,
        model: "dall-e-3"
      }
    };
    const previous = process.env.CROSSGEN_GENERAL_EDIT_ENABLED;
    process.env.CROSSGEN_GENERAL_EDIT_ENABLED = "0";
    try {
      expect(canRunRequestWithConfig(request, provider)).toBe(false);
      expect(generalReferenceEditBlockReason(request, provider)).toContain("feature flag");
    } finally {
      if (previous === undefined) delete process.env.CROSSGEN_GENERAL_EDIT_ENABLED;
      else process.env.CROSSGEN_GENERAL_EDIT_ENABLED = previous;
    }
  });

  it.each(["listed", "inconclusive", "rejected"] as const)(
    "rejects a focused model that is %s but not confirmed",
    (availability) => {
      const provider = savedConfig({
        lastModelDiscoveryError: undefined,
        discoveredModels: [{
          id: GPT_IMAGE_2_5_MODEL_ID,
          providerKind: "openai",
          availability
        }]
      });
      const request = {
        mode: "generate" as const,
        prompt: "test",
        inputPaths: [],
        params: {
          ...DEFAULT_IMAGE_PARAMS,
          launchId: GPT_IMAGE_2_5_LAUNCH_ID,
          model: GPT_IMAGE_2_5_MODEL_ID
        }
      };

      expect(canRunRequestWithConfig(request, provider)).toBe(false);
    }
  );

  it("allows an exact confirmed focused model to reach the runtime match", () => {
    const provider = savedConfig({
      lastModelDiscoveryError: undefined,
      discoveredModels: [{
        id: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
        providerKind: "openai",
        availability: "confirmed"
      }]
    });
    const request = {
      mode: "generate" as const,
      prompt: "test",
      inputPaths: [],
      params: {
        ...DEFAULT_IMAGE_PARAMS,
        launchId: GPT_IMAGE_2_5_LAUNCH_ID,
        model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID
      }
    };

    expect(canRunRequestWithConfig(request, provider)).toBe(true);
  });

  it("normalizes GPT Image 2.5 launch models and dated snapshots when saving", () => {
    const snapshot = buildProviderConfigForSave(
      savedConfig(),
      input({
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        activeModelId: ` models/${GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID} `,
        defaultModel: ` models/${GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID} `
      }),
      "2026-09-10T02:00:00.000Z"
    );

    expect(snapshot.defaultModel).toBe(GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID);
    expect(snapshot.activeModelId).toBe(GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID);

    const fallback = buildProviderConfigForSave(
      savedConfig(),
      input({
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        activeModelId: "gpt-image-2",
        defaultModel: "gpt-image-2"
      }),
      "2026-09-10T02:00:00.000Z"
    );

    expect(fallback.defaultModel).toBe(GPT_IMAGE_2_5_DEFAULT_MODEL_ID);
    expect(fallback.activeModelId).toBe(GPT_IMAGE_2_5_DEFAULT_MODEL_ID);
  });
});
