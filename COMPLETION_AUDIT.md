# Image2Tools Completion Audit

Date: 2026-06-09
Branch: `main`
Target release: `v0.2.0`

## Objective Restated

Deliver Image2Tools as a local-first Electron desktop workspace for image
generation and editing across:

- GPT Image 2 through the OpenAI Image API.
- Nano Banana 3 through Gemini `gemini-3.1-flash-image`.
- General fallback workflows for discovered non-focused image models.

The app must support provider setup, model discovery, model-specific launch
flows, generation/editing/region workflows where supported, local history,
downloads, bilingual UI, mock verification, desktop packaging, and release
governance without leaking secrets or private local artifacts.

## Evidence Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Desktop app foundation | `package.json`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/App.tsx`; `pnpm build` passes | Done |
| MIT licensing | `LICENSE` contains MIT text; `package.json` declares `MIT`; README links to `LICENSE` | Done |
| Multi-provider configuration | Renderer provider selector, provider-specific defaults, saved key preview, encrypted storage, and `config:clearApiKey` through Electron `safeStorage` | Done |
| Model discovery | `src/main/services/modelDiscovery.ts`, OpenAI `/models`, Gemini `/models?key=...`, `config:discoverModels` IPC, model discovery UI states, and mock discovery verifier | Done |
| Capability catalog and launch models | `src/shared/modelCatalog.ts` defines GPT Image 2, Nano Banana 3, and General launch capabilities; launcher buttons reflect local support and discovered remote models | Done |
| State migration | v1 config, history, and draft migration to provider/model-aware v2 shape is covered by state migration tests | Done |
| GPT Image 2 runtime | `openaiImageAdapter` preserves generation, edit, exact-mask inpaint, streaming partials, validation, result saving, and redacted errors | Implemented; real OpenAI acceptance pending |
| Nano Banana 3 runtime | `geminiImageAdapter` supports Gemini `generateContent`, inline image inputs, image/text part parsing, Gemini controls, guided-region semantics, and redacted errors | Implemented; real Gemini acceptance pending |
| General runtime | General mode keeps a minimal UI and provider-specific fallback: Gemini prompt/reference paths plus OpenAI-compatible prompt-only fallback for OpenAI and Custom | Done |
| History and reuse | History shows provider/model chips, collapses after 6 items, searches model fields, restores matching provider/model/params, and preserves owned-file deletion rules | Done |
| Local preview and file safety | Generated outputs are saved under Electron `userData`; restricted `image2tools-asset://` serving and IPC checks prevent arbitrary local file exposure | Done |
| Download and file operations | Download/open/delete IPC paths reject assets outside the app image store or current history | Done |
| Recovery | Atomic state writes with backup, interrupted job recovery, and workspace draft autosave/restore are covered | Done |
| English/Chinese UI | Renderer language switch and i18n shape tests cover English and Simplified Chinese copy | Done |
| Mock verification | `pnpm verify:mock-api`, `pnpm verify:mock-gemini-api`, and `pnpm verify:mock-model-discovery` cover no-cost OpenAI, Gemini, and discovery paths | Done |
| Release package metadata | Package version, description, copyright, app id, artifact names, and staged update manifest metadata align with `v0.2.0` | Done |
| Update manifest safety | `src/shared/updateManifest.ts`, installer byte verification, update manifest tests, and `pnpm update:manifest-asset` require URL/hash/size metadata | Done; formal signed asset metadata pending |
| Release evidence governance | `docs/release/evidence.json` records required external gates; `pnpm verify:release-evidence` validates schema, redaction, and guarded checklist alignment | Done; required gates still pending |
| macOS packaging | `package:mac`, DMG/ZIP targets, ad-hoc preview build path, signed packaging command, signing-readiness script, and mac release verifier are present | Configured; Developer ID signed/notarized evidence pending |
| Windows packaging | `package:win`, NSIS target, CI package-smoke mode, and full native installer verifier are present | Configured; native Windows shell evidence pending |
| Linux packaging | AppImage target, CI verifier, extracted app Xvfb launch, and direct AppImage requirement flag are present | Configured; native Linux desktop evidence pending |
| GitHub Actions | CI includes build/mock verification plus macOS, Windows, and Linux package jobs; recent PR gates have been green before merge | Done |
| Secret handling and open-source scan | `.gitignore`, `SECURITY.md`, and `OPEN_SOURCE_AUDIT.md` document secret handling, ignored outputs, and scan expectations | Done; re-run before publication |

## Current Verification Commands

Current local verification for the latest implementation rounds:

```bash
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
pnpm verify:release-evidence
node scripts/verify-release-evidence.mjs --require-complete
git diff --check
```

`pnpm build` currently runs TypeScript checks, all Vitest tests, renderer build,
and Electron main build. As of this audit refresh, the Vitest suite reports 20
test files / 112 tests.

`pnpm verify:release-evidence` passes with 0/6 required external gates passed,
which is expected until real API, signed/notarized, native platform, and formal
update-manifest evidence exists. `--require-complete` intentionally fails while
those gates are pending.

## Remaining External Gates

The remaining work requires credentials, external platforms, or release
artifacts that are not available in this local shell. Do not mark the related
checklist items complete without redacted evidence in
`docs/release/evidence.json` and a passing `pnpm verify:release-evidence`.

- Real OpenAI GPT Image 2 acceptance:
  `pnpm verify:real-api` with a real key and explicit cost approval, plus
  app-level history/download checks.
- Real Gemini / Nano Banana 3 acceptance:
  `pnpm verify:real-gemini-api` with a real key and explicit cost approval,
  plus app-level discovery, history, restore, and download checks.
- Signed and notarized macOS distribution:
  `pnpm verify:signing-ready`, `pnpm package:mac:signed`, and
  `pnpm verify:release:mac` with Developer ID and Apple notarization
  credentials.
- Native Windows release validation:
  `pnpm package:win` and default full `pnpm verify:release:windows` on a native
  Windows shell.
- Native Linux desktop validation:
  `IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1 pnpm verify:release:linux` on a
  native Linux desktop shell, plus download/open-folder checks.
- Formal update manifest assets:
  signed or externally validated release artifacts uploaded to HTTPS URLs, with
  `docs/updates/latest.json` populated by `pnpm update:manifest-asset` and
  verified URL, `sha256`, and `sizeBytes` evidence.
