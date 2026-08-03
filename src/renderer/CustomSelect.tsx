import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange(value: string): void;
  options: SelectOption[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** 通用自定义下拉（主题自适应），替代原生 <select>。 */
export function Select({ value, onChange, options, ariaLabel, disabled = false, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function toggleOpen() {
    const next = !open;
    if (next && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const estimatedMenuHeight = Math.min(options.length * 34 + 12, 240) + 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setMenuUp(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow);
    }
    setOpen(next);
  }

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (rootRef.current && !rootRef.current.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const current = options.find((option) => option.value === value && !option.disabled) ?? options.find((option) => option.value === value);

  return (
    <div className={["custom-select", className].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-value={value}
        disabled={disabled}
        onClick={toggleOpen}
      >
        <span className="custom-select-label">{current?.label ?? value}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className={["custom-select-menu", menuUp ? "custom-select-menu-up" : ""].filter(Boolean).join(" ")} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              data-select-value={option.value}
              className={["custom-select-option", option.value === value ? "active" : ""].filter(Boolean).join(" ")}
              onClick={() => {
                setOpen(false);
                if (!option.disabled && option.value !== value) onChange(option.value);
              }}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
