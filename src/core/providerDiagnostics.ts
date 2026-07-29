import type {
  ImageParams,
  OpenAIImageRoute,
  ProviderKind,
  QueueErrorCategory,
  RunJobRequest,
  TaskDiagnostic,
  TaskDiagnosticCategory,
  TaskDiagnosticOperation,
  TaskDiagnosticProviderKind
} from "../shared/types.js";

export interface BuildTaskDiagnosticInput {
  error?: unknown;
  message?: string;
  providerMessage?: string;
  request: RunJobRequest;
  providerKind: ProviderKind;
  baseURL?: string;
  modelId?: string;
  route?: string;
  attemptIndex?: number;
  userCancelled?: boolean;
}

const TASK_DIAGNOSTIC_CATEGORIES = new Set<TaskDiagnosticCategory>([
  "auth",
  "billing",
  "rate_limit",
  "timeout",
  "safety",
  "unsupported_capability",
  "route_unsupported",
  "provider_empty_output",
  "provider_schema",
  "network",
  "cancelled",
  "unknown"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function taskOperationForRequest(request: RunJobRequest): TaskDiagnosticOperation {
  if (request.mode === "inpaint") return "guided-region";
  if (request.mode === "edit") return "image-to-image";
  return "text-to-image";
}

function modelIdFromParams(params: ImageParams): string {
  return typeof params.model === "string" ? params.model : "";
}

function timeoutMsFromParams(params: ImageParams): number {
  return typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) ? params.timeoutMs : 0;
}

export function diagnosticProviderKind(providerKind: ProviderKind, baseURL?: string): TaskDiagnosticProviderKind {
  if (providerKind !== "openai") return providerKind;
  if (!baseURL) return "openai";
  try {
    const url = new URL(baseURL.trim());
    return url.hostname === "api.openai.com" ? "openai" : "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}

export function defaultRouteForRequest(request: RunJobRequest, providerKind: ProviderKind): string | undefined {
  if (providerKind === "gemini") return "gemini-generateContent";
  if (request.params.launchId === "general") return "openai-compatible-images";
  if (request.params.providerKind !== "openai") return undefined;
  if (request.mode !== "generate" && (request.maskPath || request.maskDataUrl)) return "image-api";
  if (request.params.imageRoute !== "auto") return request.params.imageRoute;
  return "chat-completions";
}

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyTaskDiagnosticMessage(message: string, input: Pick<BuildTaskDiagnosticInput, "userCancelled"> = {}): TaskDiagnosticCategory {
  const normalized = normalizeWhitespace(message);
  const lower = normalized.toLowerCase();

  if (input.userCancelled || includesAny(lower, [/任务已终止|任务已取消|cancelled by user|user cancel/])) return "cancelled";
  if (includesAny(lower, [/请求超时|timed?\s*out|timeout|deadline exceeded|etimedout/])) return "timeout";
  if (includesAny(lower, [/余额不足|insufficient (?:balance|credit|funds)|billing|payment required|402|insufficient_quota|quota exceeded/])) return "billing";
  if (includesAny(lower, [/rate limit|too many requests|429|限流|请求过于频繁/])) return "rate_limit";
  if (includesAny(lower, [/invalid key|api key|unauthorized|401|403|authentication|permission_denied|permission denied|forbidden|未授权|鉴权|认证失败/])) return "auth";
  if (includesAny(lower, [/安全策略|content policy|safety|moderation|blocked|refusal|filtered|policy violation|unsafe|content_filter/])) return "safety";
  if (includesAny(lower, [/没有返回可保存的图片|没有返回最终图片|no savable|no image output|empty output|data 类型：null|data: null|metadata-only|未返回图片字段/])) {
    return "provider_empty_output";
  }
  if (includesAny(lower, [/非有效 json|不是有效 json|invalid json|非预期响应|unexpected response|content-type|schema|malformed/])) return "provider_schema";
  if (includesAny(lower, [/route unsupported|unsupported route|endpoint.*not supported|not supported.*route|路径.*不支持|404|not found.*\/(?:images|responses|chat)|method not allowed|405/])) {
    return "route_unsupported";
  }
  if (includesAny(lower, [/不支持|unsupported|capability|当前版本尚未接入|general 首期|mask must|requires the first source|format must match|局部重绘需要|至少需要一张|文生图不应携带/])) {
    return "unsupported_capability";
  }
  if (includesAny(lower, [/terminated|premature close|socket hang up|econnreset|enotfound|network|fetch failed|connection reset|eai_again|broken pipe|aborted/])) return "network";
  return "unknown";
}

function retryableForCategory(category: TaskDiagnosticCategory): boolean {
  return category === "timeout" || category === "rate_limit" || category === "network";
}

function chargedRetryRiskForCategory(category: TaskDiagnosticCategory): boolean {
  return category === "timeout" || category === "network" || category === "provider_empty_output" || category === "provider_schema" || category === "unknown";
}

export function queueErrorCategoryForTaskDiagnostic(category: TaskDiagnosticCategory): QueueErrorCategory {
  if (category === "auth") return "auth";
  if (category === "billing" || category === "rate_limit") return "quota";
  if (category === "safety") return "safety";
  if (category === "cancelled") return "cancelled";
  if (category === "unsupported_capability" || category === "route_unsupported" || category === "provider_empty_output") return "unsupported";
  if (category === "timeout" || category === "network") return "transient";
  return "unknown";
}

export function taskDiagnosticCategoryForQueueError(category: QueueErrorCategory | undefined): TaskDiagnosticCategory | undefined {
  if (category === "auth") return "auth";
  if (category === "quota") return "billing";
  if (category === "safety") return "safety";
  if (category === "cancelled") return "cancelled";
  if (category === "unsupported") return "unsupported_capability";
  if (category === "transient") return "network";
  if (category === "unknown") return "unknown";
  return undefined;
}

function baseNextActions(input: BuildTaskDiagnosticInput, category: TaskDiagnosticCategory): string[] {
  const operation = taskOperationForRequest(input.request);
  const route = input.route ?? defaultRouteForRequest(input.request, input.providerKind);
  const actions: string[] = [];

  if (category === "auth") actions.push("检查当前 API Key 是否保存正确，并在 API 配置中重新测试连接。");
  if (category === "billing") actions.push("检查 provider 账户余额、额度或计费状态后再重试。");
  if (category === "rate_limit") actions.push("稍后重试，或降低并发和任务提交频率。");
  if (category === "timeout") actions.push("提高本次任务超时秒数，或减少参考图数量和图片尺寸后再试。");
  if (category === "safety") actions.push("调整提示词或参考图，避开 provider 内容安全策略可能拦截的内容。");
  if (category === "provider_empty_output") actions.push("该 route 已返回成功响应但没有图片字段；请切换接口路径后重试。");
  if (category === "provider_schema") actions.push("检查 Base URL 是否指向兼容的图片接口，或切换接口路径。");
  if (category === "route_unsupported") actions.push("切换接口路径；使用聚合平台时，图生图通常优先尝试 chat 路径。");
  if (category === "unsupported_capability") actions.push("切换支持当前能力的模型或关闭参考图、蒙版、流式预览等不被支持的能力。");
  if (category === "network") actions.push("检查网络连接、代理和 provider 稳定性，然后重试。");
  if (category === "unknown") actions.push("查看 provider 原始错误摘要，并尝试切换 route 或提高超时时间。");

  if (operation !== "text-to-image") {
    actions.push("文生图成功不代表图生图或蒙版编辑可用；请按 operation 分别验证。");
  }
  if (operation === "guided-region") {
    actions.push("蒙版模式可能需要兼容端点支持 image edit / guided edit；部分兼容平台即使文生图成功，也可能不支持蒙版编辑。");
  }
  if (input.request.inputPaths.length > 1) {
    actions.push("减少参考图数量，先用 1 张参考图验证该 route 是否支持图生图。");
  }
  if (route === "image-api" && operation !== "text-to-image") {
    actions.push("如果当前是兼容接口且 image-api 编辑失败，可改用 chat 路径验证参考图是否能被读取。");
  }

  return [...new Set(actions)];
}

export function buildTaskDiagnostic(input: BuildTaskDiagnosticInput): TaskDiagnostic {
  const providerMessage = normalizeWhitespace(input.providerMessage ?? input.message ?? textFromError(input.error));
  const category = classifyTaskDiagnosticMessage(providerMessage, input);
  const message = diagnosticMessageForCategory(category, providerMessage);
  return {
    category,
    message,
    providerMessage: providerMessage || undefined,
    error: providerMessage || undefined,
    errorCategory: queueErrorCategoryForTaskDiagnostic(category),
    operation: taskOperationForRequest(input.request),
    providerKind: diagnosticProviderKind(input.providerKind, input.baseURL),
    modelId: input.modelId?.trim() || modelIdFromParams(input.request.params),
    route: input.route ?? defaultRouteForRequest(input.request, input.providerKind),
    inputImageCount: input.request.inputPaths.length,
    hasMask: Boolean(input.request.maskPath || input.request.maskDataUrl),
    timeoutMs: timeoutMsFromParams(input.request.params),
    attemptIndex: Math.max(1, input.attemptIndex ?? 1),
    retryable: retryableForCategory(category),
    chargedRetryRisk: chargedRetryRiskForCategory(category),
    nextActions: baseNextActions(input, category)
  };
}

function diagnosticMessageForCategory(category: TaskDiagnosticCategory, providerMessage: string): string {
  if (category === "provider_empty_output") return "Provider 响应中没有可保存的图片。";
  if (category === "billing") return "Provider 账户余额或额度不足。";
  if (category === "timeout") return "任务在用户配置的超时时间内没有完成。";
  if (category === "unsupported_capability") return "当前模型或接口路径不支持本次任务所需能力。";
  if (category === "route_unsupported") return "当前接口路径不支持本次图片操作。";
  if (category === "cancelled") return "任务已被用户终止。";
  return providerMessage || "图片任务失败。";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function normalizeTaskDiagnosticValue(value: unknown): TaskDiagnostic | undefined {
  if (!isRecord(value)) return undefined;
  const category = typeof value.category === "string" && TASK_DIAGNOSTIC_CATEGORIES.has(value.category as TaskDiagnosticCategory)
    ? value.category as TaskDiagnosticCategory
    : "unknown";
  const operation = value.operation === "image-to-image" || value.operation === "guided-region" ? value.operation : "text-to-image";
  const rawProviderKind = typeof value.providerKind === "string" ? value.providerKind : "custom";
  const providerKind: TaskDiagnosticProviderKind =
    rawProviderKind === "openai" || rawProviderKind === "openai-compatible" || rawProviderKind === "gemini" || rawProviderKind === "custom"
      ? rawProviderKind
      : "custom";
  return {
    category,
    message: typeof value.message === "string" && value.message.trim() ? value.message : "图片任务失败。",
    providerMessage: typeof value.providerMessage === "string" ? value.providerMessage : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
    errorCategory: normalizeQueueErrorCategoryValue(value.errorCategory),
    operation,
    providerKind,
    modelId: typeof value.modelId === "string" ? value.modelId : "",
    route: typeof value.route === "string" ? value.route : undefined,
    inputImageCount: typeof value.inputImageCount === "number" && Number.isFinite(value.inputImageCount) ? Math.max(0, value.inputImageCount) : 0,
    hasMask: Boolean(value.hasMask),
    timeoutMs: typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) ? Math.max(0, value.timeoutMs) : 0,
    attemptIndex: typeof value.attemptIndex === "number" && Number.isFinite(value.attemptIndex) ? Math.max(1, value.attemptIndex) : 1,
    retryable: typeof value.retryable === "boolean" ? value.retryable : retryableForCategory(category),
    chargedRetryRisk: typeof value.chargedRetryRisk === "boolean" ? value.chargedRetryRisk : chargedRetryRiskForCategory(category),
    nextActions: normalizeStringArray(value.nextActions)
  };
}

function normalizeQueueErrorCategoryValue(value: unknown): QueueErrorCategory | undefined {
  return value === "transient" ||
    value === "auth" ||
    value === "quota" ||
    value === "safety" ||
    value === "cancelled" ||
    value === "unsupported" ||
    value === "unknown"
    ? value
    : undefined;
}

export function openAIImageRouteFromString(value: string | undefined): OpenAIImageRoute | undefined {
  return value === "image-api" || value === "responses" || value === "chat-completions" ? value : undefined;
}
