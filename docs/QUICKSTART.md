# Quick Start Guide — image2tools v0.2.3
# 快速上手指南

Get up and running in 5 minutes.

---

## 1. Download & Install
## 下载与安装

Go to the [Releases page](https://github.com/nousresearch/image2tools/releases) and download the package for your platform.

**macOS — bypass Gatekeeper:**

Right-click the app and choose "Open", or run:

    xattr -dr com.apple.quarantine /Applications/image2tools.app

**Windows — bypass SmartScreen:**

Click "More info" on the warning dialog, then "Run anyway".

---

## 2. Configure an API Provider
## 配置 API Provider

Open the model configuration panel in the left sidebar.

| Provider | Base URL | Key format |
|---|---|---|
| OpenAI | https://api.openai.com/v1 | sk-... |
| Gemini | https://generativelanguage.googleapis.com/v1beta | AIza... |
| Custom / aggregator | your endpoint URL | your key |

Fill in the Base URL and API Key, then save.

---

## 3. Detect Available Models
## 模型探测

Click the **Detect Models** button. The app will query your provider and display the number of available models.

Common failure reasons:
- Wrong API key
- Network / firewall blocking the request
- Incorrect Base URL

---

## 4. Select & Launch a Model
## 选择启动模型

Choose a model from the detected list — for example **GPT Image 2** or **Nano Banana 3** — then click **Launch Model**.

---

## 5. Generate Your First Image
## 生成第一张图

**Text-to-image tab:** Enter a prompt and click **Generate**.

**Image-to-image tab:** Upload a reference image, enter a prompt describing the edit, then click **Edit**.

---

## 6. History & Reuse
## 查看和复用历史记录

Recent tasks appear in the right sidebar. Click any entry to reload its prompt and settings for reuse.

---

## Troubleshooting
## 常见问题速查

See [FAQ.md](./FAQ.md) for solutions to common issues.
