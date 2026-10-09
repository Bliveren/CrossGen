# DeepSeek Harness Bridge

DeepSeek Harness can mount CrossGen through its official `@deepseek-ai/dsh-mcp-client` Cordis plugin. CrossGen remains an external MCP server; do not install the CrossGen Electron package as a native Cordis plugin.

Use the executable path reported by CrossGen Agent access or `crossgen doctor --agent --json`. A profile `cordis.patch.yml` entry has this shape:

```yaml
- insert:
    - id: crossgen-image-runtime
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: crossgen
        transport: stdio
        command: /absolute/path/to/CrossGen
        args: ['--mcp']
        env:
          CROSSGEN_MCP_MODE: generate
        cwd: /path/to/workspace
        toolCallTimeoutMs: 420000
        failOnStartupError: true
        reconnect:
          enabled: true
          initialDelayMs: 500
          maxDelayMs: 30000
          maxAttempts: 10
```

The Harness model sees CrossGen tools as `mcp__crossgen__<raw-tool-name>`. Keep `readonly` mode for discovery and tests; use `generate` only when the user has authorized real provider calls. The MCP child process is trusted executable code outside the agent sandbox on Harness hosts, so review `command`, `args`, `env`, and `cwd` before enabling it.

Harness tool calls still follow CrossGen's confirmation contract: generation/edit/cancel/retry/export calls require `confirm: true`. A successful submission may be asynchronous; poll `mcp__crossgen__crossgen_job_status` until terminal, then inspect or export the resulting asset.
