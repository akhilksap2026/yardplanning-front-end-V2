/**
 * GanttTimeline — two-operator Gantt for Live Operations.
 *
 * One row per yard operator (R. Giménez / M. Sosa), bars = allocated jobs,
 * positioned by startMin→endMin across the 06–14 shift axis.
 *
 * Bar phase driven by `now` (AS-OF selector):
 *   ahead    → full-height grey outline  (planned)
 *   crossing → full-height solid fill    (in progress)
 *   passed   → thin centred sliver ~27%  (done trail)
 *
 * A live-clock line advances every second via setInterval.
 * Collapse transitions respect prefers-reduced-motion.
 */

import { useEffect, useState } from "react"
import type { Move } from "@/data/yard-data"
import { fmtTime } from "@/utils/time"

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  moves:       Move[]
  now:         number   // AS-OF minutes from midnight — drives bar phases
  shiftStart:  number   // 360
  shiftEnd:    number   // 840
  onHourClick: (min: number) => void
}

// ── Layout constants ──────────────────────────────────────────────────────────
const LABEL_W  = 148  // px – sticky left column
const ROW_H    = 30   // px – full bar / track height
const SLIVER_H = 8    // px – done-trail height  (~27% of ROW_H)
const AXIS_H   = 18   // px – compact hour-axis bar (40% shorter than old chart)
const HOURS    = [6, 7, 8, 9, 10, 11, 12, 13] as const

// ── Two operator lanes – derived from the existing seed data ──────────────────
const LANES = [
  { name: "R. Giménez", equipment: "RS-01", id: "OP-114" },
  { name: "M. Sosa",    equipment: "RS-02", id: "OP-207" },
] as const

// ── Move type → existing DS palette token ─────────────────────────────────────
const TYPE_COLOR: Record<string, string> = {
  RETRIEVE_STAGE:    "var(--ds-green)",
  PLACE_INBOUND:     "var(--ds-blue)",
  RESHUFFLE:         "var(--ds-amber)",
  LOAD_OUTBOUND:     "var(--ds-purple)",
  PRE_MARSHAL:       "var(--ds-cyan)",
  RECEIVE_FROM_LANE: "var(--ds-green)",
  MOVE_INSPECTION:   "var(--ds-red)",
}

const TYPE_LABEL: Record<string, string> = {
  RETRIEVE_STAGE:    "Retrieve",
  PLACE_INBOUND:     "Put-away",
  RESHUFFLE:         "Rehandle",
  LOAD_OUTBOUND:     "Load out",
  PRE_MARSHAL:       "Pre-marshal",
  RECEIVE_FROM_LANE: "Gate receipt",
  MOVE_INSPECTION:   "Inspection",
}

// ── Legend items shown in the header strip ────────────────────────────────────
const LEGEND_TYPES = [
  "RETRIEVE_STAGE", "PLACE_INBOUND", "RESHUFFLE", "LOAD_OUTBOUND", "PRE_MARSHAL",
] as const

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(min: number, s: number, e: number): string {
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
  const liveMin   = useLiveMin()
  const noMotion  = useReducedMotion()

  // Clamp live line to shift window
  const clampedLive = Math.max(shiftStart, Math.min(shiftEnd, liveMin))
  const livePct     = pct(clampedLive, shiftStart, shiftEnd)
  const asPct       = pct(now,         shiftStart, shiftEnd)

  // DS token shorthands (avoids repetition without adding new colors)
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
      {/* min-width keeps labels + 8 hour columns readable before H-scroll kicks in */}
      <div style={{ minWidth: LABEL_W + 520, position: "relative" }}>

        {/* ── Legend / title strip ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: `5px 10px`, paddingLeft: LABEL_W + 10,
          borderBottom: BDRL, background: BG,
        }}>
          <span className="ds-label" style={{ color: "var(--ds-subtle)", marginRight: 2 }}>
            Operator schedule
          </span>
          {LEGEND_TYPES.map(t => (
            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{
                display: "inline-block", width: 8, height: 8,
                borderRadius: 2, flexShrink: 0,
                background: TYPE_COLOR[t] ?? "var(--ds-muted)",
              }} />
              <span style={{
                fontSize: 10, fontWeight: 500,
                color: "var(--ds-subtle)", letterSpacing: "0.02em",
              }}>{TYPE_LABEL[t]}</span>
            </span>
          ))}
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
          {/* Left spacer matches label column */}
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
                    fontSize: 10,
                    fontWeight: isAs ? 700 : 500,
                    lineHeight: 1.1,
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
        {LANES.map((lane, laneIdx) => {
          const laneMoves = moves.filter(m => m.operatorName === lane.name)

          return (
            <div
              key={lane.id}
              style={{
                display: "flex",
                height: ROW_H + 4, // 4px breathing room
                borderBottom: laneIdx === 0 ? BDRL : BDR,
              }}
            >
              {/* ── Sticky label ─────────────────────────────────────────── */}
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
                  {lane.equipment} · {laneMoves.length} jobs
                </span>
              </div>

              {/* ── Timeline track ───────────────────────────────────────── */}
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

                {/* Alternating hour columns – very light zebra */}
                {HOURS.map((h, i) => i % 2 === 1 ? (
                  <div key={h} aria-hidden="true" style={{
                    position: "absolute",
                    left: pct(h * 60, shiftStart, shiftEnd),
                    width: "12.5%",
                    top: 0, bottom: 0,
                    background: "rgba(0,0,0,0.013)",
                    pointerEvents: "none",
                  }} />
                ) : null)}

                {/* AS-OF line (user-selected time) */}
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

                {/* ── Job bars ──────────────────────────────────────────── */}
                {laneMoves.map(m => {
                  const ph   = barPhase(m, now)
                  const col  = TYPE_COLOR[m.type] ?? "var(--ds-muted)"
                  const lbl  = TYPE_LABEL[m.type] ?? m.type

                  const barH   = ph === "passed" ? SLIVER_H : ROW_H + 4
                  const barTop = ph === "passed" ? ((ROW_H + 4 - SLIVER_H) / 2) : 0

                  let bg: string, border: string
                  if (ph === "ahead") {
                    bg     = "transparent"
                    border = "1.5px solid var(--ds-border)"
                  } else if (ph === "crossing") {
                    bg     = col
                    border = "none"
                  } else {
                    // passed — compact trail
                    bg     = "var(--ds-decorative)"
                    border = "none"
                  }

                  const barLeft  = pct(m.startMin, shiftStart, shiftEnd)
                  const durShare = Math.max(0.4, (m.endMin - m.startMin) / (shiftEnd - shiftStart) * 100)
                  const barWidth = `${durShare.toFixed(3)}%`

                  const tooltip = `${m.id} · ${lbl} · ${lane.name} · ${fmtTime(m.startMin)}–${fmtTime(m.endMin)} · ${m.state}`

                  return (
                    <div
                      key={m.id}
                      role="img"
                      aria-label={`${m.id}: ${lbl}, ${lane.name}, ${fmtTime(m.startMin)}–${fmtTime(m.endMin)}, ${m.state}`}
                      title={tooltip}
                      style={{
                        position: "absolute",
                        left: barLeft, width: barWidth,
                        top: barTop, height: barH,
                        background: bg, border,
                        borderRadius: 3,
                        boxSizing: "border-box",
                        transition: noMotion ? "none" : "height 0.35s ease, top 0.35s ease",
                        zIndex: ph === "crossing" ? 3 : 1,
                        cursor: "default",
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* ── Bottom legend ────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12,
          padding: `4px 10px`, paddingLeft: LABEL_W + 10,
          background: BG, borderTop: BDRL,
        }}>
          {[
            { h: 8, bg: "transparent",          border: "1.5px solid var(--ds-border)", label: "Planned" },
            { h: 8, bg: "var(--ds-fg)",          border: "none",                        label: "In progress" },
            { h: 4, bg: "var(--ds-decorative)",  border: "none",                        label: "Done (trail)" },
          ].map(l => (
            <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{
                display: "inline-block", width: 16, height: l.h,
                background: l.bg, border: l.border,
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
