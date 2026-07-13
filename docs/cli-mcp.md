# CrossGen CLI and MCP

CrossGen exposes the same local app state to terminal workflows and MCP hosts. The CLI defaults to read-only inspection unless a command asks for explicit confirmation with `--yes`.

## Runtime

Install dependencies in the repository or use an installed CrossGen app:

```bash
pnpm install
pnpm build:main
node dist/cli/crossgen.js --version --json
```

The packaged npm binary is `crossgen`. It launches CrossGen through the first available runtime:

1. `CROSSGEN_APP_EXECUTABLE`
2. `CROSSGEN_ELECTRON_BIN`
3. repository `node_modules/.bin/electron`
4. common installed app locations

Use `--data-dir <path>` when an agent needs an isolated CrossGen data directory. The wrapper maps it to both `CROSSGEN_DATA_DIR` and `CROSSGEN_USER_DATA_DIR`.

## Agent Checks

```bash
crossgen --version --json
crossgen doctor --agent --json
crossgen config status --json
crossgen provider list --json
crossgen models list --json
```

`doctor --agent` reports readiness without disclosing saved API keys. `asset path` is the only command that returns a local absolute asset path, and it requires `--yes`.

## Generate Flow

```bash
crossgen generate --prompt "A clean product photo" --folder null --yes --wait --json
crossgen edit --prompt "Make the background white" --input ./reference.png --folder null --yes --wait --json
crossgen job status <queue-id-or-history-job-id> --json
crossgen asset export <asset-id> --to ./out.png --yes --json
```

For durable background work:

```bash
crossgen generate --prompt "Four icon concepts" --yes --enqueue-only --json
crossgen queue status --json
crossgen job list --status queued --status running --json
crossgen job cancel <queue-id> --yes --json
crossgen job retry <queue-id-or-history-job-id> --yes --json
```

Queue concurrency is local runtime configuration:

```bash
crossgen queue config get --json
crossgen queue config set --max-global-running 1 --yes --json
crossgen queue config set --provider-concurrency <provider-id>=1 --yes --json
```

## Gallery Flow

```bash
crossgen folder tree --json
crossgen gallery list --folder null --json
crossgen gallery list --tag generated --query product --json
crossgen asset import ./reference.png --folder null --json
crossgen asset update <asset-id> --name "Hero concept" --tag generated --json
crossgen asset export <asset-id> --to ./hero.png --yes --json
```

Read-only list and inspect commands never include local absolute paths by default.

## MCP Setup

Generate host configuration with the CLI:

```bash
crossgen mcp config --client codex --mode readonly --json
crossgen mcp config --client codex --mode write --json
crossgen mcp config --client codex --mode generate --json
```

The server process is started with:

```bash
crossgen --mcp
```

Modes:

- `readonly`: inspect config, providers, models, queue, jobs, folders, and gallery assets.
- `write`: includes local Gallery and folder mutations.
- `generate`: includes write mode plus image generation and edit submission.

Generate mode can submit paid provider work. Commands that mutate state, disclose absolute paths, or export assets require explicit confirmation arguments.
