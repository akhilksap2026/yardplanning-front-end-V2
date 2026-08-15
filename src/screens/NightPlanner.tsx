import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TYPE_LABEL, CONTAINERS, getHotContainers, EQUIPMENT, OPERATORS, type Move } from "@/data/yard-data"
import { useData } from "@/lib/DataContext"
import { adaptMoveForDisplay, REASON_LABELS } from "@/lib/backend-adapters"
import { checkPlacementRules } from "@/lib/placement-rules"
import { backendApi } from "@/lib/backend-api"
import type { BackendPlanDetail } from "@/lib/backend-api"
import { allSteps, operatorNames, dashboardCounts, stepsForOperator, type PlanningStep } from "@/data/planningData"
import { getDisplayOperation, getDisplayMoveMethod, getEquipmentType, isExtraMovement, getStatusStyle, getDisplayContainerId, isAnonymousContainer, generateWhyText } from "@/utils/displayLabels"

interface Props {
  focus: string | null
  onNavigate: (target: string, focus?: string) => void
}

const WEIGHTS = [
  { k: "Machine minutes",       v: "0.40", pct: 40 },
  { k: "Weighted lateness",     v: "0.25", pct: 25 },
  { k: "Predicted rehandles",   v: "0.20", pct: 20 },
  { k: "Detention exposure",    v: "0.15", pct: 15 },
]

const HOURS = ["06","07","08","09","10","11","12","13"]

const PLAN_STATUS_VARIANT: Record<string, "brand" | "muted" | "amber" | "green" | "red"> = {
  draft:       "muted",
  confirmed:   "green",
  in_progress: "brand",
  superseded:  "amber",
}

type PlanSource = "seed" | "engine"

// ── planningData display helpers ─────────────────────────────────────────────
function fmtLoc(loc: PlanningStep["origin"]): string {
  if (!loc || loc.bay == null) return "—"
  if (loc.bay === "GATE / OFF-YARD") return "GATE"
  return `Bay ${loc.bay} · R${loc.row ?? "?"} · T${loc.tier ?? "?"}`
}
function stepId(s: PlanningStep): string {
  // Use a stable unique key even when container_id is null (53 anonymous steps)
  const cid = s.container_id ?? `anon-${s.step_number ?? 0}`
  return `${cid}-${s.step_number ?? 0}-${s.operation.slice(0,4)}`
}
function stepDur(s: PlanningStep): number {
  if (!s.estimated_start || !s.estimated_end) return 2.5
  return Math.round((new Date(s.estimated_end).getTime() - new Date(s.estimated_start).getTime()) / 60000 * 10) / 10
}
function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—"
  return iso.slice(11, 16)
}
function isoToMin(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

// Step 3: column definitions
const ALL_COLS = ["SEQ","WINDOW","MOVE","ROUTE","ASSIGNED","EST"] as const
type Col = typeof ALL_COLS[number]
const DEFAULT_COLS = new Set<Col>(["SEQ","MOVE","ROUTE","ASSIGNED"])

export default function NightPlanner({ focus, onNavigate }: Props) {
  const {
    moves, operators, assumptions, exceptions, refresh,
    backendConnected, activePlan, plans,
    backendContainers, backendSlots, backendJockeys,
    generatePlan, confirmPlan,
  } = useData()

  // ── Existing state ────────────────────────────────────────────────────────
  const [sel,          setSel]          = useState<string>(() => { const s = allSteps[0]; return s ? stepId(s) : "" })
  const [tab,          setTab]          = useState("detail")
  const [q,            setQ]            = useState("")
  const [filter,       setFilter]       = useState("ALL")
  const [published,    setPublished]    = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  const [configOpen,   setConfigOpen]   = useState(false)
  const [wRaw,         setWRaw]         = useState([35, 40, 25])

  // ── Constraint toggles + weights ────────────────────────────────────────────
  type ConstraintState = { enabled: boolean; weight: number }
  const CONSTRAINT_KEYS = [
    "Size eligibility","Reefer match","Slot status","Tier status","Weight limits","Max stack height",
    "Hazmat allowed","Spatial hazmat segregation","Active holds",
    "Certification","Chassis prerequisites",
  ]
  const [constraints, setConstraints] = useState<Record<string, ConstraintState>>(
    () => Object.fromEntries(CONSTRAINT_KEYS.map(k => [k, { enabled: true, weight: 50 }]))
  )
  function toggleConstraint(k: string) {
    setConstraints(prev => ({ ...prev, [k]: { ...prev[k], enabled: !prev[k].enabled } }))
  }
  function setConstraintWeight(k: string, w: number) {
    setConstraints(prev => ({ ...prev, [k]: { ...prev[k], weight: w } }))
  }
  const [planSource,   setPlanSource]   = useState<PlanSource>("seed")
  const [generating,   setGenerating]   = useState(false)
  const [confirming,   setConfirming]   = useState(false)
  const [viewedPlan,   setViewedPlan]   = useState<BackendPlanDetail | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [engineSel,    setEngineSel]    = useState<number | null>(null)

  // ── New state: Steps 1–5 ─────────────────────────────────────────────────
  const [kpiExpanded,       setKpiExpanded]       = useState(false)          // Step 1
  const [drawerOpen,        setDrawerOpen]         = useState(false)          // Step 2
  const [visibleCols,       setVisibleCols]        = useState<Set<Col>>(new Set(DEFAULT_COLS)) // Step 3
  const [colChooserOpen,    setColChooserOpen]     = useState(false)          // Step 3
  const [constraintsOpen,   setConstraintsOpen]    = useState(false)          // Step 4
  const [moveHistoryOpen,   setMoveHistoryOpen]    = useState(false)          // Step 4
  const [ganttExpanded,     setGanttExpanded]      = useState(false)          // Step 5
  const colChooserRef = useRef<HTMLDivElement>(null)

  // ── Manual edit state ────────────────────────────────────────────────────
  const [editOpen,      setEditOpen]      = useState(false)
  const [editEquip,     setEditEquip]     = useState("")
  const [editOpId,      setEditOpId]      = useState("")
  const [editStart,     setEditStart]     = useState("")
  const [editEnd,       setEditEnd]       = useState("")
  const [editTo,        setEditTo]        = useState("")
  // overrides keyed by move id — merged at display time
  const [moveOverrides, setMoveOverrides] = useState<Record<string, {
    equipment?: string; operator?: string; operatorName?: string
    start?: string; end?: string; to?: string; passed?: boolean
  }>>({})

  // Reset edit draft whenever the selected move changes
  useEffect(() => {
    setEditOpen(false)
  }, [sel])

  // ── Keep viewedPlan in sync with activePlan ───────────────────────────────
  useEffect(() => { setViewedPlan(prev => prev ?? activePlan) }, [activePlan])

  // ── Column chooser outside-click close ───────────────────────────────────
  useEffect(() => {
    if (!colChooserOpen) return
    function handler(e: MouseEvent) {
      if (colChooserRef.current && !colChooserRef.current.contains(e.target as Node)) {
        setColChooserOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [colChooserOpen])

  // ── Publish handler ───────────────────────────────────────────────────────
  async function handlePublish() {
    if (published || publishing) return
    setPublishing(true)
    try {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2,"0")
      const mm = String(now.getMinutes()).padStart(2,"0")
      await backendApi.postEvent({
        id: "EV-PUB-" + String(Date.now()).slice(-6),
        time: `${hh}:${mm}`,
        type: "PLAN_PUBLISHED", severity: "low", state: "replanned", auto: "Manual",
        title: `Plan P-2026-08-11 approved — ${allSteps.length} steps published`,
        detail: `Yard Manager approved the planner. ${allSteps.filter(s=>s.step_status==="Blocked").length} blocked, ${allSteps.length} total.`,
        diff: { cancelled:0, added:0, reassigned:0, frozenKept:allSteps.filter(s=>s.step_status==="Blocked").length, deltaMin:0, adherence:0 },
      })
      await refresh(["events"])
      setPublished(true)
    } catch (err) {
      console.error("[NightPlanner] publish failed:", err)
      // intentionally NOT setting published — let the user retry
    } finally { setPublishing(false) }
  }

  // ── Engine handlers ───────────────────────────────────────────────────────
  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    try { const plan = await generatePlan("cp_sat"); if (plan) setViewedPlan(plan) }
    finally { setGenerating(false) }
  }

  async function handleConfirm() {
    if (!viewedPlan || confirming) return
    setConfirming(true)
    try {
      const ok = await confirmPlan(viewedPlan.id)
      if (ok) setViewedPlan(prev => prev ? { ...prev, status: "confirmed" } : prev)
    } finally { setConfirming(false) }
  }

  async function handleHistorySelect(planId: number) {
    if (historyLoading) return
    setHistoryLoading(true)
    try { const detail = await backendApi.plan(planId); setViewedPlan(detail) }
    catch (err) { console.error("[NightPlanner] history fetch failed:", err) }
    finally { setHistoryLoading(false) }
  }

  // ── Focus handling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!focus) return
    const s = allSteps.find(x => x.container_id === focus || stepId(x) === focus)
    if (s) { setSel(stepId(s)); setTab("detail"); setFilter("ALL"); setQ("") }
    else { setQ(focus); setFilter("ALL"); setSel(""); setTab("detail") }
  }, [focus])

  // ── Seed derived values (planningData) ────────────────────────────────────
  const OP_FILTER_TYPES = ["ALL","Putaway","Premarshal ahead of retrieval","Outbound staging and truck loading","Digout to clear an overstow"]
  const ql           = q.trim().toLowerCase()
  const planningRows = allSteps.filter(s =>
    s.operation !== "Discharge from vessel" &&
    (filter === "ALL" || s.operation === filter) &&
    (!ql || (s.container_id + fmtLoc(s.origin) + fmtLoc(s.destination) + (s.operator ?? "") + s.operation).toLowerCase().includes(ql))
  )
  const selStep      = allSteps.find(s => stepId(s) === sel) ?? null
  const onShift      = operators.filter(o => o.status === "on shift")
  const frozenCount  = allSteps.filter(s => s.step_status === "Blocked").length
  const hotContainerIds = getHotContainers(CONTAINERS, 6)

  // ── Engine derived values ─────────────────────────────────────────────────
  const engineMoves = viewedPlan
    ? viewedPlan.moves.map(m => adaptMoveForDisplay(m, backendContainers, backendSlots, backendJockeys))
    : []
  const engineSelMove = engineMoves.find(m => m.id === engineSel) || engineMoves[0] || null

  const projection = [
    { k:"Truck turn P50",    target:"15.0′", opt:"11.8′", exp:"13.4′", pes:"17.1′", bandLeft:20, bandWidth:48, mark:66 },
    { k:"Truck turn P90",    target:"22.0′", opt:"18.2′", exp:"21.0′", pes:"27.4′", bandLeft:26, bandWidth:52, mark:70 },
    { k:"Job cycle P50",     target:"5.0′",  opt:"4.2′",  exp:"4.8′",  pes:"6.1′",  bandLeft:18, bandWidth:50, mark:62 },
    { k:"Plan adherence",    target:"≥85%",  opt:"94%",   exp:"89%",   pes:"78%",   bandLeft:22, bandWidth:56, mark:58 },
    { k:"Detention breaches",target:"0",     opt:"0",     exp:"0",     pes:"2",     bandLeft:10, bandWidth:40, mark:22 },
  ]

  // ── Step 3: Column toggle helper ─────────────────────────────────────────
  function toggleCol(col: Col) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(col)) { if (next.size > 2) next.delete(col) } // keep at least 2
      else next.add(col)
      return next
    })
  }

  // ── Step 3: MoveRow — column-aware, 44px height, 11px font ───────────────
  type MoveRowData =
    | { source: "seed"; move: Move }
    | { source: "engine"; move: ReturnType<typeof adaptMoveForDisplay> }
    | { source: "planning"; move: PlanningStep }

  function MoveRow({ m, isSelected, onClick }: { m: MoveRowData; isSelected: boolean; onClick: () => void }) {
    const typeDisplay  = m.source === "planning" ? getDisplayOperation(m.move.operation)
      : m.source === "seed" ? (TYPE_LABEL[m.move.type] ?? m.move.type) : m.move.typeLabel
    const stateDisplay = m.source === "planning" ? m.move.step_status
      : m.source === "seed" ? (m.move.state ?? "") : m.move.stateLabel
    const isCompleted  = m.source === "planning" ? m.move.step_status === "Completed"
      : m.source === "seed" ? (m.move.state === "done" || m.move.state === "complete" || m.move.state === "completed")
      : (m.move.status === "done" || m.move.status === "cancelled")
    const frozen       = m.source === "planning" ? m.move.step_status === "Blocked" : m.move.frozen
    const windowStr    = m.source === "planning"
      ? (m.move.estimated_start
          ? fmtIso(m.move.estimated_start) + "–" + fmtIso(m.move.estimated_end)
          : m.move.step_status === "Completed" ? "✓ done" : "not scheduled")
      : m.source === "seed" ? `${m.move.start}–${m.move.end}` : `seq ${m.move.sequence_number}`
    const containerId  = m.source === "planning" ? m.move.container_id : m.move.containerId
    const seqNum       = m.source === "planning" ? (m.move.planned_step ?? m.move.step_number ?? 0) : m.move.seq
    const fromStr      = m.source === "planning" ? fmtLoc(m.move.origin) : m.move.from
    const toStr        = m.source === "planning" ? fmtLoc(m.move.destination) : m.move.to
    const operatorName = m.source === "planning" ? (m.move.operator ?? "—") : m.move.operatorName
    const equipLabel   = m.source === "planning" ? getDisplayMoveMethod(m.move) : m.move.equipment
    const estMin       = m.source === "planning" ? stepDur(m.move) : m.move.estMin
    const isHot        = m.source !== "planning" && hotContainerIds.has(containerId ?? "")
    const isExtra      = m.source === "planning" && isExtraMovement(m.move.operation)
    const equipBadge   = m.source === "planning" ? getEquipmentType(m.move) : null
    const statusStyle  = m.source === "planning" ? getStatusStyle(m.move.step_status) : null

    return (
      <tr
        onClick={onClick}
        className="cursor-pointer hover:bg-[#f9fafb] transition-colors"
        style={{
          background: isSelected ? "#fef3f2" : isHot ? "#fff8f5" : isCompleted ? "#fafafa" : isExtra ? "#fffbeb" : undefined,
          borderBottom: "1px solid #f3f4f6",
          minHeight: 44,
        }}
      >
        {visibleCols.has("SEQ") && (
          <td className="py-2.5 pl-4 pr-2.5 font-mono text-[#9ca3af]" style={{ fontSize: 11, borderLeft: `3px solid ${isSelected ? "#dc2626" : isHot ? "#f97316" : frozen ? "#9ca3af" : isExtra ? "#fbbf24" : "transparent"}` }}>
            {String(seqNum).padStart(3,"0")}
          </td>
        )}
        {visibleCols.has("WINDOW") && (
          <td className="px-3 py-2.5 font-mono whitespace-nowrap" style={{ fontSize: 11 }}>{windowStr}</td>
        )}
        {visibleCols.has("MOVE") && (
          <td className="px-3 py-2.5" style={{ fontSize: 11 }}>
            <div className="font-bold">{typeDisplay}</div>
            <div className="text-[10px] font-mono" style={{
              color: m.source === "planning" && isAnonymousContainer(m.move) ? "#d1d5db" : "#9ca3af",
              fontStyle: m.source === "planning" && isAnonymousContainer(m.move) ? "italic" : undefined,
            }}>
              {isHot && <span title="Hot container" className="mr-1">🔥</span>}
              {m.source === "planning" ? getDisplayContainerId(m.move) : containerId}
            </div>
          </td>
        )}
        {visibleCols.has("ROUTE") && (
          <td className="px-3 py-2.5 font-mono text-[#374151] whitespace-nowrap" style={{ fontSize: 11 }}>{fromStr} → {toStr}</td>
        )}
        {visibleCols.has("ASSIGNED") && (
          <td className="px-3 py-2.5 whitespace-nowrap" style={{ fontSize: 11 }}>
            <div>{operatorName}</div>
            {equipBadge && statusStyle ? (
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none"
                  style={{ background: equipBadge.bg, color: equipBadge.text }}>
                  {equipBadge.icon} {equipBadge.label}
                </span>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none"
                  style={{ background: statusStyle.bg, color: statusStyle.text }}>
                  {stateDisplay}
                </span>
              </div>
            ) : (
              <div className="text-[10px] text-[#9ca3af]">{equipLabel} · {stateDisplay.toLowerCase()}</div>
            )}
          </td>
        )}
        {visibleCols.has("EST") && (
          <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ fontSize: 11 }}>{estMin.toFixed(1)}′</td>
        )}
      </tr>
    )
  }

  // ── Step 1: KPI data arrays (planningData) ───────────────────────────────
  const { totalSteps, totalOperators } = dashboardCounts()
  const inbounds    = allSteps.filter(s => s.operation === "Putaway").length
  const outbounds   = allSteps.filter(s => s.operation === "Outbound staging and truck loading").length
  const equipAvail  = EQUIPMENT.filter(e => e.status === "available").length
  const primaryKpis = [
    { k:"Inbound containers",  v:String(inbounds),           sub:"containers today",                                                                      red:false },
    { k:"Outbound containers", v:String(outbounds),          sub:"containers today",                                                                      red:false },
    { k:"Operators available", v:String(totalOperators),     sub:`${totalOperators} of ${totalOperators} on shift`,                                       red:false },
    { k:"Moves created",       v:String(totalSteps),         sub:"in shift plan",                                                                         red:false },
    { k:"Detention risk",      v:"$8.4k",                    sub:"next 72 h",                                                                             red:true  },
  ]
  const rehandleSteps = allSteps.filter(s => isExtraMovement(s.operation)).length
  const rehandleRatio = allSteps.length > 0 ? Math.round(rehandleSteps / allSteps.length * 100) : 0
  const secondaryKpis = [
    { k:"Equipment on yard",     v:`${equipAvail} / ${EQUIPMENT.length}`, sub:equipAvail < EQUIPMENT.length ? `${EQUIPMENT.length - equipAvail} in maintenance` : "all available", red:equipAvail < EQUIPMENT.length },
    { k:"Unresolved exceptions", v:String(exceptions.length),             sub:"need attention",                                                           red:exceptions.length > 0 },
    { k:"Rehandle Ratio",        v:`${rehandleRatio}%`,                   sub:"reshuffle · digout of total",                                              red:rehandleRatio > 50  },
  ]
  const engineKpis = viewedPlan ? [
    { k:"Moves",     v:String(viewedPlan.moves.length),                                         sub:"in this plan",  red:false },
    { k:"Strategy",  v:viewedPlan.strategy,                                                     sub:"solver",        red:false },
    { k:"Solve time",v:viewedPlan.solve_seconds != null ? viewedPlan.solve_seconds.toFixed(1)+"s":"—", sub:"wall clock",  red:false },
    { k:"Objective", v:viewedPlan.objective_value != null ? viewedPlan.objective_value.toFixed(2):"—", sub:"minimised",   red:false },
    { k:"Gap",       v:viewedPlan.gap_percent != null ? viewedPlan.gap_percent.toFixed(1)+"%":"—",     sub:"optimality",  red:false },
    { k:"Status",    v:viewedPlan.status.replace("_"," "),                                      sub:"plan state",    red:false },
  ] : []

  function KpiCell({ m, onClick }: { m: { k:string; v:string; sub:string; red:boolean }; onClick?: () => void }) {
    return (
      <div
        onClick={onClick}
        className="flex-1 basis-36 px-5 py-2.5 border-r border-[#e5e7eb] flex flex-col gap-1 transition-colors"
        style={{ cursor: onClick ? "pointer" : "default" }}
        onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb" }}
        onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.background = "" }}
      >
        <div className="flex items-center gap-1">
          <span className="ds-label">{m.k}</span>
          {onClick && <span className="text-[9px] text-[#9ca3af]">↗</span>}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-semibold leading-none" style={{ fontSize: 24, color: m.red ? "#dc2626" : undefined }}>{m.v}</span>
          <span className="text-[11px] text-[#9ca3af]">{m.sub}</span>
        </div>
      </div>
    )
  }

  // ── Accordion helper ──────────────────────────────────────────────────────
  function AccordionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
    return (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-[#f9fafb] transition-colors"
        style={{ borderTop: "1px solid #e5e7eb" }}
      >
        <span className="ds-label font-bold">{label}</span>
        <span style={{ fontSize: 9, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>
    )
  }

  return (
    <div className="relative flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">

      {/* ── Config overlay ───────────────────────────────────────────────────── */}
      {configOpen && (
        <>
          <div className="absolute inset-0 z-10 bg-black/40" onClick={() => setConfigOpen(false)} />
          <div className="absolute top-0 right-0 bottom-0 w-96 z-20 bg-white overflow-auto p-4" style={{ borderLeft: "1px solid #e5e7eb" }}>
            <div className="flex justify-between items-baseline">
              <div className="font-semibold text-base">Configure this plan</div>
              <button onClick={() => setConfigOpen(false)} className="text-xs text-[#9ca3af] hover:text-neutral-800">Close ✕</button>
            </div>
            <p className="text-[11px] text-[#9ca3af] mt-2 leading-relaxed">Weight changes take effect on the next generation, never against a published plan.</p>
            <div className="mt-4 ds-label font-bold">Objective weights</div>
            {([
              { k: "Relocation risk (α)",   desc: "How much the engine penalises unnecessary moves that put a container further from its exit." },
              { k: "Detention urgency (β)",  desc: "How hard the engine chases containers approaching their free-day deadline to avoid demurrage." },
              { k: "Container priority (γ)", desc: "How strongly customer or order-level priority scores push a container up the sequence." },
            ] as const).map(({ k, desc }, i) => (
              <div key={k} className="py-3 border-b border-[#f3f4f6]">
                <div className="flex justify-between text-[11.5px]">
                  <span className="font-semibold text-neutral-800">{k}</span>
                  <span className="font-bold font-mono text-neutral-700">{(wRaw[i]/100).toFixed(2)}</span>
                </div>
                <p className="text-[10.5px] text-[#9ca3af] mt-0.5 leading-snug">{desc}</p>
                <input type="range" min={0} max={50} value={wRaw[i]}
                  onChange={e => { const w=[...wRaw]; w[i]=+e.target.value; setWRaw(w) }}
                  className="w-full mt-2 accent-[#dc2626]" />
              </div>
            ))}
            <div className="mt-4 ds-label font-bold">Stability</div>
            {[["Freeze window","20 min"],["In-progress immutable","true"],["Minimum improvement","8 machine-min"],["Reassign cap","2 / operator / hour"]].map(([k,v]) => (
              <div key={k} className="flex justify-between py-2 border-b border-[#f3f4f6] text-[11.5px]">
                <span className="text-[#374151]">{k}</span><span className="font-semibold font-mono">{v}</span>
              </div>
            ))}
            <Button className="w-full mt-4 text-xs" style={{ borderRadius:5, background:"#111827", color:"#fff" }} onClick={() => setConfigOpen(false)}>
              Apply on next regenerate
            </Button>
          </div>
        </>
      )}

      {/* ── Step 2: Assumptions & weights drawer ─────────────────────────────── */}
      {drawerOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-black/30" onClick={() => setDrawerOpen(false)} />
          <div
            className="absolute top-0 left-0 bottom-0 z-30 bg-white flex flex-col overflow-auto"
            style={{ width: 300, borderRight: "1px solid #e5e7eb", boxShadow: "4px 0 16px rgba(0,0,0,0.12)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e7eb]">
              <span className="font-semibold text-[13px]">Assumptions & weights</span>
              <button onClick={() => setDrawerOpen(false)} className="text-[#9ca3af] hover:text-neutral-800 text-[12px]">✕</button>
            </div>
            {([
              {
                label: "Physical & Spatial Constraints",
                desc:  "Rules that check whether a container physically fits in the slot.",
                items: [
                  { name: "Size eligibility",    detail: "Container.size_type vs Slot.size_eligibility (20ft / 40ft)",                                              mandatory: true },
                  { name: "Reefer match",         detail: "Container.reefer_unit_flag vs Slot.reefer_capable + tier power_available",                                mandatory: true },
                  { name: "Slot status",          detail: "Slot.slot_status must allow placement",                                                                   mandatory: true },
                  { name: "Tier status",          detail: "Tier.tier_status must be Available (not Occupied / Blocked)",                                             mandatory: true },
                  { name: "Weight limits",        detail: "Container gross weight vs Tier.weight_limit and Slot.max_gross_weight_capacity",                          mandatory: true },
                  { name: "Max stack height",     detail: "Current stack height vs Block default or Slot.max_tier_height override",                                  mandatory: true },
                ],
              },
              {
                label: "Safety & Compliance",
                desc:  "Rules that enforce hazmat regulations and legal clearances.",
                items: [
                  { name: "Hazmat allowed",             detail: "Container.hazmat_class vs Slot.hazmat_class_allowed" },
                  { name: "Spatial hazmat segregation", detail: "HazmatClass.segregation_group (A/B/C) — incompatible groups cannot be placed in conflicting slots" },
                  { name: "Active holds",               detail: "Hold.released_at IS NULL — any uncleared customs/legal hold blocks placement" },
                ],
              },
              {
                label: "Operational Readiness",
                desc:  "Rules that confirm equipment and personnel are ready for the move.",
                items: [
                  { name: "Certification",         detail: "JockeyEquipmentCertification — jockey must be certified for the equipment type" },
                  { name: "Chassis prerequisites", detail: "Required chassis availability for the move" },
                ],
              },
            ]).map(group => (
              <div key={group.label} className="px-4 pb-3">
                {/* Section header with hovering description tooltip */}
                <div className="relative group/sec flex items-center gap-1 cursor-default mb-2"
                  style={{ borderBottom:"1px solid #f3f4f6", paddingBottom:4 }}>
                  <span className="text-[9.5px] font-bold tracking-widest text-[#9ca3af] uppercase">{group.label}</span>
                  <span className="text-[9px] text-[#c4c9d4] select-none">ⓘ</span>
                  <div className="absolute left-0 top-full mt-1.5 z-50 hidden group-hover/sec:block w-60
                    bg-[#111827] text-white text-[10px] leading-snug rounded px-3 py-2 shadow-lg pointer-events-none">
                    {group.desc}
                  </div>
                </div>
                {/* Items — toggle + tooltip */}
                <div className="flex flex-col gap-0">
                  {group.items.map(item => {
                    const mandatory = "mandatory" in item && item.mandatory
                    const cs = constraints[item.name] ?? { enabled: true, weight: 50 }
                    const isOn = mandatory ? true : cs.enabled
                    return (
                      <div key={item.name}
                        className="relative group/rule flex items-center gap-2 py-1.5"
                        style={{ borderBottom: "1px solid #f9fafb", opacity: isOn ? 1 : 0.45 }}>

                        {/* Toggle pill */}
                        <button
                          onClick={() => { if (!mandatory) toggleConstraint(item.name) }}
                          className="flex-none relative transition-colors"
                          style={{
                            width: 28, height: 16, borderRadius: 8,
                            background: isOn ? "#111827" : "#d1d5db",
                            cursor: mandatory ? "not-allowed" : "pointer",
                          }}>
                          <span
                            className="absolute top-[2px] transition-all"
                            style={{
                              left: isOn ? 14 : 2, width: 12, height: 12,
                              background: "#fff", borderRadius: "50%",
                            }} />
                        </button>

                        {/* Name */}
                        <span className="text-[11.5px] font-semibold text-neutral-800 leading-tight flex-1 min-w-0 truncate">
                          {item.name}
                        </span>

                        {/* Mandatory badge or info icon */}
                        {mandatory ? (
                          <span className="flex-none text-[8.5px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded"
                            style={{ background: "#f3f4f6", color: "#6b7280", letterSpacing: "0.05em" }}>
                            Mandatory
                          </span>
                        ) : (
                          <div className="relative flex-none">
                            <span className="text-[10px] text-[#c4c9d4] select-none cursor-default group-hover/rule:text-[#9ca3af]">ⓘ</span>
                            <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover/rule:block w-64
                              bg-[#111827] text-white text-[10px] leading-snug rounded px-3 py-2 shadow-lg pointer-events-none">
                              {item.detail}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="h-px bg-[#e5e7eb] my-1 mx-4" />
            <div className="px-4 pt-3 pb-2 ds-label font-bold">Stability</div>
            {[["Freeze window","20 min"],["In-progress immutable","true"],["Min improvement","8 machine-min"],["Reassign cap","2 / op / h"]].map(([k,v]) => (
              <div key={k} className="flex justify-between px-4 pb-2 text-[11.5px]">
                <span className="text-[#374151]">{k}</span><span className="font-semibold font-mono">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base tracking-tight">Planner</span>
            {planSource === "seed" && (
              <Badge variant={published ? "brand" : "muted"}>{published ? "PUBLISHED" : "DRAFT"}</Badge>
            )}
            {planSource === "engine" && viewedPlan && (
              <Badge variant={PLAN_STATUS_VARIANT[viewedPlan.status] ?? "muted"}>
                {viewedPlan.status.replace("_"," ").toUpperCase()}
              </Badge>
            )}
          </div>
          <div className="flex gap-3 text-[11px] text-[#9ca3af]">
            {planSource === "seed"
              ? <><span className="font-mono">P-2026-08-11</span><span>Generated <span className="font-mono">22:14</span></span><span>Engine <span className="font-mono">41.8 s</span></span><span>Snapshot <span className="font-mono">#a41f9c</span></span><span>Horizon <span className="font-mono">06:00–14:00</span></span></>
              : viewedPlan
              ? <><span>Plan <span className="font-mono">#{viewedPlan.id}</span></span><span className="font-mono">{viewedPlan.plan_date}</span>{viewedPlan.solve_seconds != null && <span>Solved in <span className="font-mono">{viewedPlan.solve_seconds.toFixed(1)} s</span></span>}{viewedPlan.solver_status && <span>Solver: {viewedPlan.solver_status}</span>}<span><span className="font-mono">{viewedPlan.moves.length}</span> moves</span></>
              : <span>No plan generated</span>
            }
          </div>
        </div>

        {/* Plan source toggle */}
        <div className="flex items-center gap-2 ml-2">
          <span className="ds-label whitespace-nowrap">Source</span>
          <div style={{ border:"1px solid #e5e7eb", borderRadius:5, overflow:"hidden", display:"flex" }}>
            {(["seed","engine"] as PlanSource[]).map(src => (
              <button key={src} disabled={src==="engine" && !backendConnected}
                onClick={() => setPlanSource(src)}
                className="text-[10.5px] px-3 py-1 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: planSource===src ? "#111827":"transparent", color: planSource===src ? "#fff":"#374151" }}
              >
                {src === "seed" ? "Seed data" : backendConnected ? "Planning engine" : "Engine offline"}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Assumptions & weights button */}
        {planSource === "seed" && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-xs px-3 py-1.5 text-[#374151] bg-white"
            style={{ border: "1px solid #e5e7eb", borderRadius: 5, whiteSpace: "nowrap" }}
          >
            Assumptions &amp; weights
          </button>
        )}

        {/* Action buttons */}
        <div className="ml-auto flex gap-2">
          {planSource === "seed" ? (
            <>
              <button className="text-xs px-3 py-1 text-[#374151] bg-white" style={{ border:"1px solid #e5e7eb", borderRadius:5 }} onClick={() => setConfigOpen(true)}>Configure</button>
              <button className="text-xs px-3 py-1 text-[#374151] bg-white" style={{ border:"1px solid #e5e7eb", borderRadius:5 }} onClick={() => setPublished(false)}>Regenerate</button>
              <button className="text-xs px-3 py-1 text-white disabled:opacity-50" style={{ background:"#111827", borderRadius:5, border:"1px solid #111827" }} onClick={handlePublish} disabled={publishing}>
                {publishing ? "Publishing…" : published ? "Published · view diff" : "Approve & publish"}
              </button>
            </>
          ) : (
            <>
              {plans.length > 0 && (
                <select disabled={historyLoading} onChange={e => handleHistorySelect(Number(e.target.value))} value={viewedPlan?.id ?? ""}
                  className="text-[11px] px-2 py-1 bg-white text-[#374151] disabled:opacity-50 font-mono" style={{ border:"1px solid #e5e7eb", borderRadius:5 }}>
                  <option value="" disabled>Plan history ({plans.length})</option>
                  {plans.map(p => <option key={p.id} value={p.id}>#{p.id} · {p.plan_date} · {p.status}</option>)}
                </select>
              )}
              <button className="text-xs px-3 py-1 text-[#374151] bg-white disabled:opacity-50" style={{ border:"1px solid #e5e7eb", borderRadius:5 }} onClick={handleGenerate} disabled={generating}>
                {generating ? "⟳ Solver running…" : "Generate plan"}
              </button>
              {viewedPlan?.status === "draft" && (
                <button className="text-xs px-3 py-1 text-white disabled:opacity-50" style={{ background:"#111827", borderRadius:5, border:"1px solid #111827" }} onClick={handleConfirm} disabled={confirming}>
                  {confirming ? "Confirming…" : "Confirm plan"}
                </button>
              )}
            </>
          )}
        </div>
      </div>



      {/* ── Engine: no plan / spinner ─────────────────────────────────────────── */}
      {planSource === "engine" && !viewedPlan && !generating && (
        <div className="flex-1 flex items-center justify-center bg-[#f4f5f7]">
          <div className="bg-white px-8 py-8 max-w-sm text-center" style={{ border:"1px solid #e5e7eb", borderRadius:5 }}>
            <div className="font-semibold text-base mb-2">No plan generated yet</div>
            <div className="text-[12.5px] text-[#374151] leading-relaxed mb-5">The planning engine has no plan on record. Generate one to see the solver's move sequence.</div>
            <button className="text-xs px-4 py-2 text-white" style={{ background:"#111827", borderRadius:5 }} onClick={handleGenerate}>Generate plan (CP-SAT)</button>
          </div>
        </div>
      )}
      {planSource === "engine" && generating && (
        <div className="flex-1 flex items-center justify-center bg-[#f4f5f7]">
          <div className="text-center">
            <div className="text-[28px] mb-3 animate-spin select-none">⟳</div>
            <div className="font-semibold text-base">Solver running…</div>
            <div className="text-[12px] text-[#9ca3af] mt-1">CP-SAT optimising the move sequence</div>
          </div>
        </div>
      )}

      {/* ── Step 1: Collapsible KPI bar ──────────────────────────────────────── */}
      {(planSource === "seed" || (planSource === "engine" && viewedPlan && !generating)) && (
        <div className="flex-none border-b border-[#e5e7eb] bg-white">
          {/* Primary row: always visible */}
          <div className="flex items-stretch">
            {(planSource === "seed" ? primaryKpis : engineKpis.slice(0,2)).map(m => (
              <KpiCell key={m.k} m={m}
                onClick={
                  m.k === "Inbound containers"  ? () => onNavigate?.("gate", "inbound")  :
                  m.k === "Outbound containers" ? () => onNavigate?.("gate", "outbound") :
                  undefined
                }
              />
            ))}
            <button
              onClick={() => setKpiExpanded(v => !v)}
              className="flex items-center gap-1.5 px-4 text-[11px] text-[#6b7280] hover:text-[#374151] hover:bg-[#f9fafb] transition-colors"
              style={{ whiteSpace: "nowrap" }}
            >
              {kpiExpanded ? "Fewer metrics ▲" : "More metrics ▼"}
            </button>
          </div>
          {/* Secondary row: expandable with height transition */}
          <div style={{ overflow:"hidden", maxHeight: kpiExpanded ? 120 : 0, transition:"max-height 200ms ease" }}>
            <div className="flex border-t border-[#e5e7eb]">
              {(planSource === "seed" ? secondaryKpis : engineKpis.slice(2)).map(m => <KpiCell key={m.k} m={m} />)}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SEED MODE — Step 2: 2-column layout (no left col)
          ════════════════════════════════════════════════════════════════════ */}
      {planSource === "seed" && (
        <div className="grid flex-1 min-h-0 overflow-hidden" style={{ gridTemplateColumns: "minmax(360px,1fr) clamp(280px,28vw,380px)" }}>

          {/* ── Center: moves table ─────────────────────────────────────────── */}
          <div className="flex flex-col min-h-0 bg-white">
            {/* Table toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[#e5e7eb] flex-none">
              <Input placeholder="Filter container, slot, operator…" value={q} onChange={e => setQ(e.target.value)} className="w-48 h-7 text-xs" />
              {/* Operation filter */}
              <div style={{ border:"1px solid #e5e7eb", borderRadius:5, overflow:"hidden", display:"flex" }}>
                {OP_FILTER_TYPES.map(t => (
                  <button key={t} onClick={() => setFilter(t)} className="text-[10.5px] px-2 py-1 font-semibold transition-colors"
                    style={{ background: filter===t ? "#111827":"transparent", color: filter===t ? "#fff":"#374151" }}>
                    {t === "ALL" ? "All" : getDisplayOperation(t)}
                  </button>
                ))}
              </div>
              {/* Step 3: Column chooser */}
              <div ref={colChooserRef} className="relative">
                <button
                  onClick={() => setColChooserOpen(v => !v)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#374151]"
                  style={{ border:"1px solid #e5e7eb", borderRadius:5 }}
                >
                  Columns <span style={{ fontSize:8 }}>{colChooserOpen ? "▲" : "▼"}</span>
                </button>
                {colChooserOpen && (
                  <div className="absolute left-0 top-full mt-1 z-30 bg-white" style={{ border:"1px solid #e5e7eb", borderRadius:5, boxShadow:"0 4px 12px rgba(0,0,0,0.10)", padding:"6px 0", minWidth:140 }}>
                    {ALL_COLS.map(col => (
                      <label key={col} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#f9fafb] text-[11px]">
                        <input type="checkbox" checked={visibleCols.has(col)} onChange={() => toggleCol(col)} className="accent-[#111827]" />
                        {col}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <span className="ml-auto text-[11px] text-[#9ca3af]">
                <span className="font-mono">{planningRows.length}</span> of <span className="font-mono">{allSteps.length}</span> · <span className="font-mono">{frozenCount}</span> blocked
              </span>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full border-collapse" style={{ fontSize:11 }}>
                <thead>
                  <tr>
                    {ALL_COLS.filter(h => visibleCols.has(h)).map((h,i) => (
                      <th key={h} className="ds-th text-left sticky top-0 z-10"
                        style={{ paddingLeft: i===0 ? 16 : undefined, textAlign: h==="EST" ? "right" : undefined }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {planningRows.length === 0 ? (
                    <tr><td colSpan={visibleCols.size} className="px-4 py-4 text-[11px] text-[#9ca3af]">No steps match {q ? `"${q}"` : "this filter"}.</td></tr>
                  ) : planningRows.map((s, i) => (
                    <MoveRow key={`pr-${i}`} m={{ source:"planning", move:s }} isSelected={stepId(s)===sel} onClick={() => { setSel(stepId(s)); setTab("detail") }} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Right: detail panel with accordions (Step 4) ───────────────── */}
          <div className="bg-white flex flex-col min-h-0" style={{ borderLeft:"1px solid #e5e7eb" }}>
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="flex-none">
                <TabsTrigger value="detail">Move</TabsTrigger>
                <TabsTrigger value="exceptions">Exceptions {exceptions.length}</TabsTrigger>
                <TabsTrigger value="projection">Projected KPI</TabsTrigger>
              </TabsList>

              <TabsContent value="detail" className="flex-1 overflow-auto">
                {selStep ? (
                  <div>
                    {/* Step header */}
                    <div className="px-4 pt-3 pb-3">
                      <div className="ds-label flex items-center gap-2">
                        <span className={`font-mono${isAnonymousContainer(selStep) ? " italic text-[#9ca3af]" : ""}`}>
                           {getDisplayContainerId(selStep)}
                         </span>
                        {selStep.planned_step != null && <span className="text-[#9ca3af]">· step <span className="font-mono">{selStep.planned_step}</span></span>}
                        {/* Equipment badge */}
                        {(() => {
                          const b = getEquipmentType(selStep)
                          return (
                            <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-sm leading-none"
                              style={{ background: b.bg, color: b.text }}>
                              {b.icon} {b.label}
                            </span>
                          )
                        })()}
                      </div>
                      <div className="font-semibold text-base mt-1 tracking-tight">{getDisplayOperation(selStep.operation)}</div>
                      <div className="text-[12px] mt-1 font-mono text-[#374151]">{fmtLoc(selStep.origin)}</div>
                      <div className="text-[12px] font-mono text-[#9ca3af]">→ {fmtLoc(selStep.destination)}</div>
                    </div>

                    {/* Extra-movement indicator */}
                    {isExtraMovement(selStep.operation) && (
                      <div className="mx-4 mb-2">
                        <span className="text-[9.5px] font-bold tracking-widest px-2 py-1 rounded uppercase inline-block"
                          style={{ background:"#fef3c7", color:"#b45309" }}>
                          ↔ Extra movement — non-productive
                        </span>
                      </div>
                    )}

                    {/* WHY THIS STEP callout */}
                    {selStep.step_status === "Blocked" ? (
                      <div className="mx-4 mb-3 px-4 py-3"
                        style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:6 }}>
                        <div className="text-[9.5px] font-bold tracking-widest text-[#b91c1c] mb-1.5 uppercase">
                          Step blocked
                        </div>
                        <div className="text-[12.5px] font-semibold text-[#b91c1c] leading-snug">
                          ⚠ Activity status: {selStep.activity_status ?? "Unknown"}
                        </div>
                      </div>
                    ) : (
                      <div className="ds-callout mx-4 mb-3">
                        <div className="ds-callout-label">Why this step</div>
                        <div className="text-[12.5px] leading-relaxed">
                          {generateWhyText(selStep)}
                        </div>
                      </div>
                    )}

                    {/* Key-value detail rows */}
                    {[
                      ["Operator",    selStep.operator ?? "—"],
                      ["Move method", getDisplayMoveMethod(selStep)],
                      ["Window",      selStep.estimated_start
                        ? fmtIso(selStep.estimated_start) + "–" + fmtIso(selStep.estimated_end) + " (" + stepDur(selStep).toFixed(1) + "′)"
                        : selStep.step_status === "Completed" ? "Completed · no window recorded"
                        : selStep.step_status === "Blocked"   ? "Blocked · not scheduled"
                        : "Not yet scheduled"],
                      ["Score",       selStep.planning_score != null
                        ? selStep.planning_score.toFixed(2)
                        : selStep.move_method === "Inspection" ? "N/A · inspection step"
                        : selStep.step_status === "Completed"  ? "N/A · completed"
                        : "—"],
                    ].map(([k,v]) => (
                      <div key={k} className="flex justify-between gap-3 px-4 py-2 border-b border-[#f3f4f6] text-[11.5px]">
                        <span className="text-[#9ca3af]">{k}</span>
                        <span className="font-semibold font-mono text-right">{v}</span>
                      </div>
                    ))}
                    {/* Status rows — color-coded chips */}
                    {[
                      ["Step status", selStep.step_status],
                      ["Activity",   selStep.activity_status ?? "—"],
                    ].map(([k, v]) => {
                      const st = getStatusStyle(v)
                      return (
                        <div key={k} className="flex justify-between items-center gap-3 px-4 py-2 border-b border-[#f3f4f6] text-[11.5px]">
                          <span className="text-[#9ca3af]">{k}</span>
                          <span className="text-[9.5px] font-bold px-2 py-0.5 rounded"
                            style={{ background: st.bg, color: st.text }}>
                            {v}
                          </span>
                        </div>
                      )
                    })}

                    {/* Hard constraints accordion */}
                    <AccordionHeader label="Hard constraints" open={constraintsOpen} onToggle={() => setConstraintsOpen(v => !v)} />
                    <div style={{ overflow:"hidden", maxHeight: constraintsOpen ? 300 : 0, transition:"max-height 200ms ease" }}>
                      {[
                        ["C2","Stack height within zone max and reach envelope","PASS"],
                        ["C3","Row depth within machine reach","PASS"],
                        ["C4","Gross weight against capacity chart","PASS"],
                        ["C9","Operator certified for cargo class","PASS"],
                        ["C12","Destination zone below utilisation ceiling","PASS"],
                      ].map(([id,label,verdict]) => (
                        <div key={id} className="flex gap-2 items-baseline px-4 py-1.5 text-[11.5px]">
                          <span className="w-6 font-bold font-mono text-[#9ca3af]">{id}</span>
                          <span className="flex-1 text-[#374151] leading-tight">{label}</span>
                          <span className="text-[10px] font-bold tracking-wider text-[#9ca3af]">{verdict}</span>
                        </div>
                      ))}
                    </div>

                    {/* Step history accordion */}
                    <AccordionHeader label="Step history" open={moveHistoryOpen} onToggle={() => setMoveHistoryOpen(v => !v)} />
                    <div style={{ overflow:"hidden", maxHeight: moveHistoryOpen ? 200 : 0, transition:"max-height 200ms ease" }}>
                      {[
                        ...(selStep.estimated_start ? [[fmtIso(selStep.estimated_start), "Planned by engine", "auto"]] : []),
                        ...(selStep.actual_start ? [[fmtIso(selStep.actual_start), "Actual start recorded", "system"]] : []),
                        ...(selStep.actual_end   ? [[fmtIso(selStep.actual_end),   "Actual end recorded",   "system"]] : []),
                        ...(selStep.estimated_start == null ? [["—", "No window recorded for this step", "engine"]] : []),
                      ].map(([time,event,src]) => (
                        <div key={time+event} className="flex items-baseline gap-3 px-4 py-1.5 text-[11.5px] border-b border-[#f9fafb]">
                          <span className="font-mono text-[#9ca3af] w-10">{time}</span>
                          <span className="flex-1 text-[#374151]">{event}</span>
                          <span className="text-[10px] text-[#9ca3af]">{src}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-4 text-[12.5px] leading-relaxed text-[#374151]">
                    {focus || q || "This container"} has no step in plan P-2026-08-11 — {allSteps.length} steps planned today.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="exceptions">
                <div>
                  {exceptions.map(e => (
                    <div key={e.id} className="px-4 py-3 border-b border-[#f3f4f6]">
                      <div className="flex justify-between items-baseline">
                        <span className={`text-[10px] font-bold tracking-wider ${e.severity==="high"?"text-[#dc2626]":"text-[#9ca3af]"}`}>{e.type}</span>
                        <span className="text-[10px] font-mono text-[#9ca3af]">{e.id}</span>
                      </div>
                      <div className="text-[13px] font-bold mt-1">{e.subject}</div>
                      <div className="text-[12px] leading-relaxed text-[#374151] mt-1">{e.detail}</div>
                      <button className="mt-2 text-[11.5px] px-3 py-1 text-[#374151] bg-white" style={{ border:"1px solid #e5e7eb", borderRadius:5 }}>{e.action}</button>
                    </div>
                  ))}
                  <div className="px-4 py-3 text-[11.5px] text-[#374151] leading-relaxed">Infeasible assignments escalate after three resequencing iterations.</div>
                </div>
              </TabsContent>

              <TabsContent value="projection">
                <div>
                  {projection.map(p => (
                    <div key={p.k} className="px-4 py-3 border-b border-[#f3f4f6]">
                      <div className="flex justify-between text-[11.5px]">
                        <span className="font-bold">{p.k}</span>
                        <span className="text-[#9ca3af]">target <span className="font-mono">{p.target}</span></span>
                      </div>
                      <div className="flex items-baseline gap-3 mt-1 text-[11px] text-[#9ca3af]">
                        <span className="font-mono">{p.opt}</span>
                        <span className="font-mono font-semibold leading-none text-neutral-900" style={{ fontSize:24 }}>{p.exp}</span>
                        <span className="font-mono">{p.pes}</span>
                      </div>
                      <div className="relative h-1 bg-[#f3f4f6] mt-2">
                        <div className="absolute top-0 h-1" style={{ left:p.bandLeft+"%", width:p.bandWidth+"%", background:"#fca5a5" }} />
                        <div className="absolute top-[-3px] h-2 w-px bg-neutral-900" style={{ left:p.mark+"%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          ENGINE MODE — two-column (unchanged)
          ════════════════════════════════════════════════════════════════════ */}
      {planSource === "engine" && viewedPlan && !generating && (
        <div className="grid flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns: "minmax(400px,1fr) clamp(280px,28vw,380px)" }}>
          <div className="flex flex-col min-h-0 bg-white">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e5e7eb] flex-none">
              <span className="text-[11px] text-[#9ca3af]"><span className="font-mono">{engineMoves.length}</span> moves · Plan <span className="font-mono">#{viewedPlan.id}</span></span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full border-collapse" style={{ fontSize:11 }}>
                <thead>
                  <tr>
                    {ALL_COLS.filter(h => visibleCols.has(h)).map((h,i) => (
                      <th key={h} className="ds-th text-left sticky top-0 z-10"
                        style={{ paddingLeft: i===0 ? 16 : undefined, textAlign: h==="EST" ? "right" : undefined }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {engineMoves.length === 0 ? (
                    <tr><td colSpan={visibleCols.size} className="px-4 py-4 text-[11px] text-[#9ca3af]">No moves in this plan.</td></tr>
                  ) : engineMoves.map(m => (
                    <MoveRow key={m.id} m={{ source:"engine", move:m }} isSelected={m.id===engineSel} onClick={() => setEngineSel(m.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white flex flex-col min-h-0 overflow-auto" style={{ borderLeft:"1px solid #e5e7eb", width:300 }}>
            {engineSelMove ? (
              <div>
                <div className="px-4 pt-3 pb-3">
                  <div className="ds-label">Move <span className="font-mono">#{engineSelMove.id}</span> · seq <span className="font-mono">{engineSelMove.seq}</span></div>
                  <div className="font-semibold text-base mt-1 tracking-tight">{REASON_LABELS[engineSelMove.reason] ?? engineSelMove.typeLabel ?? "Move"}</div>
                  <div className="text-[12px] mt-1 font-mono text-[#374151]">{engineSelMove.containerId}</div>
                  <div className="text-[12px] font-mono text-[#9ca3af]">{engineSelMove.from} → {engineSelMove.to}</div>
                </div>
                {engineSelMove.reason && (
                  <div className="ds-callout mx-4 mb-3">
                    <div className="ds-callout-label">Why this move</div>
                    <div className="text-[12.5px] leading-relaxed">{REASON_LABELS[engineSelMove.reason] ?? engineSelMove.reason}</div>
                  </div>
                )}
                {[
                  ["Jockey / operator", engineSelMove.operatorName],
                  ["Est. duration", engineSelMove.estMin.toFixed(1)+"′"],
                  ["State", engineSelMove.stateLabel ?? "—"],
                  ["Frozen", engineSelMove.frozen ? "yes" : "no"],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between gap-3 px-4 py-2 border-b border-[#f3f4f6] text-[11.5px]">
                    <span className="text-[#9ca3af]">{k}</span>
                    <span className="font-semibold font-mono text-right">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-4 text-[12px] text-[#9ca3af] leading-relaxed">Select a move from the table to see its details.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 5: Operator schedule — collapsed summary ─────────────────────── */}
      {planSource === "seed" && (
        <div className="flex-none border-t border-[#e5e7eb] bg-white">
          {/* Summary bar — always visible */}
          <div className="flex items-center gap-3 px-4 py-2">
            <span className="ds-label font-bold">Operator schedule</span>
            <span className="text-[11px] text-[#374151]">
              <span className="font-semibold">{onShift.length}</span> operators on shift
              <span className="text-[#9ca3af] mx-1.5">·</span>
              <span className="font-semibold">{frozenCount}</span> moves frozen
              <span className="text-[#9ca3af] mx-1.5">·</span>
              next break <span className="font-mono font-semibold">09:30</span>
            </span>
            <button
              onClick={() => setGanttExpanded(v => !v)}
              className="ml-auto text-[11px] px-2.5 py-1 text-[#374151]"
              style={{ border:"1px solid #e5e7eb", borderRadius:5 }}
            >
              {ganttExpanded ? "Collapse ▲" : "Show Gantt ▼"}
            </button>
          </div>

          {/* Full Gantt — expanded via max-height transition */}
          <div style={{ overflow:"hidden", maxHeight: ganttExpanded ? 200 : 0, transition:"max-height 220ms ease" }}>
            <div className="border-t border-[#e5e7eb]">
              <div className="px-4 py-1 text-[11px] text-[#9ca3af]">
                {published ? "Frozen window 20 min · in-progress moves immutable" : "Preview — freeze applies at publication"}
              </div>
              <div className="grid" style={{ gridTemplateColumns:"132px 1fr" }}>
                <div />
                <div className="flex border-b border-[#e5e7eb]">
                  {HOURS.map(h => (
                    <div key={h} className="flex-1 font-mono text-[9px] text-[#9ca3af] border-l border-[#e5e7eb] px-1 py-1">{h}</div>
                  ))}
                </div>
                {operatorNames().map(opName => {
                  const opSteps = stepsForOperator(opName)
                  return (
                    <div key={opName} className="contents">
                      <div className="px-4 py-1 text-[11.5px] border-b border-[#e5e7eb] flex justify-between gap-2">
                        <span className="font-semibold">{opName}</span>
                        <span className="text-[#9ca3af]">{opSteps.length} steps</span>
                      </div>
                      <div className="relative h-8 border-b border-[#e5e7eb] border-l border-[#e5e7eb]">
                        {opSteps.map((s, gi) => {
                          const startMin = isoToMin(s.estimated_start)
                          const endMin   = isoToMin(s.estimated_end)
                          if (startMin == null || endMin == null) return null
                          const sid = stepId(s)
                          return (
                            <div key={`g-${gi}`}
                              onClick={() => { setSel(sid); setTab("detail") }}
                              title={`${getDisplayContainerId(s)} · ${getDisplayOperation(s.operation)} · ${fmtIso(s.estimated_start)}–${fmtIso(s.estimated_end)}`}
                              className="absolute top-2 h-3 cursor-pointer hover:opacity-80"
                              style={{
                                left: (Math.max(0, startMin - 360) / 480 * 100).toFixed(2) + "%",
                                width: Math.max(0.5, (endMin - startMin) / 480 * 100).toFixed(2) + "%",
                                background: sid === sel ? "#dc2626" : s.step_status === "Blocked" ? "#9ca3af" : "#111827",
                              }}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
