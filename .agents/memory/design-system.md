---
name: YardOS design system
description: Design token decisions, utility classes, and gotchas from the dense-operational DS spec applied across all screens
---

# YardOS Design System

## Source specs applied (in order)
1. Font stack, type scale, spacing density — `attached_assets/Pasted-1-Font-stack…`
2. Badges, routes, status indicators — `attached_assets/Pasted-5-Badges-tags…`
3. Interactive elements, alert rows, footer bars — `attached_assets/Pasted-7-Interactive-elements…`

## CSS utility classes (src/index.css)

### Typography
- `.ds-text-page` → 20px/600, `.ds-text-section` → 16px/600
- `.ds-text-body` → 14px/400, `.ds-text-body-bold` → 14px/500
- `.ds-text-data` → 13px/400, `.ds-text-caption` → 12px/500
- `.ds-text-micro` → 11px/600, uppercase, 0.5px tracking
- `.ds-label` → same as micro (updated from old 10px/0.1em)

### Color tokens
- `--text-primary` #1a1a18, `--text-secondary` #6b6b66, `--text-muted` #9b9b95
- `--font-sans` Inter stack, `--font-mono` SF Mono → Cascadia Code → JetBrains Mono stack

### Badges
- `.ds-badge` → inline-flex, 4px gap, **3px 10px** padding, **5px** radius, 11px/600, nowrap
- Semantic: `.ds-badge-success` green-50/#166534, `.ds-badge-active` blue-50/#1e40af,
  `.ds-badge-planned` purple-50/#6b21a8, `.ds-badge-warning` amber-50/#92400e,
  `.ds-badge-danger` red-50/#991b1b, `.ds-badge-neutral` gray-100/#374151
- **NEVER** use white text on tinted badges — darkest hue stop only

### Buttons
- `.ds-btn` base (gap 6px, 5px radius, 13px, transitions)
- `.ds-btn-primary` → 36px, 500, #111827 fill
- `.ds-btn-secondary` → 36px, 500, white + 0.5px border
- `.ds-btn-ghost` → 32px, 400, transparent, hover reveal

### Filter pills
- `.ds-filter-pill` → 32px height, 13px/500, 6px 14px padding, **20px** radius, 0.5px border
- Active: `background #eef2ff, color #4f46e5, border #c7d2fe`
- Dot indicator: 6px circle, margin-right 5px

### Search inputs
- `.ds-search` → 36px, 14px body, 13px placeholder/muted, 0.5px border, focus → accent border
- min-width 240px, prefer 260px for container-ID readability

### Routes
- `.ds-route-sep` muted `·`, `.ds-route-arrow` muted `→` 14px 7px padding
- `.ds-gate-pill` gray-100 surface, 4px radius, 12px/600 uppercase mono
- `LocSpan` component in `src/components/planner/MoveRow.tsx` renders either a GATE pill or a parsed coord with muted dots

### Tables
- `.ds-th` → 12px/500, 0.5px tracking, uppercase, `--text-secondary`
- `.ds-td` → 13px/400, **52px** min-height, **12px** cell padding, **0.5px** row border
- Stacked cells: line-1 14px/500 primary, line-2 12px/500 muted, **3–4px** gap
- Alert row: `3px solid #ef4444` (red-500) for LFD breach, `3px solid #f59e0b` (amber-500) for holds

### Footer/status bar
- `.ds-footer-bar` → 44px, surface bg, top border
- `.ds-footer-label` → 11px/600, uppercase, 0.5px tracking, muted
- `.ds-footer-value` → 13px/500, primary; `.ds-footer-sep` → muted `·`
- Ghost button far right for any action

## Status-chip semantic color mapping (spec)
| Status      | Bg       | Text     | Class           |
|-------------|----------|----------|-----------------|
| Completed   | #f0fdf4  | #166534  | badge-success   |
| In yard     | #eff6ff  | #1e40af  | badge-active    |
| Checked in  | #faf5ff  | #6b21a8  | badge-planned   |
| At position | #fffbeb  | #92400e  | badge-warning   |
| In queue    | #f3f4f6  | #374151  | badge-neutral   |
| Expected    | #f3f4f6  | #374151  | badge-neutral   |

## Screens updated
- `src/screens/GateConsole.tsx` — full DS (type, badges, pills, search, CTA buttons, alert borders, dark-mode C object)
- `src/screens/NightPlanner.tsx` — footer bar (`ds-footer-bar` / `ds-footer-label` / `ds-footer-value`)
- `src/components/planner/MoveRow.tsx` — `LocSpan` route renderer, `ds-badge` for equipment/status
- `src/utils/displayLabels.ts` — STATUS_COLORS and getEquipmentType corrected to -800 text stops
- `src/components/ui/button.tsx` — buttonVariants sizes updated (h-9=36px default, h-8=32px sm/ghost)

## Screens NOT yet updated to new DS
- `src/screens/ControlTower.tsx` — filter chips, buttons still ad-hoc
- `src/screens/LiveOps.tsx` — filter buttons, CTA still ad-hoc
- `src/screens/NightPlanner.tsx` — operation filter tabs still rectangle toggle group
- `src/screens/OperatorTablet.tsx` — white text on colored badges (spec violation)

## Gotchas
- pg returns DECIMAL/NUMERIC as strings; cast ::float in SELECT
- `Number(seedTask.seq)` where seq is "07 of 24" → NaN; use `parseInt` instead
- `shadow-2xl` ONLY on CommandPalette modal
- No rounded-xl, no gradient backgrounds, no shadows on table rows
- emergald/orange colors → map to #059669/#d97706
- The `C` object in GateConsole (dark-mode token map) keeps separate light/dark values for each surface/text/border; do not flatten to CSS vars without also wiring dark-mode toggle to a CSS class
- `--text-primary/secondary/muted` CSS vars are defined but most non-GateConsole components still use hardcoded hex — future: migrate to token vars for dark-mode auto-support

**Why:**
The spec explicitly bans decorative shadow and gradient patterns; 6-color status palette is strict for at-a-glance accuracy; badge text must use darkest hue stop (not white) so tinted rows stay readable.
