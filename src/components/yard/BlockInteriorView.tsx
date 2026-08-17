/**
 * BlockInteriorView — Block-level slot grid with map-parity signals.
 *
 * Preserved logic: getSegregation, cellContainers, slotTint, search matching,
 * containerColor for fill bar, sameSlot for rehandle mode.
 *
 * Added signals (Phase 3.8):
 *   ⏱N  — hot container badge (hoursToLFD ≤ 4), top-right, pulsing
 *   ▲/◉ — LFD shape+color (colorblind-safe): breached=▲, ≤24h=◉, top-right
 *   ↻   — rehandle debt (earlier-due box buried under later-due box)
 *   ⚖   — overweight cue (grossKg > 28 000)
 *
 * UX floor: three separable states (red border = selected, blue dashed = focus,
 * gray border change = hover). Roving tabindex + arrow-key navigation.
 * AA-contrast column/row headers (#111827 on white = 17:1).
 */

import { useState, useRef } from "react"
import { getSegregation } from "@/data/block-segregation"
import { containerColor } from "@/lib/yard-color"
import { YT } from "@/lib/yard-tokens"
import type { ColorMode } from "@/lib/yard-color"
import type { ViewContainer } from "./types"

interface Props {
  blockLabel:    string
  zoneName:      string
  numCols:       number
  numRows:       number
  maxTiers:      number
  containers:    ViewContainer[]
  mode:          ColorMode
  searchQuery:   string
  selectedSlot:  { col: number; row: number } | null
  onSlotClick:   (col: number, row: number) => void
  onBack:        () => void
  /** Live mode: block data is still loading */
  loading?:      boolean
  /** Live mode: block data failed to load */
  error?:        string | null
}

const CELL_W = 60
const CELL_H = 52

/** Must match computeHotByBlock threshold in yard-layout.ts */
const HOT_HOURS      = 4
/** Matches the reach-envelope check in SlotStackView / placement-rules */
const OVERWEIGHT_KG  = 28_000

// ── Loading skeleton ──────────────────────────────────────────────────────────
function GridSkeleton({ numCols, numRows }: { numCols: number; numRows: number }) {
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      <div style={{ background: YT.panelHeaderBg, padding: "12px 20px", flexShrink: 0 }}>
        <div style={{ height: 20, width: 120, borderRadius: 4, background: "rgba(255,255,255,0.12)" }} />
      </div>
      <div className="flex-1 p-5 flex flex-col gap-2">
        {Array.from({ length: numRows || 3 }, (_, r) => (
          <div key={r} className="flex gap-2">
            {Array.from({ length: numCols || 8 }, (_, c) => (
              <div key={c} className="skeleton-shimmer rounded"
                style={{ width: CELL_W, height: CELL_H, flexShrink: 0 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Error state ───────────────────────────────────────────────────────────────
function GridError({ blockLabel, error, onBack }: { blockLabel: string; error: string; onBack: () => void }) {
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      <div style={{ background: YT.panelHeaderBg, padding: "12px 20px", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack}
          style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", background: "none", border: "none", cursor: "pointer" }}>
          ← Yard
        </button>
        <span style={{ fontFamily: YT.mono, fontWeight: 900, fontSize: 18,
          color: YT.panelHeaderText, letterSpacing: "0.08em" }}>{blockLabel}</span>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div style={{ textAlign: "center", maxWidth: 280 }}>
          <div style={{ fontSize: 26, opacity: 0.20, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: YT.valueStrong, marginBottom: 6, letterSpacing: "-0.01em" }}>
            Block data unavailable
          </div>
          <div style={{ fontSize: 12, color: YT.labelMuted, lineHeight: 1.65 }}>{error}</div>
          <button onClick={onBack}
            style={{ marginTop: 16, fontSize: 11, fontWeight: 600, color: YT.valueStrong,
              background: "white", border: `1px solid ${YT.border}`, borderRadius: 6,
              padding: "6px 16px", cursor: "pointer" }}>
            ← Back to yard
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BlockInteriorView({
  blockLabel, zoneName, numCols, numRows, maxTiers,
  containers, mode, searchQuery, selectedSlot, onSlotClick, onBack,
  loading = false, error = null,
}: Props) {
  // ── Early states ──────────────────────────────────────────────────────────
  if (loading) return <GridSkeleton numCols={numCols} numRows={numRows} />
  if (error)   return <GridError blockLabel={blockLabel} error={error} onBack={onBack} />

  const ql = searchQuery.trim().toLowerCase()

  // ── Segregation ───────────────────────────────────────────────────────────
  const segs = getSegregation(blockLabel)
  const segLegend = segs.filter(
    (s, i, a) => a.findIndex(x => x.type === s.type) === i && s.tint !== "transparent",
  )

  // Helper: segregation tint for a given slot column — preserved
  function slotTint(col: number): string {
    return segs.find(s => col >= s.bayStart && col <= s.bayEnd)?.tint ?? "transparent"
  }

  // ── Cell data helpers — all preserved ────────────────────────────────────
  function cellContainers(col: number, row: number): ViewContainer[] {
    return containers
      .filter(c => c.slotCol === col && c.rowNum === row)
      .sort((a, b) => b.tier - a.tier) // top tier first
  }

  function sameSlot(col: number, row: number) {
    return containers.filter(c => c.slotCol === col && c.rowNum === row)
  }

  function matchesSearch(c: ViewContainer): boolean {
    if (!ql) return true
    return (c.id + c.consignee + c.status).toLowerCase().includes(ql)
  }

  // ── Signal derivation ─────────────────────────────────────────────────────

  /** Count of hot containers (hoursToLFD ≤ HOT_HOURS) in this cell. */
  function cellHotCount(col: number, row: number): number {
    return cellContainers(col, row)
      .filter(c => !c.empty && c.hoursToLFD !== -9999 && c.hoursToLFD <= HOT_HOURS)
      .length
  }

  /** Worst LFD tier across all containers in this cell — drives shape signal. */
  function cellWorstLfd(col: number, row: number): "breached" | "risk24" | null {
    const cs = cellContainers(col, row).filter(c => !c.empty && c.hoursToLFD !== -9999)
    if (!cs.length) return null
    const worst = Math.min(...cs.map(c => c.hoursToLFD))
    if (worst < 0)   return "breached"
    if (worst <= 24) return "risk24"
    return null
  }

  /**
   * Rehandle debt: true when a lower-tier container has an earlier LFD than
   * a container above it.  That earlier-due box is buried and needs a dig-out.
   */
  function cellNeedsRehandle(col: number, row: number): boolean {
    const cs = cellContainers(col, row) // sorted top-first
    for (let i = cs.length - 1; i >= 0; i--) {
      const lower = cs[i]
      if (lower.hoursToLFD === -9999) continue
      for (let j = 0; j < i; j++) {
        const upper = cs[j]
        if (upper.hoursToLFD === -9999) continue
        // lower tier needs out first but is blocked by upper
        if (lower.hoursToLFD < upper.hoursToLFD) return true
      }
    }
    return false
  }

  /** Overweight: any container exceeds the reach-stacker envelope. */
  function cellIsOverweight(col: number, row: number): boolean {
    return cellContainers(col, row).some(c => c.grossKg > OVERWEIGHT_KG)
  }

  // ── Occupancy KPI ─────────────────────────────────────────────────────────
  const filled     = containers.filter(c => !c.empty).length
  const totalSlots = numRows * numCols * maxTiers
  const pct        = totalSlots > 0 ? Math.round(filled / totalSlots * 100) : 0
  const occColor   = pct > 85 ? YT.signalBreach : pct > 65 ? YT.signalWarn : YT.signalOk

  // ── Keyboard navigation — roving tabindex ─────────────────────────────────
  const [focusedCell, setFocusedCell] = useState<{ col: number; row: number } | null>(null)
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  function cellKey(col: number, row: number) { return `${col}-${row}` }

  function moveFocus(dc: number, dr: number) {
    const cur = focusedCell ?? { col: 1, row: 1 }
    const nc = Math.max(1, Math.min(numCols, cur.col + dc))
    const nr = Math.max(1, Math.min(numRows, cur.row + dr))
    setFocusedCell({ col: nc, row: nr })
    cellRefs.current.get(cellKey(nc, nr))?.focus()
  }

  function handleGridKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowLeft":  e.preventDefault(); moveFocus(-1,  0); break
      case "ArrowRight": e.preventDefault(); moveFocus( 1,  0); break
      case "ArrowUp":    e.preventDefault(); moveFocus( 0, -1); break
      case "ArrowDown":  e.preventDefault(); moveFocus( 0,  1); break
      case "Enter": case " ":
        if (focusedCell) { e.preventDefault(); onSlotClick(focusedCell.col, focusedCell.row) }
        break
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">

      {/* ── Header — solid band (YT.panelHeaderBg), map-parity block label ── */}
      <div style={{
        background: YT.panelHeaderBg, padding: "10px 20px", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const,
      }}>
        <button onClick={onBack}
          style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)",
            background: "none", border: "none", cursor: "pointer", padding: 0 }}
          title="Back to yard map">
          ← Yard
        </button>
        <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)", flexShrink: 0 }} />

        {/* Block label — mono/stencil, matching map z4 block label */}
        <div>
          <div style={{ fontFamily: YT.mono, fontWeight: 900, fontSize: 19,
            color: YT.panelHeaderText, letterSpacing: "0.08em", lineHeight: 1 }}>
            {blockLabel}
          </div>
          <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.65)", marginTop: 2,
            letterSpacing: "0.07em", fontWeight: 500 }}>
            {zoneName.replace("Zone ", "").replace(" — ", " · ")}
          </div>
        </div>

        {/* Occupancy bar — thin dedicated bar + %, NOT tinting the whole header */}
        <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column" as const,
          alignItems: "flex-end", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {/* Thin progress bar, same green/amber/red thresholds as map */}
            <div style={{ width: 72, height: 5, background: "rgba(255,255,255,0.14)", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: occColor,
                borderRadius: 3, transition: "width 400ms" }} />
            </div>
            <span style={{ fontFamily: YT.mono, fontSize: 11, fontWeight: 800,
              color: occColor, minWidth: 28, textAlign: "right" as const }}>
              {pct}%
            </span>
          </div>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.65)" }}>
            {filled} / {totalSlots} slots
          </span>
        </div>
      </div>

      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "5px 20px", borderBottom: `1px solid ${YT.hairline}`,
        flexShrink: 0, fontSize: 10.5, display: "flex", gap: 6, alignItems: "center",
        color: YT.labelMuted }}>
        <button onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}
          className="hover:text-neutral-700">
          Yard
        </button>
        <span style={{ opacity: 0.45 }}>›</span>
        <span style={{ fontWeight: 600, color: YT.valueStrong }}>{blockLabel}</span>
      </div>

      {/* ── Segregation legend — map-legend parity: hatch swatch + label ───── */}
      {segLegend.length > 0 && (
        <div style={{ padding: "6px 20px", borderBottom: `1px solid ${YT.hairline}`,
          flexShrink: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em",
            color: YT.labelMuted, flexShrink: 0 }}>SEGREGATION</span>
          {segLegend.map(s => (
            <div key={s.type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {/* Hatch swatch — exact pattern used on cells */}
              <div style={{
                width: 16, height: 13, borderRadius: 2, border: "1px solid rgba(0,0,0,0.10)",
                background: s.tint === "transparent"
                  ? "#fafafa"
                  : `repeating-linear-gradient(45deg, ${s.tint} 0 1.5px, transparent 1.5px 7px), #fafafa`,
              }} />
              <span style={{ fontSize: 10, color: YT.labelMuted, fontWeight: 500 }}>{s.type}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Grid area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto"
        style={{ padding: "14px 16px" }}
        role="grid"
        aria-label={`Block ${blockLabel} slot grid`}
        onKeyDown={handleGridKeyDown}>
        <div className="inline-block">

          {/* Column headers — AA contrast: valueStrong (#111827) on white */}
          <div style={{ display: "flex", marginLeft: 30 }}>
            {Array.from({ length: numCols }, (_, i) => i + 1).map(col => (
              <div key={col} role="columnheader"
                style={{ width: CELL_W, marginRight: 2, textAlign: "center" as const,
                  fontSize: 9, fontWeight: 700, color: YT.valueStrong,
                  letterSpacing: "0.07em", paddingBottom: 3 }}>
                S{col}
              </div>
            ))}
          </div>

          {/* Row grid */}
          {Array.from({ length: numRows }, (_, ri) => ri + 1).map(row => (
            <div key={row} role="row" style={{ display: "flex", alignItems: "stretch", marginBottom: 3 }}>

              {/* Row label — AA contrast: valueStrong on white */}
              <div role="rowheader"
                style={{ width: 28, marginRight: 2, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 9, fontWeight: 700,
                  color: YT.valueStrong, letterSpacing: "0.06em", flexShrink: 0 }}>
                R{row}
              </div>

              {/* Cells */}
              {Array.from({ length: numCols }, (_, ci) => ci + 1).map(col => {
                const cell       = cellContainers(col, row)
                const top        = cell[0]
                const stackH     = cell.length
                const isSelected = selectedSlot?.col === col && selectedSlot?.row === row
                const isFocused  = focusedCell?.col === col && focusedCell?.row === row
                const tint       = slotTint(col)
                const hasMatch   = ql ? cell.some(matchesSearch) : true
                const dimmed     = ql && !hasMatch

                // Signal computations
                const hotCt     = cellHotCount(col, row)
                const lfdState  = cellWorstLfd(col, row)
                const needRH    = cellNeedsRehandle(col, row)
                const overweight = cellIsOverweight(col, row)

                // containerColor for fill bar — unchanged from original
                const barColor = top
                  ? containerColor(top, mode, sameSlot(col, row))
                  : "#d1d5db"
                const fillPct = maxTiers > 0 ? (stackH / maxTiers) * 100 : 0

                // Segregation as diagonal hatch, not flat wash — never competes with fill bar
                const hatchBg = tint !== "transparent"
                  ? `repeating-linear-gradient(45deg, ${tint} 0 1.5px, transparent 1.5px 7px), #fafafa`
                  : "#fafafa"

                // ── Three separable visual states ──────────────────────────
                // 1. Selected — red border (YT.signalBreach) + red shadow halo
                // 2. Keyboard focus — blue dashed outline (2px, offset 2px)
                // 3. Hover — gray border change (handled in onMouseEnter/Leave)
                const borderColor = isSelected ? YT.signalBreach : "#d1d5db"
                const borderWidth = isSelected ? 2 : 1
                const boxShadow   = isSelected
                  ? "0 0 0 2px rgba(220,38,38,0.18), 2px 3px 6px rgba(0,0,0,0.12)"
                  : "2px 3px 6px rgba(0,0,0,0.12)" // map's directional drop shadow always on
                const outlineStyle = isFocused
                  ? "2px dashed #3b82f6"  // keyboard focus ring — blue, distinct from selection
                  : "none"

                return (
                  <div
                    key={col}
                    ref={el => {
                      if (el) cellRefs.current.set(cellKey(col, row), el)
                      else cellRefs.current.delete(cellKey(col, row))
                    }}
                    role="gridcell"
                    aria-label={`S${col} R${row}: ${stackH} container${stackH !== 1 ? "s" : ""}${hotCt > 0 ? `, ${hotCt} hot` : ""}${isSelected ? " (selected)" : ""}`}
                    aria-selected={isSelected}
                    tabIndex={isFocused || (!focusedCell && col === 1 && row === 1) ? 0 : -1}
                    className="relative flex-none"
                    style={{
                      width: CELL_W, height: CELL_H, marginRight: 2,
                      background: hatchBg,
                      border: `${borderWidth}px solid ${borderColor}`,
                      outline: outlineStyle,
                      outlineOffset: 2,
                      borderRadius: 3,
                      cursor: "pointer",
                      opacity: dimmed ? 0.25 : 1,
                      boxShadow,
                      transition: "border-color 100ms, opacity 100ms",
                      position: "relative",
                    }}
                    onClick={() => { setFocusedCell({ col, row }); onSlotClick(col, row) }}
                    onFocus={() => setFocusedCell({ col, row })}
                    onMouseEnter={e => {
                      if (!isSelected)
                        (e.currentTarget as HTMLDivElement).style.borderColor = "#9ca3af"
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor =
                        isSelected ? YT.signalBreach : "#d1d5db"
                    }}
                    title={top
                      ? `${top.id} · tier ${top.tier}${hotCt > 0 ? " · ⏱ HOT" : ""}${overweight ? " · ⚖ OW" : ""}${needRH ? " · ↻ rehandle" : ""}`
                      : `S${col}-R${row} — empty`}
                  >
                    {/* Inner slot grid line — "painted footprint" feel, matching map */}
                    <div className="absolute inset-0 pointer-events-none" style={{
                      borderRadius: 2,
                      backgroundImage: "linear-gradient(rgba(0,0,0,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.045) 1px, transparent 1px)",
                      backgroundSize: "100% 50%, 50% 100%",
                    }} />

                    {/* Stack fill bar — bottom-up, barColor from containerColor — unchanged */}
                    {stackH > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{
                        height: `${fillPct}%`,
                        background: barColor,
                        opacity: 0.70,
                        borderRadius: "0 0 2px 2px",
                      }} />
                    )}

                    {/* ── Signal layer — above fill bar, never hidden ────────── */}

                    {/* HOT badge — ⏱N, top-right, pulsing.
                        .yard-hot-badge handles pulse + prefers-reduced-motion fallback. */}
                    {hotCt > 0 && (
                      <div className="yard-hot-badge absolute flex items-center font-black pointer-events-none"
                        style={{ top: 2, right: 2, background: YT.signalBreach, color: "white",
                          fontSize: 8, padding: "1px 4px 1px 3px", borderRadius: 5,
                          gap: 2, lineHeight: 1, zIndex: 4 }}>
                        <span>⏱</span><span>{hotCt}</span>
                      </div>
                    )}

                    {/* LFD shape signal — only when no hot badge (hot already implies urgency).
                        ▲ = breached (signalBreach), ◉ = ≤ 24 h (signalWarnText on light bg).
                        Colorblind-safe: shape + color redundancy, matching Phase 3.6 cbMode vocab. */}
                    {hotCt === 0 && lfdState && (
                      <div className="absolute pointer-events-none"
                        style={{ top: 2, right: 3, fontSize: 9, fontWeight: 900, lineHeight: 1, zIndex: 4,
                          color: lfdState === "breached" ? YT.signalBreach : YT.signalWarnText }}>
                        {lfdState === "breached" ? "▲" : "◉"}
                      </div>
                    )}

                    {/* Hazmat badge — top-left, always independent of LFD/hot corner */}
                    {top?.hazmat && (
                      <div className="absolute pointer-events-none"
                        style={{ top: 2, left: 3, fontSize: 9, color: "#f97316", lineHeight: 1, zIndex: 4 }}>
                        ⚠
                      </div>
                    )}

                    {/* Bottom-left — top container ID prefix (4 chars) */}
                    {top && (
                      <div className="absolute pointer-events-none"
                        style={{ bottom: 2, left: 3, fontFamily: YT.mono, fontSize: 8,
                          color: "#374151", lineHeight: 1, zIndex: 3 }}>
                        {top.id.slice(0, 4)}
                      </div>
                    )}

                    {/* Bottom-right — overweight ⚖ > rehandle ↻ > stack count.
                        Priority: overweight is the harder constraint so it wins. */}
                    {overweight ? (
                      <div className="absolute pointer-events-none"
                        style={{ bottom: 2, right: 3, fontSize: 9, fontWeight: 900, lineHeight: 1,
                          zIndex: 4, color: YT.signalBreach,
                          textShadow: "0 1px 2px rgba(255,255,255,0.90)" }}>
                        ⚖
                      </div>
                    ) : needRH ? (
                      <div className="absolute pointer-events-none"
                        style={{ bottom: 2, right: 3, fontSize: 9, fontWeight: 900, lineHeight: 1,
                          zIndex: 4, color: YT.signalWarnText,
                          textShadow: "0 1px 2px rgba(255,255,255,0.90)" }}>
                        ↻
                      </div>
                    ) : stackH > 0 ? (
                      <div className="absolute pointer-events-none"
                        style={{ bottom: 2, right: 3, fontFamily: YT.mono, fontSize: 8,
                          color: YT.labelMuted, lineHeight: 1, zIndex: 3 }}>
                        {stackH}/{maxTiers}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* ── Empty state — in-voice, specific, not generic ─────────────────── */}
        {containers.length === 0 && !loading && (
          <div style={{ marginTop: 48, textAlign: "center" as const }}>
            <div style={{ fontSize: 24, opacity: 0.15, lineHeight: 1, marginBottom: 10 }}>□</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: YT.valueStrong, marginBottom: 4,
              letterSpacing: "-0.01em" }}>
              {blockLabel} is clear
            </div>
            <div style={{ fontSize: 11, color: YT.labelMuted }}>
              No containers currently in this block
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
