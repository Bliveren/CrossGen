import type React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, KeyRound, LibraryBig, Loader2, Plus, Radar, Rocket, Save, Wrench, X } from "lucide-react";
import type { FocusedLaunchId, ProviderConfig, ProviderKind } from "../shared/types";
import { DialogShell } from "./DialogShell";
import type { UiCopy } from "./i18n";

type DiscoveredProviderModel = ProviderConfig["discoveredModels"][number];
type ConnectionStatus = "idle" | "checking" | "ok" | "error";

interface LaunchButtonState {
  launchId: FocusedLaunchId;
  displayName: string;
  modelId: string;
  providerKind: ProviderKind;
  available: boolean;
  reason: string;
}

interface LaunchModelOption {
  id: string;
  providerKind: ProviderKind;
  displayName: string;
}

interface ProviderSummarySectionProps {
  copy: UiCopy;
  displayName: string;
  discoveryText: string;
  connectionStatus: ConnectionStatus;
  connectionLabel: string;
  connectionTitle: string;
  testingConnection: boolean;
  onOpen: () => void;
}

interface LaunchSectionProps {
  copy: UiCopy;
  activeConfig: ProviderConfig;
  activeProviderKind: ProviderKind;
  launchButtons: LaunchButtonState[];
  openLaunchMenuId: FocusedLaunchId | null;
  saving: boolean;
  modelOptionsForLaunch: (config: ProviderConfig, launchId: FocusedLaunchId) => LaunchModelOption[];
  onToggleLaunchMenu: (launchId: FocusedLaunchId, open: boolean) => void;
  onLaunch: (button: LaunchButtonState) => void;
  onSelectModel: (launchId: FocusedLaunchId, model: LaunchModelOption) => void;
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
  tooltip: string;
  displayName: string;
  baseUrlSummary: string;
  connectionBadge: React.ReactNode;
  modelSummary: string;
  modelSummaryKind: "error" | "info";
  onUse: () => void;
  onSelect: () => void;
  onDelete: () => void;
}

interface ApiConfigDraftCardProps {
  copy: UiCopy;
  name: string;
  baseURL: string;
  saving: boolean;
  namePlaceholder: string;
  baseUrlSummary: string;
  onSelect: () => void;
  onCancel: () => void;
}

export function LaunchSection({
  copy,
  activeConfig,
  activeProviderKind,
  launchButtons,
  openLaunchMenuId,
  saving,
  modelOptionsForLaunch,
  onToggleLaunchMenu,
  onLaunch,
  onSelectModel
}: LaunchSectionProps) {
  return (
    <section className="tool-section launch-section">
      <div className="section-title launch-title">
        <div className="section-title-label">
          <Rocket size={16} />
          <h2>{copy.launchModels}</h2>
        </div>
      </div>
      <div className="launch-strip" aria-label={copy.launchModels}>
        {launchButtons.map((button) => {
          const modelOptions = modelOptionsForLaunch(activeConfig, button.launchId);
          const hasModelMenu = button.available && modelOptions.length > 1;
          const activeModelOption =
            modelOptions.find((model) => model.id === activeConfig.activeModelId && model.providerKind === button.providerKind) ??
            modelOptions.find((model) => model.id === button.modelId && model.providerKind === button.providerKind);
          const isActive = activeConfig.activeLaunchId === button.launchId;
          return (
            <div key={button.launchId} className="launch-item">
              <button
                type="button"
                className={isActive ? "launch-button active" : "launch-button"}
                onClick={() => {
                  if (!button.available) return;
                  onToggleLaunchMenu(button.launchId, hasModelMenu && openLaunchMenuId !== button.launchId);
                  onLaunch(button);
                }}
                disabled={!button.available || saving}
                title={button.reason}
                aria-expanded={hasModelMenu ? openLaunchMenuId === button.launchId : undefined}
              >
                <span className="launch-button-main">
                  <span>{button.displayName}</span>
                  {hasModelMenu && (openLaunchMenuId === button.launchId ? <ChevronUp size={15} /> : <ChevronDown size={15} />)}
                </span>
                <small className="launch-model-detail">{button.available ? activeModelOption?.displayName ?? (button.modelId || copy.generalFallback) : button.reason}</small>
              </button>
              {hasModelMenu && openLaunchMenuId === button.launchId && (
                <div className="launch-model-menu" role="listbox" aria-label={`${button.displayName} ${copy.model}`}>
                  {modelOptions.map((model) => {
                    const isSelected = activeConfig.activeLaunchId === button.launchId && activeConfig.activeModelId === model.id && activeProviderKind === model.providerKind;
                    return (
                      <button
                        key={`${model.providerKind}:${model.id}`}
                        type="button"
                        className={isSelected ? "launch-model-option active" : "launch-model-option"}
                        onClick={() => onSelectModel(button.launchId, model)}
                        disabled={saving}
                        role="option"
                        aria-selected={isSelected}
                        title={model.id}
                      >
                        <span>{model.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ProviderSummarySection({
  copy,
  displayName,
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
        <span className="api-access-current-main">
          <strong>{displayName}</strong>
          <small className="api-access-hover-detail">{discoveryText}</small>
        </span>
        <span className="api-access-config-icon">
          <Wrench size={16} />
        </span>
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
  kind: ProviderKind;
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
  providerLabelForKind: (kind: ProviderKind) => string;
  onKindChange: (kind: ProviderKind) => void;
  onNameChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onSubmit: () => void;
  onDiscover: () => void;
  onDelete: () => void;
}

interface AddApiConfigDetailProps {
  copy: UiCopy;
  saving: boolean;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  apiKey: string;
  namePlaceholder: string;
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
  kind: ProviderKind;
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
  baseUrlSummaryForValue: (baseURL: string) => string;
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
  onKindChange: (kind: ProviderKind) => void;
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
  kind,
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
  baseUrlSummaryForValue,
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
  onKindChange,
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
      selected={!addFormOpen && config.id === selectedConfig.id}
      promoted={promotedApiConfigId === config.id}
      canUse={!active}
      canDelete={active ? canDeleteActiveApiAccess : canDeleteSelectedApiAccess}
      saving={saving}
      bridgeAvailable={bridgeAvailable}
      tooltip={discoveryTooltipForConfig(config)}
      displayName={displayNameForConfig(config)}
      baseUrlSummary={baseUrlSummaryForConfig(config)}
      connectionBadge={connectionBadgeForConfig(config)}
      modelSummary={discoverySummaryForConfig(config)}
      modelSummaryKind={config.lastModelDiscoveryError ? "error" : "info"}
      onUse={() => {
        onCancelAddApiAccess();
        onUseConfig(config);
      }}
      onSelect={() => {
        onCancelAddApiAccess();
        onSelectConfig(config);
      }}
      onDelete={() => onDeleteConfig(config)}
    />
  );

  return (
    <DialogShell className="api-config-dialog" labelledBy="api-config-dialog-title" onClose={onClose}>
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
              {addFormOpen && (
                <ApiConfigDraftCard
                  copy={copy}
                  name={newApiAccessName}
                  baseURL={newApiAccessBaseURL}
                  saving={saving}
                  namePlaceholder={providerLabelForKind(newApiAccessKind)}
                  baseUrlSummary={baseUrlSummaryForValue(newApiAccessBaseURL)}
                  onSelect={() => undefined}
                  onCancel={onCancelAddApiAccess}
                />
              )}
            </div>
            <button type="button" className={addFormOpen ? "secondary api-config-add-button active" : "secondary api-config-add-button"} onClick={onToggleAddForm}>
              {addFormOpen ? <X size={16} /> : <Plus size={16} />}
              {addFormOpen ? copy.cancel : copy.addApiAccess}
            </button>
          </aside>

          {addFormOpen ? (
            <AddApiConfigDetail
              copy={copy}
              saving={saving}
              kind={newApiAccessKind}
              name={newApiAccessName}
              baseURL={newApiAccessBaseURL}
              apiKey={newApiAccessKey}
              namePlaceholder={providerLabelForKind(newApiAccessKind)}
              onKindChange={onNewApiAccessKindChange}
              onNameChange={onNewApiAccessNameChange}
              onBaseURLChange={onNewApiAccessBaseURLChange}
              onApiKeyChange={onNewApiAccessKeyChange}
              onAdd={onAddApiAccess}
              onCancel={onCancelAddApiAccess}
            />
          ) : (
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
              kind={kind}
              name={name}
              apiKey={apiKey}
              baseURL={baseURL}
              namePlaceholder={providerLabelForKind(kind)}
              apiKeyPlaceholder={apiKeyPlaceholder}
              discoveryTooltip={selectedDiscoveryText}
              modelSummary={selectedModelSummary}
              modelSummaryKind={selectedModelSummaryKind}
              modelTooltip={discoveryTooltipForConfig(selectedConfig)}
              modelLabel={modelLabel}
              providerLabelForKind={providerLabelForKind}
              onKindChange={onKindChange}
              onNameChange={onNameChange}
              onApiKeyChange={onApiKeyChange}
              onBaseURLChange={onBaseURLChange}
              onSubmit={onSubmit}
              onDiscover={() => onDiscoverConfig(selectedConfig)}
              onDelete={() => onDeleteConfig(selectedConfig)}
            />
          )}
        </div>
    </DialogShell>
  );
}

export function ApiConfigDraftCard({
  copy,
  name,
  baseURL,
  saving,
  namePlaceholder,
  baseUrlSummary,
  onSelect,
  onCancel
}: ApiConfigDraftCardProps) {
  const displayName = name.trim() || namePlaceholder || copy.apiAccessUntitled;
  return (
    <article className="api-config-card api-config-draft-card selected" title={copy.apiAccessDraftStatus}>
      <button
        type="button"
        className="api-config-card-main"
        onClick={onSelect}
        aria-current="true"
        title={copy.apiAccessDraftStatus}
      >
        <span className="api-config-card-title-row">
          <span className="api-config-card-title">{displayName}</span>
          <span className="connection-badge api-config-card-connection" data-status="checking" title={copy.apiAccessDraftStatus}>
            <span className="connection-dot" />
            {copy.apiAccessDraftStatus}
          </span>
        </span>
        <span className="api-config-card-meta-row">
          <span className="api-config-card-meta api-config-card-meta-url" title={baseURL}>{baseUrlSummary}</span>
          <span className="api-config-card-models" data-kind="info">
            {copy.apiAccessNoModels}
          </span>
        </span>
      </button>
      <div className="api-config-card-actions">
        <button
          type="button"
          className="icon-button ghost"
          onClick={onCancel}
          disabled={saving}
          aria-label={copy.cancel}
          data-tooltip={copy.cancel}
        >
          <X size={15} />
        </button>
      </div>
    </article>
  );
}

export function AddApiConfigDetail({
  copy,
  saving,
  kind,
  name,
  baseURL,
  apiKey,
  namePlaceholder,
  onKindChange,
  onNameChange,
  onBaseURLChange,
  onApiKeyChange,
  onAdd,
  onCancel
}: AddApiConfigDetailProps) {
  return (
    <form
      className="api-config-detail api-config-add-detail api-access-add-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      <div className="api-config-detail-header">
        <div className="section-title">
          <Plus size={16} />
          <h3>{copy.apiAccessDraftDetail}</h3>
        </div>
        <span className="provider-chip-inline">{copy.apiAccessDraftStatus}</span>
      </div>
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
        {copy.apiKey}
        <input type="text" autoComplete="off" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={copy.pasteApiKey} />
      </label>
      <label>
        {copy.baseURL}
        <input value={baseURL} onChange={(event) => onBaseURLChange(event.target.value)} />
      </label>
      <div className="button-row">
        <button type="submit" disabled={saving}>
          {saving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          {saving ? copy.addingApiAccess : copy.addApiAccess}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          <X size={16} />
          {copy.cancel}
        </button>
      </div>
      <section className="api-model-section" aria-label={copy.apiAccessModels}>
        <div className="section-title">
          <LibraryBig size={16} />
          <h3>{copy.apiAccessModels}</h3>
        </div>
        <p className="api-model-summary" data-kind="info">
          {copy.apiAccessNoModels}
        </p>
      </section>
    </form>
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
  kind,
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
  providerLabelForKind,
  onKindChange,
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
        {copy.apiAccessKind}
        <select value={kind} onChange={(event) => onKindChange(event.target.value as ProviderKind)}>
          <option value="openai">{providerLabelForKind("openai")}</option>
          <option value="gemini">{providerLabelForKind("gemini")}</option>
          <option value="custom">{providerLabelForKind("custom")}</option>
        </select>
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
          <X size={16} />
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
  tooltip,
  displayName,
  baseUrlSummary,
  connectionBadge,
  modelSummary,
  modelSummaryKind,
  onUse,
  onSelect,
  onDelete
}: ApiConfigCardProps) {
  return (
    <article
      className={[
        "api-config-card",
        active ? "active" : "",
        selected ? "selected" : "",
        promoted ? "promoted" : ""
      ].filter(Boolean).join(" ")}
      title={copy.apiAccessEditCardTooltip}
    >
      <button
        type="button"
        className="api-config-card-main"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={copy.apiAccessEditCardTooltip}
      >
        <span className="api-config-card-title-row">
          <span className="api-config-card-title">{displayName}</span>
          {connectionBadge}
        </span>
        <span className="api-config-card-meta-row">
          <span className="api-config-card-meta api-config-card-meta-url">{baseUrlSummary}</span>
          <span className="api-config-card-models" data-kind={modelSummaryKind} title={tooltip}>
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
          <X size={15} />
        </button>
        <button
          type="button"
          className="icon-button api-config-enable-button"
          onClick={onUse}
          disabled={active || !canUse || !bridgeAvailable || saving}
          aria-label={active ? copy.currentApiAccess : copy.apiAccessUseNow}
          data-tooltip={active ? copy.currentApiAccess : copy.apiAccessUseNow}
        >
          <CheckCircle2 size={15} />
        </button>
      </div>
    </article>
  );
}
