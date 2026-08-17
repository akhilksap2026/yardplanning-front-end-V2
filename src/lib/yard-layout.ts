import type { Container, Zone, Move } from "@/data/yard-data"

export interface BlockLayout {
  zone: string
  block: number
  label: string
  x: number
  y: number
  w: number
  h: number
  occupancyPct: number
  containerCount: number
  capacity: number
  topContainerIds: string[]
  /** Physical row count — drives slot-grid line rendering in PhysicalYardMap */
  rows: number
  /** Physical slot count per row — matches SLOT_WIDTH_PX geometry */
  slots: number
}

// ── Layout constants ──────────────────────────────────────────────────────────

const SLOT_WIDTH_PX   = 36   // was 10 — each slot cell
const ROW_HEIGHT_PX   = 55   // was 14 — each row of slots
const LANE_WIDTH_PX   = 52   // aisle between block rows within a zone
const BLOCK_MARGIN_PX = 14   // margin between adjacent blocks in same row
const YARD_WIDTH      = 2400 // used only for live layout

/**
 * Spatial zone configuration — determines where each zone sits on the canvas.
 * xOrigin/yOrigin = top-left of the first block in the zone.
 * cols = blocks per row within the zone.
 *
 * Layout (bird's eye, terminal at top, gate at bottom):
 *
 *  [TERMINAL / BERTH ══════════════════════════════════════════════]
 *
 *  Zone C (customs)   │   Zone A (import full, 6 blocks)   │ Zone D (hazmat)
 *  Zone E (empties)   │   Zone B (import full, 6 blocks)
 *                     │   Zone S (staging, 1 block)
 *  Zone R (receiving lanes, 1 block near gate)
 *
 *  [GATE ══════════════════════════════════════════════════════════]
 */
// Horizontal cluster breaks:
//   Top cluster    (C/A/D)  — y = 80  … 462  (A drives bottom: 80+165+52+165 = 462)
//   Main boulevard           — y = 462 … 522  (60 px "TERMINAL DRIVE")
//   Middle cluster (E/B/F)  — y = 522 … 904  (E/B drive bottom: 522+165+52+165 = 904)
//   Bottom x-road            — y = 904 … 944  (40 px transversal)
//   Bottom cluster (Q/S/R)  — y = 944 … 999  (blockH=55 → one row)
//
// Vertical column gaps (cross-roads):
//   Left→Center: E right (784) … A left (880) — 96 px gap
//   Center→Right: A/B right (1988) … D/F/Q left (2028) — 40 px gap (exact road width)
const ZONE_LAYOUT: Record<string, { x: number; y: number; cols: number }> = {
  C: { x: 50,   y: 80,  cols: 2 },   // Customs hold    — upper left
  A: { x: 880,  y: 80,  cols: 3 },   // Dry/general     — upper centre
  D: { x: 2028, y: 80,  cols: 1 },   // Hazmat          — upper right  (x: 1990→2028 opens 40 px cross-road)
  E: { x: 50,   y: 522, cols: 2 },   // Empty depot     — middle left  (y: 430→522 opens boulevard)
  B: { x: 880,  y: 522, cols: 3 },   // Dry/general     — middle centre (y: 545→522 aligns with E)
  F: { x: 2028, y: 522, cols: 1 },   // Reefer          — middle right  (y: 420→522, x: 1990→2028)
  Q: { x: 2028, y: 944, cols: 1 },   // Quarantine/M&R  — lower right   (y: 740→944, x: 1990→2028)
  S: { x: 880,  y: 944, cols: 5 },   // Staging         — lower centre  (y: 990→944)
  R: { x: 50,   y: 944, cols: 10 },  // Receiving       — lower left    (y: 1100→944)
}

export function computeBlockLayouts(
  zones: Zone[],
  containers: Container[],
): BlockLayout[] {
  const layouts: BlockLayout[] = []

  for (const zone of zones) {
    const cfg = ZONE_LAYOUT[zone.id]
    if (!cfg) continue

    const blockW = zone.slots * SLOT_WIDTH_PX
    const blockH = zone.rows  * ROW_HEIGHT_PX

    for (let b = 0; b < zone.blocks; b++) {
      const col = b % cfg.cols
      const row = Math.floor(b / cfg.cols)
      const x   = cfg.x + col * (blockW + BLOCK_MARGIN_PX)
      const y   = cfg.y + row * (blockH + LANE_WIDTH_PX)

      const blockContainers = containers.filter(
        c => c.zone === zone.id && c.block === b + 1,
      )
      const capacity     = zone.rows * zone.slots * zone.maxTiers
      const occupancyPct = capacity > 0
        ? Math.round((blockContainers.length / capacity) * 100)
        : 0

      layouts.push({
        zone:    zone.id,
        block:   b + 1,
        label:   `${zone.id}-${String(b + 1).padStart(2, "0")}`,
        x, y, w: blockW, h: blockH,
        occupancyPct,
        containerCount: blockContainers.length,
        capacity,
        topContainerIds: blockContainers.slice(0, 3).map(c => c.id),
        rows:  zone.rows,
        slots: zone.slots,
      })
    }
  }

  return layouts
}

// ── Equipment overlay ─────────────────────────────────────────────────────────

export interface EquipmentPosition {
  id:               string
  type:             "jockey" | "reach-stacker" | "empty-handler"
  name:             string
  operatorName:     string
  x:                number  // layout-space centre of currentBlock
  y:                number
  status:           "idle" | "moving" | "lifting" | "travelling"
  currentBlock:     string
  destinationBlock?: string
  progress:         number  // 0–1
}

const HOME_BLOCKS: Record<string, string> = {
  "RS-01": "A-01", "RS-02": "A-03", "RS-03": "B-01", "EH-01": "E-01",
}

function blockCenter(label: string, layouts: BlockLayout[]): { x: number; y: number } {
  const l = layouts.find(l => l.label === label)
  return l ? { x: l.x + l.w / 2, y: l.y + l.h / 2 } : { x: 120, y: 120 }
}

function parseBlock(address: string): string {
  return address.match(/^([A-Z]-\d+)/)?.[1] ?? ""
}

export function computeEquipmentPositions(
  operators: Array<{ id: string; name: string; equipment: string; status: string }>,
  moves: Move[],
  layouts: BlockLayout[],
): EquipmentPosition[] {
  return operators
    .filter(op => op.status === "on shift")
    .map((op, idx) => {
      const type: EquipmentPosition["type"] =
        op.equipment.startsWith("RS") ? "reach-stacker"
        : op.equipment.startsWith("EH") ? "empty-handler"
        : "jockey"

      const inProg   = moves.find(m => m.operator === op.id && m.state === "IN_PROGRESS")
      const assigned = moves.find(m => m.operator === op.id && m.state === "ASSIGNED")

      let status: EquipmentPosition["status"] = "idle"
      let currentBlock = HOME_BLOCKS[op.equipment] ?? "A-01"
      let destinationBlock: string | undefined
      const progress = assigned ? 0.4 : 0

      if (inProg) {
        currentBlock = parseBlock(inProg.from) || currentBlock
        status = "lifting"
      } else if (assigned) {
        currentBlock        = parseBlock(assigned.from) || currentBlock
        destinationBlock    = parseBlock(assigned.to) || undefined
        status = "travelling"
      }

      const { x, y } = blockCenter(currentBlock, layouts)
      // Small spread so multiple units in same block don't completely overlap
      const spread = (idx % 3) * 6 - 6

      return {
        id: op.equipment, type, name: op.equipment, operatorName: op.name,
        x: x + spread, y: y + (idx % 2 === 0 ? 3 : -3),
        status, currentBlock, destinationBlock, progress,
      }
    })
}

// ── Move trails ───────────────────────────────────────────────────────────────

export interface MoveTrail {
  id:          string
  fromBlock:   string
  toBlock:     string
  fromX:       number
  fromY:       number
  toX:         number
  toY:         number
  completedAt: string
  operatorId:  string
}

export function computeMoveTrails(moves: Move[], layouts: BlockLayout[]): MoveTrail[] {
  return moves
    .filter(m => m.state === "DONE")
    .slice(-10)
    .map(m => {
      const from = parseBlock(m.from)
      const to   = parseBlock(m.to)
      const fPos = blockCenter(from, layouts)
      const tPos = blockCenter(to, layouts)
      return {
        id: m.id, fromBlock: from, toBlock: to,
        fromX: fPos.x, fromY: fPos.y,
        toX:   tPos.x, toY:   tPos.y,
        completedAt: m.end,
        operatorId:  m.operator,
      }
    })
}

// (BlockLayout interface and computeBlockLayouts moved above equipment section)

/** Compute BlockLayouts from live backend block summaries.
 *  Parses zone letter from block ID (e.g. "A" from "A-01") and uses
 *  the matching Zone definition for physical dimensions.
 */
export function computeLiveBlockLayouts(
  liveBlocks: Array<{ blk: string; occupied: number; total: number; pct: number }>,
  zones: Zone[],
): BlockLayout[] {
  const byZone = new Map<string, typeof liveBlocks>()
  for (const b of liveBlocks) {
    const zoneId = b.blk[0] ?? "?"
    if (!byZone.has(zoneId)) byZone.set(zoneId, [])
    byZone.get(zoneId)!.push(b)
  }

  const layouts: BlockLayout[] = []
  let currentY = 32

  const liveZoneOrder = (id: string) =>
    ({ C: 0, A: 1, B: 2, D: 3, E: 4, S: 5, R: 6 } as Record<string, number>)[id] ?? 99
  const sortedZoneIds = Array.from(byZone.keys()).sort(
    (a, b) => liveZoneOrder(a) - liveZoneOrder(b),
  )

  for (const zoneId of sortedZoneIds) {
    const zone = zones.find(z => z.id === zoneId)
    const slots    = zone?.slots    ?? 10
    const rows     = zone?.rows     ?? 3
    const maxTiers = zone?.maxTiers ?? 4

    const blockW = slots * SLOT_WIDTH_PX
    const blockH = rows  * ROW_HEIGHT_PX
    const blocksPerRow = Math.max(
      1,
      Math.floor((YARD_WIDTH - LANE_WIDTH_PX) / (blockW + BLOCK_MARGIN_PX)),
    )

    const zoneBlocks = byZone.get(zoneId)!
    zoneBlocks.forEach((b, idx) => {
      const rowInZone = Math.floor(idx / blocksPerRow)
      const colInRow  = idx % blocksPerRow
      const x = LANE_WIDTH_PX + colInRow * (blockW + BLOCK_MARGIN_PX)
      const y = currentY + rowInZone * (blockH + LANE_WIDTH_PX)
      const capacity = rows * slots * maxTiers

      layouts.push({
        zone: zoneId, block: idx + 1, label: b.blk,
        x, y, w: blockW, h: blockH,
        occupancyPct: b.pct, containerCount: b.occupied,
        capacity, topContainerIds: [],
        rows, slots,
      })
    })

    const rowsNeeded = Math.ceil(zoneBlocks.length / blocksPerRow)
    currentY += rowsNeeded * (blockH + LANE_WIDTH_PX) + LANE_WIDTH_PX
  }

  return layouts
}

// Extra south margin to accommodate the truck queue area below the bottom cluster.
const SOUTH_BUFFER_PX = 100   // replaces the old +40 constant

export function getYardDimensions(
  layouts: BlockLayout[],
): { width: number; height: number } {
  if (layouts.length === 0) return { width: YARD_WIDTH, height: 600 }
  const maxX = Math.max(...layouts.map(l => l.x + l.w))
  const maxY = Math.max(...layouts.map(l => l.y + l.h))
  return { width: maxX + LANE_WIDTH_PX, height: maxY + LANE_WIDTH_PX + SOUTH_BUFFER_PX }
}

// ── Layer-system geometry ─────────────────────────────────────────────────────
// These exports feed the explicit z0–z6 layer contract in PhysicalYardMap.
// All consuming code must import from here — never hardcode these values.

/** Height of the TERMINAL · BERTH SIDE strip at the top of the canvas. */
export const BERTH_HEIGHT = 34

/** Height of the GATE · TRUCK ENTRY strip at the bottom of the canvas. */
export const GATE_HEIGHT = 34

// ── CIRCULATION — complete road/aisle geometry for z0–z1 rendering ────────────
//
// Derivation (all values in canvas-space px, seed layout):
//
//  mainBoulevard   y=462   — bottom of top cluster (A row-1 bottom = 80+165+52+165 = 462)
//                  width=60 — band height ("N–S extent" of the boulevard)
//
//  bottomTransversal y=904 — bottom of middle cluster (E/B bottom = 522+165+52+165 = 904)
//                  width=40
//
//  crossRoads[0]   x=784, w=96  — E right (784) → A left (880); 96 px gap
//  crossRoads[1]   x=1988, w=40 — A/B right (1988) → D/F/Q left (2028); exact 40 px
//
//  aisles (LANE_WIDTH_PX = 52 px each):
//    C: x=50,   y=190 (80+110),    w=590  (50→640)
//    A: x=880,  y=245 (80+165),    w=1108 (880→1988)
//    D: x=2028, y=190 (80+110),    w=216  (2028→2244)
//    E: x=50,   y=687 (522+165),   w=734  (50→784)
//    B: x=880,  y=687 (522+165),   w=1108 (880→1988)
//    F: x=2028, y=632 (522+110),   w=288  (2028→2316)
//
//  truckQueue      x=50 (Zone R left), y=999 (bottom-cluster bottom = 944+55)
//                  dims.height = 999+52+100 = 1151  →  118 px for 5 bays
//
//  perimeter       inset=30 (grass strip), width=20 (service road)
//                  → grass at x=0..30, service road at x=30..50 (aligns with zone left=50)

export interface AisleSegment {
  x: number; y: number; w: number; h: number
  zoneId: string
  direction: "E" | "W"
}

export interface CrossRoadSegment {
  x: number   // left edge of the full gap (incl. shoulders)
  w: number   // total gap width
  label: string
}

export interface CirculationGeometry {
  mainBoulevard:    { y: number; width: number; label: string }
  bottomTransversal:{ y: number; width: number }
  crossRoads:       CrossRoadSegment[]
  aisles:           AisleSegment[]
  truckQueue:       { x: number; y: number; bays: number; exitLaneW: number }
  perimeter:        { inset: number; width: number }
}

export const CIRCULATION: CirculationGeometry = {
  // Primary E-W thoroughfare between top (A/C/D) and middle (E/B/F) zone clusters
  mainBoulevard: { y: 462, width: 60, label: "TERMINAL DRIVE" },

  // Secondary E-W band between middle (E/B/F) and bottom (Q/S/R) clusters
  bottomTransversal: { y: 904, width: 40 },

  // N-S cross-roads between zone columns (full canvas height, minus berth/gate)
  crossRoads: [
    { x: 784,  w: 96, label: "WEST SERVICE RD"  },  // left–centre  (E right → A left)
    { x: 1988, w: 40, label: "EAST SERVICE RD"  },  // centre–right (A/B right → D/F/Q left)
  ],

  // Working aisles between block-rows within each zone
  aisles: [
    { x: 50,   y: 190, w: 590,  h: 52, zoneId: "C", direction: "E" },
    { x: 880,  y: 245, w: 1108, h: 52, zoneId: "A", direction: "W" },
    { x: 2028, y: 190, w: 216,  h: 52, zoneId: "D", direction: "E" },
    { x: 50,   y: 687, w: 734,  h: 52, zoneId: "E", direction: "W" },
    { x: 880,  y: 687, w: 1108, h: 52, zoneId: "B", direction: "E" },
    { x: 2028, y: 632, w: 288,  h: 52, zoneId: "F", direction: "E" },
  ],

  // Truck queue below Zone R — inbound bays + parallel exit lane
  truckQueue: { x: 50, y: 999, bays: 5, exitLaneW: 40 },

  // Perimeter: grass strip at canvas edge, service road inside it
  perimeter: { inset: 30, width: 20 },
}

// ── Facility footprints (z2 — structural context, not focus) ─────────────────
// Muted #8B8B8B building outlines adjacent to roads.
// Positions are validated against ZONE_LAYOUT + panel padding so that z3 zone
// panel backgrounds do not obscure them.
//
// Safe pockets (zone panels excluded):
//   SLOT-W  x=660–780, y=85–455   right of Zone C panel (~x=656), west of WEST SERVICE RD
//   SLOT-E  x=2262–2320, y=85–455 right of Zone D panel (~x=2260), east service road shoulder
//   SLOT-S  x=160–1000, y=1012–1080  below all zone panels (bottom ≈1011), above gate

export interface Facility {
  id:      string
  label:   string   // all-caps stencil label (≤5 chars)
  icon:    string   // single glyph shown above label
  tooltip: string   // full hover description (rendered in chrome)
  x: number; y: number; w: number; h: number
}

export const FACILITIES: Facility[] = [
  // ── SLOT-W — west corridor, north of TERMINAL DRIVE ──────────────────────
  { id:"customs-insp",  label:"CUST",  icon:"⚖",  tooltip:"Customs Inspection Bay",          x:660, y:88,   w:62, h:42 },
  { id:"admin",         label:"ADMIN", icon:"▪",   tooltip:"Terminal Administration Office",  x:660, y:142,  w:72, h:44 },
  { id:"infirmary",     label:"MED",   icon:"+",   tooltip:"On-Site Medical / Infirmary",     x:660, y:198,  w:60, h:40 },
  { id:"security",      label:"SEC",   icon:"◈",   tooltip:"Security / CCTV Control Post",    x:660, y:250,  w:54, h:40 },

  // ── SLOT-E — east corridor, north of TERMINAL DRIVE ──────────────────────
  { id:"hazmat-safety", label:"HAZ",   icon:"☢",   tooltip:"Hazmat / Emergency Safety Stn",  x:2262, y:88,  w:55, h:40 },
  { id:"workshop",      label:"WRK",   icon:"⚙",   tooltip:"M&R Workshop / Maintenance Bay", x:2262, y:140, w:58, h:44 },

  // ── SLOT-S — south strip, below bottom-cluster panels, above gate ─────────
  { id:"weigh-stn",     label:"WGH",   icon:"▲",   tooltip:"Weighbridge / Weigh Station",     x:178, y:1014, w:64, h:44 },
  { id:"cfs",           label:"CFS",   icon:"□",   tooltip:"CFS / Container Freight Station", x:362, y:1012, w:84, h:55 },
  { id:"driver-rest",   label:"REST",  icon:"◉",   tooltip:"Driver Rest / Amenities Area",    x:562, y:1015, w:68, h:44 },
  { id:"fuel",          label:"FUEL",  icon:"◆",   tooltip:"Fuel & AdBlue Station",           x:748, y:1015, w:62, h:40 },
  { id:"reefer-power",  label:"REEF",  icon:"~",   tooltip:"Reefer Power Hub / PTI Bay",      x:928, y:1012, w:72, h:44 },
]

// ── Detention exposure ────────────────────────────────────────────────────────
// Re-typed locally to avoid cross-module dependency on reference-pools.ts.

export interface CarrierSched {
  code:     string
  freeDays: number
  /** [dayFrom, dayTo, usdPerDay] — inclusive range */
  tiers:    [number, number, number][]
}

export interface DetentionRow {
  containerId:  string
  zone:         string
  block:        number
  row:          number
  slot:         number
  tier:         number
  address:      string
  carrierName:  string
  carrierCode:  string
  hoursToLFD:   number    // negative = already breached
  dwellDays:    number
  dailyRateUsd: number    // applicable tier rate
  exposureUsd:  number    // accumulated (breached) or 1-day risk (at_risk)
  status:       "breached" | "at_risk"
}

function _detentionDailyRate(dwellDays: number, carrier: CarrierSched): number {
  const tier = carrier.tiers.find(([f, t]) => dwellDays >= f && dwellDays <= t)
  if (tier) return tier[2]
  const last = carrier.tiers[carrier.tiers.length - 1]
  return last ? last[2] : 50
}

/** Compute detention exposure for containers that are breached (hoursToLFD ≤ 0)
 *  or at risk within 24 h.  Returns sorted rows, total USD, and the set of
 *  contributing block labels (for map highlighting).
 */
export function computeDetentionExposure(
  containers: Array<{
    id: string; zone: string; block: number; row: number; slot: number; tier: number;
    address: string; carrier: string; carrierName: string;
    hoursToLFD: number; dwellDays: number; empty: boolean;
  }>,
  carriers: CarrierSched[],
): { rows: DetentionRow[]; totalUsd: number; blockSet: Set<string> } {
  const cMap   = new Map(carriers.map(c => [c.code, c]))
  const rows: DetentionRow[] = []
  const blockSet = new Set<string>()

  for (const c of containers) {
    if (c.empty || c.hoursToLFD > 24) continue

    const status: "breached" | "at_risk" = c.hoursToLFD <= 0 ? "breached" : "at_risk"
    const sched   = cMap.get(c.carrier)
    const freeDays = sched?.freeDays ?? 7

    let dailyRateUsd: number
    let exposureUsd: number

    if (status === "breached") {
      const daysOver = Math.max(1, c.dwellDays - freeDays)
      dailyRateUsd   = sched ? _detentionDailyRate(c.dwellDays, sched) : 50
      exposureUsd    = dailyRateUsd * daysOver
    } else {
      // at_risk: estimate 1-day charge at the first tier that activates at breach
      const firstPaidDay = freeDays + 1
      dailyRateUsd = sched ? _detentionDailyRate(firstPaidDay, sched) : 50
      exposureUsd  = dailyRateUsd   // 1-day risk
    }

    const blockLabel = `${c.zone}-${String(c.block).padStart(2, "0")}`
    blockSet.add(blockLabel)
    rows.push({
      containerId: c.id,
      zone: c.zone, block: c.block, row: c.row, slot: c.slot, tier: c.tier,
      address: c.address, carrierName: c.carrierName, carrierCode: c.carrier,
      hoursToLFD: c.hoursToLFD, dwellDays: c.dwellDays,
      dailyRateUsd, exposureUsd, status,
    })
  }

  rows.sort((a, b) => a.hoursToLFD - b.hoursToLFD)
  const totalUsd = rows.reduce((s, r) => s + r.exposureUsd, 0)
  return { rows, totalUsd, blockSet }
}

/** Count RESHUFFLE moves per source block — proxy for predicted rehandle debt.
 *  The from-address format is "A-01-r-s-t"; block label = "A-01".
 */
export function computeRehandleByBlock(
  moves: Array<{ type: string; from: string }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of moves) {
    if (m.type !== "RESHUFFLE") continue
    const parts = m.from.split("-")
    if (parts.length < 2) continue
    const label = `${parts[0]}-${String(parts[1]).padStart(2, "0")}`
    map.set(label, (map.get(label) ?? 0) + 1)
  }
  return map
}

/** Per-block count of "hot" containers (hoursToLFD ≤ 4 h, non-empty).
 *  Return value feeds the z5 pulsing badge — highest-priority signal on the map.
 *  Hot = imminent detention risk: free time expires within the current shift.
 */
export function computeHotByBlock(
  containers: Array<{ zone: string; block: number; empty: boolean; hoursToLFD: number }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of containers) {
    if (!c.empty && c.hoursToLFD <= 4) {
      const label = `${c.zone}-${String(c.block).padStart(2, "0")}`
      map.set(label, (map.get(label) ?? 0) + 1)
    }
  }
  return map
}
