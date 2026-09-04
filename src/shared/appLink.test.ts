import { describe, expect, it } from "vitest";
import { extractCrossGenAppLinks, parseAppLink } from "./appLink";

describe("CrossGen AppLink", () => {
  const aggregatorFixtures = [
    {
      label: "AIHub-style custom gateway",
      link: "crossgen://provider/import?name=AIHub&kind=custom&base_url=https%3A%2F%2Faihub.example%2Fv1&api_key=sk-aihub-fixture-key&model=flux-pro",
      expected: {
        displayName: "AIHub",
        kind: "custom",
        baseURL: "https://aihub.example/v1",
        defaultModel: "flux-pro",
        activeLaunchId: "general"
      }
    },
    {
      label: "OpenAI-compatible aggregator aliases",
      link: "crossgen://config/import?label=Gateway&provider=openai&endpoint=https%3A%2F%2Fgateway.example%2Fv1&key=sk-gateway-fixture-key&default_model=gpt-image-2",
      expected: {
        displayName: "Gateway",
        kind: "openai",
        baseURL: "https://gateway.example/v1",
        defaultModel: "gpt-image-2",
        activeLaunchId: "gpt-image-2"
      }
    },
    {
      label: "Gemini-compatible aggregator aliases",
      link: "crossgen://api-config?title=Gemini%20Gateway&kind=gemini&baseURL=https%3A%2F%2Fgemini-gateway.example%2Fv1beta&apiKey=gemini-fixture-key-long&model=gemini-3.1-flash-image",
      expected: {
        displayName: "Gemini Gateway",
        kind: "gemini",
        baseURL: "https://gemini-gateway.example/v1beta",
        defaultModel: "gemini-3.1-flash-image",
        activeLaunchId: "nano-banana-3"
      }
    }
  ] as const;

  it.each(aggregatorFixtures)("accepts the $label fixture", ({ link, expected }) => {
    const result = parseAppLink(link);
    expect(result).toMatchObject(expected);
    expect(result.apiKey).toBeDefined();
    expect(result.apiKeyPreview).not.toContain("fixture-key");
    expect(result.apiKeyPreview).toContain("*");
  });

  it("parses the canonical provider import link", () => {
    const result = parseAppLink(
      "crossgen://provider/import?name=AIHub&kind=custom&base_url=https%3A%2F%2Fapi.example.com%2Fv1&api_key=sk-test-key-that-is-long-enough&model=flux-pro"
    );
    expect(result).toMatchObject({
      source: "applink",
      name: "AIHub",
      kind: "custom",
      baseURL: "https://api.example.com/v1",
      defaultModel: "flux-pro",
      activeLaunchId: "general",
      activeModelId: "flux-pro"
    });
    expect(result.apiKey).toBe("sk-test-key-that-is-long-enough");
    expect(result.apiKeyPreview).toBe("sk-t************ough");
  });

  it("accepts common aliases and infers focused launches", () => {
    const result = parseAppLink(
      "crossgen://api-config?provider=openai&baseURL=https%3A%2F%2Fgateway.example%2Fv1&apiKey=sk-another-long-key&defaultModel=gpt-image-2"
    );
    expect(result.kind).toBe("openai");
    expect(result.activeLaunchId).toBe("gpt-image-2");
    expect(result.defaultModel).toBe("gpt-image-2");
  });

  it("routes non-focused OpenAI-compatible models through General", () => {
    const result = parseAppLink(
      "crossgen://provider/import?provider=openai&base_url=https%3A%2F%2Fgateway.example%2Fv1&api_key=sk-another-long-key&defaultModel=dall-e-3"
    );
    expect(result.activeLaunchId).toBe("general");
    expect(result.activeModelId).toBe("dall-e-3");
  });

  it("rejects unsupported schemes, targets, and unsafe base urls", () => {
    expect(() => parseAppLink("https://provider/import?base_url=https%3A%2F%2Fexample.com&api_key=sk-long-key")).toThrow();
    expect(() => parseAppLink("crossgen://unknown/import?base_url=https%3A%2F%2Fexample.com&api_key=sk-long-key")).toThrow();
    expect(() => parseAppLink("crossgen://provider/import?base_url=file%3A%2F%2F%2Ftmp&api_key=sk-long-key-that-is-long-enough")).toThrow();
    expect(() => parseAppLink("crossgen://provider/import?base_url=http%3A%2F%2Fgateway.example.com%2Fv1&api_key=sk-long-key-that-is-long-enough")).toThrow();
    expect(parseAppLink("crossgen://provider/import?base_url=http%3A%2F%2F127.0.0.1%3A8788%2Fv1&api_key=sk-long-key-that-is-long-enough")).toMatchObject({
      baseURL: "http://127.0.0.1:8788/v1"
    });
    expect(() => parseAppLink(
      "crossgen://provider/import?base_url=https%3A%2F%2Fexample.com&api_key=sk-long-key-%0A-that-is-long-enough"
    )).toThrow(/控制字符/);
  });

  it("extracts only CrossGen links from process arguments", () => {
    expect(extractCrossGenAppLinks(["--flag", "crossgen://config/import?base_url=https%3A%2F%2Fexample.com&api_key=sk-long-key"])).toEqual([
      "crossgen://config/import?base_url=https%3A%2F%2Fexample.com&api_key=sk-long-key"
    ]);
  });
});
