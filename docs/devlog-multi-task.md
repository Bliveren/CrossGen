# Development Log: Multi-task workspace + image tooling + model alias mapping

## Summary
Adds a multi-task workspace (run several independent generations in
parallel, each with its own API provider / prompt / params / references /
result), richer reference-image tooling (paste image data anywhere, drag &
keyboard reorder, resizable panel, non-file/base64 references), and a
per-provider model-name mapping for API relays (including a 1K/2K/4K
"split" mode). The durable queue executes multiple tasks concurrently
(configurable) and is surfaced as a global panel next to the task API
selector. Parameter dropdowns were replaced with a theme-aware custom
select that auto-flips above/below. A per-provider "Gemini 使用像素尺寸"
toggle sends explicit WxH pixel sizes (mapped from aspect ratio + tier),
matching how relay dashboards like LTG build requests, so relays that
ignore the aspectRatio field still produce the chosen ratio.

## What changed

Backend / shared:
- `RunJobRequest` accepts optional `providerId` and `inputDataUrls`: jobs
  target the provider the task actually uses, and pasted/base64 references
  no longer require a local file path.
- Queue concurrency is configurable (1-8) via a new `queue:configSet` IPC;
  `queue:remove` lets terminal tasks (failed/interrupted/cancelled) be
  cleared from the queue.
- Gemini batch output `outputCount` 1-4 (adapter sends `imageCount`);
  OpenAI `n` (1-10) was already supported.
- Model alias mapping is persisted per provider; split mode rewrites the
  request model to the relay's per-resolution name and rejects unmapped
  tiers before the request is sent.
- Gemini pixel-size relay adaptation: `geminiPixelSize` on the provider
  config makes the Gemini adapter send an explicit pixel size (e.g.
  `1152x2048` for 9:16 2K) instead of `aspectRatio` + `1K/2K/4K`; a
  pixel table mirrors the relay dashboards' known-good sizes, with a
  long-side/pixel-limit fallback for 21:9 and 0.5K.

Renderer:
- Task tabs: each task owns its provider selection, prompt, params,
  references and result; the history/gallery rail stays shared. The tab
  strip scrolls horizontally with the mouse wheel.
- Reference panel: paste image data (clipboard image or `data:image/...`
  text) anywhere in the workspace, drag reorder, number-key reorder
  (1-9), resizable panel height, and content clipped to the tile frame.
- API config dialog: model-alias mapping UI (with split mode) and a
  scrollable body; mapping rows use a single header row of column labels.
  A "Gemini 使用像素尺寸" checkbox (relay adaptation) lives above the
  alias section.
- Parameter config: custom themed dropdowns (same style as the task API
  selector) with constant width and auto up/down menu placement.
- The global generation queue moved into the sidebar near the task API
  section, with per-task remove/retry/cancel actions.

Operational:
- `dev:electron` / `start` compile the main process with `tsc` directly so
  a broken PATH `pnpm` shim can no longer break the dev launch.
- DevTools no longer auto-open in dev mode; opt in with
  `CROSSGEN_OPEN_DEVTOOLS=1`.

## Design notes
- Per-task state lives in a renderer task store keyed by task id; only the
  active task's workspace is mounted, so the existing UI stays intact.
- Split mode only enforces the 1K/2K/4K mapping for models that actually
  have alias entries; unmapped models (e.g. `gpt-image-2`) keep their
  original behavior.

## Compatibility
- Existing state files migrate without changes (all new fields optional).
- Defaults are unchanged: concurrency 1, no aliases, split mode off.
- The single-task flow and OpenAI `n` keep working as before.

## Testing
- `tsc` (renderer + main configs) clean.
- Vitest: 471 passed, 4 skipped. One pre-existing Windows
  symlink-permission test fails only on Windows without symlink privileges
  (unrelated to this change).
- `vite build` succeeds.

## Scope
31 files: backend + shared + renderer + tests + docs. Local launcher and
pnpm-specific convenience files (`start-windows.bat`, `.gitattributes`,
`pnpm-workspace.yaml`) are intentionally not part of this PR.

## Known limitations
- Draft autosave follows the active task only.
- Editor view state (zoom/annotations) resets when switching tasks;
  results, references and per-task settings are preserved.
