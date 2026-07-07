import { ArrowDownUp, ChevronDown, FileUp, FolderPlus } from "lucide-react";
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
