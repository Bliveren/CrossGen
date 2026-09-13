import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS } from "../shared/validation";
import type { ProviderConfigInput } from "../shared/types";
import { buildProviderConfigForSave } from "./services/providerConfigSave";
import { canRunRequestWithConfig } from "./services/providerRequestMatch";
import { defaultStoredConfig, type StoredProviderConfig } from "./services/stateMigration";
import {
  GPT_IMAGE_2_5_DEFAULT_MODEL_ID,
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID
} from "../shared/modelCatalog";

function savedConfig(patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  return {
    ...defaultStoredConfig,
    encryptedApiKey: "plain:c2stdZXN0LW9wZW5haS1rZXk=",
    encryption: "localFallback",
    discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
    lastModelDiscoveryAt: "2026-06-09T01:02:03.000Z",
    lastModelDiscoveryError: "old discovery error",
    openAIImageRouting: {
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
    expect(next.discoveredModels).toEqual([{ id: "gpt-image-2", providerKind: "openai" }]);
    expect(next.lastModelDiscoveryAt).toBe("2026-06-09T01:02:03.000Z");
    expect(next.openAIImageRouting?.preferredEditRoute).toBe("chat-completions");
    expect(next.streamingPartialsEnabled).toBe(true);
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

  it("preserves saved key and invalidates discovery metadata when switching provider without a new key", () => {
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
    expect(next.activeLaunchId).toBe("nano-banana-3");
    expect(next.activeModelId).toBe("gemini-3.1-flash-image");
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

  it("preserves an explicitly requested cross-provider focused launch", () => {
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

    expect(next.defaultModel).toBe("gpt-image-2");
    expect(next.activeLaunchId).toBe("gpt-image-2");
    expect(next.activeModelId).toBe("gpt-image-2");
  });

  it("preserves the selected Nano Banana model when a Gemini endpoint exposes multiple image models", () => {
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

    expect(next.defaultModel).toBe("gemini-3-pro-image");
    expect(next.activeLaunchId).toBe("nano-banana-3");
    expect(next.activeModelId).toBe("gemini-3-pro-image");
  });

  it("allows custom providers to run discovered Gemini image models", () => {
    const provider: StoredProviderConfig = {
      ...savedConfig({
        kind: "custom",
        activeLaunchId: "gpt-image-2",
        activeModelId: "gpt-image-2",
        discoveredModels: [
          { id: "gemini-3.1-flash-image", providerKind: "gemini" },
          { id: "gpt-image-2", providerKind: "openai" }
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
