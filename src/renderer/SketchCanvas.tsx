import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  Brush,
  Check,
  Crosshair,
  Eraser,
  Gauge,
  Grid3x3,
  Maximize2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { SketchBackground, SketchDocument, SketchGuidanceKey, SketchPoint, SketchStroke, SketchTool } from "../shared/types";
import {
  MAX_SKETCH_HEIGHT,
  MAX_SKETCH_WIDTH,
  countBrushStrokes,
  countSketchPoints,
  hasSketchMarks,
  sketchDocumentHash,
  validateSketchDocument
} from "../shared/sketch";

interface SketchCanvasProps {
  initialDocument: SketchDocument;
  embedded?: boolean;
  underlayOptions?: SketchUnderlayOption[];
  title: string;
  saveLabel: string;
  cancelLabel: string;
  clearLabel: string;
  undoLabel: string;
  redoLabel: string;
  brushLabel: string;
  eraserLabel: string;
  colorLabel: string;
  sizeLabel: string;
  backgroundLabel: string;
  whiteLabel: string;
  transparentLabel: string;
  emptyHint: string;
  initialUnderlayAssetId?: string | null;
  underlayLabel?: string;
  underlayNoneLabel?: string;
  underlayOpacityLabel?: string;
  underlayNotice?: string;
  includeUnderlayLabel?: string;
  guidance?: SketchGuidanceKey[];
  guidanceOptions?: Array<{ key: SketchGuidanceKey; label: string; description?: string }>;
  guidanceLabel?: string;
  onGuidanceChange?: (guidance: SketchGuidanceKey[]) => void;
  gridLabel?: string;
  centerLabel?: string;
  safeAreaLabel?: string;
  pressureLabel?: string;
  pressureEnabledLabel?: string;
  pressureDisabledLabel?: string;
  zoomInLabel?: string;
  zoomOutLabel?: string;
  resetZoomLabel?: string;
  onCancel: () => void;
  onChange?: (document: SketchDocument) => void;
  onSave: (document: SketchDocument, pngBytes: Uint8Array, options?: SketchSaveOptions) => Promise<void> | void;
}

export interface SketchUnderlayOption {
  id: string;
  name: string;
  source: string;
}

export interface SketchSaveOptions {
  underlayIncluded?: boolean;
  underlayAssetId?: string;
  guidance?: SketchGuidanceKey[];
}

const DEFAULT_COLOR = "#1f2937";
const DEFAULT_SIZE = 24;
const COLOR_SWATCHES = ["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#ca8a04", "#9333ea"];

function cloneDocument(document: SketchDocument): SketchDocument {
  return {
    ...document,
    strokes: document.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point }))
    }))
  };
}

function drawDocument(
  canvas: HTMLCanvasElement,
  document: SketchDocument,
  pressureEnabled = true,
  backgroundOverride?: SketchBackground
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const renderBackground = backgroundOverride ?? document.background;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (renderBackground === "white") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of document.strokes) {
    drawStroke(context, stroke, 0, renderBackground, pressureEnabled);
  }
}

export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: SketchStroke,
  fromIndex = 0,
  background: SketchBackground = "transparent",
  pressureEnabled = true
): void {
  const first = stroke.points[fromIndex];
  if (!first) return;
  context.save();
  context.globalAlpha = stroke.opacity;
  const isWhiteBackgroundEraser = stroke.tool === "eraser" && background === "white";
  context.globalCompositeOperation = stroke.tool === "eraser" && !isWhiteBackgroundEraser ? "destination-out" : "source-over";
  context.strokeStyle = isWhiteBackgroundEraser ? "#ffffff" : stroke.color;
  context.fillStyle = isWhiteBackgroundEraser ? "#ffffff" : stroke.color;
  const pressureSamples = pressureEnabled
    ? stroke.points.slice(Math.max(0, fromIndex - 1)).map((point) => point.pressure).filter((value): value is number => typeof value === "number" && value > 0)
    : [];
  const averagePressure = pressureSamples.length > 0
    ? pressureSamples.reduce((sum, value) => sum + value, 0) / pressureSamples.length
    : 0.5;
  const pressureScale = pressureEnabled && pressureSamples.length > 0 ? 0.65 + averagePressure * 0.7 : 1;
  context.lineWidth = stroke.size * pressureScale;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x, first.y, (stroke.size * pressureScale) / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = fromIndex + 1; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    context.lineTo(point.x, point.y);
  }
  context.stroke();
  context.restore();
}

type PointerSample = Pick<PointerEvent, "clientX" | "clientY" | "pressure">;

function pointFromPointer(event: PointerSample, canvas: HTMLCanvasElement): SketchPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width)),
    y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height)),
    ...(event.pressure > 0 && event.pressure < 1 ? { pressure: event.pressure } : {})
  };
}

export async function canvasPngBytes(
  canvas: HTMLCanvasElement,
  document: SketchDocument,
  underlayImage?: HTMLImageElement | null,
  includeUnderlay = false,
  underlayOpacity = 1,
  pressureEnabled = true
): Promise<Uint8Array> {
  // Always render a fresh export surface. The on-screen canvas may be
  // transparent while a view-only underlay is visible, so exporting it
  // directly could silently drop the document's white background.
  const exportCanvas = globalThis.document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const context = exportCanvas.getContext("2d");
  if (!context) throw new Error("无法创建 Sketch 导出画布。");

  const hasUnderlay = includeUnderlay
    && underlayImage?.complete
    && underlayImage.naturalWidth > 0
    && underlayImage.naturalHeight > 0;
  if (hasUnderlay) {
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, underlayOpacity));
    context.drawImage(underlayImage, 0, 0, exportCanvas.width, exportCanvas.height);
    context.restore();
    // Explicitly flattened underlays are a base image; do not import the
    // editor's opaque white backing fill on top of them.
    for (const stroke of document.strokes) drawStroke(context, stroke, 0, "transparent", pressureEnabled);
  } else {
    drawDocument(exportCanvas, document, pressureEnabled);
  }

  const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("无法导出 Sketch PNG。");
  return new Uint8Array(await blob.arrayBuffer());
}

export function SketchCanvas({
  initialDocument,
  embedded = false,
  title,
  saveLabel,
  cancelLabel,
  clearLabel,
  undoLabel,
  redoLabel,
  brushLabel,
  eraserLabel,
  colorLabel,
  sizeLabel,
  backgroundLabel,
  whiteLabel,
  transparentLabel,
  emptyHint,
  initialUnderlayAssetId = null,
  underlayOptions = [],
  underlayLabel = "Reference underlay",
  underlayNoneLabel = "None",
  underlayOpacityLabel = "Underlay opacity",
  underlayNotice = "Underlay is view-only unless explicitly included.",
  includeUnderlayLabel = "Include underlay in export",
  guidance,
  guidanceOptions = [],
  guidanceLabel = "Sketch guidance",
  onGuidanceChange,
  gridLabel = "Grid",
  centerLabel = "Center line",
  safeAreaLabel = "Safe area",
  pressureLabel = "Pressure",
  pressureEnabledLabel = "Pressure on",
  pressureDisabledLabel = "Pressure off",
  zoomInLabel = "Zoom in",
  zoomOutLabel = "Zoom out",
  resetZoomLabel = "Fit canvas",
  onCancel,
  onChange,
  onSave
}: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<SketchDocument>(cloneDocument(initialDocument));
  const currentStrokeRef = useRef<SketchStroke | null>(null);
  const undoRef = useRef<SketchDocument[]>([]);
  const redoRef = useRef<SketchDocument[]>([]);
  const [document, setDocument] = useState<SketchDocument>(() => cloneDocument(initialDocument));
  const [tool, setTool] = useState<SketchTool>("brush");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [background, setBackground] = useState(initialDocument.background);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [underlayAssetId, setUnderlayAssetId] = useState<string | null>(null);
  const [underlayOpacity, setUnderlayOpacity] = useState(0.2);
  const [includeUnderlay, setIncludeUnderlay] = useState(false);
  const [localGuidance, setLocalGuidance] = useState<SketchGuidanceKey[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const [showCenter, setShowCenter] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [pressureEnabled, setPressureEnabled] = useState(true);
  const [underlayLoaded, setUnderlayLoaded] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const onChangeRef = useRef(onChange);
  const pendingPointsRef = useRef<SketchPoint[]>([]);
  const drawFrameRef = useRef<number | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const initialDocumentHashRef = useRef(sketchDocumentHash(initialDocument));
  const underlayImageRef = useRef<HTMLImageElement | null>(null);
  const selectedUnderlay = underlayOptions.find((option) => option.id === underlayAssetId);
  const underlayVisible = Boolean(selectedUnderlay);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const nextHash = sketchDocumentHash(initialDocument);
    if (nextHash === initialDocumentHashRef.current) return;
    initialDocumentHashRef.current = nextHash;
    const next = cloneDocument(initialDocument);
    documentRef.current = next;
    setDocument(next);
    setBackground(next.background);
    undoRef.current = [];
    redoRef.current = [];
    setPan({ x: 0, y: 0 });
  }, [initialDocument]);

  const commitDocument = useCallback((next: SketchDocument, saveUndo = true) => {
    const normalized = cloneDocument(next);
    if (saveUndo) {
      undoRef.current = [...undoRef.current, cloneDocument(documentRef.current)].slice(-40);
      redoRef.current = [];
    }
    // The parent mirrors the document through onChange. Mark this local
    // snapshot as the latest source before that prop update arrives, so a
    // normal parent render does not reset the local undo/redo history.
    initialDocumentHashRef.current = sketchDocumentHash(normalized);
    documentRef.current = normalized;
    setDocument(normalized);
    onChangeRef.current?.(normalized);
  }, []);

  const flushPendingPoints = useCallback(() => {
    drawFrameRef.current = null;
    const canvas = canvasRef.current;
    const stroke = currentStrokeRef.current;
    if (!canvas || !stroke || pendingPointsRef.current.length === 0) return;
    const context = canvas.getContext("2d");
    const points = pendingPointsRef.current.splice(0);
    if (!context) return;
    for (const point of points) {
      const previous = stroke.points[stroke.points.length - 1];
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1) continue;
      const fromIndex = stroke.points.length;
      stroke.points.push(point);
      drawStroke(context, stroke, Math.max(0, fromIndex - 1), underlayVisible ? "transparent" : documentRef.current.background, pressureEnabled);
    }
  }, [pressureEnabled, underlayVisible]);

  const schedulePointFlush = useCallback(() => {
    if (drawFrameRef.current !== null) return;
    if (typeof window.requestAnimationFrame === "function") {
      drawFrameRef.current = window.requestAnimationFrame(() => flushPendingPoints());
    } else {
      flushPendingPoints();
    }
  }, [flushPendingPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.min(MAX_SKETCH_WIDTH, Math.round(document.width)));
    canvas.height = Math.max(1, Math.min(MAX_SKETCH_HEIGHT, Math.round(document.height)));
    drawDocument(canvas, document, pressureEnabled, underlayVisible ? "transparent" : undefined);
  }, [document, pressureEnabled, underlayVisible]);

  useEffect(() => () => {
    if (drawFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(drawFrameRef.current);
    }
    drawFrameRef.current = null;
    pendingPointsRef.current = [];
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || isSaving) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 1 || event.altKey) {
      setIsPanning(true);
      panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    const point = pointFromPointer(event, canvas);
    const stroke: SketchStroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      tool,
      color,
      size,
      opacity: 1,
      points: [point]
    };
    currentStrokeRef.current = stroke;
    const context = canvas.getContext("2d");
    if (context) drawStroke(context, stroke, 0, underlayVisible ? "transparent" : documentRef.current.background, pressureEnabled);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const stroke = currentStrokeRef.current;
    if (!canvas || !canvas.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    if (isPanning && panStartRef.current) {
      setPan({
        x: panStartRef.current.panX + event.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + event.clientY - panStartRef.current.y
      });
      return;
    }
    if (!stroke) return;
    const nativeEvent = event.nativeEvent;
    const samples = typeof nativeEvent.getCoalescedEvents === "function"
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent];
    pendingPointsRef.current.push(...samples.map((sample) => pointFromPointer(sample, canvas)));
    schedulePointFlush();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const stroke = currentStrokeRef.current;
    if (!canvas) return;
    if (isPanning) {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }
    if (!stroke) return;
    flushPendingPoints();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    currentStrokeRef.current = null;
    pendingPointsRef.current = [];
    const next = cloneDocument(documentRef.current);
    next.strokes.push(stroke);
    commitDocument(next);
  };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current = [...redoRef.current, cloneDocument(documentRef.current)].slice(-40);
    commitDocument(previous, false);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current = [...undoRef.current, cloneDocument(documentRef.current)].slice(-40);
    commitDocument(next, false);
  };

  const clear = () => {
    if (document.strokes.length === 0) return;
    commitDocument({ ...cloneDocument(document), strokes: [] });
  };

  const updateBackground = (nextBackground: SketchDocument["background"]) => {
    setBackground(nextBackground);
    commitDocument({ ...cloneDocument(documentRef.current), background: nextBackground });
  };

  const selectedGuidance = guidance ?? localGuidance;

  useEffect(() => {
    setUnderlayLoaded(false);
    setIncludeUnderlay(false);
    underlayImageRef.current = null;
  }, [selectedUnderlay?.id, selectedUnderlay?.source]);

  useEffect(() => {
    if (!initialUnderlayAssetId) return;
    if (!underlayOptions.some((option) => option.id === initialUnderlayAssetId)) return;
    setUnderlayAssetId(initialUnderlayAssetId);
  }, [initialUnderlayAssetId, underlayOptions]);

  const toggleGuidance = (key: SketchGuidanceKey) => {
    const next = selectedGuidance.includes(key)
      ? selectedGuidance.filter((item) => item !== key)
      : [...selectedGuidance, key];
    setLocalGuidance(next);
    onGuidanceChange?.(next);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const save = async () => {
    const current = cloneDocument(documentRef.current);
    if (!hasSketchMarks(current)) return;
    const validation = validateSketchDocument(current);
    if (!validation.ok) throw new Error(validation.message ?? "Sketch 文档无效。");
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Sketch 画布不可用。");
    setIsSaving(true);
    try {
      const bytes = await canvasPngBytes(
        canvas,
        current,
        underlayImageRef.current,
        includeUnderlay && Boolean(selectedUnderlay) && underlayLoaded,
        underlayOpacity,
        pressureEnabled
      );
      await onSave(current, bytes, {
        underlayIncluded: includeUnderlay && Boolean(selectedUnderlay) && underlayLoaded,
        underlayAssetId: includeUnderlay && underlayLoaded ? selectedUnderlay?.id : undefined,
        guidance: [...selectedGuidance]
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={embedded ? "sketch-editor-shell embedded" : "sketch-editor-shell"}
      data-sketch-editor-mode={embedded ? "embedded" : "modal"}
    >
      <header className="sketch-editor-header">
        <div>
          <h2 id="sketch-editor-title">{title}</h2>
          <p>{document.width} × {document.height} · {countBrushStrokes(document)} strokes · {countSketchPoints(document)} points · {sketchDocumentHash(document)}</p>
        </div>
        <button type="button" className="icon-button secondary" onClick={onCancel} aria-label={cancelLabel} data-tooltip={cancelLabel}>
          <X size={17} />
        </button>
      </header>
      <div className="sketch-editor-toolbar" role="toolbar" aria-label={title}>
        <button type="button" className={tool === "brush" ? "icon-button active" : "icon-button"} onClick={() => setTool("brush")} aria-label={brushLabel} data-tooltip={brushLabel}>
          <Brush size={16} />
        </button>
        <button type="button" className={tool === "eraser" ? "icon-button active" : "icon-button"} onClick={() => setTool("eraser")} aria-label={eraserLabel} data-tooltip={eraserLabel}>
          <Eraser size={16} />
        </button>
        <label className="sketch-color-control" title={colorLabel}>
          <span className="visually-hidden">{colorLabel}</span>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label={colorLabel} />
        </label>
        <div className="sketch-swatches" aria-label={colorLabel}>
          {COLOR_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={color === swatch ? "sketch-swatch active" : "sketch-swatch"}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
              aria-label={swatch}
              data-tooltip={swatch}
            />
          ))}
        </div>
        <label className="sketch-size-control">
          <span>{sizeLabel}</span>
          <input type="range" min="1" max="128" value={size} onChange={(event) => setSize(Number(event.target.value))} aria-label={sizeLabel} />
          <output>{size}</output>
        </label>
        <label className="sketch-background-control">
          <span>{backgroundLabel}</span>
          <select value={background} onChange={(event) => updateBackground(event.target.value as SketchDocument["background"])} aria-label={backgroundLabel}>
            <option value="white">{whiteLabel}</option>
            <option value="transparent">{transparentLabel}</option>
          </select>
        </label>
        {underlayOptions.length > 0 && (
          <>
            <label className="sketch-underlay-control">
              <span>{underlayLabel}</span>
              <select
                value={underlayAssetId ?? ""}
                onChange={(event) => {
                  const value = event.target.value || null;
                  setUnderlayAssetId(value);
                  if (!value) setIncludeUnderlay(false);
                }}
                aria-label={underlayLabel}
              >
                <option value="">{underlayNoneLabel}</option>
                {underlayOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            {selectedUnderlay && (
              <>
                <label className="sketch-opacity-control" data-tooltip={`${underlayOpacityLabel}: ${Math.round(underlayOpacity * 100)}%`}>
                  <span className="visually-hidden">{underlayOpacityLabel}</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(underlayOpacity * 100)}
                    onChange={(event) => setUnderlayOpacity(Number(event.target.value) / 100)}
                    aria-label={underlayOpacityLabel}
                  />
                  <output>{Math.round(underlayOpacity * 100)}%</output>
                </label>
                <label className="sketch-include-underlay-control" title={includeUnderlayLabel}>
                  <input
                    type="checkbox"
                    checked={includeUnderlay}
                    disabled={!underlayLoaded}
                    onChange={(event) => setIncludeUnderlay(event.target.checked)}
                    aria-label={includeUnderlayLabel}
                  />
                  <span>{includeUnderlayLabel}</span>
                </label>
              </>
            )}
          </>
        )}
        <span className="sketch-toolbar-divider" aria-hidden="true" />
        {guidanceOptions.length > 0 && (
          <div className="sketch-guidance-control" role="group" aria-label={guidanceLabel}>
            <span className="sketch-guidance-label">{guidanceLabel}</span>
            <div className="sketch-guidance-options">
              {guidanceOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={selectedGuidance.includes(option.key) ? "sketch-guidance-chip active" : "sketch-guidance-chip"}
                  onClick={() => toggleGuidance(option.key)}
                  aria-pressed={selectedGuidance.includes(option.key)}
                  aria-label={option.description ? `${option.label}: ${option.description}` : option.label}
                  data-tooltip={option.description ? `${option.label}: ${option.description}` : option.label}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <span className="sketch-toolbar-divider" aria-hidden="true" />
        <button type="button" className={showGrid ? "icon-button secondary active" : "icon-button secondary"} onClick={() => setShowGrid((value) => !value)} aria-label={gridLabel} data-tooltip={gridLabel} aria-pressed={showGrid}>
          <Grid3x3 size={16} />
        </button>
        <button type="button" className={showCenter ? "icon-button secondary active" : "icon-button secondary"} onClick={() => setShowCenter((value) => !value)} aria-label={centerLabel} data-tooltip={centerLabel} aria-pressed={showCenter}>
          <Crosshair size={16} />
        </button>
        <button type="button" className={showSafeArea ? "icon-button secondary active" : "icon-button secondary"} onClick={() => setShowSafeArea((value) => !value)} aria-label={safeAreaLabel} data-tooltip={safeAreaLabel} aria-pressed={showSafeArea}>
          <ScanLine size={16} />
        </button>
        <button type="button" className={pressureEnabled ? "icon-button secondary active" : "icon-button secondary"} onClick={() => setPressureEnabled((value) => !value)} aria-label={pressureEnabled ? pressureEnabledLabel : pressureDisabledLabel} data-tooltip={pressureLabel} aria-pressed={pressureEnabled}>
          <Gauge size={16} />
        </button>
        <button type="button" className="icon-button secondary" onClick={undo} disabled={undoRef.current.length === 0} aria-label={undoLabel} data-tooltip={undoLabel}>
          <RotateCcw size={16} />
        </button>
        <button type="button" className="icon-button secondary" onClick={redo} disabled={redoRef.current.length === 0} aria-label={redoLabel} data-tooltip={redoLabel}>
          <RotateCw size={16} />
        </button>
        <button type="button" className="icon-button secondary danger" onClick={clear} disabled={document.strokes.length === 0} aria-label={clearLabel} data-tooltip={clearLabel}>
          <Trash2 size={16} />
        </button>
        <span className="sketch-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="icon-button secondary"
          onClick={() => setZoom((current) => Math.max(0.5, Math.min(2.5, Number((current - 0.25).toFixed(2)))))}
          disabled={zoom <= 0.5}
          aria-label={zoomOutLabel}
          data-tooltip={zoomOutLabel}
        >
          <ZoomOut size={16} />
        </button>
        <span className="sketch-zoom-readout" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button secondary"
          onClick={() => setZoom((current) => Math.max(0.5, Math.min(2.5, Number((current + 0.25).toFixed(2)))))}
          disabled={zoom >= 2.5}
          aria-label={zoomInLabel}
          data-tooltip={zoomInLabel}
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="icon-button secondary"
          onClick={resetView}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          aria-label={resetZoomLabel}
          data-tooltip={resetZoomLabel}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div
        className="sketch-canvas-stage"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((current) => Math.max(0.5, Math.min(2.5, Number((current + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))));
        }}
      >
        <div
          className="sketch-canvas-layer"
          style={{
            "--sketch-zoom": zoom,
            "--sketch-pan-x": `${pan.x}px`,
            "--sketch-pan-y": `${pan.y}px`,
            "--sketch-aspect": `${document.width} / ${document.height}`
          } as React.CSSProperties}
          data-grid={showGrid ? "true" : "false"}
          data-center={showCenter ? "true" : "false"}
          data-safe-area={showSafeArea ? "true" : "false"}
          data-underlay={selectedUnderlay ? "true" : "false"}
        >
          {selectedUnderlay && (
            <img
              ref={underlayImageRef}
              className="sketch-underlay"
              src={selectedUnderlay.source}
              alt=""
              draggable={false}
              style={{ opacity: underlayOpacity }}
              onLoad={() => setUnderlayLoaded(true)}
              onError={() => setUnderlayLoaded(false)}
            />
          )}
          <canvas
            ref={canvasRef}
            className={background === "transparent" ? "sketch-canvas transparent" : "sketch-canvas"}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            aria-label={title}
          />
          <div className="sketch-guide-layer" aria-hidden="true">
            {showGrid && <span className="sketch-guide-grid" />}
            {showCenter && <span className="sketch-guide-center" />}
            {showSafeArea && <span className="sketch-guide-safe" />}
          </div>
        </div>
        {!hasSketchMarks(document) && <span className="sketch-empty-hint">{emptyHint}</span>}
        {selectedUnderlay && <span className="sketch-underlay-notice">{underlayNotice}</span>}
      </div>
      <footer className="sketch-editor-footer">
        <span className="sketch-editor-status">
          {backgroundLabel}: {background === "white" ? whiteLabel : transparentLabel}
          {selectedUnderlay ? ` · ${selectedUnderlay.name}${includeUnderlay ? " · " + includeUnderlayLabel : ""}` : ""}
        </span>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel} disabled={isSaving}>{cancelLabel}</button>
          <button type="button" onClick={() => void save()} disabled={isSaving || !hasSketchMarks(document)}>
            {isSaving ? <RotateCw className="spin" size={15} /> : <Check size={15} />}
            {saveLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
