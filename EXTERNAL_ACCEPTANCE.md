# Image2Tools External Acceptance Runbook

This runbook covers the work that cannot be completed from the current local
macOS development environment. Do not paste API keys, Apple credentials, or
GitHub billing details into issues, PRs, or logs.

## Baseline

Start from the latest `main`:

```bash
git checkout main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

Use public issues, milestones, or project boards only after the repository is
public. Do not include private account or billing details in public trackers.

## 1. Real OpenAI GPT Image 2 API Acceptance

Use a public tracking issue after the repository is public.

Prerequisites:

- Real API key with access to `gpt-image-2`
- Base URL, normally `https://api.openai.com/v1`
- OpenAI organization verification completed for GPT Image access
- Explicit cost approval for real image calls

Core acceptance:

```bash
IMAGE2TOOLS_API_KEY=... \
IMAGE2TOOLS_BASE_URL=https://api.openai.com/v1 \
IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 \
pnpm verify:real-api
```

Optional streaming acceptance, only when the extra partial-image token cost is
approved:

```bash
IMAGE2TOOLS_API_KEY=... \
IMAGE2TOOLS_BASE_URL=https://api.openai.com/v1 \
IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 \
IMAGE2TOOLS_REAL_API_ACCEPT_STREAM_COST=1 \
pnpm verify:real-api
```

Expected coverage:

- text-to-image generation
- single-image edit
- multi-image reference edit
- mask-based inpaint
- optional streaming generation and edit partial/final events

Artifacts are written to ignored `real-api-artifacts/`. After success, update
`docs/release/evidence.json`, run `pnpm verify:release-evidence`, update
`CHECKLIST.md`, `TODO.md`, and `COMPLETION_AUDIT.md`, then close the related
tracking issue if one exists.

## 2. Real Gemini / Nano Banana 3 API Acceptance

Use a public tracking issue after the repository is public.

Prerequisites:

- Real Gemini API key with access to `gemini-3.1-flash-image`
- Base URL, normally `https://generativelanguage.googleapis.com/v1beta`
- Explicit cost approval for real Gemini image calls
- Source/reference images that the tester has permission to upload to Gemini

Start with the no-cost mock regression:

```bash
pnpm build
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

Then run the cost-gated real Gemini verifier:

```bash
IMAGE2TOOLS_GEMINI_API_KEY=... \
IMAGE2TOOLS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta \
IMAGE2TOOLS_REAL_GEMINI_API_ACCEPT_COST=1 \
pnpm verify:real-gemini-api
```

Expected verifier coverage:

- `models` discovery includes `gemini-3.1-flash-image`
- text-to-image generation returns at least one inline image part
- reference-image editing sends a PNG reference image and returns image output
- guided-region editing sends a source image plus region-guide image and returns
  image output
- Gemini text parts, if returned, are saved as local artifact metadata

Artifacts are written to ignored `real-api-artifacts/gemini/`.

After the verifier passes, run the app against the real Gemini endpoint:

```bash
pnpm dev:electron
```

In the app:

1. Select provider `Gemini`.
2. Save the Gemini key and Base URL.
3. Run model discovery and confirm `gemini-3.1-flash-image` is discovered.
4. Select `Nano Banana 3`.
5. Complete one text-to-image generation.
6. Complete one reference-image edit with a PNG, JPEG, or WebP source image.
7. Complete one guided-region edit and confirm the UI does not describe it as
   exact-mask inpainting.
8. Download at least one Gemini output.
9. Confirm history shows the Gemini provider/model context and can restore the
   task parameters.

Expected results:

- Generated image parts render in the output canvas and can be downloaded.
- Any Gemini text parts are stored as provider metadata.
- Errors shown in the UI do not include raw Gemini API keys, `key=...` query
  values, or `x-goog-api-key` values.
- General uses provider-specific fallback behavior: use a discovered
  non-focused Gemini image model if available to confirm the prompt/reference
  path; OpenAI-compatible General remains prompt-only.

After success, update `docs/release/evidence.json`,
`MULTI_MODEL_CHECKLIST.md`, `CHECKLIST.md`, `TODO.md`, and
`COMPLETION_AUDIT.md` with OS/version, app commit, provider/model IDs, and
redacted evidence. Run `pnpm verify:release-evidence` before committing. Do not
commit real generated artifacts unless they are approved public assets.

## 3. GitHub Actions Billing Gate

Use a public tracking issue after the repository is public.

Do not rerun known-failing workflows until the account billing or spending-limit
restriction is fixed. The current failure signature is jobs that fail before
workflow steps execute, with empty `steps` arrays.

After billing is fixed, rerun the latest failed workflow from the GitHub Actions
UI or use a fresh PR/push if rerun is unavailable. Acceptance requires:

- Build and mock API verifier job starts and passes
- macOS package job starts and passes, or a runner-policy issue is documented
- Windows package job starts and passes, or a runner-policy issue is documented
- Linux package job starts and passes, or a runner-policy issue is documented

Record the green run URL in `COMPLETION_AUDIT.md` and close the related
tracking issue when CI can execute normally.

## 4. Signed And Notarized macOS Release

Use a public tracking issue after the repository is public.

Prerequisites:

- Valid Developer ID Application signing identity on the build host
- Apple notarization credentials available only through local env vars or CI
  secrets
- Signing/notarization readiness passing locally. The default `pnpm package:mac`
  path intentionally remains ad-hoc signed and unnotarized for local preview;
  use `pnpm package:mac:signed` for the Developer ID signed/notarized release
  path.

Use the required CTO branch/worktree flow before producing signed release
evidence or changing release config:

```bash
git worktree add -b release/cto-signed-mac ../image2tools-signed-mac main
cd ../image2tools-signed-mac
```

Set credentials outside logs:

```bash
export CSC_NAME="Developer ID Application: <Team Name> (<TEAM_ID>)"
export APPLE_ID="<apple-id-email>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<team-id>"
```

Then run:

```bash
pnpm verify:signing-ready
pnpm package:mac:signed
pnpm verify:release:mac
```

After success, use `pnpm update:manifest-asset -- --file <signed-artifact>
--platform darwin --arch <arch> --url <release-asset-url>` to generate the
signed asset URL, sha256, and `sizeBytes` metadata for
`docs/updates/latest.json`, then update `docs/release/evidence.json`,
`CHECKLIST.md`, `TODO.md`, and `COMPLETION_AUDIT.md`. Run
`pnpm verify:release-evidence` before committing. Close the related tracking
issue if one exists.

## 5. Windows And Linux Native Validation

Use a public tracking issue after the repository is public.

Current partial evidence:

- Ubuntu/Debian Bookworm ARM64 Docker validation on the macOS host passed
  `pnpm build`, `pnpm verify:mock-api`, Linux AppImage packaging, AppImage
  extraction, and extracted-app launch under Xvfb.
- `pnpm verify:release:windows` defaults to full native Windows package
  validation: NSIS installer/unpacked executable PE metadata inspection,
  unpacked app launch, main-window detection, a short process stability smoke
  interval, plus silent install / installed app launch / silent uninstall.
  Hosted GitHub workflows set
  `IMAGE2TOOLS_WINDOWS_VERIFY_MODE=package-smoke` so the installer PE and
  unpacked-app smoke checks stay gated without relying on the hosted runner's
  silent installer policy.
- On 2026-06-10, a native Windows full-install verifier run passed for commit
  `e6587d2e3e2bff7d586164b4dd4294aed026c953`; see
  `docs/release/windows-full-install-2026-06-10.md`. This is partial evidence:
  native download/open-folder behavior was not counted as passed, so the
  `windows-native-release` gate remains pending.
- `pnpm verify:release:linux` now automates the Linux package checks that can be
  safely run in CI or a Linux shell: AppImage/unpacked executable inspection,
  unpacked app Xvfb launch, direct AppImage launch when FUSE is available,
  AppImage extraction, and extracted app Xvfb launch. Set
  `IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1` during native Linux validation
  to make direct AppImage execution mandatory.
- Direct AppImage execution in Docker remains blocked by missing FUSE device
  support, so this is not a substitute for native Linux desktop validation.
- Windows native full-install validation has been performed, but native
  download/open-folder validation is still pending.

Run on each native platform:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
pnpm package
pnpm verify:release:windows  # Windows only
pnpm verify:release:linux    # Linux only
```

For native Linux desktop validation, require direct AppImage execution:

```bash
IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1 pnpm verify:release:linux
```

Manual platform checks:

- packaged app launches
- mock API key and base URL can be configured
- OpenAI connection test succeeds against `http://127.0.0.1:8787/v1`
- Gemini connection test succeeds against `http://127.0.0.1:8788/v1beta`
- generation, edit, multi-image edit, and inpaint paths can be exercised through
  the mock-backed app or equivalent verifier
- download works
- open-folder behavior works for that OS

Record OS/version, package artifact paths, launch results, and any
platform-specific notes in `docs/release/evidence.json`, `CHECKLIST.md`, and
`COMPLETION_AUDIT.md`, then run `pnpm verify:release-evidence` and close the
related tracking issue if one exists.

## Final Completion Pass

After all external blockers are closed:

```bash
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
pnpm verify:release:mac
pnpm verify:release-evidence -- --require-complete
git status --short --branch
```

Completion requires a clean and synced release branch, current audit docs, and
real evidence for the actual API, release, CI, and native-platform gates.
