import { describe, expect, it } from "vitest";
import { getProviderEnvKeyNames } from "./keyring";

describe("provider key env aliases", () => {
  it("recognizes CrossGen, Image2Tools, and AIHub aliases for openai-compatible providers", () => {
    expect(getProviderEnvKeyNames("openai")).toEqual([
      "CROSSGEN_OPENAI_API_KEY",
      "IMAGE2TOOLS_API_KEY",
      "AIHUB_API_KEY",
      "CROSSGEN_API_KEY"
    ]);
    expect(getProviderEnvKeyNames("custom")).toEqual([
      "CROSSGEN_CUSTOM_API_KEY",
      "IMAGE2TOOLS_API_KEY",
      "AIHUB_API_KEY",
      "CROSSGEN_API_KEY"
    ]);
    expect(getProviderEnvKeyNames("gemini")).toEqual([
      "CROSSGEN_GEMINI_API_KEY",
      "IMAGE2TOOLS_GEMINI_API_KEY",
      "AIHUB_GEMINI_API_KEY",
      "CROSSGEN_API_KEY",
      "IMAGE2TOOLS_API_KEY",
      "AIHUB_API_KEY"
    ]);
  });
});
