import { useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDownUp, CheckCircle2, ChevronUp, Copy, Download, FolderInput, Info, RotateCcw, RefreshCw, Save, Search, Video, X } from "lucide-react";
import type { GenerationJob, OutputAsset } from "../shared/types";
import type { UiCopy } from "./i18n";

type HistoryViewMode = "grid" | "list";
type HistoryStatusFilter = "all" | "succeeded" | "failed";
type HistorySortMode = "newest" | "oldest";

interface HistoryScrollState {
  top: number;
  clientHeight: number;
  scrollHeight: number;
}

interface HistoryListShellProps {
  copy: UiCopy;
  listRef: React.RefObject<HTMLDivElement | null>;
  viewMode: HistoryViewMode;
  batchMode: boolean;
  empty: boolean;
  pager: React.ReactNode;
  children: React.ReactNode;
  onScrollStateChange: (state: HistoryScrollState) => void;
}

interface HistoryFloatingPagerProps {
  copy: UiCopy;
  visible: boolean;
  pageSizeMenuOpen: boolean;
  pageSizeOptions: readonly number[];
  pageSize: number;
  expanded: boolean;
  showAllLabel: string;
  previousLabel: string;
  nextLabel: string;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onTogglePageSizeMenu: () => void;
  onSelectPageSize: (size: number) => void;
  onToggleExpanded: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onMoveToolbarTowardPointer: (event: React.MouseEvent<HTMLElement>) => void;
  onResetToolbarDrift: (event: React.MouseEvent<HTMLElement>) => void;
}

interface HistoryFilterToolbarProps {
  copy: UiCopy;
  search: string;
  statusFilter: HistoryStatusFilter;
  sort: HistorySortMode;
  searching: boolean;
  matchCount: number;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (filter: HistoryStatusFilter) => void;
  onSortChange: (sort: HistorySortMode) => void;
}

interface HistoryItemCardProps {
  copy: UiCopy;
  job: GenerationJob;
  result?: OutputAsset;
  resultSrc?: string;
  jobError: string | null;
  statusLabel: string;
  recoverable: boolean;
  active: boolean;
  hoverOpen: boolean;
  selected: boolean;
  batchMode: boolean;
  displayName: string;
  createdAtLabel: string;
  durationLabel?: string;
  modelDisplayName: string;
  modelTitle: string;
  systemTag: string;
  isGalleryAdded: boolean;
  galleryMenuOpen: boolean;
  galleryTargetMenu: React.ReactNode;
  editingName: boolean;
  nameDraft: string;
  editingTags: boolean;
  tagsInput: string;
  reuseButtonClass: string;
  copyButtonClass: string;
  downloadButtonClass: string;
  reuseButtonLabel: string;
  copyButtonLabel: string;
  downloadButtonLabel: string;
  onToggleSelection: (checked: boolean) => void;
  onHoverOpen: () => void;
  onHoverClose: () => void;
  onOpen: () => void;
  onImageContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
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
  onReuse: () => void;
  onCopyPrompt: () => void;
  onDownload: () => void;
  onDetails: () => void;
  onRetry: () => void;
  onToggleGalleryMenu: () => void;
  onDelete: () => void;
}

const POPOVER_MARGIN = 12;

function clampPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function HistoryTagPopover({
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
      className="history-tag-popover"
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
      <button
        type="button"
        className="icon-button"
        disabled={!tagsInput.trim()}
        onClick={onSaveTags}
        aria-label={copy.historySaveTags}
        data-tooltip={copy.historySaveTags}
      >
        <Save size={14} />
      </button>
    </div>,
    document.body
  );
}

export function HistoryFilterToolbar({
  copy,
  search,
  statusFilter,
  sort,
  searching,
  matchCount,
  onSearchChange,
  onStatusFilterChange,
  onSortChange
}: HistoryFilterToolbarProps) {
  return (
    <>
      <div className="rail-filter-row">
        <label className="search-box">
          <Search size={15} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={copy.searchPrompt} />
        </label>
        <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as HistoryStatusFilter)} aria-label={copy.historyFilter}>
          <option value="all">{copy.filterAll}</option>
          <option value="succeeded">{copy.historySucceeded}</option>
          <option value="failed">{copy.historyFailed}</option>
        </select>
      </div>

      <div className="history-sort rail-sort-row">
        <ArrowDownUp size={14} />
        <button
          type="button"
          className={sort === "newest" ? "history-sort-option active" : "history-sort-option"}
          onClick={() => onSortChange("newest")}
        >
          {copy.sortNewest}
        </button>
        <button
          type="button"
          className={sort === "oldest" ? "history-sort-option active" : "history-sort-option"}
          onClick={() => onSortChange("oldest")}
        >
          {copy.sortOldest}
        </button>
      </div>

      {searching && (
        <div className="history-list-status">
          <span>{copy.historyMatchCount(matchCount)}</span>
        </div>
      )}
    </>
  );
}

export function HistoryListShell({
  copy,
  listRef,
  viewMode,
  batchMode,
  empty,
  pager,
  children,
  onScrollStateChange
}: HistoryListShellProps) {
  return (
    <div className="history-list-shell">
      <div
        ref={listRef}
        className={`history-list ${viewMode} ${batchMode ? "batch-select" : ""}`}
        onScroll={(event) => {
          onScrollStateChange({
            top: event.currentTarget.scrollTop,
            clientHeight: event.currentTarget.clientHeight,
            scrollHeight: event.currentTarget.scrollHeight
          });
        }}
      >
        {empty ? (
          <div className="history-empty">{copy.noJobsYet}</div>
        ) : (
          children
        )}
      </div>
      {pager}
    </div>
  );
}

export function HistoryFloatingPager({
  copy,
  visible,
  pageSizeMenuOpen,
  pageSizeOptions,
  pageSize,
  expanded,
  showAllLabel,
  previousLabel,
  nextLabel,
  previousDisabled,
  nextDisabled,
  onTogglePageSizeMenu,
  onSelectPageSize,
  onToggleExpanded,
  onPreviousPage,
  onNextPage,
  onMoveToolbarTowardPointer,
  onResetToolbarDrift
}: HistoryFloatingPagerProps) {
  return (
    <div
      className={`history-floating-pager ${visible ? "visible" : ""}`}
      data-drift="subtle"
      onMouseMove={onMoveToolbarTowardPointer}
      onMouseLeave={onResetToolbarDrift}
    >
      <div className="history-page-size-control">
        <button
          type="button"
          className="history-pager-arrow"
          onClick={onTogglePageSizeMenu}
          aria-label={copy.historyPageSizeMenu}
          data-tooltip={copy.historyPageSizeMenu}
        >
          <ChevronUp size={14} />
        </button>
        {pageSizeMenuOpen && (
          <div className="history-page-size-menu" role="menu" aria-label={copy.historyPageSizeMenu}>
            {pageSizeOptions.map((size) => (
              <button
                key={size}
                type="button"
                className={pageSize === size ? "active" : undefined}
                onClick={() => onSelectPageSize(size)}
                role="menuitem"
              >
                {copy.historyPageSizeOption(size)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="history-expand-button" onClick={onToggleExpanded}>
        <span>{expanded ? copy.collapseHistory : showAllLabel}</span>
      </button>
      <button
        type="button"
        className="history-page-nav"
        onClick={onPreviousPage}
        disabled={previousDisabled}
        aria-label={previousLabel}
        data-tooltip={previousLabel}
      >
        <span aria-hidden="true">&lt;</span>
      </button>
      <button
        type="button"
        className="history-page-nav"
        onClick={onNextPage}
        disabled={nextDisabled}
        aria-label={nextLabel}
        data-tooltip={nextLabel}
      >
        <span aria-hidden="true">&gt;</span>
      </button>
    </div>
  );
}

export function HistoryItemCard({
  copy,
  job,
  result,
  resultSrc,
  jobError,
  statusLabel,
  recoverable,
  active,
  hoverOpen,
  selected,
  batchMode,
  displayName,
  createdAtLabel,
  durationLabel,
  modelDisplayName,
  modelTitle,
  systemTag,
  isGalleryAdded,
  galleryMenuOpen,
  galleryTargetMenu,
  editingName,
  nameDraft,
  editingTags,
  tagsInput,
  reuseButtonClass,
  copyButtonClass,
  downloadButtonClass,
  reuseButtonLabel,
  copyButtonLabel,
  downloadButtonLabel,
  onToggleSelection,
  onHoverOpen,
  onHoverClose,
  onOpen,
  onImageContextMenu,
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
  onReuse,
  onCopyPrompt,
  onDownload,
  onDetails,
  onRetry,
  onToggleGalleryMenu,
  onDelete
}: HistoryItemCardProps) {
  const sourceLabel = job.source === "cli" ? copy.historySourceCli : job.source === "mcp" ? copy.historySourceMcp : copy.historySourceDesktop;
  const tagAnchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <article
      className={[
        "history-item",
        active ? "active" : "",
        hoverOpen ? "hover-open" : "",
        selected ? "selected" : ""
      ].filter(Boolean).join(" ")}
      data-status={job.status}
      onMouseEnter={onHoverOpen}
      onMouseLeave={onHoverClose}
      onFocus={onHoverOpen}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
        onHoverClose();
      }}
    >
      {batchMode && (
        <input
          className="history-entry-select"
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggleSelection(event.currentTarget.checked)}
          aria-label={copy.historySelectItem(createdAtLabel)}
        />
      )}
      <button
        type="button"
        className="history-preview"
        onClick={onOpen}
        onContextMenu={onImageContextMenu}
        title={jobError ?? job.status}
        aria-label={jobError ? `${copy.jobFailed}: ${jobError}` : `${copy.openJob}: ${job.status}`}
      >
        {result?.kind === "video" ? (
          <span className="media-preview-placeholder" aria-label="Video">
            <Video size={22} />
            <small>VIDEO</small>
          </span>
        ) : result && resultSrc ? (
          <img
            src={resultSrc}
            alt={copy.historyResult}
            draggable={Boolean(result.path)}
            onDragStart={(event) => {
              if (!result.path) return;
              event.dataTransfer.setData("application/x-image2tools-asset", result.path);
              event.dataTransfer.effectAllowed = "copy";
            }}
          />
        ) : (
          <span>{job.status}</span>
        )}
      </button>
      <div className="history-copy">
        <div className="history-main-copy">
          <div className="history-name-wrap">
            {editingName ? (
              <input
                className="history-name-input"
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
                aria-label={copy.historyImageName}
                autoFocus
              />
            ) : (
              <button type="button" className="history-name-button" onClick={onStartEditName} aria-label={copy.historyEditName} data-tooltip={copy.historyEditName}>
                {displayName}
              </button>
            )}
          </div>
          <div className="history-chip-row history-tag-row" aria-label={copy.historyEditTags}>
            <span className="history-chip system-tag" title={copy.historySystemTag}>{systemTag}</span>
            {sourceLabel && <span className="history-chip source-tag" title={copy.historySourceTag}>{sourceLabel}</span>}
            {job.tags.map((tag) => (
              <span key={tag} className="history-chip">{tag}</span>
            ))}
            <span ref={tagAnchorRef} className="history-add-tag-anchor">
              <button
                type="button"
                className="history-chip history-add-tag-button"
                onClick={onEditTags}
                aria-label={copy.addTag}
                data-tooltip={copy.addTag}
              >
                {copy.addTag}
              </button>
              {editingTags && (
                <HistoryTagPopover
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
          <p>{job.prompt}</p>
          {recoverable && (
            <div className="history-recovery-strip" data-status={job.status} title={jobError ?? statusLabel}>
              <AlertTriangle size={13} />
              <span>{statusLabel}</span>
              <button type="button" className="icon-button" onClick={onDetails} aria-label={copy.queue.details} data-tooltip={copy.queue.details}>
                <Info size={13} />
              </button>
            </div>
          )}
        </div>
        <span className="history-date-model">
          <span>{createdAtLabel}</span>
          {durationLabel && <span className="history-duration">{durationLabel}</span>}
          <span className="history-status-chip" data-status={job.status}>{statusLabel}</span>
          <span title={modelTitle}>{modelDisplayName}</span>
        </span>
      </div>
      <div className="history-actions">
        <button type="button" className={reuseButtonClass} onClick={onReuse} aria-label={copy.reuse} data-tooltip={copy.reuse}>
          <RotateCcw size={15} />
          <span>{reuseButtonLabel}</span>
        </button>
        {recoverable && (
          <button type="button" className="history-action-button" onClick={onRetry} aria-label={copy.queue.retry} data-tooltip={copy.queue.retry}>
            <RefreshCw size={15} />
            <span>{copy.queue.retry}</span>
          </button>
        )}
        <button type="button" className={copyButtonClass} onClick={onCopyPrompt} aria-label={copy.copyPrompt} data-tooltip={copy.copyPrompt}>
          <Copy size={15} />
          <span>{copyButtonLabel}</span>
        </button>
        <button
          type="button"
          className={downloadButtonClass}
          disabled={!result}
          onClick={onDownload}
          aria-label={copy.download}
          data-tooltip={copy.download}
        >
          <Download size={15} />
          <span>{downloadButtonLabel}</span>
        </button>
        <button
          type="button"
          className={[
            result ? "history-action-button history-gallery-menu-button" : "history-action-button",
            isGalleryAdded ? "already-in-gallery" : ""
          ].filter(Boolean).join(" ")}
          disabled={!result}
          onClick={onToggleGalleryMenu}
          aria-label={copy.galleryAddHistory}
          data-tooltip={copy.galleryAddHistory}
          aria-expanded={galleryMenuOpen}
        >
          {isGalleryAdded && <CheckCircle2 className="history-gallery-check" size={12} />}
          <FolderInput size={15} />
          <span>{copy.galleryAddHistory}</span>
        </button>
        {galleryTargetMenu}
        <button type="button" className="history-action-button danger" onClick={onDelete} aria-label={copy.delete} data-tooltip={copy.delete}>
          <X size={15} />
          <span>{copy.delete}</span>
        </button>
      </div>
    </article>
  );
}
