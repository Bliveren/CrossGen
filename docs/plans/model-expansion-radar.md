# CrossGen Model Expansion Radar

> Status: Phase 0 planning artifact

## Decision

v0.3.1 does not add large provider-native adapters. It freezes capability contracts and keeps discovered models conservative so agents cannot infer unsupported edit/reference/inpaint/video behavior.

## Current Tracks

| Track | Contract | Confidence | v0.3.1 stance |
| --- | --- | --- | --- |
| GPT Image 2 | `openai-image` | `verified` | image generate/edit/inpaint/reference/streaming |
| Nano Banana 3 / Gemini image | `gemini-generate-content` | `verified` | image generate/edit/reference/outputText |
| General fallback | compatible or Gemini content route | `assumed` / `discovered` | prompt-only generation for agents |

## Confidence

- `verified`: tests or smoke evidence cover the operation.
- `discovered`: provider discovery found the model but operation shape is not fully verified.
- `assumed`: model name suggests image capability only.
- `unknown`: no safe generation claim.

## v0.3.1 Surface Rules

- Callable `mediaKinds` and `outputAssetKinds` are `["image"]`.
- `animatedGif` and `video` are false/non-callable.
- Discovered FLUX, SDXL, Recraft, Imagen, Seedream, Qwen, Ideogram, or similar names do not imply edit/reference/inpaint.
- OpenAI-compatible General fallback uses minimal prompt-only generation.
- Models requiring public URL input must set `requiresPublicUrl: true`.

## Radar Candidates

| Candidate | Likely contract | v0.3.1 stance | v0.3.2+ entry criteria |
| --- | --- | --- | --- |
| OpenAI-compatible image models | `openai-compatible-minimal` | conservative General fallback | mock smoke and no edit/reference claims |
| Additional Gemini image models | `gemini-generate-content` | readonly/discovered unless verified | adapter tests per claimed operation |
| Imagen / Vertex | `provider-native` | radar only | auth/config model and mock adapter |
| Seedream / Jimeng | `provider-native` | radar only | official API validation and redaction tests |
| Qwen-Image | provider-native or compatible | radar only | one verified host route |
| Ideogram | `provider-native` | radar only | parameter/refusal mock coverage |
| Recraft | provider-native or compatible | radar only | raster-only contract first |
| Hosted FLUX | provider-native or compatible | radar only | pick one hosted route |
| Stable Diffusion / SDXL API | `provider-native` | radar only | minimal prompt contract |
| ComfyUI / local runtime | `local-workflow` | v0.4.0+ | local-runtime permissions and queue stages |

Do not start video/GIF adapter work from this radar.
