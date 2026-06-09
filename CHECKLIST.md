# Image2Tools Checklist

## 1. 需求检查

- [x] 只有一个主任务：生成 / 编辑 / 下载
- [x] 默认交互不依赖学习成本
- [x] 高级参数默认折叠
- [x] 参考图与 mask 入口明确
- [x] 失败提示用户可理解
- [x] `gpt-image-2` 的不可用能力没有出现在 UI 中

## 2. 安全检查

- [x] API Key 不写入前端日志
- [x] API Key 可加密保存
- [x] API Key 可从本地配置中清除
- [x] 导出文件路径可控
- [x] IPC 下载、打开目录、删除历史仅操作当前历史中的本地生成资源
- [x] 历史记录不泄露敏感信息
- [x] 错误信息已脱敏

## 3. 生成流程检查

- [ ] 文本提示可成功出图（需真实 API Key 手工验收）
- [x] 流式预览可显示 partial image
- [x] 终图可保存到本地
- [x] 可选择 PNG / JPEG / WEBP
- [x] 可配置质量和尺寸
- [x] 自定义尺寸校验符合 `gpt-image-2` 约束
- [x] 流式 `partial_images` 配置范围限制为 0..3
- [x] 超时提示清晰

## 4. 编辑流程检查

- [ ] 单图编辑可用（需真实 API Key 手工验收）
- [ ] 多图参考编辑可用（需真实 API Key 手工验收）
- [ ] 局部重绘可用（需真实 API Key 手工验收）
- [x] mask 尺寸校验生效
- [x] mask 与首张源图格式一致性校验生效
- [x] mask alpha 通道校验生效
- [x] 编辑结果可下载
- [x] 参考图数量限制为 GPT Image 2 支持的最多 16 张
- [x] 多图编辑时 mask 只应用到第一张图的提示清晰

## 5. 体验检查

- [x] 首次进入能快速理解如何开始
- [x] 生成中不会误以为应用卡死
- [x] 历史记录能一眼找到最近结果
- [x] 一键复用历史任务可用
- [x] 打开文件夹与复制 prompt 可用

## 6. 技术质量检查

- [x] main / preload / renderer 分层清晰
- [x] 请求封装统一
- [x] 错误处理统一
- [x] 文件读写统一
- [x] 本地数据结构有版本号
- [x] 有基础单元测试
- [x] main / preload / renderer 的 IPC 类型一致
- [x] OpenAI 请求层有无真实 Key 的可测试路径
- [x] OpenAI 请求层测试覆盖多结果保存与编辑参数透传
- [x] shared 参数校验会拒绝运行时非法 Image 2 枚举值
- [x] shared 参数校验会拒绝畸形参数对象与非整数/非有限数值
- [x] config 保存、prompt、API Key、Base URL 输入会拒绝或归一化畸形运行时值
- [x] job run / draft save IPC 请求会拒绝畸形 payload、路径数组和草稿资源对象
- [x] job run IPC 请求会在创建历史任务前拒绝文生图携带输入、编辑缺少输入、非局部重绘携带 mask、局部重绘缺少 mask
- [x] job run IPC 请求会在写入 mask 文件前拒绝非图片输入路径、非 PNG/WebP mask 路径和畸形 mask data URL
- [x] 状态文件写入有备份与恢复路径
- [x] 未完成任务重启后会恢复为失败状态
- [x] 工作区草稿可自动保存并在重启后恢复

## 7. 发布前检查

- [x] 关键路径手动回归通过（无真实 API 调用）
- [x] 本地 mock OpenAI Image API 可用于无真实 Key 回归
- [x] 本地 mock API 自动校验脚本通过
- [x] mock API 自动校验覆盖关键 Image 2 参数传递与多图局部重绘 multipart 字段
- [x] 本地 mock Gemini Image API 可用于无真实 Key 回归
- [x] Gemini mock verifier 覆盖模型探测、Nano Banana 3 文生图、参考图编辑、局部引导编辑、请求记录和 Gemini 风格错误路径
- [x] mock model discovery verifier 覆盖 OpenAI/Gemini 重点模型探测、缺失重点模型、General Gemini 候选模型和 Gemini 探测鉴权错误
- [x] packaged app 可通过 UI 保存 mock 配置、连接测试并完成一次 mock 生成
- [x] 无控制台报错
- [x] 打包配置已添加
- [x] 打包图标已添加
- [x] 本机未压缩 app 可启动
- [x] macOS dmg/zip 可生成
- [x] macOS ad-hoc signed、未公证本地预览包可生成
- [x] dmg 可挂载、复制 app 并启动
- [x] macOS 临时目录卸载与重装 smoke test 正常
- [x] macOS dmg 安装 smoke test 可通过 `pnpm verify:release:mac` 自动复跑
- [x] macOS dmg smoke test 会确认主窗口实际出现
- [x] GitHub Actions 已配置 build、mock API verifier、macOS / Windows / Linux package gates
- [x] Windows package gate 已接入 `pnpm verify:release:windows`
- [x] Windows verifier 覆盖 silent install / installed app launch / silent uninstall
- [x] Linux ARM64 容器环境可 build、通过 mock verifier、生成 AppImage、解包并在 Xvfb 下启动
- [x] Linux package gate 已接入 `pnpm verify:release:linux`
- [x] Linux verifier 在 FUSE 可用时覆盖直接 AppImage 启动，并支持 `IMAGE2TOOLS_LINUX_REQUIRE_DIRECT_APPIMAGE=1` 强制原生验收
- [ ] Windows 原生安装与启动验证完成
- [ ] Linux 原生桌面 AppImage 直接运行、下载、打开文件夹行为验证完成
- [x] 真实 API 验收脚本默认受成本确认保护
- [x] 真实 streaming 验收需要额外成本确认
- [ ] Gemini / Nano Banana 3 真实 API 验收完成（已有受成本保护 verifier，仍需真实 Key 跑通并记录证据）
- [x] 签名/公证 readiness 脚本不会暴露 secret 且不会尝试签名
- [x] 配置迁移到当前 state v1 正常
- [x] 长时间生成不会轻易超时

## 8. 手工验收用例

- [ ] 仅输入 prompt 生成一张图（需真实 API Key）
- [ ] 输入长 prompt 生成一张图（需真实 API Key）
- [ ] 上传一张参考图后编辑（需真实 API Key）
- [ ] 上传多张参考图后编辑（需真实 API Key）
- [ ] 用 mask 对图局部重绘（需真实 API Key）
- [x] 下载 PNG
- [x] 下载 JPEG
- [x] 下载 WEBP
- [x] 切换尺寸后重新生成
- [x] 切换质量后重新生成
- [x] 断网时有明确错误提示
- [x] 无效 Key 时能立即失败
- [x] 生成历史可恢复

## 9. 多模型 v0.2.0 文档与发布检查

- [x] README 说明多模型定位、GPT Image 2、Nano Banana 3、General 当前范围
- [x] ARCHITECTURE 说明 provider adapter registry、OpenAI adapter、Gemini adapter、General provider-specific fallback
- [x] SECURITY 说明 OpenAI/Gemini Key 本地存储、Gemini 错误脱敏和上传图片权利提醒
- [x] EXTERNAL_ACCEPTANCE 说明 Gemini / Nano Banana 3 真实 API 验收流程
- [x] mock OpenAI verifier、mock Gemini verifier 和 mock model discovery verifier 命令已记录
- [x] release verifier 命令与平台限制已记录
- [x] 文档未声明未验证的 Nano Banana 真实输出质量或 exact-mask 能力
- [ ] 真实 OpenAI / Gemini 外部验收完成
- [x] General 任意 provider fallback 完成

## 10. GPT Image 2 API 检查

- [x] 默认模型为 `gpt-image-2`
- [x] 文生图调用 `/v1/images/generations`
- [x] 编辑调用 `/v1/images/edits`
- [x] 结果按 base64 图像保存
- [x] `background` 只允许 `auto` / `opaque`
- [x] `quality`、`output_format`、`background`、`moderation` 运行时枚举值会被校验
- [x] `n`、`partial_images`、`timeoutMs`、`output_compression` 必须是整数且有限
- [x] 编辑输入/参考图数量最多 16 张
- [x] `output_compression` 仅在 `jpeg` / `webp` 时发送
- [x] `stream` 开启时处理 partial 与 completed 事件
