export type PreviewMode = "idle" | "edit" | "crop";
export type AnnotationTool = "draw" | "text";
export type CropShape = "rect" | "ellipse";

export interface CanvasPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface AnnotationTextBox {
  id: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
  bold: boolean;
}

export interface AnnotationDrawingLayer {
  id: string;
  order: number;
  dataUrl: string;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSelection extends CanvasRect {
  shape: CropShape;
}

export interface EditorSnapshot {
  drawingLayers: AnnotationDrawingLayer[];
  textBoxes: AnnotationTextBox[];
  editedImageDataUrl: string | null;
}

export const ANNOTATION_COLOR_SWATCHES = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#5856D6", "#111827", "#FFFFFF"];
export const MIN_TEXT_BOX_SIZE = 34;
