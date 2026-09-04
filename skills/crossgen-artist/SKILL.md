---
name: crossgen-artist
description: Use CrossGen to plan and execute image generation, editing, inpainting, model selection, media-aware job monitoring, Gallery inspection, and asset export through MCP or its JSON CLI.
---

# CrossGen Artist

Use this skill when an agent needs to create or modify images through a local CrossGen installation. CrossGen owns provider credentials, model capability checks, the durable queue, and Gallery state; do not bypass it by calling an image provider directly unless the user explicitly asks for a separate integration.

## Choose a transport

1. Prefer the installed CrossGen MCP server when `crossgen_*` tools are available. The model-facing names are usually `mcp__crossgen__crossgen_<tool>`.
2. Otherwise use the JSON CLI (`crossgen ... --json`). Discover the executable with `crossgen doctor --agent --json`; do not assume an app path or disclose API keys.
3. If the host is DeepSeek Harness, read [references/harness-mcp.md](references/harness-mcp.md) for the stdio bridge configuration. Read [references/mcp-tools.md](references/mcp-tools.md) for the MCP contract and [references/cli-fallback.md](references/cli-fallback.md) for equivalent CLI calls.

## Standard workflow

1. **Check readiness.** Call `crossgen_config_status` or `crossgen doctor --agent --json`, then `crossgen_provider_list` and `crossgen_models_list`. Treat the model catalog as authoritative for provider/model compatibility.
2. **Clarify the visual task.** Convert the user's intent into a concrete prompt: subject, composition, style, lighting, materials, text requirements, aspect ratio, and exclusions. Preserve user-provided wording; only add structure that improves reproducibility. See [references/model-workflows.md](references/model-workflows.md).
3. **Select the operation.** Use generation for prompt-only output, edit for one or more reference images, and inpaint only when a mask is available and the selected adapter advertises support. Pass `providerId`/`model` only when needed; otherwise use the active compatible configuration.
4. **Confirm immediately before side effects.** Generation, editing, cancellation, retry, Gallery mutations, path disclosure, and export require explicit user authorization. For MCP calls this is `confirm: true`; for CLI calls use `--yes`. Never infer confirmation from an earlier conversational turn when the request has materially changed.
5. **Use idempotency for paid retries.** Set a stable `idempotencyKey` when a request may be retried or a host may reconnect. Do not submit a second paid request merely because the first call returned before completion.
6. **Monitor the durable job.** Use `waitMs` only as a short convenience wait. Then poll `crossgen_job_status` (or `crossgen job status`) until a terminal state, with a bounded backoff. On failure, report the diagnostic and retry only with authorization.
7. **Handle results through Gallery.** Use `crossgen_gallery_list` and `crossgen_asset_inspect` for metadata. Export with `crossgen_asset_export` only when the user specifies a destination and confirms it; do not rely on undisclosed absolute paths.
8. **Report precisely.** Include the model/provider used, job id, terminal status, asset id(s), and any next action. Do not include API keys or local absolute paths unless explicitly requested and confirmed.

## Model-aware behavior

- Inspect capabilities before presenting controls. A disabled or missing model is unavailable for the current provider/key; do not silently substitute another model.
- Keep provider-specific options namespaced to their adapter: OpenAI commonly uses `size` and `quality`; Gemini commonly uses `aspectRatio` and `resolution`. Omit unsupported fields rather than guessing.
- When the user asks for multiple concepts, prefer one durable request per concept with distinct idempotency keys unless the selected model explicitly supports batching.
- For edits, verify that every input path exists and is readable before submitting. Keep the original reference unchanged and describe the requested transformation separately from preservation constraints.

## Media-aware behavior in v0.3.4

- Treat `crossgen_job_status`, `crossgen_gallery_list`, and
  `crossgen_asset_inspect` as media-aware contracts. Read `kind`,
  `dimensions`, `sizeBytes`, `durationMs`, `fps`, `frameCount`, and
  `hasPoster` when present instead of inferring type from a filename alone.
- Default CLI/MCP output intentionally omits local `path`, `posterPath`, and
  preview URLs. `hasPoster: true` means a poster reference exists in the local
  app; it is not visual proof that the poster is readable.
- v0.3.4 can import and inspect GIF/video assets and the desktop viewer can
  preview them within the host's codec support. GIFs are read-only previews;
  video and GIF assets are not valid reference-image, mask, Canvas-editing, or
  inpaint inputs.
- v0.3.4 does not expose real video generation, video editing, poster
  extraction, ffmpeg conversion, or video MCP tools. Do not present those as
  available capabilities; route that work to the v0.3.5 preview plan.
- Exporting a media asset still requires an explicit destination and
  confirmation. Use metadata to choose the next action, then ask for visual
  QA when fidelity matters.

## Safety and recovery

- CrossGen MCP `readonly` mode is safe for discovery; `generate` mode starts queue execution and can incur provider charges.
- MCP server processes run outside an agent sandbox in many Harness hosts. Treat the configured executable and working directory as trusted local code.
- If startup or model discovery fails, stop before a paid call and surface the actionable error. Read [references/cli-fallback.md](references/cli-fallback.md) for diagnostics.
