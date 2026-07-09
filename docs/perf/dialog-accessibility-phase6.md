# Dialog Accessibility Phase 6 Evidence

Captured: 2026-07-08

Phase 6 introduces shared dialog keyboard behavior through `DialogShell` and adds repeatable renderer accessibility smoke coverage for the storage settings dialog.

## Commands

```bash
node scripts/create-large-gallery-fixture.mjs --profile gallery-small --output output/perf-fixtures/gallery-small --force
node scripts/measure-gallery-performance.mjs --fixture output/perf-fixtures/gallery-small --output output/perf-baselines/phase6-dialog-smoke-gallery-small --iterations 1
```

Raw local result:

```text
output/perf-baselines/phase6-dialog-smoke-gallery-small/gallery-small-460ddcfbb5af.json
```

`output/` is ignored by git; rerun the commands above for fresh machine-local evidence.

## Environment

| Field | Value |
| --- | --- |
| Commit | `460ddcfbb5af7e6702bec1d347edd2a0f83984bf` |
| OS | Darwin `25.5.0` |
| Architecture | `arm64` |
| CPU | Apple M4, 10 cores |
| Memory | 17179869184 bytes |
| Fixture | `gallery-small` |
| Fixture assets | 180 |
| Fixture folders | 18 |
| Fixture state size | 114612 bytes |

## Dialog Keyboard Smoke

The renderer smoke opens the Library path settings dialog and verifies the shared keyboard contract.

| Check | Result |
| --- | --- |
| Dialog smoke status | `ok` |
| Opener focused before opening | `true` |
| Dialog opened | `true` |
| Initial focus inside dialog | `true` |
| Focusable controls found | 6 |
| `Shift+Tab` wraps from first to last control | `true` |
| `Escape` closes dialog | `true` |
| Focus returns to opener | `true` |

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

Remaining axe categories at this phase were unchanged from the known baseline: `aria-required-children`, `color-contrast`, and `landmark-unique`.

## v0.3.0 A11y Final Update

Captured: 2026-07-09

The final accessibility pass keeps the dialog keyboard smoke checks passing and clears the remaining axe violations in both light and dark captures:

```text
output/perf-baselines/a11y-final-light/gallery-small-ffa2b11bbcd9.json
output/perf-baselines/a11y-final-dark/gallery-small-ffa2b11bbcd9.json
```

Final axe violation count: 0 in light mode and 0 in dark mode.

## Scope Notes

This evidence covers shared dialog focus behavior and the renderer smoke path. Dark mode remains a separate Phase 6 theming task and is intentionally not included in this slice.
