# Service Cleanup Phase 4 Notes

Captured: 2026-07-08
Updated: 2026-07-09

Phase 4 is intentionally behavior-preserving. It reduces repeated main-process Gallery mutation tails and removes one import shim that no longer needs to exist.

## Changes

- Added `readGalleryMutationState()` for Gallery mutations that must start from a disk-reconciled state.
- Added `commitGalleryMutationState()` for the repeated `writeState(...)` plus `sendGalleryEvent(..., "mutation")` tail.
- Converted Gallery create, rename, delete, import, add, replace, update, move, and remove handlers to use those helpers while preserving existing file-system side-effect order.
- Updated direct imports to `openaiImageAdapter.js` and removed the `openaiImage.ts` re-export shim.

## Adapter Interface Review

`ImageProviderAdapter.discoverModels` and `ImageProviderAdapter.testConnection` are retained.

Reasons:

- OpenAI and Gemini adapters still provide tested implementations.
- The adapter registry tests assert provider adapter identity and request routing.
- Runtime model discovery currently uses `modelDiscovery.ts`, so removing adapter methods would be an interface refactor rather than a zero-risk deletion.
- The custom/general adapter still returns explicit unsupported test-connection behavior, which is part of the current contract.

## Validation Coverage

Relevant existing tests:

- `src/main/services/modelDiscovery.test.ts`
- `src/main/services/imageProviderAdapters.test.ts`
- `src/main/services/openaiImage.test.ts`
- `src/main/services/geminiImageAdapter.test.ts`
- renderer smoke tests for Gallery mutation flows

No public provider contract or runtime behavior is intentionally changed in this phase.

## 2026-07-09 Slice C: Provider Service Cleanup

This closeout slice kept the provider public contract unchanged and only consolidated behavior that is shared across provider HTTP response handling.

### Cleaned Up

- Added `src/main/services/providerHttp.ts` as a narrow helper for provider API error parsing, request id extraction, JSON model-response content-type handling, and common secret redaction.
- Updated OpenAI, Gemini, and runtime model discovery error paths to use the shared API error helper while keeping each call site's existing message prefix and fallback text.
- Updated OpenAI and Gemini adapter model-list readers to use the shared JSON model-response helper for `Content-Type` validation and invalid-JSON messages.
- Reused shared `firstString`, `optionalString`, and `isRecord` helpers where the service files were carrying identical local copies.
- Added targeted adapter tests for OpenAI error request ids and Gemini `x-goog-request-id` preservation.

### Retained / Not Changed

- `ImageProviderAdapter.discoverModels` and `ImageProviderAdapter.testConnection` remain part of the adapter contract.
- OpenAI request id behavior remains `x-request-id`; Gemini adapter request id behavior remains `x-request-id` followed by `x-goog-request-id`.
- Provider-specific message prefixes remain distinct: OpenAI adapter messages still use `OpenAI API 请求失败`, Gemini adapter messages still use `Gemini API 请求失败`, and runtime model discovery still uses its existing `<label> failed` form.
- Provider-specific secret redaction remains explicit: OpenAI adapter errors redact OpenAI-style `sk-...` keys, Gemini adapter errors also redact Google `AIza...` keys, and model discovery continues to redact the active API key plus query-string and bearer-token forms.
- Provider-specific model parsing remains local. OpenAI adapter discovery still returns `providerKind: "openai"`, runtime OpenAI-compatible discovery still infers focused model providers, and Gemini adapter discovery still filters to `generateContent`-capable models.
- Image generation/edit response parsing and streaming behavior were not refactored in this slice.
- No provider-native adapter, CLI/MCP integration, or public provider contract shrink was introduced.
