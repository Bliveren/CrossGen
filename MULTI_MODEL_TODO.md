# Multi-Model TODO

Target release: `v0.2.0`

## Phase 0 - `v0.2.0` 设计冻结

- [x] 确认多模型工作台目标
- [x] 确认重点启动模型：`GPT Image 2`、`Nano Banana 3`、`General`
- [x] 确认 `Nano Banana 3` 首期映射到 `gemini-3.1-flash-image`
- [x] 确认 Nano Banana 局部编辑首期为“局部引导编辑”，不是 OpenAI 等价 exact mask
- [x] 产出多模型 plan / todo / checklist 文档
- [x] 确认多模型支持作为 `v0.2.0` 版本目标
- [x] 团队确认 provider selector 文案和默认 provider 顺序
- [x] 团队确认 General 模式首期功能范围

## Phase 1 - `v0.2.0` 类型契约与数据迁移

- [x] 新增 `ProviderKind`
- [x] 新增 `FocusedLaunchId`
- [x] 新增 `FocusedModelDefinition`
- [x] 新增 `ImageModelCapabilities`
- [x] 新增 `DiscoveredModel`
- [x] 将 `ProviderConfig` 扩展为支持 provider kind、discovered models、active launch/model
- [x] 将 `ImageParams` 改造为 `OpenAIImageParams | GeminiImageParams | GeneralImageParams`
- [x] 将 `GenerationJob` 增加 provider/model 字段
- [x] 将 `WorkspaceDraft` 增加 active launch/model 字段
- [x] 新增 `src/shared/modelCatalog.ts`
- [x] 将 `gpt-image-2` 常量从通用 validation 中迁移到 OpenAI-specific validation
- [x] 新增 state v2 结构
- [x] 实现 v1 -> v2 state migration
- [x] 为 v1 config migration 写测试
- [x] 为 v1 history migration 写测试
- [x] 确认旧 state backup 逻辑仍正常

## Phase 2 - `v0.2.0` 模型探测与启动模型区

- [x] 新增 `src/main/services/modelDiscovery.ts`
- [x] 实现 OpenAI `GET /models` 探测
- [x] 实现 Gemini `GET /models?key=...` 探测
- [x] 将模型探测结果存入 provider config
- [x] 新增 `config:discoverModels` IPC
- [x] 保存 API Key 后自动触发 discovery
- [x] 连接测试时同步刷新 discovery
- [x] 服务配置区增加 provider selector
- [x] 服务配置区根据 provider 切换默认 Base URL
- [x] 服务配置区显示最近模型探测时间
- [x] 服务配置区显示模型探测失败原因
- [x] 新增启动模型按钮区
- [x] `GPT Image 2` 按钮根据 OpenAI discovery 启用
- [x] `Nano Banana 3` 按钮根据 Gemini discovery 启用
- [x] `General` 按钮根据 Gemini 非重点图片候选模型启用
- [x] `General` 按钮根据任意可用图片模型启用
- [x] 点击启动模型更新 active launch/model
- [x] 不可用按钮显示不可用原因
- [x] i18n 补齐中英文文案

## Phase 3 - `v0.2.0` GPT Image 2 adapter 化

- [x] 新增 `ImageProviderAdapter` 接口
- [x] 将当前 OpenAI 请求逻辑迁入 `openaiImageAdapter`
- [x] 保留 `/images/generations` 文生图请求行为
- [x] 保留 `/images/edits` 编辑请求行为
- [x] 保留 mask 参数与校验行为
- [x] 保留 streaming partial images 行为
- [x] 保留 partial/result output 保存行为
- [x] 保留 API error 脱敏行为
- [x] 更新 `validateRunJobRequest` 支持 OpenAI params union
- [x] 更新 `getValidationError` 分发到 OpenAI validation
- [x] 更新 OpenAI service tests
- [x] 更新 mock OpenAI verify script
- [x] 确保 `pnpm verify:mock-api` 仍通过
- [x] 确保 GPT Image 2 UI 与当前体验基本一致

## Phase 4 - `v0.2.0` Nano Banana 3 adapter 与 UI

- [x] 新增 `src/main/services/geminiImageAdapter.ts`
- [x] 实现 Gemini endpoint builder
- [x] 实现 Gemini request body builder
- [x] 实现 text-to-image `generateContent`
- [x] 实现 text-and-image-to-image `generateContent`
- [x] 支持上传图片转 `inlineData`
- [x] 解析 Gemini response image parts
- [x] 保存 Gemini image parts 为 `ImageAsset`
- [x] 保存 Gemini text parts 为 job metadata
- [x] 实现 Gemini timeout 和错误处理
- [x] 实现 Gemini API Key 错误脱敏
- [x] 实现 `GeminiImageParams` validation
- [x] Nano Banana UI 增加 aspect ratio 控件
- [x] Nano Banana UI 增加 resolution 控件
- [x] Nano Banana UI 增加 Thinking 开关
- [x] Nano Banana UI 增加 Search grounding 开关
- [x] Nano Banana UI 隐藏 OpenAI-only 参数
- [x] Nano Banana 模式支持生成
- [x] Nano Banana 模式支持参考图编辑
- [x] Nano Banana 模式支持局部引导编辑
- [x] 局部引导编辑文案说明非 exact mask
- [x] 为 Gemini request builder 写单元测试
- [x] 为 Gemini response parser 写单元测试
- [x] 新增 mock Gemini Image API
- [x] 新增 Gemini mock verifier

## Phase 5 - `v0.2.0` General 模式

- [x] 定义 General launch 的最小能力
- [x] General UI 只显示 prompt、基础输入和运行按钮
- [x] General 模式显示“高级能力未适配”的提示
- [x] General 模式接入 Gemini provider-specific fallback
- [x] General 模式接入任意 provider fallback（Gemini 支持参考图；OpenAI / Custom 使用 prompt-only OpenAI 兼容最小契约）
- [x] General 模式失败时给出清晰模型不兼容提示
- [x] General 历史任务正常记录 provider/model
- [x] General 不显示 mask、streaming、format 等未确认能力

## Phase 6 - `v0.2.0` 历史任务体验

- [x] 历史任务条目增加 model chip
- [x] 历史任务条目显示 provider kind
- [x] 历史任务条目保留 mode/status/time
- [x] 默认只显示 6 条历史
- [x] 超过 6 条时显示展开按钮
- [x] 展开后显示收起按钮
- [x] 展开后历史列表内部滚动
- [x] 搜索历史时显示匹配数量
- [x] 搜索历史时仍支持 6 条折叠规则
- [x] 复用历史任务时恢复对应 provider/model/params
- [x] 删除历史任务继续只删除 owned output files
- [x] 清空历史仍清理所有 owned outputs

## Phase 7 - `v0.2.0` 测试与验收

- [x] `pnpm typecheck` 通过
- [x] `pnpm test` 通过
- [x] `pnpm build` 通过
- [x] `pnpm verify:mock-api` 通过
- [x] 新增 `pnpm verify:mock-gemini-api`
- [x] OpenAI mock 生成通过
- [x] OpenAI mock 编辑通过
- [x] OpenAI mock inpaint 通过
- [x] Gemini mock 生成通过
- [x] Gemini mock 参考图编辑通过
- [x] 模型 discovery mock 通过
- [x] state v1 -> v2 migration tests 通过
- [x] renderer i18n shape tests 通过
- [x] 手工确认无 Key 时启动模型按钮置灰（renderer smoke 覆盖）
- [x] 手工确认 OpenAI Key 启用 GPT Image 2，且有非重点图片候选时启用 General prompt-only（renderer smoke 覆盖）
- [x] 手工确认 Gemini Key 启用 Nano Banana 3，且有非重点图片候选时启用 General 参考图兜底（renderer smoke 覆盖）
- [x] 手工确认历史折叠不会拉长窗口（renderer smoke 覆盖）

## Phase 8 - `v0.2.0` 文档与发布

- [x] 更新 README 项目定位，从单 `gpt-image-2` 改为多模型工作台
- [x] 更新 ARCHITECTURE.md provider adapter 架构
- [x] 更新 TODO.md 当前阶段
- [x] 更新 CHECKLIST.md 多模型验收项
- [x] 更新 EXTERNAL_ACCEPTANCE.md 增加 Gemini 真实 API 验收
- [x] 更新 SECURITY.md 增加 Gemini Key 处理说明
- [x] 更新 mock API 文档
- [x] 更新 release verifier 说明
- [x] 补齐 `v0.2.0` 发布包版本、描述、版权和更新 manifest 元数据
- [x] 更新 manifest schema 和安装器下载校验要求 `sha256` 与 `sizeBytes`
- [x] 增加 update manifest 资产条目生成脚本，降低正式分发元数据手工出错风险
- [x] 增加外部发布证据 ledger 与 validator，避免真实 API、签名、原生平台和正式 manifest 证据自由散落
- [x] 重新跑开源 secret scan
- [x] 确认文档没有写死未验证的 Nano Banana 能力
