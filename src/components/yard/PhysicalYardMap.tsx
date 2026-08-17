import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import type { BlockLayout, EquipmentPosition, MoveTrail } from "@/lib/yard-layout"
import { getYardDimensions, BERTH_HEIGHT, GATE_HEIGHT, computeRoadCorridors } from "@/lib/yard-layout"
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
}

// ── Zone visual identity ──────────────────────────────────────────────────────

const ZONE_PANEL: Record<string, {
  bg: string; border: string; headerBg: string; headerText: string; blockBg: string; blockBorder: string
}> = {
  A: { bg: "#eff6ff", border: "#93c5fd", headerBg: "#1e40af", headerText: "#fff", blockBg: "#dbeafe", blockBorder: "#93c5fd" },
  B: { bg: "#f0fdf4", border: "#86efac", headerBg: "#15803d", headerText: "#fff", blockBg: "#dcfce7", blockBorder: "#86efac" },
  C: { bg: "#faf5ff", border: "#d8b4fe", headerBg: "#6d28d9", headerText: "#fff", blockBg: "#f3e8ff", blockBorder: "#d8b4fe" },
  D: { bg: "#fff7ed", border: "#fdba74", headerBg: "#c2410c", headerText: "#fff", blockBg: "#ffedd5", blockBorder: "#fdba74" },
  E: { bg: "#f0fdf4", border: "#bbf7d0", headerBg: "#4d7c0f", headerText: "#fff", blockBg: "#dcfce7", blockBorder: "#bbf7d0" },
  S: { bg: "#fefce8", border: "#fde047", headerBg: "#92400e", headerText: "#fff", blockBg: "#fef9c3", blockBorder: "#fde047" },
  R: { bg: "#f8fafc", border: "#cbd5e1", headerBg: "#475569", headerText: "#fff", blockBg: "#f1f5f9", blockBorder: "#cbd5e1" },
  // F and Q were missing from the original — added here
  F: { bg: "#fffbeb", border: "#fcd34d", headerBg: "#b45309", headerText: "#fff", blockBg: "#fef3c7", blockBorder: "#fcd34d" },
  Q: { bg: "#f0fdf4", border: "#6ee7b7", headerBg: "#065f46", headerText: "#fff", blockBg: "#d1fae5", blockBorder: "#6ee7b7" },
}

const ZONE_SUBTITLES: Record<string, string> = {
  A: "Dry / general (loaded) · Zone A", B: "Dry / general (loaded) · Zone B", C: "Customs hold",
  D: "Hazmat / IMDG", E: "Empty depot", S: "Staging (drop & hook)", R: "Gate-in / receiving",
  F: "Reefer / food-grade", Q: "Quarantine / M&R",
}

const EQ_STATUS_COLOR: Record<string, string> = {
  idle: "#16a34a", moving: "#f59e0b", lifting: "#dc2626", travelling: "#3b82f6",
}

const MINIMAP_W    = 148
const MINIMAP_H    = 108
const PANEL_PAD_X  = 16
const PANEL_PAD_TOP = 36
const PANEL_PAD_BOT = 12

// ── z0 ground texture ─────────────────────────────────────────────────────────
// Concrete slab grid: 80 px cells with 1.5 px shadow-joints.
// At the typical fit-view scale (~0.5) each cell appears ~40 px — clearly legible
// without dominating the block colours at z4.
const CONCRETE_BASE  = "#d1d5db"
const CONCRETE_STYLE: React.CSSProperties = {
  background: CONCRETE_BASE,
  backgroundImage: [
    "repeating-linear-gradient(0deg,   rgba(0,0,0,0.042) 0px, rgba(0,0,0,0.042) 1.5px, transparent 1.5px, transparent 80px)",
    "repeating-linear-gradient(90deg,  rgba(0,0,0,0.042) 0px, rgba(0,0,0,0.042) 1.5px, transparent 1.5px, transparent 80px)",
  ].join(", "),
}

// ── z1 road surface ───────────────────────────────────────────────────────────
// Asphalt corridors sit 6 % darker than the concrete base.
const ASPHALT_BASE = "#b8bec5"

export default function PhysicalYardMap({
  layouts, selectedBlock, onSelectBlock, zoneNames = {}, children,
  equipment = [], showEquipment = false,
  moveTrails = [], showTrails = false,
  congestionByBlock, showCongestion = false,
  activeMoveBlocks,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const dragging      = useRef(false)
  const didDrag       = useRef(false)
  const lastPos       = useRef({ x: 0, y: 0 })

  const [tf,              setTf]            = useState({ x: 16, y: 16, scale: 1 })
  const [hoveredLayout,   setHoveredLayout] = useState<BlockLayout | null>(null)
  const [tooltipPos,      setTooltipPos]    = useState<{ x: number; y: number } | null>(null)
  const [hoveredEquip,    setHoveredEquip]  = useState<EquipmentPosition | null>(null)
  const [equipTooltipPos, setEquipTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const dims = getYardDimensions(layouts)

  // ── Zone bounding boxes — shared by z3 (panels) and z6 (minimap) ─────────
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

  // ── Road corridor geometry — consumed by z1 ───────────────────────────────
  const roadCorridors = useMemo(
    () => computeRoadCorridors(dims),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dims.width, dims.height],
  )

  // ── Fit-to-view ───────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!containerRef.current || layouts.length === 0) return
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect()
    const scale = Math.min((cw - 32) / dims.width, (ch - 32) / dims.height, 1)
    setTf({ x: 16, y: 16, scale })
  }, [dims.width, dims.height, layouts.length])

  useEffect(() => { fitView() }, [layouts.length]) // eslint-disable-line

  // ── Zoom at a point ───────────────────────────────────────────────────────
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setTf(t => {
      const newScale = Math.max(0.10, Math.min(5, t.scale * factor))
      const actual   = newScale / t.scale
      return { scale: newScale, x: cx - (cx - t.x) * actual, y: cy - (cy - t.y) * actual }
    })
  }, [])

  // ── Wheel zoom ────────────────────────────────────────────────────────────
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

  // ── Drag-to-pan ───────────────────────────────────────────────────────────
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

  // ── Block tooltip helpers ─────────────────────────────────────────────────
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

  // ── Equipment tooltip helpers ─────────────────────────────────────────────
  function handleEquipEnter(eq: EquipmentPosition, e: React.MouseEvent) {
    e.stopPropagation()
    setHoveredEquip(eq)
    const rect = containerRef.current!.getBoundingClientRect()
    setEquipTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 4 })
  }
  function handleEquipLeave(e: React.MouseEvent) {
    e.stopPropagation(); setHoveredEquip(null); setEquipTooltipPos(null)
  }

  // ── Bollard count along quay wall ─────────────────────────────────────────
  const bollardCount = Math.max(0, Math.floor(dims.width / 120))

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={{
        flex: 1, minHeight: 0,
        // Outer container background = concrete base so the area outside the
        // canvas (when panned or at small scale) matches the z0 ground colour.
        background: CONCRETE_BASE,
        cursor: dragging.current ? "grabbing" : "grab",
        touchAction: "none", userSelect: "none",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { onMouseUp(); handleBlockLeave(); setHoveredEquip(null) }}
    >

      {/* ════════════════════════════════════════════════════════════════════
          ZOOMABLE CANVAS
          All z0–z5 layers share this CSS transform (pan + zoom).
          Layer contract: z0–z3 MUST NOT reduce legibility of z4–z5.
          z5 signals are designed to overlay z4 blocks transparently.
      ════════════════════════════════════════════════════════════════════ */}
      <div
        className="absolute"
        style={{
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
          transformOrigin: "0 0",
          width: dims.width, height: dims.height,
        }}
      >

        {/* ── z0 · Ground base ──────────────────────────────────────────────
            Concrete slab texture across the entire yard canvas.
            Renders beneath every other layer. Provides the "paved yard"
            baseline that contextualises zone panels and blocks above it.
        ──────────────────────────────────────────────────────────────── */}
        <div
          className="absolute inset-0"
          style={{ zIndex: 0, ...CONCRETE_STYLE }}
        />

        {/* ── z1 · Circulation ──────────────────────────────────────────────
            Roads, aisles, lane markings, berth / water, gate, perimeter.
            Rendered pointer-events:none so z4 blocks remain fully clickable.
            Render order within z1 (DOM paint order, later = on top):
              1. Road corridor fills (asphalt)
              2. Water basin gradient (covers road at top)
              3. Quay wall + bollards
              4. Berth label
              5. Gate approach + label
              6. Perimeter boundary line
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 1, pointerEvents: "none" }}>

          {/* 1 — Road / aisle corridors */}
          {roadCorridors.map((road, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: road.x, top: road.y, width: road.w, height: road.h,
                background: ASPHALT_BASE,
                // Centre-line dashes: orientation follows corridor shape
                backgroundImage: road.w >= road.h
                  ? "repeating-linear-gradient(90deg, rgba(255,255,255,0.17) 0 3px, transparent 3px 26px)"
                  : "repeating-linear-gradient(0deg,  rgba(255,255,255,0.17) 0 3px, transparent 3px 26px)",
              }}
            />
          ))}

          {/* 2 — Water basin (covers road gradient at top of canvas) */}
          <div
            className="absolute left-0 right-0"
            style={{
              top: 0, height: 60,
              background: "linear-gradient(to bottom, #1a4870 0%, #22648a 45%, #2c7fa8 78%, #3898c4 100%)",
            }}
          />

          {/* 3 — Quay wall — concrete lip at water / yard boundary */}
          <div
            className="absolute left-0 right-0"
            style={{
              top: 50, height: 10,
              background: "#2d3748",
              boxShadow: "0 3px 8px rgba(0,0,0,0.40)",
            }}
          />

          {/* 3 — Bollards along the quay */}
          {Array.from({ length: bollardCount }, (_, i) => (
            <div
              key={`bollard-${i}`}
              className="absolute"
              style={{
                top: 46, left: i * 120 + 58,
                width: 8, height: 8,
                background: "#f59e0b",
                borderRadius: "50%",
                border: "1.5px solid #92400e",
              }}
            />
          ))}

          {/* 4 — Berth label centred on the water strip */}
          <div
            className="absolute left-0 right-0 flex items-center justify-center font-black tracking-widest"
            style={{
              top: 0, height: 50,
              fontSize: 11, letterSpacing: "0.2em",
              color: "#93c5fd",
            }}
          >
            TERMINAL · BERTH SIDE
          </div>

          {/* 5 — Gate approach (covers road gradient at bottom of canvas) */}
          <div
            className="absolute left-0 right-0"
            style={{
              bottom: 0, height: GATE_HEIGHT + 6,
              background: "#14532d",
            }}
          />
          <div
            className="absolute left-0 right-0 flex items-center justify-center font-black tracking-widest"
            style={{
              bottom: 0, height: GATE_HEIGHT,
              fontSize: 11, letterSpacing: "0.2em",
              color: "#86efac",
              background: "#14532d",
            }}
          >
            GATE · TRUCK ENTRY
          </div>

          {/* 6 — Perimeter boundary — thin dark outline around whole canvas */}
          <div
            className="absolute inset-0"
            style={{ border: "2.5px solid rgba(0,0,0,0.20)", pointerEvents: "none" }}
          />
        </div>

        {/* ── z2 · Structures ───────────────────────────────────────────────
            Facility buildings, equipment parking bays, weigh station,
            gatehouse, M&R workshop.
            Intentionally empty — populated in Phase 2.
        ──────────────────────────────────────────────────────────────── */}

        {/* ── z3 · Zone areas ───────────────────────────────────────────────
            Zone panel backgrounds and signpost headers.
            Panels are sized to their block bounding box + padding and sit
            BEHIND z4 blocks — they must not obscure any block content.
        ──────────────────────────────────────────────────────────────── */}
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

            return (
              <div
                key={`panel-${zoneId}`}
                className="absolute"
                style={{
                  left: px, top: py, width: pw, height: ph,
                  background: panel.bg,
                  border: `1.5px solid ${panel.border}`,
                  borderRadius: 8,
                }}
              >
                <div
                  className="absolute top-0 left-0 flex items-center gap-3 px-4"
                  style={{
                    height: PANEL_PAD_TOP - 4,
                    background: panel.headerBg,
                    color: panel.headerText,
                    borderRadius: "6px 6px 0 0",
                    width: "100%",
                  }}
                >
                  <span className="font-black tracking-wider" style={{ fontSize: 16 }}>{name}</span>
                  <span className="opacity-70 font-semibold tracking-wide" style={{ fontSize: 12 }}>{sub}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── z4 · Storage blocks ───────────────────────────────────────────
            Colour-encoded container blocks. SEMANTIC layer — these cells are
            the primary decision surface for operators.
            CONTRACT: nothing at z0–z3 may cover or reduce legibility of any
            block. z5 signals overlay transparently and are co-designed to
            remain readable alongside block colours.
            Note: congestion heat tints are currently rendered as local child
            overlays inside each block div. They will be promoted to z5 signal
            overlays in Phase 3 once the signal layer is fully specified.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 4 }}>
          {layouts.map(layout => {
            const isSelected  = selectedBlock === layout.label
            const isActive    = activeMoveBlocks?.has(layout.label)
            const panel       = ZONE_PANEL[layout.zone]
            const bg          = panel?.blockBg  ?? "#f9fafb"
            const bdr         = panel?.blockBorder ?? "#9ca3af"
            const barColor    =
              layout.occupancyPct > 85 ? "#dc2626" :
              layout.occupancyPct > 70 ? "#f59e0b" : "#16a34a"
            const congestion  = congestionByBlock?.get(layout.label) ?? 0
            const heatTint    =
              showCongestion && congestion > 0.75 ? "rgba(220,38,38,0.20)"
              : showCongestion && congestion > 0.50 ? "rgba(249,115,22,0.16)"
              : showCongestion && congestion > 0.25 ? "rgba(245,158,11,0.12)"
              : null

            return (
              <div
                key={layout.label}
                className="absolute"
                style={{
                  left: layout.x, top: layout.y, width: layout.w, height: layout.h,
                  background: bg,
                  border: `2px solid ${isSelected ? "#dc2626" : isActive ? "#f59e0b" : bdr}`,
                  outline: isSelected ? "3px solid rgba(220,38,38,0.25)"
                    : isActive ? "2px solid rgba(245,158,11,0.4)" : "none",
                  outlineOffset: 2,
                  borderRadius: 4,
                  cursor: "pointer",
                  transition: "border-color 300ms, outline 300ms",
                }}
                onClick={e => { e.stopPropagation(); if (!didDrag.current) onSelectBlock(layout.label) }}
                onMouseDown={e => { if (e.button === 0) e.stopPropagation() }}
                onMouseEnter={e => handleBlockEnter(layout, e)}
                onMouseMove={e  => handleBlockMove(layout, e)}
                onMouseLeave={handleBlockLeave}
              >
                {/* Congestion heat tint — local block overlay (Phase 3: promote to z5) */}
                {heatTint && (
                  <div className="absolute inset-0 pointer-events-none rounded"
                    style={{ background: heatTint }} />
                )}

                {/* Block label — top-left */}
                <div className="absolute font-black tracking-wider leading-none"
                  style={{ top: 7, left: 8, fontSize: 18, color: "#1e293b" }}>
                  {layout.label}
                </div>

                {/* Congestion % — top-right */}
                {showCongestion && congestion > 0.25 && (
                  <div className="absolute leading-none font-bold"
                    style={{ top: 8, right: 8, fontSize: 14, color: "#dc2626" }}>
                    {Math.round(congestion * 100)}%
                  </div>
                )}

                {/* Occupancy fill bar — left-side vertical */}
                <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l"
                  style={{ background: "rgba(255,255,255,0.4)" }}>
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-l"
                    style={{ height: `${layout.occupancyPct}%`, background: barColor }}
                  />
                </div>

                {/* Container count — bottom-left */}
                <div
                  className="absolute font-bold tabular leading-none"
                  style={{ bottom: 8, left: 10, fontSize: 15, color: "#374151" }}
                >
                  {layout.containerCount}
                  <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 3 }}>/ {layout.capacity}</span>
                </div>

                {/* Occupancy % — bottom-right */}
                <div className="absolute font-bold leading-none"
                  style={{ bottom: 8, right: 8, fontSize: 15, color: barColor }}>
                  {layout.occupancyPct}%
                </div>

                {/* Top container ID preview — below label */}
                {layout.topContainerIds.length > 0 && (
                  <div
                    className="absolute font-mono truncate leading-none"
                    style={{ top: 30, left: 8, right: 8, fontSize: 11, color: "#64748b" }}
                  >
                    {layout.topContainerIds[0]}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── z5 · Signals ──────────────────────────────────────────────────
            Move trails, equipment overlays, hot/LFD markers (Phase 3).
            This layer sits above z4 blocks. Signals must be semi-transparent
            or spatially distinct so z4 block colours remain readable.
            The z5 div is pointer-events:none; individual equipment icons
            re-enable pointer-events so their hover tooltip still fires.
        ──────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0" style={{ zIndex: 5, pointerEvents: "none" }}>

          {/* Move trails — dashed SVG lines between block centres */}
          {showTrails && moveTrails.length > 0 && (
            <svg
              className="absolute inset-0 overflow-visible"
              style={{ left: 0, top: 0, width: dims.width, height: dims.height }}
            >
              {moveTrails.map((trail, i) => (
                <line
                  key={trail.id}
                  x1={trail.fromX} y1={trail.fromY} x2={trail.toX} y2={trail.toY}
                  stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4"
                  opacity={0.2 + 0.2 * (i / moveTrails.length)}
                />
              ))}
            </svg>
          )}

          {/* Equipment icons — pointer-events re-enabled individually */}
          {showEquipment && equipment.map(eq => {
            const color = eq.type === "reach-stacker" ? "#374151"
              : eq.type === "empty-handler" ? "#9333ea"
              : EQ_STATUS_COLOR[eq.status] ?? "#9ca3af"
            const SZ = 14

            return (
              <div
                key={eq.id}
                className="absolute flex items-center justify-center"
                style={{
                  left: eq.x - SZ / 2, top: eq.y - SZ / 2, width: SZ, height: SZ,
                  background: color,
                  border: "2px solid rgba(255,255,255,0.9)",
                  borderRadius: eq.type === "jockey" ? "50%" : eq.type === "empty-handler" ? 0 : 3,
                  transform: eq.type === "empty-handler" ? "rotate(45deg)" : undefined,
                  cursor: "pointer",
                  pointerEvents: "auto",   // re-enable for hover tooltip
                  transition: "left 1000ms linear, top 1000ms linear",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                }}
                onMouseEnter={e => handleEquipEnter(eq, e)}
                onMouseLeave={handleEquipLeave}
              />
            )
          })}
        </div>

        {/* Passthrough slot for caller-injected canvas content */}
        {children}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          z6 · Chrome — fixed UI, NOT affected by the pan/zoom transform.
          Minimap, zoom controls, scale bar (future), north arrow (future),
          block tooltip, equipment tooltip.
          zIndex values start at 60 to clear all in-canvas layers (0–5).
      ════════════════════════════════════════════════════════════════════ */}

      {/* Zoom controls — bottom-right */}
      <div className="absolute bottom-3 right-3 flex gap-1" style={{ zIndex: 60 }}>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => {
            const r = containerRef.current!.getBoundingClientRect()
            zoomAt(r.width / 2, r.height / 2, 1.25)
          }}
          className="w-8 h-8 bg-white border border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50 flex items-center justify-center shadow-sm"
          style={{ borderRadius: 5 }}
        >+</button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => {
            const r = containerRef.current!.getBoundingClientRect()
            zoomAt(r.width / 2, r.height / 2, 0.8)
          }}
          className="w-8 h-8 bg-white border border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50 flex items-center justify-center shadow-sm"
          style={{ borderRadius: 5 }}
        >−</button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={fitView}
          className="px-2.5 h-8 bg-white border border-slate-300 text-slate-500 text-[10px] font-semibold hover:bg-slate-50 shadow-sm"
          style={{ borderRadius: 5 }}
        >fit</button>
      </div>

      {/* Minimap — bottom-left */}
      {layouts.length > 0 && (
        <MiniMap
          layouts={layouts} tf={tf} dims={dims}
          containerRef={containerRef} zoneBounds={zoneBounds}
        />
      )}

      {/* Block tooltip — follows cursor, suppressed when equipment tooltip is showing */}
      {hoveredLayout && tooltipPos && !hoveredEquip && (
        <BlockTooltip
          layout={hoveredLayout}
          zoneName={zoneNames[hoveredLayout.zone] ?? `Zone ${hoveredLayout.zone}`}
          x={tooltipPos.x} y={tooltipPos.y}
        />
      )}

      {/* Equipment tooltip */}
      {hoveredEquip && equipTooltipPos && (
        <div
          className="absolute pointer-events-none bg-white border border-slate-200 text-[11px] leading-relaxed"
          style={{
            left: equipTooltipPos.x, top: equipTooltipPos.y,
            padding: "6px 10px", borderRadius: 5,
            zIndex: 200, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", maxWidth: 200,
          }}
        >
          <div className="font-bold text-[12px]">{hoveredEquip.id}</div>
          <div className="text-slate-500">{hoveredEquip.operatorName}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block"
              style={{ background: EQ_STATUS_COLOR[hoveredEquip.status] ?? "#9ca3af" }} />
            <span className="capitalize">{hoveredEquip.status}</span>
          </div>
          <div className="text-slate-600 mt-0.5">Block: {hoveredEquip.currentBlock}</div>
          {hoveredEquip.destinationBlock && (
            <div className="text-slate-600">
              → {hoveredEquip.destinationBlock} ({Math.round(hoveredEquip.progress * 100)}%)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── z6 · Minimap ──────────────────────────────────────────────────────────────
// Chrome component — renders at a fixed position, unaffected by pan/zoom.
// Shows zone patches, road-colour ground, and a red viewport indicator rect.

function MiniMap({
  layouts, tf, dims, containerRef, zoneBounds,
}: {
  layouts:      BlockLayout[]
  tf:           { x: number; y: number; scale: number }
  dims:         { width: number; height: number }
  containerRef: React.RefObject<HTMLDivElement>
  zoneBounds:   Map<string, { x1: number; y1: number; x2: number; y2: number }>
}) {
  const scaleX = (MINIMAP_W - 4) / dims.width
  const scaleY = (MINIMAP_H - 20) / dims.height
  const scale  = Math.min(scaleX, scaleY)

  const el = containerRef.current
  const cw = el ? el.getBoundingClientRect().width  : 0
  const ch = el ? el.getBoundingClientRect().height : 0
  const vpX = -tf.x / tf.scale
  const vpY = -tf.y / tf.scale
  const vpW =  cw / tf.scale
  const vpH =  ch / tf.scale

  // Zone patch colours match ZONE_PANEL.blockBg at reduced opacity
  const ZONE_MINI_COLOR: Record<string, string> = {
    A: "#93c5fd", B: "#86efac", C: "#d8b4fe", D: "#fdba74",
    E: "#bbf7d0", S: "#fde047", R: "#cbd5e1",
    F: "#fcd34d", Q: "#6ee7b7",
  }

  return (
    <div
      className="absolute bottom-3 left-3 bg-white border border-slate-300 overflow-hidden shadow-sm"
      style={{ width: MINIMAP_W, height: MINIMAP_H, borderRadius: 5, zIndex: 60 }}
    >
      <div
        className="font-bold tracking-wider text-slate-400 border-b border-slate-200"
        style={{ fontSize: 8, padding: "2px 6px" }}
      >MINIMAP</div>

      <div
        className="relative"
        style={{
          width: MINIMAP_W, height: MINIMAP_H - 18,
          overflow: "hidden",
          // Minimap ground matches z0 concrete base colour
          background: CONCRETE_BASE,
        }}
      >
        {/* Zone patches */}
        {Array.from(zoneBounds.entries()).map(([zoneId, b]) => (
          <div
            key={`mini-zone-${zoneId}`}
            className="absolute"
            style={{
              left:   2 + b.x1 * scale,
              top:    b.y1 * scale,
              width:  Math.max(3, (b.x2 - b.x1) * scale),
              height: Math.max(3, (b.y2 - b.y1) * scale),
              background: ZONE_MINI_COLOR[zoneId] ?? "#e5e7eb",
              borderRadius: 1,
              opacity: 0.7,
            }}
          />
        ))}

        {/* Viewport indicator rect */}
        <div
          className="absolute border border-red-500 pointer-events-none"
          style={{
            background: "rgba(220,38,38,0.08)",
            left:   Math.max(0, 2 + vpX * scale),
            top:    Math.max(0, vpY * scale),
            width:  Math.min(MINIMAP_W - 4, vpW * scale),
            height: Math.min(MINIMAP_H - 22, vpH * scale),
          }}
        />
      </div>
    </div>
  )
}
