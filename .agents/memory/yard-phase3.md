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

## yard-tokens.ts (prerequisite for all restyling)
- `src/lib/yard-tokens.ts` — single source for: `panelBg`, `panelHeaderBg` (#1e293b), `panelHeaderText`, `hairline`, `border`, `labelMuted` (#6b7280), `valueStrong` (#111827), `signalBreach` (#dc2626), `signalBreachDark` (#f87171 for dark panel), `signalWarn` (#f59e0b fills), `signalWarnText` (#d97706 text on white — AA 4.68:1), `signalOk` (#16a34a), `mono` (font-family string).
- Imported as `YT` in `YardMap.tsx`, `PhysicalYardMap.tsx`, `BlockInteriorView.tsx`.
- Deliberate divergence: drawer uses `panelBg` (#fff — reading surface); map panel keeps its dark glass HUD. Same signal language, different surfaces.
- `signalWarn` (#f59e0b) is only for fills/icons. Text on white must use `signalWarnText` (#d97706) — #f59e0b fails WCAG AA on white (3.18:1).

## Phase 3.6 — Colorblind-safe mode
- `LEGEND_ENTRIES` in `yard-color.ts`: 3-tuple `[label, color, shape]` for every ColorMode. Shape vocabulary: ▲ danger, ◉ urgent, ◆ warning, ■ normal, ○ low, ● categorical.
- `LEGENDS` is now a derived compat export (label+color only) — no callers broken.
- `cbMode` state in `YardMap.tsx`; toggle in Overlays section of left panel.
- `worstLfdByBlock: Map<string, "breached"|"risk24"|"risk72">` computed from containers; passed to PhysicalYardMap.
- Legend renderer: when cbMode on, shows color-square + shape-char pair side by side.
- Legend header shows "· ◆ CB-SAFE" indicator when active.
- Detention worklist legend: shape+color always shown (▲ breached, ◉ at risk) — not gated on cbMode.
- PhysicalYardMap: `cbMode` + `worstLfdByBlock` props; block label row shows shape glyph (▲/◉/◆) inline when cbMode + block has notable LFD state.

**Why:** Shape-only tokens are needed so no signal is hue-only. Shape lives in the block label row to avoid z-conflict with congestion % (also top-right).

## Phase 3.7 — Zone R panel restyle
- Header changed from `#f9fafb`/`#374151` to solid `#1e293b`/`#fff` (WCAG AA: 14.7:1).
- Layout changed from `<table>` to CSS grid (3 col) for row-level left-border accent.
- When `storyMode`: header shows "● WAVE ARRIVED" / "⏱ HOT" / "✓ CLEARED" indicator.
- Row highlighting per story step: wave → blue tint, hot steps → amber tint, cleared → green tint.
- Status chip per row: shape-coded badge (⏱ Hot → red, ✓ Cleared → green, RECEIVED → grey).

## Phase 3.8 — Final acceptance / polish
- Overview zone hot dot now shows count ("⏱3") not just "⏱" — `zoneHotCount` derived alongside `zoneHasHot` in one memo.
- `aria-live="polite" aria-atomic="true"` on story narration step title.
- Detention worklist legend: shape+color (▲/◉) always present.
- CB-safe toggle added to Overlays section ("CB-safe shapes") + keyboard shortcut C could be added in future.

## Phase 3.5 — Keyboard shortcuts + accessibility
- Keyboard handler extended: H (congestion), P (planner), F (fit), ? (cheatsheet).
- Escape priority: cheatsheet → story → drawer → back.
- Shortcut cheatsheet modal: white card, absolute overlay, `?` opens, Esc closes.
- Block divs: `tabIndex={0}`, `role="button"`, `aria-label`, `aria-pressed`, `className="yard-block"`.
- `.yard-block:focus-visible` CSS: `2.5px solid #6366f1` + `rgba(99,102,241,0.14)` halo (indigo, distinct from red selection and amber detention).
- Empty zone overlay: shows "No containers in this zone yet" at working/detail zoom.
- Offline error: icon + "Switch to Seed mode" button, 340px card.
