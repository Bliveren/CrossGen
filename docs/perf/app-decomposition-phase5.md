# App Decomposition Phase 5 Profiler Evidence

Captured: 2026-07-08
Updated: 2026-07-09

Phase 5 extracted the editor, Gallery, History, Provider, launch, and parameter surfaces out of `App.tsx`. This capture adds renderer-only React Profiler zones so partial-image streaming can be compared against the Phase 0 baseline and any remaining unrelated panel work is explicit.

## Commands

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/phase5-gallery-large --iterations 3
```

Raw local result:

```text
output/perf-baselines/phase5-gallery-large/gallery-large-44ef31f5a730.json
```

`output/` is ignored by git; rerun the commands above for fresh machine-local metrics.

## Environment

| Field | Value |
| --- | --- |
| Commit | `44ef31f5a730caa6155bcbc6c5309298219c3e4a` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| CPU | Apple M4, 10 cores |
| Memory | 17179869184 bytes |
| Fixture | `gallery-large` |
| Fixture assets | 2400 |
| Fixture folders | 96 |
| Fixture state size | 1510208 bytes |

## Renderer And Profiler

The measurement harness opens Gallery, records the React Profiler event index, then simulates three partial-image job events.

| Metric | Phase 0 baseline | Phase 5 capture |
| --- | ---: | ---: |
| Time to first Gallery grid render | 1066.100 ms | 661.600 ms |
| Gallery entries reported by grid | 2404 | 2404 |
| Gallery images using thumbnail URLs | 0 | 2400 |
| Simulated partial image events | 3 | 3 |
| React Profiler events after partial events | 2 App events | 4 zone events |
| App partial-update `actualDuration` | 1149.200 ms | 247.100 ms |
| App partial-update `baseDuration` | 1140.500 ms | 236.800 ms |

Profiler events by zone after the simulated partial-image events:

| Profiler zone | Events | Total actual duration | Max actual duration | Total base duration | Phases |
| --- | ---: | ---: | ---: | ---: | --- |
| `App` | 1 | 247.100 ms | 247.100 ms | 236.800 ms | `update: 1` |
| `Sidebar` | 1 | 0.400 ms | 0.400 ms | 0.400 ms | `update: 1` |
| `Workspace` | 1 | 0.500 ms | 0.500 ms | 0.100 ms | `update: 1` |
| `RightRail` | 1 | 245.900 ms | 245.900 ms | 236.000 ms | `update: 1` |

## Conclusion

Phase 5 decomposition lowered the measured App-level partial-image update cost from the Phase 0 baseline, but partial-image streaming still re-renders the unrelated `RightRail` subtree when Gallery is active. The residual is now measured and isolated: almost all partial-update time is in `RightRail`, not the sidebar or workspace shell.

The next Phase 5 optimization should focus on keeping partial-image state changes from invalidating the right rail, either by moving partial-image state below the workspace/editor boundary or memoizing the Gallery/History rail after stabilizing its callback props.

## v0.3.0 Closeout Hot Path Update

The closeout pass keeps the existing App shape but makes the Gallery side of the right rail stable across partial-image events:

- `bridge.onJobEvent` no longer depends on `partialImages.length`, so partial events do not rebuild the IPC listener.
- Gallery sort options and virtual entries now keep stable references when their inputs do not change.
- The Gallery rail panel is memoized behind an explicit dependency boundary. Partial-image and notice updates still update `App` and the editor workspace, but they no longer force the expensive Gallery rail subtree to render.

Fresh local capture:

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/phase5-final-gallery-large --iterations 3
```

Raw local result:

```text
output/perf-baselines/phase5-final-gallery-large/gallery-large-f380e9a4dfa4.json
```

| Metric | Phase 5 capture | v0.3.0 closeout |
| --- | ---: | ---: |
| Time to first Gallery grid render | 661.600 ms | 668.700 ms |
| Gallery entries reported by grid | 2404 | 2404 |
| Gallery images using thumbnail URLs | 2400 | 2400 |
| Simulated partial image events | 3 | 3 |
| React Profiler events after partial events | 4 zone events | 27 zone events |
| App partial-update `actualDuration` | 247.100 ms | 6.500 ms |
| RightRail partial-update `actualDuration` | 245.900 ms | 0.700 ms |
| RightRail max partial-update `actualDuration` | 245.900 ms | 0.200 ms |

The profiler still records `RightRail` update events because the boundary remains mounted under `App`, but the actual render work is now a memo bailout. The high `baseDuration` remains useful as a measure of the work avoided by the stable Gallery rail dependency boundary.

## Accessibility Smoke

| Check | Result |
| --- | --- |
| Buttons without accessible names | 0 |
| Images missing `alt` | 0 |
| Dialogs missing `aria-modal="true"` | 0 |
| Notice live region | Present |
| Notice `aria-live` | `polite` |
| Notice `aria-atomic` | `true` |
| axe violations | 3 existing violations |
| axe incomplete | 2 |

The remaining axe violations match the previously documented baseline categories and are not introduced by the profiler boundaries.
