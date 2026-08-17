---
name: Yard map Phase 2.3–2.4 signal layer
description: Detention exposure KPI (live, hover, drillable), congestion hatching at z5, rehandle debt glyph — what was moved, why, and how it wires together.
---

## Phase 2.3 — Detention exposure KPI

**Rule:** The Detention KPI in the left panel must never be a static string. It reads from `computeDetentionExposure(containers, CARRIERS)`.

**Why:** The original `$8.4k` was hardcoded. Real exposure depends on carrier tier schedules in `reference-pools.ts`.

**How to apply:**
- `computeDetentionExposure` lives in `yard-layout.ts`; returns `{ rows, totalUsd, blockSet }`.
- Carrier tier lookup: find the `[dayFrom, dayTo, ratePerDay]` tuple where `dwellDays` falls; fall back to last tier; default rate = $50.
- Breached containers (hoursToLFD ≤ 0): exposure = rate × max(1, dwellDays − freeDays).
- At-risk containers (0 < hoursToLFD ≤ 24): exposure = rate for the first paid day (1-day risk charge).
- `blockSet` is passed as `highlightBlocks` to `PhysicalYardMap` while the KPI is hovered → amber pulsing ring via `.yard-detention-highlight` CSS class.
- KPI click → `setDrawerMode("detention")` + `setDrawerOpen(true)`.
- Detention drawer rows are sorted by `hoursToLFD` ascending (most overdue first); clicking a row deep-links to slot view: `setSelectedSlot({col, row})` + `setDrawerMode("slot")`.

## Phase 2.4 — Congestion & rehandle debt

**Rule:** Congestion must NOT use a flat `rgba` fill inside block tiles at z4 — it masks the block status colour.

**Why:** The previous `heatTint` overlay made it impossible to read block occupancy colour through the congestion signal.

**How to apply:**
- At z5 (`PhysicalYardMap` z5 signals div): render an absolutely-positioned `<svg>` per congesting block using a `<pattern>` with diagonal lines (`x1=0 y1=h x2=h y2=0`) + a coloured edge ring rect. Pattern ID must be unique per block (`hatch-${label.replace("-","")}`).
- Three levels: amber `#f59e0b` (0.25–0.50), orange `#f97316` (0.50–0.75), red `#dc2626` (>0.75).
- Keep the "X%" text label inside the z4 block tile (controlled by `showCongestion`) so operators still see the number.
- `computeRehandleByBlock(moves)` in `yard-layout.ts`: counts `m.type === "RESHUFFLE"`, extracts block label from `m.from` by splitting on "-" and taking parts[0]+parts[1].
- Rehandle glyph rendered at `top: layout.y + layout.h - 18, left: layout.x + 5`, font size 10, amber ≤2 / red ≥3, `textShadow` keeps it legible.

## CSS classes (index.css)

- `.yard-detention-highlight` + `@keyframes detention-highlight-pulse`: amber border pulsing ring on highlighted blocks (hover-triggered from KPI).
- `.yard-hot-badge` + `@keyframes hot-badge-pulse`: red pulsing badge for HOT containers (highest priority).
- Both have `@media (prefers-reduced-motion: reduce)` guards.
