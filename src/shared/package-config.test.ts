import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";
import updateManifest from "../../docs/updates/latest.json";

describe("package release configuration", () => {
  it("stages the v0.3.1 release metadata", () => {
    expect(packageJson.name).toBe("crossgen");
    expect(packageJson.version).toBe("0.3.1");
    expect(packageJson.description).toContain("One-stop AI image generation manager");
    expect(packageJson.description).toContain("API access");
    expect(packageJson.description).toContain("Gallery/history reuse");
    expect(packageJson.bin?.crossgen).toBe("dist/cli/crossgen.js");
    expect(packageJson.build.appId).toBe("com.bliveren.crossgen");
    expect(packageJson.build.productName).toBe("CrossGen");
    expect(packageJson.build.copyright).toContain("Nowo");
    expect(packageJson.build.copyright).toContain("Corgnitor");
    expect(packageJson.build.copyright).toContain("CrossGen");
  });

  it("keeps a published update manifest with verifiable size and sha256", () => {
    // The manifest describes the latest published assets until the 0.3.1
    // artifacts are uploaded and verified. Validate shape, not version equality.
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

  it("uses the CrossGen Windows installer asset name for release download links", () => {
    expect(packageJson.build.win.target).toContain("nsis");
    expect(packageJson.build.nsis.artifactName).toBe("CrossGen-Setup.${ext}");
  });

  it("uses an assisted Windows installer so users can choose the install path", () => {
    expect(packageJson.build.nsis.oneClick).toBe(false);
    expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(true);
  });

  it("ships CLI launchers that do not require Node.js in installed packages", () => {
    const shellLauncherPath = path.resolve("build/cli/crossgen");
    const cmdLauncherPath = path.resolve("build/cli/crossgen.cmd");
    const shellLauncher = readFileSync(shellLauncherPath, "utf8");
    const cmdLauncher = readFileSync(cmdLauncherPath, "utf8");

    if (process.platform !== "win32") {
      expect(statSync(shellLauncherPath).mode & 0o111).toBeGreaterThan(0);
    }
    expect(shellLauncher).toContain('exec "$CROSSGEN_APP_EXECUTABLE" --cli "$@"');
    expect(shellLauncher).toContain('exec "$CROSSGEN_APP_EXECUTABLE" "$@"');
    expect(shellLauncher).toContain("CROSSGEN_DATA_DIR");
    expect(shellLauncher).not.toMatch(/\bnode\b/);
    expect(shellLauncher).not.toContain("dist/cli/crossgen.js");

    expect(cmdLauncher).toContain('"%CROSSGEN_APP_EXECUTABLE%" --cli %*');
    expect(cmdLauncher).toContain('"%CROSSGEN_APP_EXECUTABLE%" %*');
    expect(cmdLauncher).toContain("CROSSGEN_DATA_DIR");
    expect(cmdLauncher).not.toMatch(/\bnode\b/i);
    expect(cmdLauncher).not.toContain("dist\\cli\\crossgen.js");
  });
});
