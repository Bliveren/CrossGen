# Open Source Audit

Last reviewed: 2026-06-09

## Scope

This audit covers tracked source files, scripts, build metadata, documentation,
and public packaging configuration for publishing CrossGen under the MIT
license with Nowo, Corgnitor, and project contributors listed as copyright
holders.

## Findings

| Area | Status | Evidence |
| --- | --- | --- |
| License | Ready | `LICENSE` contains the MIT license, `package.json` declares `MIT`, and the copyright line is aligned to Nowo, Corgnitor, and contributors. |
| Production dependency licenses | Compatible | `pnpm licenses list --prod` reports MIT or ISC production dependencies only. |
| Development dependency licenses | Acceptable | `pnpm licenses list` reports common permissive/open tooling licenses; no copyleft runtime blocker was found. |
| Real API keys | No real key found in tracked source | Secret scan only found test/mock keys, code symbols, provider headers, and environment variable names. |
| Runtime key storage | Acceptable for desktop app | OpenAI and Gemini API keys are saved under Electron user data, encrypted with `safeStorage` when available; state files are not tracked and saved configs expose only a masked preview to the renderer. |
| Build outputs | Ignored | `.gitignore` excludes `dist/`, `dist-renderer/`, `release/`, `real-api-artifacts/`, logs, and env files. |
| Private release wording | Removed from public docs | README and acceptance docs now describe local/public packaging rather than private preview assets, private milestones, or numbered private issues. |
| Windows support | Present | `package.json` has an NSIS Windows target, CI has a Windows packaging job, and `scripts/verify-windows-release.mjs` validates installer metadata and unpacked app launch in CI package-smoke mode while keeping silent install and uninstall mandatory for full native release validation. |
| Language switching | Present | Renderer includes an English/Chinese language switch stored in `localStorage`. |
| Multi-provider scope | Documented | README, ARCHITECTURE, SECURITY, EXTERNAL_ACCEPTANCE, and RELEASE_NOTES describe GPT Image 2, Nano Banana 3, and General boundaries. General documents its provider-specific split: Gemini prompt/reference fallback, plus OpenAI-compatible prompt-only fallback for OpenAI and Custom. |
| Gemini provider risk | Documented | SECURITY explains `x-goog-api-key`, Gemini query-key discovery, `AIza...` redaction expectations, and user rights for uploaded reference/mask guidance images. EXTERNAL_ACCEPTANCE keeps real Gemini/Nano Banana acceptance as an external gate until a real verifier exists. |
| README presentation | Present | README includes a right-aligned English/Simplified Chinese language menu, local showcase assets, sponsor/company context, development commands, and open-source readiness notes. |
| Icon assets | Present | `build/icon.svg` is the local source for `build/icon.png`, `build/icon.icns`, `build/icon.ico`, `build/icon.iconset`, and `public/favicon.svg`. |
| Personal/local identifiers | Non-blocking release metadata remains | Personal email, private proxy domain test fixtures, private repository links, and local machine paths are absent from tracked source and docs. `package.json` and `docs/updates/README.md` still point at the current `bliveren` app/update identifiers; replace them when the company-owned release location is decided. |
| Sensitive files | Not tracked | File and tracked-file scans found no `.env*`, private keys/certificates, state JSON files, release output, build output, or real API artifacts. |

## Acceptable Search Hits

The following patterns are expected and should not block publication:

- `sk-mock-image2tools`, `sk-test-key`, and similar fixtures in tests or mock
  scripts.
- `OPENAI_API_KEY`, `IMAGE2TOOLS_API_KEY`, and signing variable names in
  documentation or verification scripts.
- `mock-gemini-key`, `x-goog-api-key`, Gemini query `key=...` examples, and
  redaction fixtures in mock scripts, tests, and documentation.
- `Authorization` / `Bearer` code paths that construct provider requests.
- `encryptedApiKey` field names used for local encrypted config storage.
- Redaction tests that intentionally include fake `sk-...` strings and the word
  `secret`.
- Documentation mentions of `private` reporting channels and CI/local `secrets`
  as safety guidance.
- Token usage field names and cost notes for image generation.

## Remaining Manual Gates

- Run native Windows packaging verification on Windows before publishing Windows
  binaries.
- Complete real OpenAI and Gemini API acceptance with explicit cost approval
  before claiming real-provider success for `v0.2.0`.
- Add an automated real Gemini verifier or keep the manual Gemini acceptance
  evidence current in `EXTERNAL_ACCEPTANCE.md`.
- Use real signing and notarization credentials only through local environment
  variables or CI secrets; never commit them.
- Re-run the pre-publication secret scan after any documentation or release
  notes are updated.
- Replace the current app/update identifiers if binaries will be distributed
  from a Nowo/Corgnitor-owned account, domain, or signing identity.
- If publishing under a company account, run the final legal review for
  trademark, brand ownership, and any third-party asset policy.
