<h1 align="center">CrossGen 0.3.0</h1>

<p align="center">
  <img src="./build/icon.png" width="132" height="132" alt="CrossGen app icon" />
</p>

<p align="center">
  <b>One-stop AI image generation manager.</b><br />
  Configure APIs, generate images, edit results, organize assets, and reuse references in one desktop app.
</p>

<p align="center">
  <a href="https://github.com/Bliveren/image2tools/releases"><img alt="release" src="https://img.shields.io/github/v/release/Bliveren/image2tools?include_prereleases&color=F37021" /></a>
  <a href="https://github.com/Bliveren/image2tools/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Bliveren/image2tools/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-1f6f61" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-102f3f" />
  <img alt="stack" src="https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20Tailwind-0f766e" />
</p>

<p align="center">
  <b>English</b> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#why-crossgen-030">Why 0.3.0</a> ·
  <a href="#visual-tour">Visual Tour</a> ·
  <a href="#core-workflows">Core Workflows</a> ·
  <a href="#download-and-use">Download</a> ·
  <a href="https://discord.gg/XphwmYtY">Discord</a> ·
  <a href="#technical-notes">Technical Notes</a>
</p>

## Why CrossGen 0.3.0

CrossGen 0.3.0 is the release where Image2Tools becomes CrossGen: a practical desktop workspace for people who generate, edit, compare, and reuse AI images every day.

It is built for real image-generation work, not just one-off prompting. Designers, comic and storyboarding teams, UI makers, operators, product teams, and AI image hobbyists often need the same loop:

1. connect an image model with an API key,
2. generate a batch of ideas,
3. keep useful outputs,
4. crop, annotate, pick colors, or make quick edits,
5. reuse the result as a reference image,
6. generate again.

CrossGen keeps that whole loop inside one app. No repeated file hunting, no scattered browser downloads, no separate folder cleanup before the next image-to-image attempt.

## Visual Tour

<table>
<tr>
<td width="50%" valign="top">
<img src="./docs/assets/v030/api-model-switching.gif" alt="CrossGen API and model switching" />
<br />
<sub><b>API access and model switching.</b> Save API keys, switch access profiles, discover models, and let CrossGen pick the most compatible image route.</sub>
</td>
<td width="50%" valign="top">
<img src="./docs/assets/v030/gallery-history-to-reference.gif" alt="CrossGen Gallery and History drag to reference image area" />
<br />
<sub><b>History and Gallery become reusable references.</b> Drag results or saved assets directly into image-to-image reference slots.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="./docs/assets/v030/image-editing-loop.gif" alt="CrossGen image editing workflow" />
<br />
<sub><b>Edit without leaving the workflow.</b> Preview, crop, draw, add text, pick colors, save to Gallery, then use the edited image for the next generation.</sub>
</td>
<td width="50%" valign="top">
<img src="./docs/assets/v030/dark-mode.gif" alt="CrossGen dark mode" />
<br />
<sub><b>Dark mode.</b> A calmer workspace for long image-selection and editing sessions.</sub>
</td>
</tr>
</table>

## Core Workflows

### 1. One API Key Hub

CrossGen keeps API access simple:

- save multiple API keys and Base URLs,
- switch between OpenAI, Gemini, and OpenAI-compatible providers,
- run model discovery from the app,
- detect available image models,
- automatically probe compatible generation routes,
- keep the active API profile visible without crowding the workspace.

For aggregation platforms, route compatibility matters. CrossGen 0.3.0 can prefer the route that actually works for the configured provider, including chat-style image generation paths used by compatible gateways.

### 2. Gallery And History That Actually Help

Generated images are not throwaway files. CrossGen treats them as reusable working material:

- History records every generation result with prompt, model, duration, and output actions.
- Gallery stores selected images as reusable assets.
- Gallery folders map to local files so assets remain manageable outside the app.
- Tags, folders, search, sorting, and compact/collapsed views keep large libraries usable.
- History and Gallery images can be clicked for preview/editing or dragged into image-to-image references.
- Right-click actions include local path copy for workflows that still need direct file access.

The goal is simple: the image you generated ten minutes ago should be easy to find, edit, and reuse.

### 3. Generate, Edit, Reuse, Generate Again

CrossGen 0.3.0 adds a much stronger image preview and editing area:

- crop results and save the selected region as a new image,
- draw quick annotations,
- add text boxes,
- pick colors from the image,
- save edited results into Gallery,
- use Gallery/history items as reference images,
- continue the next image-to-image round without leaving the app.

This makes CrossGen useful for iterative visual work: generate a base image, crop a detail, annotate or adjust it, save it, then feed it back into the next prompt.

## Other Highlights

- **GPT Image 2 and Gemini image workflows**: focused launch entries for GPT Image 2 and Nano Banana/Gemini image models.
- **Aggregation-provider compatibility**: v0.3.0 release gates include real-provider validation through an OpenAI-compatible aggregation endpoint for GPT Image 2 and Gemini-compatible image models.
- **Prompt templates**: save reusable prompt structures and apply them quickly.
- **Prompt chips**: insert Gallery assets, color values, and templates into prompts.
- **Image-to-image reference handling**: drag local files, Gallery assets, or History outputs into reference slots.
- **Dark mode**: built for longer visual review sessions.
- **Local-first storage**: history, outputs, templates, and Gallery assets are stored locally.
- **Open source**: released under the MIT License.

## Download And Use

CrossGen is distributed as a desktop release package. Download the latest installer from the [GitHub Releases page](https://github.com/Bliveren/image2tools/releases/latest), install it, open the app, add your API key, and start generating.

| Platform | Package |
| --- | --- |
| macOS Apple Silicon | `.dmg` |
| Windows x64 | `.exe` installer |
| Linux x64 | AppImage when published |

Basic setup:

1. Open **API access**.
2. Add an API key and Base URL.
3. Run model discovery.
4. Launch GPT Image 2, Nano Banana/Gemini, or a compatible model.
5. Generate, edit, save useful images to Gallery, and reuse them as references.

If macOS Gatekeeper blocks an unnotarized local build, right-click the app and choose **Open**, or clear the quarantine attribute:

```bash
xattr -dr com.apple.quarantine /Applications/CrossGen.app
```

If Windows SmartScreen appears, choose **More info** and then **Run anyway**.

## Brand

CrossGen means a cross-model, cross-step generation workspace: one place for API access, generation, editing, Gallery management, and repeated image-to-image iteration.

The product promise is deliberately practical:

> configure once, generate quickly, keep useful images organized, edit without friction, and reuse everything in the next round.

CrossGen is maintained by [Nowo](https://www.nowo.com/) and [Corgnitor](https://www.corgnitor.com/). Nowo focuses on AI-native product design and applied workflows. Corgnitor focuses on AI engineering and productization.

Join the CrossGen community on [Discord](https://discord.gg/XphwmYtY) for feedback, release discussion, and workflow ideas.

## Technical Notes

CrossGen is an Electron + React + Tailwind desktop app. The app focuses on local-first workflows and supports OpenAI, Gemini, and compatible image providers.

Useful commands:

```bash
pnpm install
pnpm dev:electron
pnpm build
```

Validation:

```bash
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
pnpm verify:release-evidence
```

Packaging:

```bash
pnpm package:dir
pnpm package:mac
pnpm package:win
pnpm verify:release:mac
pnpm verify:release:windows
pnpm verify:release:linux
```

Release evidence is tracked in [`docs/release/evidence.json`](./docs/release/evidence.json). Mock verifiers do not spend real API credits. Real-provider gates require explicit cost approval and local environment variables.

## License

CrossGen is released under the [MIT License](./LICENSE).
