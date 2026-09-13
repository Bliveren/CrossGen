import { describe, expect, it, vi } from "vitest";
import type { SketchStroke } from "../shared/types";
import { canvasPngBytes, drawStroke } from "./SketchCanvas";

function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter"
  } as unknown as CanvasRenderingContext2D;
}

function stroke(tool: SketchStroke["tool"]): SketchStroke {
  return {
    id: `stroke-${tool}`,
    tool,
    color: "#1f2937",
    size: 12,
    opacity: 1,
    points: [{ x: 10, y: 10 }]
  };
}

describe("SketchCanvas stroke rendering", () => {
  it("paints white when erasing on a white canvas", () => {
    const target = context();
    drawStroke(target, stroke("eraser"), 0, "white");
    expect(target.globalCompositeOperation).toBe("source-over");
    expect(target.fillStyle).toBe("#ffffff");
  });

  it("uses destination-out when erasing on a transparent canvas", () => {
    const target = context();
    drawStroke(target, stroke("eraser"), 0, "transparent");
    expect(target.globalCompositeOperation).toBe("destination-out");
    expect(target.fillStyle).toBe("#1f2937");
  });
});

describe("SketchCanvas export surface", () => {
  it("keeps the document background when a view-only underlay is present", async () => {
    const target = context();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(target);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback({
        arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
      } as unknown as Blob);
    });
    const source = document.createElement("canvas");
    source.width = 200;
    source.height = 100;
    const underlay = document.createElement("img");
    Object.defineProperty(underlay, "complete", { configurable: true, value: true });
    Object.defineProperty(underlay, "naturalWidth", { configurable: true, value: 200 });
    Object.defineProperty(underlay, "naturalHeight", { configurable: true, value: 100 });

    await canvasPngBytes(source, {
      schemaVersion: 1,
      width: 200,
      height: 100,
      background: "white",
      strokes: []
    }, underlay, false);

    expect(target.fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(target.drawImage).not.toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
    toBlob.mockRestore();
  });

  it("includes a selected underlay at the requested opacity only on explicit export", async () => {
    const target = context();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(target);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback({
        arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
      } as unknown as Blob);
    });
    const source = document.createElement("canvas");
    source.width = 200;
    source.height = 100;
    const underlay = document.createElement("img");
    Object.defineProperty(underlay, "complete", { configurable: true, value: true });
    Object.defineProperty(underlay, "naturalWidth", { configurable: true, value: 200 });
    Object.defineProperty(underlay, "naturalHeight", { configurable: true, value: 100 });

    await canvasPngBytes(source, {
      schemaVersion: 1,
      width: 200,
      height: 100,
      background: "transparent",
      strokes: []
    }, underlay, true, 0.25, false);

    expect(target.drawImage).toHaveBeenCalledWith(underlay, 0, 0, 200, 100);
    expect(target.fillRect).not.toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
    toBlob.mockRestore();
  });
});
