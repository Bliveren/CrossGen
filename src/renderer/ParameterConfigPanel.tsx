import type React from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import type { UiCopy } from "./i18n";

interface ParameterSectionProps {
  copy: UiCopy;
  expanded: boolean;
  summary: React.ReactNode;
  controls: React.ReactNode;
  onToggle: () => void;
}

export function ParameterSection({
  copy,
  expanded,
  summary,
  controls,
  onToggle
}: ParameterSectionProps) {
  return (
    <section className="tool-section">
      <button type="button" className="section-toggle" onClick={onToggle}>
        <span className="section-toggle-label">
          <SlidersHorizontal size={16} />
          <span>{copy.parameters}</span>
        </span>
        <span className="section-toggle-state">
          {expanded ? copy.hide : copy.show}
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      <div className="compact-grid">
        {summary}
      </div>

      {expanded && controls}
    </section>
  );
}
