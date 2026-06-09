# Image2Tools 多生图模型支持计划

Last updated: 2026-06-09

Target release: `v0.2.0`

## 0. Progress Log

- 2026-06-09: Phase 1 contracts/state migration merged to `main` via PR #73.
- 2026-06-09: Gemini mock image API and verifier merged to `main` via PR #72.
- 2026-06-09: History model/provider chips, collapsed list, internal scrolling, and match-count search merged to `main` via PR #74.
- 2026-06-09: Hosted Windows package CI was split into package-smoke mode while full native install verification remains available by default, unblocking PR package gates via PR #75.
- 2026-06-09: OpenAI provider adapter extraction and GPT Image 2 regression coverage merged to `main` via PR #77.
- 2026-06-09: Gemini image adapter runtime, `generateContent` request/response handling, inline image saving, validation, and adapter tests merged to `main` via PR #80.
- 2026-06-09: Model discovery service/UI, provider selector, launch-button state, automatic save/test discovery refresh, and provider discovery tests merged to `main` via PR #79.
- 2026-06-09: Nano Banana 3 renderer parameter UI, Gemini launch run path, guided-region copy, General unsupported state, and history reuse restore merged to `main` via PR #82.

## 1. 目标

将 Image2Tools 从当前的 `gpt-image-2` 单模型工作台升级为多生图模型工作台，作为 `v0.2.0` 的核心版本目标。

最终用户体验：

1. 用户在服务配置区保存模型 API Key。
2. 系统自动读取该 Key 可访问的生图模型。
3. 服务配置区下方展示重点支持模型的启动按钮：
   - `GPT Image 2`
   - `Nano Banana 3`
   - `General`
4. Key 支持的模型按钮可点击，不支持的模型按钮置灰并显示不可用原因。
5. 点击启动模型后，主工作区进入该模型专属的生成、编辑、局部处理和参数配置界面。
6. 右侧历史任务显示每张图使用的模型，并默认折叠 6 条后的历史内容。

## 2. 当前基线

当前 main 分支已经实现：

- Electron + React + Vite 桌面应用
- OpenAI `gpt-image-2` 生成、编辑、局部重绘
- OpenAI Image API streaming partial previews
- 本地历史、下载、草稿恢复
- API Key 本地保存与脱敏预览
- 左右栏可拖拽布局
- mock OpenAI Image API 验证脚本
- 跨平台打包配置和 release verifier

当前关键约束：

- `ImageParams`、`validateImageParams`、`openaiImage.ts` 强绑定 `gpt-image-2`
- `ProviderConfig` 默认假设 OpenAI-like provider
- 历史任务未把 provider/model 作为一等字段展示
- mask 编辑语义目前是 OpenAI Image API 的精确 mask 参数语义

## 3. 官方能力判断

### GPT Image 2

参考：OpenAI Image Generation guide

`gpt-image-2` 继续使用 OpenAI Image API：

- 文生图：`/v1/images/generations`
- 编辑/局部重绘：`/v1/images/edits`
- 支持 streaming partial images
- 支持 `size`、`quality`、`output_format`、`output_compression`、`background`、`n`、`moderation`
- 支持 mask 参数；多图输入时 mask 应用于第一张图
- `gpt-image-2` 不支持 transparent background，不暴露 `input_fidelity`

### Nano Banana 3

参考：Google AI Gemini image generation docs。

Google 官方把 Nano Banana 定义为 Gemini 的 native image generation capabilities，并列出多条模型线：

- `gemini-2.5-flash-image`：Nano Banana
- `gemini-3.1-flash-image`：Nano Banana 2
- `gemini-3-pro-image`：Nano Banana Pro

本项目按用户确认采用建议映射：

- 产品按钮：`Nano Banana 3`
- 首期模型 ID：`gemini-3.1-flash-image`
- 后续可在 Nano Banana 面板内增加 Pro/Flash variant selector

Gemini 图片能力侧重点：

- 使用 Gemini `generateContent`
- 输入可以是文本和图片；`gemini-3.1-flash-image` 还支持 PDF 输入
- 输出可以包含 image 和 text parts
- 支持文本生成图片、文本+图片编辑、多轮会话式编辑
- 生成图片带 SynthID watermark
- `gemini-3.1-flash-image` 支持 image search grounding、thinking、更多输出分辨率和宽高比

重要边界：

- Gemini image generation docs 没有与 OpenAI Image API 等价的独立 `mask` multipart 参数。
- 首期不应把 Nano Banana 的局部处理描述为“精确 mask inpaint”。
- 可以实现“局部引导编辑”：用户涂抹区域后，将源图和 mask/overlay 作为输入参考，并在 prompt 中说明只修改涂抹区域，但 UI 文案必须说明这是引导式区域编辑。

### General

`General` 是兜底模式，用于 Key 可访问但系统尚未重点适配的图片模型。

首期定位：

- 最小可用生成界面
- 支持输入 prompt
- 支持基础参考图上传，前提是 provider adapter 可处理
- 不承诺高级参数、mask、streaming、批量生成

## 4. 核心设计

### 4.0 Phase 0 决策冻结

Provider selector 文案与默认顺序：

- 默认顺序：`OpenAI`、`Gemini`、`Custom`
- 英文 UI 文案：`Provider`
- 中文 UI 文案：`服务商`
- OpenAI 默认 Base URL：`https://api.openai.com/v1`
- Gemini 默认 Base URL：`https://generativelanguage.googleapis.com/v1beta`
- Custom 仅作为后续兼容入口，首期不作为重点启动模型的默认入口

General 模式首期范围：

- 仅作为可尝试的兜底生成模式
- 只展示 prompt、基础参考图输入、运行按钮和“不承诺高级能力”的提示
- 不显示 mask、streaming、output format、compression、moderation、thinking、search grounding 等未适配能力
- 不承诺编辑、精确局部重绘、多轮会话或批量生成
- 运行失败时必须提示当前 provider/model 未适配或不兼容
- 历史任务必须记录真实 provider/model 信息

### 4.1 Provider Adapter

新增 provider adapter 层，隔离不同 API 的请求、模型探测、参数校验和结果解析。

建议接口：

```ts
export interface ImageProviderAdapter {
  kind: ProviderKind;
  discoverModels(config: StoredProviderConfig): Promise<DiscoveredModel[]>;
  testConnection(config: StoredProviderConfig): Promise<ConnectionTestResult>;
  validateJob(request: RunJobRequest): ValidationResult;
  runJob(job: GenerationJob, runtime: ImageJobRuntime): Promise<GenerationJob>;
}
```

Provider kind：

- `openai`
- `gemini`
- `custom`

首期 adapters：

- `openaiImageAdapter`
- `geminiImageAdapter`
- `generalImageAdapter`，可先包一层能力有限的 provider-specific fallback

### 4.2 Model Capability Catalog

新增本地能力表，区分“远端 Key 能访问模型”和“本应用知道如何操作模型”。

建议字段：

```ts
export interface FocusedModelDefinition {
  launchId: "gpt-image-2" | "nano-banana-3" | "general";
  displayName: string;
  providerKind: ProviderKind;
  modelIds: string[];
  defaultModelId: string;
  capabilities: ImageModelCapabilities;
}

export interface ImageModelCapabilities {
  generate: boolean;
  edit: boolean;
  inpaint: "exact-mask" | "guided-region" | false;
  referenceImages: boolean;
  multiTurn: boolean;
  streamingPartials: boolean;
  outputText: boolean;
  configurableOutputFormat: boolean;
  configurableResolution: "openai-size" | "gemini-resolution-aspect" | "none";
  supportsThinking: boolean;
  supportsSearchGrounding: boolean;
}
```

模型启动按钮状态来自：

1. Provider 是否配置并能连接。
2. 远端模型列表是否包含 catalog 中的目标 model id。
3. 本地 adapter 是否支持该 launch id。

### 4.3 数据模型迁移

将 state 从 v1 迁移到 v2。

Provider 配置：

```ts
interface StoredProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  enabled: boolean;
  encryptedApiKey?: string;
  encryption: "safeStorage" | "localFallback" | "none";
  discoveredModels: DiscoveredModel[];
  lastModelDiscoveryAt?: string;
  activeLaunchId?: FocusedLaunchId;
  activeModelId?: string;
  updatedAt: string;
}
```

历史任务：

```ts
interface GenerationJob {
  id: string;
  providerKind: ProviderKind;
  providerId: string;
  launchId: FocusedLaunchId;
  modelId: string;
  modelDisplayName: string;
  mode: WorkMode;
  prompt: string;
  params: ImageParamsUnion;
  status: JobStatus;
  outputs: ImageAsset[];
}
```

参数 union：

- `OpenAIImageParams`
- `GeminiImageParams`
- `GeneralImageParams`

迁移规则：

- v1 state config 迁移为一个 `openai` provider。
- v1 历史任务补：
  - `providerKind: "openai"`
  - `launchId: "gpt-image-2"`
  - `modelId: job.params.model || "gpt-image-2"`
  - `modelDisplayName: "GPT Image 2"`

### 4.4 UI 信息架构

左侧：

1. 服务配置
   - Provider selector
   - API Key
   - Base URL
   - 保存、测试、清除 Key
   - 模型探测状态
2. 启动模型
   - `GPT Image 2`
   - `Nano Banana 3`
   - `General`
   - 不可用按钮显示 reason tooltip / inline text
3. 当前启动模型的参数面板

中间：

- 模式 tabs 根据模型能力变化：
  - GPT Image 2：生成、编辑、局部重绘
  - Nano Banana 3：生成、参考图编辑、局部引导编辑/继续编辑
  - General：生成；必要时仅显示 prompt 和基础输入
- 结果画布保持一致
- Prompt 区保持一致
- 上传图片入口根据能力显示

右侧：

- 历史条目显示 model chip
- 默认只显示 6 条
- 第 7 条以后折叠
- 显示 `展开全部` / `收起`
- 展开后 `.history-list` 内部滚动，不拉长页面整体高度

### 4.5 Nano Banana 3 参数面板

首期建议参数：

- Model variant：默认 `gemini-3.1-flash-image`
- Aspect ratio：预设常用比例，包含 Gemini 3.1 文档提到的新比例能力
- Resolution：`0.5K`、`1K`、`2K`、`4K`，默认 `1K`
- Thinking：仅在支持模型上显示
- Search grounding：仅在支持模型上显示
- Output count：首期可限制为 1，避免 Gemini response parts 与历史保存复杂化
- Timeout seconds

Nano Banana 3 不显示：

- OpenAI `output_format`
- OpenAI `output_compression`
- OpenAI `moderation`
- OpenAI `partial_images`
- OpenAI exact mask 参数

### 4.6 Gemini 请求策略

Endpoint：

```text
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}
```

请求结构：

- `contents[].parts[].text` 放 prompt
- `contents[].parts[].inlineData` 放上传图片 base64
- `generationConfig.responseModalities` 请求 image output
- model-specific config 放 Gemini adapter 内部转换

响应解析：

- 遍历 `candidates[].content.parts`
- 保存 `inlineData` / image parts 为本地 `ImageAsset`
- text parts 可保存为 job metadata，后续可在 UI 显示 reasoning/notes

### 4.7 历史折叠规则

建议状态：

```ts
const HISTORY_COLLAPSED_COUNT = 6;
const [historyExpanded, setHistoryExpanded] = useState(false);
const visibleHistory = historyExpanded ? filteredHistory : filteredHistory.slice(0, HISTORY_COLLAPSED_COUNT);
```

展示规则：

- 搜索为空：默认显示最近 6 条
- 搜索有内容：仍默认显示匹配结果前 6 条，并提示匹配总数
- 展开后历史面板内部滚动
- 历史条目顶部显示：
  - model chip
  - mode
  - status
  - time

## 5. 阶段计划

| 阶段 | 目标 | 主要产出 | 完成标准 |
| --- | --- | --- | --- |
| Phase 0 | `v0.2.0` 设计冻结 | 本计划、TODO、Checklist | 团队确认 `Nano Banana 3 -> gemini-3.1-flash-image` |
| Phase 1 | `v0.2.0` 契约与迁移 | Provider/model 类型、catalog、state v2 迁移 | 旧历史与配置无损读取 |
| Phase 2 | `v0.2.0` 模型探测与启动区 | OpenAI/Gemini discovery、启动模型按钮 | 按钮状态能随 Key 和模型列表变化 |
| Phase 3 | `v0.2.0` GPT Image 2 adapter 化 | 保留当前全部 OpenAI 能力 | 现有测试、mock verifier、真实验收路径不回退 |
| Phase 4 | `v0.2.0` Nano Banana 3 adapter | Gemini generateContent、图片输入编辑、参数面板 | 可用 Gemini Key 生成和编辑图片 |
| Phase 5 | `v0.2.0` General 与历史体验 | General 模式、历史 model chip、6 条折叠 | 历史不拉长窗口且模型可追溯 |
| Phase 6 | `v0.2.0` 文档、测试、发布验收 | README、mock Gemini API、release 验证 | `pnpm build` 与 mock 验证通过 |

## 6. Ownership 建议

如果并行开发，建议按模块拆分：

1. Agent A：shared contracts
   - `src/shared/types.ts`
   - `src/shared/modelCatalog.ts`
   - validation union
   - state migration tests
2. Agent B：main process adapters
   - `src/main/services/modelDiscovery.ts`
   - `src/main/services/openaiImage.ts`
   - `src/main/services/geminiImage.ts`
   - IPC handlers
3. Agent C：renderer UI
   - `src/renderer/App.tsx`
   - `src/renderer/i18n.ts`
   - `src/renderer/styles.css`
4. Agent D：tests, mocks, docs
   - `scripts/mock-openai-image-api.mjs`
   - `scripts/mock-gemini-image-api.mjs`
   - verify scripts
   - README / acceptance docs

每个 agent 必须从最新 `origin/main` 创建独立 worktree 和 `codex/` 分支，不复用旧 worktree。

## 7. 风险与边界

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 远端模型列表不能表达完整能力 | 按钮状态误判 | 远端模型可见性 + 本地 capability catalog 双重判断 |
| Nano Banana mask 语义与 OpenAI 不同 | 用户误解局部编辑精度 | UI 命名为“局部引导编辑”，不承诺精确 mask |
| state v2 迁移破坏旧历史 | 用户历史丢失 | 写迁移测试，保留 v1 读取路径和备份 |
| 参数 union 增加复杂度 | 类型和 UI 分支混乱 | adapter 层拥有 provider-specific validation |
| General 过度承诺 | 体验不稳定 | 首期只做 minimal generation |
| Gemini 输出 text+image 混合 | 历史和结果解析复杂 | image parts 保存为 outputs，text parts 保存为 metadata |
| API Key 多 provider 管理 | 配置区复杂 | 首期一次只激活一个 provider，后续再做多 provider 列表 |

## 8. 官方参考

- OpenAI Image Generation: https://platform.openai.com/docs/guides/image-generation
- Gemini Nano Banana Image Generation: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini Models API: https://ai.google.dev/api/models
- Gemini 2.5 Flash Image: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
- Gemini 3.1 Flash Image: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
