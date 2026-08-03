# Development Log: Multi-task workspace + image tooling + model alias mapping

## Summary
Adds a multi-task workspace (run several independent generations in
parallel, each with its own API provider / prompt / params / references /
result), richer reference-image tooling (paste image data anywhere, drag &
keyboard reorder, resizable panel, non-file/base64 references), and a
per-provider model-name mapping for API relays (including a 1K/2K/4K
"split" mode). The durable queue now executes multiple tasks concurrently
(configurable).

## What changed

Backend / shared:
- `RunJobRequest` accepts optional `providerId` and `inputDataUrls`: jobs
  target the provider the task actually uses, and pasted/base64 references
  no longer require a local file path.
- Queue concurrency is configurable (1-8) via a new `queue:configSet` IPC;
  several submitted tasks run in parallel.
- Gemini batch output `outputCount` 1-4 (adapter sends `imageCount`);
  OpenAI `n` (1-10) was already supported.
- Model alias mapping is persisted per provider; split mode rewrites the
  request model to the relay's per-resolution name and rejects unmapped
  tiers before the request is sent.

Renderer:
- Task tabs: each task owns its provider selection, prompt, params,
  references and result; the history/gallery rail stays shared.
- Reference panel: paste image data (clipboard image or `data:image/...`
  text) anywhere in the workspace, drag reorder, number-key reorder
  (1-9), resizable panel height.
- API config dialog: model-alias mapping UI (with split mode) and a
  scrollable body.

Operational:
- `dev:electron` / `start` compile the main process with `tsc` directly so
  a broken PATH `pnpm` shim can no longer break the dev launch.
- DevTools no longer auto-open in dev mode; opt in with
  `CROSSGEN_OPEN_DEVTOOLS=1`.
- `.gitattributes` pins LF for text files (`.bat/.cmd/.ps1` stay CRLF).
- `start-windows.bat`: minimal Windows launcher (optional).

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
- Vitest: 464 passed, 4 skipped. One pre-existing Windows
  symlink-permission test fails only on Windows without symlink privileges
  (unrelated to this change).
- `vite build` succeeds.

## Scope
27 files: backend + shared + renderer + tests + small operational files.
`start-windows.bat` and `.gitattributes` are optional conveniences and can
be dropped if the maintainers prefer a narrower diff.

## Known limitations
- Draft autosave follows the active task only.
- Editor view state (zoom/annotations) resets when switching tasks;
  results, references and per-task settings are preserved.
