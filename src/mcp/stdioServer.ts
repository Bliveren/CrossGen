import type { Readable, Writable } from "node:stream";

export type ReadonlyMcpMode = "readonly" | "write" | "generate";

type JsonRpcId = string | number | null;
type JsonRpcObject = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface ReadonlyMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonRpcObject;
  handler: (args: JsonRpcObject) => Promise<unknown>;
}

export interface ReadonlyMcpReaders {
  configStatus(): Promise<unknown>;
  providerList(): Promise<unknown>;
  modelsList(): Promise<unknown>;
  queueStatus(): Promise<unknown>;
  jobList(): Promise<unknown>;
  folderList(): Promise<unknown>;
  galleryList(): Promise<unknown>;
  assetInspect(assetId: string): Promise<unknown | null>;
}

export interface ReadonlyMcpStdioServerOptions {
  mode: ReadonlyMcpMode;
  serverVersion: string;
  readers: ReadonlyMcpReaders;
  input?: Readable;
  output?: Writable;
  sanitizeError?: (error: unknown) => string;
}

type OutputFraming = "line" | "content-length";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const JSON_RPC_VERSION = "2.0";

function asRecord(value: unknown): JsonRpcObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRpcObject) : {};
}

function textResult(data: unknown): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function toolError(code: string, message: string, nextActions: string[] = []): ToolCallResult {
  const structuredContent = { code, message, nextActions };
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent
  };
}

function emptyObjectSchema(): JsonRpcObject {
  return {
    type: "object",
    properties: {},
    additionalProperties: false
  };
}

function assetInspectSchema(): JsonRpcObject {
  return {
    type: "object",
    properties: {
      assetId: {
        type: "string",
        description: "Gallery asset id from crossgen_gallery_list."
      }
    },
    required: ["assetId"],
    additionalProperties: false
  };
}

function readonlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}

function makeReadonlyTools(readers: ReadonlyMcpReaders): ReadonlyMcpTool[] {
  return [
    {
      name: "crossgen_config_status",
      title: "CrossGen Config Status",
      description: "Read current CrossGen provider, storage, history, Gallery, and queue status without exposing local asset paths.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.configStatus()
    },
    {
      name: "crossgen_provider_list",
      title: "CrossGen Provider List",
      description: "List configured CrossGen providers and the active provider selection.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.providerList()
    },
    {
      name: "crossgen_models_list",
      title: "CrossGen Models List",
      description: "List configured provider models and machine-readable CrossGen capability summaries.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.modelsList()
    },
    {
      name: "crossgen_queue_status",
      title: "CrossGen Queue Status",
      description: "Read durable generation queue counts and live worker host metadata.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.queueStatus()
    },
    {
      name: "crossgen_job_list",
      title: "CrossGen Job List",
      description: "List durable generation queue items, attempts, retry metadata, partial outputs, and completion status.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.jobList()
    },
    {
      name: "crossgen_folder_list",
      title: "CrossGen Folder List",
      description: "List CrossGen Gallery folders by id and display metadata.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.folderList()
    },
    {
      name: "crossgen_gallery_list",
      title: "CrossGen Gallery List",
      description: "List Gallery folders and assets without disclosing local absolute file paths.",
      inputSchema: emptyObjectSchema(),
      handler: () => readers.galleryList()
    },
    {
      name: "crossgen_asset_inspect",
      title: "CrossGen Asset Inspect",
      description: "Inspect one Gallery asset by id without disclosing the local absolute file path.",
      inputSchema: assetInspectSchema(),
      handler: async (args) => {
        const assetId = typeof args.assetId === "string" ? args.assetId.trim() : "";
        if (!assetId) {
          return toolError("INVALID_ARGUMENT", "Missing required string argument assetId.", ["Call crossgen_gallery_list first to find asset ids."]);
        }
        const asset = await readers.assetInspect(assetId);
        if (!asset) {
          return toolError("ASSET_NOT_FOUND", "Gallery asset not found.", ["Call crossgen_gallery_list first to find current asset ids."]);
        }
        return { asset };
      }
    }
  ];
}

function publicTool(tool: ReadonlyMcpTool): JsonRpcObject {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: readonlyAnnotations()
  };
}

function normalizeToolResult(value: unknown): ToolCallResult {
  if (value && typeof value === "object" && "content" in value && Array.isArray((value as ToolCallResult).content)) {
    return value as ToolCallResult;
  }
  return textResult(value);
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown): JsonRpcObject {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: id ?? null,
    result
  };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcObject {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: id ?? null,
    error: {
      code,
      message,
      data
    }
  };
}

function bufferStartsWithAscii(buffer: Buffer, value: string): boolean {
  return buffer.subarray(0, value.length).toString("ascii").toLowerCase() === value.toLowerCase();
}

function parseContentLengthHeader(header: string): number | null {
  for (const line of header.split(/\r?\n/)) {
    const [name, ...rest] = line.split(":");
    if (name?.trim().toLowerCase() !== "content-length") continue;
    const length = Number(rest.join(":").trim());
    return Number.isSafeInteger(length) && length >= 0 ? length : null;
  }
  return null;
}

function extractJsonMessages(pending: Buffer): { messages: string[]; rest: Buffer; framing?: OutputFraming } {
  let rest = pending;
  const messages: string[] = [];
  let framing: OutputFraming | undefined;

  while (rest.length > 0) {
    while (rest[0] === 10 || rest[0] === 13) rest = rest.subarray(1);
    if (rest.length === 0) break;

    if (bufferStartsWithAscii(rest, "content-length:")) {
      const crlfHeaderEnd = rest.indexOf("\r\n\r\n");
      const lfHeaderEnd = rest.indexOf("\n\n");
      const headerEnd = crlfHeaderEnd >= 0 ? crlfHeaderEnd : lfHeaderEnd;
      if (headerEnd < 0) break;
      const separatorLength = crlfHeaderEnd >= 0 ? 4 : 2;
      const header = rest.subarray(0, headerEnd).toString("utf8");
      const contentLength = parseContentLengthHeader(header);
      if (contentLength === null) {
        throw new Error("Invalid Content-Length header.");
      }
      const bodyStart = headerEnd + separatorLength;
      const bodyEnd = bodyStart + contentLength;
      if (rest.length < bodyEnd) break;
      messages.push(rest.subarray(bodyStart, bodyEnd).toString("utf8"));
      rest = rest.subarray(bodyEnd);
      framing = "content-length";
      continue;
    }

    const newlineIndex = rest.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = rest.subarray(0, newlineIndex).toString("utf8").trim();
    rest = rest.subarray(newlineIndex + 1);
    if (line) messages.push(line);
  }

  return { messages, rest, framing };
}

export async function runReadonlyMcpStdioServer(options: ReadonlyMcpStdioServerOptions): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const tools = makeReadonlyTools(options.readers);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const sanitizeError = options.sanitizeError ?? ((error: unknown) => (error instanceof Error ? error.message : String(error)));
  let pending: Buffer = Buffer.alloc(0);
  let outputFraming: OutputFraming = "line";
  let chain = Promise.resolve();

  function writeMessage(payload: JsonRpcObject): void {
    const json = JSON.stringify(payload);
    if (outputFraming === "content-length") {
      output.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
    } else {
      output.write(`${json}\n`);
    }
  }

  async function callTool(params: unknown): Promise<ToolCallResult> {
    const call = asRecord(params);
    const name = typeof call.name === "string" ? call.name : "";
    const tool = toolMap.get(name);
    if (!tool) {
      return toolError("INVALID_ARGUMENT", "Unknown CrossGen MCP tool.", [`Use tools/list to inspect available tools before calling ${name || "a tool"}.`]);
    }
    try {
      return normalizeToolResult(await tool.handler(asRecord(call.arguments)));
    } catch (error) {
      return toolError("UNKNOWN_ERROR", sanitizeError(error));
    }
  }

  async function handleRequest(request: JsonRpcRequest): Promise<void> {
    const id = request.id;
    const method = typeof request.method === "string" ? request.method : "";
    const isNotification = !("id" in request);

    if (!method) {
      if (!isNotification) writeMessage(jsonRpcError(id, -32600, "Invalid JSON-RPC request."));
      return;
    }

    if (isNotification) {
      return;
    }

    if (method === "initialize") {
      const params = asRecord(request.params);
      const protocolVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      writeMessage(
        jsonRpcResult(id, {
          protocolVersion,
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: "crossgen",
            title: "CrossGen",
            version: options.serverVersion
          },
          instructions:
            options.mode === "readonly"
              ? "CrossGen MCP is running in readonly mode. It can inspect configuration, providers, models, queue state, and Gallery metadata without exposing local asset paths."
              : "CrossGen MCP currently exposes readonly tools only. Write and generation MCP tools are reserved for later v0.3.1 phases.",
          crossgen: {
            requestedMode: options.mode,
            effectiveMode: "readonly",
            permissions: {
              readonly: true,
              write: false,
              generate: false
            }
          }
        })
      );
      return;
    }

    if (method === "ping") {
      writeMessage(jsonRpcResult(id, {}));
      return;
    }

    if (method === "tools/list") {
      writeMessage(jsonRpcResult(id, { tools: tools.map(publicTool) }));
      return;
    }

    if (method === "tools/call") {
      writeMessage(jsonRpcResult(id, await callTool(request.params)));
      return;
    }

    if (method === "resources/list") {
      writeMessage(jsonRpcResult(id, { resources: [] }));
      return;
    }

    if (method === "prompts/list") {
      writeMessage(jsonRpcResult(id, { prompts: [] }));
      return;
    }

    writeMessage(jsonRpcError(id, -32601, "Method not found."));
  }

  function enqueueJson(json: string): void {
    chain = chain.then(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        writeMessage(jsonRpcError(null, -32700, "Parse error."));
        return;
      }

      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          writeMessage(jsonRpcError(null, -32600, "Invalid JSON-RPC batch."));
          return;
        }
        for (const item of parsed) {
          await handleRequest(asRecord(item) as JsonRpcRequest);
        }
        return;
      }

      await handleRequest(asRecord(parsed) as JsonRpcRequest);
    });
  }

  return new Promise((resolve) => {
    input.on("data", (chunk: Buffer | string) => {
      try {
        pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
        const extracted = extractJsonMessages(pending);
        pending = extracted.rest;
        if (extracted.framing) outputFraming = extracted.framing;
        for (const message of extracted.messages) enqueueJson(message);
      } catch (error) {
        writeMessage(jsonRpcError(null, -32600, sanitizeError(error)));
      }
    });

    input.on("error", (error: unknown) => {
      writeMessage(jsonRpcError(null, -32603, sanitizeError(error)));
      resolve(1);
    });

    input.on("end", () => {
      const trailing = pending.toString("utf8").trim();
      if (trailing && !bufferStartsWithAscii(pending, "content-length:")) enqueueJson(trailing);
      void chain.then(() => resolve(0), () => resolve(1));
    });
  });
}
