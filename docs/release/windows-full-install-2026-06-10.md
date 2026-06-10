# Windows Full-Install Verification - 2026-06-10

This note records partial external evidence for the `windows-native-release`
gate. It does not mark the gate complete because native download and open-folder
acceptance was not counted as passed.

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

## Remaining Windows Evidence

Native download / open-folder automation was not counted as passed because
native Save dialog automation remained unstable. The `windows-native-release`
gate remains pending until that behavior is checked on native Windows and
recorded in the release evidence ledger.
