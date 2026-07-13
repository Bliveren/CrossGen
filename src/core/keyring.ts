import type { ProviderKind } from "../shared/types.js";

export type KeySource = "env-provider" | "env-generic" | "saved-safeStorage" | "saved-localFallback" | "none";

export interface ResolvedProviderKey {
  value: string;
  source: KeySource;
}

export interface ProviderKeyResolver {
  canReadSavedKeys: boolean;
  resolveProviderKey(providerId: string, providerKind: ProviderKind): Promise<ResolvedProviderKey | null>;
}

export function getProviderEnvKeyNames(providerKind: ProviderKind): string[] {
  if (providerKind === "gemini") return ["CROSSGEN_GEMINI_API_KEY", "CROSSGEN_API_KEY"];
  if (providerKind === "custom") return ["CROSSGEN_CUSTOM_API_KEY", "CROSSGEN_API_KEY"];
  return ["CROSSGEN_OPENAI_API_KEY", "CROSSGEN_API_KEY"];
}

export function describeKeySource(source: KeySource): string {
  switch (source) {
    case "env-provider":
      return "provider-env";
    case "env-generic":
      return "generic-env";
    case "saved-safeStorage":
      return "saved-safeStorage";
    case "saved-localFallback":
      return "saved-localFallback";
    default:
      return "none";
  }
}
