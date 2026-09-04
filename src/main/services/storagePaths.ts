import type { StorageKind, StorageSettings } from "../../shared/types.js";

export function storagePathForKind(
  storage: StorageSettings,
  kind: StorageKind,
  defaultMediaRoot: string
): string {
  if (kind === "history") return storage.historyDir;
  if (kind === "gallery") return storage.galleryDir;
  return storage.mediaRoot || defaultMediaRoot;
}
