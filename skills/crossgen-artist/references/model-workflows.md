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

## Acceptance check

After completion, verify the terminal job status and inspect the asset metadata. If the user asks for a visual QA judgment, open or render the exported asset using the host's image/file tooling; metadata alone cannot prove visual fidelity. Report any mismatch and offer a targeted edit rather than silently accepting a poor result.
