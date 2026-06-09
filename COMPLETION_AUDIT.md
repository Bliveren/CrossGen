# Image2Tools Completion Audit

Date: 2026-05-19
Branch: `main`

## Objective Restated

Deliver a simple Electron desktop tool for `gpt-image-2` that lets users save an
Image API key and Base URL, configure common parameters, generate images, edit
images, perform mask-based inpainting, download outputs, reuse local history,
package the app for desktop platforms, and publish the code under the MIT
license without leaking secrets or private local artifacts.

## Evidence Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Desktop app foundation | `package.json`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/App.tsx`; `pnpm build` passes | Done |
| MIT licensing | `LICENSE` contains MIT text; `package.json` declares `MIT`; README links to `LICENSE` | Done |
| API key entry, local save, and clear | Provider form in renderer; encrypted storage and `config:clearApiKey` via Electron `safeStorage` in `src/main/main.ts`; runtime API key validation in `src/shared/validation.ts` | Done |
| Secret handling and open-source scan | `.gitignore` excludes env files, logs, build outputs, release outputs, and real API artifacts; `SECURITY.md` and `OPEN_SOURCE_AUDIT.md` document accepted and blocking scan hits | Done |
| Base URL entry and connection test | Renderer config form; `/models` connection test via `handleTestConnection`; Base URL normalization in shared validation | Done |
| Parameter config | Size, quality, format, compression, count, stream, partial images, moderation, and timeout controls | Done |
| `gpt-image-2` defaults and limits | `DEFAULT_IMAGE_PARAMS`, size validation, 16 image cap, enum validation, finite integer validation, no transparent background option, and no `input_fidelity` exposure | Done |
| Text-to-image generation | `/images/generations` implementation and tests in `src/main/services/openaiImage.ts` / `.test.ts` | Implemented; real API manual run still depends on user credentials |
| Image edit and inpaint | `/images/edits`, multipart image upload, mask support, renderer mode switching, mask/source validation, and service tests | Implemented; real API manual run still depends on user credentials |
| Streaming partial previews | SSE parsing and partial event handling in main + renderer, covered by tests | Done |
| Local preview and file serving | Generated outputs are saved under Electron `userData`; renderer previews use a restricted `image2tools-asset://` protocol that only serves managed app image files | Done |
| Download and file operations | Download/open/delete IPC paths reject assets outside the app image store or current history | Done |
| History and reuse | JSON history, search, reuse, copy prompt, open folder, delete, and clear | Done |
| Recovery | Atomic state writes with backup, interrupted job recovery, workspace draft autosave/restore | Done |
| English/Chinese UI | Renderer includes a Language / 语言 switch backed by `localStorage`; text is centralized in `src/renderer/i18n.ts`; `src/renderer/i18n.test.ts` verifies copy shape, saved preference, navigator fallback, and validation-message localization | Done |
| Local no-key integration path | `pnpm mock:openai` and `pnpm verify:mock-api` cover models, generation, edit, inpaint, streaming, and multipart request inspection | Done |
| Windows packaging | `package.json` has `package:win`; electron-builder has an NSIS Windows target; `.github/workflows/ci.yml` includes a Windows package job; `scripts/verify-windows-release.mjs` validates installer metadata and unpacked app launch in CI package-smoke mode, and defaults to full silent install / installed app launch / silent uninstall for native release validation | Configured; native Windows execution required for final binary acceptance |
| macOS packaging | `package:mac`, mac icon, DMG/ZIP targets, and macOS release verifier are present | Configured |
| Linux packaging | AppImage target and Linux verifier are present | Configured |
| External release evidence | `docs/release/evidence.json` records real API, signing, native platform, and update-manifest gates; `pnpm verify:release-evidence` validates schema and redaction while `--require-complete` blocks publishing until all required gates pass | Configured; external evidence still pending |
| Tests | `pnpm build`, targeted Vitest, `pnpm verify:mock-api`, dependency license scan, and `git diff --check` pass on the current worktree | Done |

## Current Verification Commands

The current worktree was verified with:

```bash
pnpm vitest run src/main/services/openaiImage.test.ts src/shared/validation.test.ts
pnpm vitest run src/renderer/i18n.test.ts
pnpm verify:mock-api
pnpm build
git diff --check
pnpm licenses list --prod
rg -n "sk-[A-Za-z0-9_-]{8,}|Bearer |Authorization|apiKey|encryptedApiKey|secret|password|token|private|/Users/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|github\\.com/.+/milestone|release/tag|origin/archive" -g '!node_modules' -g '!dist*' -g '!release' -g '!pnpm-lock.yaml'
find . -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -name '*state*.json' -o -name '*secret*' \) -not -path './node_modules/*' -print
git ls-files | rg '(^|/)(dist|dist-renderer|release|real-api-artifacts|node_modules)/|\.env|\.pem|\.p12|state\.json|\.DS_Store' || true
```

`pnpm build` includes TypeScript checks, all Vitest tests, renderer build, and
main-process build. The current suite is 5 test files / 37 tests. Production
dependencies report only ISC/MIT licenses. The file scans produced no sensitive file or tracked output
matches; the content scan only found documented acceptable hits listed in
`OPEN_SOURCE_AUDIT.md`. A separate project-specific scan for known internal
identifiers, old draft release names, and account-specific URLs also produced no
blocking hits.

## Remaining External Gates

- Real API acceptance requires a user-provided key and explicit cost
  confirmation through `pnpm verify:real-api`; evidence must be recorded in
  `docs/release/evidence.json`.
- Windows installer verification must be run on Windows with:

  ```powershell
  pnpm package:win
  pnpm verify:release:windows
  ```

- Signed and notarized macOS distribution requires external Developer ID and
  Apple notarization credentials supplied through local env vars or CI secrets.
- Final publication should run
  `pnpm verify:release-evidence -- --require-complete` after all external
  evidence is recorded.
- Public release artifacts should be generated after rerunning the
  pre-publication scan documented in `SECURITY.md`.
