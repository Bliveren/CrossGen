# Image2Tools

一个面向 `gpt-image-2` 的极简桌面工具。

目标很明确：
- 录入 API Key 后即可生成图片
- 支持图片编辑、参考图、多图编辑、局部重绘
- 支持预览、下载、历史记录
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
```

`pnpm build` 会依次执行类型检查、单元测试、renderer 构建和 main 构建。`pnpm package:dir` 生成未压缩应用目录，适合本地试跑；`pnpm package:mac` 生成 macOS dmg/zip。当前配置默认不签名，正式分发前需要补充开发者证书、公证和跨平台安装验证。

打包图标位于 `build/icon.icns`、`build/icon.ico` 和 `build/icon.png`，源自 `public/favicon.svg`。

## Mock API 验证

没有真实 API Key 时，可以先启动本地 mock：

```bash
pnpm mock:openai
```

然后在应用里填写：
- API Key: `sk-mock-image2tools`
- Base URL: `http://127.0.0.1:8787/v1`

mock 支持 `/models`、`/images/generations`、`/images/edits`，并返回有效 PNG base64 和流式 partial/completed 事件。它只能验证本地配置、请求、流式预览、保存、下载、历史等链路，不代表真实 `gpt-image-2` 质量或服务端验收。

## 默认假设

- 优先直接接 OpenAI API
- 默认模型为 `gpt-image-2`
- 使用本地存储保存配置、历史与图片文件
- 先做桌面端单机版，不做账号体系和云同步
