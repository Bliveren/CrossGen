import { describe, expect, it } from "vitest";
import {
  GENERAL_LAUNCH_ID,
  GEMINI_3_PRO_IMAGE_MODEL_ID,
  GPT_IMAGE_2_LAUNCH_ID,
  NANO_BANANA_3_LAUNCH_ID,
  NANO_BANANA_3_MODEL_ID
} from "../shared/modelCatalog";
import type { ProviderConfig } from "../shared/types";
import { capabilityContractForFocusedModel, capabilitySummaryForDiscoveredModel, listProviderModelCapabilitySummaries } from "./modelCapabilities";
import { getFocusedModelDefinition } from "../shared/modelCatalog";

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  const now = "2026-07-13T00:00:00.000Z";
  return {
    id: "provider-openai",
    kind: "openai",
    name: "OpenAI",
    apiKeySaved: true,
    baseURL: "https://api.openai.com/v1",
    enabled: true,
    defaultModel: "gpt-image-2",
    defaultSize: "1024x1024",
    defaultQuality: "auto",
    timeoutMs: 120000,
    streamingPartialsEnabled: false,
    discoveredModels: [],
    activeLaunchId: GPT_IMAGE_2_LAUNCH_ID,
    activeModelId: "gpt-image-2",
    updatedAt: now,
    ...patch
  };
}

describe("model capability contracts", () => {
  it("marks GPT Image 2 as verified image-only OpenAI image capability", () => {
    const definition = getFocusedModelDefinition(GPT_IMAGE_2_LAUNCH_ID);
    expect(definition).toBeDefined();

    const contract = capabilityContractForFocusedModel(definition!);

    expect(contract).toMatchObject({
      generate: true,
      edit: true,
      inpaint: "exact-mask",
      referenceImages: true,
      streamingPartials: true,
      asyncJob: false,
      mediaKinds: ["image"],
      outputAssetKinds: ["image"],
      animatedGif: false,
      video: false,
      videoRouteStrategy: "none",
      contract: "openai-image",
      confidence: "verified"
    });
  });

  it("marks Nano Banana 3 as verified Gemini image-only capability", () => {
    const definition = getFocusedModelDefinition(NANO_BANANA_3_LAUNCH_ID);
    expect(definition).toBeDefined();

    const contract = capabilityContractForFocusedModel(definition!);

    expect(contract).toMatchObject({
      generate: true,
      edit: true,
      inpaint: "guided-region",
      referenceImages: true,
      streamingPartials: false,
      outputText: true,
      mediaKinds: ["image"],
      animatedGif: false,
      video: false,
      contract: "gemini-generate-content",
      confidence: "verified"
    });
  });

  it("keeps General fallback prompt-only for agents", () => {
    const definition = getFocusedModelDefinition(GENERAL_LAUNCH_ID);
    expect(definition).toBeDefined();

    const contract = capabilityContractForFocusedModel(definition!);

    expect(contract).toMatchObject({
      generate: true,
      edit: false,
      inpaint: false,
      referenceImages: false,
      maxReferenceImages: 0,
      mediaKinds: ["image"],
      animatedGif: false,
      video: false,
      contract: "openai-compatible-minimal",
      confidence: "assumed"
    });
  });

  it("reports discovered image-like models conservatively", () => {
    const discovered = capabilitySummaryForDiscoveredModel("custom-provider", {
      id: "flux-pro",
      providerKind: "custom",
      displayName: "Flux Pro"
    });

    expect(discovered).toMatchObject({
      providerId: "custom-provider",
      source: "discovered",
      capabilities: {
        generate: true,
        edit: false,
        referenceImages: false,
        contract: "openai-compatible-minimal",
        confidence: "discovered",
        video: false,
        animatedGif: false
      }
    });
  });

  it("lists provider focused, active general, and discovered capabilities without duplicates", () => {
    const summaries = listProviderModelCapabilitySummaries(
      provider({
        activeLaunchId: GENERAL_LAUNCH_ID,
        activeModelId: "dall-e-3",
        discoveredModels: [
          { id: "gpt-image-2", providerKind: "openai" },
          { id: "dall-e-3", providerKind: "openai" },
          { id: "text-only", providerKind: "openai" }
        ]
      })
    );

    expect(summaries.map((summary) => summary.modelId)).toEqual(["gpt-image-2", "general", "dall-e-3", "text-only"]);
    expect(summaries.find((summary) => summary.modelId === "text-only")?.capabilities.confidence).toBe("unknown");
    expect(summaries.find((summary) => summary.modelId === "dall-e-3")?.capabilities).toMatchObject({
      generate: true,
      edit: false,
      confidence: "discovered"
    });
  });

  it("keeps shared-launch Gemini models selectable with unique keys", () => {
    const summaries = listProviderModelCapabilitySummaries(
      provider({
        id: "provider-gemini",
        kind: "gemini",
        name: "Gemini",
        defaultModel: NANO_BANANA_3_MODEL_ID,
        activeLaunchId: NANO_BANANA_3_LAUNCH_ID,
        activeModelId: NANO_BANANA_3_MODEL_ID,
        discoveredModels: [
          { id: GEMINI_3_PRO_IMAGE_MODEL_ID, providerKind: "gemini" }
        ]
      })
    );

    const nanoModels = summaries.filter((summary) => summary.launchId === NANO_BANANA_3_LAUNCH_ID);
    expect(nanoModels.map((summary) => summary.modelId)).toEqual([NANO_BANANA_3_MODEL_ID, GEMINI_3_PRO_IMAGE_MODEL_ID]);
    expect(nanoModels.map((summary) => summary.selectionKey)).toEqual([
      `${NANO_BANANA_3_LAUNCH_ID}:${NANO_BANANA_3_MODEL_ID}`,
      `${NANO_BANANA_3_LAUNCH_ID}:${GEMINI_3_PRO_IMAGE_MODEL_ID}`
    ]);
    expect(new Set(nanoModels.map((summary) => summary.selectionKey)).size).toBe(nanoModels.length);
  });
});
