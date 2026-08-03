import type { InputAsset } from "../shared/types";

const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,/;

export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL_PATTERN.test(value);
}

export function referenceDataUrlToAsset(dataUrl: string, index: number): InputAsset {
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl);
  const mimeType = match ? `image/${match[1] === "jpg" ? "jpeg" : match[1]}` : "image/png";
  const body = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  const sizeBytes = Math.max(0, Math.floor((body.length * 3) / 4) - padding);
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `pasted-${Date.now()}-${index}`;
  return {
    id,
    name: `pasted-image-${index + 1}.png`,
    path: "",
    mimeType,
    sizeBytes,
    dataUrl
  };
}

/** 从粘贴文本中提取 data URL(s)，支持被引号/反引号包裹及连续多条。 */
export function extractDataUrlsFromText(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const trimmed = text.trim();
  const candidates: string[] = [];
  const stripped = trimmed.replace(/^["`']+|["`']+$/g, "");
  if (IMAGE_DATA_URL_PATTERN.test(stripped)) candidates.push(stripped);
  const matches = trimmed.match(/data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}/g) ?? [];
  candidates.push(...matches);
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      results.push(candidate);
    }
  }
  return results;
}
