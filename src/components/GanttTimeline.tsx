/**
 * GanttTimeline — operator Gantt for Live Operations.
 *
 * One row per on-shift yard operator, bars = allocated jobs positioned
 * by startMin→endMin across the 06–14 shift axis.
 *
 * Lanes are derived dynamically from the moves data (top operators by
 * job count) so the chart never silently empties when operator name
 * strings change.
 *
 * Bar phase relative to `now` (AS-OF selector):
 *   ahead    → full-height, light-fill planned block  (grey tint)
 *   crossing → full-height solid fill                 (type color)
 *   passed   → thin centred sliver ~27%               (done trail)
 *
 * A live-clock now-line advances every second via setInterval.
 * Collapse transitions respect prefers-reduced-motion.
 */

import { useEffect, useMemo, useState } from "react"
import type { Move } from "@/data/yard-data"
import { fmtTime } from "@/utils/time"

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  moves:       Move[]
  now:         number   // AS-OF minutes from midnight (drives bar phases)
  shiftStart:  number   // 360
  shiftEnd:    number   // 840
  onHourClick: (min: number) => void
}

// ── Layout constants ──────────────────────────────────────────────────────────
const LABEL_W  = 148  // px – sticky left column
const ROW_H    = 32   // px – full bar / track height
const SLIVER_H = 8    // px – done-trail (~25 % of ROW_H)
const AXIS_H   = 18   // px – compact hour axis (40 % shorter than old 30 px)
const HOURS    = [6, 7, 8, 9, 10, 11, 12, 13] as const

// ── Move-type display config ── all colors are existing DS tokens ─────────────
const TYPE_CFG: Record<string, { color: string; tint: string; label: string }> = {
  RETRIEVE_STAGE:    { color: "var(--ds-green)",  tint: "#d1fae5", label: "Retrieve"    },
  PLACE_INBOUND:     { color: "var(--ds-blue)",   tint: "#dbeafe", label: "Put-away"    },
  RESHUFFLE:         { color: "var(--ds-amber)",  tint: "#fef3c7", label: "Rehandle"    },
  LOAD_OUTBOUND:     { color: "var(--ds-purple)", tint: "#ede9fe", label: "Load out"    },
  PRE_MARSHAL:       { color: "var(--ds-cyan)",   tint: "#cffafe", label: "Pre-marshal" },
  RECEIVE_FROM_LANE: { color: "var(--ds-green)",  tint: "#d1fae5", label: "Gate receipt"},
  MOVE_INSPECTION:   { color: "var(--ds-red)",    tint: "#fee2e2", label: "Inspection"  },
}
const FALLBACK_CFG = { color: "var(--ds-muted)", tint: "#f3f4f6", label: "Move" }

// Types shown in the legend strip (most common)
const LEGEND_TYPES = ["RETRIEVE_STAGE", "PLACE_INBOUND", "RESHUFFLE", "LOAD_OUTBOUND", "PRE_MARSHAL"] as const

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useLiveMin(): number {
  const now = () => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  }
  const [m, setM] = useState(now)
  useEffect(() => {
    const id = setInterval(() => setM(now), 1_000)
    return () => clearInterval(id)
  }, [])
  return m
}

function useReducedMotion(): boolean {
  const [rm, setRm] = useState(
    () => typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  )
  useEffect(() => {
    const mq  = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onC = (e: MediaQueryListEvent) => setRm(e.matches)
    mq.addEventListener("change", onC)
    return () => mq.removeEventListener("change", onC)
  }, [])
  return rm
}

// ── Position helpers ──────────────────────────────────────────────────────────
function pct(min: number, s: number, e: number) {
  return `${Math.max(0, Math.min(100, (min - s) / (e - s) * 100)).toFixed(3)}%`
}

type Phase = "ahead" | "crossing" | "passed"
function barPhase(m: Move, now: number): Phase {
  if (m.endMin   <= now) return "passed"
  if (m.startMin <= now) return "crossing"
  return "ahead"
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GanttTimeline({ moves, now, shiftStart, shiftEnd, onHourClick }: Props) {
  const liveMin  = useLiveMin()
  const noMotion = useReducedMotion()

  // Clamp live-clock line to shift window
  const clampedLive = Math.max(shiftStart, Math.min(shiftEnd, liveMin))
  const livePct = pct(clampedLive, shiftStart, shiftEnd)
  const asPct   = pct(now, shiftStart, shiftEnd)

  // ── Derive operator lanes dynamically from moves data ─────────────────────
  // Group by operatorName, take the top-N by job count so the chart
  // always has content even if names shift.
  const lanes = useMemo(() => {
    const byOp = new Map<string, { moves: Move[]; equipment: string }>()
    for (const m of moves) {
      if (!m.operatorName) continue
      if (!byOp.has(m.operatorName)) {
        byOp.set(m.operatorName, { moves: [], equipment: m.equipment ?? "" })
      }
      byOp.get(m.operatorName)!.moves.push(m)
    }
    // Sort by job count desc, take top 4 (or fewer if < 4 operators)
    return [...byOp.entries()]
      .sort((a, b) => b[1].moves.length - a[1].moves.length)
      .slice(0, 4)
      .map(([name, { moves: lm, equipment }]) => ({ name, equipment, moves: lm }))
  }, [moves])

  // DS token shortcuts
  const SFC  = "var(--ds-surface)"
  const BG   = "var(--ds-background)"
  const BDR  = "1px solid var(--ds-border)"
  const BDRL = "1px solid var(--ds-border-lt)"

  return (
    <div
      role="region"
      aria-label="Operator Gantt — shift 06:00 to 14:00"
      style={{ overflowX: "auto", background: BG }}
    >
      <div style={{ minWidth: LABEL_W + 520, position: "relative" }}>

        {/* ── Legend / title strip ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: `4px 10px`, paddingLeft: LABEL_W + 10,
          borderBottom: BDRL, background: BG,
        }}>
          <span className="ds-label" style={{ color: "var(--ds-subtle)", marginRight: 2 }}>
            Operator schedule
          </span>
          {LEGEND_TYPES.map(t => {
            const cfg = TYPE_CFG[t]
            return (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden="true" style={{
                  display: "inline-block", width: 10, height: 10,
                  borderRadius: 2, flexShrink: 0,
                  background: cfg.color,
                }} />
                <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ds-subtle)" }}>
                  {cfg.label}
                </span>
              </span>
            )
          })}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden="true" style={{
              display: "inline-block", width: 2, height: 11,
              background: "var(--ds-accent)", borderRadius: 1, flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ds-subtle)" }}>
              Live · click hour to jump
            </span>
          </span>
        </div>

        {/* ── Hour axis ───────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", height: AXIS_H,
          position: "sticky", top: 0, zIndex: 4,
          background: BG, borderBottom: BDR,
        }}>
          {/* Sticky label spacer */}
          <div style={{
            width: LABEL_W, flexShrink: 0,
            position: "sticky", left: 0, zIndex: 5,
            background: BG, borderRight: BDR,
          }} />

          {/* Tick buttons */}
          <div style={{ flex: 1, position: "relative" }}>
            {HOURS.map(h => {
              const left = pct(h * 60, shiftStart, shiftEnd)
              const isAs = h * 60 === now
              return (
                <button
                  key={h}
                  onClick={() => onHourClick(h * 60)}
                  aria-label={`Jump to ${String(h).padStart(2, "0")}:00`}
                  title={`Jump to ${String(h).padStart(2, "0")}:00`}
                  style={{
                    position: "absolute", left, top: 0, height: "100%",
                    transform: "translateX(-50%)",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 1,
                    background: "transparent", border: "none",
                    cursor: "pointer", padding: "0 6px",
                  }}
                >
                  <span style={{
                    display: "block", width: 1, height: 4, flexShrink: 0,
                    background: isAs ? "var(--ds-accent)" : "var(--ds-decorative)",
                  }} />
                  <span style={{
                    fontSize: 10, lineHeight: 1.1,
                    fontWeight: isAs ? 700 : 500,
                    fontFamily: "var(--font-mono)",
                    color: isAs ? "var(--ds-accent)" : "var(--ds-subtle)",
                    letterSpacing: "0.02em",
                  }}>
                    {String(h).padStart(2, "0")}
                  </span>
                </button>
              )
            })}

            {/* End tick at 14 */}
            <div style={{
              position: "absolute", right: 0, top: 0, height: "100%",
              transform: "translateX(50%)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 1,
              pointerEvents: "none",
            }}>
              <span style={{ display: "block", width: 1, height: 4, background: "var(--ds-decorative)" }} />
              <span style={{ fontSize: 10, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--ds-subtle)" }}>14</span>
            </div>

            {/* Live now line in axis */}
            <div aria-hidden="true" style={{
              position: "absolute", left: livePct,
              top: 0, bottom: 0, width: 1.5,
              background: "var(--ds-accent)", opacity: 0.9,
              pointerEvents: "none", zIndex: 2,
            }} />
          </div>
        </div>

        {/* ── Operator rows ────────────────────────────────────────────────── */}
        {lanes.map((lane, laneIdx) => (
          <div
            key={lane.name}
            style={{
              display: "flex",
              height: ROW_H + 4,
              borderBottom: laneIdx < lanes.length - 1 ? BDRL : BDR,
            }}
          >
            {/* ── Sticky label ─────────────────────────────────────────────── */}
            <div style={{
              width: LABEL_W, flexShrink: 0,
              position: "sticky", left: 0, zIndex: 2,
              background: SFC, borderRight: BDR,
              display: "flex", flexDirection: "column",
              justifyContent: "center",
              paddingLeft: 10, gap: 1,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, lineHeight: 1.2,
                color: "var(--ds-fg)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {lane.name}
              </span>
              <span style={{
                fontSize: 9.5, lineHeight: 1.2,
                color: "var(--ds-subtle)", whiteSpace: "nowrap",
              }}>
                {lane.equipment} · {lane.moves.length} jobs
              </span>
            </div>

            {/* ── Timeline track ───────────────────────────────────────────── */}
            <div style={{ flex: 1, position: "relative", overflow: "hidden", background: SFC }}>

              {/* Hour grid lines */}
              {HOURS.map(h => (
                <div key={h} aria-hidden="true" style={{
                  position: "absolute",
                  left: pct(h * 60, shiftStart, shiftEnd),
                  top: 0, bottom: 0, width: 1,
                  background: "var(--ds-border-lt)",
                  pointerEvents: "none",
                }} />
              ))}

              {/* Alternating hour zebra */}
              {HOURS.map((h, i) => i % 2 === 1 ? (
                <div key={h} aria-hidden="true" style={{
                  position: "absolute",
                  left: pct(h * 60, shiftStart, shiftEnd),
                  width: "12.5%",
                  top: 0, bottom: 0,
                  background: "rgba(0,0,0,0.014)",
                  pointerEvents: "none",
                }} />
              ) : null)}

              {/* AS-OF line */}
              <div aria-hidden="true" style={{
                position: "absolute", left: asPct,
                top: 0, bottom: 0, width: 1,
                background: "var(--ds-accent)", opacity: 0.22,
                pointerEvents: "none", zIndex: 2,
              }} />

              {/* Live now line */}
              <div aria-hidden="true" style={{
                position: "absolute", left: livePct,
                top: 0, bottom: 0, width: 1.5,
                background: "var(--ds-accent)", opacity: 0.9,
                pointerEvents: "none", zIndex: 5,
              }} />

              {/* ── Job bars ─────────────────────────────────────────────── */}
              {lane.moves.map(m => {
                const ph  = barPhase(m, now)
                const cfg = TYPE_CFG[m.type] ?? FALLBACK_CFG
                const lbl = cfg.label

                const barH   = ph === "passed" ? SLIVER_H : ROW_H + 4
                const barTop = ph === "passed" ? ((ROW_H + 4 - SLIVER_H) / 2) : 0

                // ── Bar appearance by phase ────────────────────────────────
                // ahead    → type-tint fill + type-color border (clearly visible, "planned" feel)
                // crossing → solid type-color fill
                // passed   → thin sliver in ds-decorative
                let bg: string, border: string, opacity = 1
                if (ph === "ahead") {
                  bg      = cfg.tint
                  border  = `1.5px solid ${cfg.color}`
                  opacity = 0.75
                } else if (ph === "crossing") {
                  bg     = cfg.color
                  border = "none"
                } else {
                  bg     = "var(--ds-decorative)"
                  border = "none"
                }

                const dur    = (m.endMin - m.startMin) / (shiftEnd - shiftStart) * 100
                const barW   = `${Math.max(0.4, dur).toFixed(3)}%`
                const barL   = pct(m.startMin, shiftStart, shiftEnd)
                const tipStr = `${m.id} · ${lbl} · ${lane.name} · ${fmtTime(m.startMin)}–${fmtTime(m.endMin)} · ${m.state}`

                return (
                  <div
                    key={m.id}
                    role="img"
                    aria-label={`${m.id}: ${lbl}, ${lane.name}, ${fmtTime(m.startMin)}–${fmtTime(m.endMin)}, ${m.state}`}
                    title={tipStr}
                    style={{
                      position: "absolute",
                      left: barL, width: barW,
                      top: barTop, height: barH,
                      background: bg, border,
                      borderRadius: 3,
                      boxSizing: "border-box",
                      opacity,
                      transition: noMotion
                        ? "none"
                        : "height 0.35s ease, top 0.35s ease, opacity 0.25s ease",
                      zIndex: ph === "crossing" ? 3 : 1,
                      cursor: "default",
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* ── Bottom phase legend ──────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12,
          padding: `4px 10px`, paddingLeft: LABEL_W + 10,
          background: BG, borderTop: BDRL,
        }}>
          {[
            { w: 16, h: 8, bg: "#dbeafe", border: `1.5px solid var(--ds-blue)`, opacity: 0.75, label: "Planned (ahead)" },
            { w: 16, h: 8, bg: "var(--ds-fg)",         border: "none", opacity: 1, label: "In progress"     },
            { w: 16, h: 4, bg: "var(--ds-decorative)", border: "none", opacity: 1, label: "Done (trail)"    },
          ].map(l => (
            <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span aria-hidden="true" style={{
                display: "inline-block", width: l.w, height: l.h,
                background: l.bg, border: l.border,
                opacity: l.opacity,
                borderRadius: 2, flexShrink: 0,
              }} />
              <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ds-subtle)", letterSpacing: "0.02em" }}>
                {l.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
