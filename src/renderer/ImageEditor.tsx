import type React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bold,
  Brush,
  CheckCircle2,
  Circle,
  Crop,
  Download,
  FolderInput,
  Maximize2,
  Pencil,
  RectangleHorizontal,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { ImageAsset } from "../shared/types";
import type { Language, UiCopy } from "./i18n";
import { ANNOTATION_COLOR_SWATCHES, type AnnotationDrawingLayer, type AnnotationTextBox, type AnnotationTool, type CanvasRect, type CropSelection, type CropShape } from "./imageEditorTypes";

interface ImageEditorProps {
  copy: UiCopy;
  language: Language;
  resultCanvasRef: React.RefObject<HTMLDivElement | null>;
  zoomSurfaceRef: React.RefObject<HTMLDivElement | null>;
  annotationFrameRef: React.RefObject<HTMLDivElement | null>;
  annotationImageRef: React.RefObject<HTMLImageElement | null>;
  annotationCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  activePreviewSource?: string;
  activeJobError: string | null;
  activeImage?: ImageAsset;
  activeResults: ImageAsset[];
  partialImages: ImageAsset[];
  previewZoom: number;
  previewPan: { x: number; y: number };
  previewZoomPercent: number;
  isPanning: boolean;
  isPreviewCanvasInteractive: boolean;
  hasEditorOverlay: boolean;
  isEditingPreview: boolean;
  isCroppingPreview: boolean;
  hasEditedPreviewChanges: boolean;
  annotationDrawingLayers: AnnotationDrawingLayer[];
  annotationTextBoxes: AnnotationTextBox[];
  activeAnnotationTextBoxId: string | null;
  draftTextRect: CanvasRect | null;
  cropSelection: CropSelection | null;
  annotationTool: AnnotationTool;
  annotationColor: string;
  annotationSize: number;
  annotationTextSize: number;
  isAnnotationTextBold: boolean;
  isAnnotationColorPickerOpen: boolean;
  editorUndoStackLength: number;
  cropShape: CropShape;
  assetSource: (asset?: ImageAsset | null) => string | undefined;
  buttonFeedbackClass: (id: string, base?: string) => string;
  annotationLayerStyle: (order: number) => React.CSSProperties;
  cssRectForCanvasRect: (rect: CanvasRect) => React.CSSProperties;
  cssSizeForCanvasUnits: (canvasPixels: number) => string;
  onOpenPreview: () => void;
  onPreviewPanStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPreviewPanMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPreviewPanEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeAnnotationCanvas: (clear?: boolean) => void;
  onImageContextMenu: (event: React.MouseEvent<HTMLImageElement>) => void;
  onStartAnnotation: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onContinueAnnotation: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onFinishAnnotation: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onTextBoxFocus: (box: AnnotationTextBox) => void;
  onTextBoxChange: (id: string, text: string) => void;
  onPruneEmptyTextBox: (id: string) => void;
  onStartTextBoxResize: (event: React.PointerEvent<HTMLElement>, box: AnnotationTextBox) => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
  onToggleEditMode: () => void;
  onToggleCropMode: () => void;
  onDownloadCurrentPreview: () => void;
  onSaveCurrentPreviewToGallery: () => void;
  onSelectDrawTool: () => void;
  onSelectTextTool: () => void;
  onToggleAnnotationColorPicker: () => void;
  onApplyAnnotationColor: (color: string) => void;
  onCloseAnnotationColorPicker: () => void;
  onAnnotationSizeChange: (size: number) => void;
  onAnnotationTextSizeChange: (size: number) => void;
  onToggleAnnotationTextBold: () => void;
  onUndoEditorAction: () => void;
  onClearAnnotations: () => void;
  onCropShapeChange: (shape: CropShape) => void;
  onSaveCropSelectionToGallery: () => void;
  onApplyCropSelection: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetPreviewView: () => void;
  onSelectResult: (assetId: string) => void;
  onActivatePartialImage: (asset: ImageAsset) => void;
}

export function ImageEditor({
  copy,
  language,
  resultCanvasRef,
  zoomSurfaceRef,
  annotationFrameRef,
  annotationImageRef,
  annotationCanvasRef,
  activePreviewSource,
  activeJobError,
  activeImage,
  activeResults,
  partialImages,
  previewZoom,
  previewPan,
  previewZoomPercent,
  isPanning,
  isPreviewCanvasInteractive,
  hasEditorOverlay,
  isEditingPreview,
  isCroppingPreview,
  hasEditedPreviewChanges,
  annotationDrawingLayers,
  annotationTextBoxes,
  activeAnnotationTextBoxId,
  draftTextRect,
  cropSelection,
  annotationTool,
  annotationColor,
  annotationSize,
  annotationTextSize,
  isAnnotationTextBold,
  isAnnotationColorPickerOpen,
  editorUndoStackLength,
  cropShape,
  assetSource,
  buttonFeedbackClass,
  annotationLayerStyle,
  cssRectForCanvasRect,
  cssSizeForCanvasUnits,
  onOpenPreview,
  onPreviewPanStart,
  onPreviewPanMove,
  onPreviewPanEnd,
  onResizeAnnotationCanvas,
  onImageContextMenu,
  onStartAnnotation,
  onContinueAnnotation,
  onFinishAnnotation,
  onTextBoxFocus,
  onTextBoxChange,
  onPruneEmptyTextBox,
  onStartTextBoxResize,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift,
  onToggleEditMode,
  onToggleCropMode,
  onDownloadCurrentPreview,
  onSaveCurrentPreviewToGallery,
  onSelectDrawTool,
  onSelectTextTool,
  onToggleAnnotationColorPicker,
  onApplyAnnotationColor,
  onCloseAnnotationColorPicker,
  onAnnotationSizeChange,
  onAnnotationTextSizeChange,
  onToggleAnnotationTextBold,
  onUndoEditorAction,
  onClearAnnotations,
  onCropShapeChange,
  onSaveCropSelectionToGallery,
  onApplyCropSelection,
  onZoomOut,
  onZoomIn,
  onResetPreviewView,
  onSelectResult,
  onActivatePartialImage
}: ImageEditorProps) {
  return (
    <section className="result-stage">
      <div className="result-canvas" ref={resultCanvasRef}>
        {activePreviewSource ? (
          <>
            <div
              ref={zoomSurfaceRef}
              className={isPanning ? "zoom-surface panning" : previewZoom > 1 ? "zoom-surface pannable" : "zoom-surface"}
              onDoubleClick={onOpenPreview}
              onPointerDown={onPreviewPanStart}
              onPointerMove={onPreviewPanMove}
              onPointerUp={onPreviewPanEnd}
              onPointerCancel={onPreviewPanEnd}
            >
              <div
                ref={annotationFrameRef}
                className="preview-image-frame"
                style={{ width: `${previewZoom * 100}%`, transform: `translate(${previewPan.x}px, ${previewPan.y}px)` }}
              >
                <img
                  ref={annotationImageRef}
                  src={activePreviewSource}
                  alt={copy.generatedResult}
                  role="button"
                  tabIndex={0}
                  aria-label={copy.resultViewer}
                  crossOrigin={/^(?:https?:|image2tools-asset:)/i.test(activePreviewSource) ? "anonymous" : undefined}
                  draggable={false}
                  onLoad={() => onResizeAnnotationCanvas(true)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onOpenPreview();
                  }}
                  onContextMenu={onImageContextMenu}
                />
                {annotationDrawingLayers.map((layer) => (
                  <img
                    key={layer.id}
                    className="annotation-drawing-layer"
                    src={layer.dataUrl}
                    alt=""
                    draggable={false}
                    style={annotationLayerStyle(layer.order)}
                  />
                ))}
                <canvas
                  ref={annotationCanvasRef}
                  className={[
                    "annotation-canvas",
                    isPreviewCanvasInteractive ? "active" : hasEditorOverlay ? "visible" : "",
                    isCroppingPreview ? "crop-mode" : annotationTool === "text" ? "text-mode" : ""
                  ].filter(Boolean).join(" ")}
                  style={{
                    zIndex: isCroppingPreview || (isEditingPreview && annotationTool === "draw") ? 1000 : 10
                  }}
                  onPointerDown={onStartAnnotation}
                  onPointerMove={onContinueAnnotation}
                  onPointerUp={onFinishAnnotation}
                  onPointerCancel={onFinishAnnotation}
                />
                {draftTextRect && isEditingPreview && (
                  <div className="annotation-text-draft" style={cssRectForCanvasRect(draftTextRect)} />
                )}
                {cropSelection && isCroppingPreview && (
                  <div
                    className={`crop-selection ${cropSelection.shape}`}
                    style={cssRectForCanvasRect(cropSelection)}
                  />
                )}
                {annotationTextBoxes.map((box) => (
                  isEditingPreview ? (
                    <div
                      key={box.id}
                      className={activeAnnotationTextBoxId === box.id ? "annotation-text-box-wrap active" : "annotation-text-box-wrap"}
                      style={{ ...cssRectForCanvasRect(box), ...annotationLayerStyle(box.order) }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <textarea
                        data-annotation-text-box-id={box.id}
                        className="annotation-text-box-input"
                        value={box.text}
                        onFocus={() => onTextBoxFocus(box)}
                        onBlur={(event) => {
                          const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
                          if (nextTarget && event.currentTarget.parentElement?.contains(nextTarget)) return;
                          if (!event.currentTarget.value.trim()) onPruneEmptyTextBox(box.id);
                        }}
                        onChange={(event) => onTextBoxChange(box.id, event.target.value)}
                        aria-label={copy.textBox}
                        style={{
                          color: box.color,
                          fontSize: cssSizeForCanvasUnits(box.fontSize),
                          fontWeight: box.bold ? 700 : 400,
                          padding: cssSizeForCanvasUnits(Math.max(2, box.fontSize / 3))
                        }}
                      />
                      <button
                        type="button"
                        className="annotation-text-resize-handle"
                        onPointerDown={(event) => onStartTextBoxResize(event, box)}
                        aria-label={language === "zh" ? "调整文本框大小" : "Resize text box"}
                        data-tooltip={language === "zh" ? "调整文本框大小" : "Resize text box"}
                      />
                    </div>
                  ) : (
                    <div
                      key={box.id}
                      className="annotation-text-box readonly"
                      style={{
                        ...cssRectForCanvasRect(box),
                        ...annotationLayerStyle(box.order),
                        color: box.color,
                        fontSize: cssSizeForCanvasUnits(box.fontSize),
                        fontWeight: box.bold ? 700 : 400,
                        padding: cssSizeForCanvasUnits(Math.max(2, box.fontSize / 3))
                      }}
                    >
                      {box.text}
                    </div>
                  )
                ))}
              </div>
            </div>
            <div
              className="preview-control-strip"
              onMouseMove={onMoveToolbarTowardPointer}
              onMouseLeave={onResetToolbarDrift}
            >
              <div className="preview-primary-actions" aria-label={copy.resultViewer}>
                <button
                  type="button"
                  className={isEditingPreview ? "icon-button active" : "icon-button"}
                  disabled={!activePreviewSource}
                  onClick={onToggleEditMode}
                  aria-label={isEditingPreview ? copy.back : copy.editImage}
                  data-tooltip={isEditingPreview ? copy.back : copy.editImage}
                >
                  {isEditingPreview ? <ArrowLeft size={16} /> : <Pencil size={16} />}
                </button>
                <button
                  type="button"
                  className={isCroppingPreview ? "icon-button active" : "icon-button"}
                  disabled={!activePreviewSource}
                  onClick={onToggleCropMode}
                  aria-label={isCroppingPreview ? copy.back : copy.cropImage}
                  data-tooltip={isCroppingPreview ? copy.back : copy.cropImage}
                >
                  {isCroppingPreview ? <ArrowLeft size={16} /> : <Crop size={16} />}
                </button>
                <button
                  type="button"
                  className={hasEditedPreviewChanges || cropSelection ? buttonFeedbackClass("download:edited") : activeImage ? buttonFeedbackClass(`download:${activeImage.id}`) : "icon-button"}
                  disabled={!activeImage}
                  onClick={onDownloadCurrentPreview}
                  aria-label={hasEditedPreviewChanges || cropSelection ? copy.downloadEditedImage : copy.download}
                  data-tooltip={hasEditedPreviewChanges || cropSelection ? copy.downloadEditedImage : copy.download}
                >
                  <Download size={16} />
                </button>
                <button
                  type="button"
                  className={buttonFeedbackClass(isCroppingPreview && cropSelection ? "gallery:cropped" : hasEditedPreviewChanges ? "gallery:edited" : "gallery:current")}
                  disabled={!activeImage}
                  onClick={onSaveCurrentPreviewToGallery}
                  aria-label={copy.saveToGallery}
                  data-tooltip={copy.saveToGallery}
                >
                  <Save size={16} />
                </button>
              </div>
              {isEditingPreview && (
                <div className="annotation-tools preview-secondary-actions" data-drift="subtle">
                  <button type="button" className={annotationTool === "draw" ? "icon-button active" : "icon-button"} onClick={onSelectDrawTool} aria-label={copy.drawTool} data-tooltip={copy.drawTool}>
                    <Brush size={15} />
                  </button>
                  <button type="button" className={annotationTool === "text" ? "icon-button active" : "icon-button"} onClick={onSelectTextTool} aria-label={copy.textTool} data-tooltip={copy.textTool}>
                    <Type size={15} />
                  </button>
                  <div className="annotation-color-picker">
                    <button
                      type="button"
                      className="icon-button annotation-color-button"
                      onClick={onToggleAnnotationColorPicker}
                      aria-label={copy.annotationColor}
                      data-tooltip={copy.annotationColor}
                      aria-expanded={isAnnotationColorPickerOpen}
                    >
                      <span className="annotation-current-color" style={{ background: annotationColor }} />
                    </button>
                    {isAnnotationColorPickerOpen && (
                      <div className="annotation-color-popover">
                        <input
                          type="color"
                          value={annotationColor}
                          onChange={(event) => onApplyAnnotationColor(event.target.value)}
                          aria-label={copy.annotationColor}
                        />
                        <div className="annotation-swatches" aria-label={copy.quickColors}>
                          {ANNOTATION_COLOR_SWATCHES.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={annotationColor.toLowerCase() === color.toLowerCase() ? "annotation-swatch active" : "annotation-swatch"}
                              style={{ background: color }}
                              onClick={() => {
                                onApplyAnnotationColor(color);
                                onCloseAnnotationColorPicker();
                              }}
                              aria-label={copy.chooseColor(color)}
                              data-tooltip={copy.chooseColor(color)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {annotationTool === "draw" ? (
                    <span className="range-tooltip" data-tooltip={`${copy.strokeWidth}: ${annotationSize}px`}>
                      <input
                        type="range"
                        min="2"
                        max="32"
                        value={annotationSize}
                        onChange={(event) => onAnnotationSizeChange(Number(event.target.value))}
                        aria-label={copy.strokeWidth}
                      />
                    </span>
                  ) : (
                    <>
                      <span className="range-tooltip" data-tooltip={`${copy.textSize}: ${annotationTextSize}px`}>
                        <input
                          type="range"
                          min="12"
                          max="72"
                          value={annotationTextSize}
                          onChange={(event) => onAnnotationTextSizeChange(Number(event.target.value))}
                          aria-label={copy.textSize}
                        />
                      </span>
                      <button type="button" className={isAnnotationTextBold ? "icon-button active" : "icon-button"} onClick={onToggleAnnotationTextBold} aria-label={copy.boldText} data-tooltip={copy.boldText}>
                        <Bold size={15} />
                      </button>
                    </>
                  )}
                  <button type="button" className="icon-button" onClick={onUndoEditorAction} disabled={editorUndoStackLength === 0} aria-label={copy.undo} data-tooltip={copy.undo}>
                    <RotateCcw size={15} />
                  </button>
                  <button type="button" className="icon-button" onClick={onClearAnnotations} aria-label={copy.clearAnnotations} data-tooltip={copy.clearAnnotations}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
              {isCroppingPreview && (
                <div className="annotation-tools crop-tools preview-secondary-actions" data-drift="subtle">
                  <button type="button" className={cropShape === "rect" ? "icon-button active" : "icon-button"} onClick={() => onCropShapeChange("rect")} aria-label={copy.cropRectangle} data-tooltip={copy.cropRectangle}>
                    <RectangleHorizontal size={15} />
                  </button>
                  <button type="button" className={cropShape === "ellipse" ? "icon-button active" : "icon-button"} onClick={() => onCropShapeChange("ellipse")} aria-label={copy.cropEllipse} data-tooltip={copy.cropEllipse}>
                    <Circle size={15} />
                  </button>
                  <button type="button" className="icon-button" onClick={onUndoEditorAction} disabled={editorUndoStackLength === 0} aria-label={copy.undo} data-tooltip={copy.undo}>
                    <RotateCcw size={15} />
                  </button>
                  <button type="button" className={buttonFeedbackClass("gallery:cropped")} onClick={onSaveCropSelectionToGallery} disabled={!cropSelection} aria-label={copy.saveCropSelectionToGallery} data-tooltip={copy.saveCropSelectionToGallery}>
                    <FolderInput size={15} />
                  </button>
                  <button type="button" className="icon-button" onClick={onApplyCropSelection} disabled={!cropSelection} aria-label={copy.applyCrop} data-tooltip={copy.applyCrop}>
                    <CheckCircle2 size={15} />
                  </button>
                </div>
              )}
            </div>
            <div
              className="preview-zoom-strip"
              onMouseMove={onMoveToolbarTowardPointer}
              onMouseLeave={onResetToolbarDrift}
            >
              <button type="button" className="icon-button" onClick={onZoomOut} aria-label={copy.zoomOut} data-tooltip={copy.zoomOut}>
                <ZoomOut size={16} />
              </button>
              <span className="zoom-readout" title={copy.zoomLevel}>{previewZoomPercent}%</span>
              <button type="button" className="icon-button" onClick={onZoomIn} aria-label={copy.zoomIn} data-tooltip={copy.zoomIn}>
                <ZoomIn size={16} />
              </button>
              <button type="button" className="icon-button" disabled={previewZoom === 1 && previewPan.x === 0 && previewPan.y === 0} onClick={onResetPreviewView} aria-label={copy.resetZoom} data-tooltip={copy.resetZoom}>
                <Maximize2 size={16} />
              </button>
            </div>
          </>
        ) : activeJobError ? (
          <div className="job-error-panel" role="alert">
            <AlertTriangle size={30} />
            <strong>{copy.jobFailed}</strong>
            <span>{activeJobError}</span>
          </div>
        ) : (
          <div className="empty-state">
            <Sparkles size={30} />
            <span>{copy.outputEmpty}</span>
          </div>
        )}
      </div>

      {activeResults.length > 1 && (
        <div className="result-strip">
          {activeResults.map((asset, index) => (
            <button
              key={asset.id}
              type="button"
              className={asset.id === activeImage?.id ? "active" : undefined}
              onClick={() => onSelectResult(asset.id)}
              title={`${copy.generatedResult} ${index + 1}`}
            >
              <img src={assetSource(asset)} alt={`${copy.generatedResult} ${index + 1}`} />
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
      )}

      {partialImages.length > 0 && (
        <div className="partial-strip">
          {partialImages.map((asset, index) => (
            <button key={asset.id} type="button" onClick={() => onActivatePartialImage(asset)}>
              <img src={assetSource(asset)} alt={`${copy.partialImages} ${index + 1}`} />
              <span>P{index + 1}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
