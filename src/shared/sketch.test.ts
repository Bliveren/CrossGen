import { describe, expect, it } from "vitest";
import {
  countBrushStrokes,
  countSketchPoints,
  fitSketchCanvasSize,
  hasSketchMarks,
  normalizeSketchGuidance,
  normalizeSketchDocument,
  sketchGuidanceLines,
  sketchDocumentHash,
  validateSketchDocument,
  validateSketchTaskMetadata
} from "./sketch";
import type { SketchDocument } from "./types";

const document: SketchDocument = {
  schemaVersion: 1,
  width: 1024,
  height: 768,
  background: "white",
  strokes: [{
    id: "stroke_1",
    tool: "brush",
    color: "#1f2937",
    size: 12,
    opacity: 1,
    points: [
      { x: 10, y: 12 },
      { x: 80, y: 96, pressure: 0.5 }
    ]
  }]
};

describe("Sketch document helpers", () => {
  it("fits canvas dimensions to the model grid and pixel budget", () => {
    const fitted = fitSketchCanvasSize(3840, 3840);
    expect(fitted.width % 16).toBe(0);
    expect(fitted.height % 16).toBe(0);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(8_294_400);
    expect(fitted).toEqual({ width: 2880, height: 2880 });
  });

  it("validates, normalizes, and hashes bounded sketch documents", () => {
    expect(validateSketchDocument(document).ok).toBe(true);
    expect(countBrushStrokes(document)).toBe(1);
    expect(countSketchPoints(document)).toBe(2);
    expect(hasSketchMarks(document)).toBe(true);
    expect(normalizeSketchDocument({ ...document, strokes: [{ ...document.strokes[0], color: "#ABCDEF" }] })?.strokes[0].color).toBe("#abcdef");
    expect(sketchDocumentHash(document)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("rejects oversized, malformed, or empty task metadata", () => {
    expect(validateSketchDocument({ ...document, width: 9000 }).ok).toBe(false);
    expect(validateSketchDocument({ ...document, strokes: [{ ...document.strokes[0], points: [] }] }).ok).toBe(false);
    expect(hasSketchMarks({ ...document, strokes: [{ ...document.strokes[0], tool: "eraser" }] })).toBe(false);
    expect(validateSketchTaskMetadata({
      artifactId: "sketch_1",
      width: document.width,
      height: document.height,
      background: document.background,
      strokeCount: 1,
      pointCount: 2,
      documentHash: sketchDocumentHash(document)
    }).ok).toBe(true);
    expect(validateSketchTaskMetadata({ artifactId: "", documentHash: "bad" }).ok).toBe(false);
  });

  it("normalizes selected guidance priorities without changing their stable order", () => {
    expect(normalizeSketchGuidance(["perspective", "pose", "perspective", "unknown"])).toEqual(["pose", "perspective"]);
    expect(sketchGuidanceLines(["composition", "perspective"])).toEqual([
      "- Preserve the sketch's composition and subject placement.",
      "- Preserve the sketch's perspective, depth, and spatial relationships."
    ]);
    expect(validateSketchTaskMetadata({
      artifactId: "sketch_1",
      width: document.width,
      height: document.height,
      background: document.background,
      strokeCount: 1,
      pointCount: 2,
      documentHash: sketchDocumentHash(document),
      guidance: ["composition", "pose"]
    }).ok).toBe(true);
  });
});
