# Contributing to image2tools

Thank you for your interest in contributing! / 感谢你的参与意愿！

---

## Development Setup / 开发环境搭建

Requirements / 环境要求:
- Node.js 20+
- pnpm 10+

```bash
pnpm install
pnpm dev:electron
```

---

## Code Standards / 代码规范

- TypeScript strict mode is enforced (`"strict": true` in tsconfig). No `any` without explicit justification.
- Components: one component per file, named exports preferred, props typed with interfaces.
- Keep side effects out of render; use hooks or store actions.

---

## Testing Requirements / 测试要求

Before opening a PR, these must pass locally:

```bash
pnpm build           # must complete without errors
pnpm verify:mock-api # mock API smoke test
```

All new provider adapters must include a corresponding mock test (see below).

---

## PR Workflow / PR 流程

Branch naming / 分支命名:
- `feature/<short-description>`
- `fix/<short-description>`

Commit format / Commit 格式:
```
type: subject

# type = feat | fix | docs | refactor | test | chore
# subject: imperative, lowercase, no period
```

PR requirements / PR 要求:
1. CI must pass (build + mock-api verification).
2. Include a brief description of what changed and why.
3. Link any related issues.

---

## Adding a New Provider Adapter / 新增 Provider Adapter

Four steps / 四步流程:

1. **Implement the interface** — create `src/providers/<name>.ts` implementing `ProviderAdapter`.
2. **Register** — add an entry in `src/providers/registry.ts`.
3. **Catalog entry** — add the provider metadata to `src/config/providerCatalog.ts`.
4. **Mock test** — add a mock test under `tests/providers/<name>.mock.test.ts` and ensure `pnpm verify:mock-api` covers it.

---

## Security / 安全规范

- Never commit API keys, tokens, or secrets. Use `.env.local` (gitignored).
- Error messages shown to the user must not include raw API responses that may contain key material.
- Sanitize provider error messages before surfacing them in the UI.

---

## License / 许可证

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
