import { CheckCircle2, Clipboard, ExternalLink, KeyRound, Link2, Loader2, Unlink2, Wrench, X } from "lucide-react";
import type { AgentRuntimeStatus } from "../shared/types";
import type { UiCopy } from "./i18n";

interface AgentAccessPanelProps {
  copy: UiCopy;
  status: AgentRuntimeStatus | null;
  loading: boolean;
  cliActionLoading: boolean;
  onClose: () => void;
  onCopy: (value: string) => void;
  onEnableCli: () => void;
  onDisableCli: () => void;
}

function valueOrFallback(value: string | null | undefined): string {
  return value?.trim() || "-";
}

export function AgentAccessSection({ copy, status, loading, onOpen }: { copy: UiCopy; status: AgentRuntimeStatus | null; loading: boolean; onOpen: () => void }) {
  const statusLabel = loading ? copy.agentAccessLoading : status ? copy.agentAccessCliStatus(status.cli.status) : copy.agentAccessNoConfig;
  return (
    <section className="tool-section agent-access-section">
      <div className="section-title agent-access-title-row">
        <div className="section-title-label">
          <KeyRound size={16} />
          <h2>{copy.agentAccessTitle}</h2>
        </div>
        <span className="agent-access-status" data-status={status?.cli.status ?? "unknown"}>
          {loading ? <Loader2 className="spin" size={13} /> : status?.cli.status === "ready" ? <CheckCircle2 size={13} /> : <Wrench size={13} />}
          {statusLabel}
        </span>
      </div>
      <button type="button" className="agent-access-current" onClick={onOpen} disabled={loading}>
        <span className="agent-access-current-main">
          <strong>{status ? copy.agentAccessCliStatus(status.cli.status) : copy.agentAccessTitle}</strong>
          <small>{copy.agentAccessSubtitle}</small>
        </span>
        <ExternalLink size={15} />
      </button>
    </section>
  );
}

export function AgentAccessDialog({ copy, status, loading, cliActionLoading, onClose, onCopy, onEnableCli, onDisableCli }: AgentAccessPanelProps) {
  const copyValue = (value: string | null | undefined) => {
    if (value) onCopy(value);
  };
  const activeProvider = status?.activeProvider;
  const providerSummary = activeProvider
    ? copy.agentAccessProviderSummary(activeProvider.name ?? activeProvider.id, activeProvider.kind, activeProvider.activeModelId ?? "-")
    : "-";

  return (
    <div className="agent-access-dialog">
      <div className="agent-access-dialog-header">
        <div>
          <h2 id="agent-access-dialog-title">{copy.agentAccessDialogTitle}</h2>
          <p>{copy.agentAccessDialogDescription}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={copy.close} data-tooltip={copy.close}>
          <X size={17} />
        </button>
      </div>

      {loading ? (
        <div className="agent-access-loading" role="status">
          <Loader2 className="spin" size={16} />
          <span>{copy.agentAccessLoading}</span>
        </div>
      ) : !status ? (
        <p className="muted">{copy.agentAccessNoConfig}</p>
      ) : (
        <>
          <div className="agent-access-summary-grid">
            <div className="agent-access-summary-item">
              <span>{copy.agentAccessCliCommand}</span>
              <strong>{copy.agentAccessCliStatus(status.cli.status)}</strong>
            </div>
            <div className="agent-access-summary-item">
              <span>{copy.agentAccessActiveProvider}</span>
              <strong>{providerSummary}</strong>
            </div>
            <div className="agent-access-summary-item">
              <span>{copy.agentAccessApiKey}</span>
              <strong>{status.apiKeyAvailable ? copy.agentAccessYes : copy.agentAccessNo}</strong>
            </div>
            <div className="agent-access-summary-item">
              <span>{copy.agentAccessWorkers}</span>
              <strong>{copy.agentAccessWorkerCount(status.liveWorkerHosts)}</strong>
            </div>
          </div>

          <div className="agent-access-paths">
            <div className="agent-access-path-row">
              <span>{copy.agentAccessMcpDirect}</span>
              <code title={status.mcp.command}>{valueOrFallback(status.mcp.command)}</code>
            </div>
            <div className="agent-access-path-row">
              <span>{copy.agentAccessLauncher}</span>
              <code title={status.cli.launcherPath ?? undefined}>{valueOrFallback(status.cli.launcherPath)}</code>
            </div>
            <div className="agent-access-path-row">
              <span>{copy.agentAccessDataDir}</span>
              <code title={status.dataDir}>{status.dataDir}</code>
            </div>
            <div className="agent-access-path-row">
              <span>{copy.agentAccessState}</span>
              <code title={status.statePath}>{status.statePath}</code>
            </div>
            <div className="agent-access-path-row">
              <span>{copy.agentAccessCliLinkPath}</span>
              <code title={status.cli.linkPath ?? undefined}>{valueOrFallback(status.cli.linkPath)}</code>
            </div>
          </div>

          {status.runtimeKind === "packaged" && status.cli.launcherExists && (
            <section className="agent-access-cli-toggle">
              <div>
                <h3>{copy.agentAccessCliToggleTitle}</h3>
                <p className="muted">{copy.agentAccessCliToggleDescription}</p>
              </div>
              {status.cli.linkManaged ? (
                <button type="button" className="secondary" onClick={onDisableCli} disabled={cliActionLoading}>
                  {cliActionLoading ? <Loader2 className="spin" size={15} /> : <Unlink2 size={15} />}
                  {copy.agentAccessDisableCli}
                </button>
              ) : (
                <button type="button" className="secondary" onClick={onEnableCli} disabled={cliActionLoading}>
                  {cliActionLoading ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />}
                  {copy.agentAccessEnableCli}
                </button>
              )}
            </section>
          )}

          <section className="agent-access-command-group">
            <div className="agent-access-subtitle-row">
              <h3>{copy.agentAccessCommands}</h3>
              <span className="muted">{status.cli.repairHint}</span>
            </div>
            {[status.commands.version, status.commands.doctor, status.commands.configStatus, status.commands.modelsList, status.commands.queueStatus].map((command) => (
              <div className="agent-access-copy-row" key={command}>
                <code>{command}</code>
                <button type="button" className="icon-button secondary" onClick={() => copyValue(command)} aria-label={copy.copyCommand} data-tooltip={copy.copyCommand}>
                  <Clipboard size={15} />
                </button>
              </div>
            ))}
          </section>

          <section className="agent-access-command-group">
            <div className="agent-access-subtitle-row">
              <h3>{copy.agentAccessMcpConfigs}</h3>
              <span className="muted">{copy.agentAccessModeReadonly} / {copy.agentAccessModeWrite} / {copy.agentAccessModeGenerate}</span>
            </div>
            {status.mcp.configs.map((config) => (
              <div className="agent-access-copy-row" key={`${config.client}:${config.mode}`}>
                <span className="agent-access-config-label">{config.client} · {config.mode} · {config.format}</span>
                <button type="button" className="icon-button secondary" onClick={() => copyValue(config.snippet)} aria-label={copy.copyConfig} data-tooltip={copy.copyConfig}>
                  <Clipboard size={15} />
                </button>
              </div>
            ))}
          </section>

          {status.cli.linkCommand && status.cli.status !== "ready" && (
            <section className="agent-access-repair">
              <div className="agent-access-subtitle-row">
                <h3><Wrench size={15} /> {copy.agentAccessRepair}</h3>
                <span className="muted">{status.cli.repairHint}</span>
              </div>
              <div className="agent-access-copy-row">
                <code>{status.cli.linkCommand}</code>
                <button type="button" className="icon-button secondary" onClick={() => copyValue(status.cli.linkCommand)} aria-label={copy.copyCommand} data-tooltip={copy.copyCommand}>
                  <Clipboard size={15} />
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
