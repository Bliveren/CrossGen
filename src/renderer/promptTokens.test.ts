import { describe, expect, it } from "vitest";
import type { InputAsset } from "../shared/types";
import { normalizeHexColor, serializePromptTokens, type PromptToken } from "./promptTokens";

const asset: InputAsset = {
  id: "asset-1",
  name: "reference.png",
  path: "/tmp/gallery/reference.png",
  mimeType: "image/png",
  sizeBytes: 1024
};

describe("prompt token serialization", () => {
  it("serializes empty token lists without failing", () => {
    expect(serializePromptTokens([], { resolveAsset: () => undefined })).toEqual({
      prompt: "",
      inputAssets: []
    });
  });

  it("keeps plain text unchanged", () => {
    expect(serializePromptTokens([{ type: "text", text: "  A clean product photo\nwith spacing  " }], { resolveAsset: () => undefined })).toEqual({
      prompt: "  A clean product photo\nwith spacing  ",
      inputAssets: []
    });
  });

  it("serializes asset, color, and template tokens", () => {
    const tokens: PromptToken[] = [
      { type: "text", text: "Product shot" },
      { type: "asset", galleryAssetId: "gallery-1", label: "reference.png" },
      { type: "color", value: "#0f6" },
      { type: "template", templateId: "template-1", title: "Studio", body: "softbox lighting" }
    ];

    expect(serializePromptTokens(tokens, { resolveAsset: () => asset })).toEqual({
      prompt: "Product shot\n\n#0F6\n\nsoftbox lighting",
      inputAssets: [asset]
    });
  });

  it("ignores malformed tokens and duplicate assets", () => {
    const tokens: PromptToken[] = [
      { type: "asset", galleryAssetId: "gallery-1", label: "reference.png" },
      { type: "asset", galleryAssetId: "gallery-1", label: "reference.png" },
      { type: "color", value: "blue" },
      { type: "template", templateId: "empty", title: "Empty", body: "   " },
      { type: "text", text: "" }
    ];

    expect(serializePromptTokens(tokens, { resolveAsset: () => asset })).toEqual({
      prompt: "",
      inputAssets: [asset]
    });
  });

  it("normalizes only valid hex colors", () => {
    expect(normalizeHexColor("#abc")).toBe("#ABC");
    expect(normalizeHexColor("#A1B2C3")).toBe("#A1B2C3");
    expect(normalizeHexColor("abc")).toBeNull();
    expect(normalizeHexColor("#abcd")).toBeNull();
  });
});
