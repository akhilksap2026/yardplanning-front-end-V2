/**
 * PlannerGantt — static planning preview Gantt for NightPlanner.
 *
 * Two operator rows (J-1 Alex Rivera · 56 steps, J-3 George Burns · 62 steps).
 * Each step is its own segment: colored by operation type, 1 px gap each side,
 * inline label where space allows, full tooltip on hover.
 *
 * Axis: 20–05 (shift 20:00 → 05:30, SHIFT_START_MIN=1200, SHIFT_DURATION_MIN=570).
 * Always fully rendered — no collapse, no live-clock state changes.
 *
 * Data:   planningData.ts (stepsForOperator, operatorNames, GANTT_HOURS, …)
 * Colors: existing index.css tokens only — no new colors, no hardcoded hex.
 * a11y:   role="img" + aria-label per segment; hover title tooltip.
 */

import { useMemo } from "react"
import {
  operatorNames, stepsForOperator,
  GANTT_HOURS, SHIFT_START_MIN, SHIFT_DURATION_MIN,
  type PlanningStep,
} from "@/data/planningData"
import { getDisplayContainerId, getDisplayOperation } from "@/utils/displayLabels"

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  /** Currently selected step ID — highlighted with accent fill. */
  sel:       string
  /** Called when a segment is clicked; pass the step id. */
  onSelect:  (id: string) => void
  /** Switches the caption between preview and frozen-window copy. */
  published: boolean
}

// ── Operation type → fill color (solid DS token — all pass AA on white text) ─
// Deliberately uses the solid palette vars, not the pale *-bg variants,
// so segments are visually distinct even at 3–4 px wide.
const OP_FILL: Record<string, string> = {
  "Putaway":                            "var(--ds-blue)",
  "Outbound staging and truck loading": "var(--teal)",
  "Premarshal ahead of retrieval":      "var(--ds-purple)",
  "Digout to clear an overstow":        "var(--coral)",
  "Discharge from vessel":              "var(--ds-cyan)",
}
const OP_SHORT: Record<string, string> = {
  "Putaway":                            "Put",
  "Outbound staging and truck loading": "Stg",
  "Premarshal ahead of retrieval":      "Pre",
  "Digout to clear an overstow":        "Dig",
  "Discharge from vessel":              "Dis",
}
const OP_LABEL: Record<string, string> = {
  "Putaway":                            "Putaway",
  "Outbound staging and truck loading": "Retrieval/Stage",
  "Premarshal ahead of retrieval":      "Pre-marshal",
  "Digout to clear an overstow":        "Extra Move",
  "Discharge from vessel":              "Discharge",
}

const LEGEND_OPS = [
  "Putaway",
  "Outbound staging and truck loading",
  "Premarshal ahead of retrieval",
  "Digout to clear an overstow",
] as const

// ── Layout constants (4 px grid) ──────────────────────────────────────────────
const LABEL_W = 132   // px – sticky label column
const TRACK_H = 32    // px – operator row height
const BAR_H   = 20    // px – segment height (6 px top + 6 px bottom inset)
const BAR_TOP = (TRACK_H - BAR_H) / 2  // = 6

const SHIFT_END = SHIFT_START_MIN + SHIFT_DURATION_MIN  // 1770

// ── Helpers ───────────────────────────────────────────────────────────────────
function isoToMin(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d   = new Date(iso)
  const raw = d.getUTCHours() * 60 + d.getUTCMinutes()
  return raw < SHIFT_START_MIN ? raw + 1440 : raw   // midnight crossover
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—"
  return iso.slice(11, 16)   // "HH:MM" from ISO string
}

function segId(s: PlanningStep): string {
  const cid = s.container_id ?? `anon-${s.step_number ?? 0}`
  return `${cid}-${s.step_number ?? 0}-${s.operation.slice(0, 4)}`
}

/** Percentage string for an absolute shift minute. */
function pctS(min: number): string {
  return `${Math.max(0, Math.min(100, (min - SHIFT_START_MIN) / SHIFT_DURATION_MIN * 100)).toFixed(3)}%`
}

/** Raw percentage number (for calc() interpolation). */
function pctN(min: number): number {
  return Math.max(0, Math.min(100, (min - SHIFT_START_MIN) / SHIFT_DURATION_MIN * 100))
}

// Pre-compute axis ticks once (module-level, no re-render cost)
const HOUR_TICKS = GANTT_HOURS.map(h => {
  const n   = parseInt(h, 10)
  const min = n < 20 ? n * 60 + 1440 : n * 60
  return { label: h, pct: pctS(min) }
})

// ── Segment shape (derived, not the raw PlanningStep) ────────────────────────
interface Seg {
  id:       string
  fill:     string
  short:    string
  opLabel:  string
  cid:      string
  status:   string
  startFmt: string
  endFmt:   string
  leftCalc: string
  widCalc:  string
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PlannerGantt({ sel, onSelect, published }: Props) {
  // Derive lane data once — stable because planningData is a module-level singleton
  const lanes = useMemo(() => {
    return operatorNames().map(name => {
      const segs: Seg[] = []
      for (const s of stepsForOperator(name)) {
        const startMin = isoToMin(s.estimated_start)
        const endMin   = isoToMin(s.estimated_end)
        if (startMin === null || endMin === null) continue
        const isBlocked = s.step_status === "Blocked"
        const durPct    = Math.max(0.5, (endMin - startMin) / SHIFT_DURATION_MIN * 100)
        const leftN     = pctN(startMin)
        segs.push({
          id:       segId(s),
          fill:     isBlocked ? "var(--ds-subtle)" : (OP_FILL[s.operation] ?? "var(--ds-muted)"),
          short:    isBlocked ? "BLK"              : (OP_SHORT[s.operation] ?? "—"),
          opLabel:  OP_LABEL[s.operation] ?? getDisplayOperation(s.operation),
          cid:      getDisplayContainerId(s),
          status:   s.step_status,
          startFmt: fmtIso(s.estimated_start),
          endFmt:   fmtIso(s.estimated_end),
          leftCalc: `calc(${leftN.toFixed(3)}% + 1px)`,
          widCalc:  `calc(${durPct.toFixed(3)}% - 2px)`,
        })
      }
      return { name, segs }
    })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      role="region"
      aria-label="Operator Gantt — shift 20:00 to 05:30"
      style={{ borderTop: "0.5px solid var(--ds-border)" }}
    >
      {/* ── Caption + type legend ─────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 8,
        padding: "4px 14px",
      }}>
        <span style={{ fontSize: 11, color: "var(--ds-subtle)" }}>
          {published
            ? "Frozen window 20 min · in-progress moves immutable"
            : "Preview — freeze applies at publication"}
        </span>

        {/* Legend chips */}
        <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {LEGEND_OPS.map(op => (
            <span key={op} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span aria-hidden="true" style={{
                display: "inline-block",
                width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: OP_FILL[op],
              }} />
              <span style={{ fontSize: 9.5, fontWeight: 500, color: "var(--ds-subtle)" }}>
                {OP_LABEL[op]}
              </span>
            </span>
          ))}
        </span>
      </div>

      {/* ── Scrollable chart body ─────────────────────────────────────────── */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: LABEL_W + 520 }}>

          {/* Hour axis */}
          <div style={{
            display: "flex",
            borderBottom: "0.5px solid var(--ds-border)",
          }}>
            {/* Spacer under label column */}
            <div style={{
              width: LABEL_W, flexShrink: 0,
              position: "sticky", left: 0, zIndex: 2,
              background: "var(--ds-background)",
              borderRight: "0.5px solid var(--ds-border)",
            }} />

            {/* Tick area */}
            <div style={{ flex: 1, position: "relative", height: 18 }}>
              {HOUR_TICKS.map(({ label, pct }) => (
                <div
                  key={label}
                  aria-hidden="true"
                  style={{
                    position: "absolute", left: pct,
                    top: 0, bottom: 0,
                    borderLeft: "0.5px solid var(--ds-border-lt)",
                    paddingLeft: 3,
                    display: "flex", alignItems: "center",
                  }}
                >
                  <span style={{
                    fontSize: 9,
                    fontFamily: "var(--font-mono)",
                    color: "var(--ds-decorative)",
                    lineHeight: 1,
                    userSelect: "none",
                  }}>
                    {label}
                  </span>
                </div>
              ))}
              {/* End tick */}
              <div aria-hidden="true" style={{
                position: "absolute", right: 0, top: 0, bottom: 0,
                borderLeft: "0.5px solid var(--ds-border-lt)",
                paddingLeft: 2,
                display: "flex", alignItems: "center",
              }}>
                <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--ds-decorative)" }}>
                  05:30
                </span>
              </div>
            </div>
          </div>

          {/* Operator rows */}
          {lanes.map((lane, laneIdx) => (
            <div
              key={lane.name}
              style={{
                display: "flex",
                borderBottom: laneIdx < lanes.length - 1
                  ? "0.5px solid var(--ds-border-lt)"
                  : "0.5px solid var(--ds-border)",
              }}
            >
              {/* Sticky label */}
              <div style={{
                width: LABEL_W, flexShrink: 0,
                position: "sticky", left: 0, zIndex: 2,
                background: "var(--ds-surface)",
                borderRight: "0.5px solid var(--ds-border)",
                display: "flex", flexDirection: "column",
                justifyContent: "center",
                padding: "0 14px", gap: 1,
              }}>
                <span style={{
                  fontSize: 11.5, fontWeight: 600, lineHeight: 1.2,
                  color: "var(--ds-fg)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {lane.name}
                </span>
                <span style={{ fontSize: 9.5, color: "var(--ds-subtle)", lineHeight: 1.2 }}>
                  {lane.segs.length} steps
                </span>
              </div>

              {/* Timeline track */}
              <div style={{
                flex: 1, position: "relative",
                height: TRACK_H,
                background: "var(--ds-surface)",
                overflow: "hidden",
              }}>

                {/* Ghost hour gridlines — 0.5 px, border-lt, behind bars */}
                {HOUR_TICKS.map(({ label, pct }) => (
                  <div key={label} aria-hidden="true" style={{
                    position: "absolute", left: pct,
                    top: 0, bottom: 0, width: 0.5,
                    background: "var(--ds-border-lt)",
                    pointerEvents: "none",
                  }} />
                ))}

                {/* Segments */}
                {lane.segs.map(seg => {
                  const isSelected = seg.id === sel
                  const fill       = isSelected ? "var(--ds-accent)" : seg.fill
                  const tip = `${seg.cid} · ${seg.opLabel} · ${seg.startFmt}–${seg.endFmt} · ${seg.status}`

                  return (
                    <div
                      key={seg.id}
                      role="img"
                      aria-label={`${seg.cid}: ${seg.opLabel}, ${seg.startFmt}–${seg.endFmt}, ${seg.status}`}
                      title={tip}
                      tabIndex={0}
                      onClick={() => onSelect(seg.id)}
                      onKeyDown={e => (e.key === "Enter" || e.key === " ") && onSelect(seg.id)}
                      style={{
                        position: "absolute",
                        left:   seg.leftCalc,
                        width:  seg.widCalc,
                        top:    BAR_TOP,
                        height: BAR_H,
                        background: fill,
                        borderRadius: 2,
                        boxSizing: "border-box",
                        cursor: "pointer",
                        zIndex: isSelected ? 3 : 1,
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: 2,
                        outline: isSelected ? "2px solid var(--ds-accent)" : "none",
                        outlineOffset: 1,
                      }}
                    >
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
