import { describe, expect, it } from "vitest";
import type { RunJobRequest } from "../shared/types";
import { DEFAULT_GENERAL_IMAGE_PARAMS, DEFAULT_IMAGE_PARAMS } from "../shared/validation";
import {
  buildTaskDiagnostic,
  MASK_GUIDED_EDIT_COMPATIBILITY_MESSAGE,
  queueErrorCategoryForTaskDiagnostic,
  ROUTE_UNVERIFIED_DEFAULT_MESSAGE,
  taskDiagnosticCategoryForQueueError,
  taskOperationForRequest
} from "./providerDiagnostics";

function request(patch: Partial<RunJobRequest> = {}): RunJobRequest {
  return {
    mode: "generate",
    prompt: "Render a product shot",
    inputPaths: [],
    params: {
      ...DEFAULT_IMAGE_PARAMS,
      imageRoute: "auto",
      timeoutMs: 60000
    },
    ...patch
  };
}

describe("provider diagnostics", () => {
  it("classifies metadata-only OpenAI-compatible responses as provider_empty_output", () => {
    const diagnostic = buildTaskDiagnostic({
      request: request({
        mode: "edit",
        inputPaths: ["/tmp/source.png"]
      }),
      providerKind: "openai",
      baseURL: "https://gateway.test/v1",
      route: "image-api",
      attemptIndex: 2,
      error: "OpenAI API 没有返回可保存的图片。响应摘要：顶层字段：model,data,usage,extra_fields；data 类型：null；usage 字段：num_input_images；输入图片数：1"
    });

    expect(diagnostic).toMatchObject({
      category: "provider_empty_output",
      operation: "image-to-image",
      providerKind: "openai-compatible",
      route: "image-api",
      inputImageCount: 1,
      attemptIndex: 2,
      retryable: false,
      chargedRetryRisk: true
    });
    expect(diagnostic.nextActions.join("\n")).toContain("文生图成功不代表图生图");
    expect(queueErrorCategoryForTaskDiagnostic(diagnostic.category)).toBe("unsupported");
  });

  it("classifies billing, timeout, user cancel, and network terminated separately", () => {
    expect(buildTaskDiagnostic({
      request: request(),
      providerKind: "openai",
      error: 'OpenAI API 请求失败：provider API error: {"error":"余额不足"}'
    }).category).toBe("billing");

    expect(buildTaskDiagnostic({
      request: request(),
      providerKind: "openai",
      error: "请求超时，请稍后重试或调高超时时间。"
    }).category).toBe("timeout");

    expect(buildTaskDiagnostic({
      request: request(),
      providerKind: "openai",
      userCancelled: true,
      error: "AbortError: The operation was aborted"
    }).category).toBe("cancelled");

    expect(buildTaskDiagnostic({
      request: request(),
      providerKind: "openai",
      error: "image[]: terminated；image: terminated"
    }).category).toBe("network");
  });

  it("classifies unsupported reference and mask capability before provider calls", () => {
    const referenceDiagnostic = buildTaskDiagnostic({
      request: request({
        mode: "edit",
        inputPaths: ["/tmp/source.png"],
        params: {
          ...DEFAULT_GENERAL_IMAGE_PARAMS,
          providerKind: "custom",
          model: "custom-image-model",
          timeoutMs: 60000
        }
      }),
      providerKind: "custom",
      error: "General 首期不支持局部重绘。"
    });

    expect(referenceDiagnostic.category).toBe("unsupported_capability");
    expect(referenceDiagnostic.operation).toBe("image-to-image");

    const maskDiagnostic = buildTaskDiagnostic({
      request: request({
        mode: "inpaint",
        inputPaths: ["/tmp/source.png"],
        maskPath: "/tmp/mask.png"
      }),
      providerKind: "openai",
      route: "image-api",
      error: "Mask format must match the first source image."
    });

    expect(maskDiagnostic).toMatchObject({
      category: "unsupported_capability",
      operation: "guided-region",
      hasMask: true
    });
    expect(maskDiagnostic.nextActions.join("\n")).toContain(MASK_GUIDED_EDIT_COMPATIBILITY_MESSAGE);
  });

  it("adds an unverified default-route note when route probes do not verify the fallback", () => {
    const diagnostic = buildTaskDiagnostic({
      request: request({
        mode: "edit",
        inputPaths: ["/tmp/source.png"]
      }),
      providerKind: "openai",
      baseURL: "https://gateway.test/v1",
      route: "chat-completions",
      routeVerified: false,
      error: "OpenAI API 请求失败：HTTP 500."
    });

    expect(diagnostic.routeVerified).toBe(false);
    expect(diagnostic.routeNote).toBe(ROUTE_UNVERIFIED_DEFAULT_MESSAGE);
    expect(diagnostic.nextActions).toContain(ROUTE_UNVERIFIED_DEFAULT_MESSAGE);
  });

  it("keeps legacy queue category mapping explicit", () => {
    expect(taskDiagnosticCategoryForQueueError("quota")).toBe("billing");
    expect(taskDiagnosticCategoryForQueueError("unsupported")).toBe("unsupported_capability");
    expect(queueErrorCategoryForTaskDiagnostic("route_unsupported")).toBe("unsupported");
    expect(queueErrorCategoryForTaskDiagnostic("rate_limit")).toBe("quota");
  });

  it("resolves user-facing operations from work modes", () => {
    expect(taskOperationForRequest(request({ mode: "generate" }))).toBe("text-to-image");
    expect(taskOperationForRequest(request({ mode: "edit", inputPaths: ["/tmp/source.png"] }))).toBe("image-to-image");
    expect(taskOperationForRequest(request({ mode: "inpaint", inputPaths: ["/tmp/source.png"], maskPath: "/tmp/mask.png" }))).toBe("guided-region");
  });
});
