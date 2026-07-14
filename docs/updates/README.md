# CrossGen Update Feed

This directory contains the update manifest consumed by the desktop app.

Default manifest URL used by packaged apps:

```text
https://raw.githubusercontent.com/Bliveren/CrossGen/main/docs/updates/latest.json
```

GitHub Pages can also serve this directory from `docs/` once Pages is enabled
for the repository. Until then, the raw GitHub URL is the stable default to
avoid a 404 update check.

For each approved release:

1. Confirm the product-owner acceptance gate in `docs/release/README.md` has
   passed for the exact installable package. Until then, keep any GitHub Release
   as draft-only and keep `latest.json` pointed at the last approved release.
2. Upload installers to a GitHub Release.
3. Compute SHA-256 hashes and byte sizes for each installer. Every asset must
   include a lowercase 64-character `sha256` value and positive integer
   `sizeBytes` value before the app will open it.
4. Generate asset entries with `pnpm update:manifest-asset -- --file <path>
   --platform <darwin|win32|linux|all> --url <https-url> [--arch <arch>]`.
5. Update `latest.json` so `version` is greater than the app version and each
   asset URL points to the matching GitHub Release download URL.
6. Commit and push this directory to `main`.

Example asset:

```json
{
  "platform": "win32",
  "arch": "x64",
  "url": "https://github.com/Bliveren/CrossGen/releases/download/v0.2.0/CrossGen-0.2.0-win-x64.exe",
  "fileName": "CrossGen-0.2.0-win-x64.exe",
  "sha256": "64-char-lowercase-sha256",
  "sizeBytes": 12345678
}
```

Remote manifest and asset URLs must use HTTPS. `http://localhost`,
`http://127.0.0.1`, and `http://[::1]` are accepted only for local debugging.
