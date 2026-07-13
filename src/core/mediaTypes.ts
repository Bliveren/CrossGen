import type { MediaKind } from "../shared/types.js";

const IMAGE_KINDS = new Set<MediaKind>(["image"]);

export function isImageMediaKind(kind: MediaKind | undefined | null): kind is "image" {
  return kind === "image";
}

export function normalizeMediaKind(kind?: MediaKind | null): MediaKind {
  if (kind === "animated-gif" || kind === "video") return kind;
  return "image";
}

export function normalizeAssetKind(kind?: MediaKind | null): MediaKind {
  return normalizeMediaKind(kind);
}

export function coerceLegacyImageAssetKind<T extends object>(asset: T & { kind?: MediaKind | null }): T & { kind: MediaKind } {
  return {
    ...asset,
    kind: normalizeMediaKind(asset.kind)
  };
}

export function mediaKindsContainImage(kinds: readonly MediaKind[] | undefined | null): boolean {
  if (!Array.isArray(kinds)) return false;
  return kinds.some((kind) => IMAGE_KINDS.has(kind));
}
