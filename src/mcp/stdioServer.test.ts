import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  runReadonlyMcpStdioServer,
  type GalleryMcpWriters,
  type GenerationMcpControllers,
  type ReadonlyMcpMode,
  type ReadonlyMcpReaders
} from "./stdioServer";

function captureOutput() {
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  return {
    output,
    text: () => Buffer.concat(chunks).toString("utf8")
  };
}

function readers(): ReadonlyMcpReaders {
  return {
    configStatus: async () => ({ stateFound: true, providerCount: 1 }),
    providerList: async () => ({ providers: [{ id: "default", name: "OpenAI" }] }),
    modelsList: async () => ({ providers: [] }),
    queueStatus: async () => ({ totalItems: 0 }),
    jobList: async () => ({ jobs: [] }),
    jobStatus: async (jobId) => (jobId === "queue-1" ? { lookupId: "queue-1", queueItem: { queueId: "queue-1", status: "running" } } : null),
    folderList: async () => ({ folders: [] }),
    galleryList: async () => ({ assets: [] }),
    assetInspect: async (assetId) => (assetId === "asset-1" ? { id: "asset-1", originalName: "sample.png" } : null)
  };
}

function writers(): GalleryMcpWriters {
  return {
    folderCreate: async ({ name }) => ({ folder: { id: "folder-1", name } }),
    folderRename: async ({ folderId, name }) => ({ folder: { id: folderId, name } }),
    folderMove: async ({ folderId, parentId }) => ({ folder: { id: folderId, parentId } }),
    folderDelete: async ({ folderId }) => ({ folderId }),
    assetImport: async ({ paths }) => ({ imported: paths.map((path) => ({ path })) }),
    assetMove: async ({ assetId, folderId }) => ({ asset: { id: assetId, folderId } }),
    assetUpdate: async ({ assetId, originalName }) => ({ asset: { id: assetId, originalName } }),
    assetRemove: async ({ assetId }) => ({ removed: { id: assetId } }),
    assetPath: async ({ assetId }) => ({ asset: { id: assetId }, path: "/tmp/sample.png" }),
    assetExport: async ({ assetId, to }) => ({ asset: { id: assetId }, exportedPath: to, replaced: false })
  };
}

function controllers(): GenerationMcpControllers {
  return {
    generationSubmit: async ({ mode, prompt, inputPaths, folderId, idempotencyKey, waitMs }) => ({
      created: true,
      duplicate: false,
      queueId: `queue-${mode}`,
      historyJobId: `history-${mode}`,
      folderId,
      idempotencyKey,
      execution: waitMs ? { mode: "waitMs", waitMs } : { mode: "async" },
      job: {
        lookupId: `queue-${mode}`,
        queueItem: { queueId: `queue-${mode}`, mode, promptPreview: prompt, inputCount: inputPaths.length, status: "queued" }
      }
    }),
    jobCancel: async ({ queueId }) => (queueId === "missing" ? null : { action: "cancel_requested", queueId, status: "running", cancelRequested: true })
  };
}

async function runServer(inputText: string, options: { mode?: ReadonlyMcpMode; withWriters?: boolean; withControllers?: boolean } = {}) {
  const input = new PassThrough();
  const captured = captureOutput();
  const run = runReadonlyMcpStdioServer({
    mode: options.mode ?? "readonly",
    serverVersion: "0.3.0-test",
    readers: readers(),
    writers: options.withWriters ? writers() : undefined,
    jobControllers: options.withControllers ? controllers() : undefined,
    input,
    output: captured.output
  });
  input.end(inputText);
  const exitCode = await run;
  return {
    exitCode,
    output: captured.text()
  };
}

function lineResponses(output: string) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("readonly MCP stdio server", () => {
  it("initializes and lists readonly tools", async () => {
    const { exitCode, output } = await runServer(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      ].join("\n")
    );

    const responses = lineResponses(output);
    expect(exitCode).toBe(0);
    expect(responses[0]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        crossgen: {
          effectiveMode: "readonly",
          permissions: { readonly: true, write: false, generate: false }
        }
      }
    });
    expect(responses[1]).toMatchObject({ id: 2 });
    const toolNames = (responses[1].result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(toolNames).toContain("crossgen_config_status");
    expect(toolNames).toContain("crossgen_job_status");
    expect(toolNames).not.toContain("crossgen_folder_create");
    expect(toolNames).not.toContain("crossgen_job_cancel");
  });

  it("returns structured content for tool calls and tool errors", async () => {
    const { output } = await runServer(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "crossgen_config_status", arguments: {} } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "crossgen_asset_inspect", arguments: {} } }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_job_status", arguments: { jobId: "queue-1" } } })
      ].join("\n")
    );

    const responses = lineResponses(output);
    expect(responses[0]).toMatchObject({
      id: 1,
      result: {
        structuredContent: {
          schemaVersion: 1,
          data: { stateFound: true, providerCount: 1 }
        }
      }
    });
    expect(responses[1]).toMatchObject({
      id: 2,
      result: {
        isError: true,
        structuredContent: {
          schemaVersion: 1,
          error: { code: "INVALID_ARGUMENT" }
        }
      }
    });
    expect(responses[2]).toMatchObject({
      id: 3,
      result: {
        structuredContent: {
          schemaVersion: 1,
          data: {
            job: {
              lookupId: "queue-1",
              queueItem: { queueId: "queue-1", status: "running" }
            }
          }
        }
      }
    });
  });

  it("registers Gallery write tools only in write mode", async () => {
    const { output } = await runServer(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_folder_create", arguments: { name: "Campaign" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "crossgen_asset_remove", arguments: { assetId: "asset-1" } } })
      ].join("\n"),
      { mode: "write", withWriters: true }
    );

    const responses = lineResponses(output);
    expect(responses[0]).toMatchObject({
      result: {
        crossgen: {
          effectiveMode: "write",
          permissions: { readonly: true, write: true, generate: false }
        }
      }
    });
    expect((responses[1].result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("crossgen_folder_create");
    expect((responses[1].result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).not.toContain("crossgen_job_cancel");
    expect(responses[2]).toMatchObject({
      result: {
        structuredContent: {
          data: { folder: { id: "folder-1", name: "Campaign" } }
        }
      }
    });
    expect(responses[3]).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: { code: "CONFIRMATION_REQUIRED" }
        }
      }
    });
  });

  it("registers job cancellation only in generate mode", async () => {
    const { output } = await runServer(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_job_cancel", arguments: { queueId: "queue-1" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "crossgen_job_cancel", arguments: { queueId: "queue-1", confirm: true } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "crossgen_job_cancel", arguments: { queueId: "missing", confirm: true } } })
      ].join("\n"),
      { mode: "generate", withWriters: true, withControllers: true }
    );

    const responses = lineResponses(output);
    expect(responses[0]).toMatchObject({
      result: {
        crossgen: {
          effectiveMode: "generate",
          permissions: { readonly: true, write: true, generate: true }
        }
      }
    });
    const toolNames = (responses[1].result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(toolNames).toContain("crossgen_folder_create");
    expect(toolNames).toContain("crossgen_generate_image");
    expect(toolNames).toContain("crossgen_edit_image");
    expect(toolNames).toContain("crossgen_job_cancel");
    expect(responses[2]).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: { code: "CONFIRMATION_REQUIRED" }
        }
      }
    });
    expect(responses[3]).toMatchObject({
      result: {
        structuredContent: {
          data: {
            action: "cancel_requested",
            queueId: "queue-1",
            cancelRequested: true
          }
        }
      }
    });
    expect(responses[4]).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: { code: "JOB_NOT_FOUND" }
        }
      }
    });
  });

  it("submits generation tools only after confirmation", async () => {
    const { output } = await runServer(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "crossgen_generate_image", arguments: { prompt: "yellow product render" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "crossgen_generate_image", arguments: { prompt: "yellow product render", folderId: "folder-1", idempotencyKey: "idem-1", confirm: true, waitMs: 250 } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crossgen_edit_image", arguments: { prompt: "make it brighter", inputPaths: ["/tmp/input.png"], folderId: "folder-2", confirm: true } } })
      ].join("\n"),
      { mode: "generate", withWriters: true, withControllers: true }
    );

    const responses = lineResponses(output);
    expect(responses[0]).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: { code: "CONFIRMATION_REQUIRED" }
        }
      }
    });
    expect(responses[1]).toMatchObject({
      result: {
        structuredContent: {
          data: {
            created: true,
            queueId: "queue-generate",
            historyJobId: "history-generate",
            folderId: "folder-1",
            idempotencyKey: "idem-1",
            execution: { mode: "waitMs", waitMs: 250 }
          }
        }
      }
    });
    expect(responses[2]).toMatchObject({
      result: {
        structuredContent: {
          data: {
            created: true,
            queueId: "queue-edit",
            folderId: "folder-2",
            job: { queueItem: { inputCount: 1 } }
          }
        }
      }
    });
  });

  it("accepts Content-Length framed input and mirrors that framing", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const { output } = await runServer(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);

    expect(output.startsWith("Content-Length: ")).toBe(true);
    expect(output).toContain('"tools"');
    expect(output).toContain("crossgen_gallery_list");
  });
});
