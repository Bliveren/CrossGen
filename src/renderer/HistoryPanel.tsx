import type React from "react";
import { CheckCircle2, Copy, Download, FolderInput, RotateCcw, Save, Trash2 } from "lucide-react";
import type { GenerationJob, ImageAsset } from "../shared/types";
import type { UiCopy } from "./i18n";

interface HistoryItemCardProps {
  copy: UiCopy;
  job: GenerationJob;
  result?: ImageAsset;
  resultSrc?: string;
  jobError: string | null;
  active: boolean;
  selected: boolean;
  batchMode: boolean;
  displayName: string;
  createdAtLabel: string;
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
  onToggleGalleryMenu: () => void;
  onDelete: () => void;
}

export function HistoryItemCard({
  copy,
  job,
  result,
  resultSrc,
  jobError,
  active,
  selected,
  batchMode,
  displayName,
  createdAtLabel,
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
  onToggleGalleryMenu,
  onDelete
}: HistoryItemCardProps) {
  return (
    <article className={`${active ? "history-item active" : "history-item"} ${selected ? "selected" : ""}`}>
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
        {result && resultSrc ? (
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
        <div className="history-meta">
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
          <span className="history-date-model">
            <span>{createdAtLabel}</span>
            <span title={modelTitle}>{modelDisplayName}</span>
          </span>
        </div>
        <div className="history-chip-row history-tag-row" aria-label={copy.historyEditTags}>
          <span className="history-chip system-tag" title={copy.historySystemTag}>{systemTag}</span>
          {job.tags.map((tag) => (
            <span key={tag} className="history-chip">{tag}</span>
          ))}
          <span className="history-add-tag-anchor">
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
              <div
                className="history-tag-popover"
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
              </div>
            )}
          </span>
        </div>
        <p>{job.prompt}</p>
        {jobError && <p className="history-error">{jobError}</p>}
      </div>
      <div className="history-actions">
        <button type="button" className={reuseButtonClass} onClick={onReuse} aria-label={copy.reuse} data-tooltip={copy.reuse}>
          <RotateCcw size={15} />
          <span>{reuseButtonLabel}</span>
        </button>
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
          <Trash2 size={15} />
          <span>{copy.delete}</span>
        </button>
      </div>
    </article>
  );
}
