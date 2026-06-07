# Security and Open Source Readiness

Image2Tools is designed to be published as an MIT-licensed desktop tool. This
document records the security and privacy checks expected before each public
release.

## Secret Handling

- Do not commit real API keys, provider tokens, Apple credentials, certificates,
  or packaged state files.
- Runtime API keys are stored only in the Electron user data directory. They are
  encrypted with Electron `safeStorage` when available, with a clearly marked
  local fallback only for platforms that cannot use OS-backed storage.
- The repository intentionally ignores `.env`, `.env.*`, logs, release output,
  build output, coverage, and real API artifacts.
- Mock keys such as `sk-mock-image2tools` and `sk-test-key` are test fixtures,
  not real credentials.

## Local Data

The app stores generated images, history, drafts, and encrypted API key material
under Electron `app.getPath("userData")`. These files are not part of the
repository and must not be copied into public releases as source artifacts.

## Network and Provider Notes

- Real image requests are sent from the Electron main process to the configured
  OpenAI-compatible Base URL.
- Renderer DevTools may not show those main-process requests.
- Error messages are surfaced in the UI, but likely OpenAI-style `sk-...` API
  keys are redacted before display or persistence.

## Pre-Publication Checklist

Run these checks before making the repository public:

```bash
git status --short
rg -n "sk-[A-Za-z0-9_-]{8,}|Bearer |Authorization|apiKey|encryptedApiKey|secret|password|token|private|/Users/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|github\\.com/.+/milestone|release/tag|origin/archive" \
  -g '!node_modules' -g '!dist*' -g '!release' -g '!pnpm-lock.yaml'
find . -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -name '*state*.json' -o -name '*secret*' \) \
  -not -path './node_modules/*' -print
git ls-files | rg '(^|/)(dist|dist-renderer|release|real-api-artifacts|node_modules)/|\.env|\.pem|\.p12|state\.json|\.DS_Store' || true
pnpm build
pnpm verify:mock-api
```

Review every search hit. Fixture keys, code symbols, and documented environment
variable names are acceptable; real credentials, private release links, local
state dumps, and personal paths are not.

Also run an internal project-specific scan for any known private domains,
personal identifiers, old draft release names, or account-specific URLs before
switching the repository to public.

## Reporting Issues

For a public repository, report security issues through a private GitHub
Security Advisory when available. Do not include API keys or generated private
images in public issue bodies.
