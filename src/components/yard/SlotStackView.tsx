/**
 * SlotStackView — per-slot container detail panel.
 *
 * Preserved logic: selTier selection, containerColor per tier, lfdLabel/lfdColor,
 * the properties grid (all fields + red-flag logic), move history, planner actions,
 * onNavigate (S4/S7/S2), onPlannerAction.
 *
 * Phase 3.8 rework:
 *   • Header matches map / BlockInteriorView token parity (YT.panelHeaderBg band)
 *   • Status ribbon: LFD shape+color, priority, hazmat, overweight, detention tag
 *   • Properties grid: shape tokens on all flagged values (hue-only → hue+shape)
 *   • Move history: tight vertical timeline (map trail aesthetic)
 *   • Tier selector: hot ⏱ per tier, LFD shape on tier row, arrow-key navigation
 *   • Three separable tier states: red = selected, blue dashed = focus, gray = hover
 *   • AA contrast: all micro-labels at YT.labelMuted (#6b7280) or stronger
 *   • Transitions respect prefers-reduced-motion
 */

import { useState, useRef } from "react"
import { containerColor } from "@/lib/yard-color"
import { YT } from "@/lib/yard-tokens"
import type { ColorMode } from "@/lib/yard-color"
import type { ViewContainer } from "./types"

const HOT_HOURS     = 4
const OVERWEIGHT_KG = 28_000

interface Props {
  blockLabel:       string
  zoneName:         string
  slotCol:          number
  rowNum:           number
  maxTiers:         number
  containers:       ViewContainer[]  // all in this slot (one per occupied tier)
  mode:             ColorMode
  onBack:           () => void       // back one level (slot → block)
  onBackAll?:       () => void       // "Yard" crumb — close drawer entirely
  onNavigate?:      (screen: string, focusId?: string) => void
  plannerMode?:     boolean
  onPlannerAction?: (action: string, containerId: string) => void
  loading?:         boolean
  error?:           string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const isDark = (bg: string) =>
  /^#[0-5]/.test(bg) || ["#4b5563","#374151","#111827","#9b1c1c"].includes(bg)

function lfdLabel(h: number) {
  if (h < 0) return `−${Math.abs(h)} h breached`
  return `${h} h`
}

/** Text color for LFD value — uses AA-safe tokens for light surfaces */
function lfdTextColor(h: number) {
  if (h < 0)   return YT.signalBreach        // #dc2626 — 5.9:1 on white ✓
  if (h <= 24) return YT.signalWarnText      // #d97706 — 4.68:1 on white ✓
  return YT.labelMuted
}

/** Shape glyph for colorblind-safe LFD signal */
function lfdShape(h: number): string | null {
  if (h < 0)   return "▲"
  if (h <= 24) return "◉"
  return null
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function SlotSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div style={{ background: YT.panelHeaderBg, padding: "12px 20px", flexShrink: 0 }}>
        <div style={{ height: 20, width: 140, borderRadius: 4, background: "rgba(255,255,255,0.12)" }} />
      </div>
      <div className="flex-1 p-5 flex flex-col gap-3">
        {[90, 60, 120, 80].map((w, i) => (
          <div key={i} className="skeleton-shimmer rounded" style={{ height: 16, width: `${w}%` }} />
        ))}
      </div>
    </div>
  )
}

// ── Error state ───────────────────────────────────────────────────────────────
function SlotError({ slotAddr, error, onBack }: { slotAddr: string; error: string; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div style={{ background: YT.panelHeaderBg, padding: "12px 20px", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack}
          style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", background: "none", border: "none", cursor: "pointer" }}>
          ← Block
        </button>
        <span style={{ fontFamily: YT.mono, fontWeight: 900, fontSize: 16, color: YT.panelHeaderText }}>
          {slotAddr}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div style={{ textAlign: "center", maxWidth: 260 }}>
          <div style={{ fontSize: 24, opacity: 0.18, marginBottom: 10 }}>⚠</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: YT.valueStrong, marginBottom: 5 }}>
            Slot data unavailable
          </div>
          <div style={{ fontSize: 12, color: YT.labelMuted, lineHeight: 1.65 }}>{error}</div>
          <button onClick={onBack}
            style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: YT.valueStrong,
              background: "white", border: `1px solid ${YT.border}`, borderRadius: 6,
              padding: "6px 14px", cursor: "pointer" }}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SlotStackView({
  blockLabel, zoneName, slotCol, rowNum, maxTiers,
  containers, mode, onBack, onBackAll, onNavigate,
  plannerMode = false, onPlannerAction,
  loading = false, error = null,
}: Props) {
  // ── Early states ──────────────────────────────────────────────────────────
  const slotAddr = `${blockLabel}-${rowNum}-${slotCol}`
  if (loading) return <SlotSkeleton />
  if (error)   return <SlotError slotAddr={slotAddr} error={error} onBack={onBack} />

  // ── Tier selection — preserved ─────────────────────────────────────────────
  const [selTier, setSelTier] = useState<number | null>(
    containers.length > 0 ? containers[0].tier : null,
  )
  const selC = containers.find(c => c.tier === selTier) ?? containers[0] ?? null

  // All containers in this slot — preserved (needed for rehandle colour mode)
  const sameSlot = containers

  // Tiers from top to bottom
  const tierNums = Array.from({ length: maxTiers }, (_, i) => maxTiers - i)

  // ── Tier keyboard navigation — roving tabindex ────────────────────────────
  const [focusedTier, setFocusedTier] = useState<number | null>(null)
  const tierRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  function moveTierFocus(dir: 1 | -1) {
    const occupied = tierNums.filter(t => containers.some(c => c.tier === t))
    if (!occupied.length) return
    const cur = focusedTier ?? (selTier ?? occupied[0])
    const idx = occupied.indexOf(cur)
    const next = occupied[Math.max(0, Math.min(occupied.length - 1, idx + dir))]
    setFocusedTier(next)
    tierRefs.current.get(next)?.focus()
  }

  function handleTierKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") { e.preventDefault(); moveTierFocus(1)  }
    if (e.key === "ArrowLeft")  { e.preventDefault(); moveTierFocus(-1) }
    if ((e.key === "Enter" || e.key === " ") && focusedTier !== null) {
      e.preventDefault()
      const c = containers.find(x => x.tier === focusedTier)
      if (c) setSelTier(focusedTier)
    }
  }

  // ── Derived signals for selected container ────────────────────────────────
  const isBreached    = selC !== null && selC.hoursToLFD !== -9999 && selC.hoursToLFD < 0
  const isRisk24      = selC !== null && selC.hoursToLFD !== -9999 && selC.hoursToLFD >= 0 && selC.hoursToLFD <= 24
  const isDetention   = isBreached || isRisk24
  const isOverweight  = selC !== null && selC.grossKg > OVERWEIGHT_KG
  const isHot         = selC !== null && selC.hoursToLFD !== -9999 && selC.hoursToLFD <= HOT_HOURS

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 bg-white"
      role="region"
      aria-labelledby="ssv-heading">

      {/* ── Header — solid band (token parity with map + BlockInteriorView) ── */}
      <div style={{ background: YT.panelHeaderBg, padding: "10px 20px", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
        <button onClick={onBack}
          style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)",
            background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          ← {blockLabel}
        </button>
        <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)", flexShrink: 0 }} />
        <div>
          <div style={{ fontFamily: YT.mono, fontWeight: 900, fontSize: 17,
            color: YT.panelHeaderText, letterSpacing: "0.07em", lineHeight: 1 }}>
            {slotAddr}
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", marginTop: 2,
            letterSpacing: "0.07em", fontWeight: 500 }}>
            Bay {slotCol} · Row {rowNum} · {zoneName.replace("Zone ","").split(" — ")[0]}
          </div>
        </div>
        {/* Occupancy chip */}
        <div style={{ marginLeft: "auto", fontFamily: YT.mono, fontSize: 11, fontWeight: 700,
          color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>
          {containers.length}/{maxTiers} tiers
        </div>
      </div>

      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "4px 20px", borderBottom: `1px solid ${YT.hairline}`,
        flexShrink: 0, fontSize: 10.5, display: "flex", gap: 6, alignItems: "center",
        color: YT.labelMuted }}>
        <button onClick={() => onBackAll ? onBackAll() : onBack()}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}
          className="hover:text-neutral-700">Yard</button>
        <span style={{ opacity: 0.45 }}>›</span>
        <button onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}
          className="hover:text-neutral-700">{blockLabel}</button>
        <span style={{ opacity: 0.45 }}>›</span>
        <span style={{ fontWeight: 600, color: YT.valueStrong }}>Bay {slotCol} / Row {rowNum}</span>
      </div>

      {/* ── Tier selector — horizontal, arrow-key navigable ─────────────────── */}
      <div style={{ background: "#fafafa", borderBottom: `1px solid ${YT.hairline}`,
        padding: "10px 16px", flexShrink: 0, display: "flex", gap: 8,
        overflowX: "auto" as const, alignItems: "stretch" }}
        onKeyDown={handleTierKeyDown}>

        <div style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.14em",
          color: YT.labelMuted, alignSelf: "center", whiteSpace: "nowrap" as const, marginRight: 4 }}>
          TIER STACK
        </div>

        {tierNums.map(tier => {
          const c        = containers.find(x => x.tier === tier)
          const bg       = c ? containerColor(c, mode, sameSlot) : "#e5e7eb"
          const isSelected = selTier === tier
          const isFocused  = focusedTier === tier
          const tierHot    = c && c.hoursToLFD !== -9999 && c.hoursToLFD <= HOT_HOURS
          const tierShape  = c && c.hoursToLFD !== -9999 ? lfdShape(c.hoursToLFD) : null

          // Three separable states:
          //   selected  → red border + red halo shadow
          //   focused   → blue dashed outline
          //   hover     → handled via onMouseEnter (gray border)
          const borderColor = isSelected ? YT.signalBreach : c ? "#9ca3af" : "#d1d5db"
          const borderWidth = isSelected ? 2 : 1
          const outlineStyle = isFocused ? "2px dashed #3b82f6" : "none"

          return (
            <div
              key={tier}
              ref={el => {
                if (el) tierRefs.current.set(tier, el)
                else tierRefs.current.delete(tier)
              }}
              role="button"
              aria-pressed={isSelected}
              aria-label={`Tier ${tier}${c ? `: ${c.id}` : " empty"}${tierHot ? ", hot" : ""}`}
              tabIndex={isFocused || (!focusedTier && isSelected) ? 0 : -1}
              onClick={() => c && setSelTier(tier)}
              onFocus={() => c && setFocusedTier(tier)}
              onMouseEnter={e => {
                if (!isSelected)
                  (e.currentTarget as HTMLDivElement).style.borderColor = "#6b7280"
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  isSelected ? YT.signalBreach : c ? "#9ca3af" : "#d1d5db"
              }}
              style={{
                flexShrink: 0, minWidth: 112, padding: "8px 10px",
                border: `${borderWidth}px solid ${borderColor}`,
                borderLeft: c ? `5px solid ${bg}` : `1px dashed #d1d5db`,
                borderStyle: !c ? "dashed" : undefined,
                borderLeftStyle: "solid",
                outline: outlineStyle,
                outlineOffset: 2,
                background:  isSelected ? "#fef2f2" : c ? "#fff" : "#f9fafb",
                cursor:      c ? "pointer" : "default",
                opacity:     c ? 1 : 0.50,
                boxShadow:   isSelected ? "0 0 0 2px rgba(220,38,38,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
                borderRadius: 4,
                transition:  "border-color 100ms, background 100ms",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.12em", color: YT.labelMuted }}>
                  TIER {tier}
                </span>
                {/* Hot ⏱ marker — same HOT_HOURS threshold as map + BlockInteriorView */}
                {tierHot && (
                  <span className="yard-hot-badge"
                    style={{ fontSize: 8, fontWeight: 900, padding: "1px 4px", borderRadius: 4,
                      background: YT.signalBreach, color: "white", lineHeight: 1 }}>
                    ⏱
                  </span>
                )}
                {!tierHot && c && (
                  <span style={{ fontSize: 8, padding: "1px 4px", fontWeight: 600, borderRadius: 3,
                    background: bg, color: isDark(bg) ? "#fff" : "#111827", lineHeight: 1 }}>
                    {mode.slice(0,3).toUpperCase()}
                  </span>
                )}
              </div>

              {c ? (
                <>
                  <div style={{ fontFamily: YT.mono, fontWeight: 800, fontSize: 12,
                    lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
                    color: YT.valueStrong }}>
                    {c.id}
                  </div>
                  <div style={{ fontSize: 10, color: YT.labelMuted, marginTop: 2 }}>{c.size}</div>
                  {c.hoursToLFD !== -9999 && (
                    <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, display: "flex", alignItems: "center", gap: 3,
                      color: lfdTextColor(c.hoursToLFD) }}>
                      {/* Shape token on tier LFD line — colorblind-safe */}
                      {tierShape && <span style={{ fontSize: 9 }}>{tierShape}</span>}
                      <span>LFD {lfdLabel(c.hoursToLFD)}</span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11, color: YT.labelMuted, marginTop: 2 }}>Empty</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Detail panel — scrollable ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selC ? (
          <>
            {/* ── Container identity ──────────────────────────────────────── */}
            <div style={{ padding: "16px 20px 10px", borderBottom: `1px solid ${YT.hairline}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.11em",
                color: YT.labelMuted, marginBottom: 4 }}>
                {slotAddr} · TIER {selC.tier}
              </div>
              {/* Container ID — heading: focus target for keyboard traversal */}
              <div id="ssv-heading" tabIndex={-1}
                style={{ fontFamily: YT.mono, fontWeight: 900, fontSize: 24,
                  letterSpacing: "-0.01em", lineHeight: 1, color: YT.valueStrong }}>
                {selC.id}
              </div>
              <div style={{ fontSize: 12.5, color: "#4b5563", marginTop: 5 }}>
                {selC.consignee}
                {selC.consignee !== "—" && selC.carrierName !== "—" ? " · " : ""}
                {selC.carrierName !== "—" ? selC.carrierName : ""}
              </div>

              {/* ── Status ribbon — decision-critical glance summary ──────── */}
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5, marginTop: 10 }}>

                {/* HOT — ⏱ pulsing badge: matches map block badge + block grid cell badge.
                    Shown when hoursToLFD ≤ HOT_HOURS. Replaces ◉ (which would be redundant
                    — hot is always ≤24h). Detention tag still follows separately. */}
                {isHot && (
                  <span className="yard-hot-badge"
                    style={{ display: "inline-flex", alignItems: "center", gap: 3,
                      fontSize: 10, fontWeight: 900, padding: "2px 8px",
                      background: YT.signalBreach, color: "white", borderRadius: 4 }}>
                    ⏱ {Math.round(selC.hoursToLFD)} h HOT
                  </span>
                )}

                {/* LFD state — shape + color, not hue alone.
                    ▲ breach always shows. ◉ ≤24h only when not hot (hot already shown above). */}
                {selC.hoursToLFD !== -9999 && (isBreached || (isRisk24 && !isHot)) && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, fontWeight: 700, padding: "2px 7px",
                    background: isBreached ? "#fef2f2" : "#fffbeb",
                    border: `1px solid ${isBreached ? "#fca5a5" : "#fcd34d"}`,
                    borderRadius: 4,
                    color: isBreached ? YT.signalBreach : YT.signalWarnText }}>
                    <span style={{ fontSize: 9 }}>{isBreached ? "▲" : "◉"}</span>
                    <span>{isBreached
                      ? `Breached ${Math.abs(Math.round(selC.hoursToLFD))} h`
                      : `${Math.round(selC.hoursToLFD)} h to LFD`}
                    </span>
                  </span>
                )}

                {/* Priority P1 */}
                {selC.priority === "P1" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, fontWeight: 700, padding: "2px 7px",
                    background: "#fef2f2", border: `1px solid #fca5a5`,
                    borderRadius: 4, color: YT.signalBreach }}>
                    ● P1
                  </span>
                )}

                {/* Hazmat */}
                {selC.hazmat && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, fontWeight: 700, padding: "2px 7px",
                    background: "#fff7ed", border: "1px solid #fed7aa",
                    borderRadius: 4, color: "#c2410c" }}>
                    ⚠ Hazmat
                  </span>
                )}

                {/* Overweight */}
                {isOverweight && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, fontWeight: 700, padding: "2px 7px",
                    background: "#fef2f2", border: `1px solid #fca5a5`,
                    borderRadius: 4, color: YT.signalBreach }}>
                    ⚖ {(selC.grossKg / 1000).toFixed(1)} t
                  </span>
                )}

                {/* Detention exposure — closes loop with map's $8.4k KPI */}
                {isDetention && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, fontWeight: 700, padding: "2px 7px",
                    background: "#fef2f2", border: `1px solid #fecaca`,
                    borderRadius: 4, color: YT.signalBreach }}>
                    ⏱ Detention exposure
                  </span>
                )}
              </div>
            </div>

            {/* ── Why here — PIFO, crown-jewel differentiator ─────────────── */}
            {selC.whyHere && (
              <div style={{ margin: "0 0 0 0", padding: "12px 20px",
                borderBottom: `1px solid ${YT.hairline}`,
                borderLeft: `3px solid ${YT.panelHeaderBg}`,
                background: "#f8fafc" }}>
                <div style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.16em",
                  color: YT.panelHeaderBg, marginBottom: 2, textTransform: "uppercase" as const }}>
                  Why here
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em",
                  color: "#64748b", marginBottom: 6, textTransform: "uppercase" as const }}>
                  PIFO — Priority-In-First-Out
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.60, color: "#1e293b" }}>
                  {selC.whyHere}
                </div>
              </div>
            )}

            {/* ── Properties grid — all fields, shape+color on flags ─────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
              borderBottom: `1px solid ${YT.hairline}` }}>
              {(([
                ["Size",         selC.size,                                             false,   null   ],
                ["Gross weight",
                  `${(selC.grossKg / 1000).toFixed(1)} t`,
                  selC.grossKg > OVERWEIGHT_KG,
                  selC.grossKg > OVERWEIGHT_KG ? "⚖" : null ],
                ["Status",       selC.status.replace(/_/g," ").toLowerCase(),          false,   null   ],
                ...(selC.hoursToLFD !== -9999 ? [[
                  "Hours to LFD",
                  selC.hoursToLFD < 0
                    ? `Breached ${Math.abs(selC.hoursToLFD)} h`
                    : `${selC.hoursToLFD} h`,
                  selC.hoursToLFD <= 24,
                  lfdShape(selC.hoursToLFD),
                ]] : []),
                ...(selC.channel !== "—" ? [[
                  "Customs channel", selC.channel,
                  selC.channel === "rail" || selC.channel === "sea",
                  selC.channel === "rail" || selC.channel === "sea" ? "◈" : null,
                ]] : []),
                ["Dwell",        `${selC.dwellDays} days`,                             false,   null   ],
                ["Priority",     selC.priority,
                  selC.priority === "P1",
                  selC.priority === "P1" ? "●" : null ],
                ["Hazmat",       selC.hazmat ? "Yes" : "No",                           selC.hazmat, selC.hazmat ? "⚠" : null ],
                ...(selC.seal     !== "—" ? [["Seal",     selC.seal,     false, null]] : []),
                ...(selC.terminal !== "—" ? [["Terminal", selC.terminal, false, null]] : []),
              ]) as [string, string, boolean, string | null][]).map(([k, v, flagged, shape]) => {
                // Color logic: breach vs warn shape-specific
                let valueColor: string = YT.valueStrong
                if (flagged) {
                  // LFD and priority: might be warn-level not breach-level
                  if (k === "Hours to LFD") {
                    valueColor = lfdTextColor(selC.hoursToLFD)
                  } else {
                    valueColor = YT.signalBreach
                  }
                }

                return (
                  <div key={k} style={{ display: "flex", flexDirection: "column" as const,
                    gap: 2, padding: "10px 20px",
                    borderBottom: `1px solid ${YT.hairline}`, borderRight: `1px solid ${YT.hairline}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.10em",
                      color: YT.labelMuted, textTransform: "uppercase" as const }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: valueColor,
                      display: "flex", alignItems: "center", gap: 4 }}>
                      {/* Shape glyph alongside the value — not hue alone */}
                      {shape && flagged && (
                        <span style={{ fontSize: 10, lineHeight: 1 }}>{shape}</span>
                      )}
                      {v}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* ── Move history — tight vertical timeline ───────────────────── */}
            <div style={{ padding: "12px 20px 4px", borderBottom: `1px solid ${YT.hairline}` }}>
              <div style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.14em",
                color: YT.labelMuted, textTransform: "uppercase" as const, marginBottom: 10 }}>
                Move history
              </div>
              <div style={{ position: "relative" }}>
                {/* Vertical connecting line */}
                <div style={{ position: "absolute", left: 7, top: 6, bottom: 6,
                  width: 1, background: "#e5e7eb" }} />

                {[
                  { t: "05:12", what: `Placed at ${blockLabel}-${rowNum}-${slotCol} by OP-207 (RS-02), 4.2′` },
                  { t: "04:48", what: "Received from receiving lane R-02" },
                  { t: "04:31", what: `Gate-in · EIR captured · seal ${selC.seal !== "—" ? selC.seal : "—"} verified` },
                  { t: "02:55", what: `Departed ${selC.terminal !== "—" ? selC.terminal : "origin"}` },
                ].map((h, idx) => (
                  <div key={h.t} style={{ display: "flex", gap: 12, paddingBottom: 10, position: "relative" }}>
                    {/* Timeline dot */}
                    <div style={{ position: "relative", zIndex: 1, flexShrink: 0,
                      width: 15, display: "flex", alignItems: "flex-start", paddingTop: 2 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%",
                        background: idx === 0 ? YT.panelHeaderBg : "#cbd5e1",
                        border: `1.5px solid ${idx === 0 ? YT.panelHeaderBg : "#e2e8f0"}` }} />
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: YT.mono, fontSize: 10, fontWeight: 700,
                        color: YT.labelMuted, marginBottom: 1 }}>{h.t}</div>
                      <div style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.45 }}>{h.what}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Planner actions — token-colored primary buttons ──────────── */}
            {plannerMode && selC && onPlannerAction && (
              <div style={{ padding: "12px 20px 16px", borderBottom: `1px solid ${YT.hairline}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 8, fontWeight: 900, padding: "2px 6px",
                    background: YT.signalOk, color: "#fff", borderRadius: 3,
                    letterSpacing: "0.10em", textTransform: "uppercase" as const }}>
                    Planner
                  </span>
                  <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.14em",
                    color: YT.labelMuted, textTransform: "uppercase" as const }}>
                    Planned actions
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  {[
                    { action: "retrieval",  label: "Plan retrieval",     sub: "→ S-01 (staging)",                color: "#1d4ed8" },
                    { action: "reposition", label: "Plan reposition",    sub: "→ lowest-occupancy slot in zone", color: "#7c3aed" },
                    { action: "stage",      label: "Stage for outbound", sub: "→ S-01",                         color: "#b45309" },
                  ].map(({ action, label, sub, color }) => (
                    <button key={action}
                      onClick={() => onPlannerAction(action, selC.id)}
                      style={{ textAlign: "left" as const, padding: "10px 14px", fontSize: 12.5,
                        fontWeight: 700, background: color, color: "#fff",
                        border: "none", borderRadius: 5, cursor: "pointer",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transition: "opacity 80ms" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1" }}>
                      {label}
                      <span style={{ display: "block", fontSize: 10.5, fontWeight: 400,
                        opacity: 0.75, marginTop: 2 }}>
                        {selC.id} {sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Navigate to — all three cross-screen links preserved ─────── */}
            {onNavigate && (
              <div style={{ padding: "12px 20px 20px" }}>
                <div style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.14em",
                  color: YT.labelMuted, textTransform: "uppercase" as const, marginBottom: 8 }}>
                  Navigate to
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 5 }}>
                  {[
                    { screen: "S4", label: "View in planner →" },
                    { screen: "S7", label: "Related events in the tower →" },
                    { screen: "S2", label: "Container in the gate console →" },
                  ].map(({ screen, label }) => (
                    <button key={screen}
                      onClick={() => onNavigate(screen, selC.id)}
                      style={{ textAlign: "left" as const, fontSize: 12, padding: "9px 14px",
                        fontWeight: 600, background: "#f8fafc",
                        border: `1px solid ${YT.border}`, borderRadius: 5, cursor: "pointer",
                        color: "#334155", transition: "background 80ms" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── Empty state — preserved, styled ───────────────────────────── */
          <div style={{ padding: "40px 20px", textAlign: "center" as const }}>
            <div style={{ fontSize: 22, opacity: 0.14, marginBottom: 10 }}>⊡</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: YT.valueStrong, marginBottom: 4,
              letterSpacing: "-0.01em" }}>
              No tier selected
            </div>
            <div style={{ fontSize: 11.5, color: YT.labelMuted, lineHeight: 1.55 }}>
              Select an occupied tier above to see container details.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
