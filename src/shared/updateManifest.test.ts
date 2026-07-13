import { describe, expect, it } from "vitest";
import { parseUpdateManifest, safeUpdateFileName, selectUpdateAsset } from "./updateManifest";

const sha256 = "a".repeat(64);

describe("update manifest", () => {
  it("parses signed asset metadata including sha256 and size", () => {
    const manifest = parseUpdateManifest({
      version: " v0.2.1 ",
      notes: "Release",
      pubDate: "2026-06-09T00:00:00.000Z",
      assets: [
        {
          platform: "win32",
          arch: "x64",
          url: "https://github.com/Bliveren/CrossGen/releases/download/v0.2.1/CrossGen-Setup.exe",
          fileName: "CrossGen-Setup.exe",
          sha256: sha256.toUpperCase(),
          sizeBytes: 123456
        }
      ]
    });

    expect(manifest.version).toBe("v0.2.1");
    expect(manifest.assets[0]).toEqual({
      platform: "win32",
      arch: "x64",
      url: "https://github.com/Bliveren/CrossGen/releases/download/v0.2.1/CrossGen-Setup.exe",
      fileName: "CrossGen-Setup.exe",
      sha256,
      sizeBytes: 123456
    });
  });

  it("rejects assets without positive integer sizeBytes", () => {
    expect(() =>
      parseUpdateManifest({
        version: "0.2.1",
        assets: [
          {
            platform: "darwin",
            url: "https://github.com/Bliveren/CrossGen/releases/download/v0.2.1/CrossGen-0.2.1-mac-arm64.dmg",
            sha256,
            sizeBytes: 0
          }
        ]
      })
    ).toThrow("sizeBytes");
  });

  it("selects exact platform and arch before platform-only fallback", () => {
    const exact = {
      platform: "linux" as const,
      arch: "arm64",
      url: "https://example.com/arm64.AppImage",
      sha256,
      sizeBytes: 10
    };
    const fallback = {
      platform: "linux" as const,
      url: "https://example.com/generic.AppImage",
      sha256,
      sizeBytes: 20
    };

    expect(selectUpdateAsset([fallback, exact], "linux", "arm64")).toBe(exact);
    expect(selectUpdateAsset([fallback, exact], "linux", "x64")).toBe(fallback);
  });

  it("uses a safe basename for manifest file names", () => {
    expect(
      safeUpdateFileName({
        platform: "win32",
        url: "https://example.com/download.exe",
        fileName: "../CrossGen-Setup.exe",
        sha256,
        sizeBytes: 10
      })
    ).toBe("CrossGen-Setup.exe");
  });
});
