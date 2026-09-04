import type { FocusedLaunchId, ImageQuality, ProviderConfigInput, ProviderKind } from "./types.js";
import {
  GENERAL_LAUNCH_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  GPT_IMAGE_2_MODEL_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID
} from "./modelCatalog.js";
import {
  DEFAULT_IMAGE_PARAMS,
  IMAGE_QUALITY_OPTIONS,
  validateApiKey
} from "./validation.js";

export const APP_LINK_PROTOCOL = "crossgen:";
export const APP_LINK_SCHEME = "crossgen";
export const APP_LINK_MAX_LENGTH = 16_384;

export interface AppLinkProviderConfig extends ProviderConfigInput {
  source: "applink";
  displayName: string;
  apiKeyPreview: string;
}

function firstParam(params: URLSearchParams, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseProviderKind(value: string | undefined): ProviderKind | undefined {
  if (value === "openai" || value === "gemini" || value === "custom") return value;
  return undefined;
}

function parseLaunchId(value: string | undefined): FocusedLaunchId | undefined {
  if (value === GPT_IMAGE_2_LAUNCH_ID || value === NANO_BANANA_3_LAUNCH_ID || value === GENERAL_LAUNCH_ID) {
    return value;
  }
  return undefined;
}

function previewApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return `${apiKey.slice(0, 1)}${"*".repeat(Math.max(2, apiKey.length - 2))}${apiKey.slice(-1)}`;
  return `${apiKey.slice(0, 4)}${"*".repeat(12)}${apiKey.slice(-4)}`;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function inferLaunchId(kind: ProviderKind, model: string | undefined): FocusedLaunchId {
  const normalizedModel = model?.toLowerCase() ?? "";
  if (normalizedModel === GPT_IMAGE_2_MODEL_ID || normalizedModel.includes("gpt-image")) return GPT_IMAGE_2_LAUNCH_ID;
  if (normalizedModel.includes("gemini") || normalizedModel.includes("nano-banana")) return NANO_BANANA_3_LAUNCH_ID;
  if (kind === "gemini") return NANO_BANANA_3_LAUNCH_ID;
  if (!normalizedModel && kind === "openai") return GPT_IMAGE_2_LAUNCH_ID;
  return GENERAL_LAUNCH_ID;
}

function isSupportedAppLinkTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return (
    (host === "api-config" && (path === "" || path === "/import")) ||
    (host === "provider" && path === "/import") ||
    (host === "config" && (path === "" || path === "/import")) ||
    (host === "" && (path === "/api-config" || path === "/provider/import" || path === "/config/import"))
  );
}

function normalizeBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AppLink 的 Base URL 无效。");
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("AppLink 的 Base URL 必须使用 HTTPS；开发环境仅允许本机回环地址使用 HTTP。");
  }
  if (url.username || url.password) {
    throw new Error("AppLink 的 Base URL 不允许携带用户名或密码。");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function isCrossGenAppLink(value: unknown): value is string {
  return typeof value === "string" && value.trim().toLowerCase().startsWith(`${APP_LINK_SCHEME}://`);
}

export function extractCrossGenAppLinks(args: readonly string[]): string[] {
  return args.filter(isCrossGenAppLink).map((value) => value.trim());
}

export function parseAppLink(value: string): AppLinkProviderConfig {
  if (!isCrossGenAppLink(value)) {
    throw new Error("不是有效的 CrossGen AppLink。");
  }
  if (value.length > APP_LINK_MAX_LENGTH) {
    throw new Error("AppLink URL 过长。");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AppLink URL 格式无效。");
  }
  if (url.protocol.toLowerCase() !== APP_LINK_PROTOCOL || !isSupportedAppLinkTarget(url)) {
    throw new Error("不支持的 CrossGen AppLink 地址。");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("AppLink 不允许携带凭据或 fragment。");
  }

  const apiKey = firstParam(url.searchParams, ["api_key", "apiKey", "key"]);
  const apiKeyValidation = validateApiKey(apiKey);
  if (!apiKeyValidation.ok || !apiKey) {
    throw new Error(apiKeyValidation.message ?? "AppLink 缺少有效 API Key。");
  }
  if (hasControlCharacters(apiKey)) {
    throw new Error("AppLink 的 API Key 不能包含控制字符。");
  }

  const baseURLValue = firstParam(url.searchParams, ["base_url", "baseURL", "endpoint", "url"]);
  if (!baseURLValue) {
    throw new Error("AppLink 缺少 Base URL。");
  }
  const baseURL = normalizeBaseURL(baseURLValue);
  const kind = parseProviderKind(firstParam(url.searchParams, ["kind", "provider", "provider_kind"])) ?? "custom";
  const model = firstParam(url.searchParams, ["model", "default_model", "defaultModel"]);
  const launchId = parseLaunchId(firstParam(url.searchParams, ["launch", "launch_id", "activeLaunchId"])) ?? inferLaunchId(kind, model);
  const activeModelId = firstParam(url.searchParams, ["active_model_id", "activeModelId"]) ?? model;
  const defaultModel = model ?? (
    launchId === GPT_IMAGE_2_LAUNCH_ID
      ? GPT_IMAGE_2_MODEL_ID
      : launchId === NANO_BANANA_3_LAUNCH_ID
        ? NANO_BANANA_3_MODEL_ID
        : ""
  );
  const qualityValue = firstParam(url.searchParams, ["quality", "default_quality", "defaultQuality"]);
  const defaultQuality: ImageQuality = qualityValue && IMAGE_QUALITY_OPTIONS.includes(qualityValue as ImageQuality)
    ? qualityValue as ImageQuality
    : DEFAULT_IMAGE_PARAMS.quality;
  const timeoutValue = firstParam(url.searchParams, ["timeout_ms", "timeoutMs"]);
  const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_IMAGE_PARAMS.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
    throw new Error("AppLink 的 timeoutMs 必须在 30000 到 600000 之间。");
  }

  const displayName = firstParam(url.searchParams, ["name", "label", "title"]) || "Imported API";
  const defaultSize = firstParam(url.searchParams, ["size", "default_size", "defaultSize"]) || DEFAULT_IMAGE_PARAMS.size;
  return {
    source: "applink",
    displayName,
    apiKeyPreview: previewApiKey(apiKey),
    kind,
    name: displayName,
    apiKey,
    baseURL,
    defaultModel,
    defaultSize,
    defaultQuality,
    timeoutMs,
    activeLaunchId: launchId,
    activeModelId: activeModelId || defaultModel
  };
}
