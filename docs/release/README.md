# Release Evidence

`evidence.json` records the external gates that cannot be completed from a
normal local development shell: real provider API acceptance, signed/notarized
macOS release artifacts, native Windows and Linux validation, and formal update
manifest assets.

Validate the ledger after every evidence update:

```bash
pnpm verify:release-evidence
```

The verifier also checks guarded checklist and TODO items. External acceptance
items must stay unchecked until their matching evidence gate is marked `passed`.

Before publishing a release, require every required gate to be passed:

```bash
pnpm verify:release-evidence -- --require-complete
```

External gate trackers:

| Gate | Tracker |
| --- | --- |
| Real OpenAI GPT Image 2 API acceptance | https://github.com/Bliveren/image2tools/issues/1 |
| Real Gemini / Nano Banana 3 API acceptance | https://github.com/Bliveren/image2tools/issues/102 |
| Signed and notarized macOS release package | https://github.com/Bliveren/image2tools/issues/3 |
| Native Windows release package validation | https://github.com/Bliveren/image2tools/issues/4 |
| Native Linux desktop AppImage validation | https://github.com/Bliveren/image2tools/issues/4 |
| Formal update manifest distribution assets | https://github.com/Bliveren/image2tools/issues/103 |

Rules for updating evidence:

- Never include raw API keys, GitHub tokens, Apple credentials, private key
  blocks, or private home-directory paths.
- Record the exact commit SHA, OS/version, commands run, and a short summary for
  each passed gate.
- Prefer public HTTPS references such as GitHub Actions runs, release asset
  URLs, or tracking issues. Keep generated real API artifacts out of git unless
  they are explicitly approved public samples.
- Do not change checklist items from pending to complete until the matching
  evidence gate is marked `passed` and the validator succeeds.
