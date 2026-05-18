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
- [x] mask alpha 通道校验生效
- [x] 编辑结果可下载
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
- [x] 状态文件写入有备份与恢复路径
- [x] 未完成任务重启后会恢复为失败状态
- [x] 工作区草稿可自动保存并在重启后恢复

## 7. 发布前检查

- [x] 关键路径手动回归通过（无真实 API 调用）
- [x] 本地 mock OpenAI Image API 可用于无真实 Key 回归
- [x] 本地 mock API 自动校验脚本通过
- [x] 无控制台报错
- [x] 打包配置已添加
- [x] 打包图标已添加
- [x] 本机未压缩 app 可启动
- [x] macOS dmg/zip 可生成
- [x] dmg 可挂载、复制 app 并启动
- [x] macOS 临时目录卸载与重装 smoke test 正常
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

## 9. GPT Image 2 API 检查

- [x] 默认模型为 `gpt-image-2`
- [x] 文生图调用 `/v1/images/generations`
- [x] 编辑调用 `/v1/images/edits`
- [x] 结果按 base64 图像保存
- [x] `background` 只允许 `auto` / `opaque`
- [x] `output_compression` 仅在 `jpeg` / `webp` 时发送
- [x] `stream` 开启时处理 partial 与 completed 事件
