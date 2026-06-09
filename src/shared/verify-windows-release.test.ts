import { describe, expect, it } from "vitest";
import {
  resolveWindowsReleaseVerificationMode,
  shouldRunSilentInstallCycle
} from "./windowsReleaseVerification";
import { createFindPidsByPathScript } from "./windowsVerifierScripts";

describe("Windows release verifier", () => {
  it("treats an empty process list as a successful no-match result", () => {
    const script = createFindPidsByPathScript();

    expect(script).toContain("@(Get-CimInstance");
    expect(script).toContain("MainWindowHandle");
    expect(script).toContain("exit 0");
  });

  it("defaults to full installer verification outside explicit CI smoke mode", () => {
    const mode = resolveWindowsReleaseVerificationMode({});

    expect(mode).toBe("full-install");
    expect(shouldRunSilentInstallCycle(mode)).toBe(true);
  });

  it("supports a package smoke mode for hosted CI runners", () => {
    const mode = resolveWindowsReleaseVerificationMode({
      IMAGE2TOOLS_WINDOWS_VERIFY_MODE: "package-smoke"
    });

    expect(mode).toBe("package-smoke");
    expect(shouldRunSilentInstallCycle(mode)).toBe(false);
  });

  it("accepts concise aliases for workflow configuration", () => {
    expect(resolveWindowsReleaseVerificationMode({
      IMAGE2TOOLS_WINDOWS_VERIFY_MODE: "ci"
    })).toBe("package-smoke");
    expect(resolveWindowsReleaseVerificationMode({
      IMAGE2TOOLS_WINDOWS_VERIFY_MODE: "installer"
    })).toBe("full-install");
  });

  it("rejects unknown verifier modes", () => {
    expect(() => resolveWindowsReleaseVerificationMode({
      IMAGE2TOOLS_WINDOWS_VERIFY_MODE: "headers-only"
    })).toThrow(/Invalid IMAGE2TOOLS_WINDOWS_VERIFY_MODE/);
  });
});
