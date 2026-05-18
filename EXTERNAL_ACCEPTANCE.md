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
```

Current tracking milestone:
https://github.com/Bliveren/image2tools/milestone/1

## 1. Real Image 2 API Acceptance

Tracked by GitHub issue #1.

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
`CHECKLIST.md`, `TODO.md`, and `COMPLETION_AUDIT.md`, then close issue #1.

## 2. GitHub Actions Billing Gate

Tracked by GitHub issue #5.

Do not rerun known-failing workflows until the account billing or spending-limit
restriction is fixed. The current failure signature is jobs that fail before
workflow steps execute, with empty `steps` arrays.

After billing is fixed, rerun the latest failed workflow from the GitHub Actions
UI or use a fresh PR/push if rerun is unavailable. Acceptance requires:

- Build and mock API verifier job starts and passes
- macOS package job starts and passes, or a runner-policy issue is documented
- Windows package job starts and passes, or a runner-policy issue is documented
- Linux package job starts and passes, or a runner-policy issue is documented

Record the green run URL in `COMPLETION_AUDIT.md` and close issue #5 when CI
can execute normally.

## 3. Signed And Notarized macOS Release

Tracked by GitHub issue #3.

Prerequisites:

- Valid Developer ID Application signing identity on the build host
- Apple notarization credentials available only through local env vars or CI
  secrets
- Signing/notarization readiness passing locally. The default `pnpm package:mac`
  path intentionally remains unsigned; use `pnpm package:mac:signed` for the
  signed/notarized release path.

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

After success, update release metadata, `CHECKLIST.md`, `TODO.md`, and
`COMPLETION_AUDIT.md`, then close issue #3.

## 4. Windows And Linux Native Validation

Tracked by GitHub issue #4.

Current partial evidence:

- Ubuntu/Debian Bookworm ARM64 Docker validation on the macOS host passed
  `pnpm build`, `pnpm verify:mock-api`, Linux AppImage packaging, AppImage
  extraction, and extracted-app launch under Xvfb.
- `pnpm verify:release:windows` now automates the Windows package checks that
  can be safely run in CI or a Windows shell: NSIS installer/unpacked executable
  PE metadata inspection, unpacked app launch, main-window detection, and a
  short process stability smoke interval, plus silent install / installed app
  launch / silent uninstall.
- `pnpm verify:release:linux` now automates the Linux package checks that can be
  safely run in CI or a Linux shell: AppImage/unpacked executable inspection,
  unpacked app Xvfb launch, AppImage extraction, and extracted app Xvfb launch.
- Direct AppImage execution in Docker remains blocked by missing FUSE device
  support, so this is not a substitute for native Linux desktop validation.
- Windows native manual validation has not been performed.

Run on each native platform:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm verify:mock-api
pnpm package
pnpm verify:release:windows  # Windows only
pnpm verify:release:linux    # Linux only
```

Manual platform checks:

- packaged app launches
- mock API key and base URL can be configured
- connection test succeeds against `http://127.0.0.1:8787/v1`
- generation, edit, multi-image edit, and inpaint paths can be exercised through
  the mock-backed app or equivalent verifier
- download works
- open-folder behavior works for that OS

Record OS/version, package artifact paths, launch results, and any
platform-specific notes in `CHECKLIST.md` and `COMPLETION_AUDIT.md`, then close
issue #4.

## Final Completion Pass

After all four external blockers are closed:

```bash
pnpm build
pnpm verify:mock-api
pnpm verify:release:mac
git status --short --branch
gh pr list --state open
gh issue list --state open
```

Completion requires no open project-blocking issues, no open PRs, clean and
synced `main`, current audit docs, and real evidence for the actual API,
release, CI, and native-platform gates.
