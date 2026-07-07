# Gallery Performance Baseline

Captured: 2026-07-07

This baseline is for the optimization track in `docs/plans/performance-accessibility-hardening-plan.md`.
All fixture data is generated under `output/perf-fixtures`, which is ignored by git and is not the real Electron userData directory.

## Fixture Layout

Command:

```bash
pnpm install
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/gallery-large --iterations 3
```

Generated temp layout:

```text
output/perf-fixtures/gallery-large/
  manifest.json
  userData/
    image2tools-state.v1.json
    images/
    gallery/
```

The measurement harness launches Electron with `CROSSGEN_USER_DATA_DIR=<fixture>/userData`; it does not read or write the user's real app data.

## Fixture Profiles

| Profile | Purpose | Folders | Assets | Depth |
| --- | --- | ---: | ---: | ---: |
| `gallery-small` | Fast smoke validation | 18 | 180 | 3 |
| `gallery-large` | Main performance baseline | 96 | 2400 | 4 |
| `gallery-deep` | Nested folder stress | 84 | 900 | 14 |

Fixtures include nested folders, duplicate file names across folders, mixed `.png` / `.jpg` / `.jpeg` / `.webp` extensions, and deterministic tag metadata.

## Baseline Environment

| Field | Value |
| --- | --- |
| Commit | `1413342875f8c94ab0c86a2abe0417a059e80de9` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| CPU | Apple M4, 10 cores |
| Memory | 17179869184 bytes |
| Fixture | `gallery-large` |
| Fixture assets | 2400 |
| Fixture folders | 96 |
| Fixture state size | 1510172 bytes |
| Fixture image bytes | 792200 bytes |

Raw generated result:

```text
output/perf-baselines/gallery-large/gallery-large-1413342875f8.json
```

`output/` is ignored, so rerun the command above when a fresh machine-local baseline is needed.

## Metrics

### Disk Scan

| Metric | Median |
| --- | ---: |
| `scanGalleryDisk` full | 40.694 ms |
| `scanGalleryDisk` incremental file | 0.036 ms |
| `scanGalleryDisk` incremental folder | 1.885 ms |

Full scan result: 96 folders, 2400 assets, 792200 asset bytes.

### Reconcile

| Metric | Median |
| --- | ---: |
| `reconcileGalleryDiskState` full | 1.513 ms |
| `reconcileGalleryDiskChanges` incremental file | 3.860 ms |

### Handler-Equivalent Read Paths

These run the same scan/reconcile functions from compiled main-process code.

| Handler path | Median | State writes |
| --- | ---: | ---: |
| `app:getSnapshot` equivalent | 44.700 ms | 0 |
| `gallery:list` equivalent | 40.130 ms | 0 |
| `galleryFolders:list` equivalent | 39.094 ms | 0 |

### Electron Main Handler Capture

These are captured inside Electron main process with `CROSSGEN_PERF_RESULT_PATH`.

| IPC handler | Duration | State writes |
| --- | ---: | ---: |
| `app:getSnapshot` | 88.510 ms | 0 |
| `gallery:list` | 62.592 ms | 0 |
| `galleryFolders:list` | 60.172 ms | 0 |

### State Writes

| Scenario | Writes | Payload bytes |
| --- | ---: | ---: |
| Full sync with no Gallery changes | 0 | 1510172 |
| Gallery tag update | 1 | 1510195 |
| Gallery folder rename | 1 | 1510180 |
| Gallery asset move | 1 | 1510189 |

### Thumbnail/Asset Loading

Current Gallery cards request full original asset URLs. The fixture sample records the current behavior so Phase 3 can compare thumbnail bytes.

| Metric | Value |
| --- | ---: |
| Sampled cards | 40 |
| Current requests | 40 |
| Current bytes served | 13201 |
| Average bytes/request | 330.025 |

### Renderer And Profiler

Renderer capture runs Electron against a temporary Vite dev server so React Profiler events are available.

| Metric | Value |
| --- | ---: |
| Time to first Gallery grid render | 1066.100 ms |
| Gallery entries reported by grid | 2404 |
| Simulated partial image events | 3 |
| React Profiler App update events | 2 |
| First profiler `actualDuration` | 1149.200 ms |
| First profiler `baseDuration` | 1140.500 ms |

This confirms the current `App`-level partial image update remains expensive and gives Phase 5 a repeatable comparison point.

## Acceptance Notes

- Fixture regeneration works from a clean checkout after `pnpm install`.
- The fixture uses no real API keys.
- The fixture uses `output/perf-fixtures/.../userData`, not the real Electron userData directory.
- Results include machine, OS, commit SHA, fixture size, and exact commands.
- Any Gallery performance PR must rerun the same command and report profile, before metric, after metric, and command used.
