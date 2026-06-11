# Windows Full-Install Verification - 2026-06-10

This note records the full-install portion of the `windows-native-release`
gate. A follow-up native download/open-folder check completed the remaining
Windows evidence in
`docs/release/windows-native-download-open-folder-2026-06-10.md`.

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

Native download / open-folder automation was completed later on 2026-06-10 and
recorded in
`docs/release/windows-native-download-open-folder-2026-06-10.md`. The
`windows-native-release` gate is no longer pending after that follow-up evidence
is included in the release evidence ledger.
