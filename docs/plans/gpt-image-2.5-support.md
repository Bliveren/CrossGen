# GPT Image 2.5 Support Research

> Research date: 2026-09-09
> Target release: CrossGen v0.3.4
> Status: implementation in the current v0.3.4 worktree

## Executive Summary

OpenAI's current GPT Image 2.5 family has two model variants:

- `gpt-image-2.5-sunburst`: prefer for precise edits, structure preservation, and high-fidelity reference work.
- `gpt-image-2.5-flare`: prefer for fast, high-quality everyday generation.

Both variants are available through the Image API and through the Responses API
`image_generation` tool. CrossGen v0.3.4 exposes both routes, keeps the model
choice in the provider/model catalog, and preserves the same durable queue,
History, Gallery, and export behavior as GPT Image 2.

Operationally, 2.5 is a higher-fidelity model family rather than a magic
layout engine. The current OpenAI guidance still calls out practical limits:
complex prompts can take roughly two minutes, exact text rendering and
structured composition can fail, and character or brand consistency may need
iterative editing. CrossGen therefore keeps generous timeouts, preserves
revised prompts and response IDs, and treats multi-turn editing as a first-class
workflow instead of hiding retries behind silent route changes.

## Official Capability Matrix

| Capability | Image API | Responses API image tool | CrossGen v0.3.4 |
| --- | --- | --- | --- |
| Text-to-image | `/v1/images/generations` | `tools: [{ type: "image_generation" }]` | Supported |
| Image edit | `/v1/images/edits` | Input images plus `action: "edit"` or `auto` | Supported |
| Mask/inpaint | Multipart `mask` | `input_image_mask.image_url` or `file_id` | Supported with base64/data URL |
| Reference images | Up to 16 | Base64 data URL, URL, or File ID | Base64 data URL |
| Multi-turn editing | Not conversational | `previous_response_id` | Supported |
| Quality | `auto`, `low`, `medium`, `high`, `xhigh`, `max` | Same tool options | Supported |
| Size | `auto` or custom dimensions | Same tool options | Supported |
| Background | `auto`, `opaque`, `transparent` | Same tool options | Supported |
| Output format | PNG, JPEG, WebP | PNG, JPEG, WebP | Supported |
| Compression | JPEG/WebP, `0..100` | JPEG/WebP, `0..100` | Supported |
| Batch count | `n: 1..10` | One image-generation call per request | Supported; auto mode uses Image API for `n > 1` |
| Streaming | `stream`, `partial_images: 0..3` | `stream`, optional `partial_images: 1..3` for partial previews | Supported |
| Revised prompt | Image tool response metadata | `image_generation_call.revised_prompt` | Persisted in provider metadata |
| Safety identifier | `user` | `safety_identifier` | Supported through desktop, CLI, MCP |
| Mainline model | N/A | Required at top-level Responses `model` | Configurable, default `gpt-6-astra` |

OpenAI's current guide also notes that GPT Image 2.5 access may require
Organization Verification. CrossGen cannot complete that account-level step;
when the provider returns an access error, the desktop and agent surfaces keep
the provider request/error context available for remediation.

## Request Constraints

- Custom dimensions must use width and height that are multiples of 16.
- The supported aspect-ratio range is approximately 1:3 to 3:1.
- The maximum supported output is approximately 3840 x 2160 and 8,294,400
  pixels; dimensions above 2560 x 1440 are experimental according to the
  current guide.
- Transparent output requires PNG or WebP. CrossGen automatically changes a
  conflicting JPEG selection back to PNG in the desktop controls.
- JPEG usually returns faster than PNG when transparency is not required,
  while PNG/WebP remain the correct choices for transparent output.
- A mask must be smaller than 50 MB, use the same format and dimensions as the
  first source image, and contain an alpha channel. CrossGen checks all known
  metadata before sending a paid request and blocks a known-invalid mask.
- `partial_images` is clamped to `0..3` in CrossGen's shared state. Images API
  requests can send `0` for a single final streaming event. For the Responses
  image tool, CrossGen omits the optional field when the value is `0` and sends
  only `1..3` when partial previews are requested, matching the tool guide
  accepted range. Batch requests use a non-streaming request.
- Each streamed partial image adds image-output usage (the current guide
  describes an additional 100 image output tokens per partial), so partial
  previews are an explicit latency-versus-cost choice rather than a free
  progress indicator.
- Responses image-generation calls currently produce one final image per call.
  CrossGen therefore routes `n > 1` to Images API in `imageRoute: "auto"` and
  rejects incompatible Responses-only controls for multi-image requests.

## Route Selection

CrossGen uses `imageRoute: "auto"` by default:

1. If a Responses-only control is present (`previous_response_id`,
   `image_generation_call` continuation, `responsesModel`, a non-`auto`
   `responsesAction`, or non-`auto` input image `detail`), use Responses.
2. Otherwise use the Image API for the single-call request.
3. GPT Image 2.5 never enters the legacy Chat Completions image path.

OpenAI route probes are retained as diagnostics and compatibility evidence, but
they never promote a normal GPT Image 2.5 request to Responses. This avoids
turning a lightweight capability probe into an unintended conversational image
generation request.

An explicit Responses route, or `auto` with a Responses-only control, is
strictly single-route: if Responses fails, CrossGen returns that error instead
of retrying through Images API. This preserves `previous_response_id`,
`image_generation_call`, mainline-model, and action semantics and avoids an
unintentional second billable request.

The Responses request uses a supported mainline model at the top level and
places the GPT Image 2.5 model ID inside the `image_generation` tool. The tool
choice is forced to `{ "type": "image_generation" }` so a mainline model cannot
answer with text only when CrossGen requested an image.

Responses usage includes both the image tool work and the top-level mainline
model call. CrossGen preserves `input_tokens`, `output_tokens`, cached or
cache-write input token details, image/text token details, and reasoning output
token details when providers return them, including across retry/backfill
requests.

## Input and Privacy Decision

CrossGen v0.3.4 sends local reference images and masks as base64 data URLs in
Responses requests, and as multipart files in Image API edit requests. It does
not upload local files through the OpenAI Files API or persist provider File IDs.
This keeps v0.3.4 local-first and avoids introducing a separate File lifecycle,
retention, cleanup, privacy, and cross-session ownership contract. File ID input
can be added in a later release once those lifecycle rules are specified.

The optional CrossGen `user` field is an opaque, stable safety identifier. The
adapter maps it to the Images API `user` field and the Responses API
`safety_identifier` field. CrossGen intentionally does not derive it from an
API key, OS account, email address, or other personal information.

Moderation errors are surfaced with coarse stage/category context only.
CrossGen does not expose classifier scores from provider responses.

## CrossGen Surface Area

- Desktop: GPT Image 2.5 launch entry, Sunburst/Flare model choice, quality
  `xhigh`/`max`, transparent background, compression, input fidelity, route,
  Responses action, mainline model, previous response ID, and “continue from
  latest result”.
- CLI: `--model`, `--n`, `--quality`, `--output-format`,
  `--output-compression`, `--background`, `--moderation`,
  `--user`,
  `--input-fidelity`, `--image-route`, `--responses-model`,
  `--responses-action`, `--previous-response-id`, `--stream`,
  `--no-stream`, and `--partial-images`.
- MCP: the same GPT Image 2.5 options are available on
  `crossgen_generate_image` and `crossgen_edit_image`.
- Model discovery: OpenAI `/models` results recognize stable IDs and dated
  Sunburst/Flare snapshots.
- History/Gallery: the selected model and Responses metadata remain attached to
  the durable job and result.

## Verification

The v0.3.4 implementation is covered by:

- OpenAI adapter unit tests for Image API generation/edit, Responses generation,
  multi-turn editing, mask forwarding, streaming metadata, strict route
  failures, and compatibility fallback behavior.
- Validation tests for model IDs, quality/background/output constraints, route
  selection, and incompatible multi-image Responses controls.
- Reference preflight tests for mask alpha, dimensions, MIME matching, and the
  50 MB limit.
- Mock API and model-discovery verifiers covering Sunburst, Flare, dated
  snapshots, advanced controls, and Responses SSE.

The current worktree verification result is 48 test files and 488 passing tests,
with TypeScript type-checking, renderer/main builds, lint (0 errors), and
whitespace validation passing.

## Official References

- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI image generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation)
- [OpenAI Images API reference](https://developers.openai.com/api/reference/resources/images)
- [OpenAI Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
