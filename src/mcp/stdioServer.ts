import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { JobStatus } from "../shared/types.js";

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
  queueConfig(): Promise<unknown>;
  jobList(options?: { status?: JobStatus | JobStatus[] }): Promise<unknown>;
  jobStatus(jobId: string): Promise<unknown | null>;
  folderList(): Promise<unknown>;
  folderTree(): Promise<unknown>;
  galleryList(options?: { folderId?: string | null; tags?: string[]; query?: string }): Promise<unknown>;
  assetInspect(assetId: string): Promise<unknown | null>;
}

export interface GenerationMcpControllers {
  generationSubmit(args: {
    mode: "generate" | "edit";
    prompt: string;
    inputPaths: string[];
    maskPath?: string;
    folderId?: string | null;
    providerId?: string;
    model?: string;
    idempotencyKey?: string;
    confirm: boolean;
    waitMs?: number;
    timeoutMs?: number;
    size?: string;
    quality?: string;
    aspectRatio?: string;
    resolution?: string;
  }): Promise<unknown>;
  jobCancel(args: { queueId: string; confirm: boolean }): Promise<unknown | null>;
  jobRetry(args: { jobId: string; confirm: boolean }): Promise<unknown>;
}

export interface QueueMcpControllers {
  queueConfigSet(args: {
    maxGlobalRunning?: number;
    providerConcurrency?: Record<string, number>;
    clearProviderIds?: string[];
    confirm: boolean;
  }): Promise<unknown>;
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
  queueControllers?: QueueMcpControllers;
  jobControllers?: GenerationMcpControllers;
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

function galleryToolErrorFromMessage(message: string): ToolCallResult | undefined {
  if (!message) return undefined;
  if (message.includes("文件夹名称已存在")) {
    return toolError("FOLDER_ALREADY_EXISTS", message);
  }
  if (message.includes("文件夹不存在")) {
    return toolError("FOLDER_NOT_FOUND", message, ["Use crossgen_folder_list or crossgen_folder_tree to find current folder ids."]);
  }
  if (message.includes("资源不存在")) {
    return toolError("ASSET_NOT_FOUND", message, ["Use crossgen_gallery_list or crossgen_asset_inspect to find current asset ids."]);
  }
  if (
    message.includes("不能为空") ||
    message.includes("不能包含路径分隔符") ||
    message.includes("非法字符") ||
    message.includes("不能以空格或句点结尾") ||
    message.includes("不可用于托管目录") ||
    message.includes("过长") ||
    message.includes("只能导入图片文件") ||
    message.includes("不是文件") ||
    message.includes("无法创建唯一的 Gallery 文件名") ||
    message.includes("不能将文件夹移动到自身或其子文件夹") ||
    message.includes("导出路径不能为空") ||
    message.includes("导出路径不能与原文件相同") ||
    message.includes("导出目标已存在")
  ) {
    return toolError("INVALID_ARGUMENT", message);
  }
  if (message.includes("无法操作：资源不属于 CrossGen 管理目录") || message.includes("Gallery 资源路径无效")) {
    return toolError("PATH_NOT_ALLOWED", message);
  }
  return undefined;
}

function isToolCallResult(value: unknown): value is ToolCallResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ToolCallResult).content));
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

function jobStatusSchema(): JsonRpcObject {
  return {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "Generation queue id or completed history job id from crossgen_job_list or crossgen_job_status."
      }
    },
    required: ["jobId"],
    additionalProperties: false
  };
}

function jobListSchema(): JsonRpcObject {
  return {
    type: "object",
    properties: {
      status: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ],
        description: "Optional job status filter."
      }
    },
    additionalProperties: false
  };
}

function galleryListSchema(): JsonRpcObject {
  return objectSchema({
    folderId: nullableStringProperty("Optional Gallery folder id. Use null for uncategorized assets."),
    tags: { type: "array", items: { type: "string" }, description: "Optional tags. Assets must contain all listed tags." },
    query: stringProperty("Optional text query over asset names, tags, and source ids.")
  });
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

function numberProperty(description: string): JsonRpcObject {
  return { type: "number", description };
}

function stringArrayProperty(description: string): JsonRpcObject {
  return { type: "array", items: { type: "string" }, description };
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

function optionalStringArrayForFilter(args: JsonRpcObject, name: string): string[] | ToolCallResult | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return toolError("INVALID_ARGUMENT", `${name} must be an array of strings.`);
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}

function optionalJobStatuses(args: JsonRpcObject): JobStatus[] | ToolCallResult | undefined {
  const value = args.status;
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const validStatuses = new Set<JobStatus>(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]);
  const statuses: JobStatus[] = [];
  for (const item of values) {
    if (typeof item !== "string" || !validStatuses.has(item.trim() as JobStatus)) {
      return toolError("INVALID_ARGUMENT", "status must be one of queued, running, succeeded, failed, cancelled, interrupted.");
    }
    statuses.push(item.trim() as JobStatus);
  }
  return [...new Set(statuses)];
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
      name: "crossgen_queue_config_get",
      title: "CrossGen Queue Config Get",
      description: "Read CrossGen queue concurrency limits.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.queueConfig()
    },
    {
      name: "crossgen_job_list",
      title: "CrossGen Job List",
      description: "List durable generation queue items, attempts, retry metadata, partial outputs, and completion status.",
      inputSchema: jobListSchema(),
      annotations: readonlyAnnotations(),
      handler: (args) => {
        const status = optionalJobStatuses(args);
        if (isToolCallResult(status)) return status;
        return readers.jobList({ status });
      }
    },
    {
      name: "crossgen_job_status",
      title: "CrossGen Job Status",
      description: "Inspect one durable queue item or completed history job without exposing local output paths.",
      inputSchema: jobStatusSchema(),
      annotations: readonlyAnnotations(),
      handler: async (args) => {
        const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
        if (!jobId) {
          return toolError("INVALID_ARGUMENT", "Missing required string argument jobId.", ["Call crossgen_job_list first to find queue ids."]);
        }
        const job = await readers.jobStatus(jobId);
        if (!job) {
          return toolError("JOB_NOT_FOUND", "Generation job not found.", ["Call crossgen_job_list first to find current queue ids."]);
        }
        return { job };
      }
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
      name: "crossgen_folder_tree",
      title: "CrossGen Folder Tree",
      description: "List CrossGen Gallery folders as a parent/child tree.",
      inputSchema: emptyObjectSchema(),
      annotations: readonlyAnnotations(),
      handler: () => readers.folderTree()
    },
    {
      name: "crossgen_gallery_list",
      title: "CrossGen Gallery List",
      description: "List Gallery folders and assets without disclosing local absolute file paths.",
      inputSchema: galleryListSchema(),
      annotations: readonlyAnnotations(),
      handler: (args) => {
        const tags = optionalStringArrayForFilter(args, "tags");
        if (isToolCallResult(tags)) return tags;
        return readers.galleryList({
          folderId: optionalStringOrNull(args, "folderId"),
          tags,
          query: typeof args.query === "string" ? args.query.trim() : undefined
        });
      }
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

function makeGenerationControlTools(controllers: GenerationMcpControllers): ReadonlyMcpTool[] {
  return [
    {
      name: "crossgen_generate_image",
      title: "CrossGen Generate Image",
      description: "Submit a prompt-only image generation request to the durable CrossGen queue.",
      inputSchema: objectSchema({
        prompt: stringProperty("Generation prompt."),
        providerId: stringProperty("Optional provider id. Defaults to the active provider."),
        model: stringProperty("Optional model id override."),
        folderId: nullableStringProperty("Optional Gallery folder id for generated outputs. Use null for uncategorized."),
        idempotencyKey: stringProperty("Optional key to prevent duplicate paid submissions."),
        waitMs: numberProperty("Optional short wait window in milliseconds. The MCP host still starts queue execution in generate mode."),
        timeoutMs: numberProperty("Optional request timeout in milliseconds."),
        size: stringProperty("Optional OpenAI image size, such as auto or 1024x1024."),
        quality: stringProperty("Optional OpenAI quality."),
        aspectRatio: stringProperty("Optional Gemini aspect ratio."),
        resolution: stringProperty("Optional Gemini resolution."),
        confirm: confirmProperty("Must be true to submit a paid generation request.")
      }, ["prompt", "confirm"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Image generation requires confirm: true.");
        if (confirmationError) return confirmationError;
        const prompt = requiredString(args, "prompt");
        if (typeof prompt !== "string") return prompt;
        return controllers.generationSubmit({
          mode: "generate",
          prompt,
          inputPaths: [],
          folderId: optionalStringOrNull(args, "folderId"),
          providerId: typeof args.providerId === "string" ? args.providerId.trim() : undefined,
          model: typeof args.model === "string" ? args.model.trim() : undefined,
          idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey.trim() : undefined,
          confirm: true,
          waitMs: typeof args.waitMs === "number" ? args.waitMs : undefined,
          timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
          size: typeof args.size === "string" ? args.size.trim() : undefined,
          quality: typeof args.quality === "string" ? args.quality.trim() : undefined,
          aspectRatio: typeof args.aspectRatio === "string" ? args.aspectRatio.trim() : undefined,
          resolution: typeof args.resolution === "string" ? args.resolution.trim() : undefined
        });
      }
    },
    {
      name: "crossgen_edit_image",
      title: "CrossGen Edit Image",
      description: "Submit an image edit request with local input image paths to the durable CrossGen queue.",
      inputSchema: objectSchema({
        prompt: stringProperty("Edit prompt."),
        inputPaths: { type: "array", items: { type: "string" }, description: "Local input image paths." },
        maskPath: stringProperty("Optional mask path for later inpaint-compatible flows."),
        folderId: nullableStringProperty("Optional Gallery folder id for edited outputs. Use null for uncategorized."),
        providerId: stringProperty("Optional provider id. Defaults to the active provider."),
        model: stringProperty("Optional model id override."),
        idempotencyKey: stringProperty("Optional key to prevent duplicate paid submissions."),
        waitMs: numberProperty("Optional short wait window in milliseconds. The MCP host still starts queue execution in generate mode."),
        timeoutMs: numberProperty("Optional request timeout in milliseconds."),
        size: stringProperty("Optional OpenAI image size, such as auto or 1024x1024."),
        quality: stringProperty("Optional OpenAI quality."),
        aspectRatio: stringProperty("Optional Gemini aspect ratio."),
        resolution: stringProperty("Optional Gemini resolution."),
        confirm: confirmProperty("Must be true to submit a paid edit request.")
      }, ["prompt", "inputPaths", "confirm"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Image editing requires confirm: true.");
        if (confirmationError) return confirmationError;
        const prompt = requiredString(args, "prompt");
        if (typeof prompt !== "string") return prompt;
        const inputPaths = stringArray(args, "inputPaths");
        if (!Array.isArray(inputPaths)) return inputPaths;
        return controllers.generationSubmit({
          mode: "edit",
          prompt,
          inputPaths,
          maskPath: typeof args.maskPath === "string" ? args.maskPath.trim() : undefined,
          folderId: optionalStringOrNull(args, "folderId"),
          providerId: typeof args.providerId === "string" ? args.providerId.trim() : undefined,
          model: typeof args.model === "string" ? args.model.trim() : undefined,
          idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey.trim() : undefined,
          confirm: true,
          waitMs: typeof args.waitMs === "number" ? args.waitMs : undefined,
          timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
          size: typeof args.size === "string" ? args.size.trim() : undefined,
          quality: typeof args.quality === "string" ? args.quality.trim() : undefined,
          aspectRatio: typeof args.aspectRatio === "string" ? args.aspectRatio.trim() : undefined,
          resolution: typeof args.resolution === "string" ? args.resolution.trim() : undefined
        });
      }
    },
    {
      name: "crossgen_job_cancel",
      title: "CrossGen Job Cancel",
      description: "Request cancellation for a queued or running durable generation queue item.",
      inputSchema: objectSchema({
        queueId: stringProperty("Durable generation queue id."),
        confirm: confirmProperty("Must be true to request cancellation.")
      }, ["queueId", "confirm"]),
      annotations: writeAnnotations(true),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Job cancellation requires confirm: true.");
        if (confirmationError) return confirmationError;
        const queueId = requiredString(args, "queueId");
        if (typeof queueId !== "string") return queueId;
        return controllers.jobCancel({ queueId, confirm: true }).then((result) => {
          if (!result) {
            return toolError("JOB_NOT_FOUND", "Generation queue item not found.", ["Call crossgen_job_list first to find current queue ids."]);
          }
          return result;
        });
      }
    },
    {
      name: "crossgen_job_retry",
      title: "CrossGen Job Retry",
      description: "Requeue a failed, cancelled, or interrupted durable generation job.",
      inputSchema: objectSchema({
        jobId: stringProperty("Durable generation queue id or history job id."),
        confirm: confirmProperty("Must be true to retry the job.")
      }, ["jobId", "confirm"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Job retry requires confirm: true.");
        if (confirmationError) return confirmationError;
        const jobId = requiredString(args, "jobId");
        if (typeof jobId !== "string") return jobId;
        return controllers.jobRetry({ jobId, confirm: true }).then((result) => {
          const action = asRecord(result).action;
          if (action === "not_found") {
            return toolError("JOB_NOT_FOUND", "Generation job not found.", ["Call crossgen_job_list first to find current queue ids."]);
          }
          if (action === "not_retryable") {
            return toolError("INVALID_ARGUMENT", "Generation job is not retryable.", ["Only failed, cancelled, or interrupted generation jobs can be retried."]);
          }
          return result;
        });
      }
    }
  ];
}

function queueConfigProviderConcurrency(args: JsonRpcObject): Record<string, number> | ToolCallResult | undefined {
  const raw = args.providerConcurrency;
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return toolError("INVALID_ARGUMENT", "providerConcurrency must be an object keyed by provider id.");
  }
  const providerConcurrency: Record<string, number> = {};
  for (const [providerId, value] of Object.entries(raw as JsonRpcObject)) {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId || typeof value !== "number" || !Number.isSafeInteger(value)) {
      return toolError("INVALID_ARGUMENT", "providerConcurrency values must be integer numbers keyed by non-empty provider ids.");
    }
    providerConcurrency[normalizedProviderId] = value;
  }
  return providerConcurrency;
}

function optionalStringArray(args: JsonRpcObject, name: string): string[] | ToolCallResult | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return toolError("INVALID_ARGUMENT", `${name} must be an array of strings.`);
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}

function makeQueueConfigWriteTools(controllers: QueueMcpControllers): ReadonlyMcpTool[] {
  return [
    {
      name: "crossgen_queue_config_set",
      title: "CrossGen Queue Config Set",
      description: "Update CrossGen queue concurrency limits.",
      inputSchema: objectSchema({
        maxGlobalRunning: numberProperty("Optional max number of globally running generation jobs."),
        providerConcurrency: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Optional provider-specific concurrency map keyed by provider id."
        },
        clearProviderIds: stringArrayProperty("Optional provider ids to remove from provider-specific concurrency limits."),
        confirm: confirmProperty("Must be true to update queue concurrency limits.")
      }, ["confirm"]),
      annotations: writeAnnotations(),
      handler: (args) => {
        const confirmationError = requireConfirmed(args, "Queue configuration changes require confirm: true.");
        if (confirmationError) return confirmationError;
        const providerConcurrency = queueConfigProviderConcurrency(args);
        if (isToolCallResult(providerConcurrency)) return providerConcurrency;
        const clearProviderIds = optionalStringArray(args, "clearProviderIds");
        if (isToolCallResult(clearProviderIds)) return clearProviderIds;
        const maxGlobalRunning = typeof args.maxGlobalRunning === "number" ? args.maxGlobalRunning : undefined;
        if (maxGlobalRunning === undefined && providerConcurrency === undefined && clearProviderIds === undefined) {
          return toolError("INVALID_ARGUMENT", "No queue configuration fields were provided.");
        }
        return controllers.queueConfigSet({
          maxGlobalRunning,
          providerConcurrency,
          clearProviderIds,
          confirm: true
        });
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
  const effectiveMode: ReadonlyMcpMode =
    options.mode === "generate" && options.jobControllers
      ? "generate"
      : options.mode !== "readonly" && options.writers
      ? "write"
      : "readonly";
  const tools = [
    ...makeReadonlyTools(options.readers),
    ...(effectiveMode !== "readonly" && options.writers ? makeWriteTools(options.writers) : []),
    ...(effectiveMode !== "readonly" && options.queueControllers ? makeQueueConfigWriteTools(options.queueControllers) : []),
    ...(effectiveMode === "generate" && options.jobControllers ? makeGenerationControlTools(options.jobControllers) : [])
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
    const requestId = typeof call.requestId === "string" && call.requestId.trim() ? call.requestId.trim() : `mcp_${randomUUID()}`;
    const withSchemaEnvelope = (result: ToolCallResult): ToolCallResult => {
      if (result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)) {
        result.structuredContent = {
          schemaVersion: 1,
          requestId,
          ...(result.isError ? { error: result.structuredContent } : { data: result.structuredContent })
        };
      }
      return result;
    };
    try {
      const result = normalizeToolResult(await tool.handler(asRecord(call.arguments)));
      return withSchemaEnvelope(result);
    } catch (error) {
      const message = sanitizeError(error);
      const galleryError = galleryToolErrorFromMessage(message);
      if (galleryError) {
        return withSchemaEnvelope(galleryError);
      }
      return withSchemaEnvelope(toolError("UNKNOWN_ERROR", message));
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
              : effectiveMode === "write"
              ? "CrossGen MCP is running in write mode. It can inspect CrossGen state and manage Gallery folders/assets. Generation tools require generate mode."
              : "CrossGen MCP is running in generate mode. It can inspect CrossGen state, manage Gallery folders/assets, submit image generation/edit requests to the durable queue, start queue execution, wait briefly with waitMs, and request queue cancellation or retry.",
          crossgen: {
            requestedMode: options.mode,
            effectiveMode,
            permissions: {
              readonly: true,
              write: effectiveMode === "write" || effectiveMode === "generate",
              generate: effectiveMode === "generate"
            },
            generateModeWarning:
              effectiveMode === "generate"
                ? "Generate mode starts queue execution in this MCP process. Use waitMs for a short completion wait, then poll crossgen_job_status."
                : options.mode === "generate"
                ? "Generate mode was requested, but generation controls were not available in this process."
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
