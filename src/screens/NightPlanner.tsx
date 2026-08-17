import { useState, useEffect, useRef } from "react"
import Skeleton from "@/components/ui/Skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import TabBar from "@/components/ui/TabBar"
import { TYPE_LABEL, CONTAINERS, getHotContainers, EQUIPMENT, OPERATORS, type Move } from "@/data/yard-data"
import { useData } from "@/lib/DataContext"
import { adaptMoveForDisplay, REASON_LABELS } from "@/lib/backend-adapters"
import { checkPlacementRules } from "@/lib/placement-rules"
import { backendApi } from "@/lib/backend-api"
import type { BackendPlanDetail } from "@/lib/backend-api"
import { allSteps, operatorNames, dashboardCounts, stepsForOperator, type PlanningStep } from "@/data/planningData"
import { INBOUND_SEED, OUTBOUND_SEED } from "@/data/gate-seed"
import { getDisplayOperation, getDisplayMoveMethod, getEquipmentType, isExtraMovement, getStatusStyle, getDisplayContainerId, isAnonymousContainer, generateWhyText } from "@/utils/displayLabels"
import { useLang } from "@/lib/i18n"

interface Props {
  focus: string | null
  onNavigate: (target: string, focus?: string) => void
}

const WEIGHTS = [
  { k: "Machine minutes",       v: "0.40", pct: 40 },
  { k: "Weighted lateness",     v: "0.25", pct: 25 },
  { k: "Extra moves (predicted)", v: "0.20", pct: 20 },
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
  if (loc.row == null && loc.tier == null) return String(loc.bay)
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
const ALL_COLS = ["SEQ","WINDOW","MOVE","ROUTE","ASSIGNED","EST"] as const
type Col = typeof ALL_COLS[number]
const DEFAULT_COLS = new Set<Col>(["SEQ","MOVE","ROUTE","ASSIGNED"])

// ── Move-type categorical palette (for Planner table badges) ─────────────────
const MOVE_TYPE_STYLE: Record<string, { bg: string; text: string; icon: string; short: string }> = {
  "Outbound staging and truck loading": { bg:"var(--teal-bg)",      text:"var(--teal-text)",   icon:"ti-forklift",      short:"Retrieval/Stage" },
  "Premarshal ahead of retrieval":      { bg:"var(--purple-bg)",    text:"var(--purple-text)", icon:"ti-crane",          short:"Pre-marshal"     },
  "Putaway":                            { bg:"var(--ds-accent-bg)", text:"var(--ds-accent)",   icon:"ti-package-import", short:"Putaway"         },
  "Digout to clear an overstow":        { bg:"var(--coral-bg)",     text:"var(--coral-text)",  icon:"ti-truck",          short:"Extra Move"      },
}

// ── Filter pill definitions (planner toolbar) ─────────────────────────────────
const FILTER_PILLS = [
  { key:"ALL",                                 label:"All",             dot: null        },
  { key:"Putaway",                             label:"Putaway",         dot: "#2563eb"   },
  { key:"Premarshal ahead of retrieval",       label:"Pre-marshal",     dot: "#7c3aed"   },
  { key:"Outbound staging and truck loading",  label:"Retrieval/Stage", dot: "#0d9488"   },
  { key:"Digout to clear an overstow",         label:"Extra Move",      dot: "#ea580c"   },
]

export default function NightPlanner({ focus, onNavigate }: Props) {
  const {
    moves, operators, assumptions, exceptions, refresh,
    backendConnected, activePlan, plans,
    backendContainers, backendSlots, backendJockeys,
    generatePlan, confirmPlan, dbLoading,
  } = useData()
  const { t } = useLang()

  // ── Existing state ────────────────────────────────────────────────────────
  const [sel,          setSel]          = useState<string>(() => { const s = allSteps[0]; return s ? stepId(s) : "" })
  const [tab,          setTab]          = useState("detail")
  const [q,            setQ]            = useState("")
  const [filter,       setFilter]       = useState("ALL")
  const [published,    setPublished]    = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  const [configOpen,   setConfigOpen]   = useState(false)
  const [wRaw,         setWRaw]         = useState([35, 40, 25])

  // ── Story plan expand state ──────────────────────────────────────────────────

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
  const [narrating,    setNarrating]    = useState(false)

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

  async function handleNarrate() {
    if (!viewedPlan || narrating) return
    setNarrating(true)
    try {
      const { narration } = await backendApi.narratePlan(viewedPlan.id)
      setViewedPlan(prev => prev ? { ...prev, narration } : prev)
    } catch (err) {
      console.error("[NightPlanner] re-narrate failed:", err)
    } finally {
      setNarrating(false)
    }
  }

  // ── Focus handling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!focus) return

    // ── Demo story hints ─────────────────────────────────────────────────────
    if (focus === "demo:reset") {
      setFilter("ALL")
      setSel(allSteps[0] ? stepId(allSteps[0]) : "")
      setQ("")
      setGanttExpanded(false)
      setPlanSource("seed")
      return
    }
    if (focus === "demo:premarshal") {
      setFilter("Premarshal ahead of retrieval")
      setSel("")
      setQ("")
      setGanttExpanded(false)
      return
    }
    if (focus === "demo:select") {
      // Pick the first non-blocked pre-marshal step as the representative move
      const step =
        allSteps.find(s => s.operation === "Premarshal ahead of retrieval" && s.step_status !== "Blocked") ??
        allSteps.find(s => s.operation === "Premarshal ahead of retrieval") ??
        allSteps[0]
      if (step) { setSel(stepId(step)); setTab("detail"); setFilter("ALL"); setQ(""); setGanttExpanded(false) }
      return
    }
    if (focus === "demo:gantt") {
      setGanttExpanded(true)
      setFilter("ALL")
      setQ("")
      return
    }

    // Numeric focus = plan ID from ControlTower "View plan" → switch to engine
    // mode and load the specific replan so the user sees what changed
    if (/^\d+$/.test(focus)) {
      setPlanSource("engine")
      setEngineSel(null)
      if (backendConnected) {
        setHistoryLoading(true)
        backendApi.plan(Number(focus))
          .then(detail => {
            setViewedPlan(detail)
            if (detail.moves.length > 0) setEngineSel(detail.moves[0].id)
          })
          .catch(err => console.error("[NightPlanner] focus-plan fetch failed:", err))
          .finally(() => setHistoryLoading(false))
      }
      return
    }

    // String focus = container / step search (existing behaviour)
    const s = allSteps.find(x => x.container_id === focus || stepId(x) === focus)
    if (s) { setSel(stepId(s)); setTab("detail"); setFilter("ALL"); setQ("") }
    else { setQ(focus); setFilter("ALL"); setSel(""); setTab("detail") }
  }, [focus, backendConnected])

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
      ? (m.move.estimated_start ? fmtIso(m.move.estimated_start)+"–"+fmtIso(m.move.estimated_end)
          : m.move.step_status === "Completed" ? "✓ done" : "not scheduled")
      : m.source === "seed" ? `${m.move.start}–${m.move.end}` : `seq ${m.move.sequence_number}`
    const containerId  = m.source === "planning" ? m.move.container_id : m.move.containerId
    const seqNum       = m.source === "planning" ? (m.move.planned_step ?? m.move.step_number ?? 0) : m.move.seq
    const fromStr      = m.source === "planning" ? fmtLoc(m.move.origin) : m.move.from
    const toStr        = m.source === "planning" ? fmtLoc(m.move.destination) : m.move.to
    const operatorName = m.source === "planning" ? (m.move.operator ?? "—") : m.move.operatorName
    const estMin       = m.source === "planning" ? stepDur(m.move) : m.move.estMin
    const isHot        = m.source !== "planning" && hotContainerIds.has(containerId ?? "")
    const isExtra      = m.source === "planning" && isExtraMovement(m.move.operation)
    const equipBadge   = m.source === "planning" ? getEquipmentType(m.move) : null
    const operation    = m.source === "planning" ? m.move.operation : null
    const typeStyle    = operation ? MOVE_TYPE_STYLE[operation] ?? null : null
    const stepStatus   = m.source === "planning" ? m.move.step_status : null
    const statusDot    = stepStatus === "Completed" ? "#059669" : stepStatus === "Blocked" ? "#dc2626" : "#4f46e5"

    // Non-planning source: keep legacy column-based layout for Engine mode
    if (m.source !== "planning") {
      const equipLabel = m.source === "seed" ? m.move.equipment : null
      return (
        <tr onClick={onClick} className="cursor-pointer hover:bg-[var(--ds-surface-hover)] transition-colors"
          style={{ background:isSelected?"#eef2ff":isHot?"#fff8f5":isCompleted?"#fafafa":undefined,
            borderBottom:"0.5px solid var(--ds-border-lt)", minHeight:44 }}>
          {visibleCols.has("SEQ")      && <td className="py-2.5 pl-4 pr-2.5 font-mono text-[var(--ds-subtle)]" style={{ fontSize:11, borderLeft:`3px solid ${isSelected?"var(--ds-accent)":frozen?"#dc2626":"transparent"}` }}>{String(seqNum).padStart(3,"0")}</td>}
          {visibleCols.has("WINDOW")   && <td className="px-3 py-2.5 font-mono whitespace-nowrap" style={{ fontSize:11 }}>{windowStr}</td>}
          {visibleCols.has("MOVE")     && <td className="px-3 py-2.5" style={{ fontSize:11 }}><div className="font-bold">{typeDisplay}</div><div className="text-[10px] font-mono text-[var(--ds-subtle)]">{isHot&&<span className="mr-1">🔥</span>}{containerId}</div></td>}
          {visibleCols.has("ROUTE")    && <td className="px-3 py-2.5 font-mono text-[var(--ds-fg-secondary)] whitespace-nowrap" style={{ fontSize:11 }}>{fromStr} → {toStr}</td>}
          {visibleCols.has("ASSIGNED") && <td className="px-3 py-2.5" style={{ fontSize:11 }}><div>{operatorName}</div><div className="text-[10px] text-[var(--ds-subtle)]">{equipLabel}</div></td>}
          {visibleCols.has("EST")      && <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ fontSize:11 }}>{estMin.toFixed(1)}′</td>}
        </tr>
      )
    }

    // Planning source: 5-column spec design
    return (
      <tr onClick={onClick} className="cursor-pointer transition-colors"
        style={{ background:isSelected?"#eef2ff":isHot?"#fff8f5":isCompleted?"rgba(0,0,0,0.015)":undefined,
          borderBottom:"0.5px solid var(--ds-border-lt)" }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background="var(--ds-surface-hover)" }}
        onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background=isSelected?"#eef2ff":isHot?"#fff8f5":isCompleted?"rgba(0,0,0,0.015)":"" }}>

        {/* SEQ — 44px centered, left accent border */}
        <td style={{ width:44, textAlign:"center", padding:"10px 6px",
          borderLeft:isSelected?"3px solid var(--ds-accent)":frozen?"3px solid #dc2626":"3px solid transparent" }}>
          <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--ds-subtle)", fontWeight:500 }}>
            {String(seqNum).padStart(3,"0")}
          </span>
        </td>

        {/* MOVE — tinted badge with icon + container ID below */}
        <td style={{ width:"18%", padding:"10px 12px" }}>
          {typeStyle ? (
            <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:4,
              background:typeStyle.bg, color:typeStyle.text, fontSize:11, fontWeight:600, whiteSpace:"nowrap", marginBottom:3 }}>
              <i className={`ti ${typeStyle.icon}`} style={{ fontSize:11 }} />
              {typeStyle.short}
            </span>
          ) : (
            <div style={{ fontSize:11, fontWeight:600, marginBottom:3 }}>{typeDisplay}</div>
          )}
          <div style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--ds-subtle)", display:"block",
            fontStyle:isAnonymousContainer(m.move)?"italic":undefined }}>
            {isHot&&<span style={{ marginRight:4 }}>🔥</span>}
            {getDisplayContainerId(m.move)}
          </div>
        </td>

        {/* ROUTE — from(secondary) → arrow(muted) → to(primary 500) */}
        <td style={{ padding:"10px 12px", fontFamily:"var(--font-mono)", fontSize:12, whiteSpace:"nowrap" }}>
          <span style={{ color:"var(--ds-fg-secondary)" }}>{fromStr}</span>
          <span style={{ color:"var(--ds-subtle)", margin:"0 6px" }}>→</span>
          <span style={{ color:"var(--text-primary)", fontWeight:500 }}>{toStr}</span>
          {isExtra && <div style={{ fontSize:11, color:"var(--ds-subtle)", marginTop:2 }}>(position adjust)</div>}
        </td>

        {/* ASSIGNED — operator name + equipment badge */}
        <td style={{ width:"20%", padding:"10px 12px" }}>
          <div style={{ fontSize:12, fontWeight:500, color:"var(--text-primary)", marginBottom:equipBadge?3:0 }}>{operatorName}</div>
          {equipBadge && (
            <span style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 6px", borderRadius:4,
              background:equipBadge.bg, color:equipBadge.text, fontSize:10, fontWeight:500 }}>
              {equipBadge.label}
            </span>
          )}
        </td>

        {/* STATUS — 7px dot + 12px label */}
        <td style={{ width:"10%", padding:"10px 12px", whiteSpace:"nowrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:statusDot, flexShrink:0, display:"inline-block" }} />
            <span style={{ fontSize:12, color:statusDot, fontWeight:500 }}>{stepStatus ?? stateDisplay}</span>
          </div>
        </td>
      </tr>
    )
  }

  // ── Step 1: KPI data arrays (planningData) ───────────────────────────────
  const { totalSteps, totalOperators } = dashboardCounts()
  const inbounds    = INBOUND_SEED.length
  const outbounds   = OUTBOUND_SEED.length
  const equipAvail  = EQUIPMENT.filter(e => e.status === "available").length
  const primaryKpis = [
    { k:t("planner.kpi.inbound"),  v:String(inbounds),           sub:"containers today",                                                                      red:false },
    { k:t("planner.kpi.outbound"), v:String(outbounds),          sub:"containers today",                                                                      red:false },
    { k:t("planner.kpi.operators"), v:String(totalOperators),     sub:`${totalOperators} of ${totalOperators} on shift`,                                       red:false },
    { k:t("planner.kpi.movesCreated"), v:String(totalSteps),         sub:"in shift plan",                                                                         red:false },
    { k:t("planner.kpi.detentionRisk"), v:"$8.4k",                    sub:"next 72 h",                                                                             red:true  },
  ]
  const rehandleSteps = allSteps.filter(s => isExtraMovement(s.operation)).length
  const rehandleRatio = allSteps.length > 0 ? Math.round(rehandleSteps / allSteps.length * 100) : 0
  const secondaryKpis = [
    { k:"Equipment on yard",     v:`${equipAvail} / ${EQUIPMENT.length}`, sub:equipAvail < EQUIPMENT.length ? `${EQUIPMENT.length - equipAvail} in maintenance` : "all available", red:equipAvail < EQUIPMENT.length },
    { k:"Unresolved exceptions", v:String(exceptions.length),             sub:"need attention",                                                           red:exceptions.length > 0 },
    { k:"Rehandle Ratio",        v:`${rehandleRatio}%`,                   sub:"reshuffle · digout of total",                                              red:rehandleRatio > 50  },
  ]
  const engineKpis = viewedPlan ? [
    { k:t("planner.moves"),     v:String(viewedPlan.moves.length),                                         sub:"in this plan",  red:false },
    { k:t("planner.strategy"),  v:viewedPlan.strategy,                                                     sub:"solver",        red:false },
    { k:t("planner.solveTime"),v:viewedPlan.solve_seconds != null ? viewedPlan.solve_seconds.toFixed(1)+"s":"—", sub:"wall clock",  red:false },
    { k:t("planner.objective"), v:viewedPlan.objective_value != null ? viewedPlan.objective_value.toFixed(2):"—", sub:"minimised",   red:false },
    { k:t("planner.gap"),       v:viewedPlan.gap_percent != null ? viewedPlan.gap_percent.toFixed(1)+"%":"—",     sub:"optimality",  red:false },
    { k:"Status",    v:viewedPlan.status.replace("_"," "),                                      sub:"plan state",    red:false },
  ] : []

  function KpiCell({ m, onClick }: { m: { k:string; v:string; sub:string; red:boolean }; onClick?: () => void }) {
    return (
      <div onClick={onClick}
        style={{ background:"#ffffff", border:`0.5px solid ${m.red?"#fca5a5":"var(--ds-border)"}`, borderRadius:10,
          padding:12, cursor:onClick?"pointer":"default", display:"flex", flexDirection:"column", gap:6,
          transition:"background 0.12s" }}
        onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.background="var(--ds-surface-hover)" }}
        onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.background="#ffffff" }}>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase",
          color:m.red?"#991b1b":"var(--ds-subtle)" }}>
          {m.k}{onClick&&<span style={{ marginLeft:4, fontSize:9, opacity:0.7 }}>↗</span>}
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
          <span style={{ fontFamily:"var(--font-mono)", fontSize:24, fontWeight:600, letterSpacing:"-0.5px", lineHeight:1,
            color:m.red?"var(--ds-red)":"var(--text-primary)" }}>{m.v}</span>
          <span style={{ fontSize:12, color:"var(--ds-subtle)" }}>{m.sub}</span>
        </div>
      </div>
    )
  }

  // ── Accordion helper ──────────────────────────────────────────────────────
  function AccordionHeader({ label, icon, open, onToggle }: { label: string; icon?: string; open: boolean; onToggle: () => void }) {
    return (
      <button onClick={onToggle}
        style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"10px 0", borderTop:"0.5px solid var(--ds-border-lt)", cursor:"pointer",
          background:"transparent", border:"none", borderTopWidth:"0.5px", borderTopStyle:"solid" as const, borderTopColor:"var(--ds-border-lt)" }}>
        <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:600,
          letterSpacing:"0.5px", textTransform:"uppercase" as const, color:"var(--ds-subtle)" }}>
          {icon && <i className={`ti ${icon}`} style={{ fontSize:13 }} />}
          {label}
        </span>
        <i className="ti ti-chevron-down" style={{ fontSize:13, color:"var(--ds-subtle)",
          transform:open?"rotate(180deg)":"rotate(0deg)", transition:"transform 200ms" }} />
      </button>
    )
  }

  return (
    <div className="relative flex flex-col h-full min-h-0 overflow-hidden"
      style={{ background:"var(--ds-background)", color:"var(--text-primary)", fontFamily:"var(--font-sans)" }}>

      {/* ── Config overlay ───────────────────────────────────────────────────── */}
      {configOpen && (
        <>
          <div className="absolute inset-0 z-10 bg-black/40" onClick={() => setConfigOpen(false)} />
          <div className="absolute top-0 right-0 bottom-0 w-96 z-20 bg-white overflow-auto p-4" style={{ borderLeft: "1px solid var(--ds-border)" }}>
            <div className="flex justify-between items-baseline">
              <div className="font-semibold text-base">Configure this plan</div>
              <button onClick={() => setConfigOpen(false)} className="text-xs text-[var(--ds-subtle)] hover:text-neutral-800">Close ✕</button>
            </div>
            <p className="text-[11px] text-[var(--ds-subtle)] mt-2 leading-relaxed">Weight changes take effect on the next generation, never against a published plan.</p>
            <div className="mt-4 ds-label font-bold">Objective weights</div>
            {([
              { k: "Relocation risk (α)",   desc: "How much the engine penalises unnecessary moves that put a container further from its exit." },
              { k: "Detention urgency (β)",  desc: "How hard the engine chases containers approaching their free-day deadline to avoid demurrage." },
              { k: "Container priority (γ)", desc: "How strongly customer or order-level priority scores push a container up the sequence." },
            ] as const).map(({ k, desc }, i) => (
              <div key={k} className="py-3 border-b border-[var(--ds-border-lt)]">
                <div className="flex justify-between text-[11.5px]">
                  <span className="font-semibold text-neutral-800">{k}</span>
                  <span className="font-bold font-mono text-neutral-700">{(wRaw[i]/100).toFixed(2)}</span>
                </div>
                <p className="text-[10.5px] text-[var(--ds-subtle)] mt-0.5 leading-snug">{desc}</p>
                <input type="range" min={0} max={50} value={wRaw[i]}
                  onChange={e => { const w=[...wRaw]; w[i]=+e.target.value; setWRaw(w) }}
                  className="w-full mt-2 accent-[var(--ds-red)]" />
              </div>
            ))}
            <div className="mt-4 ds-label font-bold">Targets</div>
            {[["Per job target turn around time","5 min"],["Per trailer target turn around time","15 min"],["Reassignment cap","1 min"]].map(([k,v]) => (
              <div key={k} className="flex justify-between py-2 border-b border-[var(--ds-border-lt)] text-[11.5px]">
                <span className="text-[var(--ds-fg-secondary)]">{k}</span><span className="font-semibold font-mono">{v}</span>
              </div>
            ))}
            <Button className="w-full mt-4 text-xs" style={{ borderRadius:5, background:"var(--ds-fg)", color:"#fff" }} onClick={() => setConfigOpen(false)}>
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
            style={{ width: 300, borderRight: "1px solid var(--ds-border)", boxShadow: "4px 0 16px rgba(0,0,0,0.12)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ds-border)]">
              <span className="font-semibold text-[13px]">{t("planner.assumptions")}</span>
              <button onClick={() => setDrawerOpen(false)} className="text-[var(--ds-subtle)] hover:text-neutral-800 text-[12px]">✕</button>
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
                  style={{ borderBottom:"1px solid var(--ds-border-lt)", paddingBottom:4 }}>
                  <span className="text-[9.5px] font-bold tracking-widest text-[var(--ds-subtle)] uppercase">{group.label}</span>
                  <span className="text-[9px] text-[#c4c9d4] select-none">ⓘ</span>
                  <div className="absolute left-0 top-full mt-1.5 z-50 hidden group-hover/sec:block w-60
                    bg-[var(--ds-fg)] text-white text-[10px] leading-snug rounded px-3 py-2 shadow-lg pointer-events-none">
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
                        style={{ borderBottom: "1px solid var(--ds-surface-hover)", opacity: isOn ? 1 : 0.45 }}>

                        {/* Toggle pill */}
                        <button
                          onClick={() => { if (!mandatory) toggleConstraint(item.name) }}
                          className="flex-none relative transition-colors"
                          style={{
                            width: 28, height: 16, borderRadius: 8,
                            background: isOn ? "var(--ds-fg)" : "#d1d5db",
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
                            style={{ background: "var(--ds-border-lt)", color: "var(--ds-muted)", letterSpacing: "0.05em" }}>
                            Mandatory
                          </span>
                        ) : (
                          <div className="relative flex-none">
                            <span className="text-[10px] text-[#c4c9d4] select-none cursor-default group-hover/rule:text-[var(--ds-subtle)]">ⓘ</span>
                            <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover/rule:block w-64
                              bg-[var(--ds-fg)] text-white text-[10px] leading-snug rounded px-3 py-2 shadow-lg pointer-events-none">
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
            <div className="h-px bg-[var(--ds-border)] my-1 mx-4" />
            <div className="px-4 pt-3 pb-2 ds-label font-bold">Targets</div>
            {[["Per job target TAT","5 min"],["Per trailer target TAT","15 min"],["Reassignment cap","1 min"]].map(([k,v]) => (
              <div key={k} className="flex justify-between px-4 pb-2 text-[11.5px]">
                <span className="text-[var(--ds-fg-secondary)]">{k}</span><span className="font-semibold font-mono">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          HEADER — breadcrumb · title + DRAFT badge · metadata tokens
          ══════════════════════════════════════════════════════════════════ */}
      <div className="flex-none bg-white" style={{ borderBottom:"0.5px solid var(--ds-border)" }}>
        <div style={{ padding:"12px 20px" }}>

          {/* Breadcrumb */}
          <div style={{ fontSize:13, color:"var(--ds-subtle)", marginBottom:8 }}>
            Operations <span style={{ margin:"0 5px", color:"var(--ds-decorative)" }}>·</span> Planner
          </div>

          {/* Title row + action buttons */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
            <span style={{ fontSize:20, fontWeight:600, letterSpacing:"-0.3px", color:"var(--text-primary)" }}>Planner</span>

            {/* Status badge */}
            {planSource === "seed" && (
              <span style={{ background:published?"#f0fdf4":"#fffbeb",
                color:published?"#166534":"#92400e",
                border:`1px solid ${published?"#bbf7d0":"#fde68a"}`,
                fontSize:11, fontWeight:600, letterSpacing:"0.5px", textTransform:"uppercase",
                padding:"2px 8px", borderRadius:4 }}>
                {published ? "PUBLISHED" : "DRAFT"}
              </span>
            )}
            {planSource === "engine" && viewedPlan && (
              <span className={`ds-badge ${viewedPlan.status==="confirmed"?"ds-badge-success":viewedPlan.status==="in_progress"?"ds-badge-active":"ds-badge-neutral"}`}>
                {viewedPlan.status.replace("_"," ").toUpperCase()}
              </span>
            )}

            {/* ── Action buttons (right) ── */}
            <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              {/* Dark mode toggle */}
              <button title="Toggle dark mode"
                onClick={() => { const cur=document.documentElement.getAttribute("data-theme"); document.documentElement.setAttribute("data-theme",cur==="dark"?"":"dark") }}
                className="ds-btn ds-btn-ghost" style={{ fontSize:15, padding:"6px 10px" }}>
                <i className="ti ti-moon-stars" />
              </button>
              {/* Configure */}
              <button onClick={() => setConfigOpen(true)} className="ds-btn ds-btn-ghost">
                <i className="ti ti-settings" style={{ fontSize:13 }} /> Configure
              </button>
              {planSource === "seed" ? (<>
                <button onClick={() => setPublished(false)} className="ds-btn ds-btn-ghost">
                  <i className="ti ti-refresh" style={{ fontSize:13 }} /> Regenerate
                </button>
                <button onClick={handlePublish} disabled={publishing||published}
                  style={{ display:"inline-flex", alignItems:"center", gap:6, height:36, padding:"0 16px",
                    borderRadius:5, fontSize:13, fontWeight:500, border:"none", cursor:publishing||published?"default":"pointer",
                    background:published?"#059669":"#16a34a", color:"#fff", opacity:publishing?0.6:1 }}>
                  <i className="ti ti-check" style={{ fontSize:14 }} />
                  {publishing?"Publishing…":published?"Published":"Approve & publish"}
                </button>
              </>) : (<>
                {plans.length > 0 && (
                  <select disabled={historyLoading} onChange={e=>handleHistorySelect(Number(e.target.value))} value={viewedPlan?.id??""}
                    style={{ fontSize:11, padding:"4px 8px", background:"white", border:"0.5px solid var(--ds-border)", borderRadius:5, color:"var(--ds-fg-secondary)", fontFamily:"var(--font-mono)" }}>
                    <option value="" disabled>Plan history ({plans.length})</option>
                    {plans.map(p=><option key={p.id} value={p.id}>#{p.id} · {p.plan_date} · {p.status}</option>)}
                  </select>
                )}
                <button onClick={handleGenerate} disabled={generating} className="ds-btn ds-btn-ghost">
                  <i className="ti ti-refresh" style={{ fontSize:13 }} /> {generating?"Running…":"Generate plan"}
                </button>
                {viewedPlan?.status === "draft" && (
                  <button onClick={handleConfirm} disabled={confirming}
                    style={{ display:"inline-flex", alignItems:"center", gap:6, height:36, padding:"0 16px",
                      borderRadius:5, fontSize:13, fontWeight:500, border:"none", cursor:confirming?"default":"pointer",
                      background:"#16a34a", color:"#fff" }}>
                    <i className="ti ti-check" style={{ fontSize:14 }} />
                    {confirming?"Confirming…":"Confirm plan"}
                  </button>
                )}
              </>)}
            </div>
          </div>

          {/* Plan metadata tokens — separated by · */}
          {planSource === "seed" && (
            <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, fontSize:11,
              color:"var(--ds-subtle)", marginBottom:10 }}>
              <code style={{ background:"var(--ds-border-lt)", borderRadius:3, padding:"2px 6px",
                fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-primary)" }}>P-2026-08-11</code>
              <span style={{ color:"var(--ds-decorative)" }}>·</span>
              Generated <span style={{ fontFamily:"var(--font-mono)", marginLeft:3 }}>22:14</span>
              <span style={{ color:"var(--ds-decorative)" }}>·</span>
              Engine <span style={{ fontFamily:"var(--font-mono)", marginLeft:3 }}>41.8 s</span>
              <span style={{ color:"var(--ds-decorative)" }}>·</span>
              Snapshot <code style={{ background:"var(--ds-border-lt)", borderRadius:3, padding:"2px 6px",
                fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-primary)" }}>#a41f9c</code>
              <span style={{ color:"var(--ds-decorative)" }}>·</span>
              Horizon <code style={{ background:"var(--ds-border-lt)", borderRadius:3, padding:"2px 6px",
                fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-primary)" }}>06:00–14:00</code>
            </div>
          )}
          {planSource === "engine" && viewedPlan && (
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--ds-subtle)", marginBottom:10 }}>
              Plan <code style={{ fontFamily:"var(--font-mono)", fontSize:11 }}>#{viewedPlan.id}</code>
              <span style={{ color:"var(--ds-decorative)" }}>·</span>
              <span style={{ fontFamily:"var(--font-mono)" }}>{viewedPlan.plan_date}</span>
              {viewedPlan.solve_seconds != null && <><span style={{ color:"var(--ds-decorative)" }}>·</span> Solved in <span style={{ fontFamily:"var(--font-mono)", marginLeft:3 }}>{viewedPlan.solve_seconds.toFixed(1)} s</span></>}
              <span style={{ color:"var(--ds-decorative)" }}>·</span>
              <span style={{ fontFamily:"var(--font-mono)" }}>{viewedPlan.moves.length}</span> moves
            </div>
          )}

          {/* Source row — inline badge tabs + assumptions ghost button */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.5px", textTransform:"uppercase",
              color:"var(--ds-subtle)", marginRight:4 }}>Source</span>
            {/* Seed data */}
            <button onClick={()=>setPlanSource("seed")}
              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:5,
                fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.12s",
                background:planSource==="seed"?"var(--ds-accent-bg)":"transparent",
                color:planSource==="seed"?"var(--ds-accent)":"var(--ds-subtle)",
                border:planSource==="seed"?"1px solid var(--ds-accent-border)":"0.5px solid var(--ds-border)" }}>
              <i className="ti ti-database" style={{ fontSize:12 }} /> Seed data
            </button>
            {/* Engine */}
            <button onClick={()=>setPlanSource("engine")} disabled={!backendConnected}
              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:5,
                fontSize:11, fontWeight:600, cursor:backendConnected?"pointer":"not-allowed", transition:"all 0.12s",
                background:planSource==="engine"?"var(--ds-accent-bg)":"transparent",
                color:planSource==="engine"?"var(--ds-accent)":"var(--ds-subtle)",
                border:planSource==="engine"?"1px solid var(--ds-accent-border)":"0.5px solid var(--ds-border)",
                opacity:backendConnected?1:0.6 }}>
              <i className={`ti ${backendConnected?"ti-plug":"ti-plug-off"}`} style={{ fontSize:12 }} />
              {backendConnected?"Engine online":"Engine offline"}
            </button>
            {/* Assumptions & weights */}
            {planSource === "seed" && (
              <button onClick={()=>setDrawerOpen(true)} className="ds-btn ds-btn-ghost" style={{ fontSize:12, gap:4 }}>
                <i className="ti ti-adjustments" style={{ fontSize:13 }} /> Assumptions &amp; weights
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Engine: no plan / spinner */}
      {planSource === "engine" && !viewedPlan && !generating && (
        <div className="flex-1 flex items-center justify-center">
          <div style={{ background:"white", padding:"32px", maxWidth:380, textAlign:"center", borderRadius:8, border:"0.5px solid var(--ds-border)" }}>
            <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>No plan generated yet</div>
            <div style={{ fontSize:12.5, color:"var(--ds-fg-secondary)", lineHeight:1.6, marginBottom:20 }}>
              The planning engine has no plan on record. Generate one to see the solver's move sequence.
            </div>
            <button onClick={handleGenerate} className="ds-btn ds-btn-primary" style={{ margin:"0 auto" }}>
              <i className="ti ti-refresh" /> Generate plan (CP-SAT)
            </button>
          </div>
        </div>
      )}
      {planSource === "engine" && generating && (
        <div className="flex-1 flex items-center justify-center">
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:12, animationName:"spin", animationDuration:"1s", animationIterationCount:"infinite", display:"inline-block" }}>⟳</div>
            <div style={{ fontSize:15, fontWeight:600 }}>Solver running…</div>
            <div style={{ fontSize:12, color:"var(--ds-subtle)", marginTop:4 }}>CP-SAT optimising the move sequence</div>
          </div>
        </div>
      )}

      {/* ══ KPI cards — 5-column grid (both seed and engine) ══ */}
      {dbLoading && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, padding:"16px 20px 12px", flexShrink:0 }}>
          {[0,1,2,3,4].map(i => <Skeleton key={i} variant="kpi" />)}
        </div>
      )}
      {!dbLoading && (planSource === "seed" || (planSource === "engine" && viewedPlan && !generating)) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, padding:"16px 20px 12px", flexShrink:0 }}>
          {(planSource === "seed" ? primaryKpis : engineKpis.slice(0,5)).map(m => (
            <KpiCell key={m.k} m={m}
              onClick={
                m.k===t("planner.kpi.inbound")  ? ()=>onNavigate?.("gate","inbound")  :
                m.k===t("planner.kpi.outbound") ? ()=>onNavigate?.("gate","outbound") :
                undefined
              }
            />
          ))}
        </div>
      )}

      {/* ══ SEED MODE ══ */}
      {planSource === "seed" && (<>

        {/* ── Filter toolbar ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 20px 12px", flexShrink:0, flexWrap:"wrap" }}>
          {/* Search — 150px, surface-1 bg, ti-search icon */}
          <div style={{ position:"relative" }}>
            <i className="ti ti-search" style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)",
              fontSize:14, color:"var(--ds-subtle)", pointerEvents:"none" }} />
            <input type="text" placeholder="Search moves..." value={q} onChange={e=>setQ(e.target.value)}
              style={{ height:32, width:150, paddingLeft:28, paddingRight:8, fontSize:12,
                border:"0.5px solid var(--ds-border)", borderRadius:6, background:"var(--ds-border-lt)",
                color:"var(--text-primary)", fontFamily:"var(--font-sans)", outline:"none" }}
              onFocus={e=>(e.currentTarget.style.borderColor="var(--ds-accent)")}
              onBlur={e=>(e.currentTarget.style.borderColor="var(--ds-border)")} />
          </div>

          {/* Filter pills — colored dot + label */}
          {FILTER_PILLS.map(pill => {
            const active = filter === pill.key
            return (
              <button key={pill.key} onClick={()=>setFilter(pill.key)}
                style={{ display:"inline-flex", alignItems:"center", gap:5, height:32, padding:"0 11px",
                  borderRadius:20, fontSize:12, fontWeight:active?600:500, cursor:"pointer",
                  border:active?"0.5px solid var(--ds-accent-border)":"0.5px solid var(--ds-border)",
                  background:active?"var(--ds-accent-bg)":"transparent",
                  color:active?"var(--ds-accent)":"var(--ds-subtle)",
                  transition:"all 0.12s", whiteSpace:"nowrap" }}>
                {pill.dot && <span style={{ width:6, height:6, borderRadius:"50%", background:pill.dot, flexShrink:0 }} />}
                {pill.label}
              </button>
            )
          })}

          {/* Right: count + Columns button */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:"var(--ds-subtle)", whiteSpace:"nowrap" }}>
              <span style={{ fontFamily:"var(--font-mono)" }}>{planningRows.length}</span> of{" "}
              <span style={{ fontFamily:"var(--font-mono)" }}>{allSteps.length}</span>
              {frozenCount > 0 && <>{" · "}<span style={{ fontFamily:"var(--font-mono)", color:"var(--ds-red)", fontWeight:600 }}>{frozenCount}</span>{" blocked"}</>}
            </span>
            <div ref={colChooserRef} style={{ position:"relative" }}>
              <button onClick={()=>setColChooserOpen(v=>!v)} className="ds-btn ds-btn-ghost" style={{ gap:4, fontSize:12 }}>
                <i className="ti ti-columns" style={{ fontSize:13 }} /> Columns
              </button>
              {colChooserOpen && (
                <div style={{ position:"absolute", right:0, top:"calc(100% + 4px)", zIndex:30, background:"white",
                  border:"1px solid var(--ds-border)", borderRadius:6, boxShadow:"0 4px 12px rgba(0,0,0,0.10)",
                  padding:"6px 0", minWidth:140 }}>
                  {ALL_COLS.map(col => (
                    <label key={col} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--ds-surface-hover)] text-[11px]">
                      <input type="checkbox" checked={visibleCols.has(col)} onChange={()=>toggleCol(col)} style={{ accentColor:"var(--ds-fg)" }} />
                      {col}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Master-detail grid (1fr 360px, no gap, rounded 10px card) ── */}
        <div className="flex-1 min-h-0" style={{ margin:"0 20px 12px", display:"grid",
          gridTemplateColumns:"1fr 360px", gap:0, borderRadius:10,
          border:"0.5px solid var(--ds-border)", overflow:"hidden" }}>

          {/* LEFT — move table */}
          <div style={{ display:"flex", flexDirection:"column", minHeight:0, background:"white", overflow:"hidden" }}>

            {/* Table headers */}
            <div style={{ flex:1, minHeight:0, overflow:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ position:"sticky", top:0, zIndex:10, background:"white",
                    borderBottom:"0.5px solid var(--ds-border)" }}>
                    {[
                      { key:"SEQ",      label:"SEQ",      style:{ width:44, textAlign:"center" as const } },
                      { key:"MOVE",     label:"MOVE",     style:{ width:"18%", textAlign:"left"   as const } },
                      { key:"ROUTE",    label:"ROUTE",    style:{ textAlign:"left"   as const } },
                      { key:"ASSIGNED", label:"ASSIGNED", style:{ width:"20%", textAlign:"left" as const } },
                      { key:"STATUS",   label:"STATUS",   style:{ width:"10%", textAlign:"left" as const } },
                    ].map(h => (
                      <th key={h.key} style={{ ...h.style, padding:"8px 12px",
                        fontSize:11, fontWeight:600, letterSpacing:"0.04em",
                        textTransform:"uppercase", color:"var(--ds-subtle)", whiteSpace:"nowrap" }}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dbLoading && planningRows.length===0 ? (
                    Array.from({length:5},(_,i) => (
                      <tr key={`sk-${i}`}><td colSpan={5} style={{ padding:"6px 16px" }}><Skeleton variant="row" /></td></tr>
                    ))
                  ) : planningRows.length===0 ? (
                    <tr><td colSpan={5} style={{ padding:"24px 16px", fontSize:11, color:"var(--ds-subtle)" }}>
                      No steps match {q?`"${q}"`:"this filter"}.
                    </td></tr>
                  ) : planningRows.map((s,i) => (
                    <MoveRow key={`pr-${i}`} m={{source:"planning",move:s}} isSelected={stepId(s)===sel}
                      onClick={()=>{setSel(stepId(s));setTab("detail")}} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT — detail panel */}
          <div style={{ background:"white", borderLeft:"0.5px solid var(--ds-border)",
            display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>

            {/* Tab bar — surface-1 bg, bottom border accent active */}
            <div style={{ display:"flex", background:"var(--ds-border-lt)",
              borderBottom:"0.5px solid var(--ds-border)", flexShrink:0 }}>
              {[
                { id:"detail",     label:"Move",         count:0 },
                { id:"exceptions", label:"Exceptions",   count:exceptions.length },
                { id:"projection", label:"Projected KPI", count:0 },
              ].map(tItem => (
                <button key={tItem.id} onClick={()=>setTab(tItem.id)}
                  style={{ padding:"10px 16px", fontSize:13, cursor:"pointer",
                    background:tab===tItem.id?"white":"transparent",
                    borderBottom:tab===tItem.id?"2px solid var(--ds-accent)":"2px solid transparent",
                    borderTop:"none", borderLeft:"none", borderRight:"none",
                    color:tab===tItem.id?"var(--text-primary)":"var(--ds-subtle)",
                    fontWeight:tab===tItem.id?500:400,
                    display:"inline-flex", alignItems:"center", gap:6, flexShrink:0,
                    fontFamily:"var(--font-sans)" }}>
                  {tItem.label}
                  {tItem.count > 0 && (
                    <span style={{ fontSize:10, padding:"1px 5px", borderRadius:10,
                      background:"#fef2f2", color:"#991b1b", fontWeight:600,
                      fontFamily:"var(--font-mono)" }}>{tItem.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Detail body — 16px padding per spec */}
            <div style={{ flex:1, minHeight:0, overflowY:"auto" }}>

              {/* ── MOVE TAB ── */}
              {tab === "detail" && selStep && (
                <div style={{ padding:16 }}>
                  {/* Container ID + equipment badge */}
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                    <span style={{ fontFamily:"var(--font-mono)", fontSize:13, color:"var(--ds-accent)", fontWeight:500 }}>
                      {getDisplayContainerId(selStep)}
                    </span>
                    {(() => {
                      const b = getEquipmentType(selStep)
                      return (
                        <span style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"3px 8px",
                          borderRadius:4, background:b.bg, color:b.text, fontSize:11, fontWeight:600 }}>
                          {b.icon} {b.label}
                        </span>
                      )
                    })()}
                  </div>
                  {/* Move type — 15px/600 */}
                  <div style={{ fontSize:15, fontWeight:600, color:"var(--text-primary)", lineHeight:1.3, marginBottom:14 }}>
                    {getDisplayOperation(selStep.operation)}
                  </div>

                  {/* Route card — single line: FROM · loc → TO · loc */}
                  <div style={{ background:"var(--ds-border-lt)", border:"0.5px solid var(--ds-border)",
                    borderRadius:6, padding:"8px 12px", marginBottom:10,
                    display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const }}>
                    <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.5px", textTransform:"uppercase" as const,
                      color:"var(--ds-subtle)", flexShrink:0 }}>FROM</span>
                    <span style={{ fontFamily:"var(--font-mono)", fontSize:13, fontWeight:500,
                      color:"var(--text-primary)" }}>{fmtLoc(selStep.origin)}</span>
                    <span style={{ color:"var(--ds-subtle)", fontSize:14, flexShrink:0 }}>→</span>
                    <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.5px", textTransform:"uppercase" as const,
                      color:"var(--ds-subtle)", flexShrink:0 }}>TO</span>
                    <span style={{ fontFamily:"var(--font-mono)", fontSize:13, fontWeight:500,
                      color:"var(--text-primary)" }}>{fmtLoc(selStep.destination)}</span>
                  </div>

                  {/* Extra movement indicator */}
                  {isExtraMovement(selStep.operation) && (
                    <div style={{ marginBottom:12 }}>
                      <span style={{ display:"inline-block", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em",
                        padding:"3px 8px", borderRadius:4, background:"#fef3c7", color:"#b45309",
                        textTransform:"uppercase" }}>
                        ↔ Extra movement — non-productive
                      </span>
                    </div>
                  )}

                  {/* Why this step — warning card */}
                  {selStep.step_status === "Blocked" ? (
                    <div style={{ background:"#fef2f2", border:"0.5px solid #fca5a5", borderRadius:6,
                      padding:"10px 12px", marginBottom:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.5px", color:"#b91c1c",
                        textTransform:"uppercase", marginBottom:6 }}>Step blocked</div>
                      <div style={{ fontSize:13, fontWeight:600, color:"#b91c1c", lineHeight:1.5 }}>
                        ⚠ Activity status: {selStep.activity_status ?? "Unknown"}
                      </div>
                    </div>
                  ) : (
                    <div style={{ background:"#fffbeb", border:"0.5px solid #fde68a", borderRadius:6,
                      padding:"10px 12px", marginBottom:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.5px", color:"#92400e",
                        textTransform:"uppercase", marginBottom:6 }}>Why this step</div>
                      <div style={{ fontSize:13, color:"var(--text-primary)", lineHeight:1.5 }}>
                        {generateWhyText(selStep)}
                      </div>
                    </div>
                  )}

                  {/* Metadata — label/value hairlines, 8px vertical padding */}
                  {([
                    ["Operator",    selStep.operator ?? "—",        false] as const,
                    ["Move method", getDisplayMoveMethod(selStep),  true]  as const,
                    ["Time slot",   selStep.estimated_start
                      ? fmtIso(selStep.estimated_start)+"–"+fmtIso(selStep.estimated_end)+" ("+stepDur(selStep).toFixed(1)+"′)"
                      : selStep.step_status==="Completed" ? "Completed · no time slot recorded"
                      : selStep.step_status==="Blocked"   ? "Blocked · not scheduled"
                      : "Not yet scheduled", true] as const,
                    ["Score",       selStep.planning_score != null
                      ? selStep.planning_score.toFixed(2)
                      : selStep.move_method==="Inspection" ? "N/A · inspection step"
                      : selStep.step_status==="Completed" ? "N/A · completed" : "—", true] as const,
                    ["Step status", selStep.step_status,            false] as const,
                    ["Activity",    selStep.activity_status ?? "—", false] as const,
                  ] as [string, string, boolean][]).map(([k, v, mono]) => {
                    const isStatus = k==="Step status"||k==="Activity"
                    const statusColor = v==="Completed"?"#059669":v==="Blocked"?"#dc2626":undefined
                    return (
                      <div key={k} style={{ display:"flex", justifyContent:"space-between",
                        alignItems:"center", padding:"8px 0",
                        borderBottom:"0.5px solid var(--ds-border-lt)", gap:12 }}>
                        <span style={{ fontSize:12, color:"var(--ds-fg-secondary)" }}>{k}</span>
                        <span style={{ fontSize:13, fontWeight:500, textAlign:"right",
                          color:isStatus&&statusColor?statusColor:"var(--text-primary)",
                          fontFamily:mono?"var(--font-mono)":undefined }}>
                          {v}
                        </span>
                      </div>
                    )
                  })}

                  {/* Hard constraints collapsible */}
                  <AccordionHeader label="Hard constraints" icon="ti-lock" open={constraintsOpen} onToggle={()=>setConstraintsOpen(v=>!v)} />
                  <div style={{ overflow:"hidden", maxHeight:constraintsOpen?300:0, transition:"max-height 200ms ease" }}>
                    {[["C2","Stack height within zone max","PASS"],["C3","Row depth within reach","PASS"],
                      ["C4","Gross weight vs capacity","PASS"],["C9","Operator certified","PASS"],
                      ["C12","Destination below utilisation ceiling","PASS"]].map(([id,label,verdict]) => (
                      <div key={id} style={{ display:"flex", alignItems:"baseline", gap:8, padding:"6px 0",
                        borderBottom:"0.5px solid var(--ds-border-lt)", fontSize:11.5 }}>
                        <span style={{ fontFamily:"var(--font-mono)", color:"var(--ds-subtle)", fontWeight:700, width:24 }}>{id}</span>
                        <span style={{ flex:1, color:"var(--ds-fg-secondary)", lineHeight:1.4 }}>{label}</span>
                        <span style={{ fontSize:10, fontWeight:700, color:"#059669" }}>{verdict}</span>
                      </div>
                    ))}
                  </div>

                  {/* Step history collapsible */}
                  <AccordionHeader label="Step history" icon="ti-history" open={moveHistoryOpen} onToggle={()=>setMoveHistoryOpen(v=>!v)} />
                  <div style={{ overflow:"hidden", maxHeight:moveHistoryOpen?200:0, transition:"max-height 200ms ease" }}>
                    {[
                      ...(selStep.estimated_start?[[fmtIso(selStep.estimated_start),"Planned by engine","auto"]]:[]),
                      ...(selStep.actual_start?[[fmtIso(selStep.actual_start),"Actual start recorded","system"]]:[]),
                      ...(selStep.actual_end?[[fmtIso(selStep.actual_end),"Actual end recorded","system"]]:[]),
                      ...(selStep.estimated_start==null?[["—","No window recorded","engine"]]:[]),
                    ].map(([time,event,src]) => (
                      <div key={time+event} style={{ display:"flex", alignItems:"baseline", gap:12, padding:"6px 0",
                        borderBottom:"0.5px solid var(--ds-border-lt)", fontSize:11.5 }}>
                        <span style={{ fontFamily:"var(--font-mono)", color:"var(--ds-subtle)", width:40 }}>{time}</span>
                        <span style={{ flex:1, color:"var(--ds-fg-secondary)" }}>{event}</span>
                        <span style={{ fontSize:10, color:"var(--ds-subtle)" }}>{src}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "detail" && !selStep && (
                <div style={{ padding:16, fontSize:12.5, color:"var(--ds-fg-secondary)", lineHeight:1.6 }}>
                  {focus||q||"This container"} has no step in plan P-2026-08-11 — {allSteps.length} steps planned today.
                </div>
              )}

              {/* ── EXCEPTIONS TAB ── */}
              {tab === "exceptions" && (
                <div>
                  {exceptions.map(e => (
                    <div key={e.id} style={{ padding:"12px 16px", borderBottom:"0.5px solid var(--ds-border-lt)" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
                        <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
                          color:e.severity==="high"?"var(--ds-red)":"var(--ds-subtle)" }}>{e.type}</span>
                        <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--ds-subtle)" }}>{e.id}</span>
                      </div>
                      <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>{e.subject}</div>
                      <div style={{ fontSize:12, color:"var(--ds-fg-secondary)", lineHeight:1.5, marginBottom:8 }}>{e.detail}</div>
                      <button className="ds-btn ds-btn-ghost" style={{ fontSize:11.5, height:28, padding:"0 10px" }}>{e.action}</button>
                    </div>
                  ))}
                  <div style={{ padding:"12px 16px", fontSize:11.5, color:"var(--ds-fg-secondary)", lineHeight:1.5 }}>
                    Infeasible assignments escalate after three resequencing iterations.
                  </div>
                </div>
              )}

              {/* ── PROJECTED KPI TAB ── */}
              {tab === "projection" && (
                <div>
                  {projection.map(p => (
                    <div key={p.k} style={{ padding:"12px 16px", borderBottom:"0.5px solid var(--ds-border-lt)" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11.5, marginBottom:4 }}>
                        <span style={{ fontWeight:600 }}>{p.k}</span>
                        <span style={{ color:"var(--ds-subtle)" }}>target <span style={{ fontFamily:"var(--font-mono)" }}>{p.target}</span></span>
                      </div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:6, fontSize:11, color:"var(--ds-subtle)" }}>
                        <span style={{ fontFamily:"var(--font-mono)" }}>{p.opt}</span>
                        <span style={{ fontFamily:"var(--font-mono)", fontWeight:600, fontSize:24, color:"var(--text-primary)" }}>{p.exp}</span>
                        <span style={{ fontFamily:"var(--font-mono)" }}>{p.pes}</span>
                      </div>
                      <div style={{ position:"relative", height:4, background:"var(--ds-border-lt)", borderRadius:2 }}>
                        <div style={{ position:"absolute", top:0, height:4, background:"#fca5a5", borderRadius:2,
                          left:p.bandLeft+"%", width:p.bandWidth+"%" }} />
                        <div style={{ position:"absolute", top:-3, height:10, width:1,
                          background:"var(--text-primary)", left:p.mark+"%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Operator bar — rounded card ── */}
        <div style={{ margin:"0 20px 16px", background:"var(--ds-border-lt)", border:"0.5px solid var(--ds-border)",
          borderRadius:10, flexShrink:0 }}>
          {/* Summary row */}
          <div style={{ display:"flex", alignItems:"center", padding:"10px 14px", fontSize:12,
            color:"var(--text-primary)" }}>
            <i className="ti ti-users" style={{ fontSize:15, color:"var(--ds-subtle)", marginRight:8 }} />
            <span>{onShift.length} operators on shift</span>
            <span style={{ width:1, height:16, background:"var(--ds-border)", margin:"0 12px" }} />
            <i className="ti ti-lock" style={{ fontSize:15, color:"var(--ds-subtle)", marginRight:8 }} />
            <span>{frozenCount} moves frozen</span>
            <span style={{ width:1, height:16, background:"var(--ds-border)", margin:"0 12px" }} />
            <i className="ti ti-coffee" style={{ fontSize:15, color:"var(--ds-subtle)", marginRight:8 }} />
            <span>Next break</span>
            {/* Progress track 60px × 4px, 65% fill */}
            <div style={{ width:60, height:4, background:"var(--ds-border)", borderRadius:2,
              margin:"0 8px", overflow:"hidden", flexShrink:0 }}>
              <div style={{ width:"65%", height:"100%", background:"var(--ds-accent)", borderRadius:2 }} />
            </div>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:11 }}>09:30</span>
            {/* Show Gantt button */}
            <button onClick={()=>setGanttExpanded(v=>!v)} className="ds-btn ds-btn-ghost"
              style={{ marginLeft:"auto", gap:4, fontSize:12 }}>
              <i className="ti ti-chart-gantt" style={{ fontSize:13 }} />
              {ganttExpanded?"Collapse ▲":"Show Gantt ▼"}
            </button>
          </div>

          {/* Gantt — expands below the row */}
          <div style={{ overflow:"hidden", maxHeight:ganttExpanded?220:0, transition:"max-height 220ms ease" }}>
            <div style={{ borderTop:"0.5px solid var(--ds-border)" }}>
              <div style={{ padding:"4px 14px", fontSize:11, color:"var(--ds-subtle)" }}>
                {published?"Frozen window 20 min · in-progress moves immutable":"Preview — freeze applies at publication"}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"132px 1fr" }}>
                <div />
                <div style={{ display:"flex", borderBottom:"0.5px solid var(--ds-border)" }}>
                  {HOURS.map(h => (
                    <div key={h} style={{ flex:1, fontFamily:"var(--font-mono)", fontSize:9,
                      color:"var(--ds-subtle)", borderLeft:"0.5px solid var(--ds-border)", padding:"2px 4px" }}>{h}</div>
                  ))}
                </div>
                {operatorNames().map(opName => {
                  const opSteps = stepsForOperator(opName)
                  return (
                    <div key={opName} style={{ display:"contents" }}>
                      <div style={{ padding:"4px 14px", fontSize:11.5,
                        borderBottom:"0.5px solid var(--ds-border)", display:"flex", justifyContent:"space-between" }}>
                        <span style={{ fontWeight:600 }}>{opName}</span>
                        <span style={{ color:"var(--ds-subtle)" }}>{opSteps.length} steps</span>
                      </div>
                      <div style={{ position:"relative", height:32,
                        borderBottom:"0.5px solid var(--ds-border)", borderLeft:"0.5px solid var(--ds-border)" }}>
                        {opSteps.map((s, gi) => {
                          const startMin = isoToMin(s.estimated_start)
                          const endMin   = isoToMin(s.estimated_end)
                          if (startMin==null||endMin==null) return null
                          const sid = stepId(s)
                          return (
                            <div key={`g-${gi}`}
                              onClick={()=>{setSel(sid);setTab("detail")}}
                              title={`${getDisplayContainerId(s)} · ${getDisplayOperation(s.operation)} · ${fmtIso(s.estimated_start)}–${fmtIso(s.estimated_end)}`}
                              style={{ position:"absolute", top:8, height:12, cursor:"pointer", borderRadius:2,
                                left:(Math.max(0,startMin-360)/480*100).toFixed(2)+"%",
                                width:Math.max(0.5,(endMin-startMin)/480*100).toFixed(2)+"%",
                                background:sid===sel?"var(--ds-accent)":s.step_status==="Blocked"?"var(--ds-subtle)":"var(--ds-fg)" }}
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

      </>)}

      {/* ══ ENGINE MODE — two-column (unchanged layout) ══ */}
      {planSource === "engine" && viewedPlan && !generating && (
        <div className="grid flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns:"minmax(400px,1fr) clamp(280px,28vw,380px)" }}>
          <div className="flex flex-col min-h-0 bg-white">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--ds-border)] flex-none">
              <span className="text-[11px] text-[var(--ds-subtle)]"><span className="font-mono">{engineMoves.length}</span> moves · Plan <span className="font-mono">#{viewedPlan.id}</span></span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full border-collapse" style={{ fontSize:11 }}>
                <thead>
                  <tr>
                    {ALL_COLS.filter(h=>visibleCols.has(h)).map((h,i) => (
                      <th key={h} className="ds-th text-left sticky top-0 z-10"
                        style={{ paddingLeft:i===0?16:undefined, textAlign:h==="EST"?"right":undefined }}>
                        {h==="SEQ"?t("planner.move.seq"):h==="MOVE"?t("planner.move.move"):h==="ROUTE"?t("planner.move.route"):h==="ASSIGNED"?t("planner.move.assigned"):h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {engineMoves.length===0 ? (
                    <tr><td colSpan={visibleCols.size} className="px-4 py-4 text-[11px] text-[var(--ds-subtle)]">No moves in this plan.</td></tr>
                  ) : engineMoves.map(m => (
                    <MoveRow key={m.id} m={{source:"engine",move:m}} isSelected={m.id===engineSel} onClick={()=>setEngineSel(m.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white flex flex-col min-h-0 overflow-auto" style={{ borderLeft:"1px solid var(--ds-border)", width:300 }}>

            {/* ── Plan summary (narration) ─────────────────────────────── */}
            {viewedPlan && (
              <div style={{ borderBottom:"0.5px solid var(--ds-border-lt)", padding:"12px 16px" }}>
                {/* heading row */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
                    color:"var(--ds-subtle)" }}>
                    <i className="ti ti-sparkles" style={{ marginRight:5, fontSize:11 }} />
                    Plan summary
                  </span>
                  <button
                    onClick={handleNarrate}
                    disabled={narrating}
                    title="Re-generate AI narration"
                    style={{ fontSize:10, padding:"2px 7px", borderRadius:4, cursor:narrating?"default":"pointer",
                      border:"0.5px solid var(--ds-border)", background:"transparent",
                      color:"var(--ds-subtle)", opacity:narrating?0.5:1, display:"inline-flex", alignItems:"center", gap:4 }}>
                    <i className={`ti ${narrating?"ti-loader-2":"ti-refresh"}`}
                      style={{ fontSize:11, animation:narrating?"spin 1s linear infinite":undefined }} />
                    {narrating ? "Narrating…" : "Re-narrate"}
                  </button>
                </div>

                {viewedPlan.narration ? (
                  <p style={{ fontSize:12, lineHeight:1.65, color:"var(--text-primary)", margin:0 }}>
                    {viewedPlan.narration}
                  </p>
                ) : (
                  <p style={{ fontSize:12, color:"var(--ds-subtle)", fontStyle:"italic", margin:0 }}>
                    Summary not available — click Re-narrate to generate.
                  </p>
                )}
              </div>
            )}

            {/* ── Move detail ─────────────────────────────────────────── */}
            {engineSelMove ? (
              <div>
                <div className="px-4 pt-3 pb-3">
                  <div className="ds-label">{t("planner.move.move")} <span className="font-mono">#{engineSelMove.id}</span> · seq <span className="font-mono">{engineSelMove.seq}</span></div>
                  <div className="font-semibold text-base mt-1 tracking-tight">{REASON_LABELS[engineSelMove.reason] ?? engineSelMove.typeLabel ?? "Move"}</div>
                  <div className="text-[12px] mt-1 font-mono text-[var(--ds-fg-secondary)]">{engineSelMove.containerId}</div>
                  <div className="text-[12px] font-mono text-[var(--ds-subtle)]">{engineSelMove.from} → {engineSelMove.to}</div>
                </div>
                {engineSelMove.reason && (
                  <div className="ds-callout mx-4 mb-3">
                    <div className="ds-callout-label">Why this move</div>
                    <div className="text-[12.5px] leading-relaxed">{REASON_LABELS[engineSelMove.reason] ?? engineSelMove.reason}</div>
                  </div>
                )}
                {[["Jockey / operator",engineSelMove.operatorName],["Est. duration",engineSelMove.estMin.toFixed(1)+"′"],["State",engineSelMove.stateLabel??"—"],["Frozen",engineSelMove.frozen?"yes":"no"]].map(([k,v]) => (
                  <div key={k} className="flex justify-between gap-3 px-4 py-2 border-b border-[var(--ds-border-lt)] text-[11.5px]">
                    <span className="text-[var(--ds-subtle)]">{k}</span>
                    <span className="font-semibold font-mono text-right">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-4 text-[12px] text-[var(--ds-subtle)] leading-relaxed">Select a move from the table to see its details.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function isoToMin(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
