# CrossGen CLI and MCP

CrossGen exposes the same local app state to terminal workflows and MCP hosts. The CLI defaults to read-only inspection unless a command asks for explicit confirmation with `--yes`.

The desktop app also exposes an **Agent access** section in the left sidebar.
It shows the current CLI status, packaged launcher path, MCP executable,
data/state paths, active provider, live queue workers, copyable diagnostics, and
client-specific MCP configuration snippets. It never edits shell startup files
or the system `PATH` automatically.

## Runtime

Desktop use does not require CLI or MCP setup. Open the CrossGen app, configure
API access, and use the UI normally.

For repository development, the Node wrapper remains available:

```bash
pnpm install
pnpm build:main
node dist/cli/crossgen.js --version --json
```

For installed packages, CLI and MCP are intentionally separate:

- Packaged MCP uses the bundled launcher with `--mcp` and shares one local worker on macOS/Linux.
- CLI uses the package-provided native launcher, which directly forwards to the
  CrossGen app executable with `--cli`.
- Installed CLI/MCP use does not require Node.js, npm, pnpm, or a global Node
  package.

The development Node wrapper is useful for local source-tree work. It launches
CrossGen through the first available runtime:

1. `CROSSGEN_APP_EXECUTABLE`
2. `CROSSGEN_ELECTRON_BIN`
3. repository `node_modules/.bin/electron`
4. common installed app locations

Use `--data-dir <path>` when an agent needs an isolated CrossGen data directory.
The development wrapper and package launcher both map it to `CROSSGEN_DATA_DIR`
and `CROSSGEN_USER_DATA_DIR`.

CI or other constrained Linux runners can set `CROSSGEN_APP_EXTRA_ARGS="--no-sandbox"` when launching a packaged app. The value is prepended to the Electron runtime arguments and is not enabled by default.

## CLI Setup

The installed app includes a small native launcher under its resources
directory. It forwards to the app executable and does not require Node.js.

On macOS, users who want a `crossgen` command can create a link to the launcher
from a directory already on their `PATH`, or from `~/.local/bin` if they choose
to add that directory themselves:

```bash
mkdir -p "$HOME/.local/bin"
ln -s "/path/to/CrossGen.app/Contents/Resources/cli/crossgen" "$HOME/.local/bin/crossgen"
```

Use the app's actual location. Do not assume `/Applications/CrossGen.app`; users
may run CrossGen from another directory or keep multiple builds. CrossGen should
not edit shell startup files automatically. If `~/.local/bin` is not on `PATH`,
show the status and let the user copy the needed shell configuration manually.

The desktop Agent access panel can enable or disable the managed user-level
launcher without touching shell files. On Windows it uses a marked shim at
`%LOCALAPPDATA%\CrossGen\bin\crossgen.cmd`; that directory still needs to be on
the user's `PATH` for a new terminal command to resolve. Existing unmanaged
files are never overwritten.

MCP does not require this link. Packaged MCP client configuration should call the
bundled `resources/cli/crossgen` launcher with `--mcp`; this keeps the launcher,
broker, and app version aligned. Direct app-executable mode remains useful for
development and explicit diagnostics.

## Agent Checks

```bash
crossgen --version --json
crossgen doctor --agent --json
crossgen config status --json
crossgen provider list --json
crossgen models list --json
```

`doctor --agent` reports readiness without disclosing saved API keys. Its
machine-readable `data` includes:

- `runtimeKind`, `appExecutable`, `packagedExecutable`
- `dataDir`, `statePath`, `stateFound`
- `activeProvider`, `apiKeyAvailable`
- `liveWorkerHost`, `liveWorkerHosts`, `queueConfig`
- `cli.status`, `cli.commandPath`, `cli.launcherPath`, `cli.launcherExists`,
  `cli.linkPath`, `cli.linkExists`, and `cli.linkManaged`
- `cli.linkCommand`, `cli.unlinkCommand`, and `cli.repairHint`
- direct MCP command/args and all Codex, Claude Code, and Cursor mode snippets
- stable `permissions`, `knownLimitations`, and `nextActions`

CLI status values are explicit:

- `ready`: `crossgen` resolves to the current packaged launcher.
- `not-found`: no `crossgen` command is visible on the current process `PATH`.
- `stale`: a `crossgen` link exists but points to a missing target.
- `custom`: a `crossgen` command exists but points to another installation.
- `launcher-missing`: the packaged app does not contain its launcher.
- `development`: the current process is a source-tree/dev runtime.

The status is diagnostic only. CrossGen suggests a repair command but does not
modify shell files or inject a `PATH` entry. `asset path` is the only command
that returns a local absolute asset path, and it requires `--yes`.

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

## Release Smoke

```bash
pnpm verify:cli-mcp-smoke
pnpm verify:agent-integration-smoke
```

The smoke verifier runs against an isolated data directory and a local mock OpenAI-compatible image API. It checks CLI discovery, `NO_LIVE_QUEUE_WORKER`, queue-backed mock generation, Gallery import/export, MCP readonly/write tool registration, and MCP generate/edit execution.

The agent integration smoke checks `doctor --agent`, `mcp config` output for Codex, Claude Code, and Cursor, MCP mode-specific tool registration, confirmation-required errors, and secret/path redaction for agent-facing outputs that should not disclose local asset paths.

Package release gates should additionally run the smoke scripts against the
packaged app or packaged launcher rather than only `node dist/cli/crossgen.js`.
Set a package launcher command in the smoke environment when validating the
installed no-Node path.

Examples:

```bash
# Validate the packaged app executable directly. The smoke scripts add --cli
# for CLI calls and --mcp for MCP calls.
CROSSGEN_APP_EXECUTABLE="/path/to/CrossGen" pnpm verify:cli-mcp-smoke

# Validate the packaged CLI launcher. The launcher adds --cli itself and
# special-cases --mcp.
CROSSGEN_SMOKE_CLI_COMMAND="/path/to/resources/cli/crossgen" pnpm verify:cli-mcp-smoke

# If using an explicit command instead of CROSSGEN_APP_EXECUTABLE, pass the
# required prefixes yourself.
CROSSGEN_SMOKE_CLI_COMMAND="/path/to/CrossGen" CROSSGEN_SMOKE_CLI_ARGS='["--cli"]' \
CROSSGEN_SMOKE_MCP_COMMAND="/path/to/CrossGen" CROSSGEN_SMOKE_MCP_ARGS='["--mcp"]' \
pnpm verify:cli-mcp-smoke
```

## MCP Setup

Packaged MCP configuration uses the CLI launcher. On macOS and Linux, the
launcher reuses a per-user Unix-socket worker when several agent hosts connect
in parallel, so only the first session starts Electron. Windows uses a per-user
named-pipe worker for the same single-worker behavior.
The MCP runtime also exits when its host process disappears. Set
`CROSSGEN_MCP_IDLE_TIMEOUT_MS=0` to disable the idle guard in direct app mode,
or set a different timeout in milliseconds.

```bash
crossgen mcp config --client codex --mode readonly --json
crossgen mcp config --client codex --mode write --json
crossgen mcp config --client codex --mode generate --json
crossgen mcp config --client claude-code --mode readonly --json
crossgen mcp config --client cursor --mode readonly --json
```

The packaged server is started through the launcher:

```bash
/path/to/resources/cli/crossgen --mcp
```

The generated object contains `client`, `mode`, `transport`, `command`, `args`,
`env`, `format`, `config`, `snippet`, `permissions`, `supportedModes`, and an
optional generate-mode warning. The `snippet` is ready to paste into the
client's configuration: Codex uses a TOML `[mcp_servers.crossgen]` block;
Claude Code and Cursor use a JSON `mcpServers.crossgen` object. The desktop
Agent access panel presents the same snippets and uses the current packaged
launcher; it never assumes `/Applications/CrossGen.app`.

## CrossGen Artist Skill

The repository includes [`skills/crossgen-artist`](../skills/crossgen-artist/), a Codex-compatible skill for model discovery, prompt-to-image generation, reference-image editing, inpainting, durable job polling, Gallery inspection, and explicit asset export. It is intentionally versioned with CrossGen because it depends on the CrossGen CLI/MCP tool names and permission contract.

Install it for the current user from a CrossGen checkout:

```bash
mkdir -p "$HOME/.codex/skills"
ln -sfn "$(pwd)/skills/crossgen-artist" "$HOME/.codex/skills/crossgen-artist"
```

Use `$crossgen-artist` in Codex after installation. The skill does not store provider credentials and does not replace MCP configuration. Configure MCP separately from Agent access or `crossgen mcp config`; keep `readonly` as the default and opt into `write`/`generate` explicitly.

Packaged CrossGen releases should ship the matching skill directory (or a downloadable skill archive). A one-click skill installer and an in-app MCP mode switch are planned product conveniences; until then, CrossGen deliberately exposes copyable, client-specific snippets instead of modifying host configuration files without consent.

When CrossGen is running from the source tree, the generated `args` also include
the repository app path before `--mcp`; this keeps copied MCP configuration
usable with the Electron development runtime. Packaged installs use the
launcher form: `<resources>/cli/crossgen --mcp`.

Modes:

- `readonly`: inspect config, providers, models, queue, jobs, folders, and gallery assets.
- `write`: includes local Gallery and folder mutations.
- `generate`: includes write mode plus image generation and edit submission.

Generate mode can submit paid provider work. Commands that mutate state, disclose absolute paths, or export assets require explicit confirmation arguments.
