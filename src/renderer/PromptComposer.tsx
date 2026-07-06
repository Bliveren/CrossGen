import { useEffect, useId, useMemo, useState } from "react";
import { ImagePlus, Palette, ScrollText, X } from "lucide-react";
import type { GalleryAsset, PromptTemplate } from "../shared/types";
import { normalizeHexColor, type PromptToken } from "./promptTokens";

interface PromptComposerProps {
  label: string;
  value: string;
  tokens: PromptToken[];
  templates: PromptTemplate[];
  galleryAssets: GalleryAsset[];
  removeTokenLabel: string;
  onChange: (value: string) => void;
  onTokensChange: (tokens: PromptToken[]) => void;
  onGalleryAssetToken: (asset: GalleryAsset) => void;
  onDirty: () => void;
}

export function PromptComposer({
  label,
  value,
  tokens,
  templates,
  galleryAssets,
  removeTokenLabel,
  onChange,
  onTokensChange,
  onGalleryAssetToken,
  onDirty
}: PromptComposerProps) {
  const promptId = useId();
  const promptTrigger = useMemo(
    () => getTrailingPromptTrigger(value, galleryAssets, templates),
    [galleryAssets, templates, value]
  );
  const promptTriggerKey = getPromptTriggerKey(promptTrigger);
  const [selectedPromptOptionIndex, setSelectedPromptOptionIndex] = useState(0);
  const [dismissedPromptTriggerKey, setDismissedPromptTriggerKey] = useState<string | null>(null);
  const visiblePromptTrigger = promptTrigger && promptTrigger.options.length > 0 && dismissedPromptTriggerKey !== promptTriggerKey
    ? promptTrigger
    : null;
  const boundedPromptOptionIndex = visiblePromptTrigger
    ? Math.min(selectedPromptOptionIndex, visiblePromptTrigger.options.length - 1)
    : 0;

  useEffect(() => {
    setSelectedPromptOptionIndex(0);
    setDismissedPromptTriggerKey(null);
  }, [promptTriggerKey]);

  function addToken(token: PromptToken) {
    onDirty();
    onTokensChange([...tokens, token]);
  }

  function removeToken(index: number) {
    onDirty();
    onTokensChange(tokens.filter((_, tokenIndex) => tokenIndex !== index));
  }

  function replaceTrailingPromptTrigger(nextValue: string) {
    onDirty();
    onChange(nextValue);
  }

  function stripTrailingPromptTrigger(startIndex: number): string {
    return value.slice(0, startIndex).replace(/[ \t]+$/, "");
  }

  function chooseGalleryAsset(asset: GalleryAsset, triggerStartIndex?: number) {
    if (triggerStartIndex !== undefined) {
      replaceTrailingPromptTrigger(stripTrailingPromptTrigger(triggerStartIndex));
    }
    onGalleryAssetToken(asset);
  }

  function chooseTemplate(template: PromptTemplate, triggerStartIndex?: number) {
    if (triggerStartIndex !== undefined) {
      replaceTrailingPromptTrigger(stripTrailingPromptTrigger(triggerStartIndex));
    }
    addToken({ type: "template", templateId: template.id, title: template.title, body: template.body });
  }

  function chooseColor(color: ColorSuggestion, triggerStartIndex?: number) {
    const normalizedColor = normalizeHexColor(color.value);
    if (!normalizedColor) return;
    if (triggerStartIndex !== undefined) {
      replaceTrailingPromptTrigger(stripTrailingPromptTrigger(triggerStartIndex));
    }
    addToken({ type: "color", value: normalizedColor });
  }

  function choosePromptOption(trigger: PromptTrigger, option: PromptOption) {
    if (trigger.kind === "gallery") {
      chooseGalleryAsset(option as GalleryAsset, trigger.startIndex);
      return;
    }
    if (trigger.kind === "template") {
      chooseTemplate(option as PromptTemplate, trigger.startIndex);
      return;
    }
    chooseColor(option as ColorSuggestion, trigger.startIndex);
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && visiblePromptTrigger) {
      event.preventDefault();
      setDismissedPromptTriggerKey(promptTriggerKey);
      return;
    }

    if (event.key === "ArrowDown" && visiblePromptTrigger) {
      event.preventDefault();
      setSelectedPromptOptionIndex((current) => wrapPromptOptionIndex(current + 1, visiblePromptTrigger.options.length));
      return;
    }

    if (event.key === "ArrowUp" && visiblePromptTrigger) {
      event.preventDefault();
      setSelectedPromptOptionIndex((current) => wrapPromptOptionIndex(current - 1, visiblePromptTrigger.options.length));
      return;
    }

    if (event.key === "Enter") {
      const selectedPromptOption = visiblePromptTrigger?.options[boundedPromptOptionIndex];
      if (visiblePromptTrigger && selectedPromptOption) {
        event.preventDefault();
        choosePromptOption(visiblePromptTrigger, selectedPromptOption);
      }
    }
  }

  return (
    <div className="prompt-composer">
      <label className="prompt-composer-field" htmlFor={promptId}>
        <div className="prompt-composer-heading">
          <h3>{label}</h3>
        </div>
        <textarea
          id={promptId}
          value={value}
          onChange={(event) => {
            onDirty();
            onChange(event.target.value);
          }}
          onKeyDown={handlePromptKeyDown}
        />
      </label>
      {visiblePromptTrigger && (
        <div className="prompt-trigger-menu" role="listbox" aria-label={labelForPromptTrigger(visiblePromptTrigger)}>
          {visiblePromptTrigger.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={`prompt-trigger-option${index === boundedPromptOptionIndex ? " is-active" : ""}`}
              role="option"
              aria-selected={index === boundedPromptOptionIndex}
              onMouseEnter={() => setSelectedPromptOptionIndex(index)}
              onClick={() => {
                choosePromptOption(visiblePromptTrigger, option);
              }}
            >
              {iconForPromptOption(visiblePromptTrigger, option)}
              <span>{labelForPromptOption(visiblePromptTrigger, option)}</span>
            </button>
          ))}
        </div>
      )}
      {tokens.length > 0 && (
        <div className="prompt-chip-row">
          {tokens.map((token, index) => (
            <button
              key={`${token.type}-${index}`}
              type="button"
              className="prompt-chip"
              onClick={() => removeToken(index)}
              aria-label={`${removeTokenLabel}: ${labelForToken(token)}`}
              data-tooltip={removeTokenLabel}
            >
              {iconForToken(token)}
              <span>{labelForToken(token)}</span>
              <X size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function iconForToken(token: PromptToken) {
  if (token.type === "asset") return <ImagePlus size={14} />;
  if (token.type === "template") return <ScrollText size={14} />;
  if (token.type === "color") {
    const color = normalizeHexColor(token.value);
    return color ? <span className="prompt-color-swatch" style={{ backgroundColor: color }} aria-hidden="true" /> : <Palette size={14} />;
  }
  return null;
}

function labelForToken(token: PromptToken): string {
  if (token.type === "asset") return `@ ${token.label}`;
  if (token.type === "template") return `~ ${token.title}`;
  if (token.type === "color") return token.value;
  return token.text;
}

type PromptTrigger =
  | { kind: "gallery"; startIndex: number; query: string; options: GalleryAsset[] }
  | { kind: "template"; startIndex: number; query: string; options: PromptTemplate[] }
  | { kind: "color"; startIndex: number; query: string; options: ColorSuggestion[] };

type PromptOption = GalleryAsset | PromptTemplate | ColorSuggestion;

interface ColorSuggestion {
  id: string;
  value: string;
}

const COMMON_HEX_COLORS = [
  "#FFFFFF",
  "#FF6600",
  "#111827",
  "#2563EB",
  "#16A34A",
  "#DC2626",
  "#FACC15",
  "#A855F7"
];

function getTrailingPromptTrigger(value: string, galleryAssets: GalleryAsset[], templates: PromptTemplate[]): PromptTrigger | null {
  const match = /(^|[\s])([@~#])([^\s@~#]{0,48})$/.exec(value);
  if (!match) return null;

  const marker = match[2];
  const query = match[3].trim().toLowerCase();
  const startIndex = match.index + match[1].length;

  if (marker === "@") {
    return {
      kind: "gallery",
      startIndex,
      query,
      options: galleryAssets
        .filter((asset) => matchesGalleryQuery(asset, query))
        .slice(0, 6)
    };
  }

  if (marker === "#") {
    return {
      kind: "color",
      startIndex,
      query,
      options: getColorSuggestions(query)
    };
  }

  return {
    kind: "template",
    startIndex,
    query,
    options: templates
      .filter((template) => matchesTemplateQuery(template, query))
      .slice(0, 6)
  };
}

function matchesGalleryQuery(asset: GalleryAsset, query: string): boolean {
  if (!query) return true;
  const haystack = `${asset.originalName} ${asset.fileName} ${asset.tags.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

function getColorSuggestions(query: string): ColorSuggestion[] {
  if (!/^[0-9a-f]{0,6}$/.test(query)) return [];

  const options: ColorSuggestion[] = [];
  const seen = new Set<string>();
  const typedColor = normalizeHexColor(`#${query}`);

  if (typedColor) addColorSuggestion(options, seen, typedColor);

  for (const color of COMMON_HEX_COLORS) {
    const searchableColor = color.slice(1).toLowerCase();
    if (!query || searchableColor.startsWith(query)) {
      addColorSuggestion(options, seen, color);
    }
    if (options.length >= 6) break;
  }

  return options;
}

function addColorSuggestion(options: ColorSuggestion[], seen: Set<string>, value: string) {
  const normalizedColor = normalizeHexColor(value);
  if (!normalizedColor || seen.has(normalizedColor)) return;
  seen.add(normalizedColor);
  options.push({ id: `color:${normalizedColor}`, value: normalizedColor });
}

function iconForPromptOption(trigger: PromptTrigger, option: PromptOption) {
  if (trigger.kind === "gallery") return <ImagePlus size={14} />;
  if (trigger.kind === "template") return <ScrollText size={14} />;
  return <span className="prompt-color-swatch" style={{ backgroundColor: (option as ColorSuggestion).value }} aria-hidden="true" />;
}

function labelForPromptOption(trigger: PromptTrigger, option: PromptOption): string {
  if (trigger.kind === "gallery") return (option as GalleryAsset).originalName;
  if (trigger.kind === "template") return (option as PromptTemplate).title;
  return (option as ColorSuggestion).value;
}

function labelForPromptTrigger(trigger: PromptTrigger): string {
  if (trigger.kind === "gallery") return "@ Gallery";
  if (trigger.kind === "template") return "~ Template";
  return "# Color";
}

function getPromptTriggerKey(trigger: PromptTrigger | null): string {
  if (!trigger) return "";
  return `${trigger.kind}:${trigger.startIndex}:${trigger.query}:${trigger.options.map((option) => option.id).join("|")}`;
}

function wrapPromptOptionIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) return 0;
  return (index + optionCount) % optionCount;
}

function matchesTemplateQuery(template: PromptTemplate, query: string): boolean {
  if (!query) return true;
  const haystack = `${template.title} ${template.body} ${template.tags.join(" ")} ${template.category ?? ""}`.toLowerCase();
  return haystack.includes(query);
}
