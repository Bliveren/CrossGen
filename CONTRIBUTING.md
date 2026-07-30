# Contributing to CrossGen

Thanks for helping improve CrossGen. Contributions that make the desktop, CLI, or MCP image workflow more reliable and easier to use are welcome.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Use [GitHub Discussions](https://github.com/Bliveren/CrossGen/discussions) for workflow ideas, usage questions, and early proposals.
- Use an issue for reproducible bugs or a scoped feature request.
- Never include API keys, private images, local state files, or provider responses that may contain credentials.
- For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Development Setup

Requirements:

- Node.js compatible with the version used by CI
- pnpm 10
- macOS, Windows, or Linux

```bash
pnpm install
pnpm dev:electron
```

Run the standard validation before submitting a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Focused checks are also available:

```bash
pnpm verify:cli-mcp-smoke
pnpm verify:agent-integration-smoke
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

Mock checks do not spend provider credits. Do not run real-provider gates without explicit cost approval and local credentials.

## Pull Requests

1. Keep each pull request focused on one problem.
2. Add or update tests for behavior changes.
3. Update English and Chinese documentation together when user-facing behavior changes.
4. Describe the user impact and list the checks you actually ran.
5. Add screenshots for renderer changes and JSON examples for CLI or MCP contract changes.
6. Do not commit build output, release artifacts, local state, logs, or secrets.

By submitting a contribution, you agree that it is licensed under the repository's [MIT License](./LICENSE).
