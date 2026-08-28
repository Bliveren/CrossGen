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

Use `--provider`, `--model`, `--size`, `--quality`, `--aspect-ratio`, and `--resolution` only when `models list` shows that the selected capability supports them. Use `--idempotency-key` for retries.

## Gallery and export

```bash
crossgen gallery list --json
crossgen asset inspect <asset-id> --json
crossgen asset export <asset-id> --to ./out.png --yes --json
```

`--yes` is required for generation, editing, cancellation/retry, and export. Never put keys in command arguments; CrossGen reads its local provider configuration.
