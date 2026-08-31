import { useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Clipboard, ExternalLink, KeyRound, Link2, Loader2, Unlink2, Wrench, X } from "lucide-react";
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
  skillActionLoading: boolean;
  onInstallSkill: () => void;
}

function valueOrFallback(value: string | null | undefined): string {
  return value?.trim() || "-";
}

function clientLabel(client: string): string {
  if (client === "claude-code") return "Claude Code";
  if (client === "cursor") return "Cursor";
  return "Codex";
}

export function AgentAccessSection({ copy, status, loading, onOpen }: { copy: UiCopy; status: AgentRuntimeStatus | null; loading: boolean; onOpen: () => void }) {
  const statusLabel = loading ? copy.agentAccessLoading : status ? copy.agentAccessCliStatus(status.cli.status) : copy.agentAccessNoConfig;
  const connected = status?.cli.status === "ready";
  const hoverLabel = loading ? copy.agentAccessLoading : connected ? copy.agentAccessConnected : copy.agentAccessNotConnected;
  return (
    <section className="agent-access-section" aria-label={copy.agentAccessTitle}>
      <button type="button" className="agent-access-current" onClick={onOpen} disabled={loading} aria-label={copy.agentAccessOpen} data-tooltip={copy.agentAccessOpen}>
        <span className="agent-access-icon" data-connected={connected ? "true" : "false"} data-loading={loading ? "true" : "false"}>
          {loading ? <Loader2 className="spin" size={18} /> : <Bot size={19} strokeWidth={1.8} />}
        </span>
        <span className="agent-access-current-main">
          <strong>{copy.agentAccessTitle}</strong>
          <small>{statusLabel}</small>
        </span>
        <ExternalLink size={15} />
      </button>
      <div className="agent-access-hover-detail" aria-hidden="true">
        <span className="agent-access-hover-dot" data-connected={connected ? "true" : "false"} />
        <span>{hoverLabel}</span>
        <small>{copy.agentAccessSubtitle}</small>
      </div>
    </section>
  );
}

export function AgentAccessDialog({ copy, status, loading, cliActionLoading, onClose, onCopy, onEnableCli, onDisableCli, skillActionLoading, onInstallSkill }: AgentAccessPanelProps) {
  const copyValue = (value: string | null | undefined) => {
    if (value) onCopy(value);
  };
  const activeProvider = status?.activeProvider;
  const providerSummary = activeProvider
    ? copy.agentAccessProviderSummary(activeProvider.name ?? activeProvider.id, activeProvider.kind, activeProvider.activeModelId ?? "-")
    : "-";
  const [showDetails, setShowDetails] = useState(false);
  const [mcpMode, setMcpMode] = useState<"readonly" | "write" | "generate">("readonly");

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
          <section className="agent-access-overview">
            <div className="agent-access-overview-heading">
              <div>
                <span className="eyebrow">{copy.agentAccessConnection}</span>
                <h3>{status.cli.status === "ready" ? copy.agentAccessConnected : copy.agentAccessNotConnected}</h3>
              </div>
              <span className="agent-access-overview-state" data-status={status.cli.status}>
                {status.cli.status === "ready" ? <CheckCircle2 size={14} /> : <Wrench size={14} />}
                {copy.agentAccessCliStatus(status.cli.status)}
              </span>
            </div>
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
          </section>

          <section className="agent-access-mcp-start">
            <div className="agent-access-subtitle-row">
              <div>
                <h3><KeyRound size={15} /> {copy.agentAccessMcpStartTitle}</h3>
                <p className="muted">{copy.agentAccessMcpStartDescription}</p>
              </div>
              <span className="agent-access-mode-badge">{mcpMode === "readonly" ? copy.agentAccessModeReadonly : mcpMode === "write" ? copy.agentAccessModeWrite : copy.agentAccessModeGenerate}</span>
            </div>
            <div className="agent-access-copy-row agent-access-mcp-command">
              <code title={status.mcp.command}>{valueOrFallback(status.mcp.command)}</code>
              <button type="button" className="icon-button secondary" onClick={() => copyValue(status.mcp.command)} aria-label={copy.copyCommand} data-tooltip={copy.copyCommand}>
                <Clipboard size={15} />
              </button>
            </div>
            <span className="agent-access-config-prompt">{copy.agentAccessMcpQuickConfig}</span>
            <div className="agent-access-mode-actions" role="group" aria-label={copy.agentAccessMcpModeSelect}>
              {(["readonly", "write", "generate"] as const).map((mode) => (
                <button type="button" className={mcpMode === mode ? "secondary active" : "secondary"} key={mode} onClick={() => setMcpMode(mode)}>
                  {mode === "readonly" ? copy.agentAccessModeReadonly : mode === "write" ? copy.agentAccessModeWrite : copy.agentAccessModeGenerate}
                </button>
              ))}
            </div>
            <div className="agent-access-client-actions">
              {status.mcp.configs.filter((config) => config.mode === mcpMode).map((config) => (
                <button type="button" className="secondary" key={`${config.client}:${mcpMode}`} onClick={() => copyValue(config.snippet)}>
                  <Clipboard size={14} />
                  {clientLabel(config.client)}
                </button>
              ))}
            </div>
            <small className="agent-access-mcp-note">{copy.agentAccessMcpModeHint}</small>
          </section>

          <section className="agent-access-skill-card">
            <div>
              <h3>{copy.agentAccessSkillTitle}</h3>
              <p className="muted">{status.artistSkill?.available ? copy.agentAccessSkillDescription : copy.agentAccessSkillUnavailable}</p>
            </div>
            <button type="button" className="secondary" onClick={onInstallSkill} disabled={skillActionLoading || !status.artistSkill?.available}>
              {skillActionLoading ? <Loader2 className="spin" size={15} /> : status.artistSkill?.installed ? <CheckCircle2 size={15} /> : <Bot size={15} />}
              {status.artistSkill?.installed ? copy.agentAccessUpdateSkill : copy.agentAccessInstallSkill}
            </button>
          </section>

          <button type="button" className="agent-access-details-toggle" onClick={() => setShowDetails((current) => !current)} aria-expanded={showDetails}>
            <span>{copy.agentAccessDetails}</span>
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showDetails && <div className="agent-access-details">

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
          </div>}
        </>
      )}
    </div>
  );
}
