import { useState, useMemo } from "react"
import { useData } from "@/lib/DataContext"
import type { Visit } from "@/data/yard-ops"
import { CONTAINERS } from "@/data/yard-data"
import { fmtTime } from "@/utils/time"
import Skeleton from "@/components/ui/Skeleton"
import { STORY_SHIFT_SUMMARY } from "@/data/story-seed"

interface Props {
  onNavigate?: (target: string, focus?: string) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────
function toMin(hhmm: string | null | undefined): number | null {
  if (!hhmm || hhmm === "—") return null
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}
// ── Static entity seeds (equipment stays static; gate + moves pull from DataContext) ─
const EQUIP_ENTITIES = [
  { g: "equip", id: "RS-01", what: "Reach-stacker · Zone A",     sub: "operator R. Giménez · shift 06:00–14:00",   plannedStart: 360, plannedEnd: 840, actualStart: 360, actualEnd: null, blocking: null,             cause: null,                                   owner: "Ops · R. Giménez",  impact: "Running",               next: "Next job MV-1028 at 06:42" },
  { g: "equip", id: "RS-02", what: "Reach-stacker · Zone B/C",   sub: "operator M. Sosa · shift 06:00–14:00",      plannedStart: 360, plannedEnd: 840, actualStart: 360, actualEnd: null, blocking: null,             cause: null,                                   owner: "Ops · M. Sosa",     impact: "Running",               next: "Pre-marshal MV-1032 at 07:22" },
  { g: "equip", id: "RS-03", what: "Reach-stacker · Zone C",     sub: "hydraulic fault — 30-min repair",           plannedStart: 360, plannedEnd: 840, actualStart: 360, actualEnd: null, blocking: "hydraulic fault", cause: "Maintenance dispatched 06:38",          owner: "Maint · A. Peña",   impact: "Zone C moves paused",   next: "ETA back 07:15 · 14 moves redistributed" },
  { g: "equip", id: "RS-04", what: "Reach-stacker · Zone D",     sub: "operator F. Ríos · shift 06:00–14:00",      plannedStart: 360, plannedEnd: 840, actualStart: 360, actualEnd: null, blocking: null,             cause: null,                                   owner: "Ops · F. Ríos",     impact: "Running",               next: "EH-01 load lane assigned" },
]
const HOUR_PLAN = [
  { hour: "06", planned: 6,  actual: 6   },
  { hour: "07", planned: 9,  actual: 8   },
  { hour: "08", planned: 12, actual: 10  },
  { hour: "09", planned: 14, actual: 11  },
  { hour: "10", planned: 15, actual: null},
  { hour: "11", planned: 13, actual: null},
  { hour: "12", planned: 10, actual: null},
  { hour: "13", planned: 8,  actual: null},
]
const NOW_OPTIONS = [
  { label: "06:00", t: 360 },
  { label: "08:00", t: 480 },
  { label: "10:00", t: 600 },
  { label: "12:00", t: 720 },
  { label: "14:00", t: 840 },
]
const GROUP_META: Record<string, { title: string; line: string }> = {
  gate:   { title: "Gate & appointments", line: "planned truck visits with appointment windows" },
  moves:  { title: "Yard moves",          line: "planned moves from the night plan" },
  equip:  { title: "Equipment & crews",   line: "assignments and availability" },
}

// ── Entity type ────────────────────────────────────────────────────────────
interface Entity {
  g: string; id: string; what: string; sub: string
  plannedStart: number; plannedEnd: number
  actualStart: number | null; actualEnd: number | null
  blocking: string | null; cause: string | null
  owner: string; impact: string; next: string
  containerId?: string   // moves: used as YardMap focus key
}

// ── State classification ───────────────────────────────────────────────────
function classify(e: Entity, now: number) {
  const started     = e.actualStart != null && e.actualStart <= now
  const finished    = e.actualEnd   != null && e.actualEnd   <= now
  const plannedByNow = e.plannedStart <= now
  let state: string; let deltaMin: number
  if (finished)                        { state = "done";       deltaMin = e.actualEnd! - e.plannedEnd }
  else if (started)                    { state = "in-progress"; deltaMin = e.actualStart! - e.plannedStart }
  else if (plannedByNow && e.blocking) { state = "blocked";    deltaMin = now - e.plannedStart }
  else if (plannedByNow)               { state = "late";       deltaMin = now - e.plannedStart }
  else                                 { state = "scheduled";  deltaMin = 0 }
  return { state, deltaMin }
}

const STATE_COLOR: Record<string, string> = {
  done:        "#6b7280",
  "in-progress":"#111827",
  blocked:     "#dc2626",
  late:        "#d97706",
  scheduled:   "#9ca3af",
}
const MARK_COLOR: Record<string, string> = {
  done:        "#d1d5db",
  "in-progress":"#111827",
  blocked:     "#dc2626",
  late:        "#d97706",
  scheduled:   "#e5e7eb",
}

// ── Component ──────────────────────────────────────────────────────────────
export default function LiveOps({ onNavigate }: Props) {
  const { visits, moves, events, dbLoading } = useData()
  const [now,   setNow]   = useState(360)   // default 06:00
  const [focus,     setFocus]     = useState<string | null>(null)
  const [showMore,  setShowMore]  = useState(false)

  // ── Build gate entities from live visits ─────────────────────────────────
  const gateEntities = useMemo<Entity[]>(() => visits.map((v: Visit) => {
    const apptMin   = toMin(v.appt)   ?? 480
    const queueMin  = toMin(v.queueIn)
    const checkMin  = toMin(v.checkIn)
    const gateMin   = toMin(v.gateOut)
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
      impact:       v.excl ? "Held — exclusion pending" : gateMin ? "Cleared" : queueMin ? "In progress" : "Scheduled",
      next:         v.excl ? "Resolve exclusion before admit" : gateMin ? `Lane ${v.lane} · booked` : `Lane ${v.lane}`,
    }
  }), [visits])

  // ── Build move entities from live moves ───────────────────────────────────
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
      containerId:  m.containerId,   // YardMap resolves by container ID, not move ID
    }
  }), [moves])

  // ── Assemble all entities ─────────────────────────────────────────────────
  const allEntities: Entity[] = [
    ...gateEntities,
    ...moveEntities,
    ...EQUIP_ENTITIES,
  ]

  // ── Enrich + classify ─────────────────────────────────────────────────────
  const enriched = useMemo(() => allEntities.map(e => {
    const { state, deltaMin } = classify(e, now)
    const stateColor = STATE_COLOR[state] ?? "#6b7280"
    const mark       = MARK_COLOR[state]  ?? "#e5e7eb"
    const deltaLabel = state === "scheduled"
      ? "starts " + fmtTime(e.plannedStart)
      : deltaMin === 0 ? "on time"
      : (deltaMin > 0 ? "+" : "") + deltaMin + "′"
    const deltaColor = (state === "blocked" || state === "late" || (state !== "scheduled" && Math.abs(deltaMin) > 5))
      ? "#dc2626" : "#6b7280"
    const rowBg = focus === e.id ? "#f3f4f6" : "transparent"
    return { ...e, state, deltaMin, stateColor, mark, deltaLabel, deltaColor, rowBg }
  }), [allEntities, now, focus])

  // ── Groups ────────────────────────────────────────────────────────────────
  // State sort order: green/on-plan first, red/blocked last
  const STATE_ORDER: Record<string, number> = {
    "done":        0,
    "in-progress": 1,
    "scheduled":   2,
    "late":        3,
    "blocked":     4,
  }
  const groups = useMemo(() => ["gate","moves","equip"].map(g => {
    const rows   = enriched
      .filter(x => x.g === g)
      .slice()
      .sort((a, b) => (STATE_ORDER[a.state] ?? 5) - (STATE_ORDER[b.state] ?? 5))
    const late   = rows.filter(x => x.state === "blocked" || x.state === "late").length
    const done   = rows.filter(x => x.state === "done").length
    const inProg = rows.filter(x => x.state === "in-progress").length
    const stateLabel = late > 0 ? `${late} off plan` : `${inProg} in progress · ${done} done`
    const stateColor = late > 0 ? "#dc2626" : "#6b7280"
    return { ...GROUP_META[g], g, rows, stateLabel, stateColor }
  }), [enriched])

  // ── Vitals ────────────────────────────────────────────────────────────────
  const totals    = enriched.length
  const onPlanCnt = enriched.filter(e => e.state === "done" || (e.state === "in-progress" && Math.abs(e.deltaMin) <= 5) || e.state === "scheduled").length
  const offPlan   = enriched.filter(e => e.state === "blocked" || e.state === "late").length
  const adherence = Math.round(onPlanCnt / Math.max(1, totals) * 100)
  const truckRows  = enriched.filter(e => e.g === "gate")
  const yardRows   = enriched.filter(e => e.g === "moves")
  const doneMoves  = yardRows.filter(e => e.state === "done").length
  const shiftStart = 360; const shiftEnd = 840
  const shiftPct   = Math.max(0, Math.min(100, Math.round((now - shiftStart) / (shiftEnd - shiftStart) * 100)))
  const equipUp    = EQUIP_ENTITIES.filter(e => !e.blocking).length
  const equipTotal = EQUIP_ENTITIES.length

  // ── KPI values (primary strip) ────────────────────────────────────────────
  const inboundCnt  = visits.filter((v: Visit) => /inbound|drop/i.test(v.purpose)).length
  const outboundCnt = visits.filter((v: Visit) => /outbound|pickup/i.test(v.purpose)).length
  const opsAvail    = equipUp
  const movesTotal  = moves.length
  const detRiskK    = +(CONTAINERS.filter(c => !c.empty && c.hoursToLFD <= 72)
    .reduce((s, c) => s + Math.max(0, (72 - c.hoursToLFD) * 125), 0) / 1000).toFixed(1)

  const shiftStatus      = offPlan >= 3 ? "AT RISK" : offPlan >= 1 ? "ON WATCH" : "ON PLAN"
  const shiftStatusColor = offPlan >= 3 ? "#dc2626"  : offPlan >= 1 ? "#d97706"  : "#111827"
  const shiftStatusBg    = offPlan >= 3 ? "#fef2f2"  : offPlan >= 1 ? "#fffbeb"  : "#f0fdf4"

  // ── Hour bars ─────────────────────────────────────────────────────────────
  const nowHour = Math.floor(now / 60)
  const maxBar  = 16
  const hourBars = HOUR_PLAN.map(h => {
    const hourN  = parseInt(h.hour, 10)
    const passed = hourN < nowHour
    const isNow  = hourN === nowHour
    const actual = passed ? h.actual
      : isNow ? Math.round((h.actual ?? h.planned) * ((now % 60) / 60))
      : null
    const under  = actual != null && actual < h.planned - 1
    return {
      hour: h.hour,
      plannedH: (h.planned / maxBar * 100).toFixed(1) + "%",
      actualH:  actual != null ? (actual / maxBar * 100).toFixed(1) + "%" : "0%",
      color:    under ? "#dc2626" : "#111827",
      isNow,
      labelColor:  isNow ? "#4f46e5" : "#9ca3af",
      labelWeight: isNow ? 700 : 400,
    }
  })

  // ── Exceptions ────────────────────────────────────────────────────────────
  // Combine classified entity exceptions + DataContext events
  const entityExceptions = enriched
    .filter(e => e.state === "blocked" || e.state === "late" || (e.state === "in-progress" && e.deltaMin > 15))
    .sort((a, b) => b.deltaMin - a.deltaMin)
  const unresolvedEx = entityExceptions.length

  // ── Row click → navigate ──────────────────────────────────────────────────
  function handleRowClick(e: Entity) {
    setFocus(prev => prev === e.id ? null : e.id)
    if (!onNavigate) return
    // Navigate on double-click pattern: if already focused, deep-link
    if (focus === e.id) {
      if      (e.g === "gate")  onNavigate("gate",  e.id)
      else if (e.g === "moves") onNavigate("yard",  e.containerId ?? e.id)
      else if (e.g === "equip") onNavigate("tower")
    }
  }

  // ── KPI navigate helper ───────────────────────────────────────────────────
  function nav(to: string, focus?: string) {
    onNavigate?.(to, focus)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white text-neutral-900">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 pt-3 pb-3 border-b-2 border-[#e5e7eb] flex-none flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="font-black text-[19px] tracking-tight leading-none">Live Operations</span>
          <span className="text-[11px] text-neutral-500 mt-0.5">
            Day shift · {fmtTime(shiftStart)}–{fmtTime(shiftEnd)} · {shiftPct}% elapsed · {doneMoves} of {yardRows.length} planned yard moves complete
          </span>
        </div>
        {/* Shift status pill */}
        <div
          className="flex items-center gap-1.5 px-3 py-1"
          style={{ border: `2px solid ${shiftStatusColor}`, background: shiftStatusBg }}>
          <span className="rounded-full flex-none" style={{ width: 8, height: 8, background: shiftStatusColor }} />
          <span className="text-[10.5px] font-bold tracking-widest uppercase" style={{ color: shiftStatusColor }}>{shiftStatus}</span>
        </div>
        {/* Time chips */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="ds-label text-neutral-400">AS OF</span>
          <div className="flex" style={{ border: "1px solid #e5e7eb", borderRadius: 5, overflow: "hidden" }}>
            {NOW_OPTIONS.map(o => (
              <button
                key={o.t}
                onClick={() => { setNow(o.t); setFocus(null) }}
                className="text-[11px] px-3 py-1.5 font-bold tabular-nums transition-colors"
                style={{
                  borderRight:  o.t !== 840 ? "1px solid #e5e7eb" : undefined,
                  background:   now === o.t ? "#111827" : "transparent",
                  color:        now === o.t ? "#fff"    : "#374151",
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Vitals KPI strip ─────────────────────────────────────────────── */}
      <div className="flex flex-col border-b-2 border-[#e5e7eb] flex-none bg-white">
        {/* Primary row — always visible */}
        <div className="flex items-stretch">
          {dbLoading ? (
            [0,1,2,3,4].map(i => <Skeleton key={i} variant="kpi" />)
          ) : ([
            { k: "Inbound containers",  v: String(inboundCnt),  sub: "containers today",              color: "#111827",                                     to: "gate",     fk: "inbound"  },
            { k: "Outbound containers", v: String(outboundCnt), sub: "containers today",              color: "#111827",                                     to: "gate",     fk: "outbound" },
            { k: "Operators available", v: String(opsAvail),    sub: `${opsAvail} of ${equipTotal} on shift`, color: opsAvail < equipTotal ? "#d97706" : "#111827", to: "operator", fk: undefined  },
            { k: "Moves created",       v: String(movesTotal),  sub: "in shift plan",                color: "#111827",                                     to: "plan",     fk: undefined  },
            { k: "Detention risk",      v: `$${detRiskK}k`,    sub: "next 72 h",                    color: detRiskK > 5 ? "#dc2626" : "#d97706",          to: "gate",     fk: "inbound"  },
          ] as { k: string; v: string; sub: string; color?: string; to: string; fk?: string }[]).map((m, i, arr) => {
            const hint = m.to === "gate" ? "Gate & Appointments" : m.to === "plan" ? "Planner" : m.to === "operator" ? "Operator Tablet" : "Control Tower"
            return (
            <button
              key={m.k}
              onClick={() => nav(m.to, m.fk)}
              className="flex-1 px-5 py-2.5 flex flex-col gap-0.5 text-left transition-colors hover:bg-[#f9fafb] group"
              style={{ borderRight: i < arr.length - 1 ? "1px solid #e5e7eb" : undefined, cursor: "pointer" }}
            >
              <span className="ds-label text-neutral-500">{m.k}</span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-[24px] leading-none" style={{ color: m.color }}>{m.v}</span>
                <span className="text-[11px] text-neutral-500">{m.sub}</span>
              </div>
              <span className="text-[9.5px] text-neutral-300 group-hover:text-blue-400 transition-colors">→ {hint}</span>
            </button>
          )})}

          {/* Toggle button — flush right, matching GateConsole style */}
          <button
            onClick={() => setShowMore(v => !v)}
            className="flex-none flex items-center gap-1.5 px-4 text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors whitespace-nowrap"
            style={{ borderLeft: "1px solid #e5e7eb" }}
          >
            {showMore ? "Fewer metrics ▲" : "More metrics ▼"}
          </button>
        </div>

        {/* Hidden strip */}
        {showMore && (
          <div className="flex items-stretch border-t border-[#e5e7eb] bg-[#fafafa]">
            {([
              { k: "Equipment on yard",     v: `${equipUp} / ${equipTotal}`, sub: equipUp < equipTotal ? `${equipTotal - equipUp} in repair` : "all available", color: equipUp < equipTotal ? "#d97706" : "#111827", to: "tower" },
              { k: "Unresolved exceptions", v: String(unresolvedEx),         sub: "need attention",                                                              color: unresolvedEx > 0 ? "#dc2626" : "#111827",    to: "tower" },
            ] as { k: string; v: string; sub: string; color?: string; to: string }[]).map((m, i) => (
              <button
                key={m.k}
                onClick={() => nav(m.to)}
                className="px-5 py-2 flex flex-col gap-0.5 text-left transition-colors hover:bg-white group"
                style={{ borderRight: i === 0 ? "1px solid #e5e7eb" : undefined, minWidth: 180, cursor: "pointer" }}
              >
                <span className="ds-label text-neutral-500">{m.k}</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-bold text-[20px] leading-none" style={{ color: m.color }}>{m.v}</span>
                  <span className="text-[11px] text-neutral-500">{m.sub}</span>
                </div>
                <span className="text-[9.5px] text-neutral-300 group-hover:text-blue-400 transition-colors">→ Control Tower</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Hour chart ───────────────────────────────────────────────────── */}
      <div className="flex flex-col px-5 py-3 border-b-2 border-[#e5e7eb] flex-none bg-[#f9fafb]">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="ds-label text-neutral-500">Shift progress · planned throughput vs actual</span>
          <span className="text-[11px] text-neutral-500">now marker at {fmtTime(now)}</span>
        </div>
        <div className="flex gap-1.5 items-end h-16">
          {hourBars.map(h => (
            <button
              key={h.hour}
              title={`Set view to ${h.hour}:00`}
              onClick={() => { setNow(parseInt(h.hour, 10) * 60); setFocus(null) }}
              className="flex-1 flex flex-col justify-end gap-0.5 relative group hover:opacity-80 transition-opacity"
              style={{ minWidth: 28, cursor: "pointer", background: "transparent", padding: 0 }}>
              {h.isNow && (
                <div className="absolute left-1/2 -translate-x-1/2" style={{ top: -4, bottom: 14, width: 2, background: "#4f46e5" }} />
              )}
              {/* Planned bar (outline) */}
              <div style={{ height: h.plannedH, background: "#e5e7eb", border: "1px solid #d1d5db" }} />
              {/* Actual bar (solid, overlapping via negative margin) */}
              <div style={{ height: h.actualH, background: h.color, marginTop: -2 }} className="relative z-10" />
              <span className="text-center tabular-nums" style={{ fontSize: 9.5, color: h.labelColor, fontWeight: h.labelWeight }}>{h.hour}</span>
            </button>
          ))}
        </div>
        <div className="text-[10.5px] text-neutral-500 mt-1.5">
          Grey outline = plan · solid = actuals booked to the hour · <span style={{ color: "#4f46e5" }}>accent line</span> = as-of time
        </div>
      </div>

      {/* ── Shift progress scorecard ─────────────────────────────────────── */}
      <div className="flex flex-col border-b-2 border-[#e5e7eb] flex-none bg-[#fafafa]">
        <div className="flex items-baseline gap-3 px-5 py-1.5 border-b border-[#e5e7eb]">
          <span className="ds-label text-neutral-500">Shift summary</span>
          <span className="text-[11px] text-neutral-500">14:00–{STORY_SHIFT_SUMMARY.closeTime} · {STORY_SHIFT_SUMMARY.plansExecuted.length} plans executed</span>
        </div>
        <div className="flex items-stretch">
          {([
            { k:"Received",         v:String(STORY_SHIFT_SUMMARY.received),               sub:"inbound containers",             color:"#111827",  to:"gate",  fk:"inbound"  },
            { k:"Shipped",          v:String(STORY_SHIFT_SUMMARY.shipped),                sub:"outbound dispatched",             color:"#111827",  to:"gate",  fk:"outbound" },
            { k:"Chassis returned", v:`${STORY_SHIFT_SUMMARY.chassisReturned}/${STORY_SHIFT_SUMMARY.chassisTotal}`, sub:"all accounted for", color: STORY_SHIFT_SUMMARY.chassisReturned === STORY_SHIFT_SUMMARY.chassisTotal ? "#166534" : "#d97706", to:"yard",  fk:undefined  },
            { k:"Disruptions",      v:String(STORY_SHIFT_SUMMARY.disruptionsHandled),     sub:`avg ${STORY_SHIFT_SUMMARY.disruptionAvgResolveMin} min resolve`, color:"#111827", to:"tower", fk:undefined  },
            { k:"Plans executed",   v:String(STORY_SHIFT_SUMMARY.plansExecuted.length),   sub:STORY_SHIFT_SUMMARY.plansExecuted.join(" · "),    color:"#111827",  to:"plan",  fk:undefined  },
            { k:"Plans superseded", v:String(STORY_SHIFT_SUMMARY.plansSuperseded.length), sub:STORY_SHIFT_SUMMARY.plansSuperseded.join(" · ") || "none", color: STORY_SHIFT_SUMMARY.plansSuperseded.length > 0 ? "#b45309" : "#166534", to:"plan", fk:undefined },
            { k:"Slots reconciled", v:STORY_SHIFT_SUMMARY.slotsReconciled ? "Yes" : "No", sub:"end-of-shift audit",             color: STORY_SHIFT_SUMMARY.slotsReconciled ? "#166534" : "#dc2626", to:"yard", fk:undefined },
          ] as { k: string; v: string; sub: string; color?: string; to: string; fk?: string }[]).map((m, i, arr) => {
            const hint = m.to === "gate" ? "Gate" : m.to === "plan" ? "Planner" : m.to === "yard" ? "Yard Map" : "Control Tower"
            return (
            <button key={m.k} onClick={() => nav(m.to, m.fk)}
              className="flex-1 px-5 py-2 flex flex-col gap-0.5 text-left transition-colors hover:bg-white group"
              style={{ borderRight: i < arr.length - 1 ? "1px solid #e5e7eb" : undefined, cursor:"pointer" }}>
              <span className="ds-label text-neutral-500">{m.k}</span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-[22px] leading-none" style={{ color: m.color }}>{m.v}</span>
                <span className="text-[11px] text-neutral-500">{m.sub}</span>
              </div>
              <span className="text-[9.5px] text-neutral-300 group-hover:text-blue-400 transition-colors">→ {hint}</span>
            </button>
          )})}
        </div>
      </div>

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <div className="grid flex-1 min-h-0 overflow-hidden" style={{ gridTemplateColumns: "minmax(0,60fr) minmax(0,40fr)" }}>

        {/* ── Left: entity groups ───────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 overflow-auto border-r-2 border-[#e5e7eb]">
          {groups.map(grp => (
            <div key={grp.g} style={{ borderBottom: "2px solid #e5e7eb" }}>
              {/* Group header */}
              <div className="flex items-center gap-2.5 px-5 py-2.5">
                <span className="font-bold text-[13.5px] tracking-tight">{grp.title}</span>
                <span className="text-[11px] text-neutral-500 flex-1">{grp.line}</span>
                <span className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: grp.stateColor }}>{grp.stateLabel}</span>
                {onNavigate && (
                  <button
                    onClick={() => nav(grp.g === "gate" ? "gate" : grp.g === "moves" ? "yard" : "tower")}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded text-neutral-400 hover:text-blue-600 hover:bg-blue-50 transition-colors ml-1">
                    Open →
                  </button>
                )}
              </div>
              {/* Rows */}
              <div className="flex flex-col">
                {grp.rows.map(row => (
                  <button
                    key={row.id}
                    onClick={() => handleRowClick(row)}
                    className="flex items-stretch gap-0 text-left w-full transition-colors"
                    style={{
                      borderTop: "1px solid #f3f4f6",
                      background: row.rowBg,
                      padding: 0,
                    }}
                    onMouseEnter={e => { if (focus !== row.id) (e.currentTarget as HTMLElement).style.background = "#f8fafc" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = row.rowBg }}
                  >
                    {/* Left colour mark */}
                    <span className="flex-none w-1.5" style={{ background: row.mark }} />
                    {/* Content */}
                    <span className="flex-1 px-4 py-2.5 flex gap-3 items-baseline min-w-0">
                      {/* ID */}
                      <span className="font-mono font-bold text-[11.5px] tabular-nums flex-none" style={{ minWidth: 90 }}>{row.id}</span>
                      {/* What + sub */}
                      <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-[12px] truncate">{row.what}</span>
                        <span className="text-[10.5px] text-neutral-500 truncate">{row.sub}</span>
                      </span>
                      {/* Planned + delta */}
                      <span className="flex-none flex flex-col items-end gap-0.5 tabular-nums" style={{ minWidth: 110 }}>
                        <span className="text-[11.5px] font-semibold">{fmtTime(row.plannedStart)} – {fmtTime(row.plannedEnd)}</span>
                        <span className="text-[10.5px] font-bold" style={{ color: row.deltaColor }}>{row.deltaLabel}</span>
                      </span>
                      {/* State */}
                      <span className="flex-none text-[10px] font-bold tracking-widest uppercase text-right" style={{ minWidth: 80, color: row.stateColor }}>{row.state}</span>
                    </span>
                  </button>
                ))}
              </div>

              {/* Deep-link hint when a row in this group is focused */}
              {grp.rows.some(r => r.id === focus) && (
                <div
                  className="flex items-center gap-2 px-5 py-2 border-t border-[#e5e7eb]"
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

        {/* ── Right: exceptions panel ───────────────────────────────────── */}
        <div className="flex flex-col min-h-0 overflow-auto">
          {/* Panel header */}
          <div className="flex items-baseline gap-2 px-4 py-2.5 border-b border-[#e5e7eb] flex-none">
            <span className="font-bold text-[13.5px] tracking-tight">Exceptions & next steps</span>
            <span className="ml-auto text-[11px] text-neutral-500">{entityExceptions.length} open · worst first</span>
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
                const bg        = isBlocked ? "#fef2f2" : "transparent"
                const mark      = isBlocked ? "#dc2626" : "#d97706"
                const severity  = isBlocked ? "Blocked" : e.state === "late" ? "Late" : "Slipping"
                return (
                  <div
                    key={e.id}
                    className="border-b border-[#e5e7eb] px-4 py-3 cursor-pointer transition-colors"
                    style={{ background: bg }}
                    onClick={() => handleRowClick(e)}
                    onMouseEnter={ev => { if (!isBlocked) (ev.currentTarget as HTMLElement).style.background = "#f9fafb" }}
                    onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.background = bg }}>
                    {/* Exception header */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex-none" style={{ width: 5, height: 16, background: mark, borderRadius: 2 }} />
                      <span className="font-mono font-bold text-[11.5px] tabular-nums">{e.id}</span>
                      <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: mark }}>{severity}</span>
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
                    {/* Navigate shortcut */}
                    {focus === e.id && onNavigate && (
                      <button
                        className="mt-2 text-[10.5px] font-bold px-2.5 py-1"
                        style={{ background: "#111827", color: "#fff", borderRadius: 5 }}
                        onClick={ev => { ev.stopPropagation(); onNavigate(e.g === "gate" ? "gate" : e.g === "moves" ? "yard" : "tower", e.g === "moves" ? (e.containerId ?? e.id) : e.id) }}>
                        → Open in {e.g === "gate" ? "Gate" : e.g === "moves" ? "Yard Map" : "Control Tower"}
                      </button>
                    )}
                  </div>
                )
              })}
              {/* Events from Control Tower that are awaiting */}
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
                  <div className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">{ev.detail.slice(0, 120)}…</div>
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
