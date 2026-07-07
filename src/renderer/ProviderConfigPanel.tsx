import type React from "react";
import { ChevronUp, Loader2, Radar, Trash2 } from "lucide-react";
import type { ProviderConfig } from "../shared/types";
import type { UiCopy } from "./i18n";

interface ApiConfigCardProps {
  copy: UiCopy;
  config: ProviderConfig;
  active: boolean;
  selected: boolean;
  promoted: boolean;
  canUse: boolean;
  canDelete: boolean;
  saving: boolean;
  bridgeAvailable: boolean;
  discovering: boolean;
  discoveringAny: boolean;
  tooltip: string;
  displayName: string;
  providerLabel: string;
  baseUrlSummary: string;
  connectionBadge: React.ReactNode;
  keyLabel: string;
  modelSummary: string;
  modelSummaryKind: "error" | "info";
  onUse: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onDiscover: () => void;
}

export function ApiConfigCard({
  copy,
  config,
  active,
  selected,
  promoted,
  canUse,
  canDelete,
  saving,
  bridgeAvailable,
  discovering,
  discoveringAny,
  tooltip,
  displayName,
  providerLabel,
  baseUrlSummary,
  connectionBadge,
  keyLabel,
  modelSummary,
  modelSummaryKind,
  onUse,
  onSelect,
  onDelete,
  onDiscover
}: ApiConfigCardProps) {
  return (
    <article
      className={[
        "api-config-card",
        active ? "active" : "",
        selected ? "selected" : "",
        promoted ? "promoted" : ""
      ].filter(Boolean).join(" ")}
      title={tooltip}
    >
      <button
        type="button"
        className="icon-button api-config-use-button"
        onClick={active ? undefined : onUse}
        disabled={active || !canUse || !bridgeAvailable || saving}
        aria-label={active ? copy.currentApiAccess : copy.apiAccessUseNow}
        data-tooltip={active ? copy.currentApiAccess : copy.apiAccessUseNow}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        className="api-config-card-main"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={tooltip}
      >
        <span className="api-config-card-title-row">
          <span className="api-config-card-title">{displayName}</span>
          {connectionBadge}
        </span>
        <span className="api-config-card-meta-row">
          <span className="api-config-card-meta">{providerLabel}</span>
          <span className="api-config-card-meta api-config-card-meta-url">{baseUrlSummary}</span>
        </span>
        <span className="api-config-card-meta-row">
          <span className="api-config-card-key">
            <span className={config.apiKeySaved ? "dot ok" : "dot"} />
            {keyLabel}
          </span>
          <span className="api-config-card-models" data-kind={modelSummaryKind}>
            {modelSummary}
          </span>
        </span>
      </button>
      <div className="api-config-card-actions">
        <button
          type="button"
          className="icon-button ghost danger"
          onClick={onDelete}
          disabled={!canDelete || saving}
          aria-label={canDelete ? copy.deleteApiAccess : copy.deleteLastApiAccessDisabled}
          data-tooltip={canDelete ? copy.deleteApiAccess : copy.deleteLastApiAccessDisabled}
        >
          <Trash2 size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onDiscover}
          disabled={!bridgeAvailable || discoveringAny || !config.apiKeySaved}
          aria-label={copy.discoverModels}
          data-tooltip={copy.discoverModels}
        >
          {discovering ? <Loader2 className="spin" size={15} /> : <Radar size={15} />}
        </button>
      </div>
    </article>
  );
}
