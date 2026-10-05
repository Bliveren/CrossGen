# GPT Image 2.5 Support Research

> Research date: 2026-09-09
> Target release: CrossGen v0.3.5
> Status: implementation continues on the v0.3.5 development line. The released v0.3.4 package exposes GPT Image 2.5 launch targets but does not include the strict availability-evidence contract or the Sketch workspace.

## Executive Summary

OpenAI's current GPT Image 2.5 family is represented in CrossGen by concrete
provider ids and two named variants:

- `gpt-image-2.5-sunburst`: prefer for precise edits, structure preservation, and high-fidelity reference work.
- `gpt-image-2.5-flare`: prefer for fast, high-quality everyday generation.
- `gpt-image-2.5-YYYY-MM-DD`, `gpt-image-2.5-sunburst-YYYY-MM-DD`, or
  `gpt-image-2.5-flare-YYYY-MM-DD`: valid dated snapshots only when the provider
  actually returns them.
- `gpt-image-2.5`: a CrossGen launch/AppLink compatibility alias, not proof of
  provider support and never an injected discovery candidate.

CrossGen keeps the separate `gpt-image-2` launch target out of this family.
Model availability is not inferred from the product catalogue: the latest
successful `/models` discovery for the selected API Key must return the exact
provider id, and the follow-up metadata probe may confirm that id by echoing
the same strong provider id field (`id`, `model`, `model_id`, or `modelId`).
For native Gemini metadata, `name: models/<id>` is the canonical resource id;
for OpenAI-compatible gateways, `name`, `display_name`, and `displayName` remain
advisory labels and cannot confirm GPT Image 2 versus GPT Image 2.5. A
lightweight image route must accept that exact id. For a provider-listed row,
a non-empty 2xx image response is strong confirmation even when the optional
metadata route is unavailable. Product-owned route candidates (used only when
a gateway omits image deployments from `/models`) are stricter: they require
an exact model-id echo in the successful route payload, or an exact metadata
identity plus a reachable image route. Empty success envelopes such as
`{ data: [] }`, `{ output: [] }`, or `{ choices: [] }` are only reachability
evidence and cannot enable an unlisted candidate. A validation-only 400/422 is
sufficient only when metadata echoed the same id, so the check remains
no-output and does not start a paid generation. A metadata
`200` for another model is a rejection for the requested id; a metadata `200`
without any exact id echo stays inconclusive unless an exact lightweight route
probe verifies the requested image model. For
OpenAI-compatible gateways, the returned `id` is the source of truth for family
selection; `display_name`/`displayName` is advisory only, so a row such as
`id: gpt-image-2.5, display_name: GPT Image 2` is not sufficient evidence for
GPT Image 2.5 and remains a disabled compatibility row. Only a concrete
Sunburst/Flare id or a provider-returned valid dated snapshot can establish the
2.5 family. When such an exact provider ID is discovered, CrossGen keeps that
ID on the wire; it does not silently replace it with the default Sunburst
variant.
Explicit output metadata that says text-, audio-, video-only, or
`image_generation: false` can veto an image-looking id. A `model_not_found`
metadata response for a listed id is treated as an inconsistency until an exact
image route confirms or rejects the same provider id; a missing metadata route
or transport failure is inconclusive. Replacing the API Key, changing the Base
URL, or receiving a failed/expired probe invalidates the previous discovery
result and active route/model selection.

The desktop discovery pass also performs a no-output route probe for the
selected OpenAI image model. If every generate probe explicitly returns
`model_not_found` for that exact id, CrossGen removes the stale row from the
confirmed catalogue and re-runs selection. A generic validation error,
transport failure, or a route-specific 404 remains inconclusive unless the
metadata endpoint already echoed the same exact id and the validation response
was a reachable 400/422. These cases are never silently treated as proof that
the model is unavailable.

Route evidence is stored with the exact provider model ID. Changing the
selected model invalidates that evidence before the next request, so a route
probe for `gpt-image-2` cannot be reused to claim support for
`gpt-image-2.5-sunburst` (or the reverse). The no-cost AIHub probe checks both families
independently. A `model_not_found` from the metadata endpoint is recorded as
inconclusive until an exact image route confirms or rejects the same provider
ID; only when every exact generate route rejects that ID is the model marked
rejected. Generic metadata or transport failures remain inconclusive.

These GPT Image 2.5 targets are available through the Image API and through the Responses API
`image_generation` tool. CrossGen v0.3.5 exposes both routes, keeps the model
choice in the provider/model catalog, and preserves the same durable queue,
History, Gallery, and export behavior as GPT Image 2.

When a gateway is probed through more than one protocol, the configured
protocol is authoritative whenever it returns a runnable image model. CrossGen
does not merge a secondary protocol catalogue into that successful result;
fallback is used only when the primary response has no runnable image model.
This prevents a protocol-shaped but semantically incompatible response from
making GPT Image 2, GPT Image 2.5, or a Gemini image launch appear available.

Operationally, 2.5 is a higher-fidelity model family rather than a magic
layout engine. The current OpenAI guidance still calls out practical limits:
complex prompts can take roughly two minutes, exact text rendering and
structured composition can fail, and character or brand consistency may need
iterative editing. CrossGen therefore keeps generous timeouts, preserves
revised prompts and response IDs, and treats multi-turn editing as a first-class
workflow instead of hiding retries behind silent route changes.

## Official Capability Matrix

| Capability | Image API | Responses API image tool | CrossGen v0.3.5 |
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

CrossGen sends local reference images and masks as base64 data URLs in
Responses requests, and as multipart files in Image API edit requests. It does
not upload local files through the OpenAI Files API or persist provider File IDs.
This keeps CrossGen local-first and avoids introducing a separate File lifecycle,
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

The v0.3.5 implementation is covered by:

- OpenAI adapter unit tests for Image API generation/edit, Responses generation,
  multi-turn editing, mask forwarding, streaming metadata, strict route
  failures, and compatibility fallback behavior.
- Validation tests for model IDs, quality/background/output constraints, route
  selection, and incompatible multi-image Responses controls.
- Reference preflight tests for mask alpha, dimensions, MIME matching, and the
  50 MB limit.
- Mock API and model-discovery verifiers covering Sunburst, Flare, dated
  snapshots, advanced controls, and Responses SSE.

The current worktree verification result is 54 test files and 607 passing tests,
with TypeScript type-checking, full Vitest, lint (0 errors), and whitespace
validation passing. The repository retains its existing lint warnings.

## Official References

- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI image generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation)
- [OpenAI Images API reference](https://developers.openai.com/api/reference/resources/images)
- [OpenAI Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
