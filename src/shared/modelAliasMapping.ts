import { getCatalogModelIds, isFocusedImageModelId, normalizeModelId } from "./modelCatalog.js";
import type { ProviderKind } from "./types.js";

export interface ModelAliasEntry {
  /** 中转站返回的模型名，如 gemini-3.1-flash-image-preview-2k */
  aliasModelId: string;
  /** 内置目录模型名，如 gemini-3.1-flash-image */
  targetModelId: string;
  /** 拆分模式显式档位（1K/2K/4K）；缺省时按 aliasModelId 后缀识别 */
  tier?: "1K" | "2K" | "4K";
}

export type GeminiResolutionTier = "0.5K" | "1K" | "2K" | "4K";

const GEMINI_CLASS_MARKERS = ["gemini", "nano"] as const;

const RESOLUTION_MARKERS: readonly { marker: string; tier: GeminiResolutionTier }[] = [
  { marker: "-0.5k", tier: "0.5K" },
  { marker: "-4k", tier: "4K" },
  { marker: "-2k", tier: "2K" }
] as const;

/** 两边 trim、小写、去 models/ 前缀；任一侧归一化后为空则返回 null。 */
export function normalizeModelAlias(entry: ModelAliasEntry): ModelAliasEntry | null {
  const aliasModelId = normalizeModelId(entry.aliasModelId);
  const targetModelId = normalizeModelId(entry.targetModelId);
  if (!aliasModelId || !targetModelId) return null;
  const tier = entry.tier && (entry.tier === "1K" || entry.tier === "2K" || entry.tier === "4K") ? entry.tier : undefined;
  return { aliasModelId, targetModelId, ...(tier ? { tier } : {}) };
}

/**
 * 判定分辨率：-4k→"4K"、-2k→"2K"、-0.5k→"0.5K"；无标记或 -1k→"1K"。
 * 仅当模型名包含 "image" 且属于 gemini 类（含 "gemini" 或 "nano"）时判定，否则 undefined。
 */
export function detectResolutionTierFromModelId(modelId: string): GeminiResolutionTier | undefined {
  const normalizedId = normalizeModelId(modelId);
  const isGeminiClass = GEMINI_CLASS_MARKERS.some((marker) => normalizedId.includes(marker));
  if (!isGeminiClass || !normalizedId.includes("image")) return undefined;
  // 取最后出现的分辨率标记（兼容 -4k-vip 这类带附加后缀的聚合站模型名）
  let bestIndex = -1;
  let bestTier: GeminiResolutionTier | undefined;
  for (const { marker, tier } of RESOLUTION_MARKERS) {
    const index = normalizedId.lastIndexOf(marker);
    if (index > bestIndex) {
      bestIndex = index;
      bestTier = tier;
    }
  }
  return bestTier ?? "1K";
}

/**
 * 若 modelId（normalize 后）命中某 alias.aliasModelId 则返回其 targetModelId；否则返回原 modelId。
 */
export function resolveAliasedModelId(modelId: string, aliases: readonly ModelAliasEntry[]): string {
  const normalizedId = normalizeModelId(modelId);
  const match = aliases.find((entry) => normalizeModelId(entry.aliasModelId) === normalizedId);
  return match ? match.targetModelId : modelId;
}

/**
 * 命中内置目录（复用 modelCatalog.isFocusedImageModelId）或命中别名且别名 target 属于该 providerKind 的目录模型。
 */
export function isFocusedImageModelIdWithAliases(
  providerKind: ProviderKind,
  modelId: string,
  aliases: readonly ModelAliasEntry[]
): boolean {
  if (isFocusedImageModelId(providerKind, modelId)) return true;
  const resolved = resolveAliasedModelId(modelId, aliases);
  if (resolved === modelId) return false;
  return isFocusedImageModelId(providerKind, resolved);
}

/**
 * 返回为该 target 配置的别名所覆盖的分辨率（用 detectResolutionTierFromModelId 判定每个 alias.aliasModelId）。
 */
export function aliasCoveredResolutionTiers(
  targetModelId: string,
  aliases: readonly ModelAliasEntry[]
): Set<GeminiResolutionTier> {
  const normalizedTarget = normalizeModelId(targetModelId);
  const tiers = new Set<GeminiResolutionTier>();
  for (const entry of aliases) {
    const normalized = normalizeModelAlias(entry);
    if (!normalized || normalized.targetModelId !== normalizedTarget) continue;
    const tier = entryResolutionTier(normalized);
    if (tier) tiers.add(tier);
  }
  return tiers;
}

/** 内置 gemini/openai 目录模型名列表（从 modelCatalog 的 FOCUSED_MODEL_CATALOG 提取 modelIds）。 */
/** 拆分模式仅覆盖的分辨率档位：1K/2K/4K（不含 0.5K，也不拆到具体尺寸）。 */
export const SPLIT_RESOLUTION_TIERS: readonly GeminiResolutionTier[] = ["1K", "2K", "4K"];

export function isSplitResolutionTier(tier: GeminiResolutionTier | undefined): tier is "1K" | "2K" | "4K" {
  return tier === "1K" || tier === "2K" || tier === "4K";
}

/**
 * 拆分模式下为该 target 配置的别名覆盖的档位（仅 1K/2K/4K；0.5K 视为未覆盖）。
 */
export function aliasCoveredSplitResolutionTiers(
  targetModelId: string,
  aliases: readonly ModelAliasEntry[]
): Set<"1K" | "2K" | "4K"> {
  const tiers = aliasCoveredResolutionTiers(targetModelId, aliases);
  const split = new Set<"1K" | "2K" | "4K">();
  for (const tier of tiers) {
    if (isSplitResolutionTier(tier)) split.add(tier);
  }
  return split;
}


/** 别名条目实际生效的档位：优先显式 tier，其次按名字后缀识别。 */
export function entryResolutionTier(entry: ModelAliasEntry): GeminiResolutionTier | undefined {
  if (entry.tier === "1K" || entry.tier === "2K" || entry.tier === "4K") return entry.tier;
  return detectResolutionTierFromModelId(entry.aliasModelId);
}

/**
 * gpt-image 内置尺寸预设到拆分档位的映射（取长边）：<=1024 → 1K，<=2048 → 2K，其余 → 4K。
 * auto 等无法解析的尺寸返回 undefined。
 */
export function gptSizeToResolutionTier(size: string): "1K" | "2K" | "4K" | undefined {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(size.trim());
  if (!match) return undefined;
  const longEdge = Math.max(Number(match[1]), Number(match[2]));
  if (!Number.isFinite(longEdge)) return undefined;
  if (longEdge <= 1024) return "1K";
  if (longEdge <= 2048) return "2K";
  return "4K";
}

export const CATALOG_TARGET_MODEL_OPTIONS: readonly string[] = getCatalogModelIds();