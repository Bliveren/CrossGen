# CrossGen Known Limitations

Last updated: 2026-08-20 for v0.3.3 agent-access development.

This document tracks the current user-facing limits for the released app,
release-candidate validation, and agent runtime surfaces.

## Active Limitations

0. **Agent access is local and process-scoped**
   - The desktop Agent access panel and `doctor --agent` report the
     executable, launcher, PATH, data directory, queue worker, and permission
     state visible to the current CrossGen process.
   - PATH repair is advisory: CrossGen provides a copyable command but never
     edits shell startup files or injects a system PATH entry.
   - MCP hosts should call the current packaged CrossGen executable directly
     with `--mcp`; they do not need a global `crossgen` link.

1. **Generation requires network access and a provider API key**
   - CrossGen does not ship an offline image model or local GPU runtime in
     the current 0.3.x image runtime.
   - Desktop generation, CLI generation, and MCP generate mode all call the
     configured provider API.

2. **Agent generation is explicit and permissioned**
   - CLI and MCP default to read-only behavior.
   - MCP image generation is available only when the server is launched in
     `generate` mode.
   - Paid generation, destructive actions, queue-control changes, exports, and
     absolute-path disclosure require explicit confirmation such as `--yes` or
     MCP `confirm: true`.

3. **No HTTP server or background daemon**
   - MCP uses stdio only.
   - A queued async generation item needs a live worker host: the desktop app,
     MCP generate mode, or a waiting CLI worker.
   - If there is no live worker, async submission returns a machine-readable
     `NO_LIVE_QUEUE_WORKER` error instead of pretending work will continue in
     the background.

4. **Windows installer is not code-signed**
   - The Windows x64 NSIS installer is published and verified, but it is not yet
     Authenticode-signed.
   - Windows SmartScreen may warn on first launch.
   - macOS arm64 release assets are Developer ID signed and notarized.

5. **Image-only runtime through v0.3.2**
   - Capability metadata contains forward-compatible media fields, but video
     and animated GIF generation are not callable in v0.3.2.
   - Verified model capabilities report image output only.
   - Video, GIF, ffmpeg, and media-aware asset migration remain planned for
     later versions.

6. **Third-party compatible endpoints vary**
   - CrossGen probes OpenAI-compatible image routes and supports
     chat-completions-style image paths used by compatible gateways.
   - Some third-party relays only expose text-to-image behavior and do not
     support image edit/reference routes. In that case image-to-image may fail
     even when text-to-image works.
   - Text-to-image route verification is not treated as proof that
     image-to-image or guided-region edit is supported.
   - Mask/guided-region workflows are especially route-sensitive. If a
     compatible endpoint does not support image edit or guided edit semantics,
     CrossGen should surface a route/capability diagnostic instead of retrying
     indefinitely.
   - Use a provider route that supports image edit/reference requests, or use a
     Gemini-compatible image model for image-to-image workflows.

7. **Real provider gates are operation-specific**
   - v0.3.2 release candidates must be checked by provider kind, model,
     operation, route, timeout, input image count, mask usage, and output.
   - A provider-limited operation may be accepted only when the product surface
     shows a clear diagnostic and a usable next action.
   - A text-to-image success alone is not enough evidence for release approval.

8. **Reference-image preflight is non-destructive**
   - v0.3.2 can create smaller temporary request copies for oversized
     reference images. These copies are used only for provider requests and do
     not replace the user's original Gallery, History, or local files.
   - Queue and History diagnostics may show original/request dimensions, bytes,
     downsampling status, and alpha-channel metadata to explain request
     behavior.

9. **Linux package is verified but newer than the primary desktop target**
   - The Linux AppImage is published and release-verified in CI.
   - The primary interactive desktop target remains macOS and Windows.

## Released In v0.3.1

- The product-approved v0.3.1 release is available for macOS arm64, Windows x64,
  and Linux x64.
- macOS arm64 DMG/ZIP assets are Developer ID signed, Apple-notarized, stapled,
  and accepted by Gatekeeper.
- Windows x64 is published as an NSIS installer, and Linux x64 is published as
  an AppImage.
- CLI/MCP release smoke, agent integration smoke, queue concurrency smoke,
  and Gallery mutation smoke have all passed as part of the approved RC4
  testing line.
- The previous withdrawn-draft status is resolved; this is a full public
  release.
