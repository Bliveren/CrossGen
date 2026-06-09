import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import { STATE_VERSION, normalizeState } from "./stateMigration";

const legacyParams = {
  model: "gpt-image-2",
  size: "1024x1024",
  quality: "high",
  outputFormat: "webp",
  outputCompression: 80,
  background: "opaque",
  n: 2,
  stream: false,
  partialImages: 0,
  moderation: "low",
  timeoutMs: 120000
};

describe("state migration", () => {
  it("migrates v1 config to an OpenAI provider config", () => {
    const migrated = normalizeState({
      version: 1,
      config: {
        id: "default",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1///",
        enabled: true,
        defaultModel: "gpt-image-2",
        defaultSize: "1024x1024",
        defaultQuality: "high",
        timeoutMs: 120000,
        encryptedApiKey: "plain:c2stdGVzdA==",
        encryption: "localFallback",
        updatedAt: "2026-01-02T03:04:05.000Z"
      },
      history: []
    });

    expect(migrated.version).toBe(STATE_VERSION);
    expect(migrated.config).toMatchObject({
      id: "default",
      kind: "openai",
      name: "OpenAI",
      baseURL: "https://api.openai.com/v1",
      defaultModel: "gpt-image-2",
      defaultSize: "1024x1024",
      defaultQuality: "high",
      timeoutMs: 120000,
      discoveredModels: [],
      activeLaunchId: "gpt-image-2",
      activeModelId: "gpt-image-2",
      encryptedApiKey: "plain:c2stdGVzdA==",
      encryption: "localFallback"
    });
  });

  it("migrates v1 history jobs with provider and model metadata", () => {
    const migrated = normalizeState({
      version: 1,
      config: {
        id: "provider_openai",
        baseURL: "https://api.openai.com/v1",
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 240000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      },
      history: [
        {
          id: "job_1",
          mode: "generate",
          prompt: "Generate a poster",
          inputAssets: [],
          params: legacyParams,
          status: "succeeded",
          createdAt: "2026-01-02T03:04:05.000Z",
          updatedAt: "2026-01-02T03:04:06.000Z",
          outputs: []
        }
      ]
    });

    expect(migrated.history[0]).toMatchObject({
      providerKind: "openai",
      providerId: "provider_openai",
      launchId: "gpt-image-2",
      modelId: "gpt-image-2",
      modelDisplayName: "GPT Image 2",
      params: {
        ...legacyParams,
        providerKind: "openai",
        launchId: "gpt-image-2"
      }
    });
  });

  it("migrates v1 drafts with active launch and model defaults", () => {
    const migrated = normalizeState({
      version: 1,
      config: {
        id: "default",
        baseURL: "https://api.openai.com/v1",
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 240000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      },
      history: [],
      draft: {
        mode: "edit",
        prompt: "Refine the image",
        params: legacyParams,
        inputAssets: [],
        brushSize: 48,
        updatedAt: "2026-01-02T03:04:07.000Z"
      }
    });

    expect(migrated.draft).toMatchObject({
      activeLaunchId: "gpt-image-2",
      activeModelId: "gpt-image-2",
      params: {
        providerKind: "openai",
        launchId: "gpt-image-2",
        model: "gpt-image-2"
      }
    });
  });

  it("uses GPT Image 2 defaults for malformed or missing v1 params", () => {
    const migrated = normalizeState({
      version: 1,
      config: {},
      history: [
        {
          id: "job_1",
          mode: "generate",
          prompt: "Generate",
          inputAssets: [],
          params: {},
          status: "succeeded",
          createdAt: "2026-01-02T03:04:05.000Z",
          updatedAt: "2026-01-02T03:04:06.000Z",
          outputs: []
        }
      ]
    });

    expect(migrated.history[0].params).toEqual(DEFAULT_IMAGE_PARAMS);
    expect(migrated.history[0].modelId).toBe("gpt-image-2");
    expect(migrated.history[0].modelDisplayName).toBe("GPT Image 2");
  });
});
