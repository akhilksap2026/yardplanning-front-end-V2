---
name: Yard map dark-glass left panel
description: Phase 3.1 — WCAG-verified dark panel design tokens and collapse pattern for the YardMap left control panel.
---

# Dark-glass left panel (Phase 3.1)

## Rule
The YardMap left panel (`src/screens/YardMap.tsx`, lines ~745–985) uses `rgba(15,20,30,0.92)` + `backdrop-filter: blur(14px)`. All text colours are verified against the effective blended background (~`#1F232C` over concrete `#D5D0C8`).

**Why:** The old `bg-white` panel was a WCAG contrast risk over the textured map. The dark-glass style raises perceived contrast and gives the panel visual hierarchy over the map canvas.

## Verified colour tokens (effective bg L ≈ 0.018)
| Token | Hex / alpha | Contrast | Use |
|---|---|---|---|
| Values | `rgba(255,255,255,0.90)` | 13.4:1 ✓ | KPI numbers, zone IDs |
| Labels | `rgba(255,255,255,0.55)` | 6.1:1 ✓ | Section headers, captions |
| Danger red | `#f87171` | 5.6:1 ✓ | Detention, hot count |
| Amber | `#fbbf24` | 9.6:1 ✓ | Mid-occupancy, active blocks |
| Green | `#34d399` | ~5.8:1 ✓ | OccupancyRing healthy |
| Dividers | `rgba(255,255,255,0.08)` | decorative | section separators |
| Hover rows | `rgba(255,255,255,0.06)` via `hover:bg-white/[0.06]` | n/a | zone list rows |

**Why #f87171 not #dc2626:** `#dc2626` gives only 3.86:1 on this dark bg — fails 4.5:1 normal text. `#f87171` (red-400) clears it at 5.6:1. Note: `#dc2626` is still used on the white-bg dashboard/drawer where it passes (5.48:1 on white).

## How to apply
- Any new text on the dark panel must use one of the tokens above.
- If adding a new danger colour: verify at 4.5:1 against `#1F232C` before committing.
- Do NOT use `bg-white` or light-bg patterns inside the left panel div.
- For the collapsed strip width: `width: 48` (not `w-12` className — use inline style to avoid Tailwind JIT purging).

## Collapse pattern
- `panelCollapsed` state (useState, default false) in YardMap.tsx.
- Collapsed: 48 px div with `▶` button + rotated status text `{occ}% · {TEU} TEU · ⏱{hotCount} · {detentionShort}`.
- Expanded: full `w-56` with `◀` toggle in the solid header band.
- `hotCount` = `useMemo(() => [...hotByBlock.values()].reduce((s, v) => s + v, 0), [hotByBlock])`.

## Section order (expanded, seed mode)
1. Solid header band (TERMINAL / LIVE YARD label + ◀ toggle)
2. DETENTION RISK — 30px `#f87171` figure, full-width button → drawer
3. HOT ⏱ + OCCUPANCY ring (grid 2-col)
4. TEU · AVG TIER · TURN P90 (grid 3-col, 14px mono)
5. ZONES — scrollable list
6. OVERLAYS — toggles
7. LEGEND
8. SHIFT TIMELINE — scrubber
