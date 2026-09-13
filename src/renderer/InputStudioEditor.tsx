import { useEffect, useRef, useState } from "react";
import type React from "react";
import {
  Brush,
  Check,
  Eraser,
  Maximize2,
  Paintbrush,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { InputAsset } from "../shared/types";
import type { UiCopy } from "./i18n";

export type InputStudioEditorMode = "reference" | "mask";

interface InputStudioEditorProps {
  copy: UiCopy;
  mode: InputStudioEditorMode;
  asset: InputAsset;
  source: string;
  maskSource?: string;
  sourceImageRef?: React.RefObject<HTMLImageElement | null>;
  maskCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
  brushSize: number;
  maskTool?: "brush" | "eraser";
  maskCheck?: { ok: boolean; message?: string } | null;
  onSourceImageLoad?: () => void;
  onStartMaskPaint?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onContinueMaskPaint?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onFinishMaskPaint?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onBrushSizeChange?: (size: number) => void;
  onMaskToolChange?: (tool: "brush" | "eraser") => void;
  onSetPrimary?: () => void;
  onUseAsUnderlay?: () => void;
  onOpenMask?: () => void;
  onClearMask?: () => void;
  onApplyMask?: () => void;
  onCancelMask?: () => void;
  onClose: () => void;
}

export function InputStudioEditor({
  copy,
  mode,
  asset,
  source,
  maskSource,
  sourceImageRef,
  maskCanvasRef,
  brushSize,
  maskTool = "brush",
  maskCheck,
  onSourceImageLoad,
  onStartMaskPaint,
  onContinueMaskPaint,
  onFinishMaskPaint,
  onBrushSizeChange,
  onMaskToolChange,
  onSetPrimary,
  onUseAsUnderlay,
  onOpenMask,
  onClearMask,
  onApplyMask,
  onCancelMask,
  onClose
}: InputStudioEditorProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    panStartRef.current = null;
  }, [asset.id, mode]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => Math.max(0.5, Math.min(3, Number((current + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))));
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, []);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode === "mask" || zoom <= 1 || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  };

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !panStartRef.current) return;
    const start = panStartRef.current;
    setPan({
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y
    });
  };

  const finishPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
    panStartRef.current = null;
  };

  const isMaskEditor = mode === "mask";
  const sourceName = asset.name || copy.source;
  const maskStatusText = maskCheck?.message ?? copy.checkingMask;

  return (
    <div className={`input-studio-editor ${isMaskEditor ? "mask" : "reference"}`} data-input-studio-editor={mode}>
      <header className="input-studio-editor-header">
        <div className="input-studio-editor-heading">
          <strong>{isMaskEditor ? copy.mask : copy.reference}</strong>
          <span>{sourceName}</span>
        </div>
        <button
          type="button"
          className="icon-button secondary"
          onClick={isMaskEditor ? onCancelMask ?? onClose : onClose}
          aria-label={copy.cancel}
          data-tooltip={copy.cancel}
        >
          <X size={16} />
        </button>
      </header>

      <div className="input-studio-editor-toolbar" role="toolbar" aria-label={isMaskEditor ? copy.referenceMaskTools : copy.resultViewer}>
        {isMaskEditor ? (
          <>
            <button
              type="button"
              className={maskTool === "brush" ? "icon-button active" : "icon-button"}
              onClick={() => onMaskToolChange?.("brush")}
              aria-label={copy.sketchBrush}
              data-tooltip={copy.sketchBrush}
            >
              <Brush size={16} />
            </button>
            <button
              type="button"
              className={maskTool === "eraser" ? "icon-button active" : "icon-button"}
              onClick={() => onMaskToolChange?.("eraser")}
              aria-label={copy.sketchEraser}
              data-tooltip={copy.sketchEraser}
            >
              <Eraser size={16} />
            </button>
            <span className="input-studio-toolbar-divider" aria-hidden="true" />
            <label className="input-studio-brush-size" data-tooltip={copy.maskBrushSize}>
              <span className="visually-hidden">{copy.maskBrushSize}</span>
              <input
                type="range"
                min="8"
                max="180"
                value={brushSize}
                onChange={(event) => onBrushSizeChange?.(Number(event.target.value))}
                aria-label={copy.maskBrushSize}
              />
              <output>{brushSize}px</output>
            </label>
            <button
              type="button"
              className="icon-button secondary"
              onClick={onClearMask}
              disabled={!maskSource}
              aria-label={copy.clearPaintedMask}
              data-tooltip={copy.clearPaintedMask}
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="input-studio-action-button secondary"
              onClick={onCancelMask ?? onClose}
              aria-label={copy.cancel}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              className="input-studio-action-button"
              onClick={onApplyMask}
              disabled={!maskSource}
              aria-label={copy.addPaintedMask}
            >
              <Check size={15} />
              {copy.addPaintedMask}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="input-studio-action-button"
              onClick={onOpenMask}
              aria-label={copy.addReferenceMask}
              data-tooltip={copy.addReferenceMask}
            >
              <Paintbrush size={15} />
              {copy.addReferenceMask}
            </button>
            <button
              type="button"
              className="input-studio-action-button secondary"
              onClick={onSetPrimary}
              disabled={!onSetPrimary}
              aria-label={copy.source}
              data-tooltip={copy.source}
            >
              {copy.source}
            </button>
            <button
              type="button"
              className="input-studio-action-button secondary"
              onClick={onUseAsUnderlay}
              disabled={!onUseAsUnderlay}
              aria-label={copy.sketchUnderlay}
              data-tooltip={copy.sketchUnderlay}
            >
              {copy.sketchUnderlay}
            </button>
          </>
        )}
        <span className="input-studio-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="icon-button secondary"
          onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))}
          disabled={zoom <= 0.5}
          aria-label={copy.zoomOut}
          data-tooltip={copy.zoomOut}
        >
          <ZoomOut size={16} />
        </button>
        <span className="input-studio-zoom-readout" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button secondary"
          onClick={() => setZoom((current) => Math.min(3, Number((current + 0.25).toFixed(2))))}
          disabled={zoom >= 3}
          aria-label={copy.zoomIn}
          data-tooltip={copy.zoomIn}
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="icon-button secondary"
          onClick={resetView}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          aria-label={copy.resetZoom}
          data-tooltip={copy.resetZoom}
        >
          <Maximize2 size={16} />
        </button>
      </div>

      <div
        ref={surfaceRef}
        className={isPanning ? "input-studio-canvas-stage panning" : "input-studio-canvas-stage"}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
      >
        <div
          className="input-studio-image-layer"
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
        >
          <img
            ref={sourceImageRef}
            src={source}
            alt={sourceName}
            className="input-studio-source-image"
            draggable={false}
            onLoad={onSourceImageLoad}
          />
          {isMaskEditor && (
            <canvas
              ref={maskCanvasRef}
              className="input-studio-mask-canvas"
              onPointerDown={onStartMaskPaint}
              onPointerMove={onContinueMaskPaint}
              onPointerUp={onFinishMaskPaint}
              onPointerCancel={onFinishMaskPaint}
              aria-label={copy.maskDescription}
            />
          )}
        </div>
        {!isMaskEditor && (
          <div className="input-studio-image-caption">
            <span>{copy.reference}</span>
            <small>{copy.referenceTileHint}</small>
          </div>
        )}
        {isMaskEditor && maskSource && (
          <div className="input-studio-mask-status" role="status">
            <span data-status={maskCheck?.ok ? "ok" : "idle"}>{maskStatusText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
