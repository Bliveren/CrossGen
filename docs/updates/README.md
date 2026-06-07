# Image2Tools Update Feed

This directory is intended to be served by GitHub Pages from the repository
`docs/` folder.

Stable manifest URL:

```text
https://bliveren.github.io/image2tools/updates/latest.json
```

For each release:

1. Upload installers to a GitHub Release.
2. Compute SHA-256 hashes for each installer. Every asset must include a
   lowercase 64-character `sha256` value before the app will open it.
3. Update `latest.json` so `version` is greater than the app version and each
   asset URL points to the matching GitHub Release download URL.
4. Commit and push this directory to `main`.

Example asset:

```json
{
  "platform": "win32",
  "arch": "x64",
  "url": "https://github.com/Bliveren/image2tools/releases/download/v0.2.0/Image2Tools-0.2.0-win-x64.exe",
  "fileName": "Image2Tools-0.2.0-win-x64.exe",
  "sha256": "64-char-lowercase-sha256"
}
```

Remote manifest and asset URLs must use HTTPS. `http://localhost`,
`http://127.0.0.1`, and `http://[::1]` are accepted only for local debugging.
