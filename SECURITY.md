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
- OpenAI and Gemini keys share the same local provider-config storage rules.
  Saved configs expose only `apiKeySaved` and a short masked preview to the
  renderer; the decrypted key is used by the main process when testing,
  discovering models, or running jobs.
- The repository intentionally ignores `.env`, `.env.*`, logs, release output,
  build output, coverage, and real API artifacts.
- Mock keys such as `sk-mock-image2tools`, `sk-test-key`, and
  `mock-gemini-key` are test fixtures, not real credentials.

## Local Data

The app stores generated images, history, drafts, and encrypted API key material
under Electron `app.getPath("userData")`. These files are not part of the
repository and must not be copied into public releases as source artifacts.

## Network and Provider Notes

- Real image requests are sent from the Electron main process to the configured
  provider Base URL.
- OpenAI requests use `Authorization: Bearer ...` against OpenAI Image API
  endpoints.
- Gemini model discovery uses `GET {baseURL}/models?key=...`; Gemini image jobs
  use `x-goog-api-key` with `generateContent`.
- Custom General fallback treats the configured Base URL as OpenAI-compatible and
  sends prompt-only image generation requests to `/images/generations`.
- Renderer DevTools may not show those main-process requests.
- Error messages are surfaced in the UI, but likely OpenAI-style `sk-...` API
  keys and repeated copies of the active configured API key are redacted before
  display or persistence.
- Gemini adapter and model-discovery errors redact likely Google API key forms
  such as `AIza...`, query-string `key=...`, and repeated copies of the active
  API key before display or persistence. Do not paste raw provider error logs
  into public issues unless they have been reviewed for credentials.
- Nano Banana 3 guided-region editing sends user-provided images and any
  mask/overlay guidance to Gemini as inline image data. Users must have rights
  to upload those images to the selected provider.

## Pre-Publication Checklist

Run these checks before making the repository public:

```bash
git status --short
rg -n "sk-[A-Za-z0-9_-]{8,}|Bearer |Authorization|apiKey|encryptedApiKey|secret|password|token|private|/Users/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|github\\.com/.+/milestone|release/tag|origin/archive" \
  -g '!node_modules' -g '!dist*' -g '!release' -g '!pnpm-lock.yaml'
rg -n "AIza[A-Za-z0-9_-]{8,}|x-goog-api-key|[?&]key=[A-Za-z0-9_-]{8,}" \
  -g '!node_modules' -g '!dist*' -g '!release' -g '!pnpm-lock.yaml'
find . -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -name '*state*.json' -o -name '*secret*' \) \
  -not -path './node_modules/*' -print
git ls-files | rg '(^|/)(dist|dist-renderer|release|real-api-artifacts|node_modules)/|\.env|\.pem|\.p12|state\.json|\.DS_Store' || true
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

Review every search hit. Fixture keys, code symbols, and documented environment
variable names, mock Gemini keys, and provider request-header names are
acceptable; real OpenAI keys, real Gemini keys, private release links, local
state dumps, and personal paths are not.

Also run an internal project-specific scan for any known private domains,
personal identifiers, old draft release names, or account-specific URLs before
switching the repository to public.

## Reporting Issues

For a public repository, report security issues through a private GitHub
Security Advisory when available. Do not include API keys or generated private
images in public issue bodies.
