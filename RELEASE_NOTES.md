# Image2Tools Release Notes

## v0.2.4

Bugfix release for saved model configurations and Gemini image sizing.

### Fixes

- **Saved configurations are now unified with Model config**: the saved list shows every local configuration, including the current one, so a newly saved model configuration is immediately visible and can be selected later.
- **Configuration terminology is consistent**: the left rail now uses "Saved configurations", "Configuration name", and "Add configuration" instead of separating model config from API access wording.
- **Add configuration stays in the model configuration flow**: added configurations are created, saved, selected as current, and shown in the same saved-configuration list used for switching.
- **Gemini image size controls are sent through the Gemini image config field**: Gemini and Gemini General requests now send `generationConfig.imageConfig.aspectRatio` and `imageSize`, so selections such as `1:1` are passed to Gemini 3 Pro Image instead of being ignored.

---

## v0.2.3

Compatibility, release, and configuration UI patch release. Fixes aggregator streaming compatibility issues, adds image preview context menu, and restores the multi-API configuration experience before the final v0.2.3 package.

### Compatibility

- **Disable streaming for all OpenAI jobs**: Aggregator endpoints reject SSE for `/images/generations` as well as edits. Streaming is now disabled globally to ensure compatibility with all providers. Partial previews provided minimal value in practice since results arrive as complete images.

### Features

- **Image preview context menu**: Right-click on preview images (main canvas or modal) to access:
  - Save Image — quick download without toolbar
  - Open Folder — open the asset's folder in Finder/Explorer
  - Copy Prompt — copy the job's prompt to clipboard
- **Integrated multi-API configuration UI**: API access now lives inside model configuration. The active API is shown as a compact card with access name, URL, key state, and discovered-model count; expanded details expose key/Base URL/save/clear/discover controls. Saved inactive API profiles stay folded and can be expanded to switch.
- **Prompt template dialog**: Prompt templates are now opened from a single button below the prompt input instead of occupying left-rail space.
- **Right-rail Reference Gallery**: Reference Gallery now sits beside Recent Jobs in the right rail, and gallery images can be dragged into the reference area.
- **Prompt input cleanup**: Removed the unclear prompt chip dropdown controls and color-code entry field from below the prompt textarea.

### Release Assets

- macOS arm64 DMG/ZIP assets are Developer ID signed with `Xiamen Corgnitor Technology Co.,Ltd (RPX587R2R7)` and verified with the macOS release verifier. They are not Apple-notarized in this rebuild because notarization credentials were not configured in the release shell.
- Windows x64 installer is attached as `Image2Tools-Setup.exe`.
- `docs/updates/latest.json` contains the final v0.2.3 macOS and Windows asset URLs, SHA256 hashes, and byte sizes.

### Internal

- Frontend adapted to support the multi-provider backend architecture with user-visible provider switching in model configuration.
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
