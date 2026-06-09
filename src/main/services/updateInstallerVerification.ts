import { createHash } from "node:crypto";
import type { UpdateManifestAsset } from "../../shared/types.js";

export function verifyUpdateAssetBytes(asset: UpdateManifestAsset, bytes: Uint8Array): void {
  if (bytes.byteLength !== asset.sizeBytes) {
    throw new Error("更新包大小校验失败。");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error("更新包校验失败。");
  }
}
