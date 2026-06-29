// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "node:path";
import { selectDmgFile } from "./release-artifact-selection.mjs";

function file(name) {
  return { name, isFile: true };
}

function directory(name) {
  return { name, isFile: false };
}

describe("macOS release verifier dmg selection", () => {
  it("selects the package-version dmg when older release artifacts remain", () => {
    expect(selectDmgFile([
      file("Image2Tools-0.2.2-mac-arm64.dmg"),
      file("Image2Tools-0.2.3-mac-arm64.dmg"),
      file("Image2Tools-0.2.3-mac-arm64.zip"),
      directory("mac-arm64")
    ], "0.2.3")).toBe(path.resolve("release/Image2Tools-0.2.3-mac-arm64.dmg"));
  });

  it("still fails when multiple dmgs exist for the current package version", () => {
    expect(() => selectDmgFile([
      file("Image2Tools-0.3.0-mac-arm64.dmg"),
      file("Image2Tools-0.3.0-mac-x64.dmg")
    ], "0.3.0")).toThrow("Expected one Image2Tools macOS dmg for version 0.3.0");
  });

  it("falls back to the old single-candidate behavior when no versioned dmg exists", () => {
    expect(selectDmgFile([
      file("Image2Tools-preview-mac-arm64.dmg")
    ], "0.3.0")).toBe(path.resolve("release/Image2Tools-preview-mac-arm64.dmg"));
  });
});
