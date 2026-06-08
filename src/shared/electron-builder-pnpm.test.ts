import { describe, expect, it } from "vitest";
import {
  createPnpmWindowsCmdScript,
  createPnpmWindowsPowerShellScript,
  getPackageManagerSpecFromPackageJson,
  withPrependedPath
} from "./electronBuilderPnpm";

describe("electron-builder pnpm wrapper", () => {
  it("reads the pinned pnpm version from package.json", async () => {
    expect(getPackageManagerSpecFromPackageJson({ packageManager: "pnpm@10.25.0" })).toBe("pnpm@10.25.0");
  });

  it("creates Windows pnpm shims that delegate to corepack", () => {
    expect(createPnpmWindowsCmdScript("pnpm@10.25.0")).toContain("corepack pnpm@10.25.0 %*");
    expect(createPnpmWindowsPowerShellScript("pnpm@10.25.0")).toContain('corepack "pnpm@10.25.0" @args');
  });

  it("prepends the wrapper directory to PATH", () => {
    const env = withPrependedPath("C:\\tmp\\pnpm-wrapper", { PATH: "C:\\tools" }, ";");

    expect(env.PATH).toBe("C:\\tmp\\pnpm-wrapper;C:\\tools");
  });
});
