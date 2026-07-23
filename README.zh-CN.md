<h1 align="center">CrossGen 0.3.1</h1>

<p align="center">
  <img src="./build/icon.png" width="132" height="132" alt="CrossGen 应用图标" />
</p>

<p align="center">
  <b>面向用户与本地 AI Agent 的本地优先生图工作台。</b><br />
  通过桌面应用、JSON CLI 或支持 MCP 的 Agent 完成生图、编辑、素材管理与结果复用。
</p>

<p align="center">
  <a href="https://github.com/Bliveren/CrossGen/releases"><img alt="release" src="https://img.shields.io/github/v/release/Bliveren/CrossGen?include_prereleases&color=F37021" /></a>
  <a href="https://github.com/Bliveren/CrossGen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Bliveren/CrossGen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-1f6f61" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-102f3f" />
  <img alt="stack" src="https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20Tailwind-0f766e" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  <a href="#为什么是-crossgen-031">0.3.1 介绍</a> ·
  <a href="#功能演示">功能演示</a> ·
  <a href="#核心工作流">核心工作流</a> ·
  <a href="#agent-runtime">Agent Runtime</a> ·
  <a href="#下载安装">下载安装</a> ·
  <a href="https://discord.gg/XphwmYtY">Discord</a> ·
  <a href="#技术说明">技术说明</a>
</p>

## 为什么是 CrossGen 0.3.1

CrossGen 0.3.1 将桌面生图工作台升级为面向 Agent 的本地运行时。你仍然可以使用完整的可视化应用，同时也可以让 Codex、Claude Code、Cursor 和其他本地 AI Agent 通过 CLI 或 MCP 发现模型、生图或编辑图片、追踪持久化任务，并把结果导出到当前项目。

<img width="1440" height="940" alt="screenshot-20260724-003442" src="https://github.com/user-attachments/assets/aaaaf3d8-cf9b-4320-bdfb-a04ca9f92168" />

桌面应用、CLI 和 MCP Server 共用 API 配置、持久化生图队列、历史记录与图库。CrossGen 只需安装一次；安装包中的 CLI/MCP 不要求用户额外安装 Node.js、npm、pnpm、全局包或本地 HTTP 服务。

它解决的是很实际的工作问题：

1. API Key 多、Base URL 多、模型多，切换和排错很麻烦；
2. 生出来的图散落在下载目录、本地文件夹和聊天记录里，很难复用；
3. 好不容易有一张可用图，还要到别的软件里裁剪、批注、取色，再重新上传做参考；
4. 历史图、素材图、参考图之间不连通，图生图迭代效率很低。

CrossGen 把这些环节放在一个桌面应用里：配置 API、自动探测模型与路径、生成图片、编辑图片、保存到图库、从图库或历史拖回参考图区域，再进入下一轮图生图。

适合平面设计、漫剧制作、UI 制作、运营配图、产品原型、内部 AI 工具团队，以及只是想更方便地使用生图模型的用户。

对于 Agent 驱动的工作流，完整链路同样直接：

1. 查询已配置的 provider 与经过验证的模型能力；
2. 提交文生图或参考图编辑任务；
3. 查询、取消或重试队列任务；
4. 检查生成后的图库资产；
5. 将选中的结果导出到 Agent 当前处理的项目。

## 功能演示

<table>
<tr>
<td width="50%" valign="top">
<img src="./docs/assets/v030/api-model-switching.gif" alt="CrossGen API 配置和模型切换" />
<br />
<sub><b>一站式 API 配置与模型切换。</b>保存多个 API Key 和 Base URL，自动探测模型与可用路径，快速切换不同模型。</sub>
</td>
<td width="50%" valign="top">
<img src="./docs/assets/v030/gallery-history-to-reference.gif" alt="CrossGen 从图库和历史拖入参考图" />
<br />
<sub><b>图库与历史直接变成参考图。</b>历史结果和图库素材可以直接拖到图生图参考区，不用反复找文件、上传文件。</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="./docs/assets/v030/image-editing-loop.gif" alt="CrossGen 图片编辑工作流" />
<br />
<sub><b>简单易用的图片编辑。</b>预览、裁剪、涂鸦、加文本、取色、保存到图库，再继续用于下一轮生图。</sub>
</td>
<td width="50%" valign="top">
<img src="./docs/assets/v030/dark-mode.gif" alt="CrossGen 暗色模式" />
<br />
<sub><b>暗色模式。</b>长时间选图、修图、对比结果时更舒服。</sub>
</td>
</tr>
</table>

## 核心工作流

### 1. 一站式 API Key 配置与管理

CrossGen 将 API 配置从“技术配置项”变成日常可用的工作入口：

- 保存多个 API Key 和 Base URL；
- 支持 OpenAI、Gemini 以及各类 OpenAI 兼容聚合平台；
- 一键探测模型；
- 自动识别可用生图模型；
- 自动探测更适合当前服务商的生成路径；
- 当前使用的 API 配置始终清楚可见，但不挤占主工作区。

对于聚合平台来说，同一个模型可能不是每条接口路径都可用。CrossGen 会尽量使用当前平台真正能返回图片的路径，减少“接口明明通了但就是不出图”的情况。

### 2. 高效易用的图库与历史管理

生图用户真正需要的不是“生成完就结束”，而是把有价值的图沉淀下来、快速复用：

- 历史记录保存每一次生图结果、提示词、模型和耗时；
- 图库用于集中管理值得保存的图片素材；
- 图库打通本地文件夹，用户既可以在 CrossGen 中管理，也可以在本地文件夹中整理；
- 支持文件夹、标签、搜索、排序和折叠浏览；
- 历史和图库图片都可以点击预览或编辑；
- 历史和图库图片都可以直接拖到图生图参考图区域；
- 右键可复制本地绝对路径，方便与外部软件协作。

目标很简单：刚生成的图、之前保存的图、某个文件夹里的参考图，都应该马上找得到、拿得出来、用得上。

### 3. 生图、编辑、再生图的高效循环

CrossGen 的图片编辑区不再只是预览结果，而是串联图库和图生图的核心区域：

- 生成后直接预览；
- 快速裁剪图片；
- 可将裁剪区域另存为新图；
- 支持涂鸦、文本框、取色；
- 编辑后的图片可以保存到图库；
- 图库图片又可以拖回参考区，继续作为下一轮图生图输入。

这让 CrossGen 更适合连续创作：先生成一个基础方向，裁剪或标注关键区域，保存成素材，再立刻进入下一轮生成。

## 其他特点

- **GPT Image 2 与 Gemini/Nano Banana 图像模型**：面向重点图片模型提供清晰启动入口。
- **Agent-ready CLI/MCP runtime**：本地 agent 可以发现模型、提交 queue-backed 生图任务、查询状态并导出图库资产。
- **聚合平台兼容验证**：release gate 已覆盖 OpenAI 兼容聚合端点与 Gemini 兼容图像模型真实生图门禁。
- **持久化生图队列**：生成与编辑任务统一进入本地队列，支持状态追踪、重试、取消和默认安全并发。
- **提示词模板**：常用提示词可以保存、搜索、复用。
- **Prompt Chips**：在提示词中插入图库素材、颜色值和模板。
- **图生图参考图管理**：本地图片、图库素材、历史结果都可以成为参考图。
- **暗色模式**：适合长时间选图、对图和编辑。
- **本地优先存储**：历史、输出、模板、图库资产保存在本地。
- **MIT 开源**：可以自由使用、研究和协作改进。

## Agent Runtime

CrossGen 0.3.1 通过结构化 JSON CLI 和 MCP stdio server 暴露本地生图运行时。桌面端、CLI 和 MCP 使用同一套队列与图库规则：

- `crossgen doctor --agent --json` 返回应用路径、数据目录、provider 就绪状态、队列配置和 MCP 启动建议；
- `crossgen mcp config --client codex|claude-code|cursor --mode readonly|write|generate --json` 输出可直接粘贴的 MCP 配置；
- `crossgen generate ... --yes --wait --json` 与 MCP `crossgen_generate_image` 都通过持久化队列提交生图；
- `crossgen asset export <asset-id> --to <path> --yes --json` 可将图库受管图片复制到项目目录，不移动图库源文件。

CLI 和 MCP 是两个独立入口。MCP 可直接连接已安装的 CrossGen 应用可执行文件并传入 `--mcp`，不依赖 CLI wrapper；安装包内的 CLI launcher 会直接转发到应用可执行文件，也不需要 Node.js、npm、pnpm 或全局包。CLI/MCP 默认只读；写入和生图模式必须显式开启；付费生图需要确认；本地路径披露也必须显式确认。

### 让本地 Agent 或终端调用 CrossGen 生图

先在桌面应用中配置 API，然后使用安装包提供的 `crossgen` launcher：

```bash
crossgen doctor --agent --json
crossgen models list --json
crossgen generate --prompt "一个结构精确的等距视角应用图标" --yes --wait --json
crossgen job status <job-id> --json
crossgen asset export <asset-id> --to ./assets/app-icon.png --yes --json
```

图片编辑使用同一队列，并可直接传入本地参考图：

```bash
crossgen edit \
  --prompt "保持构图不变，将背景改成白色" \
  --input ./reference.png --yes --wait --json
```

面向机器的响应统一为 JSON。只读查询不会返回 API Key 和资产绝对路径；付费生图、破坏性操作、队列控制修改、资产导出和路径披露都需要显式确认。

### 接入 Codex、Claude Code、Cursor 或其他 MCP Host

CrossGen 可以生成可直接使用的 MCP 客户端配置：

```bash
crossgen mcp config --client codex --mode readonly --json
crossgen mcp config --client claude-code --mode generate --json
crossgen mcp config --client cursor --mode generate --json
```

MCP 直接通过 `--mcp` 连接已安装的 CrossGen 应用，不要求先启用 `crossgen` shell 命令。请按实际工作流选择最小权限：

| 模式 | Agent 能力 |
| --- | --- |
| `readonly` | 查询 provider、模型、能力、队列、任务、文件夹和图库资产 |
| `write` | 在只读能力上增加受控的图库和文件夹修改 |
| `generate` | 在写入能力上增加队列化生图与图片编辑 |

典型用法包括：编码时直接生成 UI 素材、批量提交多个视觉方向并轮询任务、编辑已有参考图，以及把选中的图库结果直接导出到代码仓库。

命令示例见 [`docs/cli-mcp.md`](./docs/cli-mcp.md)，当前限制见 [`docs/KNOWN_LIMITATIONS.md`](./docs/KNOWN_LIMITATIONS.md)。

## 下载安装

CrossGen 提供 release 安装包。到 [GitHub Releases](https://github.com/Bliveren/CrossGen/releases/latest) 下载对应平台安装包，安装后打开应用，填写 API Key 即可使用。

| 平台 | 安装包 |
| --- | --- |
| macOS Apple Silicon | `.dmg` |
| Windows x64 | `.exe` 安装程序 |
| Linux x64 | AppImage |

基本使用流程：

1. 打开 **API 配置**；
2. 填写 API Key 和 Base URL；
3. 执行模型探测；
4. 启动 GPT Image 2、Nano Banana/Gemini 或兼容模型；
5. 输入提示词生图；
6. 将有用的结果保存到图库；
7. 从历史或图库拖回参考图区域，继续图生图。

macOS arm64 release 已完成 Developer ID 签名和 Apple 公证。如果 Gatekeeper 拦截的是本地未签名构建，可右键应用选择 **打开**，或清除隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/CrossGen.app
```

如果 Windows 出现 SmartScreen 提示，选择 **更多信息**，再点击 **仍要运行**。

## 品牌定位

CrossGen 的含义是跨模型、跨步骤的生成工作台。它以一个本地运行时连接 API 配置、生图、编辑、图库管理、历史复用、图生图迭代与 AI Agent 工作流。

一句话定位：

> CrossGen 是面向用户与 AI Agent 的一站式本地生图工作台。

产品承诺很直接：

> API 配好一次，用户或 Agent 都能生图；有用结果集中管理，并可继续复用或直接导出到项目。

CrossGen 由 [诺惟 Nowo](https://www.nowo.com/) 与 [核炬科技 Corgnitor](https://www.corgnitor.com/) 共同维护。

诺惟关注 AI 原生产品设计、产品策略和应用工作流；核炬科技关注 AI 工程实现与产品化落地。CrossGen 是双方共同沉淀的开源桌面工具。

欢迎加入 [CrossGen Discord 社区](https://discord.gg/XphwmYtY)，反馈问题、讨论版本和交流生图工作流。

## 技术说明

CrossGen 使用 Electron、React 和 Tailwind 构建。本节面向开发、测试和发布维护人员；普通用户下载安装包即可使用。

开发运行：

```bash
pnpm install
pnpm dev:electron
pnpm build
```

验证：

```bash
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
pnpm verify:release-evidence
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

发布门禁记录在 [`docs/release/evidence.json`](./docs/release/evidence.json)。Mock 验证不会消耗真实 API 额度；真实 provider 验证需要显式授权并配置本地环境变量。

## 许可证

CrossGen 使用 [MIT License](./LICENSE) 开源。
