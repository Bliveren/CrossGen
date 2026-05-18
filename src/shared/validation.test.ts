import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PARAMS,
  normalizeBaseURL,
  shouldSendCompression,
  validateGptImage2Size,
  validateImageParams
} from "./validation";

describe("gpt-image-2 validation", () => {
  it("accepts auto and supported popular sizes", () => {
    expect(validateGptImage2Size("auto").ok).toBe(true);
    expect(validateGptImage2Size("1024x1024").ok).toBe(true);
    expect(validateGptImage2Size("1536x1024").ok).toBe(true);
    expect(validateGptImage2Size("3840x2160").ok).toBe(true);
  });

  it("rejects sizes that violate gpt-image-2 constraints", () => {
    expect(validateGptImage2Size("1000x1000").ok).toBe(false);
    expect(validateGptImage2Size("4096x1024").ok).toBe(false);
    expect(validateGptImage2Size("1024x256").ok).toBe(false);
    expect(validateGptImage2Size("512x512").ok).toBe(false);
  });

  it("limits partial images and model choice", () => {
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, partialImages: 3 }).ok).toBe(true);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, partialImages: 4 }).ok).toBe(false);
    expect(validateImageParams({ ...DEFAULT_IMAGE_PARAMS, model: "gpt-image-1.5" }).ok).toBe(false);
  });

  it("normalizes base URLs and compression behavior", () => {
    expect(normalizeBaseURL("https://api.openai.com/v1///")).toBe("https://api.openai.com/v1");
    expect(shouldSendCompression("png")).toBe(false);
    expect(shouldSendCompression("jpeg")).toBe(true);
    expect(shouldSendCompression("webp")).toBe(true);
  });
});
