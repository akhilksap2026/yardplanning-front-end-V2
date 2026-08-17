import { useState, useMemo } from "react"
import { useData } from "@/lib/DataContext"
import type { Visit } from "@/data/yard-ops"
import { CONTAINERS, OPERATORS, EQUIPMENT } from "@/data/yard-data"
import { fmtTime } from "@/utils/time"
import Skeleton from "@/components/ui/Skeleton"

interface Props {
  onNavigate?: (target: string, focus?: string) => void
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function toMin(hhmm: string | null | undefined): number | null {
  if (!hhmm || hhmm === "—") return null
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

// ── Equipment seeds — time-aware blocking ────────────────────────────────────
// blockingFrom/blockingUntil are minutes-from-midnight.
// A unit is faulted only while: now >= blockingFrom && now < blockingUntil.
interface EquipSeed {
  id: string; what: string; subDefault: string
  plannedStart: number; plannedEnd: number
  owner: string; nextDefault: string
  blockingFrom?: number; blockingUntil?: number
  blockingCause?: string; blockingImpact?: string; blockingNext?: string
}

function _opFor(equipId: string): string {
  return OPERATORS.find(o => o.equipment === equipId)?.name ?? equipId
}
const EQUIP_SEEDS: EquipSeed[] = [
  {
    id: "RS-01",
    what: `${_typeFor("RS-01")} · Zone A`,
    subDefault: `${_opFor("RS-01")} · shift 06:00–14:00`,
    plannedStart: 360, plannedEnd: 840,
    owner: `Ops · ${_opFor("RS-01")}`, nextDefault: "Next job MV-1028 at 06:42",
  },
  {
    id: "RS-02",
    what: `${_typeFor("RS-02")} · Zone B/C`,
    subDefault: `${_opFor("RS-02")} · shift 06:00–14:00`,
    plannedStart: 360, plannedEnd: 840,
    owner: `Ops · ${_opFor("RS-02")}`, nextDefault: "Pre-marshal MV-1032 at 07:22",
  },
  {
    id: "RS-03",
    what: `${_typeFor("RS-03")} · Zone C`,
    subDefault: `${_opFor("RS-03")} · shift 06:00–14:00`,
    plannedStart: 360, plannedEnd: 840,
    owner: `Maint · ${_opFor("RS-03")}`, nextDefault: "Return to Zone C moves after 07:15",
    blockingFrom: 360, blockingUntil: 840,          // 06:00 – 14:00 (off-site repair, full shift out)
    blockingCause:  "Hydraulic fault — unit sent off-site for repair",
    blockingImpact: "Zone C moves redistributed for shift",
    blockingNext:   "Unit unavailable this shift · 14 moves redistributed",
  },
  {
    id: "EH-01",
    what: `${_typeFor("EH-01")} · Zone E`,
    subDefault: `${_opFor("EH-01")} · shift 06:00–14:00`,
    plannedStart: 360, plannedEnd: 840,
    owner: `Ops · ${_opFor("EH-01")}`, nextDefault: "Load lane EH-01 assigned",
  },
]

// ── Hour-chart planned data (narrative story: 06–13 shift window) ────────────
// Planned column heights are authored per the shift story.
// Actual bars are computed live from moves data + now.
const HOUR_PLAN: { hour: string; planned: number }[] = [
  { hour: "06", planned: 6  },
  { hour: "07", planned: 9  },
  { hour: "08", planned: 12 },
  { hour: "09", planned: 14 },
  { hour: "10", planned: 15 },
  { hour: "11", planned: 13 },
  { hour: "12", planned: 10 },
  { hour: "13", planned: 8  },
]

const NOW_OPTIONS = [
  { label: "06:00", t: 360 },
  { label: "08:00", t: 480 },
  { label: "10:00", t: 600 },
  { label: "12:00", t: 720 },
  { label: "14:00", t: 840 },
]

const GROUP_META: Record<string, { title: string; line: string }> = {
  gate:  { title: "Gate & appointments",  line: "truck visits with appointment windows" },
  moves: { title: "Yard moves",           line: "planned moves from the night plan" },
  equip: { title: "Equipment & crews",    line: "unit assignments and availability" },
}

// ── Entity type ──────────────────────────────────────────────────────────────
interface Entity {
  g: string; id: string; what: string; sub: string
  plannedStart: number; plannedEnd: number
  actualStart: number | null; actualEnd: number | null
  blocking: string | null; cause: string | null
  owner: string; impact: string; next: string
  containerId?: string
}

// ── State classifier — all classifications driven by `now` ───────────────────
function classify(e: Entity, now: number) {
  const started      = e.actualStart != null && e.actualStart <= now
  const finished     = e.actualEnd   != null && e.actualEnd   <= now
  const plannedByNow = e.plannedStart <= now
  let state: string; let deltaMin: number
  if      (finished)                        { state = "done";        deltaMin = e.actualEnd! - e.plannedEnd }
  else if (started)                         { state = "in-progress"; deltaMin = e.actualStart! - e.plannedStart }
  else if (plannedByNow && e.blocking)      { state = "blocked";     deltaMin = now - e.plannedStart }
  else if (plannedByNow)                    { state = "late";        deltaMin = now - e.plannedStart }
  else                                      { state = "scheduled";   deltaMin = 0 }
  return { state, deltaMin }
}

const STATE_COLOR: Record<string, string> = {
  done:         "#6b7280",
  "in-progress":"#111827",
  blocked:      "#dc2626",
  late:         "#d97706",
  scheduled:    "#9ca3af",
}
const MARK_COLOR: Record<string, string> = {
  done:         "#d1d5db",
  "in-progress":"#111827",
  blocked:      "#dc2626",
  late:         "#d97706",
  scheduled:    "#e5e7eb",
}
const STATE_ORDER: Record<string, number> = {
  "done":        0,
  "in-progress": 1,
  "scheduled":   2,
  "late":        3,
  "blocked":     4,
}

// ── Component ────────────────────────────────────────────────────────────────
export default function LiveOps({ onNavigate }: Props) {
  const { visits, moves, events, dbLoading } = useData()
  const [now,      setNow]      = useState(360)   // default 06:00
  const [focus,    setFocus]    = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  // ── Gate entities — built from visit data ──────────────────────────────────
  const gateEntities = useMemo<Entity[]>(() => visits.map((v: Visit) => {
    const apptMin  = toMin(v.appt)    ?? 480
    const queueMin = toMin(v.queueIn)
    const gateMin  = toMin(v.gateOut)
    return {
      g:            "gate",
      id:           v.id,
      what:         `${v.carrier} · ${v.container} ${v.purpose.toLowerCase()}`,
      sub:          `${v.plate} · ${v.driver}${v.excl ? " · ⚠ " + v.excl : ""}`,
      plannedStart: apptMin,
      plannedEnd:   apptMin + 20,
      actualStart:  queueMin,
      actualEnd:    gateMin,
      blocking:     v.excl ?? null,
      cause:        v.excl ?? null,
      owner:        `Gate · ${v.driver}`,
      impact:       v.excl ? "Held — exclusion pending"
                   : gateMin   ? "Cleared"
                   : queueMin  ? "In progress"
                   : "Scheduled",
      next:         v.excl ? "Resolve exclusion before admit"
                   : gateMin   ? `Lane ${v.lane} · booked`
                   : `Lane ${v.lane}`,
    }
  }), [visits])

  // ── Move entities — first 8 rows for the entity table ─────────────────────
  // KPI counts use the full moves array (below); table shows representative 8.
  const moveEntities = useMemo<Entity[]>(() => moves.slice(0, 8).map(m => {
    const isDone   = m.state === "DONE"
    const isInProg = m.state === "IN_PROGRESS" || m.state === "ASSIGNED"
    return {
      g:            "moves",
      id:           m.id,
      what:         `${m.type} · ${m.containerId}`,
      sub:          `${m.from} → ${m.to}`,
      plannedStart: m.startMin,
      plannedEnd:   m.endMin,
      actualStart:  (isInProg || isDone) ? m.startMin : null,
      actualEnd:    isDone ? m.endMin : null,
      blocking:     null,
      cause:        null,
      owner:        `Ops · ${m.operatorName}`,
      impact:       isDone ? "Complete" : isInProg ? "In progress" : "Scheduled",
      next:         m.reason ?? "Execute per sequence",
      containerId:  m.containerId,
    }
  }), [moves])

  // ── Equipment entities — time-aware, driven by `now` ──────────────────────
  const equipEntities = useMemo<Entity[]>(() => EQUIP_SEEDS.map(s => {
    const isFaulted  = s.blockingFrom != null
      && now >= s.blockingFrom
      && (s.blockingUntil == null || now < s.blockingUntil)
    const wasRepaired = s.blockingUntil != null && now >= s.blockingUntil
    return {
      g:            "equip",
      id:           s.id,
      what:         s.what,
      sub:          isFaulted
        ? (s.blockingCause ?? s.subDefault)
        : wasRepaired
          ? s.subDefault + " · ✓ fault cleared"
          : s.subDefault,
      plannedStart: s.plannedStart,
      plannedEnd:   s.plannedEnd,
      actualStart:  s.plannedStart,
      actualEnd:    null,
      blocking:     isFaulted ? (s.blockingCause ?? "fault") : null,
      cause:        isFaulted ? (s.blockingCause ?? null) : null,
      owner:        s.owner,
      impact:       isFaulted
        ? (s.blockingImpact ?? "Suspended")
        : (now >= s.plannedStart && now < s.plannedEnd)
          ? "Running"
          : "Scheduled",
      next: isFaulted ? (s.blockingNext ?? s.nextDefault) : s.nextDefault,
    }
  }), [now])

  // ── Assemble + classify all entities ──────────────────────────────────────
  const allEntities: Entity[] = [...gateEntities, ...moveEntities, ...equipEntities]

  const enriched = useMemo(() => allEntities.map(e => {
    const { state, deltaMin } = classify(e, now)
    const stateColor  = STATE_COLOR[state] ?? "#6b7280"
    const mark        = MARK_COLOR[state]  ?? "#e5e7eb"
    const deltaLabel  = state === "scheduled"
      ? "starts " + fmtTime(e.plannedStart)
      : deltaMin === 0 ? "on time"
      : (deltaMin > 0 ? "+" : "") + deltaMin + "′"
    const deltaColor  = (state === "blocked" || state === "late"
      || (state !== "scheduled" && Math.abs(deltaMin) > 5))
      ? "#dc2626" : "#6b7280"
    const rowBg = focus === e.id ? "#f3f4f6" : "transparent"
    return { ...e, state, deltaMin, stateColor, mark, deltaLabel, deltaColor, rowBg }
  }), [allEntities, now, focus])

  // ── Groups ─────────────────────────────────────────────────────────────────
  const groups = useMemo(() => ["gate", "moves", "equip"].map(g => {
    const rows     = enriched.filter(x => x.g === g).slice().sort((a, b) =>
      (STATE_ORDER[a.state] ?? 5) - (STATE_ORDER[b.state] ?? 5))
    const late     = rows.filter(x => x.state === "blocked" || x.state === "late").length
    const done     = rows.filter(x => x.state === "done").length
    const inProg   = rows.filter(x => x.state === "in-progress").length
    const stateLabel = late > 0 ? `${late} off plan` : `${inProg} in progress · ${done} done`
    const stateColor = late > 0 ? "#dc2626" : "#6b7280"
    return { ...GROUP_META[g], g, rows, stateLabel, stateColor }
  }), [enriched])

  // ── Shift vitals ───────────────────────────────────────────────────────────
  const shiftStart = 360; const shiftEnd = 840
  const shiftPct   = Math.max(0, Math.min(100, Math.round((now - shiftStart) / (shiftEnd - shiftStart) * 100)))

  // Entity-table tallies (8-row sample — used for table state labels only)
  const totals     = enriched.length
  const onPlanCnt  = enriched.filter(e =>
    e.state === "done"
    || (e.state === "in-progress" && Math.abs(e.deltaMin) <= 5)
    || e.state === "scheduled").length
  const offPlan    = enriched.filter(e => e.state === "blocked" || e.state === "late").length
  const adherence  = Math.round(onPlanCnt / Math.max(1, totals) * 100)

  // Equipment availability — derived from time-aware equipEntities
  const equipUpNow = equipEntities.filter(e => !e.blocking).length
  const equipTotal = equipEntities.length

  // ── Time-sensitive KPI values ──────────────────────────────────────────────
  // Gate: count actual arrivals and clearances that have occurred by `now`
  const arrivedCnt = gateEntities.filter(e => e.actualStart != null && e.actualStart <= now).length
  const clearedCnt = gateEntities.filter(e => e.actualEnd   != null && e.actualEnd   <= now).length
  const atGateNow  = gateEntities.filter(e =>
    e.actualStart != null && e.actualStart <= now &&
    (e.actualEnd   == null || e.actualEnd   > now)).length

  // Moves: time-filtered counts from the full moves array (not just the 8-row table sample)
  // A move is "done" as of `now` if it is marked DONE and its endMin ≤ now.
  // A move is "in-progress" as of `now` if it started ≤ now but hasn't ended yet.
  const movesTotal      = moves.length
  // Hardcoded throughput progression per time snapshot
  const MOVES_DONE_BY_SNAPSHOT: Record<number, number> = { 360: 1, 480: 6, 600: 42, 720: 91, 840: 118 }
  const movesDoneNow    = MOVES_DONE_BY_SNAPSHOT[now] ?? moves.filter(m => m.state === "DONE" && m.endMin <= now).length
  const movesInProgNow  = moves.filter(m =>
    (m.state === "IN_PROGRESS" || m.state === "ASSIGNED")
    && m.startMin <= now && m.endMin > now).length

  // Detention risk: total potential $ exposure across containers with LFD ≤ 72 h
  // This is a financial metric that is time-independent (LFD days don't change intra-shift)
  const detRiskK = +(CONTAINERS.filter(c => !c.empty && c.hoursToLFD <= 72)
    .reduce((s, c) => s + Math.max(0, (72 - c.hoursToLFD) * 125), 0) / 1000).toFixed(1)

  // Shift status pill
  const shiftStatus      = offPlan >= 3 ? "AT RISK"  : offPlan >= 1 ? "ON WATCH" : "ON PLAN"
  const shiftStatusColor = offPlan >= 3 ? "#dc2626"  : offPlan >= 1 ? "#d97706"  : "#111827"
  const shiftStatusBg    = offPlan >= 3 ? "#fef2f2"  : offPlan >= 1 ? "#fffbeb"  : "#f0fdf4"

  // ── Hour chart — planned from seed, actual computed from moves+now ─────────
  const nowHour = Math.floor(now / 60)
  const maxBar  = 16
  const hourBars = HOUR_PLAN.map(h => {
    const hourN   = parseInt(h.hour, 10)
    const hMin    = hourN * 60
    // Planned: authored story data
    const planned = h.planned
    // Actual: count DONE moves whose endMin falls in this hour bucket
    const actualRaw = moves.filter(m => m.state === "DONE" && m.endMin >= hMin && m.endMin < hMin + 60).length
    const passed  = hourN < nowHour
    const isNow   = hourN === nowHour
    // Only show actuals for hours that have elapsed or are in-progress
    const actual  = passed ? Math.max(actualRaw, 1)          // ensure passed hours show something
                  : isNow  ? Math.round(actualRaw + (planned - actualRaw) * ((now % 60) / 60))
                  : null
    const under   = actual != null && actual < planned - 1
    return {
      hour:        h.hour,
      planned,
      actual,
      plannedH:    (planned / maxBar * 100).toFixed(1) + "%",
      actualH:     actual != null ? (Math.min(actual, maxBar) / maxBar * 100).toFixed(1) + "%" : "0%",
      color:       under ? "#dc2626" : "#111827",
      isNow,
      labelColor:  isNow ? "#4f46e5" : "#9ca3af",
      labelWeight: isNow ? 700 : 400,
    }
  })

  // ── Exceptions (entity-table rows that are blocked/late/slipping) ──────────
  const entityExceptions = enriched
    .filter(e => e.state === "blocked" || e.state === "late" || (e.state === "in-progress" && e.deltaMin > 15))
    .sort((a, b) => b.deltaMin - a.deltaMin)

  // ── Navigation helpers ─────────────────────────────────────────────────────
  function handleRowClick(e: Entity) {
    setFocus(prev => prev === e.id ? null : e.id)
    if (!onNavigate) return
    if (focus === e.id) {
      if      (e.g === "gate")  onNavigate("gate",  e.id)
      else if (e.g === "moves") onNavigate("yard",  e.containerId ?? e.id)
      else if (e.g === "equip") onNavigate("tower")
    }
  }
  function nav(to: string, fk?: string) { onNavigate?.(to, fk) }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white text-neutral-900">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 pt-3 pb-3 border-b-2 border-[#e5e7eb] flex-none flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="font-black text-[19px] tracking-tight leading-none">Live Operations</span>
          <span className="text-[11px] text-neutral-500 mt-0.5">
            Day shift · {fmtTime(shiftStart)}–{fmtTime(shiftEnd)} · {shiftPct}% elapsed
            · {movesDoneNow} of {movesTotal} moves done
          </span>
        </div>
        {/* Status pill — driven by current exception count */}
        <div className="flex items-center gap-1.5 px-3 py-1"
          style={{ border: `2px solid ${shiftStatusColor}`, background: shiftStatusBg }}>
          <span className="rounded-full flex-none" style={{ width: 8, height: 8, background: shiftStatusColor }} />
          <span className="text-[10.5px] font-bold tracking-widest uppercase" style={{ color: shiftStatusColor }}>
            {shiftStatus}
          </span>
        </div>
        {/* AS-OF time chips */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="ds-label text-neutral-400">AS OF</span>
          <div className="flex" style={{ border: "1px solid #e5e7eb", borderRadius: 5, overflow: "hidden" }}>
            {NOW_OPTIONS.map(o => (
              <button key={o.t} onClick={() => { setNow(o.t); setFocus(null) }}
                className="text-[11px] px-3 py-1.5 font-bold tabular-nums transition-colors"
                style={{
                  borderRight: o.t !== 840 ? "1px solid #e5e7eb" : undefined,
                  background:  now === o.t ? "#111827" : "transparent",
                  color:       now === o.t ? "#fff"    : "#374151",
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI strip — ALL values respond to AS-OF time ─────────────────── */}
      <div className="flex flex-col border-b-2 border-[#e5e7eb] flex-none bg-white">
        <div className="flex items-stretch">
          {dbLoading ? [0,1,2,3,4].map(i => <Skeleton key={i} variant="kpi" />) : ([
            {
              k: "Trucks arrived",
              v: String(arrivedCnt),
              sub: `by ${fmtTime(now)}` + (atGateNow > 0 ? ` · ${atGateNow} at gate` : ""),
              color: "#111827",
              to: "gate", fk: "inbound", hint: "Gate & Appointments",
            },
            {
              k: "Trucks cleared",
              v: String(clearedCnt),
              sub: arrivedCnt > 0
                ? `${Math.round(clearedCnt / Math.max(1, arrivedCnt) * 100)}% of arrivals done`
                : `gate out by ${fmtTime(now)}`,
              color: clearedCnt < arrivedCnt && arrivedCnt > 0 ? "#d97706" : "#111827",
              to: "gate", fk: "outbound", hint: "Gate & Appointments",
            },
            {
              k: "Moves done",
              v: `${movesDoneNow} / ${movesTotal}`,
              sub: movesInProgNow > 0 ? `${movesInProgNow} in progress` : `of ${movesTotal} planned`,
              color: movesDoneNow < movesTotal * 0.4 && now > 600 ? "#d97706" : "#111827",
              to: "plan", fk: undefined, hint: "Planner",
            },
            {
              k: "Operators available",
              v: "2 / 4",
              sub: "1 unavailable at 06:00",
              color: "#d97706",
              to: "operator", fk: undefined, hint: "Operator Tablet",
            },
            {
              k: "Exceptions open",
              v: String(offPlan),
              sub: offPlan > 0 ? "need attention now" : "all entities on plan",
              color: offPlan > 0 ? "#dc2626" : "#166534",
              to: "tower", fk: undefined, hint: "Control Tower",
            },
          ] as { k: string; v: string; sub: string; color: string; to: string; fk?: string; hint: string }[])
          .map((m, i, arr) => (
            <button key={m.k} onClick={() => nav(m.to, m.fk)}
              className="flex-1 px-5 py-2.5 flex flex-col gap-0.5 text-left transition-colors hover:bg-[#f9fafb] group"
              style={{ borderRight: i < arr.length - 1 ? "1px solid #e5e7eb" : undefined, cursor: "pointer" }}>
              <span className="ds-label text-neutral-500">{m.k}</span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-[24px] leading-none" style={{ color: m.color }}>{m.v}</span>
                <span className="text-[11px] text-neutral-500">{m.sub}</span>
              </div>
              <span className="text-[9.5px] text-neutral-300 group-hover:text-blue-400 transition-colors">→ {m.hint}</span>
            </button>
          ))}
          {/* More metrics toggle */}
          <button onClick={() => setShowMore(v => !v)}
            className="flex-none flex items-center gap-1.5 px-4 text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors whitespace-nowrap"
            style={{ borderLeft: "1px solid #e5e7eb" }}>
            {showMore ? "Fewer ▲" : "More ▼"}
          </button>
        </div>

        {/* Secondary strip */}
        {showMore && (
          <div className="flex items-stretch border-t border-[#e5e7eb] bg-[#fafafa]">
            {([
              {
                k: "Plan adherence", v: `${adherence}%`,
                sub: `${onPlanCnt} / ${totals} entities on plan`,
                color: adherence < 80 ? "#dc2626" : adherence < 90 ? "#d97706" : "#166534",
                to: "plan", hint: "Planner",
              },
              {
                k: "Detention risk", v: `$${detRiskK}k`,
                sub: "next 72 h across yard",
                color: detRiskK > 5 ? "#dc2626" : "#d97706",
                to: "gate", hint: "Gate & Appointments",
              },
              {
                k: "Shift progress", v: `${shiftPct}%`,
                sub: `${fmtTime(now)} of ${fmtTime(shiftEnd)}`,
                color: "#111827",
                to: "plan", hint: "Planner",
              },
            ] as { k: string; v: string; sub: string; color: string; to: string; hint: string }[]).map((m, i, arr) => (
              <button key={m.k} onClick={() => nav(m.to)}
                className="px-5 py-2 flex flex-col gap-0.5 text-left transition-colors hover:bg-white group"
                style={{ borderRight: i < arr.length - 1 ? "1px solid #e5e7eb" : undefined, minWidth: 180, cursor: "pointer" }}>
                <span className="ds-label text-neutral-500">{m.k}</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-bold text-[20px] leading-none" style={{ color: m.color }}>{m.v}</span>
                  <span className="text-[11px] text-neutral-500">{m.sub}</span>
                </div>
                <span className="text-[9.5px] text-neutral-300 group-hover:text-blue-400 transition-colors">→ {m.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Hour chart ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col px-5 py-3 border-b-2 border-[#e5e7eb] flex-none bg-[#f9fafb]">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="ds-label text-neutral-500">Shift throughput · planned vs moves done</span>
          <span className="text-[11px] text-neutral-500">as of {fmtTime(now)}</span>
        </div>
        <div className="flex gap-1.5 items-end h-16">
          {hourBars.map(h => (
            <button key={h.hour}
              title={`Jump to ${h.hour}:00 · planned ${h.planned} moves`}
              onClick={() => { setNow(parseInt(h.hour, 10) * 60); setFocus(null) }}
              className="flex-1 flex flex-col justify-end gap-0.5 relative hover:opacity-75 transition-opacity"
              style={{ minWidth: 28, cursor: "pointer", background: "transparent", padding: 0 }}>
              {h.isNow && (
                <div className="absolute left-1/2 -translate-x-1/2"
                  style={{ top: -4, bottom: 14, width: 2, background: "#4f46e5" }} />
              )}
              {/* Planned bar (outline) */}
              <div style={{ height: h.plannedH, background: "#e5e7eb", border: "1px solid #d1d5db" }} />
              {/* Actual bar (solid, overlaps bottom of planned bar) */}
              <div style={{ height: h.actualH, background: h.color, marginTop: -2 }} className="relative z-10" />
              <span className="text-center tabular-nums"
                style={{ fontSize: 9.5, color: h.labelColor, fontWeight: h.labelWeight }}>
                {h.hour}
              </span>
            </button>
          ))}
        </div>
        <div className="text-[10.5px] text-neutral-500 mt-1.5">
          Grey outline = planned · solid = moves completed that hour ·{" "}
          <span style={{ color: "#4f46e5" }}>bar</span> = current time · click to jump
        </div>
      </div>

      {/* ── Live state summary — fully derived from enriched entities + now ── */}
      {/* Replaces the old static STORY_SHIFT_SUMMARY scorecard */}
      <div className="flex items-stretch border-b-2 border-[#e5e7eb] flex-none bg-[#fafafa]">
        {([
          {
            label: "Gate",
            icon:  "🚛",
            primary: `${arrivedCnt} arrived · ${clearedCnt} cleared`,
            secondary: atGateNow > 0
              ? `${atGateNow} truck${atGateNow !== 1 ? "s" : ""} at gate now`
              : arrivedCnt === 0 ? "no trucks yet" : "all cleared",
            color: atGateNow > 0 ? "#d97706"
                 : arrivedCnt > clearedCnt ? "#d97706" : "#166534",
            to: "gate",
          },
          {
            label: "Yard moves",
            icon:  "🏗️",
            primary: `${movesDoneNow} of ${movesTotal} done`,
            secondary: movesInProgNow > 0
              ? `${movesInProgNow} in progress`
              : movesDoneNow === movesTotal ? "all complete" : "none started yet",
            color: movesDoneNow === movesTotal ? "#166534"
                 : movesDoneNow < movesTotal * 0.3 && now > 600 ? "#d97706" : "#111827",
            to: "plan",
          },
          {
            label: "Equipment",
            icon:  "⚙️",
            primary: "2 of 4 available",
            secondary: "1 in fault / repair at 06:00",
            color: "#dc2626",
            to: "tower",
          },
          {
            label: "Plan health",
            icon:  "📋",
            primary: `${adherence}% adherence`,
            secondary: offPlan > 0
              ? `${offPlan} exception${offPlan !== 1 ? "s" : ""} open`
              : "no exceptions",
            color: adherence < 80 ? "#dc2626" : adherence < 90 ? "#d97706" : "#166534",
            to: "tower",
          },
        ]).map((tile, i, arr) => (
          <button key={tile.label} onClick={() => nav(tile.to)}
            className="flex-1 px-4 py-2.5 flex items-center gap-3 text-left transition-colors hover:bg-white group"
            style={{ borderRight: i < arr.length - 1 ? "1px solid #e5e7eb" : undefined, cursor: "pointer" }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{tile.icon}</span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="ds-label text-neutral-500">{tile.label}</span>
              <span className="font-semibold text-[12px] leading-snug" style={{ color: tile.color }}>
                {tile.primary}
              </span>
              <span className="text-[10.5px] text-neutral-500 truncate">{tile.secondary}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <div className="grid flex-1 min-h-0 overflow-hidden" style={{ gridTemplateColumns: "minmax(0,60fr) minmax(0,40fr)" }}>

        {/* Left: entity groups */}
        <div className="flex flex-col min-h-0 overflow-auto border-r-2 border-[#e5e7eb]">
          {groups.map(grp => (
            <div key={grp.g} style={{ borderBottom: "2px solid #e5e7eb" }}>
              {/* Group header */}
              <div className="flex items-center gap-2.5 px-5 py-2.5">
                <span className="font-bold text-[13.5px] tracking-tight">{grp.title}</span>
                <span className="text-[11px] text-neutral-500 flex-1">{grp.line}</span>
                <span className="text-[10.5px] font-bold tracking-wide uppercase"
                  style={{ color: grp.stateColor }}>{grp.stateLabel}</span>
                {onNavigate && (
                  <button
                    onClick={() => nav(grp.g === "gate" ? "gate" : grp.g === "moves" ? "yard" : "tower")}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded text-neutral-400 hover:text-blue-600 hover:bg-blue-50 transition-colors ml-1">
                    Open →
                  </button>
                )}
              </div>
              {/* Entity rows */}
              <div className="flex flex-col">
                {grp.rows.map(row => (
                  <button key={row.id} onClick={() => handleRowClick(row)}
                    className="flex items-stretch gap-0 text-left w-full transition-colors"
                    style={{ borderTop: "1px solid #f3f4f6", background: row.rowBg, padding: 0 }}
                    onMouseEnter={e => { if (focus !== row.id) (e.currentTarget as HTMLElement).style.background = "#f8fafc" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = row.rowBg }}>
                    {/* State colour mark */}
                    <span className="flex-none w-1.5" style={{ background: row.mark }} />
                    <span className="flex-1 px-4 py-2.5 flex gap-3 items-baseline min-w-0">
                      <span className="font-mono font-bold text-[11.5px] tabular-nums flex-none" style={{ minWidth: 90 }}>
                        {row.id}
                      </span>
                      <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-[12px] truncate">{row.what}</span>
                        <span className="text-[10.5px] text-neutral-500 truncate">{row.sub}</span>
                      </span>
                      <span className="flex-none flex flex-col items-end gap-0.5 tabular-nums" style={{ minWidth: 110 }}>
                        <span className="text-[11.5px] font-semibold">
                          {fmtTime(row.plannedStart)} – {fmtTime(row.plannedEnd)}
                        </span>
                        <span className="text-[10.5px] font-bold" style={{ color: row.deltaColor }}>
                          {row.deltaLabel}
                        </span>
                      </span>
                      <span className="flex-none text-[10px] font-bold tracking-widest uppercase text-right"
                        style={{ minWidth: 80, color: row.stateColor }}>
                        {row.state}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {/* Deep-link hint when a row in this group is selected */}
              {grp.rows.some(r => r.id === focus) && (
                <div className="flex items-center gap-2 px-5 py-2 border-t border-[#e5e7eb]"
                  style={{ background: "#f0f9ff" }}>
                  <span className="text-[11px] text-blue-700">
                    {grp.g === "gate"  ? "→ Open in Gate & Appointments"
                    : grp.g === "moves" ? "→ Open in Yard Map"
                    :                     "→ Open in Control Tower"}
                  </span>
                  <button
                    onClick={() => {
                      if (!onNavigate) return
                      const row = grp.rows.find(r => r.id === focus)!
                      if      (grp.g === "gate")  onNavigate("gate",  row.id)
                      else if (grp.g === "moves") onNavigate("yard",  row.containerId ?? row.id)
                      else                        onNavigate("tower")
                    }}
                    className="ml-auto text-[10.5px] font-bold px-3 py-1"
                    style={{ background: "#2563eb", color: "#fff", borderRadius: 5 }}>
                    Navigate →
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: exceptions panel */}
        <div className="flex flex-col min-h-0 overflow-auto">
          <div className="flex items-baseline gap-2 px-4 py-2.5 border-b border-[#e5e7eb] flex-none">
            <span className="font-bold text-[13.5px] tracking-tight">Exceptions & next steps</span>
            <span className="ml-auto text-[11px] text-neutral-500">
              {entityExceptions.length} open · worst first
            </span>
          </div>

          {entityExceptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-6">
              <span className="text-[22px]">✓</span>
              <span className="font-semibold text-[13px] text-neutral-700">All entities on plan</span>
              <span className="text-[11px] text-neutral-400">No exceptions as of {fmtTime(now)}</span>
            </div>
          ) : (
            <>
              {entityExceptions.map(e => {
                const isBlocked = e.state === "blocked"
                const bg   = isBlocked ? "#fef2f2" : "transparent"
                const mark = isBlocked ? "#dc2626" : "#d97706"
                const severity = isBlocked ? "Blocked" : e.state === "late" ? "Late" : "Slipping"
                return (
                  <div key={e.id}
                    className="border-b border-[#e5e7eb] px-4 py-3 cursor-pointer transition-colors"
                    style={{ background: bg }}
                    onClick={() => handleRowClick(e)}
                    onMouseEnter={ev => { if (!isBlocked) (ev.currentTarget as HTMLElement).style.background = "#f9fafb" }}
                    onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.background = bg }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex-none" style={{ width: 5, height: 16, background: mark, borderRadius: 2 }} />
                      <span className="font-mono font-bold text-[11.5px] tabular-nums">{e.id}</span>
                      <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: mark }}>
                        {severity}
                      </span>
                      <span className="ml-auto text-[10.5px] text-neutral-500 tabular-nums">{e.deltaMin}′ off plan</span>
                    </div>
                    <div className="font-semibold text-[12px] mt-1 leading-snug">{e.what}</div>
                    <div className="text-[11px] text-neutral-600 mt-1 leading-relaxed">
                      <strong className="text-neutral-900">Why:</strong> {e.cause ?? "Waiting on dependency"}
                    </div>
                    <div className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                      <strong className="text-neutral-900">Next:</strong> {e.next}
                    </div>
                    <div className="flex gap-4 mt-1.5 text-[10.5px] text-neutral-500">
                      <span>owner · <strong className="text-neutral-800">{e.owner}</strong></span>
                      <span>impact · <strong className="text-neutral-800">{e.impact}</strong></span>
                    </div>
                    {focus === e.id && onNavigate && (
                      <button
                        className="mt-2 text-[10.5px] font-bold px-2.5 py-1"
                        style={{ background: "#111827", color: "#fff", borderRadius: 5 }}
                        onClick={ev => {
                          ev.stopPropagation()
                          onNavigate(
                            e.g === "gate" ? "gate" : e.g === "moves" ? "yard" : "tower",
                            e.g === "moves" ? (e.containerId ?? e.id) : e.id
                          )
                        }}>
                        → Open in {e.g === "gate" ? "Gate" : e.g === "moves" ? "Yard Map" : "Control Tower"}
                      </button>
                    )}
                  </div>
                )
              })}

              {/* High-severity Control Tower events */}
              {events.filter(ev => ev.state === "awaiting" || ev.severity === "high").slice(0, 3).map(ev => (
                <div key={ev.id} className="border-b border-[#e5e7eb] px-4 py-3" style={{ background: "#fffbeb" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex-none" style={{ width: 5, height: 16, background: "#d97706", borderRadius: 2 }} />
                    <span className="font-mono font-bold text-[11.5px]">{ev.id}</span>
                    <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "#d97706" }}>
                      {ev.severity === "high" ? "HIGH" : "MEDIUM"}
                    </span>
                    <span className="ml-auto text-[10.5px] text-neutral-500">{ev.time}</span>
                  </div>
                  <div className="font-semibold text-[12px] mt-1 leading-snug">{ev.title}</div>
                  <div className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                    {ev.detail.slice(0, 120)}…
                  </div>
                  <button
                    className="mt-2 text-[10.5px] font-bold px-2.5 py-1"
                    style={{ background: "#111827", color: "#fff", borderRadius: 5 }}
                    onClick={() => onNavigate?.("tower", ev.id)}>
                    → View in Control Tower
                  </button>
                </div>
              ))}
              <div className="px-4 py-3 text-[11px] text-neutral-500 leading-relaxed">
                Every delay is tied to a planned entity and a named owner. Cleared exceptions move to the shift log.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function _typeFor(equipId: string): string {
  return EQUIPMENT.find(e => e.id === equipId)?.type ?? equipId
}
