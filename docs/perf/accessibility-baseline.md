# Accessibility Baseline

Captured: 2026-07-07

This baseline is produced by:

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-large --output output/perf-fixtures/gallery-large --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-large --output output/perf-baselines/gallery-large --iterations 3
```

The renderer is launched with a temporary fixture userData directory and a temporary Vite dev server. No real API key or real user data is used.

## Environment

| Field | Value |
| --- | --- |
| Commit | `1413342875f8c94ab0c86a2abe0417a059e80de9` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| Fixture | `gallery-large` |
| Assets | 2400 |
| Folders | 96 |

## DOM Smoke

| Check | Result |
| --- | --- |
| Buttons without accessible names | 0 |
| Images missing `alt` | 0 |
| Dialogs missing `aria-modal="true"` | 0 |
| Notice live region | Missing |
| Notice `aria-live` | `null` |
| Notice `aria-atomic` | `null` |

The notice live-region gap maps directly to Phase 1.

## axe Smoke

`axe-core` runs in the Electron renderer with `wcag2a`, `wcag2aa`, and `best-practice` tags.

Summary:

| Field | Value |
| --- | ---: |
| Violations | 3 |
| Incomplete | 2 |

Violations:

| Rule | Impact | Current target |
| --- | --- | --- |
| `aria-required-children` | critical | `.mode-tabs` |
| `color-contrast` | serious | muted body/small text samples |
| `landmark-unique` | moderate | `.sidebar` |

Representative axe details:

```text
aria-required-children:
  Element has children which are not allowed: button

color-contrast:
  #7f776c on #faf7f2 contrast is 4.13; expected 4.5.
  #7f776c on #fffdf9 contrast is 4.34; expected 4.5.

landmark-unique:
  The landmark must have a unique aria-label, aria-labelledby, or title.
```

## Phase 1 Expectations

- Add `aria-live` and `aria-atomic` to notice UI.
- Fix success/notice color tokens without worsening contrast.
- Preserve the zero-count checks for unlabeled buttons, missing image alt, and modal `aria-modal`.
- Reduce or document remaining axe violations after the low-risk UI fixes.

## v0.3.0 Final A11y Closeout

Captured: 2026-07-09

Commands:

```bash
pnpm build
node scripts/create-large-gallery-fixture.mjs --profile gallery-small --output output/perf-fixtures/gallery-small --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-small --output output/perf-baselines/a11y-final-light --iterations 1 --theme light
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-small --output output/perf-baselines/a11y-final-dark --iterations 1 --theme dark
```

Raw local results:

```text
output/perf-baselines/a11y-final-light/gallery-small-ffa2b11bbcd9.json
output/perf-baselines/a11y-final-dark/gallery-small-ffa2b11bbcd9.json
output/perf-baselines/a11y-final-light/electron-renderer-metrics.json
output/perf-baselines/a11y-final-dark/electron-renderer-metrics.json
```

Result summary:

| Theme | Renderer status | Accessibility smoke | axe violations | axe incomplete |
| --- | --- | --- | ---: | ---: |
| Light | `ok` | `ok` | 0 | 2 |
| Dark | `ok` | `ok` | 0 | 2 |

Fixed closeout categories:

- `aria-required-children`: the image-mode switch is now a button group instead of an ARIA tablist.
- `landmark-unique`: the left parameter sidebar and right library rail now have distinct landmark labels.
- `color-contrast`: light-mode muted text, filled accent controls, and selected Gallery folder text now meet the WCAG AA contrast threshold in the capture path.
