# Windows Native Download/Open-Folder Verification - 2026-06-10

This note records follow-up external evidence completing the
`windows-native-release` gate.

## Source

- Repository: `https://github.com/Bliveren/image2tools`
- Branch / commit tested: `main` /
  `4b4dd18ff4255fcb4bfb2a25fadde7bbf788eafd`
- Package version: `0.2.0`
- Windows environment: Microsoft Windows 11 Pro `10.0.26100`, build `26100`,
  x64.
- Artifacts checked:
  - `release\Image2Tools-Setup.exe`
  - `release\win-unpacked\Image2Tools.exe`
- Source note: user-provided Windows test history, redacted into this tracked
  evidence note.

## Full-Install Verifier

```powershell
$env:IMAGE2TOOLS_WINDOWS_VERIFY_MODE='full-install'; corepack pnpm@10.25.0 verify:release:windows
```

Result: passed.

Fresh verifier coverage included PE checks, unpacked app launch, main-window
detection, stability smoke, NSIS silent install, installed app launch,
installed main-window detection, installed stability smoke, and silent
uninstall.

The final verifier output included:

- `Silent Windows install/uninstall cycle passed.`
- `Windows release verification passed.`

## Packaged App Mock Provider Checks

OpenAI-compatible mock endpoint configuration, connection, discovery, and
generation were exercised through the packaged app bridge.

- Discovered model: `gpt-image-2`
- Job: `job_96250abe-a346-46f8-9d64-fdaf1132567e`
- Output path:
  `C:\work\image2tools-acceptance\windows-native-2026-06-10T03-58-13-085Z\userdata\images\job_96250abe-a346-46f8-9d64-fdaf1132567e-result-0.png`
- Output size: `70` bytes
- Output SHA-256:
  `E83C539E44EBC56B3D93C09B6CD2F4A3CF84B0832A3BEDD949478691D8EC606C`

Gemini mock endpoint configuration, connection, discovery, and generation were
also exercised through the packaged app bridge.

- Discovered models: `gemini-3.1-flash-image` and
  `gemini-2.0-flash-preview-image-generation`
- Job: `job_490a1ba9-4087-4bb3-8d25-a0c17003b2a7`
- Output path:
  `C:\work\image2tools-acceptance\windows-native-gemini-2026-06-10T04-09-47-546Z\userdata\images\job_490a1ba9-4087-4bb3-8d25-a0c17003b2a7-result-0.png`
- Output size: `70` bytes
- Output SHA-256:
  `E83C539E44EBC56B3D93C09B6CD2F4A3CF84B0832A3BEDD949478691D8EC606C`

## Native Download Result

The packaged app `downloadAsset` action opened the native Windows
`Save image` dialog and saved the generated image to the selected native path.

- Saved path:
  `C:\work\image2tools-acceptance\windows-native-2026-06-10T03-58-13-085Z\downloads\native-download-acceptance.png`
- File existence: confirmed.
- Saved file size: `70` bytes.
- Saved file SHA-256:
  `E83C539E44EBC56B3D93C09B6CD2F4A3CF84B0832A3BEDD949478691D8EC606C`
- The saved file size and hash matched the source output.

## Native Open-Folder Result

The packaged app `openAssetFolder` action opened Windows Explorer at the
expected output directory.

- Explorer directory:
  `C:\work\image2tools-acceptance\windows-native-2026-06-10T03-58-13-085Z\userdata\images`
- Explorer window name: `images`
- Explorer location URL:
  `file:///C:/work/image2tools-acceptance/windows-native-2026-06-10T03-58-13-085Z/userdata/images`
- Expected output file was present:
  `job_96250abe-a346-46f8-9d64-fdaf1132567e-result-0.png`

## Cleanup

The Windows test note reported no residual Image2Tools / Electron process and
no residual Image2Tools install registry entry after verification.
