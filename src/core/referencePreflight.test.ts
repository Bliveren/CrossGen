import { describe, expect, it } from "vitest";
import {
  buildReferencePreflightSummaries,
  normalizeReferencePreflightValue,
  referencePreflightBlockingMessage,
  referencePreflightTargetDimensions
} from "./referencePreflight.js";
import type { InputAsset } from "../shared/types.js";

function asset(patch: Partial<InputAsset> = {}): InputAsset {
  return {
    id: patch.id ?? "asset-1",
    name: patch.name ?? "source.png",
    path: patch.path ?? "/tmp/source.png",
    mimeType: patch.mimeType ?? "image/png",
    sizeBytes: patch.sizeBytes ?? 1024,
    width: patch.width,
    height: patch.height,
    hasAlpha: patch.hasAlpha
  };
}

describe("reference preflight", () => {
  it("keeps small reference images unchanged", () => {
    const summaries = buildReferencePreflightSummaries([asset({ width: 1024, height: 1024, sizeBytes: 2 * 1024 * 1024 })]);

    expect(summaries).toEqual([
      expect.objectContaining({
        id: "asset-1",
        role: "reference",
        reason: "within_limits",
        blocked: false,
        original: expect.objectContaining({ mime: "image/png", width: 1024, height: 1024, bytes: 2 * 1024 * 1024 }),
        request: expect.objectContaining({ mime: "image/png", width: 1024, height: 1024, downsampled: false })
      })
    ]);
  });

  it("plans a non-destructive request copy for oversized references without a mask", () => {
    const summaries = buildReferencePreflightSummaries([
      asset({ id: "large", name: "large.jpg", mimeType: "image/jpeg", width: 8000, height: 6000, sizeBytes: 40 * 1024 * 1024 })
    ]);

    expect(summaries?.[0]).toMatchObject({
      id: "large",
      role: "reference",
      reason: "byte_limit",
      blocked: false,
      original: { mime: "image/jpeg", width: 8000, height: 6000, bytes: 40 * 1024 * 1024 },
      request: {
        mime: "image/jpeg",
        downsampled: true
      }
    });
    expect(summaries?.[0]?.request.width).toBeLessThan(8000);
    expect(summaries?.[0]?.request.height).toBeLessThan(6000);
    expect(summaries?.[0]?.warning).toContain("temporary downsampled request copy");
    expect(referencePreflightBlockingMessage(summaries)).toBeUndefined();
  });

  it("preserves mask and source sizes when a mask is present", () => {
    const summaries = buildReferencePreflightSummaries(
      [asset({ id: "source", width: 8000, height: 6000, sizeBytes: 20 * 1024 * 1024 })],
      asset({ id: "mask", name: "mask.png", width: 8000, height: 6000, sizeBytes: 8 * 1024 * 1024 })
    );

    expect(summaries).toEqual([
      expect.objectContaining({
        id: "source",
        role: "reference",
        request: expect.objectContaining({ width: 8000, height: 6000, downsampled: false })
      }),
      expect.objectContaining({
        id: "mask",
        role: "mask",
        reason: "mask_preserved",
        request: expect.objectContaining({ width: 8000, height: 6000, downsampled: false })
      })
    ]);
  });

  it("blocks oversized mask requests because masks are not downsampled", () => {
    const summaries = buildReferencePreflightSummaries(
      [asset({ id: "source", width: 12000, height: 12000, sizeBytes: 2 * 1024 * 1024 })],
      asset({ id: "mask", name: "mask.png", width: 12000, height: 12000, sizeBytes: 80 * 1024 * 1024 }),
      { limits: { hardPixels: 200_000_000 } }
    );

    expect(summaries?.find((summary) => summary.role === "mask")).toMatchObject({
      blocked: true,
      reason: "mask_preserved"
    });
    expect(referencePreflightBlockingMessage(summaries)).toContain("Mask");
  });

  it("blocks mask requests when source and mask dimensions do not match", () => {
    const summaries = buildReferencePreflightSummaries(
      [asset({ id: "source", width: 1024, height: 768, sizeBytes: 2 * 1024 * 1024 })],
      asset({ id: "mask", name: "mask.png", width: 768, height: 1024, sizeBytes: 512 * 1024 })
    );

    expect(summaries?.find((summary) => summary.role === "mask")).toMatchObject({
      blocked: true,
      reason: "mask_dimension_mismatch",
      warning: expect.stringContaining("do not match the source image dimensions")
    });
    expect(referencePreflightBlockingMessage(summaries)).toContain("same width and height");
  });

  it("does not block mask requests when dimensions are unavailable", () => {
    const summaries = buildReferencePreflightSummaries(
      [asset({ id: "source", width: undefined, height: undefined, sizeBytes: 2 * 1024 * 1024 })],
      asset({ id: "mask", name: "mask.png", width: 768, height: 1024, sizeBytes: 512 * 1024 })
    );

    expect(summaries?.find((summary) => summary.role === "mask")).toMatchObject({
      blocked: false,
      reason: "mask_preserved"
    });
    expect(referencePreflightBlockingMessage(summaries)).toBeUndefined();
  });

  it("normalizes persisted preflight summaries", () => {
    const normalized = normalizeReferencePreflightValue([
      {
        id: "asset-1",
        role: "mask",
        name: " mask.png ",
        original: { mime: "image/png", width: 512, height: 512, bytes: 1200, hasAlpha: true },
        request: { mime: "image/png", width: 512, height: 512, bytes: 1200, hasAlpha: true, downsampled: false },
        reason: "mask_preserved",
        blocked: false
      },
      { id: "", original: {} }
    ]);

    expect(normalized).toEqual([
      expect.objectContaining({
        id: "asset-1",
        role: "mask",
        reason: "mask_preserved",
        original: { mime: "image/png", width: 512, height: 512, bytes: 1200, hasAlpha: true },
        request: expect.objectContaining({ hasAlpha: true })
      })
    ]);
  });

  it("carries alpha metadata into request summaries", () => {
    const summaries = buildReferencePreflightSummaries([
      asset({ id: "transparent", mimeType: "image/png", width: 1024, height: 1024, sizeBytes: 1024, hasAlpha: true })
    ]);

    expect(summaries?.[0]).toMatchObject({
      original: { hasAlpha: true },
      request: { hasAlpha: true }
    });
  });

  it("computes bounded target dimensions without changing aspect ratio materially", () => {
    const target = referencePreflightTargetDimensions(8000, 4000, { warnPixels: 8_000_000, maxEdge: 4096 });

    expect(target.downsampled).toBe(true);
    expect(target.width * target.height).toBeLessThanOrEqual(8_050_000);
    expect(target.width / target.height).toBeCloseTo(2, 1);
  });
});
