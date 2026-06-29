# Roadmap / 开发路线图

---

## Current: v0.2.3 — Unsigned Preview / 当前版本

Released as an unsigned preview build. Core capabilities / 已完成能力:

- Multi-provider image generation (OpenAI gpt-image-2, Gemini, custom OpenAI-compatible endpoints)
- Provider catalog with per-provider model selection
- Model auto-detection / probe mechanism
- Global streaming disabled for `/images/edits` compatibility
- Electron desktop app with local state persistence (STATE_VERSION 2)

---

## v0.3.0 — Planned / 计划中

Three milestones / 三个里程碑:

### M1: Prompt Template System / 提示词模板系统
- Save, name, and reuse prompt templates
- Template variables with fill-in UI
- State schema extends to `promptTemplates` (STATE_VERSION 3)

### M2: Gallery / 生成图库
- Persistent gallery of generated images tied to prompts and provider metadata
- Filter / search by date, provider, model
- State schema extends to `galleryAssets`

### M3: Prompt Chips / 快捷提示词
- One-click prompt fragments that append to the active input
- Editable chip library stored alongside templates

---

## v0.3.x — Future Direction / 后续方向

No timeline commitments / 不承诺排期:

- Concurrent generation queue (multiple requests in parallel)
- Multi-image batch generation per request
- CLI mode (`image2tools generate --prompt "..." --provider openai`)

---

## Not Planned / 不在计划中

- Cloud workspace / sync (云端工作区)
- User accounts or authentication (账号系统)
- Mobile app

---

## How to Get Involved / 如何参与

- **Feedback**: Open a GitHub Issue with the `feedback` label.
- **Contribute**: See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Sponsor**: GitHub Sponsors link coming soon.
