import { useEffect, useRef, useState } from "react";
import type React from "react";
import { AlertTriangle, ClipboardPaste, GripHorizontal, Plus, X } from "lucide-react";
import type { InputAsset } from "../shared/types";
import type { Language, UiCopy } from "./i18n";
import { extractDataUrlsFromText, referenceDataUrlToAsset } from "./referenceImageData";

export interface ReferenceImagePanelProps {
  copy: UiCopy;
  language: Language;
  assets: InputAsset[];
  limit: number;
  maskPreviewDataUrl?: string | null;
  showRightsReminder: boolean;
  showMaskRouteNotice: boolean;
  dragDropDisabled?: boolean;
  onAddAssets(assets: InputAsset[]): void;
  onRemoveAsset(id: string): void;
  onPromoteToFirst(id: string): void;
  onReorder(fromIndex: number, toIndex: number): void;
  onOpenPreview(id: string): void;
  onAddLocalFiles(): void;
  onNotice(kind: "success" | "error" | "info", text: string): void;
  onDirty(): void;
  onExternalDrop?(kind: "gallery" | "history", value: string): void;
}

const REFERENCE_PANEL_HEIGHT_KEY = "image2tools.referencePanelHeight";
const MIN_REFERENCE_PANEL_HEIGHT = 96;
const MAX_REFERENCE_PANEL_HEIGHT = 480;
const DEFAULT_REFERENCE_PANEL_HEIGHT = 160;
const IMAGE_FILE_TYPE_PATTERN = /^image\/(png|jpe?g|webp)$/i;
const GALLERY_MIME = "application/x-image2tools-gallery-id";
const HISTORY_MIME = "application/x-image2tools-asset";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readStoredPanelHeight(): number {
  if (typeof window === "undefined") return DEFAULT_REFERENCE_PANEL_HEIGHT;
  const raw = window.localStorage.getItem(REFERENCE_PANEL_HEIGHT_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_REFERENCE_PANEL_HEIGHT;
  return clamp(parsed, MIN_REFERENCE_PANEL_HEIGHT, MAX_REFERENCE_PANEL_HEIGHT);
}

function assetSource(asset: InputAsset): string | undefined {
  if (asset.dataUrl) return asset.dataUrl;
  if (asset.previewUrl) return asset.previewUrl;
  if (asset.path) return `file://${encodeURI(asset.path)}`;
  return undefined;
}

function readImageFilesAsAssets(files: File[]): Promise<InputAsset[]> {
  return Promise.all(
    files.map((file, index) =>
      new Promise<InputAsset>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string" || !reader.result) {
            reject(new Error("Failed to read image as data URL."));
            return;
          }
          resolve(referenceDataUrlToAsset(reader.result, index));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
        reader.readAsDataURL(file);
      })
    )
  );
}

export function ReferenceImagePanel({
  copy,
  language,
  assets,
  limit,
  maskPreviewDataUrl,
  showRightsReminder,
  showMaskRouteNotice,
  dragDropDisabled = false,
  onAddAssets,
  onRemoveAsset,
  onPromoteToFirst,
  onReorder,
  onOpenPreview,
  onAddLocalFiles,
  onNotice,
  onDirty,
  onExternalDrop
}: ReferenceImagePanelProps) {
  const [panelHeight, setPanelHeight] = useState<number>(() => readStoredPanelHeight());
  const panelHeightRef = useRef(panelHeight);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const promoteTimerRef = useRef<number | null>(null);
  const dragFromIndexRef = useRef<number | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);

  useEffect(() => {
    if (selectedId && !assets.some((asset) => asset.id === selectedId)) {
      setSelectedId(null);
    }
  }, [assets, selectedId]);

  useEffect(() => {
    return () => {
      if (promoteTimerRef.current !== null) window.clearTimeout(promoteTimerRef.current);
    };
  }, []);

  function moveAssetToPosition(assetId: string, currentIndex: number, position: number) {
    const targetIndex = clamp(position - 1, 0, Math.max(0, assets.length - 1));
    if (targetIndex === currentIndex) return;
    onReorder(currentIndex, targetIndex);
    onDirty();
  }

  function handleTileClick(assetId: string, index: number) {
    setSelectedId(assetId);
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    promoteTimerRef.current = window.setTimeout(() => {
      promoteTimerRef.current = null;
      if (index !== 0) onPromoteToFirst(assetId);
    }, 180);
  }

  function handleTileDoubleClick(assetId: string) {
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    setSelectedId(assetId);
    onOpenPreview(assetId);
  }

  function handleTileKeyDown(event: React.KeyboardEvent<HTMLDivElement>, assetId: string, index: number) {
    if (event.key === "Enter") {
      event.preventDefault();
      setSelectedId(assetId);
      onOpenPreview(assetId);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setSelectedId(assetId);
      if (index !== 0) onPromoteToFirst(assetId);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      setSelectedId(assetId);
      moveAssetToPosition(assetId, index, Number(event.key));
    }
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!/^[1-9]$/.test(event.key)) return;
    if (!selectedId) return;
    const index = assets.findIndex((asset) => asset.id === selectedId);
    if (index < 0) return;
    event.preventDefault();
    moveAssetToPosition(selectedId, index, Number(event.key));
  }

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panelHeightRef.current
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const next = clamp(
      state.startHeight + (event.clientY - state.startY),
      MIN_REFERENCE_PANEL_HEIGHT,
      MAX_REFERENCE_PANEL_HEIGHT
    );
    panelHeightRef.current = next;
    setPanelHeight(next);
  }

  function handleResizePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    try {
      window.localStorage.setItem(REFERENCE_PANEL_HEIGHT_KEY, String(panelHeightRef.current));
    } catch {
      // localStorage can throw in privacy-restricted contexts; keep the in-memory height.
    }
  }

  function handleTileDragStart(event: React.DragEvent<HTMLDivElement>, index: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    dragFromIndexRef.current = index;
    setDragFromIndex(index);
    setDropTargetIndex(null);
  }

  function handleTileDragEnd() {
    dragFromIndexRef.current = null;
    setDragFromIndex(null);
    setDropTargetIndex(null);
  }

  function computeDropIndex(event: React.DragEvent<HTMLDivElement>): number {
    const grid = gridRef.current;
    if (!grid) return assets.length;
    const tiles = Array.from(grid.querySelectorAll<HTMLElement>("[data-refpanel-index]"));
    if (tiles.length === 0) return 0;
    let closest: HTMLElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = dx * dx + dy * dy;
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = tile;
      }
    }
    if (!closest) return assets.length;
    const rect = closest.getBoundingClientRect();
    const index = Number(closest.dataset.refpanelIndex ?? "0");
    return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  }

  function handleGridDragOver(event: React.DragEvent<HTMLDivElement>) {
    const fromIndex = dragFromIndexRef.current;
    if (fromIndex !== null) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const next = computeDropIndex(event);
      setDropTargetIndex(next === fromIndex || next === fromIndex + 1 ? null : next);
      return;
    }
    if (dragDropDisabled) {
      event.preventDefault();
      return;
    }
    const types = Array.from(event.dataTransfer.types ?? []);
    const hasFiles = types.includes("Files");
    const hasCustom = types.includes(GALLERY_MIME) || types.includes(HISTORY_MIME);
    if (hasFiles || hasCustom) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isExternalDragOver) setIsExternalDragOver(true);
    }
  }

  function handleGridDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsExternalDragOver(false);
    setDropTargetIndex(null);
  }

  async function addFiles(files: File[]): Promise<number> {
    if (files.length === 0 || dragDropDisabled) return 0;
    const remaining = limit > 0 ? Math.max(0, limit - assets.length) : Number.POSITIVE_INFINITY;
    if (remaining === 0) {
      onNotice("info", copy.referenceLimitReached(limit));
      return 0;
    }
    try {
      const all = await readImageFilesAsAssets(files);
      const capped = all.slice(0, remaining);
      if (capped.length > 0) onAddAssets(capped);
      if (all.length > capped.length) onNotice("info", copy.referenceLimitReached(limit));
      return capped.length;
    } catch {
      onNotice("error", copy.validation.cannotReadImage);
      return 0;
    }
  }


  function addDataUrlTexts(text: string): number {
    if (!text || dragDropDisabled) return -1;
    const dataUrls = extractDataUrlsFromText(text);
    if (dataUrls.length === 0) return -1;
    const remaining = limit > 0 ? Math.max(0, limit - assets.length) : Number.POSITIVE_INFINITY;
    if (remaining === 0) {
      onNotice("info", copy.referenceLimitReached(limit));
      return 0;
    }
    const startIndex = assets.length;
    const toAdd = dataUrls.slice(0, remaining).map((dataUrl, index) => referenceDataUrlToAsset(dataUrl, startIndex + index));
    if (toAdd.length > 0) {
      onAddAssets(toAdd);
      onDirty();
    }
    if (dataUrls.length > toAdd.length) onNotice("info", copy.referenceLimitReached(limit));
    return toAdd.length;
  }


  function handleGridDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsExternalDragOver(false);
    const fromIndex = dragFromIndexRef.current;
    if (fromIndex !== null) {
      const toIndex = computeDropIndex(event);
      dragFromIndexRef.current = null;
      setDragFromIndex(null);
      setDropTargetIndex(null);
      if (toIndex !== fromIndex && toIndex !== fromIndex + 1) {
        onReorder(fromIndex, toIndex);
        onDirty();
      }
      return;
    }
    setDropTargetIndex(null);
    if (dragDropDisabled) return;
    const galleryId = event.dataTransfer.getData(GALLERY_MIME);
    if (galleryId) {
      onExternalDrop?.("gallery", galleryId);
      return;
    }
    const assetData = event.dataTransfer.getData(HISTORY_MIME);
    if (assetData) {
      onExternalDrop?.("history", assetData);
      return;
    }
    const imageFiles = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      IMAGE_FILE_TYPE_PATTERN.test(file.type)
    );
    if (imageFiles.length > 0) {
      void addFiles(imageFiles);
      return;
    }
    onNotice("error", copy.externalDropUnsupported);
  }

  function handleGridPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && IMAGE_FILE_TYPE_PATTERN.test(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (imageFiles.length > 0) {
      event.preventDefault();
      void addFiles(imageFiles).then((added) => {
        if (added > 0) onNotice("success", copy.pastedImageName(added));
      });
      return;
    }
    const text = event.clipboardData?.getData("text") ?? "";
    const added = addDataUrlTexts(text);
    if (added > 0) {
      event.preventDefault();
      onNotice("success", copy.pastedImageName(added));
    }
  }

  const gridClass = ["reference-grid", "refpanel-grid", isExternalDragOver ? "drag-over" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="refpanel"
      lang={language}
      style={{ "--refpanel-height": `${panelHeight}px` } as React.CSSProperties}
    >
      <div
        className="refpanel-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={copy.referenceResizeHint}
        title={copy.referenceResizeHint}
        data-tooltip={copy.referenceResizeHint}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
      >
        <GripHorizontal size={14} />
      </div>
      <div
        ref={gridRef}
        className={gridClass}
        tabIndex={-1}
        onDragOver={handleGridDragOver}
        onDragLeave={handleGridDragLeave}
        onDrop={handleGridDrop}
        onPaste={handleGridPaste}
        onKeyDown={handleGridKeyDown}
      >
        {assets.length === 0 ? (
          <div
            className="empty-inline"
            role="button"
            tabIndex={0}
            onClick={() => gridRef.current?.focus()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                gridRef.current?.focus();
              }
            }}
          >
            {copy.pasteImagesHint}
          </div>
        ) : (
          assets.map((asset, index) => {
            const source = assetSource(asset);
            const isDragging = dragFromIndex === index;
            const isDropTarget =
              dropTargetIndex === index && dropTargetIndex !== dragFromIndex;
            const tileClass = [
              "asset-tile",
              "reference-thumb-tile",
              index === 0 ? "primary-reference" : "",
              index === 0 && maskPreviewDataUrl ? "has-mask" : "",
              isDragging ? "refpanel-tile-dragging" : "",
              isDropTarget ? "refpanel-tile-drop-target" : "",
              selectedId === asset.id ? "refpanel-tile-selected" : ""
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={asset.id}
                className={tileClass}
                role="button"
                tabIndex={0}
                title={copy.referenceTileHint}
                data-tooltip={copy.referenceTileHint}
                data-refpanel-index={index}
                draggable
                onDragStart={(event) => handleTileDragStart(event, index)}
                onDragEnd={handleTileDragEnd}
                onClick={() => handleTileClick(asset.id, index)}
                onDoubleClick={() => handleTileDoubleClick(asset.id)}
                onFocus={() => setSelectedId(asset.id)}
                onKeyDown={(event) => handleTileKeyDown(event, asset.id, index)}
              >
                {source && <img src={source} alt={asset.name} />}
                <button
                  type="button"
                  className="tile-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveAsset(asset.id);
                  }}
                  aria-label={copy.delete}
                  data-tooltip={copy.delete}
                >
                  <X size={14} />
                </button>
                <div className="reference-thumb-meta">
                  <strong>{index === 0 ? copy.source : `${copy.reference} ${index + 1}`}</strong>
                  <span>{asset.name}</span>
                </div>
                {index === 0 && maskPreviewDataUrl && (
                  <span className="reference-mask-badge">{copy.mask}</span>
                )}
              </div>
            );
          })
        )}
        <button
          type="button"
          className="icon-button refpanel-paste-button"
          onClick={() => gridRef.current?.focus()}
          aria-label={copy.pasteImages}
          data-tooltip={copy.pasteImages}
        >
          <ClipboardPaste size={16} />
        </button>
        <button
          type="button"
          className="icon-button reference-add-button"
          onClick={onAddLocalFiles}
          aria-label={copy.addLocalReferences}
          data-tooltip={copy.addLocalReferences}
        >
          <Plus size={18} />
        </button>
      </div>

      {showRightsReminder && (
        <p className="inline-check reference-rights-reminder">
          <AlertTriangle size={14} />
          <span>{copy.uploadRightsReminder}</span>
        </p>
      )}
      {showMaskRouteNotice && (
        <p className="inline-check warning mask-route-notice">
          <AlertTriangle size={14} />
          <span>{copy.exactMaskRouteNotice}</span>
        </p>
      )}
      <p className="refpanel-hints">
        <span>{copy.dragToReorderHint}</span>
        <span>{copy.numberKeyReorderHint}</span>
      </p>
    </div>
  );
}
