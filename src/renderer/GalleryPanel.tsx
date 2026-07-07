import type React from "react";
import { ArrowDownUp, ChevronDown, FileUp, FolderOpen, FolderPlus, Pencil, Save, Tags, Trash2 } from "lucide-react";
import type { GalleryAsset, GalleryFolder } from "../shared/types";
import type { UiCopy } from "./i18n";

export type GallerySortMode = "newest" | "oldest" | "name" | "size" | "modified";
export type GalleryViewMode = "grid" | "list";
export type GalleryFolderFilter = "__all__" | "__uncategorized__" | string;

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
  dropHandlers: GalleryEntryDropHandlers;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onToggleSelection: (event: React.MouseEvent<HTMLInputElement>) => void;
  onRename: () => void;
}

interface GalleryAssetCardProps {
  copy: UiCopy;
  asset: GalleryAsset;
  selected: boolean;
  batchMode: boolean;
  thumbnailSrc: string;
  meta: string;
  editingTags: boolean;
  tagsInput: string;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onToggleSelection: (event: React.MouseEvent<HTMLInputElement>) => void;
  onEditTags: () => void;
  onTagsInputChange: (value: string) => void;
  onSaveTags: () => void;
  onCancelTags: () => void;
  onMoveTagPopoverPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
  onRename: () => void;
  onDelete: () => void;
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

export function GalleryFolderCard({
  copy,
  folder,
  selected,
  dropTarget,
  batchMode,
  displayPath,
  meta,
  dropHandlers,
  onDragStart,
  onOpen,
  onContextMenu,
  onToggleSelection,
  onRename
}: GalleryFolderCardProps) {
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
        <FolderOpen size={24} />
      </button>
      <div className="gallery-meta">
        <strong title={displayPath}>{folder.name}</strong>
        <small>{meta}</small>
      </div>
      <div className="gallery-actions">
        <button type="button" className="icon-button" onClick={onOpen} aria-label={copy.openFolder} data-tooltip={copy.openFolder}>
          <FolderOpen size={15} />
        </button>
        <button type="button" className="icon-button" onClick={onRename} aria-label={copy.galleryFolderRename} data-tooltip={copy.galleryFolderRename}>
          <Pencil size={15} />
        </button>
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
  editingTags,
  tagsInput,
  onDragStart,
  onOpen,
  onContextMenu,
  onToggleSelection,
  onEditTags,
  onTagsInputChange,
  onSaveTags,
  onCancelTags,
  onMoveTagPopoverPointerDown,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift,
  onRename,
  onDelete
}: GalleryAssetCardProps) {
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
        <strong title={asset.originalName}>{asset.originalName}</strong>
        <div className="template-tags gallery-tag-row">
          {asset.tags.map((tag) => <span key={tag}>{tag}</span>)}
          <span className="history-add-tag-anchor gallery-add-tag-anchor">
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
              <div
                className="history-tag-popover gallery-tag-popover"
                data-drift="subtle"
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
              </div>
            )}
          </span>
        </div>
        <small>{meta}</small>
      </div>
      <div className="gallery-actions">
        <button type="button" className="icon-button" onClick={onRename} aria-label={copy.galleryAssetRename} data-tooltip={copy.galleryAssetRename}>
          <Pencil size={15} />
        </button>
        <button type="button" className="icon-button" onClick={onEditTags} aria-label={copy.galleryEditTags} data-tooltip={copy.galleryEditTags}>
          <Tags size={15} />
        </button>
        <button type="button" className="icon-button ghost danger" onClick={onDelete} aria-label={copy.delete} data-tooltip={copy.delete}>
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}
