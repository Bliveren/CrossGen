import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runReadonlyMcpStdioServer, type GalleryMcpWriters, type ReadonlyMcpMode, type ReadonlyMcpReaders } from "./stdioServer";

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

async function runServer(inputText: string, options: { mode?: ReadonlyMcpMode; withWriters?: boolean } = {}) {
  const input = new PassThrough();
  const captured = captureOutput();
  const run = runReadonlyMcpStdioServer({
    mode: options.mode ?? "readonly",
    serverVersion: "0.3.0-test",
    readers: readers(),
    writers: options.withWriters ? writers() : undefined,
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
    expect(toolNames).not.toContain("crossgen_folder_create");
  });

  it("returns structured content for tool calls and tool errors", async () => {
    const { output } = await runServer(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "crossgen_config_status", arguments: {} } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "crossgen_asset_inspect", arguments: {} } })
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

  it("accepts Content-Length framed input and mirrors that framing", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const { output } = await runServer(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);

    expect(output.startsWith("Content-Length: ")).toBe(true);
    expect(output).toContain('"tools"');
    expect(output).toContain("crossgen_gallery_list");
  });
});
