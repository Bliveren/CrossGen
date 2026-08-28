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

## Acceptance check

After completion, verify the terminal job status and inspect the asset metadata. If the user asks for a visual QA judgment, open or render the exported asset using the host's image/file tooling; metadata alone cannot prove visual fidelity. Report any mismatch and offer a targeted edit rather than silently accepting a poor result.
