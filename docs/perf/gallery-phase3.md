# Gallery Phase 3 Thumbnail Results

Captured: 2026-07-08

Phase 3 adds a managed Gallery thumbnail protocol path. Gallery cards request cached thumbnails, while original preview/download behavior continues to use the original asset path and `no-store` responses.

## Commands

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/phase3-gallery-large --iterations 3
```

Raw local result:

```text
output/perf-baselines/phase3-gallery-large/gallery-large-da09f407a30f.json
```

`output/` is ignored by git; rerun the commands above for fresh machine-local metrics.

## Environment

| Field | Value |
| --- | --- |
| Commit | `da09f407a30f39e81417855c13d0b485af02b003` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| CPU | Apple M4, 10 cores |
| Memory | 17179869184 bytes |
| Fixture | `gallery-large` |
| Fixture assets | 2400 |
| Fixture folders | 96 |
| Fixture state size | 1510172 bytes |

## Thumbnail Bytes

Phase 0 baseline values come from `docs/perf/gallery-baseline.md`. Phase 3 records the renderer asset protocol counters after opening Gallery from a cold regenerated fixture.

| Metric | Phase 0 | Phase 3 |
| --- | ---: | ---: |
| Gallery card URL mode | Original asset URLs | Thumbnail asset URLs |
| DOM Gallery images using thumbnail URLs | 0 | 2400 |
| Protocol original Gallery requests during capture | 40 sampled | 0 |
| Protocol thumbnail requests during capture | 0 | 3 |
| Bytes served for comparable visible sample | 13201 | 1522 |
| Byte reduction | 0% | 88.5% |
| Thumbnail cache hits / misses | n/a | 0 / 3 |
| Thumbnail fallbacks | n/a | 1 |

The single fallback is the fixture's tiny WebP sample, which Electron `nativeImage` does not decode in this environment. It still travels through the thumbnail protocol URL and does not request the original Gallery protocol path; unsupported decode falls back to the source file with `no-store`.

## Render And Accessibility

| Metric | Phase 0 | Phase 3 |
| --- | ---: | ---: |
| Time to first Gallery grid render | 1066.100 ms | 1050.300 ms |
| Gallery grid entries | 2404 | 2404 |
| Renderer accessibility smoke | Baseline issues documented separately | ok |
| axe violations | Existing baseline issues | 3 existing violations |

The first-grid render improvement is small because the renderer still mounts a large Gallery DOM in the capture. The main Phase 3 gain is reduced card image bytes and separating card thumbnails from original preview/download delivery. Broader render reductions remain part of the later App decomposition work.

## Behavior Notes

- Card thumbnails use `image2tools-asset://image?gallery=...&thumb=1&v=...`.
- Original Gallery preview, edit, download, and history asset requests continue to use original URLs.
- Thumbnail cache keys include Gallery relative path, source file size, source modified time, and target thumbnail width.
- Cached thumbnails are stored under the Electron userData directory and can be regenerated from source assets.
