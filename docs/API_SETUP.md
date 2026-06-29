# API Setup Guide / API 配置指南

---

## OpenAI

**Get an API key / 申请 Key:** https://platform.openai.com/api-keys

| Setting | Value |
|---------|-------|
| Base URL | `https://api.openai.com/v1` |
| Supported models | `gpt-image-2` |

Set `OPENAI_API_KEY` in your provider settings. The Base URL defaults to the value above; only change it if using a proxy.

---

## Gemini

**Get an API key / 申请 Key:** https://aistudio.google.com/app/apikey

| Setting | Value |
|---------|-------|
| Base URL | `https://generativelanguage.googleapis.com/v1beta` |
| Supported models | `gemini-3.1-flash-image`, `gemini-2.0-flash-preview-image-generation` |

---

## Custom / Aggregator Endpoints

image2tools supports any OpenAI-compatible endpoint (e.g., OpenRouter, local proxies).

Requirements / 端点要求:
- Must implement `POST /images/generations` (and optionally `/images/edits`) with OpenAI-compatible request/response schema.
- **Streaming note:** As of v0.2.3, streaming (SSE) is globally disabled because `/images/edits` on many aggregators does not support SSE. If your endpoint requires streaming, this will need to be re-enabled manually in a future release.

---

## Model Detection / 模型探测机制

When you enter a Base URL and API key, image2tools probes the endpoint:

1. Calls `GET /models` (OpenAI-compatible).
2. Filters results for known image-capable model IDs.
3. Populates the model selector automatically.

If probing fails (e.g., endpoint does not expose `/models`), you can type a model ID manually.

---

## Troubleshooting / 常见错误排查

**401 Unauthorized** — API key is missing or incorrect. Double-check the key and that it has image generation permissions.

**404 Not Found** — The Base URL is wrong or the model ID is not available on that endpoint. Verify the URL and try probing again.

**Empty model list after probe** — The endpoint's `/models` response does not include image-capable models. Enter the model ID manually.

**"Streaming not supported" errors** — Streaming is disabled globally in v0.2.3; this should not appear. If it does, file a bug with your provider name and endpoint URL.

**Slow or hanging requests** — Some aggregators have high latency on image endpoints. image2tools does not impose a hard timeout by default; you can cancel from the UI.
