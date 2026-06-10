# Windows Full-Install Verification - 2026-06-10

This note records the first external full-install verifier evidence for the
`windows-native-release` gate. It is complemented by
`docs/release/windows-native-download-open-folder-2026-06-10.md`, which records
the follow-up native download/open-folder acceptance that completed the gate.

## Source

- Repository: `https://github.com/Bliveren/image2tools`
- Branch / commit tested: `main` / `e6587d2e3e2bff7d586164b4dd4294aed026c953`
- Package version: `0.2.0`
- Primary artifact: `release\Image2Tools-Setup.exe`
- Source note: user-provided Windows test history, redacted into this tracked
  evidence note.

## Command

```powershell
$env:IMAGE2TOOLS_WINDOWS_VERIFY_MODE='full-install'; corepack pnpm@10.25.0 verify:release:windows
```

## Result

Passed.

Verifier coverage reported by the test note:

- Windows installer PE check passed.
- `release\win-unpacked\Image2Tools.exe` PE check passed.
- Unpacked app launch, main-window detection, and 12-second stability smoke
  passed.
- NSIS silent install passed.
- Installed app launch, main-window detection, and 12-second stability smoke
  passed.
- Silent uninstall passed.
- Final verifier output included `Silent Windows install/uninstall cycle passed.`
  and `Windows release verification passed.`

Post-verification cleanup reported by the test note:

- No residual Image2Tools / Electron process was found.
- No residual Image2Tools install registry entry was found.
- Git worktree status was clean: `## main...origin/main`.

Supplemental packaged-app bridge checks reached OpenAI / Gemini mock provider
configuration, discovery, connection, and generation through the packaged app
bridge.

## Follow-Up Windows Evidence

Native download/open-folder acceptance was completed in a follow-up Windows
test run against commit `4b4dd18ff4255fcb4bfb2a25fadde7bbf788eafd`; see
`docs/release/windows-native-download-open-folder-2026-06-10.md`. The
`windows-native-release` gate is now marked passed in the release evidence
ledger.
