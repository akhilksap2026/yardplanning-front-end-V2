import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import { YT } from "@/lib/yard-tokens"
import type { BlockLayout, EquipmentPosition, MoveTrail, Facility } from "@/lib/yard-layout"
import {
  getYardDimensions,
  BERTH_HEIGHT, GATE_HEIGHT,
  CIRCULATION, FACILITIES,
} from "@/lib/yard-layout"
import BlockTooltip from "./BlockTooltip"

interface Props {
  layouts:            BlockLayout[]
  selectedBlock:      string | null
  onSelectBlock:      (label: string) => void
  zoneNames?:         Record<string, string>
  children?:          React.ReactNode
  equipment?:         EquipmentPosition[]
  showEquipment?:     boolean
  moveTrails?:        MoveTrail[]
  showTrails?:        boolean
  congestionByBlock?: Map<string, number>
  showCongestion?:    boolean
  activeMoveBlocks?:  Set<string>
  // Phase 2 — hot container signals
  hotByBlock?:        Map<string, number>
  onHotBadgeClick?:  (blockLabel: string) => void
  // Phase 2.3 — detention exposure highlight (hover-triggered from KPI panel)
  highlightBlocks?:   Set<string>
  // Phase 2.4 — rehandle debt glyph
  rehandleByBlock?:   Map<string, number>
  // Phase 3.3 / 3.4 — story mode commanded view (seq-gated animated pan/zoom)
  commandedView?:     { cx: number; cy: number; zoom: number; seq: number } | null
  // Phase 3.5 — fit-view trigger: fitView fires when this counter increments
  fitViewSeq?:        number
  // Phase 3.6 — colorblind-safe mode: renders shape glyph on blocks alongside color
  cbMode?:            boolean
  worstLfdByBlock?:   Map<string, "breached" | "risk24" | "risk72">
}

// ── Zone visual identity ──────────────────────────────────────────────────────
//
// Fill derivation — all fills are "painted concrete," not colored paper.
// Method: mix(concrete #D5D0C8 = rgb(213,208,200), zone_identity_hue) at:
//   bg        → 85 % concrete + 15 % hue  (zone container panel)
//   blockBg   → 80 % concrete + 20 % hue  (individual block cell)
//   border/blockBorder → 70 % concrete + 30 % hue  (edge definition)
// headerBg / headerText are identity anchors — never muted.

const ZONE_PANEL: Record<string, {
  bg: string; border: string; headerBg: string; headerText: string; blockBg: string; blockBorder: string
}> = {
  // A — cool grey-blue: dusty blue-grey, reads concrete with a cool cast
  // border/blockBorder: 55% concrete + 45% hue — carries zone hue at 1px without glowing
  A: { bg: "#C9CDCF", border: "#93AFDC", headerBg: "#1e40af", headerText: "#fff", blockBg: "#C9CDCF", blockBorder: "#93AFDC" },
  // B — sage-grey: muted sage, sits with the grass strips
  B: { bg: "#C7CEC4", border: "#8DBE93", headerBg: "#15803d", headerText: "#fff", blockBg: "#C7CEC4", blockBorder: "#8DBE93" },
  // C — mauve-grey: faint warm-grey with a violet whisper
  C: { bg: "#CDC9CF", border: "#B789D7", headerBg: "#6d28d9", headerText: "#fff", blockBg: "#CDC9CF", blockBorder: "#B789D7" },
  // D — sand-grey: hazard identity comes from the chevron frame; border hints orange
  D: { bg: "#D2C9BE", border: "#DE9A73", headerBg: "#c2410c", headerText: "#fff", blockBg: "#D2C9BE", blockBorder: "#DE9A73" },
  // E — pale sage-grey: slightly lighter than B so the two greens still separate
  E: { bg: "#CBCFC8", border: "#A2C483", headerBg: "#4d7c0f", headerText: "#fff", blockBg: "#CBCFC8", blockBorder: "#A2C483" },
  // F — straw-grey: dusty straw; the ⚡ glyph carries reefer identity
  F: { bg: "#D0CEC2", border: "#D7A871", headerBg: "#b45309", headerText: "#fff", blockBg: "#D0CEC2", blockBorder: "#D7A871" },
  // S — khaki-grey: most-toned-down; staging was screaming loudest
  S: { bg: "#CFCBBB", border: "#D0C277", headerBg: "#92400e", headerText: "#fff", blockBg: "#CFCBBB", blockBorder: "#D0C277" },
  // R — plain concrete: near-neutral, just barely cool
  R: { bg: "#CBCCCE", border: "#95999D", headerBg: "#475569", headerText: "#fff", blockBg: "#CBCCCE", blockBorder: "#95999D" },
  // Q — cool sage-grey: quiet; the HOLD tag carries the meaning
  Q: { bg: "#C6CECC", border: "#7EC3B6", headerBg: "#065f46", headerText: "#fff", blockBg: "#C6CECC", blockBorder: "#7EC3B6" },
}

const ZONE_SUBTITLES: Record<string, string> = {
  A: "Dry / general (loaded) · Zone A", B: "Dry / general (loaded) · Zone B", C: "Customs hold",
  D: "Hazmat / IMDG", E: "Empty depot", S: "Staging (drop & hook)", R: "Gate-in / receiving",
  F: "Reefer / food-grade", Q: "Quarantine / M&R",
}

// Compact signpost labels — shown on the rotated badge at each zone's top-left.
// Single-line, max ~12 chars so the badge stays narrow.
const ZONE_SHORT: Record<string, string> = {
  A: "DRY / GEN",  B: "DRY / GEN",  C: "CUSTOMS",
  D: "HAZMAT ⚠",  E: "EMPTIES",    F: "REEFER ⚡",
  Q: "QUARANTINE", R: "RECEIVING",  S: "STAGING",
}

const EQ_STATUS_COLOR: Record<string, string> = {
  idle: "#16a34a", moving: "#f59e0b", lifting: "#dc2626", travelling: "#3b82f6",
}

const MINIMAP_W    = 148
const MINIMAP_H    = 108
const PANEL_PAD_X  = 16
const PANEL_PAD_TOP = 36
const PANEL_PAD_BOT = 12

// ── Surface palette ────────────────────────────────────────────────────────────
const CONCRETE = "#D5D0C8"
const ASPHALT  = "#4A4A4A"
const GRASS    = "#6B8F5E"

const DASH_YELLOW  = "rgba(245,197,24,0.28)"
const EDGE_WHITE   = "rgba(255,255,255,0.17)"

// ── Label contrast tokens (WCAG AA) ───────────────────────────────────────────
const SURFACE_TEXT = "rgba(255,255,255,0.55)"
const BERTH_TEXT   = "rgba(255,255,255,0.87)"
const GATE_TEXT    = "rgba(255,255,255,0.87)"

// Physical scale: 1 slot = 36 px = 6.1 m (20-ft container bay)
const PX_PER_M = 36 / 6.1

// ── Progressive-disclosure zoom thresholds ─────────────────────────────────
// Overview  < 0.4 : zone fills + zone-level signals only (exec bird's-eye)
// Working 0.4–0.8 : block labels, occupancy bars, signals; no IDs
// Detail    ≥ 0.8 : slot grid, rehandle glyphs, container IDs
const OVERVIEW_SCALE = 0.4
const DETAIL_SCALE   = 0.8

/** Fire-suppression sprinkler head — 12 × 12 px red cross-circle.
 *  Placed in the four corners of the Zone D (IMDG) panel at z3. */
function FireSuppressionMarker({ style }: { style?: React.CSSProperties }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={style} aria-hidden="true">
      <circle cx="6" cy="6" r="5.2" fill="#b91c1c" stroke="#7f1d1d" strokeWidth="0.8"/>
      <line x1="6" y1="2" x2="6" y2="10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="2" y1="6" x2="10" y2="6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}

// ── Road-routing helpers — Phase 3.3 ─────────────────────────────────────────

/** Build a round-cornered polyline path string from an ordered waypoint list */
function buildRoundedPath(pts: [number, number][], r: number): string {
  if (pts.length < 2) return ""
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], curr = pts[i], next = pts[i + 1]
    if (!next) { d += ` L ${curr[0].toFixed(1)} ${curr[1].toFixed(1)}`; continue }
    const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1]
    const len1 = Math.hypot(dx1, dy1)
    const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1]
    const len2 = Math.hypot(dx2, dy2)
    const cr = Math.min(r, len1 / 2, len2 / 2)
    if (cr < 2) { d += ` L ${curr[0].toFixed(1)} ${curr[1].toFixed(1)}`; continue }
    const a1x = curr[0] - (dx1 / len1) * cr, a1y = curr[1] - (dy1 / len1) * cr
    const a2x = curr[0] + (dx2 / len2) * cr, a2y = curr[1] + (dy2 / len2) * cr
    d += ` L ${a1x.toFixed(1)} ${a1y.toFixed(1)} Q ${curr[0].toFixed(1)} ${curr[1].toFixed(1)} ${a2x.toFixed(1)} ${a2y.toFixed(1)}`
  }
  return d
}

/** Route a move from (fromX,fromY) to (toX,toY) through the yard road network.
 *  Strategy: exit to nearest N-S service road → travel to nearest E-W boulevard → arrive. */
function routeViaRoads(fromX: number, fromY: number, toX: number, toY: number): string {
  const crCenters = CIRCULATION.crossRoads.map(cr => cr.x + cr.w / 2)
  const nearFrom  = crCenters.reduce((b, cx) => Math.abs(cx - fromX) < Math.abs(b - fromX) ? cx : b, crCenters[0])
  const nearTo    = crCenters.reduce((b, cx) => Math.abs(cx - toX)   < Math.abs(b - toX)   ? cx : b, crCenters[0])
  const mbY  = CIRCULATION.mainBoulevard.y    + CIRCULATION.mainBoulevard.width    / 2
  const btY  = CIRCULATION.bottomTransversal.y + CIRCULATION.bottomTransversal.width / 2
  const midY = (fromY + toY) / 2
  const horizY = Math.abs(midY - mbY) < Math.abs(midY - btY) ? mbY : btY
  const raw: [number, number][] = [
    [fromX, fromY], [nearFrom, fromY], [nearFrom, horizY],
    [nearTo, horizY], [nearTo, toY],   [toX, toY],
  ]
  const pts: [number, number][] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const p = raw[i], q = pts[pts.length - 1]
    if (Math.abs(p[0] - q[0]) > 2 || Math.abs(p[1] - q[1]) > 2) pts.push(p)
  }
  return buildRoundedPath(pts, 26)
}

export default function PhysicalYardMap({
  layouts, selectedBlock, onSelectBlock, zoneNames = {}, children,
  equipment = [], showEquipment = false,
  moveTrails = [], showTrails = false,
  congestionByBlock, showCongestion = false,
  activeMoveBlocks,
  hotByBlock, onHotBadgeClick, cbMode, worstLfdByBlock,
  highlightBlocks,
  rehandleByBlock,
  commandedView, fitViewSeq,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const dragging      = useRef(false)
  const didDrag       = useRef(false)
  const lastPos       = useRef({ x: 0, y: 0 })

  const [tf,               setTf]              = useState({ x: 16, y: 16, scale: 1 })
  const [hoveredLayout,    setHoveredLayout]   = useState<BlockLayout | null>(null)
  const [tooltipPos,       setTooltipPos]      = useState<{ x: number; y: number } | null>(null)
  const [hoveredEquip,     setHoveredEquip]    = useState<EquipmentPosition | null>(null)
  const [equipTooltipPos,  setEquipTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [hoveredFacility,  setHoveredFacility] = useState<Facility | null>(null)
  const [facTooltipPos,    setFacTooltipPos]   = useState<{ x: number; y: number } | null>(null)

  const dims = getYardDimensions(layouts)

  // Zoom-tier booleans — drive every progressive-disclosure gate below
  const isOverview = tf.scale < OVERVIEW_SCALE
  const isDetail   = tf.scale >= DETAIL_SCALE

  // ── Zone bounding boxes ────────────────────────────────────────────────────
  const zoneBounds = useMemo(() => {
    const map = new Map<string, { x1: number; y1: number; x2: number; y2: number }>()
    for (const l of layouts) {
      const p = map.get(l.zone)
      if (!p) { map.set(l.zone, { x1: l.x, y1: l.y, x2: l.x + l.w, y2: l.y + l.h }); continue }
      map.set(l.zone, {
        x1: Math.min(p.x1, l.x), y1: Math.min(p.y1, l.y),
        x2: Math.max(p.x2, l.x + l.w), y2: Math.max(p.y2, l.y + l.h),
      })
    }
    return map
  }, [layouts])

  // Average occupancy per zone — drives the overview fill height
  const zoneAvgOcc = useMemo(() => {
    const acc = new Map<string, { sum: number; n: number }>()
    for (const l of layouts) {
      const e = acc.get(l.zone) ?? { sum: 0, n: 0 }
      e.sum += l.occupancyPct; e.n += 1
      acc.set(l.zone, e)
    }
    const out = new Map<string, number>()
    for (const [z, { sum, n }] of acc) out.set(z, n > 0 ? Math.round(sum / n) : 0)
    return out
  }, [layouts])

  // Zones that contain ≥ 1 hot block — zone-level ⏱ indicator in overview
  // zoneHotCount: total hot containers per zone (drives the count badge at overview)
  const [zoneHasHot, zoneHotCount] = useMemo(() => {
    const set = new Set<string>()
    const cnt = new Map<string, number>()
    if (!hotByBlock) return [set, cnt] as const
    for (const [label, count] of hotByBlock) {
      if (count > 0) {
        const l = layouts.find(x => x.label === label)
        if (l) {
          set.add(l.zone)
          cnt.set(l.zone, (cnt.get(l.zone) ?? 0) + count)
        }
      }
    }
    return [set, cnt] as const
  }, [hotByBlock, layouts])

  // Empty zones — "No containers" overlay in working/detail tier
  const emptyZones = useMemo(() => {
    const totals = new Map<string, number>()
    for (const l of layouts) totals.set(l.zone, (totals.get(l.zone) ?? 0) + l.containerCount)
    return new Set([...totals.entries()].filter(([, n]) => n === 0).map(([z]) => z))
  }, [layouts])

  // Reduced-motion preference — disables animated trail dots
  const prefersReducedMotion = useMemo(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, [])

  // Smooth pan/zoom animation state — activated by commandedView changes
  const [animating,   setAnimating] = useState(false)
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fit to view ────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!containerRef.current || layouts.length === 0) return
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect()
    const scale = Math.min((cw - 32) / dims.width, (ch - 32) / dims.height, 1)
    setTf({ x: 16, y: 16, scale })
  }, [dims.width, dims.height, layouts.length])

  useEffect(() => { fitView() }, [layouts.length]) // eslint-disable-line

  // ── Commanded view — story mode sends pan/zoom targets ────────────────────
  useEffect(() => {
    if (!commandedView || !containerRef.current) return
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect()
    const { cx, cy, zoom: s } = commandedView
    setAnimating(true)
    setTf({ x: cw / 2 - cx * s, y: ch / 2 - cy * s, scale: s })
    if (animTimerRef.current) clearTimeout(animTimerRef.current)
    animTimerRef.current = setTimeout(() => setAnimating(false), 850)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandedView?.seq])

  // ── Fit-view trigger — keyboard F shortcut increments from parent ─────────
  useEffect(() => {
    if (!fitViewSeq) return
    fitView()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitViewSeq])

  // ── Zoom at a point ────────────────────────────────────────────────────────
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setTf(t => {
      const newScale = Math.max(0.10, Math.min(5, t.scale * factor))
      const actual   = newScale / t.scale
      return { scale: newScale, x: cx - (cx - t.x) * actual, y: cy - (cy - t.y) * actual }
    })
  }, [])

  // ── Wheel zoom ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.pow(0.999, e.deltaY))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  // ── Drag to pan ────────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true; didDrag.current = false
    lastPos.current  = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    if (Math.abs(dx) + Math.abs(dy) > 2) didDrag.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTf(t => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }
  const onMouseUp = () => { dragging.current = false }

  // ── Block tooltip ──────────────────────────────────────────────────────────
  function handleBlockEnter(layout: BlockLayout, e: React.MouseEvent) {
    setHoveredLayout(layout)
    const rect = containerRef.current!.getBoundingClientRect()
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  function handleBlockMove(layout: BlockLayout, e: React.MouseEvent) {
    if (hoveredLayout?.label !== layout.label) return
    const rect = containerRef.current!.getBoundingClientRect()
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  function handleBlockLeave() { setHoveredLayout(null); setTooltipPos(null) }

  // ── Equipment tooltip ──────────────────────────────────────────────────────
  function handleEquipEnter(eq: EquipmentPosition, e: React.MouseEvent) {
    e.stopPropagation()
    setHoveredEquip(eq)
    const rect = containerRef.current!.getBoundingClientRect()
    setEquipTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 4 })
  }
  function handleEquipLeave(e: React.MouseEvent) {
    e.stopPropagation(); setHoveredEquip(null); setEquipTooltipPos(null)
  }

  // ── Derived geometry ───────────────────────────────────────────────────────
  const bollardCount = Math.max(0, Math.floor(dims.width / 120))
  const { x: tqX, y: tqY, bays, exitLaneW } = CIRCULATION.truckQueue
  const tqH  = Math.max(0, dims.height - GATE_HEIGHT - tqY)
  const bayH = tqH > 0 ? tqH / bays : 0

  const gateExitW  = Math.round(dims.width * 0.32)
  const gateMedian = 12
  const gateEntryX = gateExitW + gateMedian

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={{
        flex: 1, minHeight: 0,
        background: CONCRETE,
        cursor: dragging.current ? "grabbing" : "grab",
        touchAction: "none", userSelect: "none",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { onMouseUp(); handleBlockLeave(); setHoveredEquip(null) }}
    >

      {/* ════════════════════════════════════════════════════════════════════
          ZOOMABLE CANVAS  ·  layers z0–z5 share this CSS transform
      ════════════════════════════════════════════════════════════════════ */}
      <div
        className="absolute"
        style={{
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
          transformOrigin: "0 0",
          width: dims.width, height: dims.height,
          transition: animating ? "transform 750ms cubic-bezier(0.4,0,0.2,1)" : undefined,
        }}
      >

        {/* ── z0 · Ground ───────────────────────────────────────────────────
            #D5D0C8 concrete + feTurbulence noise + grass perimeter strips.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 0 }}>
          <div className="absolute inset-0" style={{ background: CONCRETE }} />
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: dims.width, height: dims.height, opacity: 0.07, mixBlendMode: "multiply" }}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <filter id="phy-yard-noise" x="0%" y="0%" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch" result="n"/>
                <feColorMatrix type="saturate" values="0" in="n"/>
              </filter>
            </defs>
            <rect width={dims.width} height={dims.height} filter="url(#phy-yard-noise)" fill="#555"/>
          </svg>
          <div className="absolute" style={{ left: 0, top: BERTH_HEIGHT, width: CIRCULATION.perimeter.inset, height: dims.height - BERTH_HEIGHT - GATE_HEIGHT, background: GRASS }} />
          <div className="absolute" style={{ right: 0, top: BERTH_HEIGHT, width: CIRCULATION.perimeter.inset, height: dims.height - BERTH_HEIGHT - GATE_HEIGHT, background: GRASS }} />
        </div>

        {/* ── z1 · Circulation + Structures ─────────────────────────────────
            Service roads → transversals → cross-roads → aisles
            → truck queue → berth → gate → perimeter fence + cameras.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 1, pointerEvents: "none" }}>

          {/* Perimeter service roads */}
          <div className="absolute" style={{ left: CIRCULATION.perimeter.inset, top: 0, bottom: 0, width: CIRCULATION.perimeter.width, background: ASPHALT }} />
          <div className="absolute" style={{ right: CIRCULATION.perimeter.inset, top: 0, bottom: 0, width: CIRCULATION.perimeter.width, background: ASPHALT }} />

          {/* Bottom transversal */}
          <div className="absolute left-0 right-0" style={{ top: CIRCULATION.bottomTransversal.y, height: CIRCULATION.bottomTransversal.width, background: ASPHALT }}>
            <div className="absolute top-0 left-0 right-0" style={{ height: 1, background: EDGE_WHITE }} />
            <div className="absolute bottom-0 left-0 right-0" style={{ height: 1, background: EDGE_WHITE }} />
            <div className="absolute" style={{ top: CIRCULATION.bottomTransversal.width / 2 - 1, left: 0, right: 0, height: 2, backgroundImage: `repeating-linear-gradient(90deg, ${DASH_YELLOW} 0 16px, transparent 16px 30px)` }} />
          </div>

          {/* Main boulevard */}
          <div className="absolute left-0 right-0" style={{ top: CIRCULATION.mainBoulevard.y, height: CIRCULATION.mainBoulevard.width, background: ASPHALT }}>
            <div className="absolute top-0 left-0 right-0" style={{ height: 1, background: EDGE_WHITE }} />
            <div className="absolute bottom-0 left-0 right-0" style={{ height: 1, background: EDGE_WHITE }} />
            <div className="absolute" style={{ top: CIRCULATION.mainBoulevard.width / 2 - 1, left: 0, right: 0, height: 2, backgroundImage: `repeating-linear-gradient(90deg, ${DASH_YELLOW} 0 20px, transparent 20px 36px)` }} />
            <div className="absolute font-mono pointer-events-none" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: 9, color: SURFACE_TEXT, letterSpacing: "0.38em", whiteSpace: "nowrap" }}>
              {CIRCULATION.mainBoulevard.label}
            </div>
          </div>

          {/* N–S cross-roads */}
          {CIRCULATION.crossRoads.map((cr, i) => (
            <div key={`cr-${i}`} className="absolute" style={{ left: cr.x, width: cr.w, top: BERTH_HEIGHT, bottom: GATE_HEIGHT, background: ASPHALT }}>
              <div className="absolute top-0 bottom-0 left-0" style={{ width: 1, background: EDGE_WHITE }} />
              <div className="absolute top-0 bottom-0 right-0" style={{ width: 1, background: EDGE_WHITE }} />
              <div className="absolute top-0 bottom-0" style={{ left: Math.round(cr.w / 2) - 1, width: 2, backgroundImage: `repeating-linear-gradient(0deg, ${DASH_YELLOW} 0 14px, transparent 14px 28px)` }} />
            </div>
          ))}

          {/* Zone working aisles */}
          {CIRCULATION.aisles.map((aisle, i) => (
            <div key={`aisle-${i}`} className="absolute" style={{ left: aisle.x, top: aisle.y, width: aisle.w, height: aisle.h, background: ASPHALT, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 14px)" }}>
              <div className="absolute top-0 left-0 right-0" style={{ height: 1, background: EDGE_WHITE }} />
              <div className="absolute bottom-0 left-0 right-0" style={{ height: 1, background: EDGE_WHITE }} />
              <DirectionalArrow direction={aisle.direction} width={aisle.w} height={aisle.h} />
              <span className="absolute font-mono" style={{ right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 8, color: SURFACE_TEXT, letterSpacing: "0.18em" }}>
                {aisle.zoneId}
              </span>
            </div>
          ))}

          {/* Truck queue */}
          {tqH > 10 && (
            <>
              <div className="absolute" style={{ left: tqX, top: tqY, width: exitLaneW, height: tqH, background: ASPHALT }}>
                {Array.from({ length: bays }, (_, i) => (
                  <div key={i} className="absolute flex items-center justify-center font-mono" style={{ left: 0, width: "100%", top: (bays - 1 - i) * bayH, height: bayH, borderBottom: i < bays - 1 ? `1px dashed ${EDGE_WHITE}` : "none", fontSize: 9, color: SURFACE_TEXT }}>
                    {i + 1}
                  </div>
                ))}
                <span className="absolute font-mono" style={{ bottom: 3, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: SURFACE_TEXT, letterSpacing: "0.14em" }}>IN</span>
              </div>
              <div className="absolute flex items-center justify-center font-mono" style={{ left: tqX + exitLaneW + 4, top: tqY, width: exitLaneW, height: tqH, background: ASPHALT, fontSize: 8, color: SURFACE_TEXT, letterSpacing: "0.15em", writingMode: "vertical-rl" as React.CSSProperties["writingMode"] }}>
                EXIT
              </div>
            </>
          )}

          {/* Berth / water basin */}
          <div className="absolute left-0 right-0" style={{ top: 0, height: 60, background: "linear-gradient(to bottom, #3B6E8F 0%, #4788AB 50%, #5A9EC4 100%)" }} />
          <div className="absolute left-0 right-0" style={{ top: 50, height: 10, background: "#2C2C2C", boxShadow: "0 3px 8px rgba(0,0,0,0.50)" }} />
          <div className="absolute left-0 right-0" style={{ top: 51, height: 2.5, background: "linear-gradient(to bottom, #C8C8C8, #A0A0A0)", opacity: 0.85 }} />
          <div className="absolute left-0 right-0" style={{ top: 56, height: 2.5, background: "linear-gradient(to bottom, #C8C8C8, #A0A0A0)", opacity: 0.85 }} />
          {Array.from({ length: bollardCount }, (_, i) => (
            <div key={`bollard-${i}`} className="absolute" style={{ top: 46, left: i * 120 + 58, width: 8, height: 8, background: "#f59e0b", borderRadius: "50%", border: "1.5px solid #92400e" }} />
          ))}
          <div className="absolute left-0 right-0 flex items-center justify-center font-black tracking-widest" style={{ top: 0, height: 50, fontSize: 11, letterSpacing: "0.2em", color: BERTH_TEXT }}>
            BERTH SIDE — QUAY WALL
          </div>

          {/* Gate */}
          <div className="absolute left-0 right-0" style={{ bottom: 0, height: GATE_HEIGHT }}>
            <div className="absolute" style={{ left: 0, top: 0, width: gateExitW, height: GATE_HEIGHT, background: "#3B1C1C" }}>
              <div className="absolute" style={{ top: 3, left: 0, right: 10, height: 4, background: "repeating-linear-gradient(90deg, #f59e0b 0 10px, #111 10px 18px)", borderRadius: 2 }} />
              <div className="absolute" style={{ top: 1, right: 5, width: 5, height: 13, background: "#6b7280", borderRadius: 2 }} />
              <div className="absolute flex items-center gap-1.5 font-black" style={{ bottom: 5, left: 10, fontSize: 13, color: GATE_TEXT, letterSpacing: "0.06em" }}>
                <span style={{ fontSize: 16 }}>←</span><span>OUT</span>
              </div>
            </div>
            <div className="absolute" style={{ left: gateExitW, top: 0, width: gateMedian, height: GATE_HEIGHT, background: "#555" }} />
            <div className="absolute" style={{ left: gateEntryX, top: 0, right: 0, height: GATE_HEIGHT, background: "#1C3B1C" }}>
              <div className="absolute" style={{ top: 1, left: 5, width: 5, height: 13, background: "#6b7280", borderRadius: 2 }} />
              <div className="absolute" style={{ top: 3, left: 10, right: 0, height: 4, background: "repeating-linear-gradient(90deg, #f59e0b 0 10px, #111 10px 18px)", borderRadius: 2 }} />
              <div className="absolute flex items-center gap-1.5 font-black" style={{ bottom: 5, right: 10, fontSize: 13, color: GATE_TEXT, letterSpacing: "0.06em" }}>
                <span>IN</span><span style={{ fontSize: 16 }}>→</span>
              </div>
            </div>
          </div>

          {/* Perimeter fence + CCTV */}
          <div className="absolute inset-0" style={{ border: "2px dashed #8B8B8B", pointerEvents: "none" }} />
          <CameraIcon style={{ position: "absolute", top: 2,                left: 2 }} />
          <CameraIcon style={{ position: "absolute", top: 2,                left: dims.width - 16 }} />
          <CameraIcon style={{ position: "absolute", top: dims.height - 13, left: 2 }} />
          <CameraIcon style={{ position: "absolute", top: dims.height - 13, left: dims.width - 16 }} />
          <CameraIcon style={{ position: "absolute", top: dims.height - GATE_HEIGHT - 14, left: Math.round(dims.width / 2) - 7 }} />
        </div>

        {/* ── z2 · Facilities ─────────────────────────────────────────────────
            11 muted #8B8B8B building footprints — hover-informational only.
            z2 > z1 (visible on road surface); z2 < z3 (zone panels above).
            Positions validated to be outside all zone panel bounding boxes.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 2 }}>
          {FACILITIES.map(f => (
            <div
              key={f.id}
              className="absolute"
              style={{ left: f.x, top: f.y, width: f.w, height: f.h, background: "#8B8B8B", boxShadow: "3px 3px 6px rgba(0,0,0,0.15)", borderRadius: 2, cursor: "default", pointerEvents: "auto" }}
              onMouseEnter={e => {
                setHoveredFacility(f)
                const rect = containerRef.current!.getBoundingClientRect()
                setFacTooltipPos({ x: e.clientX - rect.left + 10, y: e.clientY - rect.top - 36 })
              }}
              onMouseMove={e => {
                const rect = containerRef.current!.getBoundingClientRect()
                setFacTooltipPos({ x: e.clientX - rect.left + 10, y: e.clientY - rect.top - 36 })
              }}
              onMouseLeave={() => { setHoveredFacility(null); setFacTooltipPos(null) }}
            >
              <div className="absolute pointer-events-none" style={{ top: 3, left: 4, fontSize: 10, lineHeight: 1, color: "rgba(255,255,255,0.78)" }}>{f.icon}</div>
              <div className="absolute pointer-events-none font-mono font-black" style={{ bottom: 3, left: 3, right: 3, fontSize: 7, color: "rgba(255,255,255,0.82)", letterSpacing: "0.14em", whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}>{f.label}</div>
            </div>
          ))}
        </div>

        {/* ── z3 · Zone panel backgrounds + headers ─────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 3, pointerEvents: "none" }}>
          {Array.from(zoneBounds.entries()).map(([zoneId, b]) => {
            const panel = ZONE_PANEL[zoneId]
            if (!panel) return null
            const px = b.x1 - PANEL_PAD_X
            const py = b.y1 - PANEL_PAD_TOP
            const pw = (b.x2 - b.x1) + PANEL_PAD_X * 2
            const ph = (b.y2 - b.y1) + PANEL_PAD_TOP + PANEL_PAD_BOT
            const name = zoneNames[zoneId]?.split(" — ")[0] ?? `Zone ${zoneId}`
            const sub  = ZONE_SUBTITLES[zoneId] ?? ""
            // Overview fill — zone avg occupancy → fill height inside panel content area
            const zonePct     = zoneAvgOcc.get(zoneId) ?? 0
            const ovFillH     = Math.round((ph - PANEL_PAD_TOP - PANEL_PAD_BOT) * Math.min(zonePct, 100) / 100)
            const ovFillColor = zonePct > 85 ? "rgba(220,38,38,0.18)" : zonePct > 65 ? "rgba(245,158,11,0.14)" : "rgba(99,102,241,0.09)"
            return (
              <div key={`panel-${zoneId}`} className="absolute" style={{
                left: px, top: py, width: pw, height: ph,
                background: panel.bg,
                // Zone Q uses a dashed frame — communicates restricted/hold status
                border: zoneId === "Q"
                  ? `2px dashed ${panel.border}`
                  : `1.5px solid ${panel.border}`,
                borderRadius: 8,
                // 3 px identity spine — painted-curb top stripe in full identity hue.
                // inset boxShadow follows border-radius automatically; no overflow:hidden needed.
                // Zone D skipped — chevron frame already carries its hazard identity.
                boxShadow: (!isOverview && zoneId !== "D")
                  ? `inset 0 3px 0 0 ${panel.headerBg}`
                  : undefined,
              }}>

                {/* ── OVERVIEW tier: zone identity + occupancy fill + hot indicator ────
                    At tf.scale < 0.4 the panel is too small for per-block detail.
                    Show a zone letter, a fill proportional to avg occupancy, and a
                    ⏱ dot if any block in the zone has hot containers.
                ────────────────────────────────────────────────────────────────── */}
                {isOverview && (<>
                  {/* Zone letter — legible at bird's-eye view */}
                  <div className="absolute font-mono font-black pointer-events-none"
                    style={{ left: 8, top: 8, fontSize: 13, lineHeight: 1, color: panel.headerBg, opacity: 0.92, letterSpacing: "0.06em" }}>
                    {zoneId}
                  </div>
                  {/* Occupancy fill — rises from panel bottom proportional to zone avg */}
                  {ovFillH > 0 && (
                    <div className="absolute pointer-events-none" style={{
                      left: PANEL_PAD_X + 2, right: PANEL_PAD_X + 2,
                      bottom: PANEL_PAD_BOT + 2, height: ovFillH,
                      background: ovFillColor, borderRadius: 3,
                    }}/>
                  )}
                  {/* Zone-level hot dot — replaces per-block ⏱ badges at overview.
                      Shows container count so exec can read severity without zooming in. */}
                  {zoneHasHot.has(zoneId) && (
                    <div className="yard-hot-badge absolute flex items-center gap-0.5 font-black pointer-events-none"
                      style={{ top: 6, right: 6, background: YT.signalBreach, color: "white",
                        fontSize: 8, padding: "2px 5px", borderRadius: 6, lineHeight: 1 }}>
                      <span>⏱</span>
                      <span>{zoneHotCount.get(zoneId) ?? ""}</span>
                    </div>
                  )}
                </>)}

                {/* ── Signpost badge — compact rotated placard at top-left ─────────────
                    Hidden at overview zoom (too small); replaced by zone identity above.
                    Zone identity colour preserved on the badge background.
                    Slight CCW rotation (-2.5°) gives a physical "sign" feel.
                ────────────────────────────────────────────────────────────────── */}
                {!isOverview && (
                <div className="absolute flex items-center gap-2 pointer-events-none" style={{
                  top: 10, left: 14,
                  padding: "4px 11px 4px 8px",
                  background: panel.headerBg,
                  color: panel.headerText,
                  borderRadius: 4,
                  boxShadow: "1px 2px 8px rgba(0,0,0,0.28)",
                  transform: "rotate(-2.5deg)",
                  transformOrigin: "left bottom",
                  whiteSpace: "nowrap",
                  maxWidth: pw - 28,
                }}>
                  <span className="font-mono font-black" style={{ fontSize: 20, lineHeight: 1, letterSpacing: "0.04em" }}>{zoneId}</span>
                  <span className="font-semibold" style={{ fontSize: 10, opacity: 0.88, lineHeight: 1, letterSpacing: "0.09em" }}>
                    {ZONE_SHORT[zoneId] ?? name}
                  </span>
                  {zoneId === "Q" && (
                    <span className="font-black" style={{ fontSize: 8, letterSpacing: "0.20em", background: "rgba(255,255,255,0.22)", padding: "1px 5px", borderRadius: 2, border: "1px solid rgba(255,255,255,0.40)", marginLeft: 4 }}>
                      HOLD
                    </span>
                  )}
                </div>
                )}

                {/* ── Zone D · IMDG hazard frame + fire-suppression corner markers ────────
                    Chevron frame: thin 5 px stripe-only frame using CSS mask exclusion.
                    Contract: frame is NOT a fill — block bg colours show through fully.
                ─────────────────────────────────────────────────────────────────────── */}
                {zoneId === "D" && (<>
                  {/* Chevron frame always visible — structural IMDG segregation marker */}
                  <div className="absolute pointer-events-none" style={{
                    inset: 0, borderRadius: 7, padding: 5,
                    background: "repeating-linear-gradient(45deg,#FFD700 0 5px,#111 5px 10px)",
                    WebkitMask: "linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                  } as React.CSSProperties}/>
                  {/* Fire-suppression icons — working + detail only (too small at overview) */}
                  {!isOverview && (<>
                    <FireSuppressionMarker style={{ position:"absolute", top:  6, left:  6 }}/>
                    <FireSuppressionMarker style={{ position:"absolute", top:  6, right: 6 }}/>
                    <FireSuppressionMarker style={{ position:"absolute", bottom:6, left:  6 }}/>
                    <FireSuppressionMarker style={{ position:"absolute", bottom:6, right: 6 }}/>
                  </>)}
                </>)}

                {/* ── Zone F · Reefer power rail ────────────────────────────────────────
                    One ⚡ plug icon per slot column across the zone width.
                    Strip sits just below the header at the top of the block area.
                ─────────────────────────────────────────────────────────────────────── */}
                {/* Reefer power rail — working + detail only; glyphs are illegible at overview */}
                {zoneId === "F" && !isOverview && (
                  <div className="absolute left-0 right-0 flex items-center overflow-hidden pointer-events-none"
                    style={{ top: PANEL_PAD_TOP, height: 15, background: "rgba(14,165,233,0.09)", borderBottom: "1px solid rgba(14,165,233,0.22)" }}>
                    {Array.from({ length: Math.ceil(pw / 36) }, (_, i) => (
                      <span key={i} style={{ fontSize: 9, width: 36, textAlign: "center", color: "#0284c7", flexShrink: 0 }}>⚡</span>
                    ))}
                  </div>
                )}

                {/* ── Empty zone state — working + detail only ─────────────────────
                    Shown when a zone has zero containers across all its blocks.
                    Interface voice: specific, not generic ("No containers in this
                    zone yet" not "Empty" or a blank box).
                ───────────────────────────────────────────────────────────────── */}
                {!isOverview && emptyZones.has(zoneId) && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{ paddingTop: PANEL_PAD_TOP + 10 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, opacity: 0.18, lineHeight: 1 }}>□</div>
                      <div style={{ marginTop: 5, fontSize: 9.5, fontWeight: 600, color: panel.headerBg, opacity: 0.38, letterSpacing: "0.10em", lineHeight: 1.55 }}>
                        No containers<br/>in this zone yet
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── z4 · Storage blocks ───────────────────────────────────────────────
            Block colour = primary decision signal. No flat fill overlays here;
            congestion visualised at z5 as hatching so this colour is never masked.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 4 }}>
          {layouts.map(layout => {
            const isSelected = selectedBlock === layout.label
            const isActive   = activeMoveBlocks?.has(layout.label)
            const panel      = ZONE_PANEL[layout.zone]
            const bg         = panel?.blockBg  ?? "#f9fafb"
            const bdr        = panel?.blockBorder ?? "#9ca3af"
            const barColor   =
              layout.occupancyPct > 85 ? YT.signalBreach :
              layout.occupancyPct > 70 ? YT.signalWarn : YT.signalOk
            // Text-safe signal variants: the bright signal fills (barColor) pass WCAG 3:1
            // for the graphical bar but fail 4.5:1 as TEXT on mid-toned fills (L≈0.60).
            // Dark hue-bearing counterparts clear 5.5:1 across all nine zone fills.
            //   ok:     #14532d green-900  5.6–5.8:1 ✓
            //   warn:   #78350f amber-900  5.6–5.8:1 ✓
            //   breach: #7f1d1d red-900    6.1–6.4:1 ✓
            const barTextColor =
              layout.occupancyPct > 85 ? "#7f1d1d" :
              layout.occupancyPct > 70 ? "#78350f" : "#14532d"
            // congestion % shown as text (the visual hatch is at z5)
            const congestion = congestionByBlock?.get(layout.label) ?? 0

            return (
              <div key={layout.label}
                className="absolute yard-block"
                tabIndex={0}
                role="button"
                aria-label={`Block ${layout.label}: ${layout.occupancyPct}% occupied, ${layout.containerCount} of ${layout.capacity} slots`}
                aria-pressed={isSelected}
                style={{
                  left: layout.x, top: layout.y, width: layout.w, height: layout.h,
                  background: bg,
                  border: `2px solid ${isSelected ? YT.signalBreach : isActive ? YT.signalWarn : bdr}`,
                  outline: isSelected ? "3px solid rgba(220,38,38,0.25)" : isActive ? "2px solid rgba(245,158,11,0.4)" : "none",
                  outlineOffset: 2, borderRadius: 4, cursor: "pointer",
                  boxShadow: "2px 3px 6px rgba(0,0,0,0.12)",
                  transition: "border-color 300ms, outline 300ms",
                }}
                onClick={e => { e.stopPropagation(); if (!didDrag.current) onSelectBlock(layout.label) }}
                onMouseDown={e => { if (e.button === 0) e.stopPropagation() }}
                onMouseEnter={e => handleBlockEnter(layout, e)}
                onMouseMove={e  => handleBlockMove(layout, e)}
                onMouseLeave={handleBlockLeave}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault(); e.stopPropagation()
                    onSelectBlock(layout.label)
                  }
                }}
              >
                {/* Left-edge occupancy bar — always visible at every zoom tier.
                    This is the primary status signal: the only z4 element at overview. */}
                <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l" style={{ background: "rgba(255,255,255,0.4)" }}>
                  <div className="absolute bottom-0 left-0 right-0 rounded-l" style={{ height: `${layout.occupancyPct}%`, background: barColor }} />
                </div>

                {/* Slot grid lines — detail tier only (≥ 0.8): legible slot fidelity */}
                {isDetail && Array.from({ length: (layout.rows ?? 1) - 1 }, (_, i) => (
                  <div key={`rl-${i}`} className="absolute left-0 right-0 pointer-events-none"
                    style={{ top: Math.round((i + 1) * layout.h / (layout.rows ?? 1)), height: 1, background: "rgba(0,0,0,0.06)" }}/>
                ))}

                {/* Working + Detail: block label, count/occupancy % */}
                {!isOverview && (<>
                  {/* Block label — text shadow toned down for mid-toned fills (was 0.65, now 0.30) */}
                  <div className="absolute font-mono font-black leading-none flex items-baseline gap-1.5" style={{ top: 7, left: 8, fontSize: 16, color: "#1e293b", letterSpacing: "0.08em", textShadow: "0 1px 0 rgba(255,255,255,0.30)" }}>
                    {layout.label}
                    {/* CB-safe shape glyph — Phase 3.6: shown alongside label when cbMode on */}
                    {cbMode && (() => {
                      const w = worstLfdByBlock?.get(layout.label)
                      if (!w) return null
                      const [shape, color] = w === "breached" ? ["▲", YT.signalBreach] as const : w === "risk24" ? ["◉", YT.signalWarnText] as const : ["◆", YT.signalWarnText] as const
                      // textShadow white glow: signal colors can't change (rule 8) but bright
                      // amber/red fail AA on mid-toned fills; a white knockout provides practical legibility.
                      return <span style={{ fontSize: 11, fontWeight: 900, color, textShadow: "0 0 6px rgba(255,255,255,0.90)", letterSpacing: 0 }}>{shape}</span>
                    })()}
                  </div>
                  {showCongestion && congestion > 0.25 && (
                    <div className="absolute leading-none font-bold" style={{ top: 8, right: 8, fontSize: 14, color: YT.signalBreach }}>{Math.round(congestion * 100)}%</div>
                  )}
                  {/* Container count — neutral dark chip so red ⏱ HOT badges are unambiguously urgent.
                      Capacity muted label: #4b5563 (4.7:1 on mid-toned fills — was #9ca3af at 1.5:1). */}
                  <div className="absolute leading-none flex items-center gap-1" style={{ bottom: 7, left: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, background: "#3f3f46", color: "white",
                      padding: "1px 5px", borderRadius: 4, lineHeight: 1.45 }}>
                      {layout.containerCount}
                    </span>
                    <span style={{ fontSize: 10, color: "#4b5563" }}>/{layout.capacity}</span>
                  </div>
                  {/* Occupancy % — threshold-coloured text using dark signal variants (WCAG AA on mid-toned fills).
                      Graphical bar uses bright barColor; text uses dark barTextColor. Same semantic, different weight. */}
                  <div className="absolute font-bold leading-none" style={{ bottom: 7, right: 8, fontSize: 14, color: barTextColor }}>{layout.occupancyPct}%</div>
                </>)}

                {/* Detail tier only: top container ID — #475569 (4.7:1 on fills; was #64748b at 3.5:1) */}
                {isDetail && layout.topContainerIds.length > 0 && (
                  <div className="absolute font-mono truncate leading-none" style={{ top: 30, left: 8, right: 8, fontSize: 11, color: "#475569" }}>{layout.topContainerIds[0]}</div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── z5 · Signals ────────────────────────────────────────────────────
            ALL dynamic signals that overlay block tiles:
            — Move trails (SVG lines)
            — Equipment position icons
            — Congestion hatching (diagonal pattern + edge ring, colorblind-safe)
            — Rehandle debt glyph (↻N, bottom-left of block)
            — Detention exposure highlight (amber ring, hover-triggered from KPI)
            — HOT badge (⏱N, pulsing red pill, highest priority)
            CONTRACT: no flat fills that mask z4 block status colour.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 5, pointerEvents: "none" }}>

          {/* ── Move trails — road-routed paths with animated tracer dot ────────
              Paths follow yard circulation network instead of straight cuts.
              Recent trail (high index) = opaque; older = faded.
              Each dot traces the route at a slightly different speed.
              prefers-reduced-motion: static dashed line only, no dot.
          ─────────────────────────────────────────────────────────────── */}
          {showTrails && moveTrails && moveTrails.length > 0 && (
            <svg className="absolute pointer-events-none"
              style={{ left: 0, top: 0, width: dims.width, height: dims.height, overflow: "visible" }}>
              {moveTrails.map((trail, i) => {
                const n      = moveTrails.length
                const opacity = 0.22 + 0.65 * (i / Math.max(n - 1, 1))
                const d      = routeViaRoads(trail.fromX, trail.fromY, trail.toX, trail.toY)
                const pathId = `yt-${trail.id.replace(/[^a-z0-9]/gi, "")}`
                return (
                  <g key={trail.id}>
                    {/* Routed dashed path — always visible */}
                    <path id={pathId} d={d} fill="none"
                      stroke="#64748b" strokeWidth={1.8}
                      strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round"
                      opacity={opacity * 0.55}/>
                    {/* Animated tracer dot — suppressed by prefers-reduced-motion */}
                    {!prefersReducedMotion && (
                      <circle r={4} fill="#475569" stroke="#e2e8f0" strokeWidth={1.5} opacity={opacity}>
                        <animateMotion dur={`${3.2 + i * 0.45}s`} repeatCount="indefinite">
                          <mpath href={`#${pathId}`}/>
                        </animateMotion>
                      </circle>
                    )}
                  </g>
                )
              })}
            </svg>
          )}

          {/* Equipment icons */}
          {showEquipment && equipment.map((eq, idx) => {
            const color =
              eq.type === "reach-stacker" ? "#374151"
              : eq.type === "empty-handler" ? "#9333ea"
              : EQ_STATUS_COLOR[eq.status] ?? "#9ca3af"
            const SZ = 14
            return (
              <div key={`eq-${eq.id}-${idx}`}
                className="yard-equipment-icon absolute flex items-center justify-center"
                style={{
                  left: eq.x - SZ / 2, top: eq.y - SZ / 2, width: SZ, height: SZ,
                  background: color,
                  border: "2px solid rgba(255,255,255,0.9)",
                  borderRadius: eq.type === "jockey" ? "50%" : eq.type === "empty-handler" ? 0 : 3,
                  transform: eq.type === "empty-handler" ? "rotate(45deg)" : undefined,
                  cursor: "pointer", pointerEvents: "auto",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                }}
                onMouseEnter={e => handleEquipEnter(eq, e)}
                onMouseLeave={handleEquipLeave}
              />
            )
          })}

          {/* ── Congestion hatching — diagonal pattern + edge ring ────────────
              Two independent cues (pattern shape + colour) = colorblind-safe.
              Three levels: amber (low) → orange (medium) → red (high).
              Does NOT use a flat fill, so block status colour shows through.
          ─────────────────────────────────────────────────────────────── */}
          {showCongestion && !isOverview && layouts.map(layout => {
            const cong = congestionByBlock?.get(layout.label) ?? 0
            if (cong < 0.25) return null
            const stroke   = cong > 0.75 ? YT.signalBreach : cong > 0.50 ? "#f97316" : YT.signalWarn
            const opacity  = 0.28 + cong * 0.30
            const edgeW    = 2.5 + cong * 2.5
            const patId    = `hatch-${layout.label.replace("-", "")}`
            return (
              <svg key={`cong-${layout.label}`} className="absolute pointer-events-none"
                style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, overflow: "hidden", borderRadius: 4 }}>
                <defs>
                  <pattern id={patId} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="10" x2="10" y2="0" stroke={stroke} strokeWidth="2.5" strokeOpacity={opacity}/>
                  </pattern>
                </defs>
                {/* Diagonal hatch fills the block without hiding text (opacity < 0.45) */}
                <rect width={layout.w} height={layout.h} fill={`url(#${patId})`}/>
                {/* Edge ring — second independent cue */}
                <rect x={edgeW / 2} y={edgeW / 2} width={layout.w - edgeW} height={layout.h - edgeW}
                  fill="none" stroke={stroke} strokeWidth={edgeW} rx="3" strokeOpacity={Math.min(1, opacity * 1.8)}/>
              </svg>
            )
          })}

          {/* ── Rehandle debt glyphs — ↻N at block bottom-left ──────────────
              Counts RESHUFFLE moves originating from this block.
              Amber ≤ 2; red ≥ 3.  textShadow keeps it legible over any block bg.
          ─────────────────────────────────────────────────────────────── */}
          {isDetail && rehandleByBlock && Array.from(rehandleByBlock.entries()).map(([blockLabel, count]) => {
            if (count === 0) return null
            const layout = layouts.find(l => l.label === blockLabel)
            if (!layout) return null
            const color = count >= 3 ? YT.signalBreach : YT.signalWarnText
            return (
              <div key={`rh-${blockLabel}`}
                className="absolute font-black pointer-events-none"
                style={{ left: layout.x + 5, top: layout.y + layout.h - 18, fontSize: 10, lineHeight: 1, color, textShadow: "0 1px 3px rgba(255,255,255,0.90)" }}>
                ↻{count}
              </div>
            )
          })}

          {/* ── Detention exposure highlight ─────────────────────────────────
              Pulsing amber ring on blocks that contribute to detention $ exposure.
              Triggered when user hovers the Detention KPI on the left panel.
              Animation lives in .yard-detention-highlight (index.css).
              prefers-reduced-motion: static border (CSS @media guard).
          ─────────────────────────────────────────────────────────────── */}
          {highlightBlocks && Array.from(highlightBlocks).map(blockLabel => {
            const layout = layouts.find(l => l.label === blockLabel)
            if (!layout) return null
            return (
              <div key={`det-hl-${blockLabel}`}
                className="absolute pointer-events-none yard-detention-highlight"
                style={{ left: layout.x - 4, top: layout.y - 4, width: layout.w + 8, height: layout.h + 8 }}
              />
            )
          })}

          {/* ── HOT CONTAINER BADGES — highest-priority signal ──────────────
              ⏱ icon + count + red + pulse = 4 independent cues.
              .yard-hot-badge animation in index.css (reduced-motion guarded).
              Click → deep-links block drawer to hot containers only.
          ─────────────────────────────────────────────────────────────── */}
          {/* Block-level ⏱ badges — working + detail only; overview uses zone-level dot */}
          {!isOverview && hotByBlock && Array.from(hotByBlock.entries()).map(([blockLabel, count]) => {
            if (count === 0) return null
            const layout = layouts.find(l => l.label === blockLabel)
            if (!layout) return null
            return (
              <div
                key={`hot-${blockLabel}`}
                className="yard-hot-badge absolute flex items-center font-black"
                style={{ left: layout.x + layout.w - 6, top: layout.y - 12, background: YT.signalBreach, color: "white", fontSize: 11, padding: "3px 7px 3px 5px", borderRadius: 12, gap: 3, cursor: "pointer", pointerEvents: "auto", whiteSpace: "nowrap", zIndex: 10, lineHeight: 1 }}
                title={`${count} container${count > 1 ? "s" : ""} breach LFD in ≤ 4 h — click to inspect`}
                onClick={e => { e.stopPropagation(); onHotBadgeClick?.(blockLabel) }}
              >
                <span style={{ fontSize: 10 }}>⏱</span>
                <span>{count}</span>
              </div>
            )
          })}
        </div>

        {children}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          z6 · Chrome — fixed UI, NOT inside pan/zoom transform.
      ════════════════════════════════════════════════════════════════════ */}

      <NorthArrow />
      <ScaleBar scale={tf.scale} />

      {/* Zoom-tier indicator — makes the audience-switch concept legible */}
      <div className="absolute pointer-events-none" style={{ bottom: 44, right: 12, zIndex: 60 }}>
        <span style={{
          fontSize: 8.5, fontWeight: 700, letterSpacing: "0.14em",
          color: "rgba(255,255,255,0.88)",
          background: isOverview ? "rgba(99,102,241,0.72)" : isDetail ? "rgba(22,163,74,0.72)" : "rgba(100,116,139,0.72)",
          padding: "3px 9px", borderRadius: 20,
          backdropFilter: "blur(4px)",
        }}>
          {isOverview ? "OVERVIEW" : isDetail ? "DETAIL" : "WORKING"}
        </span>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex gap-1" style={{ zIndex: 60 }}>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => { const r = containerRef.current!.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25) }}
          className="w-8 h-8 bg-white border border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50 flex items-center justify-center shadow-sm"
          style={{ borderRadius: 5 }}
        >+</button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => { const r = containerRef.current!.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8) }}
          className="w-8 h-8 bg-white border border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50 flex items-center justify-center shadow-sm"
          style={{ borderRadius: 5 }}
        >−</button>
        <button
          onMouseDown={e => e.stopPropagation()} onClick={fitView}
          className="px-2.5 h-8 bg-white border border-slate-300 text-slate-500 text-[10px] font-semibold hover:bg-slate-50 shadow-sm"
          style={{ borderRadius: 5 }}
        >fit</button>
      </div>

      {layouts.length > 0 && (
        <MiniMap layouts={layouts} tf={tf} dims={dims} containerRef={containerRef} zoneBounds={zoneBounds}
          hotByBlock={hotByBlock}
          onFacilityEnter={(f, cx, cy) => {
            setHoveredFacility(f)
            const rect = containerRef.current?.getBoundingClientRect()
            if (rect) setFacTooltipPos({ x: cx - rect.left + 10, y: cy - rect.top - 36 })
          }}
          onFacilityLeave={() => { setHoveredFacility(null); setFacTooltipPos(null) }}
        />
      )}

      {/* Facility tooltip */}
      {hoveredFacility && facTooltipPos && (
        <div className="absolute pointer-events-none bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 shadow-sm" style={{ left: facTooltipPos.x, top: facTooltipPos.y, padding: "4px 9px", borderRadius: 4, zIndex: 200, whiteSpace: "nowrap" }}>
          {hoveredFacility.tooltip}
        </div>
      )}

      {/* Block tooltip */}
      {hoveredLayout && tooltipPos && !hoveredEquip && (
        <BlockTooltip
          layout={hoveredLayout}
          zoneName={zoneNames[hoveredLayout.zone] ?? `Zone ${hoveredLayout.zone}`}
          x={tooltipPos.x} y={tooltipPos.y}
        />
      )}

      {/* Equipment tooltip */}
      {hoveredEquip && equipTooltipPos && (
        <div className="absolute pointer-events-none bg-white border border-slate-200 text-[11px] leading-relaxed" style={{ left: equipTooltipPos.x, top: equipTooltipPos.y, padding: "6px 10px", borderRadius: 5, zIndex: 200, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", maxWidth: 200 }}>
          <div className="font-bold text-[12px]">{hoveredEquip.id}</div>
          <div className="text-slate-500">{hoveredEquip.operatorName}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: EQ_STATUS_COLOR[hoveredEquip.status] ?? "#9ca3af" }} />
            <span className="capitalize">{hoveredEquip.status}</span>
          </div>
          <div className="text-slate-600 mt-0.5">Block: {hoveredEquip.currentBlock}</div>
          {hoveredEquip.destinationBlock && (
            <div className="text-slate-600">→ {hoveredEquip.destinationBlock} ({Math.round(hoveredEquip.progress * 100)}%)</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CameraIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <div className="pointer-events-none" style={style}>
      <svg width="14" height="11" viewBox="0 0 14 11" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0.5" y="2.5" width="13" height="8" rx="1.5" fill="#484848" stroke="#8B8B8B" strokeWidth="0.7"/>
        <circle cx="7" cy="6.5" r="2.8" fill="#1a1a1a" stroke="#8B8B8B" strokeWidth="0.8"/>
        <circle cx="7" cy="6.5" r="1.4" fill="#2a2a2a"/>
        <rect x="4" y="0.5" width="6" height="2.5" rx="1" fill="#484848" stroke="#8B8B8B" strokeWidth="0.7"/>
        <circle cx="11.5" cy="4" r="0.8" fill="#dc2626" opacity="0.65"/>
      </svg>
    </div>
  )
}

function DirectionalArrow({ direction, width, height }: { direction: "E" | "W"; width: number; height: number }) {
  const count = Math.max(1, Math.min(6, Math.floor(width / 220)))
  const segW  = width / count
  const s     = Math.min(height * 0.28, 9)
  const dir   = direction === "E" ? 1 : -1
  return (
    <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, overflow: "visible" }} width={width} height={height}>
      {Array.from({ length: count }, (_, i) => {
        const cx  = (i + 0.5) * segW
        const cy  = height / 2
        const tip = cx + dir * s
        const bx  = cx - dir * s * 0.5
        return (
          <g key={i}>
            <line x1={cx - dir * s * 1.8} y1={cy} x2={bx} y2={cy} stroke="rgba(255,255,255,0.50)" strokeWidth="1.5" strokeLinecap="round"/>
            <polygon points={`${tip},${cy} ${bx},${cy - s} ${bx},${cy + s}`} fill="rgba(255,255,255,0.50)"/>
          </g>
        )
      })}
    </svg>
  )
}

function NorthArrow() {
  return (
    <div className="absolute pointer-events-none flex flex-col items-center"
      style={{ top: 12, right: 12, zIndex: 60, background: "rgba(255,255,255,0.92)", border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 7px", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
      <svg width="26" height="32" viewBox="0 0 26 32" fill="none" aria-label="North arrow">
        <path d="M13 2 L20 21 L13 17 L6 21 Z" fill="#1e293b"/>
        <path d="M13 30 L20 21 L13 17 L6 21 Z" fill="#cbd5e1"/>
        <circle cx="13" cy="17" r="2.8" fill="white" stroke="#1e293b" strokeWidth="1.2"/>
      </svg>
      <span className="font-black text-slate-800 leading-none" style={{ fontSize: 11, marginTop: 2 }}>N</span>
    </div>
  )
}

function ScaleBar({ scale }: { scale: number }) {
  const NICE = [5, 10, 25, 50, 100, 200]
  const rawM  = 80 / (PX_PER_M * scale)
  const niceM = NICE.reduce((a, b) => Math.abs(a - rawM) <= Math.abs(b - rawM) ? a : b)
  const barPx = Math.round(niceM * PX_PER_M * scale)
  const label = niceM >= 1000 ? `${niceM / 1000} km` : `${niceM} m`
  return (
    <div className="absolute pointer-events-none flex flex-col items-end" style={{ bottom: 44, right: 12, zIndex: 60 }}>
      <div className="font-mono text-slate-600" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 1.5, height: 7, background: "#475569" }} />
        <div style={{ width: barPx, height: 3, background: "#475569" }} />
        <div style={{ width: 1.5, height: 7, background: "#475569" }} />
      </div>
      <div className="font-mono text-slate-500" style={{ fontSize: 8, alignSelf: "flex-start", marginTop: 1 }}>0</div>
    </div>
  )
}

const ZONE_MINI_COLOR: Record<string, string> = {
  A: "#93c5fd", B: "#86efac", C: "#d8b4fe", D: "#fdba74",
  E: "#bbf7d0", S: "#fde047", R: "#cbd5e1", F: "#fcd34d", Q: "#6ee7b7",
}

function MiniMap({
  layouts, tf, dims, containerRef, zoneBounds,
  hotByBlock, onFacilityEnter, onFacilityLeave,
}: {
  layouts:      BlockLayout[]
  tf:           { x: number; y: number; scale: number }
  dims:         { width: number; height: number }
  containerRef: React.RefObject<HTMLDivElement>
  zoneBounds:   Map<string, { x1: number; y1: number; x2: number; y2: number }>
  hotByBlock?:         Map<string, number>
  onFacilityEnter?:    (f: Facility, clientX: number, clientY: number) => void
  onFacilityLeave?:    () => void
}) {
  const scaleX  = (MINIMAP_W - 4) / dims.width
  const scaleY  = (MINIMAP_H - 20) / dims.height
  const scale   = Math.min(scaleX, scaleY)
  const el = containerRef.current
  const cw = el ? el.getBoundingClientRect().width  : 0
  const ch = el ? el.getBoundingClientRect().height : 0
  const vpX = -tf.x / tf.scale
  const vpY = -tf.y / tf.scale
  const vpW =  cw / tf.scale
  const vpH =  ch / tf.scale

  // Convert yard coordinates → minimap pixel space
  const mx = (yx: number) => 2 + yx * scale
  const my = (yy: number) => yy * scale
  const contentH = MINIMAP_H - 18

  return (
    <div className="absolute bottom-3 left-3 bg-white border border-slate-300 overflow-hidden shadow-sm" style={{ width: MINIMAP_W, height: MINIMAP_H, borderRadius: 5, zIndex: 60 }}>
      <div className="font-bold tracking-wider text-slate-400 border-b border-slate-200" style={{ fontSize: 8, padding: "2px 6px" }}>MINIMAP</div>
      <div className="relative" style={{ width: MINIMAP_W, height: contentH, overflow: "hidden", background: CONCRETE }}>

        {/* Zone blobs */}
        {Array.from(zoneBounds.entries()).map(([zoneId, b]) => (
          <div key={`mz-${zoneId}`} className="absolute" style={{ left: mx(b.x1), top: my(b.y1), width: Math.max(3, (b.x2 - b.x1) * scale), height: Math.max(3, (b.y2 - b.y1) * scale), background: ZONE_MINI_COLOR[zoneId] ?? "#e5e7eb", borderRadius: 1, opacity: 0.7 }} />
        ))}

        {/* ── SVG overlay: roads · facility dots · hot-block dots ────────────── */}
        <svg style={{ position: "absolute", left: 0, top: 0, width: MINIMAP_W, height: contentH, overflow: "visible" }}>
          {/* Main boulevard (horizontal) */}
          <line x1={0} y1={my(CIRCULATION.mainBoulevard.y)} x2={MINIMAP_W} y2={my(CIRCULATION.mainBoulevard.y)} stroke="rgba(0,0,0,0.30)" strokeWidth="1"/>
          {/* Bottom transversal */}
          <line x1={0} y1={my(CIRCULATION.bottomTransversal.y)} x2={MINIMAP_W} y2={my(CIRCULATION.bottomTransversal.y)} stroke="rgba(0,0,0,0.22)" strokeWidth="0.8"/>
          {/* N–S cross-roads */}
          {CIRCULATION.crossRoads.map((cr, i) => (
            <line key={`mcr-${i}`} x1={mx(cr.x)} y1={0} x2={mx(cr.x)} y2={contentH} stroke="rgba(0,0,0,0.22)" strokeWidth="0.8"/>
          ))}

          {/* Facility dots — grey circles matching the z2 colour */}
          {FACILITIES.map(f => (
            <circle key={`mf-${f.id}`}
              cx={mx(f.x + f.w / 2)} cy={my(f.y + f.h / 2)}
              r={2.5} fill="#8B8B8B" opacity={0.80}
              style={{ cursor: "default" }}
              onMouseEnter={e => onFacilityEnter?.(f, e.clientX, e.clientY)}
              onMouseLeave={() => onFacilityLeave?.()}
            />
          ))}

          {/* Hot-block red dots — "where the fires are" in the overview */}
          {hotByBlock && layouts
            .filter(l => (hotByBlock.get(l.label) ?? 0) > 0)
            .map(l => (
              <circle key={`mh-${l.label}`}
                cx={mx(l.x + l.w / 2)} cy={my(l.y + l.h / 2)}
                r={3.2} fill="#dc2626" opacity={0.88}
                style={{ pointerEvents: "none" }}/>
            ))
          }
        </svg>

        {/* Viewport rectangle */}
        <div className="absolute border border-red-500 pointer-events-none" style={{ background: "rgba(220,38,38,0.08)", left: Math.max(0, mx(vpX)), top: Math.max(0, my(vpY)), width: Math.min(MINIMAP_W - 4, vpW * scale), height: Math.min(contentH, vpH * scale) }} />
      </div>
    </div>
  )
}
