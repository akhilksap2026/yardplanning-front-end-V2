/**
 * GanttTimeline — two-operator Gantt for Live Operations.
 *
 * Data source: planningResults.json via planningData.ts
 * Operators:   J-1 Alex Rivera (56 steps), J-3 George Burns (62 steps)
 * Shift:       20:00 → 05:30 (SHIFT_START_MIN=1200, SHIFT_DURATION_MIN=570)
 *
 * Bar phase driven by an internal AS-OF state (click hour ticks to advance).
 * Live now-line advances every second, clamped to the shift window.
 *
 * Phase states:
 *   ahead    → type-tinted fill + color border (planned, 80 % opacity)
 *   crossing → solid type-color fill            (in progress)
 *   passed   → thin centred sliver             (done trail)
 *
 * Horizontal 2 px gap between adjacent segments (1 px each side via calc).
 * Gridlines: 0.5 px, --ds-border-lt — subordinate to the data bars.
 * Transitions respect prefers-reduced-motion.
 */

import { useEffect, useMemo, useState } from "react"
import {
  stepsForOperator,
  SHIFT_START_MIN, SHIFT_DURATION_MIN, GANTT_HOURS,
} from "@/data/planningData"
import { getEquipmentFromMethod } from "@/utils/displayLabels"

// ── Two operator lanes — names exactly as stored in planningResults.json ──────
const LANES = [
  { key: "J-1 Alex Rivera",  label: "J-1 Alex Rivera",  count: 56 },
  { key: "J-3 George Burns", label: "J-3 George Burns", count: 62 },
] as const

// ── Operation → DS palette (mirrors NightPlanner MOVE_TYPE_STYLE) ─────────────
interface OpCfg { color: string; tint: string; label: string }
const OP_CFG: Record<string, OpCfg> = {
  "Putaway":                            { color: "#2563eb", tint: "#dbeafe", label: "Putaway"         },
  "Outbound staging and truck loading": { color: "#0d9488", tint: "#ccfbf1", label: "Retrieval/Stage" },
  "Premarshal ahead of retrieval":      { color: "#7c3aed", tint: "#ede9fe", label: "Pre-marshal"     },
  "Digout to clear an overstow":        { color: "#ea580c", tint: "#ffedd5", label: "Extra Move"      },
  "Discharge from vessel":              { color: "#0891b2", tint: "#cffafe", label: "Discharge"       },
}
const FALLBACK_CFG: OpCfg = { color: "#6b7280", tint: "#f3f4f6", label: "Move" }

const LEGEND_OPS = [
  "Putaway",
  "Outbound staging and truck loading",
  "Premarshal ahead of retrieval",
  "Digout to clear an overstow",
] as const

// ── Layout ────────────────────────────────────────────────────────────────────
const LABEL_W  = 144  // px – sticky left column
const ROW_H    = 24   // px – track height (compact)
const BAR_H    = 20   // px – bar height within track (2 px top/bottom inset)
const SLIVER_H = 5    // px – done-trail height
const AXIS_H   = 16   // px – hour axis strip

const SHIFT_END_MIN = SHIFT_START_MIN + SHIFT_DURATION_MIN  // 1770

// ── Helpers ───────────────────────────────────────────────────────────────────
function isoToMin(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  const h = d.getUTCHours(), m = d.getUTCMinutes()
  const raw = h * 60 + m
  return h < 20 ? raw + 1440 : raw   // midnight crossover
}

/** Shift-relative percentage, as a plain number (for calc() usage). */
function pctNum(min: number): number {
  return Math.max(0, Math.min(100, (min - SHIFT_START_MIN) / SHIFT_DURATION_MIN * 100))
}

type Phase = "ahead" | "crossing" | "passed"
function barPhase(s: number, e: number, asOf: number): Phase {
  if (e  <= asOf) return "passed"
  if (s  <= asOf) return "crossing"
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
  onHourClick?: (shiftMin: number) => void
}

export default function GanttTimeline({ onHourClick }: Props) {
  const liveMin  = useLiveMin()
  const noMotion = useReducedMotion()
  const [asOf, setAsOf] = useState(SHIFT_START_MIN)

  const clampedLive = Math.max(SHIFT_START_MIN, Math.min(SHIFT_END_MIN, liveMin))
  const livePctS  = `${pctNum(clampedLive).toFixed(3)}%`
  const asPctS    = `${pctNum(asOf).toFixed(3)}%`

  const laneSteps = useMemo(() =>
    LANES.map(lane => ({
      ...lane,
      steps: stepsForOperator(lane.key)
        .map(s => ({
          id:         s.activity_id ?? `${s.operator}-${s.step_number}`,
          op:         s.operation,
          moveMethod: s.move_method,
          startMin:   isoToMin(s.estimated_start),
          endMin:     isoToMin(s.estimated_end),
        }))
        .filter((s): s is typeof s & { startMin: number; endMin: number } =>
          s.startMin !== null && s.endMin !== null
        ),
    })),
  [])

  const hourTicks = useMemo(() =>
    GANTT_HOURS.map(h => {
      const hNum = parseInt(h, 10)
      const min  = hNum < 20 ? hNum * 60 + 1440 : hNum * 60
      return { label: h, min, pctS: `${pctNum(min).toFixed(3)}%` }
    }),
  [])

  return (
    <div
      role="region"
      aria-label="Operator Gantt — shift 20:00 to 05:30"
      style={{ overflowX: "auto", background: "var(--ds-background)" }}
    >
      <div style={{ minWidth: LABEL_W + 520, position: "relative" }}>

        {/* ── Header: type legend + affordance ────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "3px 8px", paddingLeft: LABEL_W + 8,
          borderBottom: "1px solid var(--ds-border-lt)",
          background: "var(--ds-background)",
        }}>
          {/* Section label */}
          <span className="ds-label" style={{ color: "var(--ds-subtle)", marginRight: 4 }}>
            Operator schedule · 20:00–05:30
          </span>

          {/* Operation type swatches */}
          {LEGEND_OPS.map(op => {
            const cfg = OP_CFG[op]
            return (
              <span key={op} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span aria-hidden="true" style={{
                  display: "inline-block", width: 8, height: 8,
                  borderRadius: 2, background: cfg.color, flexShrink: 0,
                }} />
                <span className="ds-label" style={{ color: "var(--ds-subtle)", textTransform: "none" }}>
                  {cfg.label}
                </span>
              </span>
            )
          })}

          {/* Click affordance */}
          <span style={{
            marginLeft: "auto",
            display: "inline-flex", alignItems: "center", gap: 4,
            color: "var(--ds-decorative)",
          }}>
            <span aria-hidden="true" style={{
              display: "inline-block", width: 1.5, height: 10,
              background: "var(--ds-accent)", borderRadius: 1, flexShrink: 0,
            }} />
            <span className="ds-label" style={{ color: "var(--ds-decorative)", textTransform: "none" }}>
              click hour · advance AS-OF
            </span>
          </span>
        </div>

        {/* ── Hour axis ───────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", height: AXIS_H,
          position: "sticky", top: 0, zIndex: 4,
          background: "var(--ds-background)",
          borderBottom: "1px solid var(--ds-border)",
        }}>
          {/* Label-column spacer */}
          <div style={{
            width: LABEL_W, flexShrink: 0,
            position: "sticky", left: 0, zIndex: 5,
            background: "var(--ds-background)",
            borderRight: "1px solid var(--ds-border)",
          }} />

          {/* Tick area */}
          <div style={{ flex: 1, position: "relative" }}>
            {hourTicks.map(({ label, min, pctS }) => {
              const isAs = min === asOf
              return (
                <button
                  key={label}
                  onClick={() => { setAsOf(min); onHourClick?.(min) }}
                  aria-label={`Set AS-OF to ${label}:00`}
                  title={`Set AS-OF to ${label}:00`}
                  style={{
                    position: "absolute", left: pctS, top: 0, height: "100%",
                    transform: "translateX(-50%)",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 1,
                    background: "transparent", border: "none",
                    cursor: "pointer", padding: "0 4px",
                  }}
                >
                  <span style={{
                    display: "block", width: 1, height: 3, flexShrink: 0,
                    background: isAs ? "var(--ds-accent)" : "var(--ds-decorative)",
                  }} />
                  <span style={{
                    fontSize: 9, lineHeight: 1.2,
                    fontWeight: isAs ? 700 : 400,
                    fontFamily: "var(--font-mono)",
                    color: isAs ? "var(--ds-accent)" : "var(--ds-decorative)",
                    letterSpacing: "0.02em",
                  }}>
                    {label}
                  </span>
                </button>
              )
            })}

            {/* End tick 05:30 */}
            <div style={{
              position: "absolute", right: 0, top: 0, height: "100%",
              transform: "translateX(50%)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 1,
              pointerEvents: "none",
            }}>
              <span style={{ display: "block", width: 1, height: 3, background: "var(--ds-decorative)" }} />
              <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--ds-decorative)" }}>
                05:30
              </span>
            </div>

            {/* Live now-line in axis */}
            <div aria-hidden="true" style={{
              position: "absolute", left: livePctS, top: 0, bottom: 0,
              width: 1.5, background: "var(--ds-accent)", opacity: 0.9,
              pointerEvents: "none", zIndex: 3,
            }} />

            {/* AS-OF ghost line in axis */}
            <div aria-hidden="true" style={{
              position: "absolute", left: asPctS, top: 0, bottom: 0,
              width: 1, background: "var(--ds-accent)", opacity: 0.3,
              pointerEvents: "none", zIndex: 2,
            }} />
          </div>
        </div>

        {/* ── Operator rows ────────────────────────────────────────────────── */}
        {laneSteps.map((lane, laneIdx) => (
          <div
            key={lane.key}
            style={{
              display: "flex",
              height: ROW_H,
              borderBottom: laneIdx < laneSteps.length - 1
                ? "1px solid var(--ds-border-lt)"
                : "1px solid var(--ds-border)",
            }}
          >
            {/* ── Label ──────────────────────────────────────────────────── */}
            <div style={{
              width: LABEL_W, flexShrink: 0,
              position: "sticky", left: 0, zIndex: 2,
              background: "var(--ds-surface)",
              borderRight: "1px solid var(--ds-border)",
              display: "flex", flexDirection: "column",
              justifyContent: "center",
              padding: "0 0 0 8px", gap: 1,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, lineHeight: 1.2,
                color: "var(--ds-fg)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {lane.label}
              </span>
              <span style={{
                fontSize: 9, lineHeight: 1.2,
                color: "var(--ds-decorative)",
                whiteSpace: "nowrap",
              }}>
                {lane.steps.length} steps
              </span>
            </div>

            {/* ── Track ──────────────────────────────────────────────────── */}
            <div style={{
              flex: 1, position: "relative", overflow: "hidden",
              background: "var(--ds-surface)",
            }}>

              {/* Ghost gridlines — 0.5 px, border-lt, subordinate to bars */}
              {hourTicks.map(({ label, pctS }) => (
                <div key={label} aria-hidden="true" style={{
                  position: "absolute", left: pctS, top: 0, bottom: 0,
                  width: 0.5,
                  background: "var(--ds-border-lt)",
                  pointerEvents: "none",
                }} />
              ))}

              {/* AS-OF ghost */}
              <div aria-hidden="true" style={{
                position: "absolute", left: asPctS, top: 0, bottom: 0,
                width: 1, background: "var(--ds-accent)", opacity: 0.15,
                pointerEvents: "none", zIndex: 2,
              }} />

              {/* Live now-line */}
              <div aria-hidden="true" style={{
                position: "absolute", left: livePctS, top: 0, bottom: 0,
                width: 1.5, background: "var(--ds-accent)", opacity: 0.9,
                pointerEvents: "none", zIndex: 5,
              }} />

              {/* ── Bars ────────────────────────────────────────────────── */}
              {lane.steps.map(step => {
                const cfg = OP_CFG[step.op] ?? FALLBACK_CFG
                const ph  = barPhase(step.startMin, step.endMin, asOf)

                // Height & vertical position
                const barH   = ph === "passed" ? SLIVER_H : BAR_H
                const barTop = ph === "passed"
                  ? (ROW_H - SLIVER_H) / 2
                  : (ROW_H - BAR_H) / 2        // 2 px inset top & bottom

                // Color
                let bg: string, border: string, opacity: number
                if (ph === "ahead") {
                  bg = cfg.tint; border = `1px solid ${cfg.color}`; opacity = 0.8
                } else if (ph === "crossing") {
                  bg = cfg.color; border = "none"; opacity = 1
                } else {
                  bg = "var(--ds-decorative)"; border = "none"; opacity = 1
                }

                // Horizontal: percentage width, then subtract 2 px gap (1 px each side)
                const durPct = Math.max(0.5, (step.endMin - step.startMin) / SHIFT_DURATION_MIN * 100)
                const leftPct = pctNum(step.startMin).toFixed(3)

                const equip = getEquipmentFromMethod(step.moveMethod)
                const tip = `${step.id} · ${cfg.label} · ${lane.label}${equip ? ` · ${equip.label} ${equip.id}` : ""}`

                return (
                  <div
                    key={step.id}
                    role="img"
                    aria-label={`${step.id}: ${cfg.label}, ${lane.label}${equip ? `, ${equip.label} ${equip.id}` : ""}`}
                    title={tip}
                    style={{
                      position: "absolute",
                      // 1 px gap on left side
                      left: `calc(${leftPct}% + 1px)`,
                      // shrink by 2 px total for the gaps
                      width: `calc(${durPct.toFixed(3)}% - 2px)`,
                      top: barTop,
                      height: barH,
                      background: bg,
                      border,
                      borderRadius: 2,
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

        {/* ── Phase legend ─────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
          padding: "3px 8px", paddingLeft: LABEL_W + 8,
          background: "var(--ds-background)",
          borderTop: "1px solid var(--ds-border-lt)",
        }}>
          {([
            { w: 12, h: 6,  bg: "#dbeafe", border: "1px solid #2563eb", op: 0.8, label: "Planned"     },
            { w: 12, h: 6,  bg: "#2563eb", border: "none",               op: 1,   label: "In progress" },
            { w: 12, h: 3,  bg: "var(--ds-decorative)", border: "none",  op: 1,   label: "Done"        },
          ] as const).map(l => (
            <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{
                display: "inline-block", width: l.w, height: l.h,
                background: l.bg, border: l.border,
                opacity: l.op, borderRadius: 1, flexShrink: 0,
              }} />
              <span className="ds-label" style={{ color: "var(--ds-decorative)", textTransform: "none" }}>
                {l.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
