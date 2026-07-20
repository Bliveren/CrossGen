# image2tools / CrossGen FAQ

> 最后更新：2026-07-20（由 weekly feedback bot 自动维护）

---

## 目录

- [安装与更新](#安装与更新)
- [API 配置](#api-配置)
- [生图与图生图](#生图与图生图)

---

## 安装与更新

### Q: Windows 上更新后应用闪退/无法启动，怎么办？

**现象**：点击内置更新后，应用启动时立即闪退，或提示版本不正确。

**原因**：Windows 内置自动更新流程有时无法完整替换本地文件，导致版本混乱或可执行文件损坏。

**解决方法**：
直接前往官网下载最新版安装包，覆盖安装即可：
- 官网：https://www.corgnitor.com/products/crossgen
- 或直接下载：https://github.com/Bliveren/CrossGen/releases/download/v0.3.0/CrossGen-Setup.exe

覆盖安装后重启，若仍无法启动请在用户群附上截图反馈。

---

### Q: 更新到新版本（如 0.3.0）后，生图功能不可用，怎么办？

**现象**：左下角点击更新后，生图提示错误或图生图任务直接失败。

**原因**：版本未完整更新，或新版 API 配置格式有变化，旧配置不兼容。

**解决方法**：
1. 查看左下角版本号，确认是否已是最新版本；如版本未变，手动下载安装包重新安装：
   - Windows：https://github.com/Bliveren/CrossGen/releases/download/v0.3.0/CrossGen-Setup.exe
   - macOS (Apple Silicon)：https://github.com/Bliveren/CrossGen/releases/download/v0.3.0/CrossGen-0.3.0-mac-arm64.dmg
2. 安装完成后，进入 **设置 → API 配置**，重新保存一次 API 配置（即使内容未改动），触发新版格式初始化；
3. 再次尝试生图。

---

## API 配置

### Q: 配置 API 后提示「API 链接探测失败」，怎么办？

**现象**：在 API 配置页填入地址和 Key 后，点击保存或检测时报错「api链接探测失败」。

**常见原因**：
- API Base URL 末尾多了或少了 `/`
- 从 Aihub 等聚合平台复制的 Key 未包含完整内容
- 填写的是模型名而非 Base URL

**解决方法**：
1. 登录 Aihub（或你使用的中转平台），进入 **API 管理页**，参照平台提供的接入文档，重新完整复制 Base URL 和 API Key；
2. 在 CrossGen API 配置页**清空旧内容**，重新粘贴填入并点击保存；
3. 保存后重新点击「连接检测」。
4. 若仍失败，请在用户群截图 API 配置界面（Key 可遮住中间字符）并 @ 运营同学排查。

> **提示**：使用 Aihub 接入 GPT Image 2 时，建议参考群内置顶的 Aihub 接入流程文档：https://r9tbnsk2zi.feishu.cn/wiki/Bfj3wsBcZicXF8kfhgPcXWconad

---

## 生图与图生图

### Q: 图生图任务完成后，生成的图片没有参考原图的风格，像在自由发挥，怎么办？

**现象**：上传了参考图，但生成结果完全忽略参考图，模型自由发挥。

**已知情况**：部分模型（如通过某些中转平台调用的 GPT Image 2）存在参考图无法被正确识别的问题，v0.2.4 之前的版本尤为明显，0.3.0 版本已对此做了路径探测优化。

**解决方法**：
1. 升级至 CrossGen 0.3.0 或更新版本；
2. 若升级后仍有问题，可尝试切换 API 来源（例如将 Aihub 换为 Genspark 的 GPT Image 2 接口）；
3. 如问题持续，请在群内反馈所使用的模型和 API 来源，以便进一步排查。

---

*如有未覆盖的问题，欢迎在用户反馈群提问，或提 Issue：https://github.com/Bliveren/CrossGen/issues*
