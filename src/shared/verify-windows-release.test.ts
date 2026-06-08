import { describe, expect, it } from "vitest";
import { createFindPidsByPathScript } from "./windowsVerifierScripts";

describe("Windows release verifier", () => {
  it("treats an empty process list as a successful no-match result", () => {
    const script = createFindPidsByPathScript();

    expect(script).toContain("@(Get-CimInstance");
    expect(script).toContain("MainWindowHandle");
    expect(script).toContain("exit 0");
  });
});
