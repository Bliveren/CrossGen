import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_PARAMS, DEFAULT_GEMINI_IMAGE_PARAMS } from "../shared/validation";
import type { ProviderConfigInput, RunJobRequest } from "../shared/types";
import { buildProviderConfigForSave } from "./services/providerConfigSave";
import { defaultStoredConfig, type AppStateFile, type StoredProviderConfig } from "./services/stateMigration";
import {
  handleQueueConfigSet,
  persistInputDataUrl,
  registerIpcHandlers,
  resolveRequestInputs,
  selectProviderForRunRequest
} from "./main";

const electronMock = vi.hoisted(() => {
  const appPaths = new Map<string, string>();
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  let windows: Array<{ webContents: { send: (channel: string, payload: unknown) => void } }> = [];
  return {
    appPaths,
    ipcHandlers,
    sent,
    get windows() {
      return windows;
    },
    setWindows(next: typeof windows) {
      windows = next;
    },
    resetSent() {
      sent.length = 0;
    }
  };
});

vi.mock("electron", () => {
  const mockImage = () => ({
    isEmpty: () => false,
    getSize: () => ({ width: 4, height: 4 }),
    toBitmap: () => Buffer.from([0, 0, 0, 255]),
    resize: () => mockImage(),
    toPNG: () => Buffer.from([137, 80, 78, 71]),
    toJPEG: () => Buffer.from([255, 216, 255, 217])
  });
  return {
    app: {
      getPath: (name: string) => electronMock.appPaths.get(name) ?? process.cwd(),
      getVersion: () => "0.0.0-test",
      setName: () => undefined,
      exit: () => undefined,
      quit: () => undefined,
      on: () => undefined,
      whenReady: () => new Promise(() => undefined)
    },
    BrowserWindow: {
      getAllWindows: () => electronMock.windows
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        electronMock.ipcHandlers.set(channel, handler);
      },
      on: () => undefined
    },
    nativeImage: {
      createFromPath: () => mockImage(),
      createFromBuffer: () => mockImage()
    },
    nativeTheme: {},
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: () => undefined
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8")
    },
    shell: {
      openPath: async () => ""
    }
  };
});

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

function provider(patch: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  return {
    ...defaultStoredConfig,
    discoveredModels: [{ id: "gpt-image-2", providerKind: "openai" }],
    ...patch
  };
}

function appState(providers: StoredProviderConfig[], activeProviderId: string): AppStateFile {
  return {
    version: 3,
    providers,
    activeProviderId,
    history: [],
    promptTemplates: [],
    galleryFolders: [],
    galleryAssets: [],
    queueConfig: { maxGlobalRunning: 1, providerConcurrency: {} }
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

    expect(next.activeLaunchId).toBe("gpt-image-2");
    expect(next.activeModelId).toBe("gpt-image-2");
  });
});


describe("handleRunJob provider selection", () => {
  const openaiA = provider({ id: "openai-a", kind: "openai", name: "OpenAI A" });
  const geminiB = provider({
    id: "gemini-b",
    kind: "gemini",
    name: "Gemini B",
    activeLaunchId: "nano-banana-3",
    activeModelId: DEFAULT_GEMINI_IMAGE_PARAMS.model
  });
  const generateRequest: RunJobRequest = {
    mode: "generate",
    prompt: "prompt",
    inputPaths: [],
    params: DEFAULT_GEMINI_IMAGE_PARAMS
  };

  it("uses the per-request providerId instead of the active provider", () => {
    const result = selectProviderForRunRequest(appState([openaiA, geminiB], "openai-a"), {
      ...generateRequest,
      providerId: "gemini-b"
    });
    expect(result.id).toBe("gemini-b");
  });

  it("falls back to the active provider when providerId is omitted", () => {
    const result = selectProviderForRunRequest(appState([openaiA, geminiB], "gemini-b"), generateRequest);
    expect(result.id).toBe("gemini-b");
  });

  it("falls back to the first provider when the active provider id is not in the list", () => {
    const result = selectProviderForRunRequest(appState([openaiA, geminiB], "missing"), generateRequest);
    expect(result.id).toBe("openai-a");
  });

  it("throws a Chinese error when the requested providerId does not exist", () => {
    expect(() =>
      selectProviderForRunRequest(appState([openaiA, geminiB], "openai-a"), { ...generateRequest, providerId: "nope" })
    ).toThrow("任务对应的 API 配置不存在。");
  });

  it("throws a Chinese error when the requested provider is disabled", () => {
    const disabled = provider({ id: "openai-a", kind: "openai", enabled: false });
    expect(() => selectProviderForRunRequest(appState([disabled], "openai-a"), generateRequest)).toThrow(
      "任务对应的 API 配置已停用。"
    );
  });
});

describe("reference input data URLs (persistInputDataUrl / resolveRequestInputs)", () => {
  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw1m8QAAAABJRU5ErkJggg==";
  let imagesDir: string;

  beforeAll(async () => {
    imagesDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-images-"));
  });

  afterAll(async () => {
    await rm(imagesDir, { recursive: true, force: true });
  });

  it("persists a PNG data URL as a ref- prefixed asset that keeps the dataUrl", async () => {
    const dataUrl = `data:image/png;base64,${tinyPngBase64}`;
    const asset = await persistInputDataUrl(dataUrl, imagesDir);

    expect(asset.name.startsWith("ref-")).toBe(true);
    expect(asset.name.endsWith(".png")).toBe(true);
    expect(asset.mimeType).toBe("image/png");
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.dataUrl).toBe(dataUrl);
    await expect(readFile(asset.path)).resolves.toBeInstanceOf(Buffer);
  });

  it("maps jpeg and webp data URLs to matching extensions", async () => {
    const jpeg = await persistInputDataUrl(`data:image/jpeg;base64,${tinyPngBase64}`, imagesDir);
    expect(jpeg.name.endsWith(".jpg")).toBe(true);
    expect(jpeg.mimeType).toBe("image/jpeg");

    const webp = await persistInputDataUrl(`data:image/webp;base64,${tinyPngBase64}`, imagesDir);
    expect(webp.name.endsWith(".webp")).toBe(true);
    expect(webp.mimeType).toBe("image/webp");
  });

  it("appends persisted data-url inputs after path inputs", async () => {
    const sourcePath = path.join(imagesDir, "source.png");
    await writeFile(sourcePath, Buffer.from(tinyPngBase64, "base64"));
    const dataUrl = `data:image/png;base64,${tinyPngBase64}`;

    const { inputs, mask } = await resolveRequestInputs(
      { mode: "edit", prompt: "edit", inputPaths: [sourcePath], inputDataUrls: [dataUrl], params: DEFAULT_IMAGE_PARAMS },
      imagesDir
    );

    expect(mask).toBeUndefined();
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.path).toBe(sourcePath);
    expect(inputs[1]?.name.startsWith("ref-")).toBe(true);
    expect(inputs[1]?.dataUrl).toBe(dataUrl);
  });

  it("throws a Chinese error when combined inputs exceed the 16-image limit", async () => {
    const request: RunJobRequest = {
      mode: "edit",
      prompt: "edit",
      inputPaths: [],
      inputDataUrls: Array.from({ length: 17 }, () => `data:image/png;base64,${tinyPngBase64}`),
      params: DEFAULT_IMAGE_PARAMS
    };
    await expect(resolveRequestInputs(request, imagesDir)).rejects.toThrow("输入图片不能超过 16 张。");
  });
});

describe("queue:configSet IPC handler", () => {
  let stateRoot: string;

  beforeAll(async () => {
    stateRoot = await mkdtemp(path.join(os.tmpdir(), "crossgen-state-"));
    electronMock.appPaths.set("appData", stateRoot);
    electronMock.appPaths.set("userData", stateRoot);
  });

  afterEach(() => {
    electronMock.setWindows([]);
    electronMock.resetSent();
  });

  afterAll(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("applies a validated patch and broadcasts the queue snapshot", async () => {
    const sentChannels: string[] = [];
    electronMock.setWindows([{ webContents: { send: (channel: string) => sentChannels.push(channel) } }]);

    const result = await handleQueueConfigSet({} as never, {
      maxGlobalRunning: 4,
      providerConcurrency: { gemini: 2 },
      clearProviderIds: []
    });

    expect(result.config.maxGlobalRunning).toBe(4);
    expect(result.config.providerConcurrency).toEqual({ gemini: 2 });
    expect(sentChannels).toContain("queue:snapshot");
  });

  it("rejects an invalid patch before applying or broadcasting", async () => {
    const sentChannels: string[] = [];
    electronMock.setWindows([{ webContents: { send: (channel: string) => sentChannels.push(channel) } }]);

    await expect(handleQueueConfigSet({} as never, { maxGlobalRunning: 99 })).rejects.toThrow(
      "maxGlobalRunning 需为 1 到 8 之间的整数。"
    );
    expect(sentChannels).not.toContain("queue:snapshot");
  });

  it("registers the queue:configSet channel with the handler", () => {
    electronMock.ipcHandlers.clear();
    registerIpcHandlers();

    const handler = electronMock.ipcHandlers.get("queue:configSet");
    expect(typeof handler).toBe("function");
  });
});
