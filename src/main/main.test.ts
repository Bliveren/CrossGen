import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_PARAMS } from "../shared/validation";
import type { ProviderConfigInput } from "../shared/types";
import { buildProviderConfigForSave } from "./services/providerConfigSave";
import { defaultStoredConfig, type StoredProviderConfig } from "./services/stateMigration";

function savedConfig(patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  return {
    ...defaultStoredConfig,
    encryptedApiKey: "plain:c2stdZXN0LW9wZW5haS1rZXk=",
    encryption: "localFallback",
    discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
    lastModelDiscoveryAt: "2026-06-09T01:02:03.000Z",
    lastModelDiscoveryError: "old discovery error",
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
    const next = buildProviderConfigForSave(savedConfig(), input(), "2026-06-09T02:00:00.000Z");

    expect(next.kind).toBe("openai");
    expect(next.encryptedApiKey).toBe("plain:c2stdZXN0LW9wZW5haS1rZXk=");
    expect(next.encryption).toBe("localFallback");
    expect(next.discoveredModels).toEqual([{ id: "gpt-image-2", providerKind: "openai" }]);
    expect(next.lastModelDiscoveryAt).toBe("2026-06-09T01:02:03.000Z");
  });

  it("invalidates discovery metadata when the same provider base URL changes", () => {
    const next = buildProviderConfigForSave(savedConfig(), input({ baseURL: "https://proxy.example.com/v1" }), "2026-06-09T02:00:00.000Z");

    expect(next.kind).toBe("openai");
    expect(next.encryptedApiKey).toBe("plain:c2stdZXN0LW9wZW5haS1rZXk=");
    expect(next.discoveredModels).toEqual([]);
    expect(next.lastModelDiscoveryAt).toBeUndefined();
    expect(next.lastModelDiscoveryError).toBeUndefined();
  });

  it("clears saved key and discovery metadata when switching provider without a new key", () => {
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
    expect(next.encryptedApiKey).toBeUndefined();
    expect(next.encryption).toBe("none");
    expect(next.activeLaunchId).toBe("nano-banana-3");
    expect(next.activeModelId).toBe("gemini-3.1-flash-image");
    expect(next.discoveredModels).toEqual([]);
    expect(next.lastModelDiscoveryAt).toBeUndefined();
    expect(next.lastModelDiscoveryError).toBeUndefined();
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

    expect(next.activeLaunchId).toBe("gpt-image-2");
    expect(next.activeModelId).toBe("gpt-image-2");
  });
});
