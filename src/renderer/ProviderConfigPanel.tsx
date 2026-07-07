import type React from "react";
import { CheckCircle2, ChevronUp, KeyRound, LibraryBig, Loader2, Radar, Save, Trash2 } from "lucide-react";
import type { ProviderConfig } from "../shared/types";
import type { UiCopy } from "./i18n";

type DiscoveredProviderModel = ProviderConfig["discoveredModels"][number];

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

interface ApiConfigDetailProps {
  copy: UiCopy;
  selectedConfig: ProviderConfig;
  active: boolean;
  bridgeAvailable: boolean;
  saving: boolean;
  saved: boolean;
  discovering: boolean;
  discoveringAny: boolean;
  canDelete: boolean;
  connectionErrorText: string | null;
  name: string;
  apiKey: string;
  baseURL: string;
  namePlaceholder: string;
  apiKeyPlaceholder: string;
  discoveryTooltip: string;
  modelSummary: string;
  modelSummaryKind: "error" | "info";
  modelTooltip: string;
  modelLabel: (model: DiscoveredProviderModel) => string;
  onNameChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onSubmit: () => void;
  onDiscover: () => void;
  onDelete: () => void;
}

export function ApiConfigDetail({
  copy,
  selectedConfig,
  active,
  bridgeAvailable,
  saving,
  saved,
  discovering,
  discoveringAny,
  canDelete,
  connectionErrorText,
  name,
  apiKey,
  baseURL,
  namePlaceholder,
  apiKeyPlaceholder,
  discoveryTooltip,
  modelSummary,
  modelSummaryKind,
  modelTooltip,
  modelLabel,
  onNameChange,
  onApiKeyChange,
  onBaseURLChange,
  onSubmit,
  onDiscover,
  onDelete
}: ApiConfigDetailProps) {
  return (
    <form
      className="api-config-detail"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="api-config-detail-header">
        <div className="section-title">
          <KeyRound size={16} />
          <h3>{copy.apiAccessSelectedDetail}</h3>
        </div>
        {active && <span className="provider-chip-inline">{copy.currentApiAccess}</span>}
      </div>
      <label>
        {copy.apiAccessName}
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={namePlaceholder}
        />
      </label>
      <label>
        {copy.apiKey}
        <input
          type="text"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={apiKeyPlaceholder}
        />
      </label>
      <label>
        {copy.baseURL}
        <input
          value={baseURL}
          onChange={(event) => onBaseURLChange(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button type="submit" className={saved ? "saved-action" : undefined} disabled={saving}>
          {saving ? <Loader2 className="spin" size={16} /> : saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
          {saved ? copy.apiAccessSaved : copy.save}
        </button>
        <button
          type="button"
          className="secondary discover-button"
          onClick={onDiscover}
          disabled={!bridgeAvailable || discoveringAny || !selectedConfig.apiKeySaved}
          title={discoveryTooltip}
          data-tooltip={copy.discoverModels}
        >
          {discovering ? <Loader2 className="spin" size={16} /> : <Radar size={16} />}
          {discovering ? copy.discoveringModels : copy.discoverModels}
        </button>
        <button
          type="button"
          className="ghost danger"
          onClick={onDelete}
          disabled={!canDelete || saving}
          title={canDelete ? copy.deleteApiAccess : copy.deleteLastApiAccessDisabled}
        >
          <Trash2 size={16} />
          {copy.deleteApiAccess}
        </button>
      </div>
      {active && connectionErrorText && <p className="inline-check error config-error-detail">{connectionErrorText}</p>}
      <section className="api-model-section" aria-label={copy.apiAccessModels}>
        <div className="section-title">
          <LibraryBig size={16} />
          <h3>{copy.apiAccessModels}</h3>
        </div>
        <p className="api-model-summary" data-kind={modelSummaryKind} title={modelTooltip}>
          {modelSummary}
        </p>
        {selectedConfig.discoveredModels.length > 0 ? (
          <div className="api-model-list">
            {selectedConfig.discoveredModels.map((model) => (
              <span key={`${model.providerKind}:${model.id}`} title={modelLabel(model)}>
                {modelLabel(model)}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    </form>
  );
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
