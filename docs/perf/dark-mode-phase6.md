# Dark Mode Phase 6 Evidence

Captured: 2026-07-08

Phase 6 adds system-aware dark mode tokens and repeatable renderer capture for light and dark themes. The implementation uses semantic surface, text, border, status, overlay, and checkerboard variables rather than blind color inversion.

## Commands

```bash
pnpm build
node scripts/create-large-gallery-fixture.mjs --profile gallery-small --output output/perf-fixtures/gallery-small --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-small --output output/perf-baselines/phase6-dark-mode-light --iterations 1 --theme light
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-small --output output/perf-baselines/phase6-dark-mode-dark --iterations 1 --theme dark
```

Raw local results:

```text
output/perf-baselines/phase6-dark-mode-light/gallery-small-c0d9cc9ef680.json
output/perf-baselines/phase6-dark-mode-dark/gallery-small-c0d9cc9ef680.json
```

Screenshots captured by the renderer harness:

```text
output/perf-baselines/phase6-dark-mode-light/screenshots/renderer-light.png
output/perf-baselines/phase6-dark-mode-dark/screenshots/renderer-dark.png
```

`output/` is ignored by git; rerun the commands above for fresh machine-local evidence and screenshots.

## Environment

| Field | Value |
| --- | --- |
| Commit | `c0d9cc9ef68061708187a037b3c309cb6bdf9ed9` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| CPU | Apple M4, 10 cores |
| Memory | 17179869184 bytes |
| Fixture | `gallery-small` |
| Fixture assets | 180 |
| Fixture folders | 18 |
| Fixture state size | 114606 bytes |

## Theme Capture

| Theme | Renderer status | Screenshot | Accessibility smoke | axe violations | axe categories |
| --- | --- | --- | --- | ---: | --- |
| Light | `ok` | `renderer-light.png` | `ok` | 3 | `aria-required-children`, `color-contrast`, `landmark-unique` |
| Dark | `ok` | `renderer-dark.png` | `ok` | 2 | `aria-required-children`, `landmark-unique` |

The dark screenshot was visually checked for readable text, nonblank image canvas, visible panel boundaries, visible checkerboard background, and active orange controls. The dark axe run removes the light-mode `color-contrast` category from this capture.

## Token Audit

Dark mode is scoped through `@media (prefers-color-scheme: dark)` and Electron's `nativeTheme.themeSource` during automated captures. The renderer declares `color-scheme` for native controls and switches shared semantic variables:

| Token area | Covered variables |
| --- | --- |
| Surfaces | `--surface-app`, `--surface-panel`, `--surface-panel-muted`, `--surface-raised`, `--surface-selected`, `--surface-hover`, `--surface-floating` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`, `--text-on-accent` |
| Borders and shadows | `--border-subtle`, `--border-strong`, `--shadow-soft`, `--shadow-popover` |
| Status and accents | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-border`, `--success`, `--danger`, `--warning` |
| Visual surfaces | `--checker-mark`, `--glass-surface`, `--crop-overlay`, `--modal-backdrop-surface` |

High-risk hardcoded translucent surfaces were moved to tokens: preview checker marks, crop overlay, modal backdrop, reference image glass, and mask drop zone glass. Accent-filled buttons now use `--text-on-accent` so dark theme can use dark text on the lighter orange accent while light theme keeps white text.
