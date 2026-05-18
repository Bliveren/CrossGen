# Image2Tools TODO

## Phase 0 - 方案冻结

- [x] 确认 MVP 只包含生成、编辑、下载、历史
- [x] 确认默认模型为 `gpt-image-2`
- [x] 确认默认直连 OpenAI，同时兼容自定义 Base URL
- [x] 确认 MVP 本地存储使用 JSON，后续再迁移 SQLite
- [x] 确认 MVP 先用本机加密文件保存 Key，后续再接系统钥匙串
- [x] 确认主界面三栏布局
- [x] 固化默认参数集合
- [x] 固化错误提示文案方向
- [x] 固化 `gpt-image-2` 尺寸、背景、mask、stream 参数约束

## Phase 1 - 工程骨架

- [x] 初始化 Electron + Vite + React + TypeScript 工程
- [x] 建立 main / preload / renderer 分层
- [x] 建立单页工作台
- [x] 实现本地配置读写
- [x] 实现 API Key 加密存储
- [x] 实现 API Key 清除
- [x] 实现基础状态提示 / loading 组件
- [x] 实现统一错误归类与脱敏
- [x] 实现“连接测试”按钮
- [x] 实现 baseURL 配置与恢复
- [x] 增加 shared 类型与参数校验测试

## Phase 2 - 文生图

- [x] 接入 `/v1/images/generations`
- [x] 实现 prompt 输入框
- [x] 实现生成按钮与 loading 状态
- [x] 实现流式 partial preview
- [x] 实现最终图片展示
- [x] 实现 PNG / JPEG / WEBP 下载
- [x] 实现生成任务的本地落盘
- [x] 实现失败重试与超时提示
- [x] 实现无效 Key 处理
- [x] 实现 `gpt-image-2` 自定义尺寸校验
- [x] 实现 `partial_images` 配置

## Phase 3 - 图生图与编辑

- [x] 接入 `/v1/images/edits`
- [x] 实现参考图选择上传
- [x] 实现多图参考输入
- [x] 实现编辑模式切换
- [x] 实现局部重绘入口
- [x] 实现 mask 画布或遮罩上传
- [x] 实现 mask 尺寸和 alpha 校验
- [x] 实现编辑结果查看
- [x] 实现编辑历史链路
- [x] 禁止对 `gpt-image-2` 暴露 `input_fidelity`
- [x] UI 不提供透明背景选项

## Phase 4 - 历史与效率

- [x] 实现历史任务列表
- [x] 实现结果缩略图展示
- [x] 实现按 prompt / 时间搜索
- [x] 实现复制 prompt
- [x] 实现重新生成参数复用
- [x] 实现再次编辑参数复用
- [x] 实现打开文件所在目录
- [x] 实现删除任务与清理文件
- [x] 实现常用参数预设

## Phase 5 - 稳定性与发布

- [x] 增加自动化测试
- [x] 增加手工 QA 用例
- [x] 增加本地 mock API 回归入口
- [x] 增加本地 mock API 自动校验脚本
- [x] 增加异常恢复
- [x] 增加崩溃后草稿恢复
- [x] 增加错误码归类
- [x] 增加 macOS / Windows / Linux 打包配置
- [x] 完成发布前检查
- [x] 产出试用版安装包
- [x] 增加 macOS dmg 自动安装烟测脚本

## CTO / 多分支治理

- [x] 建立 `main` 基线提交
- [x] 配置提交身份 `Bliveren <aliveren_89@foxmail.com>`
- [x] 配置远程 `origin`
- [x] 推送 `main` 到 private GitHub 远程
- [x] 子任务使用独立 worktree 与独立分支
- [x] 子任务完成后由 CTO 审核再合并
- [x] 合并后清理无用 worktree 与本地分支

## 当前未完成 / 待外部条件

- [x] 配置远程 `origin` 并推送当前 `main`
- [ ] 用真实 API Key 做一次实际生成、编辑、局部重绘手工验收（GitHub issue #1）
- [x] 运行 `pnpm package:dir` 和 `pnpm package:mac` 产出本机试用包
- [x] 完成 macOS 临时目录卸载与重装 smoke test
- [x] 增加 GitHub Actions CI（build、mock verifier、macOS / Windows / Linux package）
- [x] 增加受成本保护的真实 API 验收脚本
- [x] 增加 macOS 签名/公证 readiness 检查脚本
- [ ] 解除 GitHub Actions billing/spending limit 阻塞并取得绿色 CI（GitHub issue #5）
- [ ] 补充签名、公证与正式分发元数据（GitHub issue #3）
- [ ] 非 macOS 平台安装验证（GitHub issue #4）
- [x] 已评估 `stash@{0}` 中未合并的 renderer 实验；当前 `main` 已覆盖其核心能力并包含更新的草稿恢复、mask 校验和打包配置
- [ ] 经用户确认后删除、归档或恢复 `stash@{0}`（GitHub issue #2）

## 建议优先级

1. 先打通 Key + 生成
2. 再打通编辑
3. 再补历史与下载
4. 最后做体验与打包
