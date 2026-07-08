import { useMemo } from "react";
import type { GalleryAsset, GalleryFolder } from "../shared/types";
import type { GalleryExplorerEntry, GalleryFolderFilter, GallerySortMode, GalleryViewMode } from "./GalleryPanel";

export const GALLERY_VIRTUAL_GRID_MIN_COLUMN_WIDTH = 154;
export const GALLERY_VIRTUAL_GRID_ROW_HEIGHT = 232;
export const GALLERY_VIRTUAL_LIST_ROW_HEIGHT = 104;
export const GALLERY_VIRTUAL_OVERSCAN_ROWS = 3;
export const GALLERY_CONTENT_DEFAULT_HEIGHT = 380;
export const GALLERY_CONTENT_DEFAULT_WIDTH = 320;

export const GALLERY_ALL_FILTER: GalleryFolderFilter = "__all__";
export const GALLERY_UNCATEGORIZED_FILTER: GalleryFolderFilter = "__uncategorized__";

interface GalleryViewport {
  width: number;
  height: number;
}

interface UseGalleryExplorerModelArgs {
  galleryAssets: GalleryAsset[];
  galleryFolders: GalleryFolder[];
  activeFolderId: GalleryFolderFilter;
  search: string;
  tagFilter: string;
  sort: GallerySortMode;
  viewMode: GalleryViewMode;
  scrollTop: number;
  viewport: GalleryViewport;
}

export function useGalleryExplorerModel({
  galleryAssets,
  galleryFolders,
  activeFolderId,
  search,
  tagFilter,
  sort,
  viewMode,
  scrollTop,
  viewport
}: UseGalleryExplorerModelArgs) {
  const tagsAvailable = useMemo(() => {
    const tags = new Set<string>();
    galleryAssets.forEach((asset) => asset.tags.forEach((tag) => tags.add(tag)));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [galleryAssets]);

  const folderById = useMemo(() => new Map(galleryFolders.map((folder) => [folder.id, folder])), [galleryFolders]);

  const foldersByParent = useMemo(() => {
    const nextFoldersByParent = new Map<string | null, GalleryFolder[]>();
    for (const folder of galleryFolders) {
      const parentId = folderById.has(folder.parentId ?? "") ? folder.parentId ?? null : null;
      const siblings = nextFoldersByParent.get(parentId) ?? [];
      siblings.push(folder);
      nextFoldersByParent.set(parentId, siblings);
    }
    for (const siblings of nextFoldersByParent.values()) {
      siblings.sort((a, b) => a.name.localeCompare(b.name));
    }
    return nextFoldersByParent;
  }, [folderById, galleryFolders]);

  const folderAssetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    galleryAssets.forEach((asset) => {
      counts.set(asset.folderId ?? GALLERY_UNCATEGORIZED_FILTER, (counts.get(asset.folderId ?? GALLERY_UNCATEGORIZED_FILTER) ?? 0) + 1);
    });
    return counts;
  }, [galleryAssets]);

  const folderSubtreeAssetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of galleryAssets) {
      let currentId = asset.folderId ?? null;
      const seen = new Set<string>();
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        counts.set(currentId, (counts.get(currentId) ?? 0) + 1);
        currentId = folderById.get(currentId)?.parentId ?? null;
      }
    }
    return counts;
  }, [folderById, galleryAssets]);

  const currentImportFolderId = activeFolderId === GALLERY_ALL_FILTER || activeFolderId === GALLERY_UNCATEGORIZED_FILTER ? null : activeFolderId;
  const currentCreateParentId = folderById.has(activeFolderId) ? activeFolderId : null;

  const activeChildFolders = useMemo(() => {
    if (activeFolderId === GALLERY_UNCATEGORIZED_FILTER) return [];
    const parentId = folderById.has(activeFolderId) ? activeFolderId : null;
    const query = search.trim().toLowerCase();
    const folders = [...(foldersByParent.get(parentId) ?? [])].filter((folder) => !query || folder.name.toLowerCase().includes(query));
    if (sort === "modified" || sort === "newest") {
      folders.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    } else if (sort === "oldest") {
      folders.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    } else if (sort === "size") {
      folders.sort((a, b) => (folderSubtreeAssetCounts.get(b.id) ?? 0) - (folderSubtreeAssetCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    } else {
      folders.sort((a, b) => a.name.localeCompare(b.name));
    }
    return folders;
  }, [activeFolderId, folderById, folderSubtreeAssetCounts, foldersByParent, search, sort]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = galleryAssets.filter((asset) => {
      if (activeFolderId === GALLERY_UNCATEGORIZED_FILTER && asset.folderId) return false;
      if (activeFolderId !== GALLERY_ALL_FILTER && activeFolderId !== GALLERY_UNCATEGORIZED_FILTER && asset.folderId !== activeFolderId) return false;
      if (tagFilter && !asset.tags.includes(tagFilter)) return false;
      if (!query) return true;
      const haystack = `${asset.originalName} ${asset.fileName} ${asset.tags.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...matched];
    if (sort === "name") {
      sorted.sort((a, b) => a.originalName.localeCompare(b.originalName));
    } else if (sort === "size") {
      sorted.sort((a, b) => b.sizeBytes - a.sizeBytes || a.originalName.localeCompare(b.originalName));
    } else if (sort === "modified") {
      sorted.sort((a, b) => Date.parse(b.modifiedAt ?? b.updatedAt ?? b.createdAt) - Date.parse(a.modifiedAt ?? a.updatedAt ?? a.createdAt));
    } else if (sort === "oldest") {
      sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    } else {
      sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    return sorted;
  }, [activeFolderId, galleryAssets, search, sort, tagFilter]);

  const explorerEntries = useMemo<GalleryExplorerEntry[]>(() => [
    ...activeChildFolders.map((folder) => ({ kind: "folder" as const, id: folder.id, folder })),
    ...filteredAssets.map((asset) => ({ kind: "asset" as const, id: asset.id, asset }))
  ], [activeChildFolders, filteredAssets]);

  const virtualColumns = viewMode === "grid"
    ? Math.max(1, Math.floor((viewport.width + 8) / (GALLERY_VIRTUAL_GRID_MIN_COLUMN_WIDTH + 8)))
    : 1;
  const virtualRowHeight = viewMode === "grid" ? GALLERY_VIRTUAL_GRID_ROW_HEIGHT : GALLERY_VIRTUAL_LIST_ROW_HEIGHT;
  const virtualTotalRows = Math.ceil(explorerEntries.length / virtualColumns);
  const virtualStartRow = Math.max(0, Math.floor(scrollTop / virtualRowHeight) - GALLERY_VIRTUAL_OVERSCAN_ROWS);
  const virtualVisibleRows = Math.ceil(viewport.height / virtualRowHeight) + GALLERY_VIRTUAL_OVERSCAN_ROWS * 2;
  const virtualEndRow = Math.min(virtualTotalRows, virtualStartRow + virtualVisibleRows);
  const virtualStartIndex = virtualStartRow * virtualColumns;
  const virtualEndIndex = Math.min(explorerEntries.length, virtualEndRow * virtualColumns);
  const virtualEntries = explorerEntries.slice(virtualStartIndex, virtualEndIndex);
  const virtualTopSpacer = virtualStartRow * virtualRowHeight;
  const virtualBottomSpacer = Math.max(0, virtualTotalRows - virtualEndRow) * virtualRowHeight;

  return {
    tagsAvailable,
    folderById,
    foldersByParent,
    folderAssetCounts,
    folderSubtreeAssetCounts,
    currentImportFolderId,
    currentCreateParentId,
    activeChildFolders,
    filteredAssets,
    explorerEntries,
    virtualStartIndex,
    virtualEntries,
    virtualTopSpacer,
    virtualBottomSpacer
  };
}
