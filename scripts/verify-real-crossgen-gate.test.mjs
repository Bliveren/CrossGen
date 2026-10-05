import { describe, expect, it } from "vitest";
import {
  isGptImage25LaunchAlias,
  isGptImage2ProviderModelId,
  isGptImage25ProviderModelId,
  isGptImageModelId,
  openAIModelForProvider
} from "./verify-real-crossgen-gate.mjs";

describe("real CrossGen gate model evidence", () => {
  it("keeps the bare GPT Image 2.5 value as a compatibility alias only", () => {
    expect(isGptImage25LaunchAlias("gpt-image-2.5")).toBe(true);
    expect(isGptImage25ProviderModelId("gpt-image-2.5")).toBe(false);
    expect(isGptImageModelId("gpt-image-2.5")).toBe(false);
  });

  it("accepts only exact GPT Image provider ids as real gate models", () => {
    expect(isGptImageModelId("gpt-image-2")).toBe(true);
    expect(isGptImage2ProviderModelId("gpt-image-2-2026-04-21")).toBe(true);
    expect(isGptImageModelId("gpt-image-2-2026-04-21")).toBe(true);
    expect(isGptImage2ProviderModelId("gpt-image-2-2026-02-29")).toBe(false);
    expect(isGptImageModelId("gpt-image-2.5-sunburst")).toBe(true);
    expect(isGptImageModelId("gpt-image-2.5-flare-2026-09-08")).toBe(true);
    expect(isGptImageModelId("gpt-image-2.5-sunburst-2026-09-31")).toBe(false);
  });

  it("does not confuse GPT Image 2 snapshots with GPT Image 2.5 aliases", () => {
    expect(isGptImage2ProviderModelId("gpt-image-2.5")).toBe(false);
    expect(isGptImage25ProviderModelId("gpt-image-2-2026-04-21")).toBe(false);
    expect(isGptImageModelId("gpt-image-2.5")).toBe(false);
  });

  it("does not select the bare alias when the provider catalogue has no exact model", () => {
    expect(openAIModelForProvider({
      models: [{ providerKind: "openai", modelId: "gpt-image-2.5" }],
      activeModelId: "gpt-image-2.5",
      defaultModel: "gpt-image-2.5"
    })).toBe("");
  });

  it("prefers exact GPT Image 2 evidence over a 2.5 variant", () => {
    expect(openAIModelForProvider({
      models: [
        { providerKind: "openai", modelId: "gpt-image-2.5-sunburst" },
        { providerKind: "openai", modelId: "gpt-image-2" }
      ],
      activeModelId: "gpt-image-2.5-sunburst",
      defaultModel: "gpt-image-2.5-sunburst"
    })).toBe("gpt-image-2");
  });

  it("prefers a GPT Image 2 snapshot over a 2.5 variant when exact base id is absent", () => {
    expect(openAIModelForProvider({
      models: [
        { providerKind: "openai", modelId: "gpt-image-2.5-sunburst" },
        { providerKind: "openai", modelId: "gpt-image-2-2026-04-21" }
      ],
      activeModelId: "gpt-image-2.5-sunburst",
      defaultModel: "gpt-image-2.5-sunburst"
    })).toBe("gpt-image-2-2026-04-21");
  });
});
