<div align="right">
  <details>
    <summary>Language</summary>
    <div align="right">
      <p><a href="#english">English</a></p>
      <p><a href="#simplified-chinese">简体中文</a></p>
    </div>
  </details>
</div>

<a id="english"></a>

<h1 align="center">
  <img src="./build/icon.png" width="144" height="144" alt="Image2Tools icon" />
  <br />
  Image2Tools
</h1>

<p align="center">
  A local-first desktop workspace for <code>gpt-image-2</code> generation, image editing, inpainting, streaming previews, downloads, and history.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-1f6f61" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-102f3f" />
  <img alt="Stack" src="https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20Vite-f1c86b" />
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#showcase">Showcase</a> ·
  <a href="#open-source-status">Open Source Status</a> ·
  <a href="#development">Development</a> ·
  <a href="#about-the-sponsors">Sponsors</a> ·
  <a href="#simplified-chinese">简体中文</a>
</p>

## Showcase

![Image2Tools desktop workspace](./docs/assets/readme-showcase.svg)

![Image2Tools workflow](./docs/assets/readme-flow.svg)

## What Is Image2Tools

Image2Tools is a focused desktop client for the OpenAI Image API with `gpt-image-2` as the default model. It keeps the workflow small and practical: configure an API key, write a prompt, generate or edit images, preview streaming partials, download outputs, and recover the workspace if the app is interrupted.

The app is built for non-developers, individual creators, product teams, and internal AI workflow builders who need a simple desktop tool instead of a cloud workspace or account system. The current implementation focuses on `gpt-image-2`; future model support can be expanded as the product evolves.

## Features

| Area | Capability |
| --- | --- |
| Image creation | Text-to-image generation with validated `gpt-image-2` parameters. |
| Image editing | Single-image and multi-image edits with PNG, JPEG, and WebP inputs. |
| Inpainting | Upload a mask or paint one directly in the local mask editor. |
| Streaming | Optional partial image previews for long-running generation and edit jobs. |
| Local history | Generated assets are saved in Electron user data and can be reused, opened, or downloaded. |
| Workspace recovery | Draft prompt, parameters, references, masks, and brush size are autosaved. |
| Bilingual UI | In-app language switch supports English and Simplified Chinese through localStorage. |
| Updates | Manifest-based update checks with platform and architecture matching. |
| Safety | Managed asset protocol prevents arbitrary local file exposure from previews. |

## Product Flow

1. Configure provider settings with your API key and Base URL.
2. Choose Generate, Edit, or Inpaint.
3. Tune size, quality, output format, compression, background, count, streaming, moderation, and timeout.
4. Preview partial images during streaming jobs.
5. Download results, open the local output folder, or reuse history prompts.

## Open Source Status

![Image2Tools MIT readiness](./docs/assets/readme-open-source.svg)

Image2Tools is suitable to publish as an MIT-licensed open-source project based on the current repository audit:

| Check | Result |
| --- | --- |
| Project license | `LICENSE` contains the MIT license and `package.json` declares `MIT`. |
| Runtime dependencies | Production dependencies report MIT or ISC licenses. |
| Development dependencies | Development tooling licenses are permissive/common for build and test tooling; no copyleft runtime blocker was found. |
| Secrets | The current scan found test/mock keys, environment variable names, and expected Authorization code paths, but no real API key or certificate committed to tracked source. |
| Generated and local files | `.gitignore` excludes `node_modules/`, build output, release output, real API artifacts, logs, and env files. |
| Remaining release gates | Re-run the secret scan before publishing, and verify signed/notarized macOS builds plus native Windows/Linux packages before distributing binaries. |

This is an engineering readiness assessment, not legal advice. If the project will be published by a legal entity, run the final license and trademark review under that entity's normal process.

## Development

Requirements:

- Node.js and pnpm
- macOS, Windows, or Linux
- OpenAI API access for real image generation

```bash
pnpm install
pnpm dev:electron
```

Build and test:

```bash
pnpm build
pnpm verify:mock-api
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

`pnpm build` runs type checks, Vitest, the renderer build, and the Electron main build. `pnpm package:dir` creates an unpacked app for local inspection. `pnpm package:mac` creates local ad-hoc macOS packages; use `pnpm package:mac:signed` only when Developer ID and notarization environment variables are configured.

`pnpm verify:release:windows` defaults to full native Windows verification, including the NSIS silent install, installed-app launch, and silent uninstall cycle. Hosted GitHub workflows use `IMAGE2TOOLS_WINDOWS_VERIFY_MODE=package-smoke` to keep installer PE checks and unpacked-app launch smoke coverage without depending on the hosted runner's installer policy.

## Mock API

Use the mock server when you do not want to spend real API credits:

```bash
pnpm mock:openai
```

Then configure the app with:

```text
API Key: sk-mock-image2tools
Base URL: http://127.0.0.1:8787/v1
```

The mock supports `/models`, `/images/generations`, and `/images/edits`. It returns valid PNG base64 data and streaming events, so it can verify local configuration, request handling, previews, saving, downloads, and history. It does not represent real `gpt-image-2` quality.

## Real API Acceptance

`pnpm verify:real-api` is intentionally cost-gated. It only sends real image requests when an API key is present and cost acceptance is explicit:

```bash
IMAGE2TOOLS_API_KEY=sk-... IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 pnpm verify:real-api
```

Streaming acceptance requires an additional opt-in:

```bash
IMAGE2TOOLS_REAL_API_ACCEPT_STREAM_COST=1
```

Generated acceptance artifacts are written to `real-api-artifacts/`, which is ignored by git.

## Icon

The app icon is generated from the local project source at [`build/icon.svg`](./build/icon.svg). Derived packaging assets are kept in:

- [`build/icon.png`](./build/icon.png)
- [`build/icon.icns`](./build/icon.icns)
- [`build/icon.ico`](./build/icon.ico)
- [`build/icon.iconset/`](./build/icon.iconset)
- [`public/favicon.svg`](./public/favicon.svg)

The mark combines an image canvas, edit wand, and streaming/output lines to match the product's `gpt-image-2` workflow.

## Documentation

- [PLAN.md](./PLAN.md): roadmap, scope, and phase goals
- [MULTI_MODEL_PLAN.md](./MULTI_MODEL_PLAN.md): multi image-model architecture and rollout plan
- [MULTI_MODEL_TODO.md](./MULTI_MODEL_TODO.md): executable task list for GPT Image 2, Nano Banana 3, and General support
- [MULTI_MODEL_CHECKLIST.md](./MULTI_MODEL_CHECKLIST.md): acceptance checklist for multi-model support
- [ARCHITECTURE.md](./ARCHITECTURE.md): architecture, data flow, and module split
- [TODO.md](./TODO.md): executable task list
- [CHECKLIST.md](./CHECKLIST.md): development and release checklist
- [COMPLETION_AUDIT.md](./COMPLETION_AUDIT.md): delivery evidence and validation commands
- [EXTERNAL_ACCEPTANCE.md](./EXTERNAL_ACCEPTANCE.md): real API, signing, notarization, and platform acceptance
- [SECURITY.md](./SECURITY.md): security and pre-publication checks
- [OPEN_SOURCE_AUDIT.md](./OPEN_SOURCE_AUDIT.md): MIT open-source readiness audit

## Security Checks Before Publishing

Run these before making the repository public or publishing a release:

```bash
pnpm build
pnpm verify:mock-api
rg -n "sk-[A-Za-z0-9_-]{8,}|Bearer |Authorization|apiKey|encryptedApiKey|secret|password|token|private|/Users/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|github\\.com/.+/milestone|release/tag|origin/archive" \
  -g '!node_modules' -g '!dist*' -g '!release' -g '!pnpm-lock.yaml'
find . -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -name '*state*.json' -o -name '*secret*' \) \
  -not -path './node_modules/*' -print
git ls-files | rg '(^|/)(dist|dist-renderer|release|real-api-artifacts|node_modules)/|\.env|\.pem|\.p12|state\.json|\.DS_Store' || true
```

Expected hits include mock keys, test fixtures, environment variable names, Authorization request code, and documentation that describes security checks. Real API keys, signing certificates, private release links, local state files, and personal paths should not appear.

## About The Sponsors

Image2Tools is provided by Nowo and Corgnitor.

Nowo, known in Chinese as 诺惟, focuses on AI-native product design and applied software workflows. Corgnitor, known in Chinese as 核炬科技, focuses on engineering implementation and productization of AI-enabled tools. Together they provide Image2Tools as a practical open-source desktop utility for image-generation workflows.

## License

Image2Tools is released under the [MIT License](./LICENSE).

---

<a id="simplified-chinese"></a>

# Image2Tools 简体中文

<p align="center">
  <img src="./build/icon.png" width="144" height="144" alt="Image2Tools 图标" />
</p>

<p align="center">
  一个面向 <code>gpt-image-2</code> 的本地优先桌面工作台，支持图片生成、图片编辑、局部重绘、流式预览、下载和历史记录。
</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#功能亮点">功能亮点</a> ·
  <a href="#项目展示">项目展示</a> ·
  <a href="#mit-开源状态">MIT 开源状态</a> ·
  <a href="#开发运行">开发运行</a> ·
  <a href="#背后的企业">背后的企业</a>
</p>

## 项目展示

![Image2Tools 桌面工作台](./docs/assets/readme-showcase.svg)

![Image2Tools 工作流](./docs/assets/readme-flow.svg)

## 项目定位

Image2Tools 是一个聚焦 OpenAI Image API 的桌面客户端，默认模型为 `gpt-image-2`。它不做账号体系和云同步，而是把最常用的图片生成链路收敛在本地桌面里：录入 API Key、输入 prompt、生成或编辑图片、查看流式局部预览、下载结果、复用历史，并在异常退出后恢复工作区草稿。

适合非开发人员、个人创作者、产品团队、AI 应用工程团队和需要轻量图像工作台的内部工具场景。当前实现重点支持 `gpt-image-2`，后续可随产品演进继续扩展其他模型支持。

## 功能亮点

| 模块 | 能力 |
| --- | --- |
| 图片生成 | 文生图生成，内置 `gpt-image-2` 参数校验。 |
| 图片编辑 | 支持单图与多图编辑，输入支持 PNG、JPEG、WebP。 |
| 局部重绘 | 可上传 mask，也可在本地 mask 编辑器中直接涂抹。 |
| 流式预览 | 长任务可开启 partial image 预览，先看中间结果再等最终图。 |
| 本地历史 | 输出资产保存在 Electron user data，可下载、打开目录、复用 prompt。 |
| 草稿恢复 | 自动保存 prompt、参数、参考图、mask 和画笔大小。 |
| 双语界面 | 应用内支持 English / 简体中文切换，语言选择保存在 localStorage。 |
| 自动升级 | 支持基于 manifest 的升级检查，按平台和架构匹配安装包。 |
| 安全边界 | 使用受限的本地资源协议预览受管图片，避免任意文件暴露。 |

## 产品流程

1. 配置 API Key 与 Base URL。
2. 选择生成、编辑或局部重绘。
3. 调整尺寸、质量、输出格式、压缩、背景、数量、流式预览、审核和超时。
4. 在任务执行时查看 partial image。
5. 下载结果、打开本地输出目录，或从历史记录复用 prompt。

## MIT 开源状态

![Image2Tools MIT 开源状态](./docs/assets/readme-open-source.svg)

基于当前仓库审计，Image2Tools 可以作为 MIT 协议项目开源发布：

| 检查项 | 结论 |
| --- | --- |
| 项目许可证 | `LICENSE` 为 MIT 文本，`package.json` 声明 `MIT`。 |
| 运行时依赖 | 生产依赖许可证为 MIT 或 ISC。 |
| 开发依赖 | 构建和测试工具为常见宽松许可证，未发现运行时 copyleft 阻断项。 |
| 敏感信息 | 当前扫描只发现 mock key、测试数据、环境变量名和正常鉴权代码路径，未发现真实 API Key 或证书进入跟踪源码。 |
| 生成与本地文件 | `.gitignore` 已排除 `node_modules/`、构建产物、release 产物、真实 API 验收产物、日志和环境变量文件。 |
| 发布前剩余门禁 | 公开前应重新扫描敏感信息；分发二进制前应完成 macOS 签名/公证以及 Windows/Linux 原生验收。 |

以上是工程开源就绪判断，不构成法律意见。如果项目以公司主体发布，仍建议按公司流程进行最终许可证、商标和合规审查。

## 开发运行

环境要求：

- Node.js 与 pnpm
- macOS、Windows 或 Linux
- 如需真实生成图片，需要 OpenAI API 访问权限

```bash
pnpm install
pnpm dev:electron
```

构建与测试：

```bash
pnpm build
pnpm verify:mock-api
```

打包：

```bash
pnpm package:dir
pnpm package:mac
pnpm package:win
pnpm verify:release:mac
pnpm verify:release:windows
pnpm verify:release:linux
```

`pnpm build` 会执行类型检查、Vitest、renderer 构建和 Electron main 构建。`pnpm package:dir` 生成未压缩应用目录，适合本地检查。`pnpm package:mac` 生成本地 ad-hoc macOS 包；具备 Developer ID 和公证环境变量后再使用 `pnpm package:mac:signed`。

`pnpm verify:release:windows` 默认执行完整原生 Windows 验证，包括 NSIS 静默安装、已安装应用启动和静默卸载。Hosted GitHub workflow 使用 `IMAGE2TOOLS_WINDOWS_VERIFY_MODE=package-smoke` 保留安装包 PE 检查和未压缩应用启动烟测，同时避开托管 runner 的安装器策略差异。

## Mock API 验证

没有真实 API Key 或不希望产生费用时，可以使用 mock 服务：

```bash
pnpm mock:openai
```

应用中填写：

```text
API Key: sk-mock-image2tools
Base URL: http://127.0.0.1:8787/v1
```

mock 支持 `/models`、`/images/generations`、`/images/edits`，并返回有效 PNG base64 与流式事件，可验证本地配置、请求、预览、保存、下载和历史链路。它不代表真实 `gpt-image-2` 输出质量。

## 真实 API 验收

`pnpm verify:real-api` 默认不会产生真实图片请求。必须设置 API Key 且显式确认成本后才会运行：

```bash
IMAGE2TOOLS_API_KEY=sk-... IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 pnpm verify:real-api
```

流式验收需要额外确认：

```bash
IMAGE2TOOLS_REAL_API_ACCEPT_STREAM_COST=1
```

验收输出会写入被 git 忽略的 `real-api-artifacts/`。

## 图标

应用图标由本地项目源文件 [`build/icon.svg`](./build/icon.svg) 生成，派生文件包括：

- [`build/icon.png`](./build/icon.png)
- [`build/icon.icns`](./build/icon.icns)
- [`build/icon.ico`](./build/icon.ico)
- [`build/icon.iconset/`](./build/icon.iconset)
- [`public/favicon.svg`](./public/favicon.svg)

图形融合了图片画布、编辑魔棒和输出线条，对应 Image2Tools 的 `gpt-image-2` 工作流。

## 文档索引

- [PLAN.md](./PLAN.md): 总体开发计划、阶段目标、范围边界
- [MULTI_MODEL_PLAN.md](./MULTI_MODEL_PLAN.md): 多生图模型架构与阶段推进计划
- [MULTI_MODEL_TODO.md](./MULTI_MODEL_TODO.md): GPT Image 2、Nano Banana 3、General 支持的可执行任务清单
- [MULTI_MODEL_CHECKLIST.md](./MULTI_MODEL_CHECKLIST.md): 多模型支持验收检查清单
- [ARCHITECTURE.md](./ARCHITECTURE.md): 技术架构、数据流、模块拆分
- [TODO.md](./TODO.md): 可直接执行的任务清单
- [CHECKLIST.md](./CHECKLIST.md): 开发与发布检查清单
- [COMPLETION_AUDIT.md](./COMPLETION_AUDIT.md): 当前交付证据、验证命令和外部待办
- [EXTERNAL_ACCEPTANCE.md](./EXTERNAL_ACCEPTANCE.md): 真实 API、签名、公证、跨平台和 CI 外部验收步骤
- [SECURITY.md](./SECURITY.md): 开源前安全与敏感信息检查
- [OPEN_SOURCE_AUDIT.md](./OPEN_SOURCE_AUDIT.md): MIT 开源就绪审计记录

## 公开前安全检查

发布公开仓库或 release 前建议执行：

```bash
pnpm build
pnpm verify:mock-api
rg -n "sk-[A-Za-z0-9_-]{8,}|Bearer |Authorization|apiKey|encryptedApiKey|secret|password|token|private|/Users/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|github\\.com/.+/milestone|release/tag|origin/archive" \
  -g '!node_modules' -g '!dist*' -g '!release' -g '!pnpm-lock.yaml'
find . -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -name '*state*.json' -o -name '*secret*' \) \
  -not -path './node_modules/*' -print
git ls-files | rg '(^|/)(dist|dist-renderer|release|real-api-artifacts|node_modules)/|\.env|\.pem|\.p12|state\.json|\.DS_Store' || true
```

mock key、测试 fixture、环境变量名、鉴权请求代码和安全检查文档属于预期命中；真实 API Key、签名证书、私有发布链接、本地状态文件和个人路径不应出现。

## 背后的企业

Image2Tools 由诺惟（Nowo）与核炬科技（Corgnitor）提供。

诺惟（Nowo）关注 AI 原生产品设计与应用软件工作流。核炬科技（Corgnitor）关注 AI 工具的工程实现与产品化落地。双方共同提供 Image2Tools，希望把图片生成、编辑和局部重绘这类高频能力沉淀为一个简单、可本地运行、可开源协作的桌面工具。

## 许可证

Image2Tools 使用 [MIT License](./LICENSE) 开源。
