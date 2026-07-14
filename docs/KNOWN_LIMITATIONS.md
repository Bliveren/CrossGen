# CrossGen Known Limitations

Last updated: 2026-07-14 for the withdrawn v0.3.1 candidate.

This document tracks the current user-facing limits for the released app and
agent runtime surfaces.

## Active Limitations

1. **Generation requires network access and a provider API key**
   - CrossGen does not ship an offline image model or local GPU runtime in
     v0.3.1.
   - Desktop generation, CLI generation, and MCP generate mode all call the
     configured provider API.

2. **Agent generation is explicit and permissioned**
   - CLI and MCP default to read-only behavior.
   - MCP image generation is available only when the server is launched in
     `generate` mode.
   - Paid or state-mutating operations require explicit confirmation such as
     `--yes` or MCP `confirm: true`.

3. **No HTTP server or background daemon**
   - MCP uses stdio only.
   - A queued async generation item needs a live worker host: the desktop app,
     MCP generate mode, or a waiting CLI worker.
   - If there is no live worker, async submission returns a machine-readable
     `NO_LIVE_QUEUE_WORKER` error instead of pretending work will continue in
     the background.

4. **Windows installer is not code-signed**
   - The Windows x64 installer is published and verified, but it is not yet
     Authenticode-signed.
   - Windows SmartScreen may warn on first launch.
   - macOS arm64 release assets are Developer ID signed and notarized.

5. **Image-only runtime in v0.3.1**
   - Capability metadata contains forward-compatible media fields, but video
     and animated GIF generation are not callable in v0.3.1.
   - Verified model capabilities report image output only.

6. **Third-party compatible endpoints vary**
   - CrossGen probes OpenAI-compatible image routes and supports
     chat-completions-style image paths used by compatible gateways.
   - Some third-party relays only expose text-to-image behavior and do not
     support image edit/reference routes. In that case image-to-image may fail
     even when text-to-image works.
   - Use a provider route that supports image edit/reference requests, or use a
     Gemini-compatible image model for image-to-image workflows.

7. **Linux package is verified but newer than the primary desktop target**
   - The Linux AppImage is published and release-verified in CI.
   - The primary interactive desktop target remains macOS and Windows.

## Resolved In v0.3.1

   - The v0.3.1 GitHub Release was withdrawn back to draft before product-owner
     acceptance.
   - The macOS arm64 DMG remains signed and notarized as historical packaging
     evidence, but it is not an approved public release.
   - CLI/MCP release smoke, agent integration smoke, queue concurrency smoke,
     and Gallery mutation smoke remain historical candidate evidence until a
     product-approved release is reissued.
