import { describe, expect, it } from "vitest";
import type { RunJobRequest } from "../../shared/types";
import { DEFAULT_GENERAL_IMAGE_PARAMS, DEFAULT_GEMINI_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import { generalImageAdapter } from "./generalImageAdapter";
import { getImageProviderAdapter, getImageProviderAdapterForRequest, unsupportedImageProviderMessage } from "./imageProviderAdapters";
import { geminiImageAdapter } from "./geminiImageAdapter";
import { openaiImageAdapter } from "./openaiImageAdapter";

function request(params: RunJobRequest["params"] = DEFAULT_IMAGE_PARAMS): RunJobRequest {
  return {
    mode: "generate",
    prompt: "Prompt",
    inputPaths: [],
    params
  };
}

describe("image provider adapter registry", () => {
  it("dispatches OpenAI requests to the OpenAI adapter", () => {
    expect(getImageProviderAdapter("openai")).toBe(openaiImageAdapter);
    expect(getImageProviderAdapterForRequest(request())).toBe(openaiImageAdapter);
  });

  it("dispatches Gemini requests to the Gemini adapter", () => {
    expect(getImageProviderAdapter("gemini")).toBe(geminiImageAdapter);
    expect(getImageProviderAdapterForRequest(request(DEFAULT_GEMINI_IMAGE_PARAMS))).toBe(geminiImageAdapter);
  });

  it("leaves Custom unsupported until an adapter is registered", () => {
    expect(getImageProviderAdapter("custom")).toBeUndefined();
    expect(unsupportedImageProviderMessage()).toBe("当前版本尚未接入该模型运行时。");
  });

  it("dispatches General launch requests to the General fallback adapter", () => {
    expect(
      getImageProviderAdapterForRequest(
        request({
          ...DEFAULT_GENERAL_IMAGE_PARAMS,
          providerKind: "openai",
          model: "dall-e-3"
        })
      )
    ).toBe(generalImageAdapter);
  });
});
