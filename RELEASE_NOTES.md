# Image2Tools Release Notes

## v0.3.0 (release candidate)

Productivity release focused on multi-API management and reusable prompt workflows.

### Multi-API management

- Save multiple API access profiles for OpenAI, Gemini, and OpenAI-compatible Custom endpoints.
- Switch API profiles without re-entering keys, Base URLs, model discovery results, or model-specific launch settings.
- Keep API connectivity and model discovery scoped to the active API profile so GPT Image 2, Nano Banana 3, and General launch availability follows the models exposed by the selected key.
- Preserve the current prompt and references while switching profiles; incompatible model states show validation guidance instead of silently clearing user work.

### Prompt workflow

- Add a local prompt template library with search, tags, categories, edit/delete, and JSON import/export.
- Add a managed reference Gallery. Imported images are copied into the app's user data directory, can be tagged/searched, and can be reused as references without exposing arbitrary local file paths to the renderer.
- Add prompt chips: `@` inserts a Gallery reference, `~` expands a saved template, and `#` adds a color value. Jobs still submit the same stable backend contract: plain text `prompt` plus `inputAssets` and params.
- History reuse intentionally degrades back to plain text prompt content, keeping older jobs compatible without storing renderer-specific chip schema.

### Safety and compatibility

- State v3 is extended with optional `promptTemplates` and `galleryAssets` arrays without a destructive state-version bump.
- Gallery previews use the managed `image2tools-asset://` protocol and filename-only Gallery reads; symlink escape and malformed migration cases are covered by tests.
- Prompt-template and Gallery IPC are kept behind the existing main/preload boundary, with renderer smoke coverage for creation, import/export, Gallery selection, deletion confirmation, and chip serialization.

### Release gates

- Automatic validation required before final release:
  - `pnpm build`
  - `pnpm verify:mock-api`
  - `pnpm verify:mock-gemini-api`
  - `pnpm verify:mock-model-discovery`
  - `pnpm verify:release-evidence`
- Final publication is still gated by v0.3.0 macOS signed/notarized artifacts, Windows installer validation, v0.3.0 update manifest assets, and refreshed real API acceptance evidence.

---

## v0.2.3 (unsigned preview)

Compatibility and UX patch release. Fixes aggregator streaming compatibility issues and adds image preview context menu.

### Compatibility

- **Disable streaming for all OpenAI jobs**: Aggregator endpoints reject SSE for `/images/generations` as well as edits. Streaming is now disabled globally to ensure compatibility with all providers. Partial previews provided minimal value in practice since results arrive as complete images.

### Features

- **Image preview context menu**: Right-click on preview images (main canvas or modal) to access:
  - Save Image — quick download without toolbar
  - Open Folder — open the asset's folder in Finder/Explorer
  - Copy Prompt — copy the job's prompt to clipboard

### Internal

- Frontend adapted to support multi-provider backend architecture (v0.3.0 prep). UI remains single-provider; multi-provider selection is deferred to v0.3.0.
- Updated state migration tests for v1/v2 → v3 compatibility.

---

## v0.2.2 (unsigned preview)

Experience and open-source presentation release on top of v0.2.1. Real
OpenAI (gpt-image-2) and Gemini (gemini-3.1-flash-image) API acceptance has
been re-run against a cost-approved OpenAI-compatible image aggregator endpoint
(see `docs/release/evidence.json`).

### Experience

- Result viewer reworked into a dedicated image preview: mouse-wheel zoom that
  no longer scrolls the surrounding panel, double-click to open a full preview,
  and drag-to-pan when zoomed in. Zoom controls move into a canvas overlay.
- Provider info collapses to a compact inline chip beside the key status to
  save sidebar space.
- History gains newest/oldest sorting, and history result images can be dragged
  into the reference area.
- Drag-and-drop image files from the OS onto the reference area to import them.

### Fixes

- External drag-drop upload now resolves dropped file paths through
  `webUtils.getPathForFile` instead of the non-standard `File.path`, which
  Electron 32+ removed — drag-drop import works again in packaged builds.

### Open-source presentation

- README showcase now uses real product screenshots instead of placeholders.
- Added a Download & Install section with macOS Gatekeeper quarantine bypass
  (`xattr -dr com.apple.quarantine`), Windows SmartScreen guidance, and SHA256
  verification instructions against `docs/updates/latest.json`.
- README header adds dynamic badges (release, CI, last commit, stars) alongside
  the license/platform/stack badges.
- GitHub About description and repository topics expanded for discoverability.

## v0.2.1

Status: unsigned preview prerelease. This bugfix and UX release is based on
post-0.2.0 user feedback. macOS builds are ad-hoc signed and not
Apple-notarized, so Gatekeeper may warn on first launch. Real OpenAI/Gemini API
acceptance and Developer ID signing/notarization are still tracked in
`docs/release/evidence.json`.

- Reference-image editing no longer fails against aggregator/proxy backends:
  edit and inpaint requests are now sent without SSE streaming, which fixes the
  "provider returned non-SSE response for streaming request" error. Text-to-image
  streaming previews are unchanged.
- The provider dropdown is gone. The app now auto-detects the provider from the
  configured base URL and from model discovery, and shows the detected provider
  read-only. Changing the base URL on a saved key re-runs discovery.
- The three mode tabs (generate/edit/inpaint) are collapsed into two: Text to
  image and Image to image. The mask is now an optional input under Image to
  image rather than a separate tab. Internal routing and Gemini guided-region
  behavior are unchanged.

## v0.2.0

Status: unsigned preview prerelease. macOS and Windows artifacts are published for evaluation. macOS builds are ad-hoc signed and not Apple-notarized, so Gatekeeper may warn on first launch (right-click > Open, or remove the quarantine attribute). Developer ID signed and notarized distribution is tracked for a future release.

## Highlights

- Multi-model workspace for GPT Image 2, Nano Banana 3, and General launch flows.
- Refined left sidebar with separate model configuration, launch model, parameter configuration, draft, notice, and update areas.
- Model configuration now runs automatic connection checks on startup and after saved API config changes. The UI shows connection status beside the model configuration title and surfaces friendly failure guidance.
- Model discovery can infer provider/model availability from the configured API and enables launch families based on discovered models rather than only the selected provider label.
- OpenAI provider path keeps GPT Image 2 generation, editing, exact-mask inpainting, streaming partial previews, downloads, and history.
- GPT Image 2 multi-output generation now uses non-stream requests when count is greater than one, backfills providers that return fewer images than requested, and shows selectable final-result thumbnails in the canvas.
- Gemini provider path adds the app's Nano Banana 3 launch target for discovered Gemini image models such as `gemini-3.1-flash-image` and `gemini-3-pro-image`, with `generateContent` image generation, reference-image editing, guided-region editing, and Gemini-specific controls.
- Launch model buttons now include concrete discovered-model choices when multiple compatible models are available under the same launch family.
- General launch mode is a minimal fallback for discovered non-focused image models. Gemini General supports prompt and reference images; OpenAI and Custom General use a prompt-only OpenAI-compatible `/images/generations` contract.
- History entries now retain provider/model context so reused prompts restore the matching launch model and parameters.
- Clearing all recent-task history now requires explicit confirmation.
- Update checks now default to the raw GitHub manifest URL to avoid the previous GitHub Pages 404. The sidebar shows an automatic up-to-date status, saves the current draft before update launch, and starts the Windows NSIS installer in silent mode with app restart after installation.

## Verification Gates

Before publishing `v0.2.0`, run:

```bash
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

OpenAI real API acceptance is cost-gated through:

```bash
IMAGE2TOOLS_API_KEY=sk-... IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 pnpm verify:real-api
```

Gemini / Nano Banana 3 real API acceptance is cost-gated through:

```bash
IMAGE2TOOLS_GEMINI_API_KEY=... IMAGE2TOOLS_REAL_GEMINI_API_ACCEPT_COST=1 pnpm verify:real-gemini-api
```

The verifier covers discovery, generation, reference editing, and guided-region editing. Do not mark Gemini real acceptance complete until the verifier and app-level history/download checks pass with a real Gemini key.

Release package verification remains platform-specific:

```bash
pnpm verify:release:mac
pnpm verify:release:windows
pnpm verify:release:linux
```

Re-run the secret scan in [SECURITY.md](./SECURITY.md) after every release-note or packaging metadata update.

The app package metadata is `0.2.0`. For this unsigned preview, `docs/updates/latest.json`
publishes the darwin (arm64 dmg) and win32 (x64 installer) assets with verified URL,
`sha256`, and `sizeBytes` metadata generated from the exact uploaded artifacts. When
Developer ID signed and notarized macOS artifacts become available, regenerate the
manifest from the signed build and supersede this preview.
