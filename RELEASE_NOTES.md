# Image2Tools v0.2.0 Release Notes Draft

Status: draft until real API acceptance, CI, signing/notarization, and native platform release gates are complete.

## Highlights

- Multi-model workspace for GPT Image 2, Nano Banana 3, and General launch flows.
- OpenAI provider path keeps GPT Image 2 generation, editing, exact-mask inpainting, streaming partial previews, downloads, and history.
- Gemini provider path adds the app's Nano Banana 3 launch target, currently mapped to `gemini-3.1-flash-image`, with `generateContent` image generation, reference-image editing, guided-region editing, and Gemini-specific controls.
- General launch mode is a minimal fallback for discovered non-focused image models. Gemini General supports prompt and reference images; OpenAI and Custom General use a prompt-only OpenAI-compatible `/images/generations` contract.
- History entries now retain provider/model context so reused prompts restore the matching launch model and parameters.

## Verification Gates

Before publishing `v0.2.0`, run:

```bash
pnpm build
pnpm verify:mock-api
pnpm verify:mock-gemini-api
pnpm verify:mock-model-discovery
```

OpenAI real API acceptance is cost-gated through:

```bash
IMAGE2TOOLS_API_KEY=sk-... IMAGE2TOOLS_REAL_API_ACCEPT_COST=1 pnpm verify:real-api
```

Gemini / Nano Banana 3 real API acceptance is still an external manual gate on main. Follow [EXTERNAL_ACCEPTANCE.md](./EXTERNAL_ACCEPTANCE.md) and do not mark Gemini real acceptance complete until discovery, generation, reference editing, guided-region editing, and history/download checks pass with a real Gemini key.

Release package verification remains platform-specific:

```bash
pnpm verify:release:mac
pnpm verify:release:windows
pnpm verify:release:linux
```

Re-run the secret scan in [SECURITY.md](./SECURITY.md) after every release-note or packaging metadata update.
