import type { AnimationAsset, ImageAsset, MediaKind, OutputAsset, VideoAsset } from "../shared/types.js";

const IMAGE_KINDS = new Set<MediaKind>(["image"]);
const VIDEO_KINDS = new Set<MediaKind>(["video"]);
const ANIMATION_KINDS = new Set<MediaKind>(["animated-gif"]);

export function isImageMediaKind(kind: MediaKind | undefined | null): kind is "image" {
  return kind === "image";
}

export function isVideoMediaKind(kind: MediaKind | undefined | null): kind is "video" {
  return VIDEO_KINDS.has(kind as MediaKind);
}

export function isAnimationMediaKind(kind: MediaKind | undefined | null): kind is "animated-gif" {
  return ANIMATION_KINDS.has(kind as MediaKind);
}

export function isImageAsset(asset: OutputAsset | undefined | null): asset is ImageAsset {
  if (!asset) return false;
  return asset.kind === undefined || asset.kind === "image";
}

export function isVideoAsset(asset: OutputAsset | undefined | null): asset is VideoAsset {
  return asset?.kind === "video";
}

export function isAnimationAsset(asset: OutputAsset | undefined | null): asset is AnimationAsset {
  return asset?.kind === "animated-gif";
}

export function mediaKindForMimeType(mimeType: string | undefined | null): MediaKind {
  const normalized = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (normalized === "video/mp4" || normalized === "video/webm" || normalized.startsWith("video/")) return "video";
  if (normalized === "image/gif") return "animated-gif";
  return "image";
}

export function mediaKindForFileName(fileName: string | undefined | null): MediaKind {
  const normalized = typeof fileName === "string" ? fileName.toLowerCase() : "";
  if (normalized.endsWith(".mp4") || normalized.endsWith(".webm") || normalized.endsWith(".mov") || normalized.endsWith(".m4v")) return "video";
  if (normalized.endsWith(".gif")) return "animated-gif";
  return "image";
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

export function normalizeOutputAsset<T extends Partial<OutputAsset> & Pick<OutputAsset, "id" | "jobId" | "path" | "fileName" | "mimeType" | "sourceType" | "createdAt">>(
  asset: T
): OutputAsset {
  const candidate = asset as T & {
    durationMs?: number;
    fps?: number;
    frameCount?: number;
    posterPath?: string;
  };
  const kind = normalizeMediaKind(
    asset.kind ??
      (asset.mimeType && asset.mimeType.toLowerCase() !== "application/octet-stream"
        ? mediaKindForMimeType(asset.mimeType)
        : mediaKindForFileName(asset.fileName))
  );
  const width = typeof asset.width === "number" && asset.width > 0 ? asset.width : undefined;
  const height = typeof asset.height === "number" && asset.height > 0 ? asset.height : undefined;
  const dimensions = asset.dimensions && asset.dimensions.width > 0 && asset.dimensions.height > 0
    ? asset.dimensions
    : width && height ? { width, height } : undefined;
  return {
    ...asset,
    kind,
    ...(dimensions ? { dimensions, width: width ?? dimensions.width, height: height ?? dimensions.height } : {}),
    ...(typeof asset.sizeBytes === "number" && asset.sizeBytes >= 0 ? { sizeBytes: asset.sizeBytes } : {}),
    ...(kind === "video" || kind === "animated-gif"
      ? {
          ...(typeof candidate.durationMs === "number" && candidate.durationMs >= 0 ? { durationMs: candidate.durationMs } : {}),
          ...(typeof candidate.fps === "number" && candidate.fps > 0 ? { fps: candidate.fps } : {}),
          ...(typeof candidate.frameCount === "number" && candidate.frameCount > 0 ? { frameCount: candidate.frameCount } : {}),
          ...(typeof candidate.posterPath === "string" && candidate.posterPath.trim() ? { posterPath: candidate.posterPath } : {})
        }
      : {})
  } as OutputAsset;
}

export function normalizeOutputAssetValue(value: unknown, fallbackJobId: string, fallbackCreatedAt: string): OutputAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : "";
  const path = typeof input.path === "string" && input.path.trim() ? input.path.trim() : "";
  const fileName = typeof input.fileName === "string" && input.fileName.trim() ? input.fileName.trim() : "";
  if (!id || !path || !fileName) return null;
  const mimeType = typeof input.mimeType === "string" && input.mimeType.trim()
    ? input.mimeType.trim()
    : mediaKindForFileName(fileName) === "video"
      ? "video/mp4"
      : mediaKindForFileName(fileName) === "animated-gif"
        ? "image/gif"
        : "image/png";
  const sourceType = input.sourceType === "partial" ||
    input.sourceType === "input" ||
    input.sourceType === "mask" ||
    input.sourceType === "poster" ||
    input.sourceType === "preview"
    ? input.sourceType
    : "result";
  return normalizeOutputAsset({
    ...input,
    id,
    jobId: typeof input.jobId === "string" && input.jobId.trim() ? input.jobId.trim() : fallbackJobId,
    path,
    fileName,
    mimeType,
    sourceType,
    createdAt: typeof input.createdAt === "string" && input.createdAt.trim() ? input.createdAt : fallbackCreatedAt
  } as never);
}

export function mediaKindsContainImage(kinds: readonly MediaKind[] | undefined | null): boolean {
  if (!Array.isArray(kinds)) return false;
  return kinds.some((kind) => IMAGE_KINDS.has(kind));
}
