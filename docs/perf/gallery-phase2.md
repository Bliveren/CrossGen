# Gallery Phase 2 Performance Results

Captured: 2026-07-08

Phase 2 targets the main-process Gallery read paths. It keeps full disk scan recovery available, but avoids forcing a scan when the Gallery watcher state is fresh.

## Commands

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/phase2-gallery-large --iterations 3 --no-renderer
```

The measurement used `gallery-large` with 96 folders and 2400 assets. Renderer capture was intentionally skipped with `--no-renderer` because this phase changes backend read/sync behavior, not Gallery card rendering.

Raw local result:

```text
output/perf-baselines/phase2-gallery-large/gallery-large-0d4e11918e04.json
```

`output/` is ignored by git; rerun the command above for fresh machine-local metrics.

## Environment

| Field | Value |
| --- | --- |
| Commit | `0d4e11918e04d1f5728bba16bbba80eaa7935f88` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| CPU | Apple M4, 10 cores |
| Memory | 17179869184 bytes |
| Fixture | `gallery-large` |
| Fixture assets | 2400 |
| Fixture folders | 96 |
| Fixture state size | 1510172 bytes |

## Before And After

Phase 0 baseline values come from `docs/perf/gallery-baseline.md`.

| Path | Phase 0 median | Phase 2 median | State writes |
| --- | ---: | ---: | ---: |
| `app:getSnapshot` handler-equivalent | 44.700 ms | 1.590 ms | 0 |
| `gallery:list` handler-equivalent | 40.130 ms | 0.001 ms | 0 |
| `galleryFolders:list` handler-equivalent | 39.094 ms | 0.001 ms | 0 |
| Electron main `app:getSnapshot` | 88.510 ms | 0.093 ms | 0 |
| Electron main `gallery:list` | 62.592 ms | 0.008 ms | 0 |
| Electron main `galleryFolders:list` | 60.172 ms | 0.006 ms | 0 |

## Recovery And Sync Metrics

| Metric | Phase 2 median | Notes |
| --- | ---: | --- |
| `scanGalleryDisk` full | 38.079 ms | Full recovery path remains available. |
| `scanGalleryDisk` incremental file | 0.038 ms | Used when watcher reports a changed file. |
| `scanGalleryDisk` incremental folder | 1.773 ms | Used when watcher reports a changed subtree. |
| `app:getSnapshot` full-scan recovery-equivalent | 39.219 ms | Explicit recovery still scans and reconciles the full Gallery. |
| Full sync with no Gallery changes | 0 writes | Dirty detection no longer uses full `JSON.stringify` comparisons. |

## Notes

- Read-only IPC now returns cached Gallery state when the watcher is current and no disk changes are pending.
- Pending watcher changes are consumed before read responses; file/subtree changes use incremental scan inputs and null watcher events still force full recovery.
- Watcher restart uses folder paths derived from reconciled state instead of scanning the Gallery only to discover watched folders.

## Follow-up: `gallery:pick`

Captured: 2026-07-08

`gallery:pick` is a read path used when adding a Gallery image as a reference input. It still forced `syncGalleryWithDisk(...)` after the initial Phase 2 work. The follow-up switches it to `syncGalleryForRead(...)` and adds the handler to the Electron main-process performance capture.

Command:

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/phase2-gallery-pick --iterations 3 --no-renderer
```

Raw local result:

```text
output/perf-baselines/phase2-gallery-pick/gallery-large-6623cb62484a.json
```

Before was measured with the same capture instrumentation and the previous one-line `syncGalleryWithDisk(...)` implementation restored temporarily.

| IPC handler | Before | After | State writes |
| --- | ---: | ---: | ---: |
| `gallery:pick` | 63.722 ms | 0.215 ms | 0 |

The watcher-fresh read path now avoids a full Gallery disk scan while preserving the managed-file assertion before returning the picked `InputAsset`.
