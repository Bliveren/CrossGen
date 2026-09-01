import { describe, expect, it } from "vitest";
import {
  GPT_IMAGE_2_SIZE_PRESET_GROUPS,
  GPT_IMAGE_2_SIZE_PRESET_VALUES
} from "./imageSizePresets";
import { validateGptImage2Size } from "./validation";

describe("GPT Image 2 size presets", () => {
  it("keeps the requested aspect-ratio and resolution matrix", () => {
    expect(GPT_IMAGE_2_SIZE_PRESET_GROUPS).toEqual([
      { aspectRatio: "1:1", presets: [{ tier: "1K", size: "1024x1024" }, { tier: "2K", size: "2048x2048" }, { tier: "4K", size: "2880x2880" }] },
      { aspectRatio: "3:2", presets: [{ tier: "1K", size: "1536x1024" }, { tier: "2K", size: "2160x1440" }, { tier: "4K", size: "3456x2304" }] },
      { aspectRatio: "2:3", presets: [{ tier: "1K", size: "1024x1536" }, { tier: "2K", size: "1440x2160" }, { tier: "4K", size: "2304x3456" }] },
      { aspectRatio: "16:9", presets: [{ tier: "1K", size: "1280x720" }, { tier: "2K", size: "2560x1440" }, { tier: "4K", size: "3840x2160" }] },
      { aspectRatio: "9:16", presets: [{ tier: "1K", size: "720x1280" }, { tier: "2K", size: "1440x2560" }, { tier: "4K", size: "2160x3840" }] },
      { aspectRatio: "4:3", presets: [{ tier: "1K", size: "1024x768" }, { tier: "2K", size: "2048x1536" }, { tier: "4K", size: "3200x2400" }] },
      { aspectRatio: "3:4", presets: [{ tier: "1K", size: "768x1024" }, { tier: "2K", size: "1536x2048" }, { tier: "4K", size: "2400x3200" }] },
      { aspectRatio: "21:9", presets: [{ tier: "1K", size: "1280x544" }, { tier: "2K", size: "2560x1088" }, { tier: "4K", size: "3840x1600" }] }
    ]);
  });

  it("keeps every preset within the shared custom-size constraints", () => {
    expect(GPT_IMAGE_2_SIZE_PRESET_VALUES).toHaveLength(25);
    for (const size of GPT_IMAGE_2_SIZE_PRESET_VALUES) {
      expect(validateGptImage2Size(size), size).toMatchObject({ ok: true });
    }
  });

  it("accepts inclusive pixel boundaries and rejects each custom-size limit", () => {
    expect(validateGptImage2Size("1024x640").ok).toBe(true);
    expect(validateGptImage2Size("2880x2880").ok).toBe(true);
    expect(validateGptImage2Size("3840x2160").ok).toBe(true);
    expect(validateGptImage2Size("1024x641").ok).toBe(false);
    expect(validateGptImage2Size("3856x2160").ok).toBe(false);
    expect(validateGptImage2Size("3840x1264").ok).toBe(false);
  });
});
