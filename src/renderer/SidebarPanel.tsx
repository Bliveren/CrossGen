import { useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, FolderCog, KeyRound, RefreshCw, Settings2, SlidersHorizontal } from "lucide-react";
import type { AgentRuntimeStatus, ProviderConfig } from "../shared/types";
import type { UiCopy } from "./i18n";

type ConnectionStatus = "idle" | "checking" | "ok" | "error";

interface ConfigurationMenuProps {
  copy: UiCopy;
  compact?: boolean;
  onApi: () => void;
  onAgents: () => void;
  onParameters: () => void;
  onStorage: () => void;
  onUpdate: () => void;
}

export function ConfigurationMenu({ copy, compact = false, onApi, onAgents, onParameters, onStorage, onUpdate }: ConfigurationMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      triggerRef.current?.focus();
      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      ref={menuRef}
      className={`configuration-menu ${compact ? "compact" : ""}`}
      data-open={menuOpen}
      onMouseEnter={() => setMenuOpen(true)}
      onMouseLeave={() => setMenuOpen(false)}
      onFocusCapture={() => setMenuOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="configuration-trigger icon-button"
        aria-label={copy.configuration}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-tooltip={menuOpen ? undefined : copy.configuration}
        onClick={() => setMenuOpen(true)}
      >
        <Settings2 size={17} />
      </button>
      <div className="configuration-popover" role="menu" aria-label={copy.configuration}>
        <div className="configuration-popover-heading">
          <span className="eyebrow">{copy.configuration}</span>
          <small>{copy.configurationHint}</small>
        </div>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onApi)}>
          <KeyRound size={15} />
          <span>{copy.provider}</span>
          <ChevronRight size={14} />
        </button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onAgents)}>
          <Bot size={15} />
          <span>{copy.agentAccessTitle}</span>
          <ChevronRight size={14} />
        </button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onParameters)}>
          <SlidersHorizontal size={15} />
          <span>{copy.parameters}</span>
          <ChevronRight size={14} />
        </button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onStorage)}>
          <FolderCog size={15} />
          <span>{copy.libraryConfig}</span>
          <ChevronRight size={14} />
        </button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onUpdate)}>
          <RefreshCw size={15} />
          <span>{copy.versionUpdates}</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

interface StatusSummarySectionProps {
  copy: UiCopy;
  activeConfig: ProviderConfig;
  connectionStatus: ConnectionStatus;
  connectionLabel: string;
  testingConnection: boolean;
  agentStatus: AgentRuntimeStatus | null;
  agentLoading: boolean;
  compact?: boolean;
  onApi: () => void;
  onAgents: () => void;
}

export function StatusSummarySection({
  copy,
  activeConfig,
  connectionStatus,
  connectionLabel,
  testingConnection,
  agentStatus,
  agentLoading,
  compact = false,
  onApi,
  onAgents
}: StatusSummarySectionProps) {
  const apiReady = connectionStatus === "ok" && activeConfig.apiKeySaved;
  const agentReady = agentStatus?.cli.status === "ready";
  const apiLabel = testingConnection ? copy.connectionChecking : apiReady ? connectionLabel : activeConfig.apiKeySaved ? connectionLabel : copy.statusNeedsSetup;
  const agentLabel = agentLoading ? copy.agentAccessLoading : agentReady ? copy.agentAccessCliStatus(agentStatus?.cli.status ?? "ready") : copy.statusNeedsSetup;

  return (
    <section className={`status-summary-section api-access-section ${compact ? "compact" : ""}`} aria-label={copy.statusTitle}>
      <div className="status-summary-list">
        <button type="button" className="status-summary-row" data-status-kind="api" onClick={onApi} title={`${copy.statusApi}: ${apiLabel}`} aria-label={`${copy.statusApi}: ${apiLabel}`}>
          <span className="status-summary-icon" data-status={apiReady ? "ok" : connectionStatus}>
            <KeyRound size={15} />
          </span>
          {!compact && <strong className="status-summary-label">{copy.statusApi}</strong>}
        </button>

        <button type="button" className="status-summary-row" data-status-kind="agents" onClick={onAgents} aria-label={copy.agentAccessOpen} title={`${copy.statusAgents}: ${agentLabel}`}>
          <span className="status-summary-icon agent-access-icon" data-status={agentReady ? "ok" : "idle"}><Bot size={15} /></span>
          {!compact && <strong className="status-summary-label">{copy.statusAgents}</strong>}
        </button>
      </div>
    </section>
  );
}
