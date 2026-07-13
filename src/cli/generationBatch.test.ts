import { describe, expect, it } from "vitest";
import { parseGenerationPromptFile } from "./generationBatch";

describe("generation prompt file parser", () => {
  it("parses plain prompt lines and JSONL prompt objects", () => {
    const entries = parseGenerationPromptFile(`
# comment
yellow product poster
{"prompt":"blue hero image","model":"gpt-image-2","provider":"provider-1","idempotency_key":"idem-2","timeout_ms":"30000","max_attempts":2,"aspect_ratio":"1:1"}
`);

    expect(entries).toEqual([
      { line: 3, prompt: "yellow product poster" },
      {
        line: 4,
        prompt: "blue hero image",
        providerId: "provider-1",
        model: "gpt-image-2",
        idempotencyKey: "idem-2",
        timeoutMs: 30000,
        maxAttempts: 2,
        aspectRatio: "1:1"
      }
    ]);
  });

  it("rejects invalid JSONL records with line numbers", () => {
    expect(() => parseGenerationPromptFile('{"model":"gpt-image-2"}')).toThrow("Line 1 is missing required string field prompt.");
    expect(() => parseGenerationPromptFile('{"prompt":"ok","timeout_ms":"soon"}')).toThrow("timeout_ms must be a positive integer.");
    expect(() => parseGenerationPromptFile("\n# no prompts\n")).toThrow("Prompt file does not contain any prompts.");
  });
});
