import { describe, expect, it } from "vitest";
import {
  GEMINI_3_PRO_IMAGE_MODEL_ID,
  GPT_IMAGE_2_MODEL_ID,
  NANO_BANANA_3_MODEL_ID,
  getCatalogModelIds
} from "./modelCatalog";
import {
  CATALOG_TARGET_MODEL_OPTIONS,
  SPLIT_RESOLUTION_TIERS,
  aliasCoveredSplitResolutionTiers,
  entryResolutionTier,
  gptSizeToResolutionTier,
  isSplitResolutionTier,
  aliasCoveredResolutionTiers,
  detectResolutionTierFromModelId,
  isFocusedImageModelIdWithAliases,
  normalizeModelAlias,
  resolveAliasedModelId,
  type ModelAliasEntry
} from "./modelAliasMapping";

describe("normalizeModelAlias", () => {
  it("trims, lowercases, and strips the models/ prefix on both sides", () => {
    expect(
      normalizeModelAlias({
        aliasModelId: "  Models/GEMINI-3.1-FLASH-IMAGE-PREVIEW-2K ",
        targetModelId: " GemIni-3.1-Flash-Image "
      })
    ).toEqual({
      aliasModelId: "gemini-3.1-flash-image-preview-2k",
      targetModelId: "gemini-3.1-flash-image"
    });
  });

  it("returns null when either side is empty after normalization", () => {
    expect(normalizeModelAlias({ aliasModelId: "  ", targetModelId: NANO_BANANA_3_MODEL_ID })).toBeNull();
    expect(normalizeModelAlias({ aliasModelId: "models/", targetModelId: "  " })).toBeNull();
    expect(normalizeModelAlias({ aliasModelId: "gemini-x-image", targetModelId: "" })).toBeNull();
  });
});

describe("detectResolutionTierFromModelId", () => {
  it("detects -4k as 4K", () => {
    expect(detectResolutionTierFromModelId("gemini-3-pro-image-preview-4k-vip")).toBe("4K");
    expect(detectResolutionTierFromModelId("Models/GEMINI-3-PRO-IMAGE-PREVIEW-4K")).toBe("4K");
  });

  it("detects -2k as 2K", () => {
    expect(detectResolutionTierFromModelId("gemini-3.1-flash-image-preview-2k")).toBe("2K");
    expect(detectResolutionTierFromModelId("nano-banana-3-image-2k")).toBe("2K");
  });

  it("detects -0.5k as 0.5K", () => {
    expect(detectResolutionTierFromModelId("gemini-3.1-flash-image-preview-0.5k")).toBe("0.5K");
  });

  it("treats no suffix as 1K", () => {
    expect(detectResolutionTierFromModelId("gemini-3.1-flash-image")).toBe("1K");
    expect(detectResolutionTierFromModelId("nano-banana-3-image")).toBe("1K");
  });

  it("treats -1k as 1K", () => {
    expect(detectResolutionTierFromModelId("gemini-3.1-flash-image-1k")).toBe("1K");
  });

  it("returns undefined for non-gemini image models", () => {
    expect(detectResolutionTierFromModelId(GPT_IMAGE_2_MODEL_ID)).toBeUndefined();
    expect(detectResolutionTierFromModelId("dall-e-3-4k")).toBeUndefined();
  });

  it("returns undefined for gemini models without the image marker", () => {
    expect(detectResolutionTierFromModelId("gemini-3-pro-4k")).toBeUndefined();
    expect(detectResolutionTierFromModelId("nano-banana-3-2k")).toBeUndefined();
  });
});

describe("resolveAliasedModelId", () => {
  const aliases: ModelAliasEntry[] = [
    { aliasModelId: "gemini-3.1-flash-image-preview-2k", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3-pro-image-preview-4k-vip", targetModelId: GEMINI_3_PRO_IMAGE_MODEL_ID }
  ];

  it("returns the target when the model id hits an alias", () => {
    expect(resolveAliasedModelId("gemini-3.1-flash-image-preview-2k", aliases)).toBe(NANO_BANANA_3_MODEL_ID);
  });

  it("normalizes both the input and stored alias before matching", () => {
    expect(
      resolveAliasedModelId("  Models/GEMINI-3-PRO-IMAGE-PREVIEW-4K-VIP ", [
        { aliasModelId: "models/gemini-3-pro-image-preview-4k-vip", targetModelId: GEMINI_3_PRO_IMAGE_MODEL_ID }
      ])
    ).toBe(GEMINI_3_PRO_IMAGE_MODEL_ID);
  });

  it("returns the original model id when nothing matches", () => {
    expect(resolveAliasedModelId("gemini-3.1-flash-image-preview-8k", aliases)).toBe("gemini-3.1-flash-image-preview-8k");
    expect(resolveAliasedModelId(GPT_IMAGE_2_MODEL_ID, aliases)).toBe(GPT_IMAGE_2_MODEL_ID);
  });
});

describe("isFocusedImageModelIdWithAliases", () => {
  const aliases: ModelAliasEntry[] = [
    { aliasModelId: "gemini-3.1-flash-image-preview-2k", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3-pro-image-preview-4k-vip", targetModelId: GEMINI_3_PRO_IMAGE_MODEL_ID }
  ];

  it("accepts built-in catalog model ids directly", () => {
    expect(isFocusedImageModelIdWithAliases("gemini", NANO_BANANA_3_MODEL_ID, aliases)).toBe(true);
    expect(isFocusedImageModelIdWithAliases("openai", GPT_IMAGE_2_MODEL_ID, aliases)).toBe(true);
  });

  it("accepts model ids that resolve through an alias", () => {
    expect(isFocusedImageModelIdWithAliases("gemini", "gemini-3.1-flash-image-preview-2k", aliases)).toBe(true);
    expect(isFocusedImageModelIdWithAliases("gemini", "models/gemini-3-pro-image-preview-4k-vip", aliases)).toBe(true);
  });

  it("rejects unknown model ids", () => {
    expect(isFocusedImageModelIdWithAliases("gemini", "gemini-3.1-flash-image-preview-8k", aliases)).toBe(false);
  });

  it("rejects an alias whose target belongs to another provider kind", () => {
    // gemini provider cannot use an openai catalog model through an alias
    expect(
      isFocusedImageModelIdWithAliases("gemini", "some-openai-alias", [
        { aliasModelId: "some-openai-alias", targetModelId: GPT_IMAGE_2_MODEL_ID }
      ])
    ).toBe(false);
    // openai provider cannot use a gemini catalog model through an alias
    expect(
      isFocusedImageModelIdWithAliases("openai", "some-gemini-alias", [
        { aliasModelId: "some-gemini-alias", targetModelId: NANO_BANANA_3_MODEL_ID }
      ])
    ).toBe(false);
    // a bare alias target that is not a catalog model for the provider is also rejected
    expect(
      isFocusedImageModelIdWithAliases("gemini", "gpt-image-2", [
        { aliasModelId: "gpt-image-2", targetModelId: GPT_IMAGE_2_MODEL_ID }
      ])
    ).toBe(false);
  });

  it("rejects an alias whose target is not in the catalog", () => {
    expect(
      isFocusedImageModelIdWithAliases("gemini", "random-alias-model", [
        { aliasModelId: "random-alias-model", targetModelId: "not-a-catalog-model" }
      ])
    ).toBe(false);
  });
});

describe("aliasCoveredResolutionTiers", () => {
  const aliases: ModelAliasEntry[] = [
    { aliasModelId: "gemini-3.1-flash-image-preview-2k", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3.1-flash-image-preview-4k", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3.1-flash-image-preview-0.5k", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3-pro-image-preview-4k-vip", targetModelId: GEMINI_3_PRO_IMAGE_MODEL_ID },
    { aliasModelId: "gemini-3-pro-image-1k", targetModelId: GEMINI_3_PRO_IMAGE_MODEL_ID }
  ];

  it("collects the tiers covered by aliases for the target", () => {
    expect(aliasCoveredResolutionTiers(NANO_BANANA_3_MODEL_ID, aliases)).toEqual(new Set(["0.5K", "2K", "4K"]));
    expect(aliasCoveredResolutionTiers(GEMINI_3_PRO_IMAGE_MODEL_ID, aliases)).toEqual(new Set(["1K", "4K"]));
  });

  it("ignores aliases for other targets and aliases without a detectable tier", () => {
    expect(aliasCoveredResolutionTiers(GPT_IMAGE_2_MODEL_ID, aliases)).toEqual(new Set());
    expect(
      aliasCoveredResolutionTiers(NANO_BANANA_3_MODEL_ID, [
        { aliasModelId: "gpt-image-2", targetModelId: NANO_BANANA_3_MODEL_ID }
      ])
    ).toEqual(new Set());
  });

  it("normalizes target comparison", () => {
    expect(aliasCoveredResolutionTiers("  Models/" + NANO_BANANA_3_MODEL_ID.toUpperCase(), aliases)).toEqual(
      new Set(["0.5K", "2K", "4K"])
    );
  });
});

describe("CATALOG_TARGET_MODEL_OPTIONS", () => {
  it("lists built-in gemini/openai catalog model ids without the general fallback", () => {
    expect(CATALOG_TARGET_MODEL_OPTIONS).toEqual([GPT_IMAGE_2_MODEL_ID, NANO_BANANA_3_MODEL_ID, GEMINI_3_PRO_IMAGE_MODEL_ID]);
    expect(getCatalogModelIds()).toEqual(CATALOG_TARGET_MODEL_OPTIONS);
    expect(CATALOG_TARGET_MODEL_OPTIONS).not.toContain("general");
  });
});


describe("split mode resolution tiers", () => {
  const splitAliases: ModelAliasEntry[] = [
    { aliasModelId: "gemini-3.1-flash-image-preview-2k", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3.1-flash-image-preview-4k-vip", targetModelId: NANO_BANANA_3_MODEL_ID },
    { aliasModelId: "gemini-3-pro-image-preview-0.5k", targetModelId: GEMINI_3_PRO_IMAGE_MODEL_ID }
  ];

  it("only splits into 1K/2K/4K", () => {
    expect(SPLIT_RESOLUTION_TIERS).toEqual(["1K", "2K", "4K"]);
    expect(isSplitResolutionTier("1K")).toBe(true);
    expect(isSplitResolutionTier("2K")).toBe(true);
    expect(isSplitResolutionTier("4K")).toBe(true);
    expect(isSplitResolutionTier("0.5K")).toBe(false);
    expect(isSplitResolutionTier(undefined)).toBe(false);
  });

  it("covers only split tiers and ignores 0.5K", () => {
    expect(aliasCoveredSplitResolutionTiers(NANO_BANANA_3_MODEL_ID, splitAliases)).toEqual(new Set(["2K", "4K"]));
    expect(aliasCoveredSplitResolutionTiers(GEMINI_3_PRO_IMAGE_MODEL_ID, splitAliases)).toEqual(new Set());
    expect(aliasCoveredSplitResolutionTiers(NANO_BANANA_3_MODEL_ID, [])).toEqual(new Set());
  });

  it("detects the tier from split relay names", () => {
    expect(detectResolutionTierFromModelId("gemini-3.1-flash-image-preview-2k")).toBe("2K");
    expect(detectResolutionTierFromModelId("gemini-3-pro-image-preview-4k-vip")).toBe("4K");
    expect(detectResolutionTierFromModelId("gemini-3.1-flash-image")).toBe("1K");
  });
});

describe("explicit tier and gpt-image size mapping", () => {
  it("prefers the explicit tier over name detection", () => {
    expect(
      entryResolutionTier({ aliasModelId: "gemini-3.1-flash-image-preview-2k", targetModelId: NANO_BANANA_3_MODEL_ID, tier: "4K" })
    ).toBe("4K");
    expect(
      entryResolutionTier({ aliasModelId: "gemini-3.1-flash-image-preview-2k", targetModelId: NANO_BANANA_3_MODEL_ID })
    ).toBe("2K");
    expect(entryResolutionTier({ aliasModelId: "gpt-image-2", targetModelId: GPT_IMAGE_2_MODEL_ID, tier: "1K" })).toBe("1K");
  });

  it("maps gpt-image built-in size presets to 1K/2K/4K tiers", () => {
    expect(gptSizeToResolutionTier("1024x1024")).toBe("1K");
    expect(gptSizeToResolutionTier("1536x1024")).toBe("2K");
    expect(gptSizeToResolutionTier("2048x2048")).toBe("2K");
    expect(gptSizeToResolutionTier("3840x2160")).toBe("4K");
    expect(gptSizeToResolutionTier("auto")).toBeUndefined();
  });

  it("uses explicit tiers in coverage", () => {
    const aliases: ModelAliasEntry[] = [
      { aliasModelId: "gpt-image-2-preview", targetModelId: GPT_IMAGE_2_MODEL_ID, tier: "1K" },
      { aliasModelId: "gpt-image-2-preview-2k", targetModelId: GPT_IMAGE_2_MODEL_ID, tier: "2K" }
    ];
    expect(aliasCoveredSplitResolutionTiers(GPT_IMAGE_2_MODEL_ID, aliases)).toEqual(new Set(["1K", "2K"]));
  });
});
