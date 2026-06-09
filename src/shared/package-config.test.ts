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

  it("keeps the update manifest staged until signed assets are published", () => {
    expect(updateManifest.version).toBe(packageJson.version);
    expect(updateManifest.assets).toEqual([]);
    expect(updateManifest.notes).toContain("signed and externally verified release assets");
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
