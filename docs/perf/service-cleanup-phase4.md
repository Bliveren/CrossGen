# Service Cleanup Phase 4 Notes

Captured: 2026-07-08

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
