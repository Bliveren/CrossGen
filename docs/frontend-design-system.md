# CrossGen Frontend Design System

This document defines the global UI standards for CrossGen. Renderer changes should reuse these rules before adding one-off component styles.

## Typography

- App font: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- App body: 14px, normal line height from the browser/system font.
- Product title: 21px, weight 760.
- Section headings: 16px, weight 750, line-height 1.2.
- Control text: 13px, weight 650.
- Captions, metadata, chips: 11px.
- Letter spacing is always `0`.

## Controls

- Default button height: 36px.
- Compact button height: 30px.
- Icon-only buttons must use stable square dimensions and centered icons.
- Button radius is `var(--radius-md)` / 6px.
- Button text and icons are center-aligned with 8px default gap.

## Surfaces

- App background: `var(--surface-app)`.
- Panel background: `var(--surface-panel)`.
- Floating surfaces: `var(--surface-floating)`, `var(--shadow-popover)`, blur backdrop, and `var(--radius-md)`.
- Floating surfaces must not use pill/999px radius unless the control itself is a chip or circular icon button.
- Editor top controls, editor zoom controls, compact drawers, tag popovers, menus, and pagers all use `var(--surface-floating-radius)`, which resolves to the same 6px radius as buttons.
- Cards use `var(--radius-lg)` / 8px and must not be nested inside decorative cards.

## Chips And Tags

- Tags and add-tag prompts share the exact same chip anatomy:
  - 20px minimum height.
  - 11px font size.
  - 2px vertical and 7px horizontal padding.
  - 999px radius.
  - Single-line ellipsis.
- Add-tag prompts may use a dashed border, but not a different size, font, or shape.
- Tags and add-tag prompts use a fixed 20px border-box height. Do not rely only on `min-height` for tag buttons because global button styles can make the prompt look larger than existing tags.

## Floating Motion

- Mouse-follow drift must stay subtle.
- Primary floating controls use up to 3.5px horizontal and 2.2px vertical drift.
- Secondary menus, drawers, popovers, and pagers use up to 2px horizontal and 1.2px vertical drift.
- Visible state transitions use 140-220ms easing.

## Layout

- Resizers remain visible as region dividers, but collapsed regions must not be draggable.
- Collapsed region dividers must not be pointer targets or keyboard-focusable resize handles.
- Collapsed right rail thumbnails use compact spacing and keep 20px side padding so thumbnails and bottom actions match the compact left rail button inset.
- Low-height viewports must compress secondary copy, metadata, prompts, reference grids, and mask canvases before creating app-level vertical scrolling.
