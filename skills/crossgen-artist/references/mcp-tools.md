# CrossGen MCP Contract

Use the names exposed by `tools/list`; this table documents the stable CrossGen 0.3.x names. Hosts may add a namespace prefix such as `mcp__crossgen__`.

## Discovery and read-only tools

| Tool | Purpose |
|---|---|
| `crossgen_config_status` | Provider, storage, queue, and Gallery readiness without secrets |
| `crossgen_provider_list` | Configured providers and active provider |
| `crossgen_models_list` | Models and machine-readable capabilities |
| `crossgen_queue_status` / `crossgen_queue_config_get` | Worker and concurrency state |
| `crossgen_job_list` / `crossgen_job_status` | Durable queue/history state |
| `crossgen_gallery_list` / `crossgen_asset_inspect` | Gallery metadata without absolute paths |

## Generate mode tools

`crossgen_generate_image` accepts `prompt` and `confirm` plus optional `providerId`, `model`, `folderId`, `idempotencyKey`, `waitMs`, `timeoutMs`, `size`, `quality`, `aspectRatio`, `resolution`, and `referenceImageMode`.

`crossgen_edit_image` requires `prompt`, `inputPaths`, and `confirm`. It additionally accepts `maskPath`, the provider/model and adapter options above. A non-empty `maskPath` selects the inpaint path; only use it when the selected model supports it.

`crossgen_job_cancel` requires a queue id and confirmation. `crossgen_job_retry` requires a queue or history job id and confirmation.

`crossgen_asset_export` requires `assetId`, `to`, and `confirm`; `replace` is optional. Export is the preferred way to place a managed asset into a project.

## Result handling

Generation/edit calls may return an enqueue result before the provider finishes. Read the returned `queueId` or `historyJobId`, then poll `crossgen_job_status`. A successful terminal job identifies output asset ids; use Gallery inspection before export. MCP responses intentionally redact local absolute paths by default.

## Permissions

CrossGen must run with `CROSSGEN_MCP_MODE=readonly`, `write`, or `generate`. Only `generate` exposes image submission and queue execution. Every paid or destructive operation must carry `confirm: true`; treat confirmation errors as a hard stop, not as a reason to retry with weaker validation.
