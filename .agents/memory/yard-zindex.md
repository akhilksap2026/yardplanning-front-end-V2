---
name: Yard map z-layer contract
description: Layer ordering for PhysicalYardMap.tsx — what can occlude what, and how facility/signal positions must be chosen.
---

## Layer stack (zIndex values within the zoomable canvas div)

| z | Name | Content | Notes |
|---|------|---------|-------|
| 0 | Ground | Concrete `#D5D0C8` + feTurbulence noise + grass strips | Never occludes anything above |
| 1 | Circulation | Asphalt roads, aisles, berth, gate, fence/cameras | pointerEvents: none |
| 2 | Facilities | 11 muted `#8B8B8B` building footprints | pointerEvents: auto (hover tooltip) |
| 3 | Zone panels | Opaque `bg` fills with zone header bars | **Fully occludes z2** — facility positions MUST be outside zone panel bboxes |
| 4 | Storage blocks | Clickable block tiles, occupancy bars | Contract: z0–z3 must never occlude these |
| 5 | Signals | Move trails (SVG), equipment icons, HOT BADGE (⏱N) | Hot badge: `.yard-hot-badge` CSS class |
| 6 | Chrome | NorthArrow, ScaleBar, zoom buttons, MiniMap, tooltips | Fixed, outside transform div |

## Facility placement rule

Zone panel bbox = `(b.x1 - PANEL_PAD_X, b.y1 - PANEL_PAD_TOP)` to `(b.x2 + PANEL_PAD_X, b.y2 + PANEL_PAD_BOT)` where PAD_X=16, PAD_TOP=36, PAD_BOT=12. Any facility whose (x,y,w,h) overlaps this bbox will be invisible under the opaque panel background.

**Why:** z2 < z3, and zone panels use solid opaque background colors.

**Safe pockets used by FACILITIES constant:**
- SLOT-W: x=660–780, y=85–455 (right of Zone C panel ~x=656, west of WEST SERVICE RD cross-road)
- SLOT-E: x=2262–2320, y=85–455 (right of Zone D panel ~x=2260)
- SLOT-S: x=160–1000, y=1012–1080 (below all zone panels bottom ~y=1011, above gate y=1117)

## Hot container badge

- CSS class `.yard-hot-badge` in `index.css` — `animation: hot-badge-pulse 1.5s ease-in-out infinite`
- `@media (prefers-reduced-motion: reduce)` removes animation, applies static ring `box-shadow` instead
- Triple redundancy: ⏱ icon (temporal cue) + N count + red color (#dc2626)
- Position: `left: layout.x + layout.w - 6`, `top: layout.y - 12` — floats above block top-right corner
- Click: calls `onHotBadgeClick(blockLabel)` → `handleHotBadgeClick` in YardMap.tsx sets `drawerHotFilter=true`

## Hot filter flow (YardMap.tsx)

1. `computeHotByBlock(containers)` — memoized, returns `Map<blockLabel, count>` for hoursToLFD ≤ 4 and non-empty
2. Badge click → `handleHotBadgeClick` → `setDrawerHotFilter(true)` + opens drawer
3. Drawer filters `rawContainers` to `hoursToLFD !== -9999 && hoursToLFD <= 4` when `drawerHotFilter && !isLive`
4. Hot filter banner in drawer shows count + "Show all" button to clear filter
5. Normal block click, drawer close button both call `setDrawerHotFilter(false)`
