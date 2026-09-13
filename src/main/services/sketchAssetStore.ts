import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GenerationJob, GenerationQueueFile, InputAsset, WorkspaceDraft } from "../../shared/types.js";
import type { SketchDocument, SketchTaskMetadata } from "../../shared/types.js";
import {
  normalizeSketchDocument,
  normalizeSketchGuidance,
  normalizeSketchSidecar,
  sketchDocumentHash,
  validateSketchDocument,
  validateSketchTaskMetadata
} from "../../shared/sketch.js";

export interface SketchArtifactPaths {
  root: string;
  originalsDir: string;
  metadataDir: string;
  tempDir: string;
  pngPath: string;
  sidecarPath: string;
}

export interface SketchArtifactRecord {
  artifactId: string;
  documentHash: string;
  document: SketchDocument;
  createdAt: string;
  paths: SketchArtifactPaths;
}

export interface SketchArtifactWriteOptions {
  root: string;
  document: SketchDocument;
  pngBytes: Uint8Array;
  documentHash: string;
  underlayIncluded?: boolean;
  underlayAssetId?: string;
  guidance?: SketchTaskMetadata["guidance"];
  parentArtifactId?: string;
  artifactId?: string;
  createdAt?: string;
  idFactory?: () => string;
  writeFile?: (filePath: string, data: Uint8Array | string, encoding?: BufferEncoding) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  remove?: (filePath: string, options?: { force?: boolean; recursive?: boolean }) => Promise<void>;
}

export interface SketchArtifactReadOptions {
  root: string;
  artifactId: string;
  expectedDocumentHash?: string;
}

export interface SketchArtifactReferenceState {
  history?: GenerationJob[];
  draft?: WorkspaceDraft;
}

function sketchPaths(root: string, artifactId: string): SketchArtifactPaths {
  const resolvedRoot = path.resolve(root);
  const originalsDir = path.join(resolvedRoot, "originals", "sketches");
  const metadataDir = path.join(resolvedRoot, "metadata", "sketches");
  const tempDir = path.join(resolvedRoot, "tmp", "sketches");
  return {
    root: resolvedRoot,
    originalsDir,
    metadataDir,
    tempDir,
    pngPath: path.join(originalsDir, `${artifactId}.png`),
    sidecarPath: path.join(metadataDir, `${artifactId}.json`)
  };
}

function artifactIdIsSafe(value: string): boolean {
  return /^[a-zA-Z0-9_-]{8,120}$/.test(value);
}

function defaultWriteFile(filePath: string, data: Uint8Array | string, encoding?: BufferEncoding): Promise<void> {
  return typeof data === "string"
    ? fs.writeFile(filePath, data, encoding ?? "utf8")
    : fs.writeFile(filePath, data);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function artifactMetadata(
  artifactId: string,
  document: SketchDocument,
  documentHash: string,
  createdAt: string,
  underlayIncluded?: boolean,
  underlayAssetId?: string,
  guidance?: SketchTaskMetadata["guidance"],
  parentArtifactId?: string
): SketchTaskMetadata & { document: SketchDocument; createdAt: string } {
  return {
    artifactId,
    documentHash,
    document,
    width: document.width,
    height: document.height,
    background: document.background,
    strokeCount: document.strokes.filter((stroke) => stroke.tool === "brush").length,
    pointCount: document.strokes.reduce((total, stroke) => total + stroke.points.length, 0),
    createdAt,
    ...(underlayIncluded ? { underlayIncluded: true } : {}),
    ...(underlayAssetId ? { underlayAssetId } : {}),
    ...(guidance && guidance.length > 0 ? { guidance: normalizeSketchGuidance(guidance) } : {}),
    ...(parentArtifactId ? { parentArtifactId } : {})
  };
}

export function sketchArtifactPaths(root: string, artifactId: string): SketchArtifactPaths {
  if (!artifactIdIsSafe(artifactId)) throw new Error("Sketch artifact ID 无效。");
  return sketchPaths(root, artifactId);
}

export async function writeSketchArtifact(options: SketchArtifactWriteOptions): Promise<SketchArtifactRecord> {
  const document = normalizeSketchDocument(options.document);
  if (!document || !validateSketchDocument(document).ok) {
    throw new Error("Sketch 文档格式无效。");
  }
  if (options.documentHash !== sketchDocumentHash(document)) {
    throw new Error("Sketch 文档 hash 校验失败。");
  }
  if (!(options.pngBytes instanceof Uint8Array) || options.pngBytes.byteLength === 0) {
    throw new Error("Sketch PNG 为空。");
  }

  const artifactId = options.artifactId ?? `sketch_${(options.idFactory ?? randomUUID)()}`;
  if (!artifactIdIsSafe(artifactId)) throw new Error("Sketch artifact ID 无效。");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const paths = sketchPaths(options.root, artifactId);
  const writeFile = options.writeFile ?? defaultWriteFile;
  const rename = options.rename ?? fs.rename;
  const remove = options.remove ?? fs.rm;
  await Promise.all([
    fs.mkdir(paths.originalsDir, { recursive: true }),
    fs.mkdir(paths.metadataDir, { recursive: true }),
    fs.mkdir(paths.tempDir, { recursive: true })
  ]);
  if (await pathExists(paths.pngPath) || await pathExists(paths.sidecarPath)) {
    throw new Error("Sketch artifact 已存在。");
  }

  const tempSuffix = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const tempPngPath = path.join(paths.tempDir, `.${artifactId}-${tempSuffix}.png`);
  const tempSidecarPath = path.join(paths.tempDir, `.${artifactId}-${tempSuffix}.json`);
  const sidecar = artifactMetadata(
    artifactId,
    document,
    options.documentHash,
    createdAt,
    options.underlayIncluded,
    options.underlayAssetId,
    options.guidance,
    options.parentArtifactId
  );
  let publishedPng = false;
  let publishedSidecar = false;

  try {
    await writeFile(tempPngPath, options.pngBytes);
    await writeFile(tempSidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    await rename(tempPngPath, paths.pngPath);
    publishedPng = true;
    await rename(tempSidecarPath, paths.sidecarPath);
    publishedSidecar = true;
    return {
      artifactId,
      documentHash: options.documentHash,
      document,
      createdAt,
      paths
    };
  } catch (error) {
    await remove(tempPngPath, { force: true }).catch(() => undefined);
    await remove(tempSidecarPath, { force: true }).catch(() => undefined);
    if (publishedPng) await remove(paths.pngPath, { force: true }).catch(() => undefined);
    if (publishedSidecar) await remove(paths.sidecarPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readSketchArtifact(options: SketchArtifactReadOptions): Promise<SketchArtifactRecord> {
  const paths = sketchArtifactPaths(options.root, options.artifactId);
  const raw = await fs.readFile(paths.sidecarPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Sketch sidecar 不是有效 JSON。");
  }
  const sidecar = normalizeSketchSidecar(parsed, options.artifactId);
  if (!sidecar) throw new Error("Sketch sidecar 校验失败。");
  if (options.expectedDocumentHash && sidecar.documentHash !== options.expectedDocumentHash) {
    throw new Error("Sketch sidecar hash 校验失败。");
  }
  if (!(await pathExists(paths.pngPath))) throw new Error("Sketch PNG 资产不存在。");
  const metadataValidation = validateSketchTaskMetadata(sidecar);
  if (!metadataValidation.ok) throw new Error(metadataValidation.message ?? "Sketch sidecar metadata 无效。");
  return {
    artifactId: sidecar.artifactId,
    documentHash: sidecar.documentHash,
    document: sidecar.document,
    createdAt: sidecar.createdAt,
    paths
  };
}

export async function removeSketchArtifact(root: string, artifactId: string): Promise<void> {
  const paths = sketchArtifactPaths(root, artifactId);
  await Promise.all([
    fs.rm(paths.pngPath, { force: true }),
    fs.rm(paths.sidecarPath, { force: true })
  ]);
}

export function collectSketchArtifactIds(state: SketchArtifactReferenceState, queue?: GenerationQueueFile): Set<string> {
  const ids = new Set<string>();
  const addAsset = (asset: InputAsset | undefined) => {
    if (asset?.role === "sketch" && asset.artifactId) ids.add(asset.artifactId);
  };
  for (const job of state.history ?? []) {
    if (job.sketch?.artifactId) ids.add(job.sketch.artifactId);
    job.inputAssets.forEach(addAsset);
    addAsset(job.maskAsset);
  }
  for (const asset of state.draft?.inputAssets ?? []) addAsset(asset);
  if (state.draft?.sketch) {
    const draftSketchAsset = state.draft.inputAssets.find((asset) => asset.role === "sketch");
    addAsset(draftSketchAsset);
  }
  for (const item of queue?.items ?? []) {
    if (item.request.sketch?.artifactId) ids.add(item.request.sketch.artifactId);
  }
  return ids;
}

export function isSketchArtifactReferenced(
  artifactId: string,
  state: SketchArtifactReferenceState,
  queue?: GenerationQueueFile
): boolean {
  return collectSketchArtifactIds(state, queue).has(artifactId);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
