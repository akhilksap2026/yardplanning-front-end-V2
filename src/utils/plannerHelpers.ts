import type { PlanningStep } from "@/data/planningData"
import { fmtTime } from "@/utils/time"
export { fmtTime }

// ── Column definitions ────────────────────────────────────────────────────────
export const ALL_COLS = ["SEQ","WINDOW","MOVE","ROUTE","ASSIGNED","EST"] as const
export type Col = typeof ALL_COLS[number]
export const DEFAULT_COLS = new Set<Col>(["SEQ","MOVE","ROUTE","ASSIGNED"])

// ── Display helpers ───────────────────────────────────────────────────────────
export function fmtLoc(loc: PlanningStep["origin"]): string {
  if (!loc || loc.bay == null) return "—"
  if (loc.bay === "GATE / OFF-YARD") return "GATE"
  return `Bay ${loc.bay} · R${loc.row ?? "?"} · T${loc.tier ?? "?"}`
}

export function stepDur(s: PlanningStep): number {
  if (!s.estimated_start || !s.estimated_end) return 2.5
  return Math.round(
    (new Date(s.estimated_end).getTime() - new Date(s.estimated_start).getTime()) / 60000 * 10
  ) / 10
}

export function isoToMin(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
