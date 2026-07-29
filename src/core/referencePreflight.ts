import type { InputAsset, ReferencePreflightImageMetadata, ReferencePreflightReason, ReferencePreflightRole, ReferencePreflightSummary } from "../shared/types.js";

export interface ReferencePreflightLimits {
  warnBytes: number;
  warnPixels: number;
  hardBytes: number;
  hardPixels: number;
  maxEdge: number;
}

export const DEFAULT_REFERENCE_PREFLIGHT_LIMITS: ReferencePreflightLimits = {
  warnBytes: 12 * 1024 * 1024,
  warnPixels: 16_000_000,
  hardBytes: 50 * 1024 * 1024,
  hardPixels: 50_000_000,
  maxEdge: 4096
};

interface ReferencePreflightAssetInput {
  asset: InputAsset;
  role: ReferencePreflightRole;
}

interface BuildReferencePreflightOptions {
  limits?: Partial<ReferencePreflightLimits>;
}

function normalizedLimits(input?: Partial<ReferencePreflightLimits>): ReferencePreflightLimits {
  return {
    warnBytes: positiveNumber(input?.warnBytes) ?? DEFAULT_REFERENCE_PREFLIGHT_LIMITS.warnBytes,
    warnPixels: positiveNumber(input?.warnPixels) ?? DEFAULT_REFERENCE_PREFLIGHT_LIMITS.warnPixels,
    hardBytes: positiveNumber(input?.hardBytes) ?? DEFAULT_REFERENCE_PREFLIGHT_LIMITS.hardBytes,
    hardPixels: positiveNumber(input?.hardPixels) ?? DEFAULT_REFERENCE_PREFLIGHT_LIMITS.hardPixels,
    maxEdge: positiveNumber(input?.maxEdge) ?? DEFAULT_REFERENCE_PREFLIGHT_LIMITS.maxEdge
  };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : undefined;
}

function safeBytes(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function pixelCount(metadata: Pick<ReferencePreflightImageMetadata, "width" | "height">): number | undefined {
  if (!metadata.width || !metadata.height) return undefined;
  return metadata.width * metadata.height;
}

export function referencePreflightTargetDimensions(width: number, height: number, limits: Partial<ReferencePreflightLimits> = {}): { width: number; height: number; downsampled: boolean } {
  const normalized = normalizedLimits(limits);
  const pixels = width * height;
  const pixelScale = pixels > normalized.warnPixels ? Math.sqrt(normalized.warnPixels / pixels) : 1;
  const edgeScale = Math.max(width, height) > normalized.maxEdge ? normalized.maxEdge / Math.max(width, height) : 1;
  const scale = Math.min(1, pixelScale, edgeScale);
  if (scale >= 1) return { width, height, downsampled: false };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    downsampled: true
  };
}

function estimatedRequestMetadata(
  original: ReferencePreflightImageMetadata,
  role: ReferencePreflightRole,
  allowReferenceDownsampling: boolean,
  limits: ReferencePreflightLimits
): ReferencePreflightSummary["request"] {
  if (role === "mask" || !allowReferenceDownsampling || !original.width || !original.height) {
    return {
      ...original,
      downsampled: false
    };
  }

  const target = referencePreflightTargetDimensions(original.width, original.height, limits);
  const shouldDownsample = target.downsampled || original.bytes > limits.warnBytes;
  if (!shouldDownsample) {
    return {
      ...original,
      downsampled: false
    };
  }

  const originalPixels = Math.max(1, original.width * original.height);
  const targetPixels = Math.max(1, target.width * target.height);
  return {
    mime: original.mime === "image/jpeg" ? "image/jpeg" : "image/png",
    width: target.width,
    height: target.height,
    bytes: Math.max(1, Math.min(original.bytes, Math.round(original.bytes * (targetPixels / originalPixels)))),
    downsampled: true
  };
}

function metadataFor(asset: InputAsset): ReferencePreflightImageMetadata {
  return {
    mime: asset.mimeType || "application/octet-stream",
    width: positiveInteger(asset.width),
    height: positiveInteger(asset.height),
    bytes: safeBytes(asset.sizeBytes),
    hasAlpha: typeof asset.hasAlpha === "boolean" ? asset.hasAlpha : undefined
  };
}

function dimensionsKnown(metadata: Pick<ReferencePreflightImageMetadata, "width" | "height">): metadata is ReferencePreflightImageMetadata & { width: number; height: number } {
  return Boolean(metadata.width && metadata.height);
}

function dimensionsEqual(
  left: Pick<ReferencePreflightImageMetadata, "width" | "height">,
  right: Pick<ReferencePreflightImageMetadata, "width" | "height">
): boolean {
  return dimensionsKnown(left) && dimensionsKnown(right) && left.width === right.width && left.height === right.height;
}

function reasonFor(metadata: ReferencePreflightImageMetadata, role: ReferencePreflightRole, limits: ReferencePreflightLimits): ReferencePreflightReason {
  if (role === "mask") return "mask_preserved";
  const pixels = pixelCount(metadata) ?? 0;
  if (metadata.bytes > limits.hardBytes || pixels > limits.hardPixels) return "provider_limit";
  if (metadata.bytes > limits.warnBytes) return "byte_limit";
  if (pixels > limits.warnPixels) return "pixel_limit";
  return "within_limits";
}

function warningFor(input: {
  asset: InputAsset;
  metadata: ReferencePreflightImageMetadata;
  request: ReferencePreflightSummary["request"];
  role: ReferencePreflightRole;
  reason: ReferencePreflightReason;
  blocked: boolean;
  limits: ReferencePreflightLimits;
}): string | undefined {
  const label = input.role === "mask" ? "Mask" : "Reference image";
  const name = input.asset.name ? ` "${input.asset.name}"` : "";
  const pixels = pixelCount(input.metadata);
  const dimensions = input.metadata.width && input.metadata.height ? `${input.metadata.width}x${input.metadata.height}` : "unknown dimensions";

  if (input.reason === "mask_dimension_mismatch") {
    return `${label}${name} dimensions (${dimensions}) do not match the source image dimensions. Use a mask with the same width and height as the first reference image before retrying.`;
  }
  if (input.blocked) {
    return `${label}${name} is too large for a safe provider request (${dimensions}, ${input.metadata.bytes} bytes). Reduce image size before retrying.`;
  }
  if (input.role === "mask" && (input.metadata.bytes > input.limits.warnBytes || (pixels ?? 0) > input.limits.warnPixels)) {
    return `${label}${name} is preserved without downsampling; large masks may reduce compatible endpoint success rates.`;
  }
  if ((input.reason === "byte_limit" || input.reason === "provider_limit") && !input.request.downsampled) {
    return `${label}${name} is large (${input.metadata.bytes} bytes), but CrossGen could not plan a safe request copy because dimensions were unavailable.`;
  }
  if (input.reason === "byte_limit") {
    return `${label}${name} is large (${input.metadata.bytes} bytes). CrossGen will use a temporary downsampled request copy and keep the original file unchanged.`;
  }
  if (input.reason === "pixel_limit") {
    return `${label}${name} has a large pixel area (${dimensions}). CrossGen will use a temporary downsampled request copy and keep the original file unchanged.`;
  }
  if (input.reason === "provider_limit") {
    return `${label}${name} exceeds conservative provider request limits (${dimensions}, ${input.metadata.bytes} bytes). CrossGen will try a temporary downsampled request copy.`;
  }
  return undefined;
}

export function buildReferencePreflightSummaries(
  inputAssets: InputAsset[],
  maskAsset?: InputAsset,
  options: BuildReferencePreflightOptions = {}
): ReferencePreflightSummary[] | undefined {
  const assets: ReferencePreflightAssetInput[] = [
    ...inputAssets.map((asset) => ({ asset, role: "reference" as const })),
    ...(maskAsset ? [{ asset: maskAsset, role: "mask" as const }] : [])
  ];
  if (assets.length === 0) return undefined;

  const limits = normalizedLimits(options.limits);
  const allowReferenceDownsampling = !maskAsset;
  const firstReference = inputAssets[0] ? metadataFor(inputAssets[0]) : undefined;
  const maskMetadata = maskAsset ? metadataFor(maskAsset) : undefined;
  const maskDimensionMismatch = Boolean(firstReference && maskMetadata && dimensionsKnown(firstReference) && dimensionsKnown(maskMetadata) && !dimensionsEqual(firstReference, maskMetadata));
  return assets.map(({ asset, role }) => {
    const original = metadataFor(asset);
    const reason = role === "mask" && maskDimensionMismatch ? "mask_dimension_mismatch" : reasonFor(original, role, limits);
    const pixels = pixelCount(original) ?? 0;
    const hardLimitExceeded = original.bytes > limits.hardBytes || pixels > limits.hardPixels;
    const canDownsample = role === "reference" && allowReferenceDownsampling && Boolean(original.width && original.height);
    const blocked = (role === "mask" && maskDimensionMismatch) || (hardLimitExceeded && !canDownsample);
    const summary: ReferencePreflightSummary = {
      id: asset.id,
      role,
      name: asset.name,
      original,
      request: estimatedRequestMetadata(original, role, allowReferenceDownsampling, limits),
      reason,
      blocked
    };
    const warning = warningFor({ asset, metadata: original, request: summary.request, role, reason, blocked, limits });
    return warning ? { ...summary, warning } : summary;
  });
}

export function referencePreflightBlockingMessage(summaries: ReferencePreflightSummary[] | undefined): string | undefined {
  const blocked = summaries?.find((summary) => summary.blocked);
  if (!blocked) return undefined;
  return blocked.warning ?? "参考图过大，已在请求发送前拦截。请缩小图片后重试。";
}

export function normalizeReferencePreflightValue(value: unknown): ReferencePreflightSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.flatMap((item) => {
    const summary = normalizeReferencePreflightSummary(item);
    return summary ? [summary] : [];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeReferencePreflightSummary(value: unknown): ReferencePreflightSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === "string" && value.id.trim() ? value.id : undefined;
  if (!id) return undefined;
  const original = normalizeMetadata(value.original);
  if (!original) return undefined;
  const request = normalizeRequestMetadata(value.request, original);
  if (!request) return undefined;
  const role = value.role === "mask" ? "mask" : "reference";
  const reason = normalizeReason(value.reason);
  return {
    id,
    role,
    name: typeof value.name === "string" && value.name.trim() ? value.name : undefined,
    original,
    request,
    reason,
    warning: typeof value.warning === "string" && value.warning.trim() ? value.warning : undefined,
    blocked: typeof value.blocked === "boolean" ? value.blocked : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMetadata(value: unknown): ReferencePreflightImageMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const mime = typeof value.mime === "string" && value.mime.trim() ? value.mime : "application/octet-stream";
  return {
    mime,
    width: positiveInteger(value.width),
    height: positiveInteger(value.height),
    bytes: safeBytes(value.bytes),
    hasAlpha: typeof value.hasAlpha === "boolean" ? value.hasAlpha : undefined
  };
}

function normalizeRequestMetadata(value: unknown, fallback: ReferencePreflightImageMetadata): ReferencePreflightSummary["request"] | undefined {
  if (!isRecord(value)) {
    return {
      ...fallback,
      downsampled: false
    };
  }
  return {
    mime: typeof value.mime === "string" && value.mime.trim() ? value.mime : fallback.mime,
    width: positiveInteger(value.width) ?? fallback.width,
    height: positiveInteger(value.height) ?? fallback.height,
    bytes: safeBytes(value.bytes) || fallback.bytes,
    hasAlpha: typeof value.hasAlpha === "boolean" ? value.hasAlpha : fallback.hasAlpha,
    downsampled: Boolean(value.downsampled)
  };
}

function normalizeReason(value: unknown): ReferencePreflightReason | undefined {
  return value === "within_limits" ||
    value === "pixel_limit" ||
    value === "byte_limit" ||
    value === "provider_limit" ||
    value === "mask_preserved" ||
    value === "mask_dimension_mismatch"
    ? value
    : undefined;
}
