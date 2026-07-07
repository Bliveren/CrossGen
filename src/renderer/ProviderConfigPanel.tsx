import type React from "react";
import { AlertTriangle, CheckCircle2, ChevronUp, KeyRound, LibraryBig, Loader2, Plus, Radar, Save, Trash2, Wrench, X } from "lucide-react";
import type { ProviderConfig, ProviderKind } from "../shared/types";
import type { UiCopy } from "./i18n";

type DiscoveredProviderModel = ProviderConfig["discoveredModels"][number];
type ConnectionStatus = "idle" | "checking" | "ok" | "error";

interface ProviderSummarySectionProps {
  copy: UiCopy;
  activeConfig: ProviderConfig;
  displayName: string;
  providerLabel: string;
  baseUrlSummary: string;
  discoveryText: string;
  connectionStatus: ConnectionStatus;
  connectionLabel: string;
  connectionTitle: string;
  testingConnection: boolean;
  onOpen: () => void;
}

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

export function ProviderSummarySection({
  copy,
  activeConfig,
  displayName,
  providerLabel,
  baseUrlSummary,
  discoveryText,
  connectionStatus,
  connectionLabel,
  connectionTitle,
  testingConnection,
  onOpen
}: ProviderSummarySectionProps) {
  return (
    <section className="tool-section model-config-section api-access-section">
      <div className="section-title config-title">
        <div className="section-title-label">
          <KeyRound size={16} />
          <h2>{copy.provider}</h2>
        </div>
        <span className="connection-badge" data-status={connectionStatus} title={connectionTitle}>
          {testingConnection || connectionStatus === "checking" ? (
            <Loader2 className="spin" size={13} />
          ) : connectionStatus === "ok" ? (
            <CheckCircle2 size={13} />
          ) : connectionStatus === "error" ? (
            <AlertTriangle size={13} />
          ) : (
            <span className="connection-dot" />
          )}
          {connectionLabel}
        </span>
      </div>

      <button type="button" className="api-access-current" onClick={onOpen}>
        <span>
          <strong>{displayName}</strong>
          <small>{providerLabel} · {baseUrlSummary}</small>
          <small>
            {activeConfig.apiKeySaved ? copy.keySaved : copy.noKeySaved} · {discoveryText}
          </small>
        </span>
        <Wrench size={16} />
      </button>
    </section>
  );
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

interface AddApiConfigFormProps {
  copy: UiCopy;
  open: boolean;
  saving: boolean;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  apiKey: string;
  namePlaceholder: string;
  onToggle: () => void;
  onKindChange: (kind: ProviderKind) => void;
  onNameChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}

interface ApiConfigDialogProps {
  copy: UiCopy;
  savedApiConfigCount: number;
  activeConfig: ProviderConfig;
  selectedConfig: ProviderConfig;
  inactiveConfigs: ProviderConfig[];
  promotedApiConfigId: string | null;
  canDeleteActiveApiAccess: boolean;
  canDeleteSelectedApiAccess: boolean;
  saving: boolean;
  bridgeAvailable: boolean;
  discoveringProviderId: string | null;
  discoveringAny: boolean;
  connectionErrorText: string | null;
  name: string;
  apiKey: string;
  baseURL: string;
  apiKeyPlaceholder: string;
  selectedDiscoveryText: string;
  selectedModelSummary: string;
  selectedModelSummaryKind: "error" | "info";
  selectedConfigSaved: boolean;
  addFormOpen: boolean;
  newApiAccessKind: ProviderKind;
  newApiAccessName: string;
  newApiAccessBaseURL: string;
  newApiAccessKey: string;
  displayNameForConfig: (config: ProviderConfig) => string;
  providerLabelForKind: (kind: ProviderKind) => string;
  baseUrlSummaryForConfig: (config: ProviderConfig) => string;
  discoverySummaryForConfig: (config: ProviderConfig) => string;
  discoveryTooltipForConfig: (config: ProviderConfig) => string;
  modelLabel: (model: DiscoveredProviderModel) => string;
  connectionBadgeForConfig: (config: ProviderConfig) => React.ReactNode;
  onClose: () => void;
  onUseConfig: (config: ProviderConfig) => void;
  onSelectConfig: (config: ProviderConfig) => void;
  onDeleteConfig: (config: ProviderConfig) => void;
  onDiscoverConfig: (config: ProviderConfig) => void;
  onToggleAddForm: () => void;
  onNewApiAccessKindChange: (kind: ProviderKind) => void;
  onNewApiAccessNameChange: (value: string) => void;
  onNewApiAccessBaseURLChange: (value: string) => void;
  onNewApiAccessKeyChange: (value: string) => void;
  onAddApiAccess: () => void;
  onCancelAddApiAccess: () => void;
  onNameChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onSubmit: () => void;
}

export function ApiConfigDialog({
  copy,
  savedApiConfigCount,
  activeConfig,
  selectedConfig,
  inactiveConfigs,
  promotedApiConfigId,
  canDeleteActiveApiAccess,
  canDeleteSelectedApiAccess,
  saving,
  bridgeAvailable,
  discoveringProviderId,
  discoveringAny,
  connectionErrorText,
  name,
  apiKey,
  baseURL,
  apiKeyPlaceholder,
  selectedDiscoveryText,
  selectedModelSummary,
  selectedModelSummaryKind,
  selectedConfigSaved,
  addFormOpen,
  newApiAccessKind,
  newApiAccessName,
  newApiAccessBaseURL,
  newApiAccessKey,
  displayNameForConfig,
  providerLabelForKind,
  baseUrlSummaryForConfig,
  discoverySummaryForConfig,
  discoveryTooltipForConfig,
  modelLabel,
  connectionBadgeForConfig,
  onClose,
  onUseConfig,
  onSelectConfig,
  onDeleteConfig,
  onDiscoverConfig,
  onToggleAddForm,
  onNewApiAccessKindChange,
  onNewApiAccessNameChange,
  onNewApiAccessBaseURLChange,
  onNewApiAccessKeyChange,
  onAddApiAccess,
  onCancelAddApiAccess,
  onNameChange,
  onApiKeyChange,
  onBaseURLChange,
  onSubmit
}: ApiConfigDialogProps) {
  const renderCard = (config: ProviderConfig, active: boolean) => (
    <ApiConfigCard
      key={config.id}
      copy={copy}
      config={config}
      active={active}
      selected={config.id === selectedConfig.id}
      promoted={promotedApiConfigId === config.id}
      canUse={!active}
      canDelete={active ? canDeleteActiveApiAccess : canDeleteSelectedApiAccess}
      saving={saving}
      bridgeAvailable={bridgeAvailable}
      discovering={discoveringProviderId === config.id}
      discoveringAny={discoveringAny}
      tooltip={discoveryTooltipForConfig(config)}
      displayName={displayNameForConfig(config)}
      providerLabel={providerLabelForKind(config.kind)}
      baseUrlSummary={baseUrlSummaryForConfig(config)}
      connectionBadge={connectionBadgeForConfig(config)}
      keyLabel={config.apiKeySaved ? config.apiKeyPreview ?? copy.keySaved : copy.noKeySaved}
      modelSummary={discoverySummaryForConfig(config)}
      modelSummaryKind={config.lastModelDiscoveryError ? "error" : "info"}
      onUse={() => onUseConfig(config)}
      onSelect={() => onSelectConfig(config)}
      onDelete={() => onDeleteConfig(config)}
      onDiscover={() => onDiscoverConfig(config)}
    />
  );

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="api-config-dialog" role="dialog" aria-modal="true" aria-labelledby="api-config-dialog-title">
        <header className="history-header">
          <div>
            <h2 id="api-config-dialog-title">{copy.provider}</h2>
            <p>{copy.apiAccessDialogSummary(savedApiConfigCount)}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={copy.cancel} data-tooltip={copy.cancel}>
            <X size={16} />
          </button>
        </header>
        <div className="api-config-dialog-body">
          <aside className="api-config-list-pane">
            <div className="api-config-pane-heading">
              <span>{copy.apiAccessCurrentSlot}</span>
              <small>{copy.apiAccessEditHint}</small>
            </div>
            {renderCard(activeConfig, true)}
            <div className="api-config-card-list" aria-label={copy.apiAccessList}>
              {inactiveConfigs.map((config) => renderCard(config, false))}
            </div>
            <AddApiConfigForm
              copy={copy}
              open={addFormOpen}
              saving={saving}
              kind={newApiAccessKind}
              name={newApiAccessName}
              baseURL={newApiAccessBaseURL}
              apiKey={newApiAccessKey}
              namePlaceholder={providerLabelForKind(newApiAccessKind)}
              onToggle={onToggleAddForm}
              onKindChange={onNewApiAccessKindChange}
              onNameChange={onNewApiAccessNameChange}
              onBaseURLChange={onNewApiAccessBaseURLChange}
              onApiKeyChange={onNewApiAccessKeyChange}
              onAdd={onAddApiAccess}
              onCancel={onCancelAddApiAccess}
            />
          </aside>

          <ApiConfigDetail
            copy={copy}
            selectedConfig={selectedConfig}
            active={selectedConfig.id === activeConfig.id}
            bridgeAvailable={bridgeAvailable}
            saving={saving}
            saved={selectedConfigSaved}
            discovering={discoveringProviderId === selectedConfig.id}
            discoveringAny={discoveringAny}
            canDelete={canDeleteSelectedApiAccess}
            connectionErrorText={connectionErrorText}
            name={name}
            apiKey={apiKey}
            baseURL={baseURL}
            namePlaceholder={providerLabelForKind(selectedConfig.kind)}
            apiKeyPlaceholder={apiKeyPlaceholder}
            discoveryTooltip={selectedDiscoveryText}
            modelSummary={selectedModelSummary}
            modelSummaryKind={selectedModelSummaryKind}
            modelTooltip={discoveryTooltipForConfig(selectedConfig)}
            modelLabel={modelLabel}
            onNameChange={onNameChange}
            onApiKeyChange={onApiKeyChange}
            onBaseURLChange={onBaseURLChange}
            onSubmit={onSubmit}
            onDiscover={() => onDiscoverConfig(selectedConfig)}
            onDelete={() => onDeleteConfig(selectedConfig)}
          />
        </div>
      </section>
    </div>
  );
}

export function AddApiConfigForm({
  copy,
  open,
  saving,
  kind,
  name,
  baseURL,
  apiKey,
  namePlaceholder,
  onToggle,
  onKindChange,
  onNameChange,
  onBaseURLChange,
  onApiKeyChange,
  onAdd,
  onCancel
}: AddApiConfigFormProps) {
  return (
    <>
      <button type="button" className="secondary" onClick={onToggle}>
        <Plus size={16} />
        {copy.addApiAccess}
      </button>
      {open && (
        <div className="api-access-add-form">
          <label>
            {copy.apiAccessKind}
            <select value={kind} onChange={(event) => onKindChange(event.target.value as ProviderKind)}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            {copy.apiAccessName}
            <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={namePlaceholder} />
          </label>
          <label>
            {copy.baseURL}
            <input value={baseURL} onChange={(event) => onBaseURLChange(event.target.value)} />
          </label>
          <label>
            {copy.apiKey}
            <input type="text" autoComplete="off" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={copy.pasteApiKey} />
          </label>
          <div className="button-row">
            <button type="button" onClick={onAdd} disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              {saving ? copy.addingApiAccess : copy.addApiAccess}
            </button>
            <button type="button" className="ghost" onClick={onCancel}>
              <X size={16} />
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
    </>
  );
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
