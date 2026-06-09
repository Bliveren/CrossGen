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

- [ ] 新增 `ProviderKind`
- [ ] 新增 `FocusedLaunchId`
- [ ] 新增 `FocusedModelDefinition`
- [ ] 新增 `ImageModelCapabilities`
- [ ] 新增 `DiscoveredModel`
- [ ] 将 `ProviderConfig` 扩展为支持 provider kind、discovered models、active launch/model
- [ ] 将 `ImageParams` 改造为 `OpenAIImageParams | GeminiImageParams | GeneralImageParams`
- [ ] 将 `GenerationJob` 增加 provider/model 字段
- [ ] 将 `WorkspaceDraft` 增加 active launch/model 字段
- [ ] 新增 `src/shared/modelCatalog.ts`
- [ ] 将 `gpt-image-2` 常量从通用 validation 中迁移到 OpenAI-specific validation
- [ ] 新增 state v2 结构
- [ ] 实现 v1 -> v2 state migration
- [ ] 为 v1 config migration 写测试
- [ ] 为 v1 history migration 写测试
- [ ] 确认旧 state backup 逻辑仍正常

## Phase 2 - `v0.2.0` 模型探测与启动模型区

- [ ] 新增 `src/main/services/modelDiscovery.ts`
- [ ] 实现 OpenAI `GET /models` 探测
- [ ] 实现 Gemini `GET /models?key=...` 探测
- [ ] 将模型探测结果存入 provider config
- [ ] 新增 `config:discoverModels` IPC
- [ ] 保存 API Key 后自动触发 discovery
- [ ] 连接测试时同步刷新 discovery
- [ ] 服务配置区增加 provider selector
- [ ] 服务配置区根据 provider 切换默认 Base URL
- [ ] 服务配置区显示最近模型探测时间
- [ ] 服务配置区显示模型探测失败原因
- [ ] 新增启动模型按钮区
- [ ] `GPT Image 2` 按钮根据 OpenAI discovery 启用
- [ ] `Nano Banana 3` 按钮根据 Gemini discovery 启用
- [ ] `General` 按钮根据任意可用图片模型启用
- [ ] 点击启动模型更新 active launch/model
- [ ] 不可用按钮显示不可用原因
- [ ] i18n 补齐中英文文案

## Phase 3 - `v0.2.0` GPT Image 2 adapter 化

- [ ] 新增 `ImageProviderAdapter` 接口
- [ ] 将当前 OpenAI 请求逻辑迁入 `openaiImageAdapter`
- [ ] 保留 `/images/generations` 文生图请求行为
- [ ] 保留 `/images/edits` 编辑请求行为
- [ ] 保留 mask 参数与校验行为
- [ ] 保留 streaming partial images 行为
- [ ] 保留 partial/result output 保存行为
- [ ] 保留 API error 脱敏行为
- [ ] 更新 `validateRunJobRequest` 支持 OpenAI params union
- [ ] 更新 `getValidationError` 分发到 OpenAI validation
- [ ] 更新 OpenAI service tests
- [ ] 更新 mock OpenAI verify script
- [ ] 确保 `pnpm verify:mock-api` 仍通过
- [ ] 确保 GPT Image 2 UI 与当前体验基本一致

## Phase 4 - `v0.2.0` Nano Banana 3 adapter 与 UI

- [ ] 新增 `src/main/services/geminiImage.ts`
- [ ] 实现 Gemini endpoint builder
- [ ] 实现 Gemini request body builder
- [ ] 实现 text-to-image `generateContent`
- [ ] 实现 text-and-image-to-image `generateContent`
- [ ] 支持上传图片转 `inlineData`
- [ ] 解析 Gemini response image parts
- [ ] 保存 Gemini image parts 为 `ImageAsset`
- [ ] 保存 Gemini text parts 为 job metadata
- [ ] 实现 Gemini timeout 和错误归类
- [ ] 实现 Gemini API Key 错误脱敏
- [ ] 实现 `GeminiImageParams` validation
- [ ] Nano Banana UI 增加 aspect ratio 控件
- [ ] Nano Banana UI 增加 resolution 控件
- [ ] Nano Banana UI 增加 Thinking 开关
- [ ] Nano Banana UI 增加 Search grounding 开关
- [ ] Nano Banana UI 隐藏 OpenAI-only 参数
- [ ] Nano Banana 模式支持生成
- [ ] Nano Banana 模式支持参考图编辑
- [ ] Nano Banana 模式支持局部引导编辑
- [ ] 局部引导编辑文案说明非 exact mask
- [ ] 为 Gemini request builder 写单元测试
- [ ] 为 Gemini response parser 写单元测试
- [ ] 新增 mock Gemini Image API
- [ ] 新增 Gemini mock verifier

## Phase 5 - `v0.2.0` General 模式

- [ ] 定义 General launch 的最小能力
- [ ] General UI 只显示 prompt、基础输入和运行按钮
- [ ] General 模式显示“高级能力未适配”的提示
- [ ] General 模式接入 provider-specific fallback
- [ ] General 模式失败时给出清晰模型不兼容提示
- [ ] General 历史任务正常记录 provider/model
- [ ] General 不显示 mask、streaming、format 等未确认能力

## Phase 6 - `v0.2.0` 历史任务体验

- [ ] 历史任务条目增加 model chip
- [ ] 历史任务条目显示 provider kind
- [ ] 历史任务条目保留 mode/status/time
- [ ] 默认只显示 6 条历史
- [ ] 超过 6 条时显示展开按钮
- [ ] 展开后显示收起按钮
- [ ] 展开后历史列表内部滚动
- [ ] 搜索历史时显示匹配数量
- [ ] 搜索历史时仍支持 6 条折叠规则
- [ ] 复用历史任务时恢复对应 provider/model/params
- [ ] 删除历史任务继续只删除 owned output files
- [ ] 清空历史仍清理所有 owned outputs

## Phase 7 - `v0.2.0` 测试与验收

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm build` 通过
- [ ] `pnpm verify:mock-api` 通过
- [ ] 新增 `pnpm verify:mock-gemini-api`
- [ ] OpenAI mock 生成通过
- [ ] OpenAI mock 编辑通过
- [ ] OpenAI mock inpaint 通过
- [ ] Gemini mock 生成通过
- [ ] Gemini mock 参考图编辑通过
- [ ] 模型 discovery mock 通过
- [ ] state v1 -> v2 migration tests 通过
- [ ] renderer i18n shape tests 通过
- [ ] 手工确认无 Key 时启动模型按钮置灰
- [ ] 手工确认 OpenAI Key 仅启用 GPT Image 2
- [ ] 手工确认 Gemini Key 仅启用 Nano Banana 3
- [ ] 手工确认历史折叠不会拉长窗口

## Phase 8 - `v0.2.0` 文档与发布

- [ ] 更新 README 项目定位，从单 `gpt-image-2` 改为多模型工作台
- [ ] 更新 ARCHITECTURE.md provider adapter 架构
- [ ] 更新 TODO.md 当前阶段
- [ ] 更新 CHECKLIST.md 多模型验收项
- [ ] 更新 EXTERNAL_ACCEPTANCE.md 增加 Gemini 真实 API 验收
- [ ] 更新 SECURITY.md 增加 Gemini Key 处理说明
- [ ] 更新 mock API 文档
- [ ] 更新 release verifier 说明
- [ ] 重新跑开源 secret scan
- [ ] 确认文档没有写死未验证的 Nano Banana 能力
