import type { InputAsset } from "../shared/types";

export type PromptToken =
  | { type: "text"; text: string }
  | { type: "asset"; galleryAssetId: string; label: string }
  | { type: "color"; value: string }
  | { type: "template"; templateId: string; title: string; body: string };

export interface SerializedPrompt {
  prompt: string;
  inputAssets: InputAsset[];
}

export interface PromptTokenResolvers {
  resolveAsset: (galleryAssetId: string) => InputAsset | undefined;
}

export function serializePromptTokens(tokens: readonly PromptToken[], resolvers: PromptTokenResolvers): SerializedPrompt {
  const promptParts: Array<{ value: string; preserve: boolean }> = [];
  const inputAssets: InputAsset[] = [];
  const seenAssetPaths = new Set<string>();

  for (const token of tokens) {
    if (token.type === "text") {
      if (token.text) promptParts.push({ value: token.text, preserve: true });
      continue;
    }

    if (token.type === "template") {
      if (token.body.trim()) promptParts.push({ value: token.body.trim(), preserve: false });
      continue;
    }

    if (token.type === "color") {
      const normalizedColor = normalizeHexColor(token.value);
      if (normalizedColor) promptParts.push({ value: normalizedColor, preserve: false });
      continue;
    }

    if (token.type === "asset") {
      const asset = resolvers.resolveAsset(token.galleryAssetId);
      if (!asset || seenAssetPaths.has(asset.path)) continue;
      seenAssetPaths.add(asset.path);
      inputAssets.push(asset);
    }
  }

  return {
    prompt: joinPromptParts(promptParts),
    inputAssets
  };
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

function joinPromptParts(parts: Array<{ value: string; preserve: boolean }>): string {
  let prompt = "";

  for (const part of parts) {
    if (!part.value) continue;
    if (!prompt) {
      prompt = part.preserve ? part.value : part.value.trim();
      continue;
    }
    const next = part.preserve ? part.value : part.value.trim();
    if (!next) continue;
    prompt += `\n\n${next}`;
  }

  return prompt;
}
