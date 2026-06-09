import { describe, expect, it } from "vitest";
import type { RunJobRequest } from "../../shared/types";
import { DEFAULT_GEMINI_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS } from "../../shared/validation";
import { getImageProviderAdapter, getImageProviderAdapterForRequest, unsupportedImageProviderMessage } from "./imageProviderAdapters";
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

  it("leaves Gemini and Custom unsupported until adapters are registered", () => {
    expect(getImageProviderAdapter("gemini")).toBeUndefined();
    expect(getImageProviderAdapter("custom")).toBeUndefined();
    expect(getImageProviderAdapterForRequest(request(DEFAULT_GEMINI_IMAGE_PARAMS))).toBeUndefined();
    expect(unsupportedImageProviderMessage()).toBe("当前版本尚未接入该模型运行时。");
  });
});
