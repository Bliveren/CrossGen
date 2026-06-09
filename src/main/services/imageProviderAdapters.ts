import type { ProviderKind, RunJobRequest } from "../../shared/types.js";
import { GENERAL_LAUNCH_ID } from "../../shared/modelCatalog.js";
import type { ImageProviderAdapter } from "./imageProviderAdapter.js";
import { generalImageAdapter } from "./generalImageAdapter.js";
import { geminiImageAdapter } from "./geminiImageAdapter.js";
import { openaiImageAdapter } from "./openaiImageAdapter.js";

const imageProviderAdapters = new Map<ProviderKind, ImageProviderAdapter>([
  [openaiImageAdapter.kind, openaiImageAdapter],
  [geminiImageAdapter.kind, geminiImageAdapter]
]);

export function getImageProviderAdapter(kind: ProviderKind): ImageProviderAdapter | undefined {
  return imageProviderAdapters.get(kind);
}

export function getImageProviderAdapterForRequest(request: RunJobRequest): ImageProviderAdapter | undefined {
  if (request.params.launchId === GENERAL_LAUNCH_ID) return generalImageAdapter;
  return getImageProviderAdapter(request.params.providerKind);
}

export function unsupportedImageProviderMessage(): string {
  return "当前版本尚未接入该模型运行时。";
}
