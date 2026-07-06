import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyUpdateAssetBytes } from "./updateInstallerVerification";

describe("update installer verification", () => {
  it("verifies downloaded installer size and sha256", () => {
    const bytes = new TextEncoder().encode("installer");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const asset = {
      platform: "all" as const,
      url: "https://example.com/CrossGen.dmg",
      sha256: digest,
      sizeBytes: bytes.byteLength
    };

    expect(() => verifyUpdateAssetBytes(asset, bytes)).not.toThrow();
    expect(() => verifyUpdateAssetBytes({ ...asset, sizeBytes: bytes.byteLength + 1 }, bytes)).toThrow("大小");
    expect(() => verifyUpdateAssetBytes({ ...asset, sha256: "b".repeat(64) }, bytes)).toThrow("校验");
  });
});
