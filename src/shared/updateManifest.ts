import type { UpdateManifestAsset, UpdatePlatform } from "./types.js";

interface RawUpdateManifest {
  version?: unknown;
  notes?: unknown;
  pubDate?: unknown;
  assets?: unknown;
}

export interface ParsedUpdateManifest {
  version: string;
  notes?: string;
  pubDate?: string;
  assets: UpdateManifestAsset[];
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function parseUpdateManifest(payload: unknown): ParsedUpdateManifest {
  if (!isRecord(payload)) {
    throw new Error("更新 manifest 格式无效。");
  }

  const manifest = payload as RawUpdateManifest;
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("更新 manifest 缺少 version。");
  }
  if (!Array.isArray(manifest.assets)) {
    throw new Error("更新 manifest 缺少 assets。");
  }

  return {
    version: manifest.version.trim(),
    notes: typeof manifest.notes === "string" ? manifest.notes : undefined,
    pubDate: typeof manifest.pubDate === "string" ? manifest.pubDate : undefined,
    assets: manifest.assets.map(parseUpdateAsset)
  };
}

export function parseUpdateAsset(value: unknown): UpdateManifestAsset {
  if (!isRecord(value)) {
    throw new Error("更新资源格式无效。");
  }
  if (!isUpdatePlatform(value.platform)) {
    throw new Error("更新资源平台无效。");
  }
  if (typeof value.url !== "string" || !isAllowedUpdateUrl(value.url)) {
    throw new Error("更新资源 URL 必须是 https，或本地调试用 http loopback。");
  }
  if (value.arch !== undefined && typeof value.arch !== "string") {
    throw new Error("更新资源架构无效。");
  }
  if (value.fileName !== undefined && typeof value.fileName !== "string") {
    throw new Error("更新资源文件名无效。");
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
    throw new Error("更新资源必须提供 64 位 sha256。");
  }
  const sizeBytes = value.sizeBytes;
  if (!Number.isSafeInteger(sizeBytes) || typeof sizeBytes !== "number" || sizeBytes <= 0) {
    throw new Error("更新资源必须提供正整数 sizeBytes。");
  }
  return {
    platform: value.platform,
    arch: typeof value.arch === "string" && value.arch.trim() ? value.arch.trim() : undefined,
    url: value.url,
    fileName: typeof value.fileName === "string" && value.fileName.trim() ? value.fileName.trim() : undefined,
    sha256: value.sha256.toLowerCase(),
    sizeBytes
  };
}

export function selectUpdateAsset(
  assets: UpdateManifestAsset[],
  platform: string,
  arch: string
): UpdateManifestAsset | undefined {
  return (
    assets.find((asset) => asset.platform === platform && asset.arch === arch) ??
    assets.find((asset) => asset.platform === platform && !asset.arch) ??
    assets.find((asset) => asset.platform === "all" && asset.arch === arch) ??
    assets.find((asset) => asset.platform === "all" && !asset.arch)
  );
}

export function isUpdatePlatform(value: unknown): value is UpdatePlatform {
  return value === "darwin" || value === "win32" || value === "linux" || value === "all";
}

export function isAllowedUpdateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

export function safeUpdateFileName(asset: UpdateManifestAsset): string {
  const fromManifest = asset.fileName?.trim();
  if (fromManifest) return basename(fromManifest);
  const fromUrl = basename(new URL(asset.url).pathname);
  return fromUrl || `Image2Tools-update-${Date.now()}`;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? "";
}
