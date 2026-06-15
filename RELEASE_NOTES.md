# Image2Tools Release Notes

## v0.2.2 (unsigned preview)

Bugfix, UX, and open-source presentation release based on post-0.2.0 user
feedback. Real OpenAI/Gemini API acceptance must be re-run before publishing
(see `docs/release/evidence.json`).

### Fixes

- Reference-image editing no longer fails against aggregator/proxy backends:
  edit and inpaint requests are now sent without SSE streaming, which fixes the
  "provider returned non-SSE response for streaming request" error. Text-to-image
  streaming previews are unchanged.

### Experience

- The provider dropdown is gone. The app now auto-detects the provider from the
  configured base URL and from model discovery, and shows the detected provider
  read-only. Changing the base URL on a saved key re-runs discovery.
- The three mode tabs (generate/edit/inpaint) are collapsed into two: Text to
  image and Image to image. The mask is now an optional input under Image to
  image rather than a separate tab. Internal routing and Gemini guided-region
  behavior are unchanged.
- Provider info panel collapses to save sidebar space.
- Image preview is reworked: zoom with the mouse wheel without scrolling the
  surrounding panel, and a dedicated preview viewer.
- History gains newest/oldest sorting and drag-to-reorder.
- Drag-and-drop image upload onto the workspace.

### Open-source presentation

- README showcase now uses real product screenshots instead of placeholders.
- Added a Download & Install section with macOS Gatekeeper quarantine bypass
  (`xattr -dr com.apple.quarantine`), Windows SmartScreen guidance, and SHA256
  verification instructions against `docs/updates/latest.json`.
- README header adds dynamic badges (release, CI, last commit, stars) alongside
  the license/platform/stack badges.
- GitHub About description and repository topics expanded for discoverability.

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
