import { describe, expect, it } from "vitest";
import { buildCliJobStatus, buildCliMcpConfig } from "./readonly";

function request() {
  return {
    mode: "edit" as const,
    prompt: "make it brighter",
    inputPaths: ["/private/input.png"],
    params: {
      providerKind: "openai" as const,
      launchId: "gpt-image-2" as const,
      model: "gpt-image-2",
      imageRoute: "auto" as const,
      size: "1024x1024",
      quality: "auto" as const,
      outputFormat: "png" as const,
      outputCompression: 100,
      background: "auto" as const,
      n: 1,
      stream: false,
      partialImages: 0,
      moderation: "auto" as const,
      timeoutMs: 1000
    }
  };
}

describe("readonly CLI builders", () => {
  it("builds job status without disclosing local output paths", () => {
    const queue = {
      schemaVersion: 1 as const,
      updatedAt: "2026-07-14T00:00:00.000Z",
      workerHosts: [],
      items: [
        {
          queueId: "queue-1",
          source: "cli" as const,
          providerId: "provider-1",
          request: request(),
          status: "running" as const,
          priority: 0,
          attempt: 1,
          maxAttempts: 2,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:01.000Z",
          historyJobId: "history-1",
          outputAssetIds: ["asset-1"],
          partialAssetIds: ["asset-partial"],
          cancelRequested: false,
          costConfirmed: true,
          executionKind: "sync-provider" as const,
          stage: "calling_provider" as const,
          sourceAssetIds: ["source-1"],
          outputMediaKinds: ["image" as const]
        }
      ]
    };
    const state = {
      providers: [],
      activeProviderId: "",
      galleryFolders: [],
      galleryAssets: [],
      history: [
        {
          id: "history-1",
          name: "Result",
          tags: ["test"],
          providerKind: "openai" as const,
          providerId: "provider-1",
          launchId: "gpt-image-2" as const,
          modelId: "gpt-image-2",
          modelDisplayName: "GPT Image 2",
          mode: "edit" as const,
          prompt: "make it brighter",
          inputAssets: [],
          params: request().params,
          status: "succeeded" as const,
          durationMs: 1200,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:02.000Z",
          outputs: [
            {
              id: "asset-1",
              jobId: "history-1",
              path: "/private/result.png",
              fileName: "result.png",
              mimeType: "image/png",
              sourceType: "result" as const,
              createdAt: "2026-07-14T00:00:02.000Z"
            }
          ]
        }
      ]
    };

    const result = buildCliJobStatus(queue, state, "queue-1");

    expect(result).toMatchObject({
      lookupId: "queue-1",
      source: "queue",
      canCancel: true,
      terminal: false,
      queueItem: {
        queueId: "queue-1",
        historyJobId: "history-1",
        status: "running",
        inputCount: 1,
        outputAssetIds: ["asset-1"]
      },
      historyJob: {
        id: "history-1",
        outputCount: 1,
        outputs: [{ id: "asset-1", fileName: "result.png" }]
      }
    });
    expect(result?.historyJob?.outputs[0]).not.toHaveProperty("path");
  });

  it("reports generate MCP mode without downgrading to write", () => {
    expect(buildCliMcpConfig({ client: "codex", mode: "generate", command: "/Applications/CrossGen.app" })).toMatchObject({
      requestedMode: "generate",
      mode: "generate",
      env: { CROSSGEN_MCP_MODE: "generate" },
      permissions: { readonly: true, write: true, generate: true },
      supportedModes: ["readonly", "write", "generate"],
      generateModeWarning: "Generate mode currently enqueues image generation/edit requests. Worker execution and wait-mode completion are reserved for later v0.3.1 phases."
    });
  });
});
