import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import {
  GPT_IMAGE_2_5_LAUNCH_ID,
  GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID
} from "../../shared/modelCatalog";
import { STATE_VERSION, normalizeImageParams, normalizeState } from "./stateMigration";
import { sketchDocumentHash } from "../../shared/sketch";

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
  it("preserves Sketch workflow metadata in history and draft state", () => {
    const sketch = {
      schemaVersion: 1 as const,
      width: 1024,
      height: 1024,
      background: "white" as const,
      strokes: [{
        id: "stroke_1",
        tool: "brush" as const,
        color: "#1f2937",
        size: 12,
        opacity: 1,
        points: [{ x: 10, y: 10 }, { x: 200, y: 200 }]
      }]
    };
    const documentHash = sketchDocumentHash(sketch);
    const migrated = normalizeState({
      version: 4,
      activeProviderId: "default",
      providers: [{
        id: "default",
        kind: "openai",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        enabled: true,
        defaultModel: "gpt-image-2",
        defaultSize: "1024x1024",
        defaultQuality: "auto",
        timeoutMs: 120000,
        encryption: "none"
      }],
      history: [{
        id: "job_sketch",
        name: "",
        tags: [],
        providerKind: "openai",
        providerId: "default",
        launchId: "gpt-image-2",
        modelId: "gpt-image-2",
        modelDisplayName: "GPT Image 2",
        mode: "edit",
        workflow: "sketch",
        sketch: {
          artifactId: "sketch_1",
          width: 1024,
          height: 1024,
          background: "white",
          strokeCount: 1,
          pointCount: 2,
          documentHash
        },
        prompt: "Turn sketch into image",
        inputAssets: [],
        params: DEFAULT_IMAGE_PARAMS,
        status: "succeeded",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        outputs: []
      }],
      draft: {
        mode: "edit",
        workflow: "sketch",
        prompt: "draft",
        params: DEFAULT_IMAGE_PARAMS,
        inputAssets: [],
        sketch,
        brushSize: 24
      }
    });

    expect(migrated.version).toBe(STATE_VERSION);
    expect(migrated.history[0]?.workflow).toBe("sketch");
    expect(migrated.history[0]?.sketch?.documentHash).toBe(documentHash);
    expect(migrated.draft?.workflow).toBe("sketch");
    expect(migrated.draft?.sketch).toEqual(sketch);
  });

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
    expect(migrated.providers[0]).toMatchObject({
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
    expect(migrated.activeProviderId).toBe("default");
  });

  it("migrates v2 single config to providers[0]", () => {
    const migrated = normalizeState({
      version: 2,
      config: {
        id: "legacy-provider",
        kind: "gemini",
        name: "Legacy Gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        enabled: true,
        defaultModel: "gemini-3.1-flash-image",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 180000,
        discoveredModels: [{ id: "gemini-3.1-flash-image", providerKind: "gemini" }],
        activeLaunchId: "nano-banana-3",
        activeModelId: "gemini-3.1-flash-image",
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      },
      history: []
    });

    expect(migrated.version).toBe(STATE_VERSION);
    expect(migrated.providers).toHaveLength(1);
    expect(migrated.providers[0]).toMatchObject({
      id: "legacy-provider",
      kind: "gemini",
      name: "Legacy Gemini",
      activeLaunchId: "nano-banana-3",
      activeModelId: "gemini-3.1-flash-image",
      discoveredModels: [{ id: "gemini-3.1-flash-image", providerKind: "gemini" }]
    });
    expect(migrated.activeProviderId).toBe("legacy-provider");
  });

  it("adds empty prompt templates when old state has none", () => {
    const migrated = normalizeState({
      version: 2,
      config: {
        id: "legacy-provider",
        baseURL: "https://api.openai.com/v1",
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      },
      history: []
    });

    expect(migrated.promptTemplates).toEqual([]);
  });

  it("adds empty gallery assets when old state has none", () => {
    const migrated = normalizeState({
      version: 2,
      config: {
        id: "legacy-provider",
        baseURL: "https://api.openai.com/v1",
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      },
      history: []
    });

    expect(migrated.galleryAssets).toEqual([]);
    expect(migrated.galleryFolders).toEqual([]);
    expect(migrated.queueConfig).toEqual({ maxGlobalRunning: 1, providerConcurrency: {} });
  });

  it("normalizes queue concurrency config in v3 state", () => {
    const migrated = normalizeState({
      version: 3,
      activeProviderId: "default",
      providers: [{
        id: "default",
        baseURL: "https://api.openai.com/v1",
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      }],
      history: [],
      queueConfig: {
        maxGlobalRunning: 99,
        providerConcurrency: {
          " provider-1 ": 2,
          "provider-2": 0,
          "": 4
        }
      }
    });

    expect(migrated.queueConfig).toEqual({
      maxGlobalRunning: 8,
      providerConcurrency: {
        "provider-1": 2,
        "provider-2": 1
      }
    });
  });

  it("normalizes history reference preflight summaries in v3 state", () => {
    const migrated = normalizeState({
      version: 3,
      activeProviderId: "default",
      providers: [{
        id: "default",
        kind: "openai",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        enabled: true,
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      }],
      history: [{
        id: "job_1",
        mode: "edit",
        prompt: "Edit",
        inputAssets: [],
        params: DEFAULT_IMAGE_PARAMS,
        status: "failed",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:06.000Z",
        outputs: [],
        referencePreflight: [{
          id: "source",
          role: "reference",
          original: { mime: "image/png", width: 8000, height: 6000, bytes: 40_000_000 },
          request: { mime: "image/png", width: 4096, height: 3072, bytes: 10_000_000, downsampled: true },
          reason: "provider_limit",
          blocked: false
        }]
      }],
      queueConfig: { maxGlobalRunning: 1, providerConcurrency: {} }
    });

    expect(migrated.history[0].referencePreflight).toEqual([
      expect.objectContaining({
        id: "source",
        role: "reference",
        reason: "provider_limit",
        request: expect.objectContaining({ downsampled: true, width: 4096, height: 3072 })
      })
    ]);
  });

  it("preserves OpenAI image route probes in v3 provider state", () => {
    const migrated = normalizeState({
      version: 3,
      activeProviderId: "default",
      providers: [{
        id: "default",
        kind: "openai",
        name: "OpenAI",
        baseURL: "https://api.test/v1",
        enabled: true,
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        streamingPartialsEnabled: false,
        discoveredModels: [],
        activeLaunchId: "gpt-image-2",
        activeModelId: "gpt-image-2",
        openAIImageRouting: {
          preferredEditRoute: "chat-completions",
          probes: [
            {
              route: "chat-completions",
              mode: "edit",
              endpoint: "/chat/completions",
              ok: true,
              latencyMs: 96,
              status: 200
            },
            {
              route: "bad-route",
              mode: "edit",
              endpoint: "/bad",
              ok: true,
              latencyMs: 1
            }
          ],
          updatedAt: "2026-07-10T04:00:00.000Z"
        },
        updatedAt: "2026-07-10T04:00:00.000Z",
        encryption: "none"
      }],
      history: []
    });

    expect(migrated.providers[0].openAIImageRouting).toEqual({
      preferredEditRoute: "chat-completions",
      preferredGenerateRoute: undefined,
      preferredGuidedEditRoute: undefined,
      preferredEditRouteVerified: undefined,
      preferredGenerateRouteVerified: undefined,
      preferredGuidedEditRouteVerified: undefined,
      probes: [{
        route: "chat-completions",
        mode: "edit",
        endpoint: "/chat/completions",
        ok: true,
        verified: undefined,
        latencyMs: 96,
        status: 200,
        error: undefined
      }],
      updatedAt: "2026-07-10T04:00:00.000Z"
    });
  });

  it("normalizes prompt templates and filters malformed records", () => {
    const migrated = normalizeState({
      version: 3,
      providers: [
        {
          id: "default",
          baseURL: "https://api.openai.com/v1",
          defaultModel: "gpt-image-2",
          defaultSize: "auto",
          defaultQuality: "auto",
          timeoutMs: 120000,
          updatedAt: "2026-01-02T03:04:05.000Z",
          encryption: "none"
        }
      ],
      activeProviderId: "default",
      history: [],
      promptTemplates: [
        {
          id: "template-1",
          title: " Product ",
          body: " Clean product photo ",
          tags: ["product", " product ", "", 42],
          category: "commerce",
          createdAt: "2026-01-02T03:04:05.000Z",
          updatedAt: "2026-01-02T03:04:06.000Z"
        },
        { id: "template-1", title: "Duplicate", body: "Duplicate body" },
        { id: "bad-title", title: "", body: "Missing title" },
        { id: "bad-body", title: "Missing body", body: "" }
      ]
    });

    expect(migrated.promptTemplates).toEqual([
      {
        id: "template-1",
        title: "Product",
        body: "Clean product photo",
        tags: ["product"],
        category: "commerce",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:06.000Z"
      }
    ]);
  });

  it("normalizes gallery assets and filters malformed records", () => {
    const migrated = normalizeState({
      version: 3,
      providers: [
        {
          id: "default",
          baseURL: "https://api.openai.com/v1",
          defaultModel: "gpt-image-2",
          defaultSize: "auto",
          defaultQuality: "auto",
          timeoutMs: 120000,
          updatedAt: "2026-01-02T03:04:05.000Z",
          encryption: "none"
        }
      ],
      activeProviderId: "default",
      history: [],
      galleryFolders: [
        {
          id: "folder-product",
          name: " Product ",
          color: "#aabbcc",
          createdAt: "2026-01-02T03:04:01.000Z",
          updatedAt: "2026-01-02T03:04:02.000Z"
        },
        { id: "folder-product-duplicate-name", name: "Product", color: "red" },
        { id: "folder-product", name: "Duplicate" },
        { id: "bad-folder", name: "" }
      ],
      galleryAssets: [
        {
          id: "gallery-1",
          fileName: "gallery.png",
          originalName: " Gallery Source.png ",
          mimeType: "image/png",
          sizeBytes: 2048,
          width: 512,
          height: 512,
          folderId: "folder-product",
          tags: ["product", " product ", "", 42],
          source: "result",
          createdAt: "2026-01-02T03:04:05.000Z",
          updatedAt: "2026-01-02T03:04:06.000Z"
        },
        {
          id: "gallery-orphan",
          fileName: "orphan.png",
          originalName: "Orphan.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          folderId: "missing-folder"
        },
        {
          id: "gallery-foldered",
          fileName: "Product/foldered.png",
          originalName: "Foldered.png",
          mimeType: "image/png",
          sizeBytes: 512,
          folderId: "folder-product"
        },
        { id: "gallery-1", fileName: "duplicate.png", mimeType: "image/png", sizeBytes: 1 },
        { id: "escape", fileName: "../escape.png", mimeType: "image/png", sizeBytes: 1 },
        { id: "bad-mime", fileName: "bad.png", mimeType: "", sizeBytes: 1 },
        { id: "bad-size", fileName: "bad-size.png", mimeType: "image/png", sizeBytes: -1 }
      ]
    });

    expect(migrated.galleryFolders).toEqual([
      {
        id: "folder-product",
        name: "Product",
        parentId: null,
        color: "#AABBCC",
        createdAt: "2026-01-02T03:04:01.000Z",
        updatedAt: "2026-01-02T03:04:02.000Z"
      }
    ]);
    expect(migrated.galleryAssets).toEqual([
      {
        id: "gallery-1",
        fileName: "gallery.png",
        originalName: "Gallery Source.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        width: 512,
        height: 512,
        folderId: "folder-product",
        tags: ["product"],
        source: "result",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:06.000Z"
      },
      {
        id: "gallery-orphan",
        fileName: "orphan.png",
        originalName: "Orphan.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        folderId: null,
        tags: [],
        source: "import",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      },
      {
        id: "gallery-foldered",
        fileName: "Product/foldered.png",
        originalName: "Foldered.png",
        mimeType: "image/png",
        sizeBytes: 512,
        folderId: "folder-product",
        tags: [],
        source: "import",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }
    ]);
  });

  it("normalizes nested gallery folders and breaks invalid parent cycles", () => {
    const migrated = normalizeState({
      version: 3,
      providers: [
        {
          id: "default",
          baseURL: "https://api.openai.com/v1",
          defaultModel: "gpt-image-2",
          defaultSize: "auto",
          defaultQuality: "auto",
          timeoutMs: 120000,
          updatedAt: "2026-01-02T03:04:05.000Z",
          encryption: "none"
        }
      ],
      activeProviderId: "default",
      history: [],
      galleryFolders: [
        { id: "root-a", name: "Projects", createdAt: "2026-01-02T03:04:01.000Z", updatedAt: "2026-01-02T03:04:02.000Z" },
        { id: "child-a", name: "Shots", parentId: "root-a", createdAt: "2026-01-02T03:04:03.000Z", updatedAt: "2026-01-02T03:04:04.000Z" },
        { id: "root-b", name: "Shots", createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-02T03:04:06.000Z" },
        { id: "duplicate-child", name: "Shots", parentId: "root-a" },
        { id: "cycle-a", name: "Cycle A", parentId: "cycle-b" },
        { id: "cycle-b", name: "Cycle B", parentId: "cycle-a" },
        { id: "missing-parent", name: "Missing", parentId: "does-not-exist" }
      ]
    });

    expect(migrated.galleryFolders).toEqual([
      expect.objectContaining({ id: "root-a", name: "Projects", parentId: null }),
      expect.objectContaining({ id: "child-a", name: "Shots", parentId: "root-a" }),
      expect.objectContaining({ id: "root-b", name: "Shots", parentId: null }),
      expect.objectContaining({ id: "cycle-a", name: "Cycle A", parentId: null }),
      expect.objectContaining({ id: "cycle-b", name: "Cycle B", parentId: null }),
      expect.objectContaining({ id: "missing-parent", name: "Missing", parentId: null })
    ]);
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
    expect(migrated.activeProviderId).toBe("provider_openai");
  });

  it("normalizes media outputs and preserves the parent job timestamp", () => {
    const migrated = normalizeState({
      version: 3,
      activeProviderId: "default",
      providers: [{
        id: "default",
        kind: "openai",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        enabled: true,
        defaultModel: "gpt-image-2",
        defaultSize: "auto",
        defaultQuality: "auto",
        timeoutMs: 120000,
        updatedAt: "2026-01-02T03:04:05.000Z",
        encryption: "none"
      }],
      history: [{
        id: "job-media",
        mode: "generate",
        prompt: "Generate a clip",
        inputAssets: [],
        params: legacyParams,
        status: "succeeded",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:06.000Z",
        outputs: [{
          id: "output-video",
          jobId: "job-media",
          path: "/tmp/video.mp4",
          fileName: "video.mp4",
          mimeType: "video/mp4",
          sourceType: "result"
        }]
      }]
    });

    expect(migrated.history[0].outputs[0]).toMatchObject({
      id: "output-video",
      kind: "video",
      mimeType: "video/mp4",
      createdAt: "2026-01-02T03:04:05.000Z"
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

  it("defaults a GPT Image 2.5 launch to Sunburst when the model is missing", () => {
    const params = normalizeImageParams({
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      quality: "max",
      background: "transparent",
      imageRoute: "chat-completions",
      inputFidelity: "high",
      responsesModel: "gpt-6-astra",
      responsesAction: "edit",
      previousResponseId: "resp_previous"
    });

    expect(params).toMatchObject({
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      quality: "max",
      background: "transparent",
      imageRoute: "auto",
      inputFidelity: "high",
      responsesModel: "gpt-6-astra",
      responsesAction: "edit",
      previousResponseId: "resp_previous"
    });
  });

  it("preserves the optional GPT Image safety identifier during migration", () => {
    const migrated = normalizeImageParams({
      providerKind: "openai",
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      user: "  user_hash_123  "
    });

    expect(migrated).toMatchObject({
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      user: "user_hash_123"
    });
  });

  it("recognizes dated GPT Image 2.5 snapshots and removes 2.5-only fields from GPT Image 2", () => {
    const snapshot = normalizeImageParams({
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: `models/${GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID}`,
      quality: "xhigh"
    });
    expect(snapshot).toMatchObject({
      launchId: GPT_IMAGE_2_5_LAUNCH_ID,
      model: GPT_IMAGE_2_5_SUNBURST_SNAPSHOT_MODEL_ID,
      quality: "xhigh"
    });

    const legacy = normalizeImageParams({
      launchId: "gpt-image-2",
      model: "gpt-image-2",
      quality: "xhigh",
      background: "transparent",
      inputFidelity: "high",
      responsesModel: "gpt-6-astra",
      responsesAction: "edit",
      previousResponseId: "resp_previous",
      imageRoute: "chat-completions"
    });
    expect(legacy).toMatchObject({
      launchId: "gpt-image-2",
      model: "gpt-image-2",
      quality: "auto",
      background: "auto",
      imageRoute: "chat-completions"
    });
    expect(legacy).not.toHaveProperty("inputFidelity");
    expect(legacy).not.toHaveProperty("responsesModel");
    expect(legacy).not.toHaveProperty("responsesAction");
    expect(legacy).not.toHaveProperty("previousResponseId");
  });

  it("migrates a stored GPT Image 2.5 provider without a model to its default", () => {
    const migrated = normalizeState({
      version: 3,
      activeProviderId: "default",
      providers: [{
        id: "default",
        kind: "openai",
        activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
        defaultModel: "",
        activeModelId: "",
        defaultSize: "auto",
        defaultQuality: "max",
        timeoutMs: 120000,
        updatedAt: "2026-09-10T02:00:00.000Z",
        encryption: "none"
      }],
      history: []
    });

    expect(migrated.providers[0]).toMatchObject({
      activeLaunchId: GPT_IMAGE_2_5_LAUNCH_ID,
      defaultModel: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      activeModelId: GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      defaultQuality: "max"
    });
  });
});
