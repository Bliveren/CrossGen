import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationJob, GenerationQueueFile, WorkspaceDraft } from "../../shared/types";
import { sketchDocumentHash } from "../../shared/sketch";
import { collectSketchArtifactIds, isSketchArtifactReferenced, readSketchArtifact, removeSketchArtifact, writeSketchArtifact } from "./sketchAssetStore";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const document = {
  schemaVersion: 1 as const,
  width: 1024,
  height: 1024,
  background: "white" as const,
  strokes: [{
    id: "stroke_1",
    tool: "brush" as const,
    color: "#1f2937",
    size: 12,
    opacity: 1,
    points: [{ x: 4, y: 4 }, { x: 120, y: 120 }]
  }]
};

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

function queueFile(artifactId: string): GenerationQueueFile {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    workerHosts: [],
    items: [{
      queueId: "queue_1",
      source: "desktop",
      providerId: "provider_1",
      request: {
        mode: "edit",
        workflow: "sketch",
        sketch: {
          artifactId,
          width: document.width,
          height: document.height,
          background: document.background,
          strokeCount: 1,
          pointCount: 2,
          documentHash: sketchDocumentHash(document)
        },
        prompt: "test",
        inputPaths: [`${artifactId}.png`],
        params: {
          providerKind: "openai",
          launchId: "gpt-image-2",
          model: "gpt-image-2",
          imageRoute: "image-api",
          referenceImageMode: "original",
          size: "auto",
          quality: "auto",
          outputFormat: "png",
          outputCompression: 100,
          background: "auto",
          n: 1,
          stream: false,
          partialImages: 0,
          moderation: "auto",
          timeoutMs: 30000
        }
      },
      status: "queued",
      priority: 0,
      attempt: 0,
      maxAttempts: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      cancelRequested: false,
      costConfirmed: true,
      executionKind: "sync-provider",
      stage: "queued",
      outputAssetIds: [],
      partialAssetIds: [],
      galleryAssetIds: [],
      sourceAssetIds: [],
      outputMediaKinds: ["image"]
    }]
  };
}

describe("Sketch artifact store", () => {
  it("writes an immutable PNG and sidecar through temporary files", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "crossgen-sketch-store-"));
    const record = await writeSketchArtifact({
      root,
      document,
      pngBytes,
      documentHash: sketchDocumentHash(document),
      artifactId: "sketch_test_1",
      guidance: ["composition", "perspective"]
    });

    expect(await readFile(record.paths.pngPath)).toEqual(Buffer.from(pngBytes));
    const sidecar = JSON.parse(await readFile(record.paths.sidecarPath, "utf8")) as Record<string, unknown>;
    expect(sidecar.artifactId).toBe("sketch_test_1");
    expect(sidecar.width).toBe(1024);
    expect(sidecar.strokeCount).toBe(1);
    expect(sidecar.guidance).toEqual(["composition", "perspective"]);
    await expect(readSketchArtifact({ root, artifactId: "sketch_test_1" })).resolves.toMatchObject({
      artifactId: "sketch_test_1",
      documentHash: sketchDocumentHash(document)
    });
  });

  it("cleans both published and temporary files when the second rename fails", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "crossgen-sketch-store-failure-"));
    let renameCount = 0;
    await expect(writeSketchArtifact({
      root,
      document,
      pngBytes,
      documentHash: sketchDocumentHash(document),
      artifactId: "sketch_failure_1",
      rename: async (from, to) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error("simulated sidecar rename failure");
        await import("node:fs/promises").then((fs) => fs.rename(from, to));
      }
    })).rejects.toThrow("simulated sidecar rename failure");

    const originals = await readdir(path.join(root, "originals", "sketches")).catch(() => []);
    const metadata = await readdir(path.join(root, "metadata", "sketches")).catch(() => []);
    const temp = await readdir(path.join(root, "tmp", "sketches")).catch(() => []);
    expect(originals).toEqual([]);
    expect(metadata).toEqual([]);
    expect(temp).toEqual([]);
  });

  it("protects artifacts referenced by history, draft, or queue", () => {
    const artifactId = "sketch_reference_1";
    const history = [{
      id: "job_1",
      inputAssets: [{ id: "asset_1", name: "sketch.png", path: "/tmp/sketch.png", mimeType: "image/png", sizeBytes: 1, role: "sketch", artifactId }],
      sketch: { artifactId }
    } as unknown as GenerationJob];
    const draft = {
      inputAssets: [{ id: "asset_2", name: "sketch.png", path: "/tmp/sketch.png", mimeType: "image/png", sizeBytes: 1, role: "sketch", artifactId }]
    } as WorkspaceDraft;

    expect(collectSketchArtifactIds({ history, draft })).toContain(artifactId);
    expect(isSketchArtifactReferenced(artifactId, { history: [], draft }, queueFile(artifactId))).toBe(true);
    expect(isSketchArtifactReferenced("sketch_other_1", { history: [], draft }, queueFile(artifactId))).toBe(false);
  });

  it("removes both files only when explicitly requested", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "crossgen-sketch-store-remove-"));
    const record = await writeSketchArtifact({
      root,
      document,
      pngBytes,
      documentHash: sketchDocumentHash(document),
      artifactId: "sketch_remove_1"
    });
    await removeSketchArtifact(root, record.artifactId);
    await expect(readSketchArtifact({ root, artifactId: record.artifactId })).rejects.toThrow();
  });
});
