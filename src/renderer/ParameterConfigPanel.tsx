import type React from "react";
import { SlidersHorizontal, Wrench, X } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { UiCopy } from "./i18n";

interface ParameterConfigLauncherProps {
  copy: UiCopy;
  quickControls: React.ReactNode;
  onOpen: () => void;
}

interface ParameterConfigDialogProps {
  copy: UiCopy;
  primaryControls: React.ReactNode;
  controls: React.ReactNode;
  onClose: () => void;
}

export function ParameterConfigLauncher({
  copy,
  quickControls,
  onOpen
}: ParameterConfigLauncherProps) {
  return (
    <section className="parameter-config-bar" aria-label={copy.parameters}>
      <div className="parameter-config-heading">
        <span className="section-title-label">
          <SlidersHorizontal size={16} />
          <strong>{copy.parameters}</strong>
        </span>
        <button type="button" className="icon-button secondary parameter-config-trigger" onClick={onOpen} aria-label={copy.detailedConfig} data-tooltip={copy.detailedConfig}>
          <Wrench size={15} />
        </button>
      </div>

      <div className="parameter-summary-strip" aria-label={copy.parameters}>
        {quickControls}
      </div>
    </section>
  );
}

export function ParameterConfigDialog({
  copy,
  primaryControls,
  controls,
  onClose
}: ParameterConfigDialogProps) {
  return (
    <DialogShell className="parameter-dialog" labelledBy="parameter-dialog-title" onClose={onClose}>
      <header className="history-header parameter-dialog-header">
        <div>
          <h2 id="parameter-dialog-title">{copy.parameters}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={copy.cancel} data-tooltip={copy.cancel}>
          <X size={16} />
        </button>
      </header>

      <div className="parameter-dialog-body">
        <div className="compact-grid parameter-dialog-primary">
          {primaryControls}
        </div>
        {controls}
      </div>
    </DialogShell>
  );
}
