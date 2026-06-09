# Multi-Model Checklist

Target release: `v0.2.0`

## 0. 版本目标检查

- [x] 多生图模型支持被确认为 `v0.2.0` 核心版本目标
- [ ] `v0.2.0` release notes 覆盖 GPT Image 2、Nano Banana 3、General 支持
- [ ] `v0.2.0` 发布前完成多模型 mock 验证
- [ ] `v0.2.0` 发布前完成至少一轮真实 OpenAI / Gemini API 外部验收

## 1. 产品检查

- [ ] 服务配置区支持选择 provider
- [ ] OpenAI provider 默认 Base URL 正确
- [ ] Gemini provider 默认 Base URL 正确
- [ ] API Key 保存后可自动发现模型
- [ ] 模型发现失败有明确提示
- [ ] 模型发现成功后显示可用模型数量或状态
- [ ] 启动模型区位于服务配置区下方
- [ ] `GPT Image 2` 启动按钮可按需启用/置灰
- [ ] `Nano Banana 3` 启动按钮可按需启用/置灰
- [ ] `General` 启动按钮可按需启用/置灰
- [ ] 不可用按钮有用户能理解的原因
- [ ] 点击启动模型后主工作区切换到对应模型界面
- [ ] 当前启动模型在 UI 中有清晰状态

## 2. Provider 与模型探测检查

- [ ] OpenAI `/models` 探测成功时能识别 `gpt-image-2`
- [ ] OpenAI `/models` 不含 `gpt-image-2` 时按钮置灰
- [ ] Gemini `/models` 探测成功时能识别 `gemini-3.1-flash-image`
- [ ] Gemini `/models` 不含目标模型时按钮置灰
- [ ] General 能识别非重点但可用的图片模型
- [ ] 探测请求不会把 API Key 写入日志
- [ ] 探测错误会脱敏
- [ ] 切换 provider 不会误用另一个 provider 的 Key
- [ ] 清除 Key 后清空对应 provider 的可用模型状态

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

- [ ] 文生图仍调用 `/v1/images/generations`
- [ ] 编辑仍调用 `/v1/images/edits`
- [ ] 局部重绘仍发送 OpenAI mask 参数
- [ ] 多图编辑仍使用正确 multipart 字段
- [ ] stream 开启时仍处理 partial image
- [ ] `partial_images` 仍限制 0..3
- [ ] 自定义尺寸仍符合 `gpt-image-2` 约束
- [ ] `background` 不显示 transparent
- [ ] `input_fidelity` 不暴露给 `gpt-image-2`
- [ ] 下载、打开目录、删除历史仍安全
- [x] mock OpenAI verifier 通过

## 5. Nano Banana 3 检查

- [ ] 启动按钮映射到 `gemini-3.1-flash-image`
- [ ] UI 显示 Nano Banana 3 专属参数
- [ ] UI 不显示 OpenAI-only 参数
- [ ] 文生图请求使用 Gemini `generateContent`
- [ ] 参考图编辑请求包含 image `inlineData`
- [ ] 响应 image parts 能保存到本地
- [ ] 响应 text parts 能保存为 job metadata
- [ ] 生成结果能显示在中间画布
- [ ] 生成结果能下载
- [ ] 失败错误提示清晰且脱敏
- [ ] Thinking 开关只在模型支持时显示
- [ ] Search grounding 开关只在模型支持时显示
- [ ] Resolution 控件符合 Nano Banana 3 能力
- [ ] Aspect ratio 控件符合 Nano Banana 3 能力
- [ ] 局部引导编辑文案不承诺 exact mask
- [x] mock Gemini verifier 通过

## 6. General 模式检查

- [ ] General 只在存在可尝试图片模型时启用
- [ ] General UI 不显示未确认高级能力
- [ ] General 运行失败时提示模型未适配或 provider 不兼容
- [ ] General 历史任务记录真实 model id
- [ ] General 不影响重点模型按钮状态

## 7. 历史任务检查

- [x] 每条历史显示模型 chip
- [x] 模型 chip 显示 `GPT Image 2`
- [ ] 模型 chip 显示 `Nano Banana 3`
- [ ] General 历史显示真实 model id 或 `General`
- [x] 默认只展示 6 条历史
- [x] 超过 6 条出现展开入口
- [x] 展开后出现收起入口
- [x] 展开后右侧历史区域内部滚动
- [x] 展开历史不会拉长窗口整体高度
- [x] 搜索历史时模型字段可参与搜索
- [ ] 复用历史任务能恢复对应模型参数
- [x] 删除单条历史仍只删除该 job owned files
- [x] 清空历史仍清理 owned generated files

## 8. UI 与交互检查

- [ ] 服务配置、启动模型、参数面板层级清晰
- [ ] 同层级标题字号统一
- [ ] 按钮文字不会溢出
- [ ] 左右栏拖拽仍可用
- [ ] 切换模型不会重置不相关 provider config
- [ ] 切换模型时 prompt 草稿保留或有明确恢复规则
- [ ] 切换模型时不兼容参数会被安全重置
- [ ] 无 Electron bridge 的 Web 预览仍给出清晰提示
- [ ] Electron bridge 下配置、探测、运行功能可用

## 9. 安全检查

- [ ] OpenAI API Key 不进入 renderer 明文状态以外的日志
- [ ] Gemini API Key 不进入 renderer 明文状态以外的日志
- [ ] 已保存 Key 只显示脱敏预览
- [ ] 错误信息脱敏 `sk-...`
- [ ] 错误信息脱敏 Google API key 样式
- [ ] 本地 state 不提交到仓库
- [ ] 资源协议仍只允许 managed image dir
- [ ] 下载仍只允许当前历史中的 output asset
- [ ] 删除历史不会删除用户上传的外部源图
- [ ] Gemini uploaded image 权利提醒文案可见

## 10. 自动化检查

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm verify:mock-api`
- [x] `pnpm verify:mock-gemini-api`
- [x] state migration tests
- [ ] provider discovery tests
- [x] model catalog tests
- [ ] OpenAI adapter tests
- [ ] Gemini adapter tests
- [x] renderer i18n tests
- [x] package config tests

## 11. 真实 API 验收

- [ ] OpenAI Key 可发现 `gpt-image-2`
- [ ] OpenAI Key 可完成一次文生图
- [ ] OpenAI Key 可完成一次参考图编辑
- [ ] OpenAI Key 可完成一次 mask 局部重绘
- [ ] Gemini Key 可发现 `gemini-3.1-flash-image`
- [ ] Gemini Key 可完成一次 Nano Banana 3 文生图
- [ ] Gemini Key 可完成一次 Nano Banana 3 参考图编辑
- [ ] Gemini Key 可完成一次 Nano Banana 3 局部引导编辑
- [ ] 历史中能区分 OpenAI 与 Gemini 任务
- [ ] 真实 API 验收仍受成本确认环境变量保护

## 12. 发布前检查

- [ ] README 更新多模型定位
- [ ] ARCHITECTURE 更新 provider adapter 架构
- [ ] TODO 更新多模型阶段状态
- [ ] CHECKLIST 更新多模型验收项
- [ ] SECURITY 更新 Gemini Key 说明
- [ ] EXTERNAL_ACCEPTANCE 更新 Gemini 真实 API 验收
- [ ] OPEN_SOURCE_AUDIT 更新多 provider 风险
- [ ] secret scan 无真实 OpenAI Key
- [ ] secret scan 无真实 Gemini Key
- [x] macOS package smoke test 不回退
- [x] Windows package smoke test 不回退
- [x] Linux package smoke test 不回退
