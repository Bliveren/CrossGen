# Known Limitations
# 已知限制

> image2tools v0.2.3 | https://github.com/Bliveren/image2tools

---

## GPT Image 2

### Streaming & Aggregator Compatibility / 流式输出与聚合器兼容性

- The `/images/generations` and `/images/edits` endpoints do not guarantee streaming support across all third-party aggregators or reverse proxies.
- When streaming is enabled, some aggregators return incomplete or malformed responses, which can cause generation failures or silent empty results.
- **Workaround**: Disable **Streaming Output** in **Settings → Parameters** when using a non-official endpoint.

### Edit Mode Constraints / 编辑模式约束

- The `/images/edits` endpoint requires a mask image. Mask generation relies on the segmentation pipeline; complex scenes may produce imprecise masks.
- Certain aggregators do not implement `/images/edits` at all. In that case, edit mode is unavailable regardless of the API Key.

### Parameter Constraints / 参数约束

- Not all model sizes (`1024x1024`, `1536x1024`, etc.) are supported by every aggregator. Unsupported sizes will return an API error.
- The `quality` parameter (`standard` / `hd`) may be ignored by some aggregators that only forward a subset of parameters.

---

## Nano Banana 3 / Gemini

### Guided Region Is Not Exact-Mask / guided-region 非精确掩码

- The guided-region feature uses bounding-box hints to focus generation, not pixel-perfect mask inpainting.
- Results may bleed slightly outside the indicated region, especially near object boundaries.
- True exact-mask inpainting is not currently supported for Gemini-based models.

### No Streaming Partial Preview / 无流式局部预览

- Gemini image generation does not support token-by-token or chunk-by-chunk streaming previews.
- The image is only available once the full response is returned. The progress indicator reflects request state, not render progress.

### Safety Filters & Region Restrictions / 安全过滤与地区限制

- Gemini applies Google's safety filters automatically. Prompts that trigger filters will return no image and no detailed error message.
- API availability varies by region. Some Google Cloud regions may not have access to image generation models.

---

## Platform Limitations / 平台限制

### macOS — Not Notarized / macOS 未公证

- The macOS build is **not notarized** by Apple. Gatekeeper will block the first launch.
- Users must right-click → Open, or remove the quarantine attribute manually (see FAQ).
- This will be addressed in a future release once a Developer ID certificate is obtained.

### Linux — Not Formally Validated / Linux 未正式验收

- Linux builds are provided as-is and have not been formally QA-tested across distributions.
- Known issues: system tray icon may not display on some desktop environments (e.g., GNOME without AppIndicator extension).
- File dialogs may behave differently depending on the GTK/Qt version available.

---

## Known Bugs / 已知 Bug

### Streaming Mode May Reduce GPT Image 2 Generation Success Rate
### 开启流式局部预览可能降低 GPT Image 2 生成成功率

**Status**: Confirmed, fix in progress.

When **Streaming Output** is enabled, GPT Image 2 generation (both text-to-image and edit mode) may intermittently fail — the request appears to complete but no image is returned, or an API error is thrown.

**Root cause**: Partial streaming chunks from some aggregators are parsed incorrectly, causing the image data extraction step to fail silently.

**Workaround**: Go to **Settings → Parameters** and disable **Streaming Output**. Non-streaming mode fetches the complete response in one request and is not affected by this issue.

---

## Reporting Issues / 反馈问题

If you encounter a bug not listed here, please open an issue at:
https://github.com/Bliveren/image2tools/issues

Include: app version, OS, provider/aggregator, and the relevant log output.
