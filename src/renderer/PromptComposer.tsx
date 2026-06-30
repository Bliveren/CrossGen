import { useMemo } from "react";
import { ImagePlus, Palette, ScrollText, X } from "lucide-react";
import type { GalleryAsset, PromptTemplate } from "../shared/types";
import { type PromptToken } from "./promptTokens";

interface PromptComposerProps {
  label: string;
  value: string;
  tokens: PromptToken[];
  templates: PromptTemplate[];
  galleryAssets: GalleryAsset[];
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
  onChange,
  onTokensChange,
  onGalleryAssetToken,
  onDirty
}: PromptComposerProps) {
  const promptTrigger = useMemo(
    () => getTrailingPromptTrigger(value, galleryAssets, templates),
    [galleryAssets, templates, value]
  );

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

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter") {
      const firstPromptOption = promptTrigger?.options[0];
      if (promptTrigger && firstPromptOption) {
        event.preventDefault();
        if (promptTrigger.kind === "gallery") {
          chooseGalleryAsset(firstPromptOption as GalleryAsset, promptTrigger.startIndex);
        } else {
          chooseTemplate(firstPromptOption as PromptTemplate, promptTrigger.startIndex);
        }
      }
    }
  }

  return (
    <div className="prompt-composer">
      <label>
        <span>{label}</span>
        <textarea
          value={value}
          onChange={(event) => {
            onDirty();
            onChange(event.target.value);
          }}
          onKeyDown={handlePromptKeyDown}
        />
      </label>
      {promptTrigger && promptTrigger.options.length > 0 && (
        <div className="prompt-trigger-menu" role="listbox" aria-label={promptTrigger.kind === "gallery" ? "@ Gallery" : "~ Template"}>
          {promptTrigger.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="prompt-trigger-option"
              onClick={() => {
                if (promptTrigger.kind === "gallery") {
                  chooseGalleryAsset(option as GalleryAsset, promptTrigger.startIndex);
                } else {
                  chooseTemplate(option as PromptTemplate, promptTrigger.startIndex);
                }
              }}
            >
              {promptTrigger.kind === "gallery" ? <ImagePlus size={14} /> : <ScrollText size={14} />}
              <span>{promptTrigger.kind === "gallery" ? (option as GalleryAsset).originalName : (option as PromptTemplate).title}</span>
            </button>
          ))}
        </div>
      )}
      {tokens.length > 0 && (
        <div className="prompt-chip-row">
          {tokens.map((token, index) => (
            <button key={`${token.type}-${index}`} type="button" className="prompt-chip" onClick={() => removeToken(index)} title="Remove chip">
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
  if (token.type === "color") return <Palette size={14} />;
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
  | { kind: "template"; startIndex: number; query: string; options: PromptTemplate[] };

function getTrailingPromptTrigger(value: string, galleryAssets: GalleryAsset[], templates: PromptTemplate[]): PromptTrigger | null {
  const match = /(^|[\s])([@~])([^\s@~#]{0,48})$/.exec(value);
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

function matchesTemplateQuery(template: PromptTemplate, query: string): boolean {
  if (!query) return true;
  const haystack = `${template.title} ${template.body} ${template.tags.join(" ")} ${template.category ?? ""}`.toLowerCase();
  return haystack.includes(query);
}
