# Prompt and Model Workflows

## Prompt structure

For a new image, write one compact prompt with this order:

1. Subject and count (what must be present)
2. Composition and camera/viewpoint
3. Environment, materials, and lighting
4. Style or visual reference
5. Exact text/layout constraints, if any
6. Exclusions and failure conditions

For an edit, state what must remain unchanged first, then the transformation, then the desired finish. For example: “Keep the subject identity, pose, framing, and typography unchanged. Replace only the background with …”.

## Parameter choices

- Match aspect ratio to the intended destination before generating; avoid post-hoc cropping when composition matters.
- Prefer the model's default quality/resolution unless the user has a concrete delivery requirement. Explain cost or latency tradeoffs when changing them.
- Treat text-heavy designs, exact object counts, and identity preservation as acceptance criteria to verify in the resulting asset, not merely prompt decorations.

## GPT Image 2.5 choices

- Use `gpt-image-2.5-sunburst` for exact edits, typography/layout retention,
  structure preservation, and high-fidelity reference work.
- Use `gpt-image-2.5-flare` when speed and strong general quality matter more
  than maximum edit precision.
- Prefer `quality: "auto"` unless the user has a concrete delivery
  requirement. `xhigh` and `max` increase quality/cost/latency tradeoffs.
- Use Responses plus `previousResponseId` for iterative conversational edits;
  use Images API for independent generations, mask edits, or batches.
- For transparent assets, request `background: "transparent"` and PNG/WebP.
- Treat a returned `revised_prompt` as provider metadata and retain it when
  reporting the result; it is not a replacement for the user's original prompt.

## Gemini Image and Nano Banana launch semantics

CrossGen's `nano-banana-3` value is a product launch/workflow alias. It is not a
provider wire id. Use the exact Gemini model id returned by discovery:

- `gemini-3.1-flash-image` for the default focused launch;
- `gemini-3.1-flash-lite-image` for the Lite model;
- `gemini-3-pro-image` for the Pro model.

Keep the actual id in job reports and History. If the current API key does not
discover the requested id, stop and surface the unavailable-model reason rather
than substituting another model.

## Sketch input workflow

Sketch belongs to image-to-image editing. In the desktop app, create or reopen
it from the reference-image area, draw in Input Studio, and save the exported
PNG as the first input. A normal reference image may be a view-only underlay;
it enters the exported request only after the user explicitly includes it.
Sketch guidance becomes natural-language constraints, while grid, center line,
safe area, and underlay opacity remain view-only.

Use `workflow: "sketch"` with `mode: "edit"` only when the discovered model
advertises both edit and reference-image support. Do not send a `scratch`
parameter unless a future provider contract explicitly defines and verifies it.
Sketch and Mask are separate input domains and must not be submitted together.

## Acceptance check

After completion, verify the terminal job status and inspect the asset metadata. If the user asks for a visual QA judgment, open or render the exported asset using the host's image/file tooling; metadata alone cannot prove visual fidelity. Report any mismatch and offer a targeted edit rather than silently accepting a poor result.
