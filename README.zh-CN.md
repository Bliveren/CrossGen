<h1 align="center">Image2Tools</h1>

<p align="center">
  <img src="./build/icon.png" width="132" height="132" alt="Image2Tools 应用图标" />
</p>

<p align="center">
  本地优先的 AI 生图桌面工作台，覆盖图片生成、编辑、API 接入管理、提示词复用、参考图库和历史任务。
</p>

<p align="center">
  <a href="https://github.com/Bliveren/image2tools/releases"><img alt="release" src="https://img.shields.io/github/v/release/Bliveren/image2tools?include_prereleases&color=F37021" /></a>
  <a href="https://github.com/Bliveren/image2tools/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Bliveren/image2tools/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-1f6f61" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-102f3f" />
  <img alt="stack" src="https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20Tailwind-0f766e" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  <a href="#image2tools-是什么">项目定位</a> ·
  <a href="#产品示意">产品示意</a> ·
  <a href="#功能特点">功能特点</a> ·
  <a href="#下载与安装">下载</a> ·
  <a href="#开发运行">开发运行</a> ·
  <a href="#关于诺惟与核炬">诺惟与核炬</a>
</p>

## Image2Tools 是什么

Image2Tools 是一个方便易用的 AI 生图与图片编辑桌面工具。当前版本聚焦 GPT Image 2、Gemini 支撑的图片模型能力，例如 Nano Banana 3，以及 OpenAI 兼容的自定义图片服务。
<img width="1721" height="1154" alt="image" src="https://github.com/user-attachments/assets/e3810a38-4604-47b8-8cb8-46d073bdb252" />
`0.2.3` 版本重点把工具整理成更清晰的生产工作台：

- 多个 API 接入整合进模型配置模块统一管理。
- 当前正在使用的 API 接入以紧凑信息卡展示，包含接入名称、Base URL、Key 保存状态和探测模型数。
- 已保存但未使用的 API 接入默认折叠，用户可以随时展开、切换或编辑。
- 提示词模板收敛为提示词区域下方的按钮，并在独立弹窗中管理。
- 参考图库移动到右侧，与最近任务并列，图库图片和历史结果都可以拖入参考图区域。
- 图生图区域强化参考图与蒙版边界，模糊按钮和拖拽条增加悬浮说明。
- 界面统一使用更克制的视觉系统，`#F37021` 只用于关键按钮和激活状态。

Image2Tools 适合创作者、运营人员、产品团队和内部 AI 工具团队，在本地桌面完成 API 配置、模型探测、生成、编辑、复用和更新检查，而不是依赖账号型云端图片工作台。

## 产品示意

以下截图展示当前 `0.2.3` 工作台。

<table>
<tr>
<td width="50%" valign="top">
<img src="./docs/assets/v023-workspace-text-to-image.png" alt="Image2Tools 文生图工作区" />
<br />
<sub><b>文生图工作区。</b>在左侧配置当前 API 接入并启动模型，中间输入提示词，右侧查看最近任务和图库。</sub>
</td>
<td width="50%" valign="top">
<img src="./docs/assets/v023-image-to-image-reference.png" alt="Image2Tools 图生图参考图与蒙版工作区" />
<br />
<sub><b>图生图。</b>可以添加参考图、拖入图库图片或历史结果，并在模型支持时使用蒙版做局部编辑。</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="./docs/assets/v023-prompt-template-dialog.png" alt="Image2Tools 提示词模板弹窗" />
<br />
<sub><b>提示词模板。</b>提示词模板不再占据主工作台，而是在独立弹窗内保存、搜索、导入、导出和应用。</sub>
</td>
<td width="50%" valign="top">
<img src="./docs/assets/v023-gallery-history-rail.png" alt="Image2Tools 最近任务与图库" />
<br />
<sub><b>最近任务与图库。</b>右侧栏同时管理生成历史和可复用参考图，让结果复用和参考图调用更顺手。</sub>
</td>
</tr>
</table>

## 功能特点

| 模块 | 能力 |
| --- | --- |
| API 接入配置 | 保存并切换 OpenAI、Gemini 和 OpenAI 兼容 Custom 接入。每个接入独立保存名称、Base URL、Key 状态、启动模型和模型探测结果。 |
| 模型配置 | 当前 API 接入以紧凑信息卡展示，需要编辑 API Key、Base URL、服务商类型或探测信息时再展开。 |
| 模型探测 | 根据当前 API 接入探测可用模型，展示探测模型数和清晰的失败原因。 |
| 启动模型 | GPT Image 2、Nano Banana 3、General 根据服务商支持、Key 保存状态和探测结果启用或置灰。 |
| GPT Image 2 | 文生图、参考图编辑、多图编辑、精确 mask 局部重绘，以及 OpenAI Image API 参数校验。为兼容聚合器，OpenAI streaming 当前全局关闭。 |
| Nano Banana 3 | Gemini `generateContent` 图片生成、参考图编辑、引导式区域编辑、画面比例、分辨率、Thinking 和 Search grounding 控件。 |
| General 模式 | 为探测到的非重点图片模型提供最小兜底。Gemini 支持提示词和参考图；OpenAI 与 Custom 使用 OpenAI 兼容纯提示词生成契约。 |
| 提示词模板 | 提示词下方一个按钮打开模板管理器，可保存、搜索、打标签、导入、导出和应用常用提示词。 |
| 提示词 chip | 图库和模板触发项可以进入提示词流程，并在运行前序列化为模型可用的提示词和参考图输入。 |
| 参考图库 | 右侧图库保存可复用参考图，可以点击或拖拽到参考图区域使用。 |
| 最近任务 | 历史卡片展示 provider/model、提示词摘要、可复用输出、下载操作和加入图库操作。 |
| 蒙版工作流 | 图生图模式提供更明确的蒙版区域、画笔大小、上传蒙版和悬浮说明。 |
| 本地存储 | 输出、历史、草稿、模板和图库资产均保存在 Electron user data 本地目录。 |
| 双语界面 | 应用内支持 English / 简体中文切换，并保存在本地。 |
| 更新检查 | 根据平台匹配更新 manifest，下载前校验 size 与 SHA-256，再打开安装器。 |

## 下载与安装

从 [GitHub Releases](https://github.com/Bliveren/image2tools/releases/latest) 下载最新安装包。

| 平台 | 文件 | 状态 |
| --- | --- | --- |
| macOS Apple Silicon | `Image2Tools-0.2.3-mac-arm64.dmg` | 本机签名身份可用时使用 Developer ID 签名。Apple 公证取决于 notary 凭据是否配置。 |
| Windows x64 | `Image2Tools-Setup.exe` | NSIS 安装程序，原生 Windows 验证记录在 release evidence。 |
| Linux x64 | `Image2Tools-0.2.3-linux-x86_64.AppImage` | 已有打包支持，是否发布取决于当前 release 周期。 |

可对照 [`docs/updates/latest.json`](./docs/updates/latest.json) 校验下载文件：

```bash
# macOS
shasum -a 256 ~/Downloads/Image2Tools-0.2.3-mac-arm64.dmg

# Windows PowerShell
Get-FileHash .\Image2Tools-Setup.exe -Algorithm SHA256
```

如果 macOS Gatekeeper 拦截未公证的本地构建，可右键应用选择 **打开**，或清除隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/Image2Tools.app
```

如果 Windows 出现 SmartScreen 提示，选择 **更多信息**，再点击 **仍要运行**。

## 产品流程

1. 在模型配置中添加或展开 API 接入。
2. 保存 API Key 与 Base URL，然后执行模型探测。
3. 根据探测结果启动 GPT Image 2、Nano Banana 3 或 General。
4. 输入提示词，可按需应用提示词模板，然后生成。
5. 图生图时可从本地、图库或最近任务添加参考图。
6. 模型支持时，可上传或绘制蒙版进行局部编辑。
7. 从历史复用结果，将有价值输出加入图库，或下载图片。

## 开发运行

环境要求：

- Node.js 20+
- pnpm 10+
- macOS、Windows 或 Linux
- 如需真实生成图片，需要 OpenAI 或 Gemini API 权限

```bash
pnpm install
pnpm dev:electron
```

构建与测试：

```bash
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

打包：

```bash
pnpm package:dir
pnpm package:mac
pnpm package:win
pnpm verify:release:mac
pnpm verify:release:windows
pnpm verify:release:linux
pnpm verify:release-evidence
```

`pnpm build` 会执行 TypeScript 检查、Vitest、renderer 构建和 Electron main 构建。mock 验证覆盖 OpenAI 图片调用、Gemini `generateContent`、模型探测和服务商错误处理，不会产生真实 API 费用。

使用本机 Developer ID 身份进行不公证的 macOS 签名构建：

```bash
PATH="$PWD/node_modules/.bin:$PATH" node scripts/electron-builder-pnpm.mjs --mac \
  -c.mac.notarize=false \
  -c.mac.identity="Xiamen Corgnitor Technology Co.,Ltd (RPX587R2R7)"
```

仅当完整 Apple 公证环境已配置后再使用 `pnpm package:mac:signed`：

- `CSC_NAME`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Mock API

不希望消耗真实 API 额度时，可以使用 mock 服务。

```bash
pnpm mock:openai
```

应用中填写：

```text
API Key: sk-mock-image2tools
Base URL: http://127.0.0.1:8787/v1
```

```bash
pnpm mock:gemini
```

应用中填写：

```text
Provider: Gemini
API Key: mock-gemini-key
Base URL: http://127.0.0.1:8788/v1beta
```

## Release Evidence

外部发布门禁统一记录在 [`docs/release/evidence.json`](./docs/release/evidence.json)，包括真实 provider API 验收、macOS 签名包、Windows/Linux 原生验证和更新 manifest 资产。

```bash
pnpm verify:release-evidence
pnpm verify:release-evidence -- --require-complete
```

发布产物和更新元数据应当从最终准备发布的同一份包刷新。

## 关于诺惟与核炬

Image2Tools 由 [诺惟 Nowo](https://www.nowo.com/) 与 [核炬科技 Corgnitor](https://www.corgnitor.com/) 提供。

[诺惟 Nowo](https://www.nowo.com/) 专注 AI 原生产品设计、产品策略和应用软件工作流，关注如何把 AI 能力转化为真正可用的产品、流程和用户体验。

[核炬科技 Corgnitor](https://www.corgnitor.com/) 专注 AI 工程实现与产品化落地，帮助模型能力、自动化系统和内部工具沉淀为可维护的软件产品。

双方共同维护 Image2Tools，希望把图片生成、编辑和局部重绘这类高频能力沉淀为一个简单、可本地运行、可开源协作的桌面工具。

## 许可证

Image2Tools 使用 [MIT License](./LICENSE) 开源。
