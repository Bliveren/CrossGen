import { ImagePlus, Palette, ScrollText, X } from "lucide-react";
import type { GalleryAsset, PromptTemplate } from "../shared/types";
import { normalizeHexColor, type PromptToken } from "./promptTokens";

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
  function addToken(token: PromptToken) {
    onDirty();
    onTokensChange([...tokens, token]);
  }

  function removeToken(index: number) {
    onDirty();
    onTokensChange(tokens.filter((_, tokenIndex) => tokenIndex !== index));
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
        />
      </label>
      <div className="prompt-token-toolbar" aria-label="Prompt chips">
        <select
          value=""
          onChange={(event) => {
            const asset = galleryAssets.find((item) => item.id === event.target.value);
            if (asset) onGalleryAssetToken(asset);
            event.currentTarget.value = "";
          }}
          title="@ Gallery"
        >
          <option value="">@</option>
          {galleryAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>{asset.originalName}</option>
          ))}
        </select>
        <select
          value=""
          onChange={(event) => {
            const template = templates.find((item) => item.id === event.target.value);
            if (template) addToken({ type: "template", templateId: template.id, title: template.title, body: template.body });
            event.currentTarget.value = "";
          }}
          title="~ Template"
        >
          <option value="">~</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.title}</option>
          ))}
        </select>
        <input
          aria-label="Color chip"
          placeholder="#RRGGBB"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const color = normalizeHexColor(event.currentTarget.value);
            if (!color) return;
            addToken({ type: "color", value: color });
            event.currentTarget.value = "";
          }}
        />
      </div>
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
