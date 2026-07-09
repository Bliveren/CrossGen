import { useRef, useState } from "react";
import type {
  AnnotationDrawingLayer,
  AnnotationTextBox,
  AnnotationTool,
  CanvasPoint,
  CanvasRect,
  CropSelection,
  CropShape,
  EditorSnapshot,
  PreviewMode
} from "./imageEditorTypes";

interface TextResizeState {
  id: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

interface PanStartState {
  x: number;
  y: number;
  panX: number;
  panY: number;
}

export function useImageEditor() {
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("idle");
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("draw");
  const [annotationColor, setAnnotationColor] = useState("#FF3B30");
  const [annotationSize, setAnnotationSize] = useState(6);
  const [annotationTextSize, setAnnotationTextSize] = useState(24);
  const [isAnnotationTextBold, setIsAnnotationTextBold] = useState(false);
  const [isAnnotationColorSampling, setIsAnnotationColorSampling] = useState(false);
  const [sampledAnnotationColor, setSampledAnnotationColor] = useState<string | null>(null);
  const [annotationDrawingLayers, setAnnotationDrawingLayers] = useState<AnnotationDrawingLayer[]>([]);
  const [annotationTextBoxes, setAnnotationTextBoxes] = useState<AnnotationTextBox[]>([]);
  const [activeAnnotationTextBoxId, setActiveAnnotationTextBoxId] = useState<string | null>(null);
  const [draftTextRect, setDraftTextRect] = useState<CanvasRect | null>(null);
  const [isDrawingAnnotation, setIsDrawingAnnotation] = useState(false);
  const [hasAnnotationMarks, setHasAnnotationMarks] = useState(false);
  const [editedImageDataUrl, setEditedImageDataUrl] = useState<string | null>(null);
  const [editorUndoStack, setEditorUndoStack] = useState<EditorSnapshot[]>([]);
  const [isAnnotationColorPickerOpen, setIsAnnotationColorPickerOpen] = useState(false);
  const [cropShape, setCropShape] = useState<CropShape>("rect");
  const [cropSelection, setCropSelection] = useState<CropSelection | null>(null);

  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationImageRef = useRef<HTMLImageElement | null>(null);
  const annotationFrameRef = useRef<HTMLDivElement | null>(null);
  const annotationLastPointRef = useRef<CanvasPoint | null>(null);
  const isAnnotationPointerActiveRef = useRef(false);
  const textDragStartRef = useRef<CanvasPoint | null>(null);
  const textResizeRef = useRef<TextResizeState | null>(null);
  const annotationOrderRef = useRef(0);
  const cropDragStartRef = useRef<CanvasPoint | null>(null);
  const panStartRef = useRef<PanStartState | null>(null);
  const resultCanvasRef = useRef<HTMLDivElement | null>(null);
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null);

  const previewZoomPercent = Math.round(previewZoom * 100);
  const isEditingPreview = previewMode === "edit";
  const isCroppingPreview = previewMode === "crop";
  const isPreviewCanvasInteractive = isEditingPreview || isCroppingPreview;
  const hasEditorOverlay = hasAnnotationMarks || annotationDrawingLayers.length > 0 || annotationTextBoxes.length > 0 || isDrawingAnnotation;
  const hasExportableEditorOverlay = annotationDrawingLayers.length > 0 || annotationTextBoxes.some((box) => box.text.trim().length > 0);
  const hasEditedPreviewChanges = Boolean(editedImageDataUrl || hasExportableEditorOverlay);

  return {
    previewZoom,
    setPreviewZoom,
    previewPan,
    setPreviewPan,
    isPanning,
    setIsPanning,
    previewMode,
    setPreviewMode,
    annotationTool,
    setAnnotationTool,
    annotationColor,
    setAnnotationColor,
    annotationSize,
    setAnnotationSize,
    annotationTextSize,
    setAnnotationTextSize,
    isAnnotationTextBold,
    setIsAnnotationTextBold,
    isAnnotationColorSampling,
    setIsAnnotationColorSampling,
    sampledAnnotationColor,
    setSampledAnnotationColor,
    annotationDrawingLayers,
    setAnnotationDrawingLayers,
    annotationTextBoxes,
    setAnnotationTextBoxes,
    activeAnnotationTextBoxId,
    setActiveAnnotationTextBoxId,
    draftTextRect,
    setDraftTextRect,
    isDrawingAnnotation,
    setIsDrawingAnnotation,
    hasAnnotationMarks,
    setHasAnnotationMarks,
    editedImageDataUrl,
    setEditedImageDataUrl,
    editorUndoStack,
    setEditorUndoStack,
    isAnnotationColorPickerOpen,
    setIsAnnotationColorPickerOpen,
    cropShape,
    setCropShape,
    cropSelection,
    setCropSelection,
    annotationCanvasRef,
    annotationImageRef,
    annotationFrameRef,
    annotationLastPointRef,
    isAnnotationPointerActiveRef,
    textDragStartRef,
    textResizeRef,
    annotationOrderRef,
    cropDragStartRef,
    panStartRef,
    resultCanvasRef,
    zoomSurfaceRef,
    previewZoomPercent,
    isEditingPreview,
    isCroppingPreview,
    isPreviewCanvasInteractive,
    hasEditorOverlay,
    hasExportableEditorOverlay,
    hasEditedPreviewChanges
  };
}
