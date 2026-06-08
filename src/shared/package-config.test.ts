import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("package release configuration", () => {
  it("keeps the Windows installer asset name stable for latest-release download links", () => {
    expect(packageJson.build.win.target).toContain("nsis");
    expect(packageJson.build.nsis.artifactName).toBe("Image2Tools-Setup.${ext}");
  });

  it("uses an assisted Windows installer so users can choose the install path", () => {
    expect(packageJson.build.nsis.oneClick).toBe(false);
    expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(true);
  });
});
