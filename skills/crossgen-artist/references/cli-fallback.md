# JSON CLI Fallback

Use the CrossGen executable discovered by `crossgen doctor --agent --json` (or the path supplied by the host). Keep `--json` on every command so an agent never has to parse presentation output.

## Readiness and selection

```bash
crossgen doctor --agent --json
crossgen config status --json
crossgen provider list --json
crossgen models list --json
```

## Generation and editing

```bash
crossgen generate --prompt "..." --yes --wait --json
crossgen edit --prompt "..." --input ./reference.png --yes --wait --json
crossgen inpaint --prompt "..." --input ./reference.png --mask ./mask.png --yes --wait --json
```

For a background request, prefer `--enqueue-only --json`, capture the returned queue id, and poll:

```bash
crossgen job status <queue-id-or-history-job-id> --json
```

Use `--provider`, `--model`, `--size`, `--quality`, `--aspect-ratio`, and
`--resolution` only when `models list` shows that the selected capability
supports them. For GPT Image 2.5, the CLI also supports `--n`,
`--output-format`, `--output-compression`, `--background`, `--moderation`,
`--user`, `--input-fidelity`, `--image-route`, `--responses-model`,
`--responses-action`, `--previous-response-id`, `--stream`,
`--no-stream`, and `--partial-images`. Use `--idempotency-key` for retries.

Prefer `gpt-image-2.5-sunburst` for precise edits and `gpt-image-2.5-flare`
for fast everyday generation. In automatic route mode, `n > 1` uses Images API;
Responses-only controls are for one-image conversational turns.

`--user` is an opaque, stable safety identifier. It is serialized as `user` on
Images API requests and `safety_identifier` on Responses requests. Never put an
API key, email, filesystem username, or other directly identifying value in
this field; use a project/session token when a provider requires it.

## Gallery and export

```bash
crossgen gallery list --json
crossgen asset inspect <asset-id> --json
crossgen asset export <asset-id> --to ./out.png --yes --json
```

`--yes` is required for generation, editing, cancellation/retry, and export. Never put keys in command arguments; CrossGen reads its local provider configuration.

History and Gallery JSON is media-aware in v0.3.4. Use `kind`, `dimensions`,
`sizeBytes`, `durationMs`, `fps`, `frameCount`, and `hasPoster` when present.
Local `path`, `posterPath`, and preview URLs are intentionally omitted unless a
separate explicit path operation is confirmed.
