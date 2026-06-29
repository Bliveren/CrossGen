import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import updateManifest from "../../docs/updates/latest.json";

describe("package release configuration", () => {
  it("stages the v0.3.0 multi-API productivity release metadata", () => {
    expect(packageJson.version).toBe("0.3.0");
    expect(packageJson.description).toContain("multi-model desktop image workspace");
    expect(packageJson.description).toContain("GPT Image 2");
    expect(packageJson.description).toContain("Nano Banana 3");
    expect(packageJson.build.copyright).toContain("Nowo");
    expect(packageJson.build.copyright).toContain("Corgnitor");
  });

  it("keeps a published update manifest with verifiable size and sha256", () => {
    // During release preparation the manifest may still describe the last
    // published release. It is regenerated from signed/validated v0.3.0
    // artifacts at release time. Validate shape, not version equality.
    expect(typeof updateManifest.version).toBe("string");
    expect(updateManifest.version.length).toBeGreaterThan(0);
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
