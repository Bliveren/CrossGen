import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import updateManifest from "../../docs/updates/latest.json";

describe("package release configuration", () => {
  it("stages the v0.2.0 multi-model release metadata", () => {
    expect(packageJson.version).toBe("0.2.0");
    expect(packageJson.description).toContain("multi-model desktop image workspace");
    expect(packageJson.description).toContain("GPT Image 2");
    expect(packageJson.description).toContain("Nano Banana 3");
    expect(packageJson.build.copyright).toContain("Nowo");
    expect(packageJson.build.copyright).toContain("Corgnitor");
  });

  it("publishes update manifest assets with verifiable size and sha256 for the preview", () => {
    expect(updateManifest.version).toBe(packageJson.version);
    expect(updateManifest.assets.length).toBeGreaterThan(0);
    const platforms = updateManifest.assets.map((asset) => asset.platform);
    expect(platforms).toContain("darwin");
    expect(platforms).toContain("win32");
    for (const asset of updateManifest.assets) {
      expect(asset.url.startsWith("https://")).toBe(true);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0).toBe(true);
    }
  });

  it("keeps the Windows installer asset name stable for latest-release download links", () => {
    expect(packageJson.build.win.target).toContain("nsis");
    expect(packageJson.build.nsis.artifactName).toBe("Image2Tools-Setup.${ext}");
  });

  it("uses an assisted Windows installer so users can choose the install path", () => {
    expect(packageJson.build.nsis.oneClick).toBe(false);
    expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(true);
  });
});
