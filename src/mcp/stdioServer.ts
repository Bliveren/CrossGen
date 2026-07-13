import { randomUUID } from "node:crypto";
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
  annotations: JsonRpcObject;
  handler: (args: JsonRpcObject) => unknown | Promise<unknown>;
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

export interface GalleryMcpWriters {
  folderCreate(args: { name: string; parentId?: string | null }): Promise<unknown>;
  folderRename(args: { folderId: string; name: string; parentId?: string | null }): Promise<unknown>;
  folderMove(args: { folderId: string; parentId: string | null }): Promise<unknown>;
  folderDelete(args: { folderId: string; confirm: boolean }): Promise<unknown>;
  assetImport(args: { paths: string[]; folderId?: string | null; duplicateAction?: "cancel" | "replace" | "copy" }): Promise<unknown>;
  assetMove(args: { assetId: string; folderId: string | null }): Promise<unknown>;
  assetUpdate(args: { assetId: string; originalName?: string; tags?: string[]; folderId?: string | null }): Promise<unknown>;
  assetRemove(args: { assetId: string; confirm: boolean }): Promise<unknown>;
  assetPath(args: { assetId: string; confirm: boolean }): Promise<unknown>;
  assetExport(args: { assetId: string; to: string; replace?: boolean; confirm: boolean }): Promise<unknown>;
}

export interface ReadonlyMcpStdioServerOptions {
  mode: ReadonlyMcpMode;
  serverVersion: string;
  readers: ReadonlyMcpReaders;
  writers?: GalleryMcpWriters;
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

function readonlyAnnotations(): JsonRpcObject {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}

function writeAnnotations(destructive = false): JsonRpcObject {
  return {
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: false,
    openWorldHint: false
  };
}

function stringProperty(description: string): JsonRpcObject {
  return { type: "string", description };
}

function nullableStringProperty(description: string): JsonRpcObject {
  return { type: ["string", "null"], description };
}

function confirmProperty(description: string): JsonRpcObject {
  return { type: "boolean", description };
}

function objectSchema(properties: JsonRpcObject, required: string[] = []): JsonRpcObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function requiredString(args: JsonRpcObject, name: string): string | ToolCallResult {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) {
    return toolError("INVALID_ARGUMENT", `Missing required string argument ${name}.`);
  }
  return value.trim();
}

function optionalStringOrNull(args: JsonRpcObject, name: string): string | null | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(args: JsonRpcObject, name: string): string[] | ToolCallResult {
  const value = args[name];
  if (!Array.isArray(value)) {
    return toolError("INVALID_ARGUMENT", `Missing required string array argument ${name}.`);
  }
  const strings = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  if (strings.length === 0) {
    return toolError("INVALID_ARGUMENT", `Argument ${name} must contain at least one path.`);
  }
  return strings;
}

function requireConfirmed(args: JsonRpcObject, message: string): ToolCallResult | null {
  return args.confirm === true ? null : toolError("CONFIRMATION_REQUIRED", message, ["Call this tool again with confirm: true if you intend to perform this operation."]);
}

function makeReadonlyTools(readers: ReadonlyMcpReaders): ReadonlyMcpTool[] {
  return [
    {
      name: "crossgen_config_status",
      title: "CrossGen Config Status",
      description: "Read current CrossGen provider, storage, history, Gallery, and queue status without exposing local asset paths.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.configStatus()
    },
    {
      name: "crossgen_provider_list",
      title: "CrossGen Provider List",
      description: "List configured CrossGen providers and the active provider selection.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.providerList()
    },
    {
      name: "crossgen_models_list",
      title: "CrossGen Models List",
      description: "List configured provider models and machine-readable CrossGen capability summaries.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.modelsList()
    },
    {
      name: "crossgen_queue_status",
      title: "CrossGen Queue Status",
      description: "Read durable generation queue counts and live worker host metadata.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.queueStatus()
    },
    {
      name: "crossgen_job_list",
      title: "CrossGen Job List",
      description: "List durable generation queue items, attempts, retry metadata, partial outputs, and completion status.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.jobList()
    },
    {
      name: "crossgen_folder_list",
      title: "CrossGen Folder List",
      description: "List CrossGen Gallery folders by id and display metadata.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.folderList()
    },
    {
      name: "crossgen_gallery_list",
      title: "CrossGen Gallery List",
      description: "List Gallery folders and assets without disclosing local absolute file paths.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.galleryList()
    },
    {
      name: "crossgen_asset_inspect",
      title: "CrossGen Asset Inspect",
      description: "Inspect one Gallery asset by id without disclosing the local absolute file path.",
      inputSchema: assetInspectSchema(),
      annotations: readonlyAnnotations(),
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

function makeWriteTools(writers: GalleryMcpWriters): ReadonlyMcpTool[] {
  return [
    {
      name: "crossgen_folder_create",
      title: "CrossGen Folder Create",
      description: "Create a CrossGen Gallery folder.",
      inputSchema: objectSchema({
        name: stringProperty("Folder display name."),
        parentId: nullableStringProperty("Optional parent folder id.")
      }, ["name"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const name = requiredString(args, "name");
        if (typeof name !== "string") return name;
        return writers.folderCreate({ name, parentId: optionalStringOrNull(args, "parentId") });
      }
    },
    {
      name: "crossgen_folder_rename",
      title: "CrossGen Folder Rename",
      description: "Rename a CrossGen Gallery folder, optionally moving it under a new parent.",
      inputSchema: objectSchema({
        folderId: stringProperty("Folder id."),
        name: stringProperty("New folder display name."),
        parentId: nullableStringProperty("Optional new parent folder id.")
      }, ["folderId", "name"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const folderId = requiredString(args, "folderId");
        if (typeof folderId !== "string") return folderId;
        const name = requiredString(args, "name");
        if (typeof name !== "string") return name;
        return writers.folderRename({ folderId, name, parentId: optionalStringOrNull(args, "parentId") });
      }
    },
    {
      name: "crossgen_folder_move",
      title: "CrossGen Folder Move",
      description: "Move a CrossGen Gallery folder under another folder or to the root.",
      inputSchema: objectSchema({
        folderId: stringProperty("Folder id."),
        parentId: nullableStringProperty("New parent folder id, or null for root.")
      }, ["folderId", "parentId"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const folderId = requiredString(args, "folderId");
        if (typeof folderId !== "string") return folderId;
        return writers.folderMove({ folderId, parentId: optionalStringOrNull(args, "parentId") ?? null });
      }
    },
    {
      name: "crossgen_folder_delete",
      title: "CrossGen Folder Delete",
      description: "Delete a Gallery folder and move contained assets back to uncategorized.",
      inputSchema: objectSchema({
        folderId: stringProperty("Folder id."),
        confirm: confirmProperty("Must be true to delete a folder.")
      }, ["folderId", "confirm"]),
      annotations: writeAnnotations(true),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Folder deletion requires confirm: true.");
        if (confirmationError) return confirmationError;
        const folderId = requiredString(args, "folderId");
        if (typeof folderId !== "string") return folderId;
        return writers.folderDelete({ folderId, confirm: true });
      }
    },
    {
      name: "crossgen_asset_import",
      title: "CrossGen Asset Import",
      description: "Import local image files into CrossGen Gallery.",
      inputSchema: objectSchema({
        paths: { type: "array", items: { type: "string" }, description: "Local image paths to import." },
        folderId: nullableStringProperty("Optional target folder id."),
        duplicateAction: { type: "string", enum: ["cancel", "replace", "copy"], description: "How duplicate files should be handled." }
      }, ["paths"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const paths = stringArray(args, "paths");
        if (!Array.isArray(paths)) return paths;
        const duplicateAction = args.duplicateAction === "replace" || args.duplicateAction === "copy" ? args.duplicateAction : "cancel";
        return writers.assetImport({ paths, folderId: optionalStringOrNull(args, "folderId"), duplicateAction });
      }
    },
    {
      name: "crossgen_asset_move",
      title: "CrossGen Asset Move",
      description: "Move a Gallery asset to another folder or uncategorized.",
      inputSchema: objectSchema({
        assetId: stringProperty("Gallery asset id."),
        folderId: nullableStringProperty("Target folder id, or null for uncategorized.")
      }, ["assetId", "folderId"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const assetId = requiredString(args, "assetId");
        if (typeof assetId !== "string") return assetId;
        return writers.assetMove({ assetId, folderId: optionalStringOrNull(args, "folderId") ?? null });
      }
    },
    {
      name: "crossgen_asset_update",
      title: "CrossGen Asset Update",
      description: "Update Gallery asset display name, tags, or folder.",
      inputSchema: objectSchema({
        assetId: stringProperty("Gallery asset id."),
        originalName: stringProperty("Optional new file/display name."),
        tags: { type: "array", items: { type: "string" }, description: "Optional replacement tag list." },
        folderId: nullableStringProperty("Optional target folder id.")
      }, ["assetId"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const assetId = requiredString(args, "assetId");
        if (typeof assetId !== "string") return assetId;
        return writers.assetUpdate({
          assetId,
          originalName: typeof args.originalName === "string" ? args.originalName : undefined,
          tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
          folderId: optionalStringOrNull(args, "folderId")
        });
      }
    },
    {
      name: "crossgen_asset_remove",
      title: "CrossGen Asset Remove",
      description: "Remove a Gallery asset from CrossGen and delete its managed file.",
      inputSchema: objectSchema({
        assetId: stringProperty("Gallery asset id."),
        confirm: confirmProperty("Must be true to remove the asset.")
      }, ["assetId", "confirm"]),
      annotations: writeAnnotations(true),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Asset removal requires confirm: true.");
        if (confirmationError) return confirmationError;
        const assetId = requiredString(args, "assetId");
        if (typeof assetId !== "string") return assetId;
        return writers.assetRemove({ assetId, confirm: true });
      }
    },
    {
      name: "crossgen_asset_path",
      title: "CrossGen Asset Path",
      description: "Return the local absolute path for a Gallery asset after explicit confirmation.",
      inputSchema: objectSchema({
        assetId: stringProperty("Gallery asset id."),
        confirm: confirmProperty("Must be true to disclose a local absolute path.")
      }, ["assetId", "confirm"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Absolute asset path disclosure requires confirm: true.");
        if (confirmationError) return confirmationError;
        const assetId = requiredString(args, "assetId");
        if (typeof assetId !== "string") return assetId;
        return writers.assetPath({ assetId, confirm: true });
      }
    },
    {
      name: "crossgen_asset_export",
      title: "CrossGen Asset Export",
      description: "Copy a Gallery asset to a target project path after explicit confirmation.",
      inputSchema: objectSchema({
        assetId: stringProperty("Gallery asset id."),
        to: stringProperty("Target file path or directory."),
        replace: { type: "boolean", description: "Whether to replace an existing target file." },
        confirm: confirmProperty("Must be true to export the asset.")
      }, ["assetId", "to", "confirm"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Asset export requires confirm: true.");
        if (confirmationError) return confirmationError;
        const assetId = requiredString(args, "assetId");
        if (typeof assetId !== "string") return assetId;
        const to = requiredString(args, "to");
        if (typeof to !== "string") return to;
        return writers.assetExport({ assetId, to, replace: args.replace === true, confirm: true });
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
    annotations: tool.annotations
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
  const effectiveMode = options.mode === "readonly" || !options.writers ? "readonly" : "write";
  const tools = [
    ...makeReadonlyTools(options.readers),
    ...(effectiveMode === "write" && options.writers ? makeWriteTools(options.writers) : [])
  ];
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
      const requestId = typeof call.requestId === "string" && call.requestId.trim() ? call.requestId.trim() : `mcp_${randomUUID()}`;
      const result = normalizeToolResult(await tool.handler(asRecord(call.arguments)));
      if (result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)) {
        result.structuredContent = {
          schemaVersion: 1,
          requestId,
          ...(result.isError ? { error: result.structuredContent } : { data: result.structuredContent })
        };
      }
      return result;
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
            effectiveMode === "readonly"
              ? "CrossGen MCP is running in readonly mode. It can inspect configuration, providers, models, queue state, and Gallery metadata without exposing local asset paths."
              : "CrossGen MCP is running in write mode. It can inspect CrossGen state and manage Gallery folders/assets. Generation tools are reserved for later v0.3.1 phases.",
          crossgen: {
            requestedMode: options.mode,
            effectiveMode,
            permissions: {
              readonly: true,
              write: effectiveMode === "write",
              generate: false
            },
            generateModeWarning:
              options.mode === "generate"
                ? "Generation MCP tools are not implemented yet; this process exposes write-mode Gallery tools only."
                : undefined
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
