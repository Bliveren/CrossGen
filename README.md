# Image2Tools

一个面向 `gpt-image-2` 的极简桌面工具。

目标很明确：
- 录入 API Key 后即可生成图片
- 支持图片编辑、参考图、多图编辑、局部重绘
- 支持预览、下载、历史记录
- 支持清除本地保存的 API Key
- 支持工作区草稿自动恢复与异常状态恢复
- 界面简单，默认参数尽量自动化

## 文档索引

- [PLAN.md](./PLAN.md): 总体开发计划、阶段目标、范围边界
- [ARCHITECTURE.md](./ARCHITECTURE.md): 技术架构、数据流、模块拆分
- [TODO.md](./TODO.md): 可直接执行的任务清单
- [CHECKLIST.md](./CHECKLIST.md): 开发与发布检查清单
- [COMPLETION_AUDIT.md](./COMPLETION_AUDIT.md): 当前交付证据、验证命令和外部待办

## 本地运行

```bash
pnpm install
pnpm dev:electron
```

## 验证与打包

```bash
pnpm build
pnpm package:dir
pnpm package:mac
pnpm verify:release:mac
```

`pnpm build` 会依次执行类型检查、单元测试、renderer 构建和 main 构建。`pnpm package:dir` 生成未压缩应用目录，适合本地试跑；`pnpm package:mac` 生成 macOS dmg/zip。`pnpm verify:release:mac` 会挂载当前 dmg，复制 app 到临时目录并做两轮启动 / 主窗口出现 / 删除 / 重装烟测。当前配置默认不签名，正式分发前需要补充开发者证书、公证和跨平台安装验证。

GitHub Actions 已配置基础 CI：push / PR 到 `main` 或手动触发 workflow 时跑 build、mock API verifier，以及 macOS / Windows / Linux package gates。GUI 启动类烟测保留为本地 `pnpm verify:release:mac`，避免 CI runner 的窗口环境造成误报。

打包图标位于 `build/icon.icns`、`build/icon.ico` 和 `build/icon.png`，源自 `public/favicon.svg`。

当前 unsigned macOS arm64 试用包已发布到 private GitHub pre-release：
https://github.com/Bliveren/image2tools/releases/tag/v0.1.0-mac-unsigned

当前资产 SHA256：
- DMG: `a04cc4568a5010ca99a00df747d0317203b56fc86724ab116491c96472b31c96`
- ZIP: `75e0da8fe7181e3c515fcf8babb49da43acafa199e2cb7737b54601b48c9fd41`

## Mock API 验证

没有真实 API Key 时，可以先启动本地 mock：

```bash
pnpm mock:openai
```

或直接运行自动校验：

```bash
pnpm verify:mock-api
```

然后在应用里填写：
- API Key: `sk-mock-image2tools`
- Base URL: `http://127.0.0.1:8787/v1`

mock 支持 `/models`、`/images/generations`、`/images/edits`，并返回有效 PNG base64 和流式 partial/completed 事件。它只能验证本地配置、请求、流式预览、保存、下载、历史等链路，不代表真实 `gpt-image-2` 质量或服务端验收。

## 真实 API 验收

`pnpm verify:real-api` 用于外部手工验收真实 Image API。脚本默认不会发起图片请求；必须提供 `IMAGE2TOOLS_API_KEY` 或 `OPENAI_API_KEY`，并显式设置 `IMAGE2TOOLS_REAL_API_ACCEPT_COST=1`，才会执行真实生成、单图编辑、多图编辑和局部重绘。输出会保存到被 git 忽略的 `real-api-artifacts/`。

真实验收还要求对应 OpenAI 组织已完成 GPT Image 所需的组织验证。开启流式 `partial_images` 会产生额外输出 token 成本；如果还要让脚本额外执行真实 streaming generation/edit 检查，需要在上述成本确认之外再设置 `IMAGE2TOOLS_REAL_API_ACCEPT_STREAM_COST=1`。

## 签名准备检查

`pnpm verify:signing-ready` 会检查本机 macOS code signing identity、`package.json` 的签名配置，以及 `CSC_NAME`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 是否已设置。它只做 readiness 检查，不会签名或公证。

## 默认假设

- 优先直接接 OpenAI API
- 默认模型为 `gpt-image-2`
- 使用本地存储保存配置、历史与图片文件
- 先做桌面端单机版，不做账号体系和云同步
