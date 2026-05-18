# Image2Tools Completion Audit

Date: 2026-05-18
Branch: `main`
Runtime/config evidence through: `06394ad`
Release and external-blocker evidence through: `06394ad`

## Objective Restated

Deliver a simple Electron desktop tool for `gpt-image-2` that lets the user save an Image 2 API key and base URL, configure common parameters, generate images, edit images, perform mask-based inpainting, download outputs, and reuse local history. Keep `README.md`, `PLAN.md`, `ARCHITECTURE.md`, `TODO.md`, and `CHECKLIST.md` current. Use CTO-style branch/worktree governance where possible.

## Evidence Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Desktop app foundation | `package.json`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/App.tsx`; `pnpm build` passes | Done |
| API key entry, local save, and clear | Provider form in `src/renderer/App.tsx`; encrypted storage and `config:clearApiKey` via Electron `safeStorage` in `src/main/main.ts` | Done |
| Base URL entry and connection test | `baseURL` config in renderer; `/models` connection test via `handleTestConnection` | Done |
| Simple parameter config | Size, quality, format, compression, count, stream, partial images, moderation, timeout controls in renderer | Done |
| `gpt-image-2` defaults and limits | `DEFAULT_IMAGE_PARAMS`, size validation, background enum, no transparent or `input_fidelity` in `src/shared/validation.ts` and `src/shared/types.ts` | Done |
| Text-to-image generation | `/images/generations` implementation and tests in `src/main/services/openaiImage.ts` / `.test.ts` | Implemented; real API manual run pending |
| Image edit and inpaint | `/images/edits`, multipart `image[]`, mask support, renderer mode switching, mask editor, and mask/source size, format, and alpha validation | Implemented; real API manual run pending |
| Streaming partial previews | SSE parsing and partial event handling in main + renderer; covered by tests | Done |
| Local file save and download | Base64 output saved under Electron `userData`; download dialog copies selected generated asset; main-process IPC rejects download/open/delete paths outside the app image store or current history | Done |
| History and reuse | JSON history, search, reuse, copy prompt, open folder, delete, clear | Done |
| Recovery | Atomic state writes with `.bak`, interrupted job recovery, workspace draft autosave/restore | Done |
| Local no-key integration path | `pnpm mock:openai` serves `/models`, `/images/generations`, `/images/edits`, JSON results, and SSE events; `pnpm verify:mock-api` probes models, JSON generation, streaming generation, multipart edit, multi-image mask edit/inpaint, and streaming edit | Done |
| Tests | `pnpm build` passed with 4 test files and 21 tests on `06394ad` | Done |
| Packaging | `electron-builder` config includes main, preload, shared, and renderer runtime outputs; project icons in `build/`; `pnpm package:dir`; `pnpm package:mac`; local app; dmg-copy launch; two-cycle reinstall smoke tests; `pnpm verify:release:mac` confirms the app process and main window; private GitHub pre-release `v0.1.0-mac-unsigned` | Done for unsigned macOS local/pre-release artifacts |
| Remote CI | `.github/workflows/ci.yml` runs build + mock API verifier on Ubuntu and macOS, Windows, and Linux package gates for push/PR/manual dispatch; runs are blocked before job steps by GitHub billing/spending limit | Configured; external billing blocker tracked in GitHub issue #5 |
| Docs updated | `README.md`, `PLAN.md`, `ARCHITECTURE.md`, `TODO.md`, `CHECKLIST.md` updated | Done |
| External acceptance runbook | `EXTERNAL_ACCEPTANCE.md` consolidates the remaining real API, signing/notarization, Windows/Linux, and CI billing gates with commands and evidence requirements | Done |
| CTO worktree cleanup | `git worktree list` shows only main worktree | Done |
| Clean main worktree | `git status --short --branch` shows clean `main` | Done |
| Abandoned renderer stash | `stash@{0}` inspected; touched only `src/renderer/App.tsx` and `src/renderer/styles.css`; current `main` has newer renderer behavior including draft recovery and mask alpha validation; archived non-destructively to `origin/archive/abandoned-renderer-stash`; local stash dropped after verifying the archive commit matched | Resolved; tracked in GitHub issue #2 |
| Remote/PR parity | private GitHub `origin` configured at `https://github.com/Bliveren/image2tools.git`; `main` pushed and tracks `origin/main`; `git ls-remote --heads origin main` matches local pushed history | Done for current `main`; future subtask branches can use PR flow |
| Official OpenAI docs parity | Current OpenAI Image Generation guide and OpenAPI endpoint metadata confirm `gpt-image-2`, `/images/generations`, `/images/edits`, base64 output, streaming partial images, mask requirements, size/format/quality/compression/background/moderation parameters, no transparent background for `gpt-image-2`, and omitted `input_fidelity` for `gpt-image-2`; docs also note GPT Image organization verification and extra partial-image token cost | Done |
| Real API generation/edit/inpaint | `pnpm verify:real-api` provides a cost-confirmed real API acceptance path for generation, single-image edit, multi-image edit, and inpaint; an extra opt-in cost flag adds real streaming generation and edit coverage; no real API key was provided or used; tracked in GitHub issue #1 | External/manual pending |
| Signed installable distribution | Unsigned macOS dmg/zip generated; `pnpm verify:signing-ready` checks code signing identity, notarization env vars, and signing config without exposing secrets; no certificate/notarization available; tracked in GitHub issue #3 | External/manual pending |
| Cross-platform install validation | Windows and Linux package gates are configured in GitHub Actions; native install/launch validation still needs corresponding environments; tracked in GitHub issue #4 | External/manual pending |

## Verification Commands Run

- `pnpm build`: typecheck, Vitest, renderer build, main build passed on 2026-05-18 for the `947450a` tree; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, main build passed on 2026-05-18 for the `7b3b9bc` tree; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, main build passed on 2026-05-18 for the `39f4a3d` tree; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, main build passed on 2026-05-18 for the `8f437e2` tree; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for the `d93f2c8` tree after merging the real streaming edit verifier; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for the current `a4b15de` tree; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for the current `971998b` tree; Vitest reported 3 test files and 15 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for merged `main` at `46213ea`; Vitest reported 3 test files and 17 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for `131efe4`; Vitest reported 4 test files and 21 tests passed, including IPC asset path ownership checks.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for current `main` at `780af4d`; Vitest reported 4 test files and 21 tests passed.
- `pnpm build`: typecheck, Vitest, renderer build, and main build passed on 2026-05-18 for current `main` at `06394ad`; Vitest reported 4 test files and 21 tests passed.
- `pnpm package:dir`: unsigned macOS app directory regenerated successfully on 2026-05-18 after `9111b90`; command reran build, typecheck, and 15 tests first.
- `open -n release/mac-arm64/Image2Tools.app`: packaged app launched on 2026-05-18 after `8a69b39`; process was observed, then the smoke-test process was terminated after AppleScript quit was not handled by the app.
- `pnpm package:mac`: regenerated `release/Image2Tools-0.1.0-mac-arm64.dmg`, `.zip`, and blockmaps successfully on 2026-05-18 after `9111b90`; command reran build, typecheck, and 15 tests first.
- `hdiutil attach ...`, copy `Image2Tools.app` to `/tmp/Image2Tools-current-dmg-test.*`, `open -n ...`: current dmg install-style smoke test launched successfully on 2026-05-18 after `f9fe082`; test process, mount point, and temp directory were cleaned up.
- `hdiutil attach ...`, copy/run/remove/copy/run/remove in `/tmp/Image2Tools-current-reinstall-test.*`: current dmg two-cycle macOS uninstall/reinstall smoke test passed on 2026-05-18 after `7da178b`; test processes, mount point, and temp directory were cleaned up.
- `pnpm verify:release:mac`: automated macOS dmg verification passed on 2026-05-18 for the `659b0c4` tree; it mounted the current dmg, copied the app to a temp directory, launched it twice, removed it twice, detached the dmg, and cleaned temp files.
- `pnpm package:mac`: regenerated current unsigned macOS dmg/zip on 2026-05-18 before creating GitHub pre-release `v0.1.0-mac-unsigned`.
- `pnpm verify:release:mac`: automated macOS dmg verification passed on 2026-05-18 before creating GitHub pre-release `v0.1.0-mac-unsigned`.
- `pnpm package:mac`: regenerated unsigned macOS dmg/zip on 2026-05-18 after fixing packaged runtime files to include `dist/preload` and `dist/shared`; command reran build, typecheck, and 15 tests first.
- `pnpm verify:release:mac`: stronger macOS dmg verification passed on 2026-05-18 after fixing packaged runtime files; it mounted the dmg, copied the app to a temp directory twice, confirmed a main process and visible main window each time, stopped the app, removed the copy, detached the dmg, and cleaned temp files.
- `gh release create v0.1.0-mac-unsigned ... --prerelease --latest=false`: uploaded `Image2Tools-0.1.0-mac-arm64.dmg` and `.zip` to private GitHub pre-release.
- `gh release upload v0.1.0-mac-unsigned ... --clobber`: replaced the private pre-release dmg/zip with the fixed packaged build after stronger main-window verification passed.
- `gh release view v0.1.0-mac-unsigned --json ...`: release is private repo pre-release with both fixed assets uploaded.
- `shasum -a 256 release/Image2Tools-0.1.0-mac-arm64.dmg release/Image2Tools-0.1.0-mac-arm64.zip`: local SHA256 values match GitHub asset digests (`a04cc4568a5010ca99a00df747d0317203b56fc86724ab116491c96472b31c96` for dmg, `75e0da8fe7181e3c515fcf8babb49da43acafa199e2cb7737b54601b48c9fd41` for zip).
- `pnpm package:mac`: regenerated unsigned macOS dmg/zip on 2026-05-18 from current `main` at `3eab3f7`; command reran typecheck, 17 tests, renderer build, and main build first.
- `pnpm verify:release:mac`: automated macOS dmg verification passed on 2026-05-18 for the refreshed unsigned `3eab3f7` package; it completed two copy/launch/window/remove cycles with concrete pids.
- `gh release upload v0.1.0-mac-unsigned ... --clobber`: refreshed the private pre-release dmg/zip with the current unsigned build from `3eab3f7`.
- `shasum -a 256 release/Image2Tools-0.1.0-mac-arm64.dmg release/Image2Tools-0.1.0-mac-arm64.zip`: refreshed local SHA256 values match GitHub asset digests (`7c2c6db9eab4b88fe3a5360d1720bb378c56aa7780e74a2c7ccf8c2594102d80` for dmg, `b4c46aa703f822c1575bf6775b5737f43eb7e384a0e7b1f57cadba726121faa9` for zip).
- Packaged app UI mock smoke on 2026-05-18: launched `release/mac-arm64/Image2Tools.app`, saved fake key `sk-mock-image2tools` and `http://127.0.0.1:8787/v1`, confirmed connection success in the UI, ran Generate through the UI, observed `Generate finished.`, history/result controls, a partial preview, and result files under Electron `userData`.
- `pnpm package:mac` and `pnpm verify:release:mac`: passed on 2026-05-18 after hardening the release verifier so failed launch/window checks still stop the copied app and remove the temporary app path.
- `pnpm verify:release:mac`: failed on 2026-05-18 for the current unsigned dmg because the old verifier held a stale launch pid and reported `Packaged app launched but did not show a main window`; manual investigation showed the packaged `Image2Tools` process was alive and System Events could see one window, so this was a verifier false negative rather than an app launch failure.
- PR #24 updated `scripts/verify-mac-release.mjs` to refresh `Image2Tools` pids while waiting for the main window and to fall back to System Events process-name window detection for Electron/macOS pid churn.
- `node ../image2tools-mac-verifier/scripts/verify-mac-release.mjs`: fixed verifier passed against the current dmg before PR #24 merge, completing two copy/launch/window/remove cycles.
- `pnpm verify:release:mac`: passed on merged `main` at `246604a` after PR #24; it completed two copy/launch/window/remove cycles and detected the main window via the process-name fallback.
- PR #26 hardened the macOS release verifier fallback so a pre-existing `Image2Tools` window cannot create a false positive; it now records the baseline process-name window count before launching and only accepts fallback success when the count increases.
- `node --check scripts/verify-mac-release.mjs` and `git diff --check`: passed on the PR #26 verifier hardening branch.
- `node ../image2tools-mac-verifier-fallback/scripts/verify-mac-release.mjs`: hardened verifier passed against the current dmg before PR #26 merge after clearing stale local test processes, completing two copy/launch/window/remove cycles.
- `pnpm verify:release:mac`: passed on merged `main` at `69919b2` after PR #26; it completed two copy/launch/window/remove cycles and detected the main window with concrete pids in both cycles.
- `pnpm verify:release:mac`: passed on current `main` at `971998b`; it completed two copy/launch/window/remove cycles and confirmed a main window in both cycles.
- PR #36 hardened `scripts/verify-mac-release.mjs` so the copied temporary app is removed before dmg detach, with a forced-detach fallback after normal retry attempts.
- `pnpm package:mac`: regenerated unsigned macOS dmg/zip on 2026-05-18 for current `main` at `780af4d`; command reran typecheck, 21 tests, renderer build, and main build first.
- `pnpm verify:release:mac`: passed on current `main` at `780af4d` after PR #36; it completed two copy/launch/window/remove cycles and detached the dmg after cleanup.
- `gh release upload v0.1.0-mac-unsigned ... --clobber`: refreshed the private pre-release dmg/zip with the current unsigned build from `780af4d`.
- `shasum -a 256 release/Image2Tools-0.1.0-mac-arm64.dmg release/Image2Tools-0.1.0-mac-arm64.zip`: refreshed local SHA256 values match GitHub asset digests (`194efb3e19c28d72ee32a9e386a4f74e89e4fa81de7420ddc751c1f0b264b96a` for dmg, `f8b14515a7b92b755dc3d9f1d6b8cbf374ff7f8f47299a22cdfe3141300451a7` for zip).
- `pnpm verify:release:mac`: passed on current `main` at `06394ad`; it completed two copy/launch/window/remove cycles and confirmed a main window in both cycles.
- `shasum -a 256 release/Image2Tools-0.1.0-mac-arm64.dmg release/Image2Tools-0.1.0-mac-arm64.zip`: current local unsigned release files still match the documented GitHub release asset digests (`194efb3e19c28d72ee32a9e386a4f74e89e4fa81de7420ddc751c1f0b264b96a` for dmg, `f8b14515a7b92b755dc3d9f1d6b8cbf374ff7f8f47299a22cdfe3141300451a7` for zip).
- `pnpm mock:openai`: local mock API server starts at `http://127.0.0.1:8787/v1`.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the `947450a` tree.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the `7b3b9bc` tree.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the `39f4a3d` tree.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the `8f437e2` tree.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the mock verifier coverage tree; it now checks JSON generation, streaming generation, single-image multipart edit, multi-image mask edit/inpaint, and streaming edit against the local mock.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the `d93f2c8` tree after merging the real streaming edit verifier.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the current `a4b15de` tree.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for the current `971998b` tree.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for merged `main` at `46213ea`.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for `131efe4` after hardening IPC asset file operations.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for current `main` at `780af4d`.
- `pnpm verify:mock-api`: automatic mock verification passed on 2026-05-18 for current `main` at `06394ad`.
- `pnpm verify:real-api`: without an API key, exits before making real API calls.
- `pnpm verify:real-api`: on current `971998b`, exited before making real API calls because neither `IMAGE2TOOLS_API_KEY` nor `OPENAI_API_KEY` was set.
- `pnpm verify:real-api`: on current `06394ad`, exited before making real API calls because neither `IMAGE2TOOLS_API_KEY` nor `OPENAI_API_KEY` was set; issue #1 was updated with this current blocker evidence.
- `IMAGE2TOOLS_API_KEY=sk-test-no-call pnpm verify:real-api`: exits before making real API calls unless `IMAGE2TOOLS_REAL_API_ACCEPT_COST=1` is explicitly set.
- `IMAGE2TOOLS_API_KEY=sk-mock-image2tools IMAGE2TOOLS_BASE_URL=http://127.0.0.1:8788/v1 IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 pnpm verify:real-api`: passed against the local mock API, covering the script's generation, single-edit, multi-edit, and inpaint request paths; temporary artifacts and mock process were cleaned up.
- `IMAGE2TOOLS_API_KEY=sk-mock-image2tools IMAGE2TOOLS_BASE_URL=http://127.0.0.1:8788/v1 IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 IMAGE2TOOLS_REAL_API_ACCEPT_STREAM_COST=1 pnpm verify:real-api`: passed against the local mock API after adding the opt-in streaming generation and edit checks; temporary artifacts and mock process were cleaned up.
- `pnpm verify:signing-ready`: reported no valid code signing identities, `build.mac.identity` set to `null`, and notarization env vars unset; no signing or notarization was attempted.
- `pnpm verify:signing-ready`: on current `971998b`, again reported no valid code signing identities, `build.mac.identity` set to `null`, and `CSC_NAME`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` unset; no signing or notarization was attempted.
- `pnpm verify:signing-ready`: on current `06394ad`, again reported no valid code signing identities, `build.mac.identity` set to `null`, and `CSC_NAME`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` unset; no signing or notarization was attempted; issue #3 was updated with this current blocker evidence.
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'`: GitHub Actions workflow YAML parsed locally after adding Windows/Linux package jobs and manual dispatch.
- `gh run view 26011616452 --repo Bliveren/image2tools`: CI was triggered but both jobs were blocked before starting because GitHub reported account payment/spending-limit restrictions.
- `gh run list --repo Bliveren/image2tools --branch main --limit 5 --json databaseId,displayTitle,status,conclusion,event,headSha,url,createdAt,updatedAt`: repeated `main` CI runs still conclude `failure` before executing workflow steps, including `26018882123` for `cdc73f6` and `26019519641` for `8ac18c6`.
- `gh run view 26019519641 --repo Bliveren/image2tools --json jobs,status,conclusion,event,url,headSha`: the current observed failure pattern is unchanged; build/mock, Windows package, macOS package, and Linux package jobs all had empty `steps` arrays, matching the external GitHub Actions billing/spending-limit blocker tracked in issue #5.
- `gh run view 26021791793 --repo Bliveren/image2tools --json jobs,status,conclusion,event,url,headSha`: latest observed `main` CI run for `971998b` still concluded `failure` before workflow steps ran; Linux package, build/mock, macOS package, and Windows package jobs all had empty `steps` arrays.
- `gh run view 26022641368 --repo Bliveren/image2tools --json jobs,status,conclusion,event,url,headSha`: latest observed `main` CI run for `c08d82f` still concluded `failure` before workflow steps ran; Linux package, build/mock, macOS package, and Windows package jobs all had empty `steps` arrays.
- `gh run view 26023298065 --repo Bliveren/image2tools --json jobs,status,conclusion,event,url,headSha`: latest observed `main` CI run for `46213ea` still concluded `failure` before workflow steps ran; Linux package, build/mock, macOS package, and Windows package jobs all had empty `steps` arrays.
- `gh run view 26023987641 --repo Bliveren/image2tools --json jobs,status,conclusion,url,headSha`: latest observed `main` CI run for `e6225f0` still concluded `failure` before workflow steps ran; Build and mock API verifier, macOS package, Windows package, and Linux package jobs all had empty `steps` arrays.
- `gh run view 26025852856 --repo Bliveren/image2tools --json jobs,status,conclusion,event,url,headSha`: latest observed `main` CI run for `780af4d` still concluded `failure` before workflow steps ran; Build and mock API verifier, macOS package, Windows package, and Linux package jobs all had empty `steps` arrays.
- `gh run view 26026330595 --repo Bliveren/image2tools --json jobs,status,conclusion,event,url,headSha`: latest observed `main` CI run for `06394ad` still concluded `failure` before workflow steps ran; Build and mock API verifier, macOS package, Windows package, and Linux package jobs all had empty `steps` arrays; issues #4 and #5 record this as current blocker evidence.
- `gh issue list --repo Bliveren/image2tools --state open --json number,title,labels,url,updatedAt`: remaining open issues are external blockers #1, #3, #4, and #5.
- `gh release view v0.1.0-mac-unsigned --repo Bliveren/image2tools --json tagName,name,isPrerelease,isDraft,url,assets,publishedAt,targetCommitish`: private pre-release `v0.1.0-mac-unsigned` is published, not draft, marked as pre-release, and has the dmg/zip assets uploaded with SHA256 digests matching the local release files.
- `EXTERNAL_ACCEPTANCE.md`: added in PR #29 and linked from `README.md`, `TODO.md`, and this audit so the remaining external gates have a single repo-level runbook.
- `curl` checks against the mock passed for `/models`, JSON `/images/generations`, SSE `/images/generations`, and multipart `/images/edits`.
- `git status --short --branch`: clean `main`.
- `git worktree list`: only `/Users/alive/projects/image2tools`.
- `git remote -v`: `origin` is `https://github.com/Bliveren/image2tools.git` for fetch and push.
- `git ls-remote --heads origin main`: remote `main` exists and matched the pushed local history when checked.
- `gh repo view Bliveren/image2tools --json nameWithOwner,visibility,url,defaultBranchRef`: repository exists as private GitHub repo with default branch `main`.
- `gh issue list --repo Bliveren/image2tools --state open --limit 10`: remaining external blockers are tracked as issues #1 and #3 through #5.
- GitHub milestone `v0.1.0 external acceptance`: tracks the open external blocker issues at https://github.com/Bliveren/image2tools/milestone/1.
- `git stash show --stat stash@{0}` and `git show stash@{0}:...`: stash inspected; it is an old alternate renderer experiment and is not part of `main`.
- `git branch archive/abandoned-renderer-stash stash@{0}` and `git push origin archive/abandoned-renderer-stash`: non-destructive archive branch created at `78b2c683fc180c8e511d1802b37545fd48c8c887`.
- `git rev-parse stash@{0}`, `git rev-parse archive/abandoned-renderer-stash`, and `git ls-remote --heads origin archive/abandoned-renderer-stash`: local stash, local archive branch, and remote archive branch all matched `78b2c683fc180c8e511d1802b37545fd48c8c887`.
- `git stash drop stash@{0}` and `git stash list`: local duplicate stash was dropped after archive verification; no local stash entries remain.
- `mcp__openaiDeveloperDocs__.fetch_openai_doc` for `https://developers.openai.com/api/docs/guides/image-generation`: current official guide confirms Image API generation/edit endpoints, `gpt-image-2` examples, streaming `partial_images: 0..3`, mask requirements, base64 output, output customization, `gpt-image-2` size limits, no transparent background, no `input_fidelity`, organization verification, and partial image token cost.
- `mcp__openaiDeveloperDocs__.get_openapi_spec` for `https://api.openai.com/v1/images/generations` and `https://api.openai.com/v1/images/edits`: endpoint metadata confirms JSON generation, multipart edit uploads, JSON edit support, streaming event response types, and image response schemas.
- PR #31 aligned inpaint mask handling with the current official Image API mask requirements by enforcing PNG/WebP mask types, source/mask format compatibility, and request-layer rejection for mismatches; local `pnpm build` and `pnpm verify:mock-api` passed before merge.
- `131efe4` hardened main-process asset IPC so download/open-folder/delete operations only act on generated resources inside the app image store and current history; local `pnpm build`, `pnpm verify:mock-api`, and `git diff --check` passed on the feature branch before PR review.
- `780af4d` includes PR #35 IPC asset path hardening and PR #36 macOS release verifier cleanup/detach hardening; local `pnpm build`, `pnpm verify:mock-api`, `pnpm package:mac`, and `pnpm verify:release:mac` passed before refreshing the unsigned private pre-release assets.
- `06394ad` is a docs-only merge after the `780af4d` release refresh; current local `pnpm build`, `pnpm verify:mock-api`, `pnpm verify:release:mac`, and release SHA256 verification passed, while the remaining real API, signing, Windows/Linux, and CI gates remain external blockers.

## Remaining External Work

GitHub milestone: https://github.com/Bliveren/image2tools/milestone/1

Runbook: [EXTERNAL_ACCEPTANCE.md](./EXTERNAL_ACCEPTANCE.md)

- Use a real Image 2 API key to manually verify text generation, single-image edit, multi-image edit, and inpainting: GitHub issue #1.
- Confirm the OpenAI organization behind the real API key has GPT Image organization verification before manual acceptance: GitHub issue #1.
- Add signing identity, notarization, and formal release metadata: GitHub issue #3.
- Validate non-macOS target platforms: GitHub issue #4.
- Resolve GitHub Actions billing/spending limit so CI can execute: GitHub issue #5.
