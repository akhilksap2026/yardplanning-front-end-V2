---
name: Yard map phases 3.2–3.5
description: Progressive zoom tiers, move trails, Shift Story mode, keyboard UX; TSC-verified
---

## Phase 3.2 — Progressive disclosure (zoom tiers)
- Constants `OVERVIEW_SCALE=0.4`, `DETAIL_SCALE=0.8` gate what renders.
- Overview: zone occupancy fill + single hot-dot per zone, no labels.
- Working: labels, slot counts, signals.
- Detail: slot grid lines, rehandle glyphs, container IDs.
- Zoom-tier pill in z6 chrome shows current tier.

**Why:** Avoids SVG overload at overview zoom; OVERVIEW tier is what execs see first.

## Phase 3.3 — Road-routed move trails
- `buildRoundedPath()` + `routeViaRoads()` stateless helpers (before `PhysicalYardMap`).
- Route: nearest N-S crossRoad center-x → nearest E-W boulevard → destination.
- Rendered as `<path strokeDasharray="7 5">` + `<animateMotion>` + `<mpath href>` dot.
- `prefersReducedMotion` (useMemo, reads `window.matchMedia` once) gates animation.
- Recent trails opaque, older faded; `<mpath>` points to visible `<path id>` (no hidden defs needed).

**Why:** `routeViaRoads` stateless (not a hook) — called per-trail in render; CIRCULATION already imported.

## Phase 3.4 — Shift Story exec demo mode
- `SHIFT_STORY: ShiftStoryStep[]` (4 steps) defined in `YardMap.tsx`.
- Props added to `PhysicalYardMap`: `commandedView: { cx, cy, zoom, seq } | null`, `fitViewSeq: number`.
- `commandedView` triggers animated pan (750 ms cubic-bezier); `seq` change drives re-pan.
- State: `storyMode`, `storyStep`, `storyPlaying`, `commandedView`, `fitViewSeq`.
- Story step effect: finds hot-block centroid for hot/detention highlight steps, else uses static coords.
- Auto-advance timer: 5.2 s/step while `storyPlaying`.
- Narration overlay: dark-glass card at map bottom-centre, z30, pointer-events scoped to controls.
- Play button in toolbar: "▶ Story" / "■ Story" toggle.

**Why:** `commandedView` prop (not forwardRef) — cleaner, avoids TypeScript forwardRef complexity.

## Phase 3.5 — Keyboard shortcuts + accessibility
- Keyboard handler extended: H (congestion), P (planner), F (fit), ? (cheatsheet).
- Escape priority: cheatsheet → story → drawer → back.
- Shortcut cheatsheet modal: white card, absolute overlay, `?` opens, Esc closes.
- Block divs: `tabIndex={0}`, `role="button"`, `aria-label`, `aria-pressed`, `className="yard-block"`.
- `.yard-block:focus-visible` CSS: `2.5px solid #6366f1` + `rgba(99,102,241,0.14)` halo (indigo, distinct from red selection and amber detention).
- Empty zone overlay: shows "No containers in this zone yet" at working/detail zoom.
- Offline error: icon + "Switch to Seed mode" button, 340px card.
