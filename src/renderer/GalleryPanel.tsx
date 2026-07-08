import type React from "react";
import { ArrowDownUp, ChevronDown, ChevronRight, FileUp, Folder, FolderOpen, FolderPlus, Pencil, Save, Tags, Trash2 } from "lucide-react";
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
  editingGalleryId: string | null;
  tagsInput: string;
  folderSubtreeAssetCounts: ReadonlyMap<string, number>;
  dropHandlersForFolder: (folderId: GalleryFolderFilter) => GalleryEntryDropHandlers;
  formatBytes: (bytes: number) => string;
  formatDate: (value: string) => string;
  folderDisplayPath: (folder: GalleryFolder) => string;
  assetThumbnailPath: (asset: GalleryAsset) => string;
  isEntrySelected: (entry: GalleryExplorerEntry) => boolean;
  onScrollTopChange: (scrollTop: number) => void;
  onFolderContextMenu: (event: React.MouseEvent<HTMLElement>, folderId: GalleryFolderFilter) => void;
  onPrepareEntryDrag: (event: React.DragEvent<HTMLElement>, entry: GalleryExplorerEntry) => void;
  onToggleSelection: (entry: GalleryExplorerEntry, index: number, event: React.MouseEvent<HTMLInputElement>) => void;
  onOpenFolder: (folderId: GalleryFolderFilter) => void;
  onRenameFolder: (folder: GalleryFolder) => void;
  onPreviewAsset: (asset: GalleryAsset) => void;
  onAssetContextMenu: (event: React.MouseEvent<HTMLElement>, asset: GalleryAsset) => void;
  onEditAssetTags: (asset: GalleryAsset) => void;
  onTagsInputChange: (value: string) => void;
  onSaveAssetTags: (asset: GalleryAsset) => void;
  onCancelAssetTags: () => void;
  onMoveTagPopoverPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
  onRenameAsset: (asset: GalleryAsset) => void;
  onDeleteAsset: (asset: GalleryAsset) => void;
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
  editingGalleryId,
  tagsInput,
  folderSubtreeAssetCounts,
  dropHandlersForFolder,
  formatBytes,
  formatDate,
  folderDisplayPath,
  assetThumbnailPath,
  isEntrySelected,
  onScrollTopChange,
  onFolderContextMenu,
  onPrepareEntryDrag,
  onToggleSelection,
  onOpenFolder,
  onRenameFolder,
  onPreviewAsset,
  onAssetContextMenu,
  onEditAssetTags,
  onTagsInputChange,
  onSaveAssetTags,
  onCancelAssetTags,
  onMoveTagPopoverPointerDown,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift,
  onRenameAsset,
  onDeleteAsset
}: GalleryContentGridProps) {
  return (
    <section className="gallery-directory-content" aria-label={copy.galleryFolderContents}>
      <div
        ref={contentRef}
        className={`gallery-grid gallery-content-grid ${viewMode} ${batchMode ? "batch-select" : ""} ${dropTarget ? "drop-target" : ""}`}
        style={{
          "--gallery-virtual-padding-top": `${virtualTopSpacer}px`,
          "--gallery-virtual-padding-bottom": `${virtualBottomSpacer}px`
        } as React.CSSProperties}
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
              dropHandlers={dropHandlersForFolder(entry.id)}
              onDragStart={(event) => onPrepareEntryDrag(event, entry)}
              onOpen={() => onOpenFolder(entry.id)}
              onContextMenu={(event) => onFolderContextMenu(event, entry.id)}
              onToggleSelection={(event) => onToggleSelection(entry, index, event)}
              onRename={() => onRenameFolder(entry.folder)}
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
              editingTags={editingGalleryId === entry.asset.id}
              tagsInput={tagsInput}
              onDragStart={(event) => onPrepareEntryDrag(event, entry)}
              onOpen={() => onPreviewAsset(entry.asset)}
              onContextMenu={(event) => onAssetContextMenu(event, entry.asset)}
              onToggleSelection={(event) => onToggleSelection(entry, index, event)}
              onEditTags={() => onEditAssetTags(entry.asset)}
              onTagsInputChange={onTagsInputChange}
              onSaveTags={() => onSaveAssetTags(entry.asset)}
              onCancelTags={onCancelAssetTags}
              onMoveTagPopoverPointerDown={onMoveTagPopoverPointerDown}
              onMoveToolbarTowardPointer={onMoveToolbarTowardPointer}
              onResetToolbarDrift={onResetToolbarDrift}
              onRename={() => onRenameAsset(entry.asset)}
              onDelete={() => onDeleteAsset(entry.asset)}
            />
          );
        })}
      </div>
    </section>
  );
}
