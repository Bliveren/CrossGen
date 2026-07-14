# Release Evidence

`evidence.json` records the external gates that cannot be completed from a
normal local development shell: real provider API acceptance, macOS Developer ID
signing, Apple notarization status, native Windows and Linux validation, and
formal update manifest assets.

Validate the ledger after every evidence update:

```bash
pnpm verify:release-evidence
```

The next-release candidate ledger can be checked before the package version is
bumped:

```bash
pnpm verify:release-evidence:v0.3.1
```

The verifier also checks guarded checklist and TODO items. External acceptance
items must stay unchecked until their matching evidence gate is marked `passed`.

Before publishing a release, require every required gate to be passed:

```bash
pnpm verify:release-evidence -- --require-complete
```

## Product Acceptance Lock

No CrossGen version may be published as a public GitHub Release, marked as
Latest, advertised through `docs/updates/latest.json`, or announced as released
until the product owner has completed hands-on testing of the exact local
installable package and explicitly approved the release.

This is a hard gate, not a recommendation:

- Automated CI, mock API checks, package creation, signing, notarization, and
  short smoke tests are necessary but never sufficient for release.
- The release candidate must be installed and tested as a real user would use
  it, including launch, provider configuration, text-to-image, image-to-image,
  Gallery/History reuse, image editing, save/download, and any changed feature
  area.
- The approval evidence must record the exact candidate commit, package path or
  artifact identity, test date, tested platform, issues found, and the product
  owner's explicit approval wording.
- Before that approval exists, GitHub Releases must remain draft-only and
  `docs/updates/latest.json` must continue to point at the last approved
  release.
- If a release is published before this gate is satisfied, immediately convert
  it back to draft, restore the update manifest to the last approved release,
  and record the withdrawal before further release work continues.

Release package workflows:

- `.github/workflows/release-windows.yml` builds the Windows installer, runs
  `pnpm verify:release:windows` in `full-install` mode, uploads the installer
  artifact, and publishes the installer plus blockmap to the matching GitHub
  Release.
- `.github/workflows/release-linux.yml` builds the Linux AppImage, runs
  packaged CLI/MCP smoke, agent integration smoke, and
  `pnpm verify:release:linux`, then uploads and publishes the AppImage.
- macOS Developer ID signing remains a local release-shell gate unless signing
  certificates are configured in GitHub Actions secrets.

External gate trackers:

| Gate | Tracker |
| --- | --- |
| Real OpenAI GPT Image 2 API acceptance | https://github.com/Bliveren/CrossGen/issues/1 |
| Real Gemini / Nano Banana 3 API acceptance | https://github.com/Bliveren/CrossGen/issues/102 |
| Developer ID signed macOS release package | https://github.com/Bliveren/CrossGen/issues/3 |
| Apple notarized macOS release package | https://github.com/Bliveren/CrossGen/issues/3 |
| Native Windows release package validation | https://github.com/Bliveren/CrossGen/issues/4 |
| CI Linux package and AppImage validation | https://github.com/Bliveren/CrossGen/issues/4 |
| Formal update manifest distribution assets | https://github.com/Bliveren/CrossGen/issues/103 |

Release-specific preparation:

- `v0.3.1`: [evidence.json](./evidence.json)
- `v0.3.1`: [v0.3.1-preflight.md](./v0.3.1-preflight.md)
- `v0.3.1`: [v0.3.1-evidence.json](./v0.3.1-evidence.json)
- `v0.3.0`: [v0.3.0-preflight.md](./v0.3.0-preflight.md)
- `v0.3.0`: [v0.3.0-evidence.json](./v0.3.0-evidence.json)
- `v0.3.0`: [v0.3.0-closeout.md](./v0.3.0-closeout.md)
- `v0.3.0`: [v0.3.0-rc-macos-local-package.md](./v0.3.0-rc-macos-local-package.md)

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
- For v0.3.1, `docs/release/evidence.json` is the active release ledger after
  the `package.json` version bump. Keep `docs/release/v0.3.1-evidence.json`
  aligned as the version-specific ledger used by compatibility checks while
  release evidence is still being completed.
