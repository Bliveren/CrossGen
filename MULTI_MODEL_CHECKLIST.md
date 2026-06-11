# Multi-Model Checklist

Target release: `v0.2.0`

## 0. 版本目标检查

- [x] 多生图模型支持被确认为 `v0.2.0` 核心版本目标
- [x] `v0.2.0` release notes 覆盖 GPT Image 2、Nano Banana 3、General 支持
- [x] `v0.2.0` package metadata 和更新 manifest 已对齐多模型发布目标
- [x] `v0.2.0` 更新 manifest schema 会要求并校验资产 `sha256` 与 `sizeBytes`
- [x] `v0.2.0` update manifest 资产条目可由脚本从本地 artifact 生成
- [x] `v0.2.0` 外部发布证据有统一 ledger 和 validator
- [x] `v0.2.0` 发布前完成多模型 mock 验证
- [x] `v0.2.0` 发布前完成至少一轮真实 OpenAI / Gemini API 外部验收

## 1. 产品检查

- [x] 服务配置区支持选择 provider
- [x] OpenAI provider 默认 Base URL 正确
- [x] Gemini provider 默认 Base URL 正确
- [x] API Key 保存后可自动发现模型
- [x] 模型发现失败有明确提示
- [x] 模型发现成功后显示可用模型数量或状态
- [x] 启动模型区位于服务配置区下方
- [x] `GPT Image 2` 启动按钮可按需启用/置灰
- [x] `Nano Banana 3` 启动按钮可按需启用/置灰
- [x] `General` 启动按钮可按需启用/置灰
- [x] 不可用按钮有用户能理解的原因
- [x] 点击启动模型后主工作区切换到对应模型界面
- [x] 当前启动模型在 UI 中有清晰状态

## 2. Provider 与模型探测检查

- [x] OpenAI `/models` 探测成功时能识别 `gpt-image-2`
- [x] OpenAI `/models` 不含 `gpt-image-2` 时按钮置灰
- [x] Gemini `/models` 探测成功时能识别 `gemini-3.1-flash-image`
- [x] Gemini `/models` 不含目标模型时按钮置灰
- [x] General 能识别 Gemini 非重点图片模型
- [x] General 能识别任意 provider 的非重点可用图片模型
- [x] 探测请求不会把 API Key 写入日志
- [x] 探测错误会脱敏
- [x] 切换 provider 不会误用另一个 provider 的 Key
- [x] 清除 Key 后清空对应 provider 的可用模型状态

## 3. 数据迁移检查

- [x] v1 state 可以读取
- [x] v1 config 迁移为 OpenAI provider
- [x] v1 encrypted API Key 仍可解密
- [x] v1 history 补齐 `providerKind`
- [x] v1 history 补齐 `launchId`
- [x] v1 history 补齐 `modelId`
- [x] v1 history 补齐 `modelDisplayName`
- [x] v1 draft 迁移后可恢复
- [x] 迁移失败时仍可 fallback 到 backup
- [x] state 写入仍保留备份机制

## 4. GPT Image 2 回归检查

- [x] 文生图仍调用 `/v1/images/generations`
- [x] 编辑仍调用 `/v1/images/edits`
- [x] 局部重绘仍发送 OpenAI mask 参数
- [x] 多图编辑仍使用正确 multipart 字段
- [x] stream 开启时仍处理 partial image
- [x] `partial_images` 仍限制 0..3
- [x] 自定义尺寸仍符合 `gpt-image-2` 约束
- [x] `background` 不显示 transparent
- [x] `input_fidelity` 不暴露给 `gpt-image-2`
- [x] 下载、打开目录、删除历史仍安全
- [x] mock OpenAI verifier 通过

## 5. Nano Banana 3 检查

- [x] 启动按钮映射到 `gemini-3.1-flash-image`
- [x] UI 显示 Nano Banana 3 专属参数
- [x] UI 不显示 OpenAI-only 参数
- [x] 文生图请求使用 Gemini `generateContent`
- [x] 参考图编辑请求包含 image `inlineData`
- [x] 响应 image parts 能保存到本地
- [x] 响应 text parts 能保存为 job metadata
- [x] 生成结果能显示在中间画布
- [x] 生成结果能下载
- [x] 失败错误提示清晰且脱敏
- [x] Thinking 开关只在模型支持时显示
- [x] Search grounding 开关只在模型支持时显示
- [x] Resolution 控件符合 Nano Banana 3 能力
- [x] Aspect ratio 控件符合 Nano Banana 3 能力
- [x] 局部引导编辑文案不承诺 exact mask
- [x] mock Gemini verifier 通过

## 6. General 模式检查

- [x] General 只在存在可尝试图片模型时启用
- [x] General UI 不显示未确认高级能力
- [x] General 运行失败时提示模型未适配或 provider 不兼容
- [x] General 历史任务记录真实 model id
- [x] General 不影响重点模型按钮状态

## 7. 历史任务检查

- [x] 每条历史显示模型 chip
- [x] 模型 chip 显示 `GPT Image 2`
- [x] 模型 chip 显示 `Nano Banana 3`
- [x] General 历史显示真实 model id 或 `General`
- [x] 默认只展示 6 条历史
- [x] 超过 6 条出现展开入口
- [x] 展开后出现收起入口
- [x] 展开后右侧历史区域内部滚动
- [x] 展开历史不会拉长窗口整体高度
- [x] 搜索历史时模型字段可参与搜索
- [x] 复用历史任务能恢复对应模型参数
- [x] 删除单条历史仍只删除该 job owned files
- [x] 清空历史仍清理 owned generated files

## 8. UI 与交互检查

- [x] 服务配置、启动模型、参数面板层级清晰（renderer smoke 覆盖）
- [x] 同层级标题字号统一（renderer smoke 覆盖）
- [x] 按钮文字不会溢出（renderer smoke 覆盖长 General model）
- [x] 左右栏拖拽仍可用（renderer smoke 覆盖键盘 resize）
- [x] 切换模型不会重置不相关 provider config（renderer smoke 覆盖 launch save config）
- [x] 切换模型时 prompt 草稿保留或有明确恢复规则（renderer smoke 覆盖）
- [x] 切换模型时不兼容参数会被安全重置（renderer smoke 覆盖 OpenAI General prompt-only）
- [x] 无 Electron bridge 的 Web 预览仍给出清晰提示
- [x] Electron bridge 下配置、探测、运行功能可用

## 9. 安全检查

- [x] OpenAI API Key 不进入 renderer 明文状态以外的日志
- [x] Gemini API Key 不进入 renderer 明文状态以外的日志
- [x] 已保存 Key 只显示脱敏预览
- [x] 错误信息脱敏 `sk-...`
- [x] 错误信息脱敏 Google API key 样式
- [x] 本地 state 不提交到仓库
- [x] 资源协议仍只允许 managed image dir
- [x] 下载仍只允许当前历史中的 output asset
- [x] 删除历史不会删除用户上传的外部源图
- [x] Gemini uploaded image 权利提醒文案可见

## 10. 自动化检查

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm verify:mock-api`
- [x] `pnpm verify:mock-gemini-api`
- [x] `pnpm verify:mock-model-discovery`
- [x] state migration tests
- [x] provider discovery tests
- [x] model catalog tests
- [x] OpenAI adapter tests
- [x] Gemini adapter tests
- [x] renderer i18n tests
- [x] package config tests

## 11. 真实 API 验收

- [x] OpenAI Key 可发现 `gpt-image-2`
- [x] OpenAI Key 可完成一次文生图
- [x] OpenAI Key 可完成一次参考图编辑
- [x] OpenAI Key 可完成一次 mask 局部重绘
- [x] Gemini Key 可发现 `gemini-3.1-flash-image`
- [x] Gemini Key 可完成一次 Nano Banana 3 文生图
- [x] Gemini Key 可完成一次 Nano Banana 3 参考图编辑
- [x] Gemini Key 可完成一次 Nano Banana 3 局部引导编辑
- [ ] 历史中能区分 OpenAI 与 Gemini 任务
- [x] 真实 API 验收仍受成本确认环境变量保护

## 12. 发布前检查

- [x] README 更新多模型定位
- [x] ARCHITECTURE 更新 provider adapter 架构
- [x] TODO 更新多模型阶段状态
- [x] CHECKLIST 更新多模型验收项
- [x] SECURITY 更新 Gemini Key 说明
- [x] EXTERNAL_ACCEPTANCE 更新 Gemini 真实 API 验收
- [x] OPEN_SOURCE_AUDIT 更新多 provider 风险
- [x] secret scan 无真实 OpenAI Key
- [x] secret scan 无真实 Gemini Key
- [x] macOS package smoke test 不回退
- [x] Windows package smoke test 不回退
- [x] Linux package smoke test 不回退
