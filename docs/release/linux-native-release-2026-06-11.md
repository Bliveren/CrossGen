# Linux Native Release Verification - 2026-06-11

This note records external evidence for the `linux-native-release` gate.

## Source

- Repository: `https://github.com/Bliveren/CrossGen`
- Branch / commit tested: `main` /
  `c4eed447fcbfd14a19c4f58ff9eab5dbd125d33c`
- Package version: `0.2.0`
- Linux environment: Ubuntu 24.04.4 LTS (Noble Numbat), kernel
  `6.6.87.2-microsoft-standard-WSL2`, x86_64.
- Artifacts checked:
  - `release/Image2Tools-0.2.0-linux-x86_64.AppImage` (120,155,057 bytes)
  - `release/linux-unpacked/image2tools`
- AppImage SHA-256:
  `6fc4a0ed9b1a33435bd75d0cdf54eb16d6f4724aa4f4d3533252b7e7c9589ebc`

## Release Verifier Result

```bash
IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1 IMAGE2TOOLS_LINUX_SMOKE_TIMEOUT_MS=15000 node scripts/verify-linux-release.mjs
```

Result: passed.

Verifier coverage included:

- ELF 64-bit executable assertions on both AppImage and unpacked binary.
- Unpacked Linux app launch under Xvfb, stable for 15000ms.
- Direct AppImage execution (FUSE-backed, mandatory via
  `IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1`), stable for 15000ms.
- AppImage extraction (`--appimage-extract`), extracted binary ELF check, and
  extracted app launch under Xvfb, stable for 15000ms.

Final verifier output: `Linux release verification passed.`

## Download and Open-Folder Behavior

Download (`downloadAsset`) and open-folder (`openAssetFolder`) functionality
relies on Electron's native `dialog.showSaveDialog` and `shell.showItemInFolder`
APIs respectively. These cannot be fully exercised in a headless WSL2 / Xvfb
environment because no file manager or native dialog handler is present.

The same IPC paths were verified on the Windows native platform
(see `docs/release/windows-native-download-open-folder-2026-06-10.md`). The
Electron API surface is shared between platforms; the Linux code paths are
identical and pass through the same `handleDownloadAsset` and
`handleOpenAssetFolder` handlers.

## Non-Fatal Output

The zygote communication warning (`Failed to send GetTerminationStatus message
to zygote`) is a known Electron/Chrome behavior in Xvfb and does not affect
functionality.
