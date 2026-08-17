/**
 * GanttTimeline — two-operator Gantt for Live Operations.
 *
 * Data source: planningResults.json via planningData.ts
 * Operators:   J-1 Alex Rivera (56 steps), J-3 George Burns (62 steps)
 * Shift:       20:00 → 05:30 (SHIFT_START_MIN=1200, SHIFT_DURATION_MIN=570)
 *
 * Bar phase is driven by an internal AS-OF clock (click hour ticks to advance).
 * A live now-line advances every second and is clamped to the shift window.
 *
 * Bar states:
 *   ahead    → type-tinted fill + color border (planned, not started)
 *   crossing → solid type-color fill            (in progress)
 *   passed   → thin centred sliver             (done trail)
 *
 * Transitions respect prefers-reduced-motion.
 */

import { useEffect, useMemo, useState } from "react"
import {
  stepsForOperator, type PlanningStep,
  SHIFT_START_MIN, SHIFT_DURATION_MIN, GANTT_HOURS,
} from "@/data/planningData"

// ── Two operator lanes — names exactly as stored in planningResults.json ──────
const LANES = [
  { key: "J-1 Alex Rivera",  label: "J-1 Alex Rivera",  badge: "J-1", steps: 56 },
  { key: "J-3 George Burns", label: "J-3 George Burns", badge: "J-3", steps: 62 },
] as const

// ── Operation → DS palette (matches existing NightPlanner MOVE_TYPE_STYLE) ────
interface OpCfg { color: string; tint: string; label: string }
const OP_CFG: Record<string, OpCfg> = {
  "Putaway":                            { color: "#2563eb", tint: "#dbeafe", label: "Putaway"           },
  "Outbound staging and truck loading": { color: "#0d9488", tint: "#ccfbf1", label: "Retrieval/Stage"   },
  "Premarshal ahead of retrieval":      { color: "#7c3aed", tint: "#ede9fe", label: "Pre-marshal"       },
  "Digout to clear an overstow":        { color: "#ea580c", tint: "#ffedd5", label: "Extra Move"        },
  "Discharge from vessel":              { color: "#0891b2", tint: "#cffafe", label: "Discharge"         },
}
const FALLBACK_CFG: OpCfg = { color: "#6b7280", tint: "#f3f4f6", label: "Move" }

const LEGEND_OPS = [
  "Putaway",
  "Outbound staging and truck loading",
  "Premarshal ahead of retrieval",
  "Digout to clear an overstow",
] as const

// ── Layout constants ──────────────────────────────────────────────────────────
const LABEL_W  = 156  // px – sticky left label column
const ROW_H    = 32   // px – track / full-bar height
const SLIVER_H = 8    // px – done-trail height (~25% of ROW_H)
const AXIS_H   = 18   // px – hour axis strip

// Shift bounds
const SHIFT_END_MIN = SHIFT_START_MIN + SHIFT_DURATION_MIN  // 1200 + 570 = 1770

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert an ISO timestamp to minutes-from-midnight (handles midnight crossover). */
function isoToMin(iso: string | null): number | null {
  if (!iso) return null
  const d   = new Date(iso)
  const h   = d.getUTCHours()
  const m   = d.getUTCMinutes()
  const raw = h * 60 + m
  // Times 00:00–07:59 are past midnight — add 1440 to put them after 20:00 on the axis
  return h < 20 ? raw + 1440 : raw
}

/** Position a shift-relative minute as a CSS percentage string. */
function pct(min: number) {
  return `${Math.max(0, Math.min(100, (min - SHIFT_START_MIN) / SHIFT_DURATION_MIN * 100)).toFixed(3)}%`
}

type Phase = "ahead" | "crossing" | "passed"
function barPhase(startMin: number, endMin: number, asOf: number): Phase {
  if (endMin   <= asOf) return "passed"
  if (startMin <= asOf) return "crossing"
  return "ahead"
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useLiveMin(): number {
  const tick = () => {
    const d = new Date()
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds()
    const raw = h * 60 + m + s / 60
    return h < 20 ? raw + 1440 : raw
  }
  const [v, setV] = useState(tick)
  useEffect(() => {
    const id = setInterval(() => setV(tick), 1_000)
    return () => clearInterval(id)
  }, [])
  return v
}

function useReducedMotion(): boolean {
  const [rm, setRm] = useState(
    () => typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  )
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const fn = (e: MediaQueryListEvent) => setRm(e.matches)
    mq.addEventListener("change", fn)
    return () => mq.removeEventListener("change", fn)
  }, [])
  return rm
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  /** Optional: called when a lane-hour tick is clicked (passes shift minutes). */
  onHourClick?: (shiftMin: number) => void
}

export default function GanttTimeline({ onHourClick }: Props) {
  const liveMin  = useLiveMin()
  const noMotion = useReducedMotion()

  // AS-OF state: starts at shift start; hour ticks advance it
  const [asOf, setAsOf] = useState(SHIFT_START_MIN)

  const clampedLive = Math.max(SHIFT_START_MIN, Math.min(SHIFT_END_MIN, liveMin))
  const livePct = pct(clampedLive)
  const asPct   = pct(asOf)

  // ── Fetch and memoize steps for each lane ───────────────────────────────
  const laneSteps = useMemo(() =>
    LANES.map(lane => ({
      ...lane,
      steps: stepsForOperator(lane.key).map(s => ({
        id:       s.activity_id ?? `${s.operator}-${s.step_number}`,
        op:       s.operation,
        status:   s.step_status,
        startMin: isoToMin(s.estimated_start),
        endMin:   isoToMin(s.estimated_end),
      })).filter(s => s.startMin !== null && s.endMin !== null) as Array<{
        id: string; op: string; status: string; startMin: number; endMin: number
      }>,
    })),
  [])

  // DS token shortcuts
  const BG   = "var(--ds-background)"
  const SFC  = "var(--ds-surface)"
  const BDR  = "1px solid var(--ds-border)"
  const BDRL = "1px solid var(--ds-border-lt)"

  // Parse GANTT_HOURS into shift-relative minutes for positioning
  const hourTicks = useMemo(() =>
    GANTT_HOURS.map(h => {
      const hNum = parseInt(h, 10)
      const min  = hNum < 20 ? hNum * 60 + 1440 : hNum * 60
      return { label: h, min }
    }),
  [])

  return (
    <div
      role="region"
      aria-label="Operator Gantt — shift 20:00 to 05:30"
      style={{ overflowX: "auto", background: BG }}
    >
      <div style={{ minWidth: LABEL_W + 560, position: "relative" }}>

        {/* ── Legend / title strip ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: `4px 10px`, paddingLeft: LABEL_W + 10,
          borderBottom: BDRL, background: BG,
        }}>
          <span className="ds-label" style={{ color: "var(--ds-subtle)", marginRight: 2 }}>
            Operator schedule · 20:00–05:30
          </span>
          {LEGEND_OPS.map(op => {
            const cfg = OP_CFG[op] ?? FALLBACK_CFG
            return (
              <span key={op} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
              Click hour to advance AS-OF
            </span>
          </span>
        </div>

        {/* ── Hour axis ───────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", height: AXIS_H,
          position: "sticky", top: 0, zIndex: 4,
          background: BG, borderBottom: BDR,
        }}>
          {/* Label spacer */}
          <div style={{
            width: LABEL_W, flexShrink: 0,
            position: "sticky", left: 0, zIndex: 5,
            background: BG, borderRight: BDR,
          }} />

          {/* Tick buttons */}
          <div style={{ flex: 1, position: "relative" }}>
            {hourTicks.map(({ label, min }) => {
              const isAs = min === asOf
              return (
                <button
                  key={label}
                  onClick={() => { setAsOf(min); onHourClick?.(min) }}
                  aria-label={`Set AS-OF to ${label}:00`}
                  title={`Set AS-OF to ${label}:00`}
                  style={{
                    position: "absolute", left: pct(min), top: 0, height: "100%",
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
                    {label}
                  </span>
                </button>
              )
            })}

            {/* End tick at 05:30 */}
            <div style={{
              position: "absolute", right: 0, top: 0, height: "100%",
              transform: "translateX(50%)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 1,
              pointerEvents: "none",
            }}>
              <span style={{ display: "block", width: 1, height: 4, background: "var(--ds-decorative)" }} />
              <span style={{ fontSize: 9, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--ds-subtle)" }}>05:30</span>
            </div>

            {/* Live now line in axis */}
            <div aria-hidden="true" style={{
              position: "absolute", left: livePct,
              top: 0, bottom: 0, width: 1.5,
              background: "var(--ds-accent)", opacity: 0.9,
              pointerEvents: "none", zIndex: 2,
            }} />

            {/* AS-OF line in axis */}
            <div aria-hidden="true" style={{
              position: "absolute", left: asPct,
              top: 0, bottom: 0, width: 1,
              background: "var(--ds-accent)", opacity: 0.35,
              pointerEvents: "none", zIndex: 1,
            }} />
          </div>
        </div>

        {/* ── Operator rows ────────────────────────────────────────────────── */}
        {laneSteps.map((lane, laneIdx) => (
          <div
            key={lane.key}
            style={{
              display: "flex",
              height: ROW_H + 4,
              borderBottom: laneIdx < laneSteps.length - 1 ? BDRL : BDR,
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
                {lane.label}
              </span>
              <span style={{
                fontSize: 9.5, lineHeight: 1.2,
                color: "var(--ds-subtle)", whiteSpace: "nowrap",
              }}>
                {lane.steps.length} steps allocated
              </span>
            </div>

            {/* ── Timeline track ───────────────────────────────────────────── */}
            <div style={{ flex: 1, position: "relative", overflow: "hidden", background: SFC }}>

              {/* Hour grid lines */}
              {hourTicks.map(({ label, min }) => (
                <div key={label} aria-hidden="true" style={{
                  position: "absolute", left: pct(min),
                  top: 0, bottom: 0, width: 1,
                  background: "var(--ds-border-lt)", pointerEvents: "none",
                }} />
              ))}

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
              {lane.steps.map(step => {
                const cfg = OP_CFG[step.op] ?? FALLBACK_CFG
                const ph  = barPhase(step.startMin, step.endMin, asOf)

                const barH   = ph === "passed" ? SLIVER_H : ROW_H + 4
                const barTop = ph === "passed" ? ((ROW_H + 4 - SLIVER_H) / 2) : 0

                let bg: string, border: string, opacity = 1
                if (ph === "ahead") {
                  bg = cfg.tint; border = `1.5px solid ${cfg.color}`; opacity = 0.8
                } else if (ph === "crossing") {
                  bg = cfg.color; border = "none"
                } else {
                  bg = "var(--ds-decorative)"; border = "none"
                }

                const dur  = (step.endMin - step.startMin) / SHIFT_DURATION_MIN * 100
                const barW = `${Math.max(0.5, dur).toFixed(3)}%`
                const barL = pct(step.startMin)
                const tip  = `${step.id} · ${cfg.label} · ${lane.label} · ${step.startMin % 60 === 0 ? step.startMin / 60 : (step.startMin / 60).toFixed(1)}h · ${step.status}`

                return (
                  <div
                    key={step.id}
                    role="img"
                    aria-label={`${step.id}: ${cfg.label}, ${lane.label}, ${step.status}`}
                    title={tip}
                    style={{
                      position: "absolute",
                      left: barL, width: barW,
                      top: barTop, height: barH,
                      background: bg, border,
                      borderRadius: 3, boxSizing: "border-box",
                      opacity,
                      transition: noMotion ? "none" : "height 0.35s ease, top 0.35s ease, opacity 0.25s ease",
                      zIndex: ph === "crossing" ? 3 : 1,
                      cursor: "default",
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* ── Phase legend ─────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12,
          padding: `4px 10px`, paddingLeft: LABEL_W + 10,
          background: BG, borderTop: BDRL,
        }}>
          {[
            { w: 14, h: 8, bg: "#dbeafe", border: "1.5px solid #2563eb", op: 0.8, label: "Planned (ahead)" },
            { w: 14, h: 8, bg: "#2563eb", border: "none",                 op: 1,   label: "In progress"     },
            { w: 14, h: 4, bg: "var(--ds-decorative)", border: "none",    op: 1,   label: "Done (trail)"    },
          ].map(l => (
            <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span aria-hidden="true" style={{
                display: "inline-block", width: l.w, height: l.h,
                background: l.bg, border: l.border,
                opacity: l.op, borderRadius: 2, flexShrink: 0,
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
