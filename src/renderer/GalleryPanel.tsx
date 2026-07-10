import { useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, ChevronDown, ChevronRight, FileUp, Folder, FolderOpen, FolderPlus, Save, X } from "lucide-react";
import type { GalleryAsset, GalleryFolder } from "../shared/types";
import type { UiCopy } from "./i18n";

export type GallerySortMode = "newest" | "oldest" | "name" | "size" | "modified";
export type GalleryViewMode = "grid" | "list";
export type GalleryFolderFilter = "__all__" | "__uncategorized__" | string;
export type GalleryExplorerEntry =
  | { kind: "folder"; id: string; folder: GalleryFolder }
  | { kind: "asset"; id: string; asset: GalleryAsset };

interface GalleryFolderSelectOption {
  id: GalleryFolderFilter;
  name: string;
}

interface GallerySortOption {
  value: GallerySortMode;
  label: string;
}

interface GalleryCompactControlsProps {
  copy: UiCopy;
  activeFolderId: GalleryFolderFilter;
  folderOptions: GalleryFolderSelectOption[];
  tagFilter: string;
  tagOptions: string[];
  onFolderChange: (folderId: GalleryFolderFilter) => void;
  onTagFilterChange: (tag: string) => void;
}

interface GallerySortToolbarProps {
  copy: UiCopy;
  sort: GallerySortMode;
  sortLabel: string;
  sortOptions: GallerySortOption[];
  isSortMenuOpen: boolean;
  onToggleSortMenu: () => void;
  onSortChange: (sort: GallerySortMode) => void;
  onCreateFolder: () => void;
  onImport: () => void;
}

type GalleryEntryDropHandlers = Pick<React.HTMLAttributes<HTMLElement>, "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop">;

interface GalleryFolderCardProps {
  copy: UiCopy;
  folder: GalleryFolder;
  selected: boolean;
  dropTarget: boolean;
  batchMode: boolean;
  displayPath: string;
  meta: string;
  previewAssets: GalleryAsset[];
  assetThumbnailPath: (asset: GalleryAsset) => string;
  editingName: boolean;
  nameDraft: string;
  dropHandlers: GalleryEntryDropHandlers;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onToggleSelection: (event: React.MouseEvent<HTMLInputElement>) => void;
  onStartEditName: () => void;
  onNameDraftChange: (value: string) => void;
  onSaveName: () => void;
  onCancelName: () => void;
}

interface GalleryAssetCardProps {
  copy: UiCopy;
  asset: GalleryAsset;
  selected: boolean;
  batchMode: boolean;
  thumbnailSrc: string;
  meta: string;
  editingName: boolean;
  nameDraft: string;
  editingTags: boolean;
  tagsInput: string;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onToggleSelection: (event: React.MouseEvent<HTMLInputElement>) => void;
  onStartEditName: () => void;
  onNameDraftChange: (value: string) => void;
  onSaveName: () => void;
  onCancelName: () => void;
  onEditTags: () => void;
  onTagsInputChange: (value: string) => void;
  onSaveTags: () => void;
  onCancelTags: () => void;
  onMoveTagPopoverPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
  onDelete: () => void;
}

interface GalleryDirectoryTreeProps {
  copy: UiCopy;
  activeFolderId: GalleryFolderFilter;
  allFolderId: GalleryFolderFilter;
  uncategorizedFolderId: GalleryFolderFilter;
  batchMode: boolean;
  allAssetCount: number;
  uncategorizedAssetCount: number;
  allDropTarget: boolean;
  uncategorizedDropTarget: boolean;
  allDropHandlers: GalleryEntryDropHandlers;
  uncategorizedDropHandlers: GalleryEntryDropHandlers;
  children: React.ReactNode;
  onNavigate: (folderId: GalleryFolderFilter) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, folderId: GalleryFolderFilter) => void;
}

interface GalleryTreeRowsProps {
  copy: UiCopy;
  parentId: string | null;
  depth?: number;
  foldersByParent: ReadonlyMap<string | null, GalleryFolder[]>;
  activeFolderId: GalleryFolderFilter;
  batchMode: boolean;
  expandedFolderIds: ReadonlySet<string>;
  selectedFolderIds: ReadonlySet<string>;
  dragTargetId: GalleryFolderFilter | null;
  subtreeAssetCounts: ReadonlyMap<string, number>;
  dropHandlersForFolder: (folderId: GalleryFolderFilter) => GalleryEntryDropHandlers;
  folderDisplayPath: (folder: GalleryFolder) => string;
  onPrepareEntryDrag: (event: React.DragEvent<HTMLElement>, entry: GalleryExplorerEntry) => void;
  onFolderContextMenu: (event: React.MouseEvent<HTMLElement>, folderId: GalleryFolderFilter) => void;
  onToggleExpanded: (folderId: string) => void;
  onToggleSelectedFolder: (folderId: string, checked: boolean) => void;
  onNavigateFolder: (folderId: GalleryFolderFilter) => void;
}

interface GalleryContentGridProps {
  copy: UiCopy;
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeFolderId: GalleryFolderFilter;
  viewMode: GalleryViewMode;
  batchMode: boolean;
  dropTarget: boolean;
  folderDropTargetId: GalleryFolderFilter | null;
  entries: GalleryExplorerEntry[];
  virtualEntries: GalleryExplorerEntry[];
  virtualStartIndex: number;
  virtualTopSpacer: number;
  virtualBottomSpacer: number;
  isGalleryEmpty: boolean;
  editingGalleryFolderId: string | null;
  galleryFolderNameDraft: string;
  editingGalleryNameId: string | null;
  galleryNameDraft: string;
  editingGalleryId: string | null;
  tagsInput: string;
  folderSubtreeAssetCounts: ReadonlyMap<string, number>;
  dropHandlersForFolder: (folderId: GalleryFolderFilter) => GalleryEntryDropHandlers;
  formatBytes: (bytes: number) => string;
  formatDate: (value: string) => string;
  folderDisplayPath: (folder: GalleryFolder) => string;
  folderPreviewAssets: ReadonlyMap<string, GalleryAsset[]>;
  assetThumbnailPath: (asset: GalleryAsset) => string;
  isEntrySelected: (entry: GalleryExplorerEntry) => boolean;
  onScrollTopChange: (scrollTop: number) => void;
  onFolderContextMenu: (event: React.MouseEvent<HTMLElement>, folderId: GalleryFolderFilter) => void;
  onPrepareEntryDrag: (event: React.DragEvent<HTMLElement>, entry: GalleryExplorerEntry) => void;
  onToggleSelection: (entry: GalleryExplorerEntry, index: number, event: React.MouseEvent<HTMLInputElement>) => void;
  onOpenFolder: (folderId: GalleryFolderFilter) => void;
  onStartEditFolderName: (folder: GalleryFolder) => void;
  onFolderNameDraftChange: (value: string) => void;
  onSaveFolderName: (folder: GalleryFolder) => void;
  onCancelFolderName: () => void;
  onPreviewAsset: (asset: GalleryAsset) => void;
  onAssetContextMenu: (event: React.MouseEvent<HTMLElement>, asset: GalleryAsset) => void;
  onStartEditAssetName: (asset: GalleryAsset) => void;
  onAssetNameDraftChange: (value: string) => void;
  onSaveAssetName: (asset: GalleryAsset) => void;
  onCancelAssetName: () => void;
  onEditAssetTags: (asset: GalleryAsset) => void;
  onTagsInputChange: (value: string) => void;
  onSaveAssetTags: (asset: GalleryAsset) => void;
  onCancelAssetTags: () => void;
  onMoveTagPopoverPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
  onDeleteAsset: (asset: GalleryAsset) => void;
}

const POPOVER_MARGIN = 12;

function clampPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function GalleryTagPopover({
  anchorRef,
  copy,
  tagsInput,
  onTagsInputChange,
  onSaveTags,
  onCancelTags,
  onMoveTagPopoverPointerDown,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  copy: UiCopy;
  tagsInput: string;
  onTagsInputChange: (value: string) => void;
  onSaveTags: () => void;
  onCancelTags: () => void;
  onMoveTagPopoverPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const appRect = document.querySelector(".app-shell")?.getBoundingClientRect();
      const bounds = appRect && appRect.width > 0 && appRect.height > 0
        ? appRect
        : ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight } as DOMRect);
      const width = Math.min(popoverRect.width || 222, Math.max(180, bounds.width - POPOVER_MARGIN * 2));
      const height = popoverRect.height || 42;
      const minLeft = bounds.left + POPOVER_MARGIN;
      const maxLeft = bounds.right - width - POPOVER_MARGIN;
      const minTop = bounds.top + POPOVER_MARGIN;
      const maxTop = bounds.bottom - height - POPOVER_MARGIN;
      const preferredTop = anchorRect.bottom + 6 + height <= bounds.bottom - POPOVER_MARGIN
        ? anchorRect.bottom + 6
        : anchorRect.top - height - 6;

      setStyle({
        position: "fixed",
        left: `${clampPosition(anchorRect.left + anchorRect.width / 2 - width / 2, minLeft, Math.max(minLeft, maxLeft))}px`,
        top: `${clampPosition(preferredTop, minTop, Math.max(minTop, maxTop))}px`,
        width: `${width}px`,
        visibility: "visible"
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className="history-tag-popover gallery-tag-popover"
      data-drift="subtle"
      style={style}
      onPointerDown={onMoveTagPopoverPointerDown}
      onMouseMove={onMoveToolbarTowardPointer}
      onMouseLeave={onResetToolbarDrift}
    >
      <input
        value={tagsInput}
        onChange={(event) => onTagsInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSaveTags();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancelTags();
          }
        }}
        placeholder={copy.templateTags}
        aria-label={copy.addTag}
        autoFocus
      />
      <button type="button" className="icon-button" disabled={!tagsInput.trim()} onClick={onSaveTags} aria-label={copy.gallerySaveTags} data-tooltip={copy.gallerySaveTags}>
        <Save size={14} />
      </button>
    </div>,
    document.body
  );
}

export function GalleryCompactControls({
  copy,
  activeFolderId,
  folderOptions,
  tagFilter,
  tagOptions,
  onFolderChange,
  onTagFilterChange
}: GalleryCompactControlsProps) {
  return (
    <div className="gallery-compact-controls">
      <select value={activeFolderId} onChange={(event) => onFolderChange(event.target.value as GalleryFolderFilter)} aria-label={copy.galleryFolders}>
        {folderOptions.map((folder) => (
          <option key={folder.id} value={folder.id}>{folder.id === "__all__" ? copy.galleryFolderCompactLabel : folder.name}</option>
        ))}
      </select>
      <select value={tagFilter} onChange={(event) => onTagFilterChange(event.target.value)} aria-label={copy.galleryTagFilter}>
        <option value="">{copy.galleryTagCompactLabel}</option>
        {tagOptions.map((tag) => (
          <option key={tag} value={tag}>{tag}</option>
        ))}
      </select>
    </div>
  );
}

export function GallerySortToolbar({
  copy,
  sort,
  sortLabel,
  sortOptions,
  isSortMenuOpen,
  onToggleSortMenu,
  onSortChange,
  onCreateFolder,
  onImport
}: GallerySortToolbarProps) {
  return (
    <div className="rail-sort-row gallery-explorer-toolbar">
      <div className={`gallery-sort-control ${isSortMenuOpen ? "open" : ""}`}>
        <button
          type="button"
          className="gallery-sort-trigger"
          onClick={onToggleSortMenu}
          aria-label={sortLabel}
          aria-expanded={isSortMenuOpen}
          data-tooltip={sortLabel}
        >
          <ArrowDownUp size={14} />
          <span>{sortLabel}</span>
          <ChevronDown size={13} />
        </button>
        {isSortMenuOpen && (
          <div className="gallery-sort-menu" role="menu">
            {sortOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={sort === option.value ? "active" : undefined}
                onClick={() => onSortChange(option.value)}
                role="menuitem"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="gallery-toolbar-actions">
        <button type="button" className="icon-button rail-new-folder-button" onClick={onCreateFolder} aria-label={copy.galleryFolderCreate} data-tooltip={copy.galleryFolderCreate}>
          <FolderPlus size={15} />
        </button>
        <button type="button" className="icon-button rail-import-button" onClick={onImport} aria-label={copy.galleryImport} data-tooltip={copy.galleryImport}>
          <FileUp size={15} />
        </button>
      </div>
    </div>
  );
}

export function GalleryDirectoryTree({
  copy,
  activeFolderId,
  allFolderId,
  uncategorizedFolderId,
  batchMode,
  allAssetCount,
  uncategorizedAssetCount,
  allDropTarget,
  uncategorizedDropTarget,
  allDropHandlers,
  uncategorizedDropHandlers,
  children,
  onNavigate,
  onContextMenu
}: GalleryDirectoryTreeProps) {
  return (
    <aside className={`gallery-directory-tree ${batchMode ? "batch-select" : ""}`} aria-label={copy.galleryFolders}>
      <button
        type="button"
        className={`gallery-tree-root ${activeFolderId === allFolderId ? "active" : ""} ${allDropTarget ? "drop-target" : ""}`}
        onClick={() => onNavigate(allFolderId)}
        onContextMenu={(event) => onContextMenu(event, allFolderId)}
        {...allDropHandlers}
      >
        <FolderOpen size={14} />
        <span>{copy.galleryAllFolders}</span>
        <small>{allAssetCount}</small>
      </button>
      <button
        type="button"
        className={`gallery-tree-root ${activeFolderId === uncategorizedFolderId ? "active" : ""} ${uncategorizedDropTarget ? "drop-target" : ""}`}
        onClick={() => onNavigate(uncategorizedFolderId)}
        onContextMenu={(event) => onContextMenu(event, uncategorizedFolderId)}
        {...uncategorizedDropHandlers}
      >
        <Folder size={14} />
        <span>{copy.galleryUncategorized}</span>
        <small>{uncategorizedAssetCount}</small>
      </button>
      <div className="gallery-tree-children">
        {children}
      </div>
    </aside>
  );
}

export function GalleryTreeRows({
  copy,
  parentId,
  depth = 0,
  foldersByParent,
  activeFolderId,
  batchMode,
  expandedFolderIds,
  selectedFolderIds,
  dragTargetId,
  subtreeAssetCounts,
  dropHandlersForFolder,
  folderDisplayPath,
  onPrepareEntryDrag,
  onFolderContextMenu,
  onToggleExpanded,
  onToggleSelectedFolder,
  onNavigateFolder
}: GalleryTreeRowsProps): React.ReactNode[] {
  const folders = foldersByParent.get(parentId) ?? [];
  return folders.flatMap((folder) => {
    const hasChildren = (foldersByParent.get(folder.id) ?? []).length > 0;
    const isExpanded = expandedFolderIds.has(folder.id);
    const entry: GalleryExplorerEntry = { kind: "folder", id: folder.id, folder };
    const row = (
      <div
        key={folder.id}
        className={`gallery-tree-row ${activeFolderId === folder.id ? "active" : ""} ${dragTargetId === folder.id ? "drop-target" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
        draggable
        onDragStart={(event) => onPrepareEntryDrag(event, entry)}
        onContextMenu={(event) => onFolderContextMenu(event, folder.id)}
        {...dropHandlersForFolder(folder.id)}
      >
        <button
          type="button"
          className="gallery-tree-expander"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleExpanded(folder.id);
          }}
          disabled={!hasChildren}
          aria-label={isExpanded ? copy.hide : copy.show}
          data-tooltip={isExpanded ? copy.hide : copy.show}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}
        </button>
        {batchMode && (
          <input
            type="checkbox"
            checked={selectedFolderIds.has(folder.id)}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelectedFolder(folder.id, event.currentTarget.checked);
            }}
            onChange={() => undefined}
            aria-label={copy.gallerySelectItem(folder.name)}
          />
        )}
        <button
          type="button"
          className="gallery-tree-folder-button"
          onClick={() => onNavigateFolder(folder.id)}
          onDoubleClick={() => onNavigateFolder(folder.id)}
          title={folderDisplayPath(folder)}
        >
          <Folder size={14} />
          <span>{folder.name}</span>
          <small>{subtreeAssetCounts.get(folder.id) ?? 0}</small>
        </button>
      </div>
    );
    return isExpanded
      ? [
          row,
          ...GalleryTreeRows({
            copy,
            parentId: folder.id,
            depth: depth + 1,
            foldersByParent,
            activeFolderId,
            batchMode,
            expandedFolderIds,
            selectedFolderIds,
            dragTargetId,
            subtreeAssetCounts,
            dropHandlersForFolder,
            folderDisplayPath,
            onPrepareEntryDrag,
            onFolderContextMenu,
            onToggleExpanded,
            onToggleSelectedFolder,
            onNavigateFolder
          })
        ]
      : [row];
  });
}

export function GalleryFolderCard({
  copy,
  folder,
  selected,
  dropTarget,
  batchMode,
  displayPath,
  meta,
  previewAssets,
  assetThumbnailPath,
  editingName,
  nameDraft,
  dropHandlers,
  onDragStart,
  onOpen,
  onContextMenu,
  onToggleSelection,
  onStartEditName,
  onNameDraftChange,
  onSaveName,
  onCancelName
}: GalleryFolderCardProps) {
  const visiblePreviewAssets = previewAssets.slice(0, 4);
  return (
    <article
      className={`gallery-item gallery-folder-entry ${selected ? "selected" : ""} ${dropTarget ? "drop-target" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      {...dropHandlers}
    >
      {batchMode && (
        <input
          className="gallery-entry-select"
          type="checkbox"
          checked={selected}
          onClick={onToggleSelection}
          onChange={() => undefined}
          aria-label={copy.gallerySelectItem(folder.name)}
        />
      )}
      <button type="button" className="gallery-folder-thumb folder-thumb" onClick={onOpen} aria-label={copy.galleryOpenItem(folder.name)} data-tooltip={copy.galleryOpenItem(folder.name)}>
        {visiblePreviewAssets.length > 0 ? (
          <span className="folder-thumb-collage" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => {
              const asset = visiblePreviewAssets[index];
              return (
                <span key={asset?.id ?? `empty-${index}`} className="folder-thumb-collage-cell">
                  {asset ? <img src={assetThumbnailPath(asset)} alt="" draggable={false} loading="lazy" decoding="async" /> : <Folder size={14} />}
                </span>
              );
            })}
          </span>
        ) : (
          <FolderOpen size={24} />
        )}
      </button>
      <div className="gallery-meta">
        <div className="gallery-name-wrap">
          {editingName ? (
            <input
              className="gallery-name-input"
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onBlur={onSaveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveName();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelName();
                }
              }}
              aria-label={copy.galleryFolderRename}
              autoFocus
            />
          ) : (
            <button type="button" className="gallery-name-button" onClick={onStartEditName} aria-label={copy.galleryFolderRename} data-tooltip={copy.galleryFolderRename} title={displayPath}>
              {folder.name}
            </button>
          )}
        </div>
        <small>{meta}</small>
      </div>
    </article>
  );
}

export function GalleryAssetCard({
  copy,
  asset,
  selected,
  batchMode,
  thumbnailSrc,
  meta,
  editingName,
  nameDraft,
  editingTags,
  tagsInput,
  onDragStart,
  onOpen,
  onContextMenu,
  onToggleSelection,
  onStartEditName,
  onNameDraftChange,
  onSaveName,
  onCancelName,
  onEditTags,
  onTagsInputChange,
  onSaveTags,
  onCancelTags,
  onMoveTagPopoverPointerDown,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift,
  onDelete
}: GalleryAssetCardProps) {
  const tagAnchorRef = useRef<HTMLSpanElement | null>(null);

  return (
    <article
      className={`gallery-item ${selected ? "selected" : ""}`}
      onContextMenu={onContextMenu}
    >
      {batchMode && (
        <input
          className="gallery-entry-select"
          type="checkbox"
          checked={selected}
          onClick={onToggleSelection}
          onChange={() => undefined}
          aria-label={copy.gallerySelectItem(asset.originalName)}
        />
      )}
      <button
        type="button"
        className="gallery-thumb"
        draggable
        onDragStart={onDragStart}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        title={copy.galleryOpenItem(asset.originalName)}
      >
        <img src={thumbnailSrc} alt={asset.originalName} draggable={false} loading="lazy" decoding="async" />
      </button>
      <div className="gallery-meta">
        <div className="gallery-name-wrap">
          {editingName ? (
            <input
              className="gallery-name-input"
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onBlur={onSaveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveName();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelName();
                }
              }}
              aria-label={copy.galleryAssetRename}
              autoFocus
            />
          ) : (
            <button type="button" className="gallery-name-button" onClick={onStartEditName} aria-label={copy.galleryAssetRename} data-tooltip={copy.galleryAssetRename} title={asset.originalName}>
              {asset.originalName}
            </button>
          )}
        </div>
        <div className="template-tags gallery-tag-row">
          {asset.tags.map((tag) => <span key={tag}>{tag}</span>)}
          <span ref={tagAnchorRef} className="history-add-tag-anchor gallery-add-tag-anchor">
            <button
              type="button"
              className="history-chip history-add-tag-button gallery-add-tag-button"
              onClick={onEditTags}
              aria-label={copy.addTag}
              data-tooltip={copy.addTag}
            >
              {copy.addTag}
            </button>
            {editingTags && (
              <GalleryTagPopover
                anchorRef={tagAnchorRef}
                copy={copy}
                tagsInput={tagsInput}
                onTagsInputChange={onTagsInputChange}
                onSaveTags={onSaveTags}
                onCancelTags={onCancelTags}
                onMoveTagPopoverPointerDown={onMoveTagPopoverPointerDown}
                onMoveToolbarTowardPointer={onMoveToolbarTowardPointer}
                onResetToolbarDrift={onResetToolbarDrift}
              />
            )}
          </span>
        </div>
        <small>{meta}</small>
      </div>
      <div className="gallery-actions">
        <button type="button" className="icon-button ghost danger" onClick={onDelete} aria-label={copy.delete} data-tooltip={copy.delete}>
          <X size={15} />
        </button>
      </div>
    </article>
  );
}

export function GalleryContentGrid({
  copy,
  contentRef,
  activeFolderId,
  viewMode,
  batchMode,
  dropTarget,
  folderDropTargetId,
  entries,
  virtualEntries,
  virtualStartIndex,
  virtualTopSpacer,
  virtualBottomSpacer,
  isGalleryEmpty,
  editingGalleryFolderId,
  galleryFolderNameDraft,
  editingGalleryNameId,
  galleryNameDraft,
  editingGalleryId,
  tagsInput,
  folderSubtreeAssetCounts,
  dropHandlersForFolder,
  formatBytes,
  formatDate,
  folderDisplayPath,
  folderPreviewAssets,
  assetThumbnailPath,
  isEntrySelected,
  onScrollTopChange,
  onFolderContextMenu,
  onPrepareEntryDrag,
  onToggleSelection,
  onOpenFolder,
  onStartEditFolderName,
  onFolderNameDraftChange,
  onSaveFolderName,
  onCancelFolderName,
  onPreviewAsset,
  onAssetContextMenu,
  onStartEditAssetName,
  onAssetNameDraftChange,
  onSaveAssetName,
  onCancelAssetName,
  onEditAssetTags,
  onTagsInputChange,
  onSaveAssetTags,
  onCancelAssetTags,
  onMoveTagPopoverPointerDown,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift,
  onDeleteAsset
}: GalleryContentGridProps) {
  return (
    <section className="gallery-directory-content" aria-label={copy.galleryFolderContents}>
      <div
        ref={contentRef}
        className={`gallery-grid gallery-content-grid ${viewMode} ${batchMode ? "batch-select" : ""} ${dropTarget ? "drop-target" : ""}`}
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
        onWheel={(event) => {
          const element = event.currentTarget;
          const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
          if (maxScrollTop <= 0) return;
          const delta = event.deltaY || event.deltaX;
          if (!delta) return;
          const nextScrollTop = Math.min(maxScrollTop, Math.max(0, element.scrollTop + delta));
          if (nextScrollTop === element.scrollTop) return;
          event.preventDefault();
          element.scrollTop = nextScrollTop;
          onScrollTopChange(nextScrollTop);
        }}
        data-total-count={entries.length}
        data-rendered-count={virtualEntries.length}
        onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (
            event.target === event.currentTarget ||
            target.closest(".gallery-empty-state")
          ) {
            onFolderContextMenu(event, activeFolderId);
          }
        }}
        {...dropHandlersForFolder(activeFolderId)}
      >
        {entries.length === 0 && (
          <div className="history-empty gallery-empty-state">
            <span>{isGalleryEmpty ? copy.galleryEmpty : copy.galleryNoMatch}</span>
          </div>
        )}
        {entries.length > 0 && (
          <>
            <div className="gallery-virtual-spacer" style={{ height: virtualTopSpacer }} aria-hidden="true" />
            <div className={`gallery-content-grid-inner ${viewMode}`}>
              {virtualEntries.map((entry, virtualIndex) => {
                const index = virtualStartIndex + virtualIndex;
                return entry.kind === "folder" ? (
                    <GalleryFolderCard
                      key={entry.id}
                      copy={copy}
                      folder={entry.folder}
                      selected={isEntrySelected(entry)}
                      dropTarget={folderDropTargetId === entry.id}
                      batchMode={batchMode}
                      displayPath={folderDisplayPath(entry.folder)}
                      meta={copy.galleryFolderItemMeta(folderSubtreeAssetCounts.get(entry.id) ?? 0, formatDate(entry.folder.updatedAt))}
                      previewAssets={folderPreviewAssets.get(entry.id) ?? []}
                      assetThumbnailPath={assetThumbnailPath}
                      editingName={editingGalleryFolderId === entry.folder.id}
                      nameDraft={editingGalleryFolderId === entry.folder.id ? galleryFolderNameDraft : entry.folder.name}
                      dropHandlers={dropHandlersForFolder(entry.id)}
                      onDragStart={(event) => onPrepareEntryDrag(event, entry)}
                      onOpen={() => onOpenFolder(entry.id)}
                      onContextMenu={(event) => onFolderContextMenu(event, entry.id)}
                      onToggleSelection={(event) => onToggleSelection(entry, index, event)}
                      onStartEditName={() => onStartEditFolderName(entry.folder)}
                      onNameDraftChange={onFolderNameDraftChange}
                      onSaveName={() => onSaveFolderName(entry.folder)}
                      onCancelName={onCancelFolderName}
                    />
                ) : (
                  <GalleryAssetCard
                    key={entry.id}
                    copy={copy}
                    asset={entry.asset}
                    selected={isEntrySelected(entry)}
                    batchMode={batchMode}
                    thumbnailSrc={assetThumbnailPath(entry.asset)}
                    meta={`${formatBytes(entry.asset.sizeBytes)} · ${formatDate(entry.asset.modifiedAt ?? entry.asset.updatedAt ?? entry.asset.createdAt)}`}
                    editingName={editingGalleryNameId === entry.asset.id}
                    nameDraft={editingGalleryNameId === entry.asset.id ? galleryNameDraft : entry.asset.originalName}
                    editingTags={editingGalleryId === entry.asset.id}
                    tagsInput={tagsInput}
                    onDragStart={(event) => onPrepareEntryDrag(event, entry)}
                    onOpen={() => onPreviewAsset(entry.asset)}
                    onContextMenu={(event) => onAssetContextMenu(event, entry.asset)}
                    onToggleSelection={(event) => onToggleSelection(entry, index, event)}
                    onStartEditName={() => onStartEditAssetName(entry.asset)}
                    onNameDraftChange={onAssetNameDraftChange}
                    onSaveName={() => onSaveAssetName(entry.asset)}
                    onCancelName={onCancelAssetName}
                    onEditTags={() => onEditAssetTags(entry.asset)}
                    onTagsInputChange={onTagsInputChange}
                    onSaveTags={() => onSaveAssetTags(entry.asset)}
                    onCancelTags={onCancelAssetTags}
                    onMoveTagPopoverPointerDown={onMoveTagPopoverPointerDown}
                    onMoveToolbarTowardPointer={onMoveToolbarTowardPointer}
                    onResetToolbarDrift={onResetToolbarDrift}
                    onDelete={() => onDeleteAsset(entry.asset)}
                  />
                );
              })}
            </div>
            <div className="gallery-virtual-spacer" style={{ height: virtualBottomSpacer }} aria-hidden="true" />
          </>
        )}
      </div>
    </section>
  );
}
