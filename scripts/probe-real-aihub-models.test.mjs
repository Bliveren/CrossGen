import { describe, expect, it } from "vitest";
import {
  aggregateTargetProbe,
  canonicalModelId,
  classifyModelProbe,
  confirmedProviderImageModelIds,
  isGptImage25LaunchAlias,
  isGptImage2ProviderModelId,
  isGptImage25ProviderModelId,
  isModelNotFoundPayload,
  metadataPayloadModelIdMatch,
  modelFamily,
  providerModelIdsForTarget,
  targetFamily
} from "./probe-real-aihub-models.mjs";

describe("real AIHub model probe classification", () => {
  it("normalizes provider resource prefixes without treating the legacy alias as provider evidence", () => {
    expect(canonicalModelId("Models/GPT-IMAGE-2.5")).toBe("gpt-image-2.5");
    expect(isGptImage25LaunchAlias("Models/GPT-IMAGE-2.5")).toBe(true);
    expect(isGptImage25ProviderModelId("Models/GPT-IMAGE-2.5")).toBe(false);
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["Models/GPT-IMAGE-2.5"],
      { ok: true, status: 200, payload: { id: "GPT-IMAGE-2.5" } }
    )).toMatchObject({
      family: null,
      exactIdMatch: true,
      listed: true,
      listedAs: "Models/GPT-IMAGE-2.5",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("keeps GPT Image 2 and GPT Image 2.5 in separate families", () => {
    expect(modelFamily("gpt-image-2")).toBe("gpt-image-2");
    expect(isGptImage2ProviderModelId("gpt-image-2-2026-04-21")).toBe(true);
    expect(modelFamily("gpt-image-2-2026-04-21")).toBe("gpt-image-2");
    expect(isGptImage2ProviderModelId("gpt-image-2-2026-02-29")).toBe(false);
    expect(isGptImage2ProviderModelId("gpt-image-2.5")).toBe(false);
    expect(modelFamily("gpt-image-2.5")).toBeNull();
    expect(modelFamily("gpt-image-2.5-sunburst-2026-09-08")).toBe("gpt-image-2.5");
    expect(modelFamily("gpt-image-2.5-sunburst-2026-09-31")).toBeNull();
    expect(modelFamily("gpt-image-2.50")).toBeNull();
    expect(targetFamily("gpt-image-2.5")).toBe("gpt-image-2.5");
  });

  it("allows a valid GPT Image 2 snapshot to become launch evidence", () => {
    expect(providerModelIdsForTarget("gpt-image-2", [
      "gpt-image-2-2026-04-21",
      "gpt-image-2-2026-02-29",
      "gpt-image-2.5-sunburst"
    ])).toEqual([
      "gpt-image-2",
      "gpt-image-2-2026-04-21"
    ]);

    expect(classifyModelProbe(
      "gpt-image-2-2026-04-21",
      ["gpt-image-2-2026-04-21"],
      {
        ok: true,
        status: 200,
        payload: { id: "gpt-image-2-2026-04-21" }
      }
    )).toMatchObject({
      family: "gpt-image-2",
      exactIdMatch: true,
      availability: "confirmed",
      eligibleForLaunch: true
    });
  });

  it("maps the Nano Banana launch alias to real Gemini provider model ids", () => {
    expect(modelFamily("gemini-3.1-flash-image")).toBe("nano-banana-3");
    expect(modelFamily("gemini-3.1-flash-lite-image")).toBe("nano-banana-3");
    expect(modelFamily("gemini-3-pro-image")).toBe("nano-banana-3");
    expect(providerModelIdsForTarget("nano-banana-3", [
      "gemini-3.1-flash-image",
      "gemini-3-pro-image"
    ])).toEqual([
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-lite-image",
      "gemini-3-pro-image",
    ]);
  });

  it("keeps GPT Image 2.5 variants isolated during target aggregation", () => {
    expect(providerModelIdsForTarget("gpt-image-2.5-sunburst", [
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst-2026-09-08",
      "gpt-image-2.5-sunburst-2026-09-31"
    ])).toEqual([
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-sunburst-2026-09-08"
    ]);
    expect(providerModelIdsForTarget("gpt-image-2.5-flare", [
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-flare-2026-09-08"
    ])).toEqual([
      "gpt-image-2.5-flare",
      "gpt-image-2.5-flare-2026-09-08"
    ]);
  });

  it("does not enable a listed model when its metadata endpoint rejects the id without route evidence", () => {
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2.5"],
      {
        ok: true,
        status: 200,
        payload: {
          error: {
            code: "model_not_found",
            message: "The model 'gpt-image-2.5' does not exist"
          }
        }
      }
    )).toMatchObject({
      exactIdMatch: true,
      listed: true,
      metadataStatus: "listed-but-metadata-rejected",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("recognizes message-only model-not-found responses with hyphenated ids", () => {
    expect(isModelNotFoundPayload({
      error: {
        message: "The model 'gpt-image-2.5' does not exist"
      }
    })).toBe(true);
  });

  it("recognizes provider messages that say the model was not found", () => {
    expect(isModelNotFoundPayload({
      error: {
        message: "The model 'gpt-image-2' was not found"
      }
    })).toBe(true);
  });

  it("does not turn metadata-only evidence into a launch option", () => {
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2"],
      { ok: true, status: 200, payload: { id: "gpt-image-2.5" } }
    )).toMatchObject({
      family: null,
      exactIdMatch: false,
      listed: false,
      metadataStatus: "metadata-confirmed-not-listed",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("requires metadata to echo the exact requested model id", () => {
    expect(metadataPayloadModelIdMatch(
      { id: "models/gpt-image-2.5" },
      "gpt-image-2.5"
    )).toBe("matched");
    expect(metadataPayloadModelIdMatch(
      { data: { id: "gpt-image-2" } },
      "gpt-image-2.5"
    )).toBe("mismatched");

    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2.5"],
      { ok: true, status: 200, payload: { id: "gpt-image-2" } }
    )).toMatchObject({
      exactIdMatch: true,
      listed: true,
      metadataMatch: "mismatched",
      metadataStatus: "listed-but-metadata-mismatch",
      availability: "rejected",
      eligibleForLaunch: false
    });
  });

  it("does not treat OpenAI-compatible display names or resource names as ids", () => {
    expect(metadataPayloadModelIdMatch(
      { display_name: "GPT Image 2.5" },
      "gpt-image-2.5"
    )).toBe("missing");
    expect(metadataPayloadModelIdMatch(
      { name: "models/gpt-image-2.5" },
      "gpt-image-2.5"
    )).toBe("missing");
    expect(metadataPayloadModelIdMatch(
      { display_name: "GPT Image 2.5", id: "gpt-image-2" },
      "gpt-image-2.5"
    )).toBe("mismatched");
  });

  it("keeps successful metadata without an echoed model id inconclusive", () => {
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2.5"],
      { ok: true, status: 200, payload: { object: "model" } }
    )).toMatchObject({
      exactIdMatch: true,
      metadataMatch: "missing",
      metadataStatus: "listed-but-metadata-unverified",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("reports an unlisted model_not_found response as not listed", () => {
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2"],
      {
        ok: true,
        status: 200,
        payload: {
          error: {
            code: "model_not_found",
            message: "The model 'gpt-image-2.5' does not exist"
          }
        }
      }
    )).toMatchObject({
      exactIdMatch: false,
      listed: false,
      metadataStatus: "not-listed",
      availability: "not-listed",
      eligibleForLaunch: false
    });
  });

  it("keeps ordinary HTTP metadata failures inconclusive", () => {
    expect(classifyModelProbe(
      "gpt-image-2",
      ["gpt-image-2"],
      { ok: false, status: 404, payload: { message: "route unavailable" } }
    )).toMatchObject({
      exactIdMatch: true,
      metadataStatus: "metadata-rejected",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2"],
      { ok: false, status: 503, payload: { message: "upstream unavailable" } }
    )).toMatchObject({
      exactIdMatch: false,
      metadataStatus: "metadata-rejected",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("does not confuse a missing metadata route with a rejected model", () => {
    expect(classifyModelProbe(
      "gpt-image-2",
      ["gpt-image-2"],
      {
        ok: false,
        status: 404,
        payload: { message: "model endpoint not found" }
      }
    )).toMatchObject({
      exactIdMatch: true,
      metadataStatus: "metadata-rejected",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("always returns a boolean launch decision for incomplete probe responses", () => {
    expect(classifyModelProbe("gpt-image-2", ["gpt-image-2"], {})).toMatchObject({
      exactIdMatch: true,
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("does not treat an HTTP 200 error payload as metadata confirmation", () => {
    expect(classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2.5"],
      {
        ok: true,
        status: 200,
        payload: {
          error: {
            code: "permission_denied",
            message: "model access is not enabled"
          }
        }
      }
    )).toMatchObject({
      exactIdMatch: true,
      errorPayload: true,
      metadataStatus: "listed-but-metadata-error",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("keeps string-form metadata errors inconclusive instead of confirming or rejecting the route", () => {
    expect(classifyModelProbe(
      "gpt-image-2",
      ["gpt-image-2"],
      {
        ok: true,
        status: 200,
        payload: { error: "model_not_found" }
      }
    )).toMatchObject({
      exactIdMatch: true,
      errorPayload: true,
      metadataStatus: "listed-but-metadata-rejected",
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("aggregates Nano Banana support from a listed Gemini provider model", () => {
    const result = aggregateTargetProbe(
      "nano-banana-3",
      ["gemini-3.1-flash-image"],
      {
        "gemini-3.1-flash-image": {
          ok: true,
          status: 200,
          payload: { id: "gemini-3.1-flash-image" }
        },
        "gemini-3.1-flash-lite-image": {
          ok: true,
          status: 200,
          payload: { error: { code: "model_not_found" } }
        },
        "gemini-3-pro-image": {
          ok: true,
          status: 200,
          payload: { error: { code: "model_not_found" } }
        },
        "nano-banana-3": {
          ok: true,
          status: 200,
          payload: { error: { code: "model_not_found" } }
        }
      }
    );

    expect(result).toMatchObject({
      family: "nano-banana-3",
      listed: true,
      matchedProviderModelIds: ["gemini-3.1-flash-image"],
      availability: "confirmed",
      eligibleForLaunch: true
    });
  });

  it("reports Nano Banana as listed but inconclusive when the gateway rejects metadata", () => {
    const result = aggregateTargetProbe(
      "nano-banana-3",
      ["gemini-3.1-flash-image"],
      {
        "gemini-3.1-flash-image": {
          ok: true,
          status: 200,
          payload: { error: { code: "model_not_found" } }
        }
      }
    );

    expect(result).toMatchObject({
      listed: true,
      matchedProviderModelIds: ["gemini-3.1-flash-image"],
      availability: "inconclusive",
      eligibleForLaunch: false
    });
  });

  it("does not confuse the GPT Image 2 family with GPT Image 2.5 in summaries", () => {
    const image2 = classifyModelProbe(
      "gpt-image-2",
      ["gpt-image-2"],
      { ok: true, status: 200, payload: { id: "gpt-image-2" } }
    );
    const image25 = classifyModelProbe(
      "gpt-image-2.5",
      ["gpt-image-2"],
      {
        ok: true,
        status: 200,
        payload: { error: { code: "model_not_found", message: "not found" } }
      }
    );

    expect(image2.family).toBe("gpt-image-2");
    expect(image25.family).toBeNull();
    expect(image2.eligibleForLaunch).toBe(true);
    expect(image25.eligibleForLaunch).toBe(false);
  });

  it("exposes only confirmed exact provider ids as launchable image models", () => {
    const targetProbes = {
      "gpt-image-2": aggregateTargetProbe(
        "gpt-image-2",
        ["gpt-image-2"],
        {
          "gpt-image-2": {
            ok: true,
            status: 200,
            payload: { id: "gpt-image-2" }
          }
        }
      ),
      "gpt-image-2.5": aggregateTargetProbe(
        "gpt-image-2.5",
        ["gpt-image-2"],
        {
          "gpt-image-2.5": {
            ok: true,
            status: 200,
            payload: { error: { code: "model_not_found" } }
          }
        }
      ),
      "nano-banana-3": aggregateTargetProbe(
        "nano-banana-3",
        ["gemini-3.1-flash-image", "nano-banana-3"],
        {
          "gemini-3.1-flash-image": {
            ok: true,
            status: 200,
            payload: { id: "gemini-3.1-flash-image" }
          },
          "nano-banana-3": {
            ok: true,
            status: 200,
            payload: { id: "nano-banana-3" }
          }
        }
      )
    };

    expect(confirmedProviderImageModelIds(targetProbes)).toEqual([
      "gpt-image-2",
      "gemini-3.1-flash-image"
    ]);
  });

  it("does not treat listed or metadata-only GPT Image 2.5 ids as launchable", () => {
    const targetProbes = {
      "gpt-image-2.5": aggregateTargetProbe(
        "gpt-image-2.5",
        ["gpt-image-2.5-sunburst"],
        {
          "gpt-image-2.5-sunburst": {
            ok: true,
            status: 200,
            payload: { object: "model" }
          }
        }
      )
    };

    expect(targetProbes["gpt-image-2.5"].listed).toBe(true);
    expect(targetProbes["gpt-image-2.5"].eligibleForLaunch).toBe(false);
    expect(confirmedProviderImageModelIds(targetProbes)).toEqual([]);
  });
});
