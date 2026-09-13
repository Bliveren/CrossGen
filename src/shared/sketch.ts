import type { SketchDocument, SketchGuidanceKey, SketchPoint, SketchStroke, SketchTaskMetadata } from "./types.js";

export const MAX_SKETCH_WIDTH = 3840;
export const MAX_SKETCH_HEIGHT = 3840;
export const MAX_SKETCH_PIXELS = 8_294_400;
export const MAX_SKETCH_STROKES = 2_000;
export const MAX_SKETCH_POINTS_PER_STROKE = 4_096;
export const MAX_SKETCH_POINTS = 100_000;
export const MAX_SKETCH_PNG_BYTES = 50 * 1024 * 1024;
export const SKETCH_SCHEMA_VERSION = 1 as const;

export interface SketchValidationResult {
  ok: boolean;
  message?: string;
}

export interface SketchSidecar {
  artifactId: string;
  documentHash: string;
  document: SketchDocument;
  width: number;
  height: number;
  background: SketchDocument["background"];
  strokeCount: number;
  pointCount: number;
  createdAt: string;
  underlayIncluded?: boolean;
  underlayAssetId?: string;
  guidance?: SketchGuidanceKey[];
  parentArtifactId?: string;
}

const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
export const SKETCH_GUIDANCE_KEYS: readonly SketchGuidanceKey[] = ["composition", "pose", "perspective"];

export function normalizeSketchGuidance(value: unknown): SketchGuidanceKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SketchGuidanceKey>();
  for (const item of value) {
    if (SKETCH_GUIDANCE_KEYS.includes(item as SketchGuidanceKey)) {
      seen.add(item as SketchGuidanceKey);
    }
  }
  return SKETCH_GUIDANCE_KEYS.filter((key) => seen.has(key));
}

export function sketchGuidanceLines(guidance?: readonly SketchGuidanceKey[]): string[] {
  const selected = new Set(normalizeSketchGuidance(guidance));
  const lines: string[] = [];
  if (selected.has("composition")) lines.push("- Preserve the sketch's composition and subject placement.");
  if (selected.has("pose")) lines.push("- Preserve the sketch's pose, gesture, and silhouette.");
  if (selected.has("perspective")) lines.push("- Preserve the sketch's perspective, depth, and spatial relationships.");
  return lines;
}

export function countSketchPoints(document: SketchDocument): number {
  return document.strokes.reduce((total, stroke) => total + stroke.points.length, 0);
}

export function countBrushStrokes(document: SketchDocument): number {
  return document.strokes.filter((stroke) => stroke.tool === "brush").length;
}

/**
 * Fits a requested logical canvas into the Sketch safety envelope while
 * preserving aspect ratio as closely as possible and keeping dimensions
 * aligned to the 16px image-model grid.
 */
export function fitSketchCanvasSize(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(512, Math.min(MAX_SKETCH_WIDTH, Math.round(Number.isFinite(width) ? width : 1536)));
  const safeHeight = Math.max(512, Math.min(MAX_SKETCH_HEIGHT, Math.round(Number.isFinite(height) ? height : 1024)));
  const scale = Math.min(
    1,
    MAX_SKETCH_WIDTH / safeWidth,
    MAX_SKETCH_HEIGHT / safeHeight,
    Math.sqrt(MAX_SKETCH_PIXELS / Math.max(1, safeWidth * safeHeight))
  );
  let fittedWidth = Math.max(512, Math.floor((safeWidth * scale) / 16) * 16);
  let fittedHeight = Math.max(512, Math.floor((safeHeight * scale) / 16) * 16);
  while (fittedWidth * fittedHeight > MAX_SKETCH_PIXELS && (fittedWidth > 512 || fittedHeight > 512)) {
    if (fittedWidth >= fittedHeight && fittedWidth > 512) fittedWidth -= 16;
    else if (fittedHeight > 512) fittedHeight -= 16;
    else break;
  }
  return { width: fittedWidth, height: fittedHeight };
}

export function hasSketchMarks(document: SketchDocument | undefined | null): boolean {
  return Boolean(document && countBrushStrokes(document) > 0 && countSketchPoints(document) > 0);
}

export function validateSketchDocument(value: unknown): SketchValidationResult {
  if (!isRecord(value)) return { ok: false, message: "Sketch 文档格式无效。" };
  if (value.schemaVersion !== SKETCH_SCHEMA_VERSION) return { ok: false, message: "Sketch 文档版本不受支持。" };
  if (!isBoundedInteger(value.width, 1, MAX_SKETCH_WIDTH) || !isBoundedInteger(value.height, 1, MAX_SKETCH_HEIGHT)) {
    return { ok: false, message: "Sketch 画布尺寸无效。" };
  }
  if (value.width * value.height > MAX_SKETCH_PIXELS) return { ok: false, message: "Sketch 画布像素数过大。" };
  if (value.background !== "white" && value.background !== "transparent") {
    return { ok: false, message: "Sketch 背景设置无效。" };
  }
  if (!Array.isArray(value.strokes) || value.strokes.length > MAX_SKETCH_STROKES) {
    return { ok: false, message: "Sketch 笔画数量超出限制。" };
  }

  let pointCount = 0;
  for (const stroke of value.strokes) {
    const result = validateSketchStroke(stroke, value.width, value.height);
    if (!result.ok) return result;
    pointCount += (stroke as SketchStroke).points.length;
    if (pointCount > MAX_SKETCH_POINTS) return { ok: false, message: "Sketch 点数量超出限制。" };
  }
  return { ok: true };
}

export function validateSketchStroke(value: unknown, width: number, height: number): SketchValidationResult {
  if (!isRecord(value)) return { ok: false, message: "Sketch 笔画格式无效。" };
  if (typeof value.id !== "string" || !value.id.trim()) return { ok: false, message: "Sketch 笔画 ID 无效。" };
  if (value.tool !== "brush" && value.tool !== "eraser") return { ok: false, message: "Sketch 工具无效。" };
  if (typeof value.color !== "string" || !COLOR_PATTERN.test(value.color)) return { ok: false, message: "Sketch 颜色格式无效。" };
  if (!isFiniteNumber(value.size) || value.size < 1 || value.size > 128) return { ok: false, message: "Sketch 笔刷大小无效。" };
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) return { ok: false, message: "Sketch 不透明度无效。" };
  if (!Array.isArray(value.points) || value.points.length === 0 || value.points.length > MAX_SKETCH_POINTS_PER_STROKE) {
    return { ok: false, message: "Sketch 笔画点数量无效。" };
  }
  for (const point of value.points) {
    const result = validateSketchPoint(point, width, height);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function validateSketchPoint(value: unknown, width: number, height: number): SketchValidationResult {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return { ok: false, message: "Sketch 坐标无效。" };
  }
  if (value.x < 0 || value.x > width || value.y < 0 || value.y > height) {
    return { ok: false, message: "Sketch 坐标超出画布范围。" };
  }
  if (value.pressure !== undefined && (!isFiniteNumber(value.pressure) || value.pressure < 0 || value.pressure > 1)) {
    return { ok: false, message: "Sketch 压力值无效。" };
  }
  return { ok: true };
}

export function normalizeSketchDocument(value: unknown, fallback?: SketchDocument): SketchDocument | undefined {
  if (!validateSketchDocument(value).ok) return fallback;
  const input = value as SketchDocument;
  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    width: Math.round(input.width),
    height: Math.round(input.height),
    background: input.background,
    strokes: input.strokes.map((stroke) => ({
      id: stroke.id,
      tool: stroke.tool,
      color: stroke.color.toLowerCase(),
      size: Math.max(1, Math.min(128, stroke.size)),
      opacity: Math.max(0, Math.min(1, stroke.opacity)),
      points: stroke.points.map((point): SketchPoint => ({
        x: Math.max(0, Math.min(input.width, point.x)),
        y: Math.max(0, Math.min(input.height, point.y)),
        ...(point.pressure === undefined ? {} : { pressure: Math.max(0, Math.min(1, point.pressure)) })
      }))
    }))
  };
}

export function sketchDocumentHash(document: SketchDocument): string {
  const canonical = JSON.stringify({
    schemaVersion: document.schemaVersion,
    width: document.width,
    height: document.height,
    background: document.background,
    strokes: document.strokes.map((stroke) => ({
      id: stroke.id,
      tool: stroke.tool,
      color: stroke.color,
      size: stroke.size,
      opacity: stroke.opacity,
      points: stroke.points.map((point) => [point.x, point.y, point.pressure ?? null])
    }))
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function validateSketchTaskMetadata(value: unknown): SketchValidationResult {
  if (!isRecord(value)) return { ok: false, message: "Sketch 任务 metadata 无效。" };
  if (typeof value.artifactId !== "string" || !value.artifactId.trim()) return { ok: false, message: "Sketch artifact ID 无效。" };
  if (!isBoundedInteger(value.width, 1, MAX_SKETCH_WIDTH) || !isBoundedInteger(value.height, 1, MAX_SKETCH_HEIGHT)) {
    return { ok: false, message: "Sketch 任务尺寸无效。" };
  }
  if (value.width * value.height > MAX_SKETCH_PIXELS) return { ok: false, message: "Sketch 任务像素数过大。" };
  if (value.background !== "white" && value.background !== "transparent") return { ok: false, message: "Sketch 任务背景无效。" };
  if (!isBoundedInteger(value.strokeCount, 0, MAX_SKETCH_STROKES)) return { ok: false, message: "Sketch 笔画数量无效。" };
  if (!isBoundedInteger(value.pointCount, 0, MAX_SKETCH_POINTS)) return { ok: false, message: "Sketch 点数量无效。" };
  if (typeof value.documentHash !== "string" || !/^[0-9a-f]{8,128}$/i.test(value.documentHash)) {
    return { ok: false, message: "Sketch 文档 hash 无效。" };
  }
  if (value.underlayIncluded !== undefined && typeof value.underlayIncluded !== "boolean") {
    return { ok: false, message: "Sketch 叠底状态无效。" };
  }
  if (value.underlayAssetId !== undefined && (typeof value.underlayAssetId !== "string" || !value.underlayAssetId.trim())) {
    return { ok: false, message: "Sketch 叠底资源无效。" };
  }
  if (value.guidance !== undefined) {
    if (!Array.isArray(value.guidance) || value.guidance.some((item) => !SKETCH_GUIDANCE_KEYS.includes(item as SketchGuidanceKey))) {
      return { ok: false, message: "Sketch 引导设置无效。" };
    }
  }
  if (value.parentArtifactId !== undefined && (typeof value.parentArtifactId !== "string" || !value.parentArtifactId.trim())) {
    return { ok: false, message: "Sketch 父 artifact ID 无效。" };
  }
  return { ok: true };
}

export function validateSketchSidecar(value: unknown, expectedArtifactId?: string): SketchValidationResult {
  if (!isRecord(value)) return { ok: false, message: "Sketch sidecar 格式无效。" };
  if (typeof value.artifactId !== "string" || !value.artifactId.trim()) return { ok: false, message: "Sketch sidecar artifact ID 无效。" };
  if (expectedArtifactId && value.artifactId !== expectedArtifactId) return { ok: false, message: "Sketch sidecar artifact ID 不匹配。" };
  if (typeof value.documentHash !== "string" || !/^[0-9a-f]{8,128}$/i.test(value.documentHash)) {
    return { ok: false, message: "Sketch sidecar hash 无效。" };
  }
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) return { ok: false, message: "Sketch sidecar 创建时间无效。" };
  const document = normalizeSketchDocument(value.document);
  if (!document) return { ok: false, message: "Sketch sidecar 文档无效。" };
  if (value.width !== document.width || value.height !== document.height || value.background !== document.background) {
    return { ok: false, message: "Sketch sidecar 尺寸或背景与文档不匹配。" };
  }
  if (value.strokeCount !== countBrushStrokes(document) || value.pointCount !== countSketchPoints(document)) {
    return { ok: false, message: "Sketch sidecar 笔画统计与文档不匹配。" };
  }
  if (value.documentHash !== sketchDocumentHash(document)) return { ok: false, message: "Sketch sidecar hash 校验失败。" };
  if (value.guidance !== undefined && (!Array.isArray(value.guidance) || value.guidance.some((item) => !SKETCH_GUIDANCE_KEYS.includes(item as SketchGuidanceKey)))) {
    return { ok: false, message: "Sketch sidecar 引导设置无效。" };
  }
  if (value.parentArtifactId !== undefined && (typeof value.parentArtifactId !== "string" || !value.parentArtifactId.trim())) {
    return { ok: false, message: "Sketch sidecar 父 artifact ID 无效。" };
  }
  return { ok: true };
}

export function normalizeSketchSidecar(value: unknown, expectedArtifactId?: string): SketchSidecar | undefined {
  if (!validateSketchSidecar(value, expectedArtifactId).ok || !isRecord(value)) return undefined;
  const document = normalizeSketchDocument(value.document);
  if (!document) return undefined;
  return {
    artifactId: value.artifactId as string,
    documentHash: value.documentHash as string,
    document,
    width: document.width,
    height: document.height,
    background: document.background,
    strokeCount: countBrushStrokes(document),
    pointCount: countSketchPoints(document),
    createdAt: value.createdAt as string,
    ...(value.underlayIncluded === true ? { underlayIncluded: true } : {}),
    ...(typeof value.underlayAssetId === "string" && value.underlayAssetId.trim() ? { underlayAssetId: value.underlayAssetId } : {}),
    ...(Array.isArray(value.guidance)
      ? { guidance: normalizeSketchGuidance(value.guidance) }
      : {}),
    ...(typeof value.parentArtifactId === "string" && value.parentArtifactId.trim()
      ? { parentArtifactId: value.parentArtifactId.trim() }
      : {})
  };
}

export function normalizeSketchTaskMetadata(value: unknown): SketchTaskMetadata | undefined {
  if (!validateSketchTaskMetadata(value).ok || !isRecord(value)) return undefined;
  return {
    ...(value as unknown as SketchTaskMetadata),
    ...(Array.isArray(value.guidance) ? { guidance: normalizeSketchGuidance(value.guidance) } : {}),
    ...(typeof value.parentArtifactId === "string" && value.parentArtifactId.trim()
      ? { parentArtifactId: value.parentArtifactId.trim() }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
