# Frequently Asked Questions
# 常见问题解答

> image2tools v0.2.3 | https://github.com/Bliveren/image2tools

---

## Installation / 安装问题

### macOS says "unable to verify the developer" — what do I do?
### macOS 提示"无法验证开发者"怎么办？

Right-click (or Control-click) the app and choose **Open**, then confirm in the dialog.

Alternatively, run the following in Terminal to remove the quarantine flag:

```
xattr -dr com.apple.quarantine /path/to/image2tools.app
```

---

### Windows SmartScreen is blocking the app — how do I proceed?
### Windows SmartScreen 拦截，怎么处理？

Click **More info** in the SmartScreen dialog, then click **Run anyway**.
This happens because the binary is not yet code-signed with a paid certificate.

---

### How do I verify the downloaded file's integrity?
### 下载后如何验证文件完整性？

Each release on the GitHub Releases page includes a `SHA256SUMS` file.

**macOS / Linux**
```
shasum -a 256 image2tools-*.dmg
```

**Windows (PowerShell)**
```
Get-FileHash image2tools-*.exe -Algorithm SHA256
```

Compare the output with the hash listed in `SHA256SUMS` for your platform.

---

## API Configuration / API 配置

### Where do I get an OpenAI API Key?
### 在哪里获取 OpenAI API Key？

Visit https://platform.openai.com/api-keys, sign in, and create a new secret key.

---

### How do I apply for a Gemini API Key?
### Gemini API Key 怎么申请？

Visit https://aistudio.google.com/app/apikey, sign in with a Google account, and generate a key.

---

### What are the default Base URLs?
### Base URL 默认值是什么？

| Provider | Default Base URL |
|----------|-----------------|
| OpenAI / compatible | `https://api.openai.com/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` |

If you use a third-party aggregator or proxy, replace the Base URL in **Settings → API** accordingly.

---

### Model detection returns an empty list — what should I do?
### 模型探测为空怎么办？

1. Confirm the API Key is correct and has not expired.
2. Confirm the Base URL is reachable from your network.
3. Try clicking **Refresh Models** again.
4. If using a custom aggregator, verify it implements the `/models` endpoint.

---

### The app shows "Connection Error" — how do I fix it?
### 显示"连接异常"怎么处理？

- Check your internet connection.
- Verify the Base URL is correct (no trailing slash issues, correct protocol).
- Temporarily disable VPN or proxy and retry.
- Open the in-app log panel for the detailed error message.
- If the provider's status page shows an outage, wait and retry later.

---

## Generation & Editing / 生成与编辑

### GPT Image 2 edit mode throws an error — what do I do?
### GPT Image 2 编辑模式报错怎么办？

Two common causes:

1. **Aggregator does not support `/images/edits`** — Switch to the official OpenAI endpoint, or confirm your aggregator implements the edits endpoint.
2. **Streaming enabled** — The edits endpoint may not be compatible with streaming responses from some aggregators. Go to **Settings → Parameters** and disable **Streaming Output**, then retry.

---

### Gemini generation fails or returns nothing — how do I troubleshoot?
### Gemini 生成失败/无返回怎么排查？

1. Confirm the Gemini API Key is valid and the quota has not been exceeded (check https://aistudio.google.com).
2. Verify the Base URL matches the Gemini endpoint exactly.
3. Check that the selected model name is correct (e.g. `gemini-2.0-flash-preview-image-generation`).
4. Review the error detail in the log panel — common causes include safety filter blocks and region restrictions.

---

### Success rate drops after enabling streaming output — what should I do?
### 开启流式输出后成功率下降怎么办？

Some API aggregators or proxies do not fully support streaming for image generation.
Go to **Settings → Parameters** and turn off **Streaming Output**. Non-streaming mode is more widely compatible.

---

## Other / 其他

### Where are history records and generated images stored?
### 历史记录和生成图片存储在哪里？

All data is stored locally on your machine, typically under:

- **macOS**: `~/Library/Application Support/image2tools/`
- **Windows**: `%APPDATA%\image2tools\`
- **Linux**: `~/.config/image2tools/`

Generated images are saved in the `outputs/` subdirectory.

---

### How do I update to a new version?
### 如何更新到新版本？

Use the **Updates** module at the bottom of the left sidebar. When a new version is available, a prompt will appear. Click **Update** to download and install automatically.

You can also download the latest release manually from https://github.com/Bliveren/image2tools/releases.

---

### How is my data and API Key stored? Is anything uploaded to the cloud?
### 数据和 API Key 如何保存？是否上传云端？

Everything — including your API Keys, settings, history, and generated images — is stored **locally only**. Nothing is uploaded to any server. The app communicates only with the AI provider endpoints you configure.
