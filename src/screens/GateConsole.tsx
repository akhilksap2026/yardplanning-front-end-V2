import { useState, useEffect, useRef } from "react"
import TabBar             from "@/components/ui/TabBar"
import { Button } from "@/components/ui/button"
import { useData } from "@/lib/DataContext"
import type { Visit } from "@/data/yard-ops"
import { backendApi, type BackendGateTransaction, type LiveGateRow } from "@/lib/backend-api"
import ContainerPicker from "@/components/ContainerPicker"
import { computeRehandleCost } from "@/lib/utils"
import { fmtTime, fmtTimestamp } from "@/utils/time"
import GateInspection from "@/components/gate/GateInspection"
import { allSteps } from "@/data/planningData"
import { INBOUND_SEED, OUTBOUND_SEED } from "@/data/gate-seed"
import { STORY_GATE_TXNS } from "@/data/story-seed"
import { useLang } from "@/lib/i18n"
import Skeleton from "@/components/ui/Skeleton"

interface Props {
  focus: string | null
  onNavigate?: (target: string, focus?: string) => void
}

const STEPS = ["EXPECTED","APPROACHING","IN_QUEUE","CHECKED_IN","AT_POSITION","SERVED","GATE_OUT"]

const LANE_STYLE: Record<string, [string,string,string]> = {
  free:     ["transparent","#9ca3af","#374151"],
  occupied: ["#1f2937",   "#1f2937","#fff"],
  assigned: ["#fef2f2",   "#dc2626","#9b1c1c"],
  clearing: ["#f3f4f6",   "#6b7280","#111827"],
  staged:   ["#e5e7eb",   "#6b7280","#111827"],
  loading:  ["#dc2626",   "#dc2626","#fff"],
}

const EXCL_REASONS = [
  "Driver early — appointment not yet open",
  "Container not pre-cleared by customs",
  "Weight discrepancy vs. booking",
  "Driver documents incomplete",
]

// Step 3: visit table column definitions
const VISIT_COLS = ["TRUCK","LIFECYCLE","TURN","YARD_READY","PURPOSE","CONTAINER","APPT","EXCLUSION"] as const
type VisitCol = typeof VISIT_COLS[number]
const DEFAULT_VISIT_COLS = new Set<VisitCol>(["TRUCK","LIFECYCLE","TURN","YARD_READY"])
const VISIT_COL_LABELS: Record<VisitCol, string> = {
  TRUCK: "TRUCK", LIFECYCLE: "STATUS", TURN: "QUEUE #", YARD_READY: "YARD READY",
  PURPOSE: "PURPOSE", CONTAINER: "CONTAINER", APPT: "TIME SLOT", EXCLUSION: "EXCEPTION",
}

export default function GateConsole({ focus, onNavigate }: Props) {
  const { visits, lanes, appointments, refresh, backendConnected, backendContainers, containers, dbLoading } = useData()
  const { t, lang, setLang } = useLang()

  // ── Existing state ────────────────────────────────────────────────────────
  const [tab,          setTab]         = useState("visits")
  const [sel,          setSel]         = useState("V-2043")
  const [apptSel,      setApptSel]     = useState("07:30")
  const [smoothed,     setSmoothed]    = useState(false)
  const [checkingIn,   setCheckingIn]  = useState(false)
  const [checkInDone,  setCheckInDone] = useState(false)
  const [eirDone,      setEirDone]     = useState(false)
  const [exclOpen,     setExclOpen]    = useState(false)
  const [exclReason,   setExclReason]  = useState<string|null>(null)

  // ── Gate transactions state ───────────────────────────────────────────────
  const [transactions,    setTransactions]    = useState<BackendGateTransaction[]>([])
  const [txLoading,       setTxLoading]       = useState(false)
  const [showGateInForm,  setShowGateInForm]  = useState(false)
  // GTX filter state
  const [gtxChanFilter,  setGtxChanFilter]   = useState("all")
  const [gtxDirFilter,   setGtxDirFilter]    = useState("all")
  const [gateInContId,    setGateInContId]    = useState<number | "">("")
  const [gateInPlate,     setGateInPlate]     = useState("")
  const [gateInDriver,    setGateInDriver]    = useState("")
  const [gateInCarrier,   setGateInCarrier]   = useState("")
  const [submittingGateIn,setSubmittingGateIn]= useState(false)
  const [gateOutLoading,  setGateOutLoading]  = useState<number | null>(null)
  const [turnaroundToast, setTurnaroundToast] = useState<string | null>(null)
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── New state: Steps 1–4 ─────────────────────────────────────────────────
  const [kpiExpanded,     setKpiExpanded]     = useState(false)          // Step 1
  const [lanesExpanded,   setLanesExpanded]   = useState(false)          // Step 2
  const [visibleCols,     setVisibleCols]     = useState<Set<VisitCol>>(new Set(DEFAULT_VISIT_COLS)) // Step 3
  const [colChooserOpen,  setColChooserOpen]  = useState(false)          // Step 3
  const [receiptOpen,     setReceiptOpen]     = useState(false)          // Step 4
  const [eirPhotosOpen,   setEirPhotosOpen]   = useState(false)          // Step 4
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)          // Step 4
  const [atPositioning,   setAtPositioning]   = useState(false)          // AT_POSITION transition
  const [atPositionDone,  setAtPositionDone]  = useState(false)          // AT_POSITION transition
  const colChooserRef  = useRef<HTMLDivElement>(null)
  const moreActionsRef = useRef<HTMLDivElement>(null)

  // ── Inbound / Outbound filter + search + dark mode ───────────────────────
  const [filterPill,  setFilterPill]  = useState<"all"|"alerts"|"holds"|"in_queue"|"in_yard">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [copiedId,    setCopiedId]    = useState<string | null>(null)
  const [darkMode,    setDarkMode]    = useState(false)
  const [utcTime,     setUtcTime]     = useState(() => new Date().toUTCString().slice(17,25))

  // ── Outside-click closes ──────────────────────────────────────────────────
  useEffect(() => {
    if (!colChooserOpen) return
    const h = (e: MouseEvent) => {
      if (colChooserRef.current && !colChooserRef.current.contains(e.target as Node)) setColChooserOpen(false)
    }
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h)
  }, [colChooserOpen])

  useEffect(() => {
    if (!moreActionsOpen) return
    const h = (e: MouseEvent) => {
      if (moreActionsRef.current && !moreActionsRef.current.contains(e.target as Node)) setMoreActionsOpen(false)
    }
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h)
  }, [moreActionsOpen])

  // ── UTC clock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setUtcTime(new Date().toUTCString().slice(17, 25))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Live gate container rows (fetched from backend, seed fallback) ───────────
  const [liveInbound,  setLiveInbound]  = useState<LiveGateRow[] | null>(null)
  const [liveOutbound, setLiveOutbound] = useState<LiveGateRow[] | null>(null)
  const [fetchedAt,    setFetchedAt]    = useState<string | null>(null)
  const [liveError,    setLiveError]    = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [ib, ob] = await Promise.all([
          backendApi.fetchGateContainers("inbound"),
          backendApi.fetchGateContainers("outbound"),
        ])
        if (cancelled) return
        // Only replace seed when the API returns actual data.
        // An empty array means the table isn't seeded in this environment — keep seed fallback.
        if (ib.rows.length > 0) setLiveInbound(ib.rows)
        if (ob.rows.length > 0) setLiveOutbound(ob.rows)
        if (ib.rows.length > 0 || ob.rows.length > 0) {
          setFetchedAt(ib.fetchedAt)
          setLiveError(false)
        }
      } catch {
        if (!cancelled) setLiveError(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Merge live data over seed: live rows enriched with freeDays/detentionBasis;
  // seed used as fallback when backend is unreachable.
  // Seed data cast to LiveGateRow shape — freeDays/detentionBasis will be undefined until live fetch resolves
  const inboundRows  = (liveInbound  ?? INBOUND_SEED  as unknown as LiveGateRow[]) as LiveGateRow[]
  const outboundRows = (liveOutbound ?? OUTBOUND_SEED as unknown as LiveGateRow[]) as LiveGateRow[]

  // ── Existing effects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!focus) return
    if (focus === "inbound")  { setTab("inbound");  return }
    if (focus === "outbound") { setTab("outbound"); return }
    const v = visits.find(x => x.container === focus || x.id === focus)
    if (v) { setSel(v.id); setTab("visits") }
  }, [focus, visits])

  useEffect(() => {
    setCheckInDone(false); setEirDone(false); setExclOpen(false); setExclReason(null)
    setReceiptOpen(false); setEirPhotosOpen(false)
    setAtPositionDone(false); setAtPositioning(false)
  }, [sel])

  useEffect(() => {
    if (tab !== "gtx" || !backendConnected) return
    loadTransactions()
  }, [tab, backendConnected])

  async function loadTransactions() {
    setTxLoading(true)
    try {
      // DEFERRED: no backend route yet — backendApi.gateTransactions()
      setTransactions([])
    } catch (err) { console.error("[GateConsole] load transactions:", err) }
    finally { setTxLoading(false) }
  }

  async function handleGateIn() {
    setSubmittingGateIn(true)
    try {
      // DEFERRED: no backend route yet — backendApi.createGateTransaction({ gate_type: "in", ... })
      setShowGateInForm(false)
      setGateInContId(""); setGateInPlate(""); setGateInDriver(""); setGateInCarrier("")
      await loadTransactions()
    } catch (err) { console.error("[GateConsole] gate in:", err) }
    finally { setSubmittingGateIn(false) }
  }

  async function handleGateOut(containerId: number, inTime: string | null) {
    setGateOutLoading(containerId)
    try {
      // DEFERRED: no backend route yet — backendApi.createGateTransaction({ gate_type: "out", ... })
      await loadTransactions()
    } catch (err) { console.error("[GateConsole] gate out:", err) }
    finally { setGateOutLoading(null) }
  }

  // ── TxGroups (unchanged) ──────────────────────────────────────────────────
  type TxGroup = { key:string; containerId:number|null; containerNumber:string; inTx:BackendGateTransaction|null; outTx:BackendGateTransaction|null; latestAt:number }
  const txGroups: TxGroup[] = (() => {
    const map = new Map<string,{inTx:BackendGateTransaction|null;outTx:BackendGateTransaction|null;cid:number|null}>()
    for (const tx of transactions) {
      const key = tx.container_id != null ? `c_${tx.container_id}` : `t_${tx.id}`
      if (!map.has(key)) map.set(key,{inTx:null,outTx:null,cid:tx.container_id})
      const g = map.get(key)!
      if (tx.gate_type==="in") g.inTx=tx
      if (tx.gate_type==="out") g.outTx=tx
    }
    return Array.from(map.entries()).map(([key,{inTx,outTx,cid}]) => {
      const c = cid!=null?backendContainers.find(x=>x.id===cid):null
      const latestAt = Math.max(
        inTx?.actual_arrival?new Date(inTx.actual_arrival).getTime():0,
        outTx?.actual_departure?new Date(outTx.actual_departure).getTime():0,
        inTx?new Date(inTx.created_at).getTime():0,
        outTx?new Date(outTx.created_at).getTime():0,
      )
      return { key, containerId:cid, containerNumber:c?.container_number??(cid!=null?`#${cid}`:"—"), inTx, outTx, latestAt }
    }).sort((a,b)=>b.latestAt-a.latestAt)
  })()

  function fmtTurnaround(inIso:string|null,outIso:string|null):string {
    if (!inIso) return "—"
    const mins=Math.round((( outIso?new Date(outIso).getTime():Date.now())-new Date(inIso).getTime())/60_000)
    return `${mins}′${outIso?"":` (running)`}`
  }

  // ── Seed-derived GTX rows (always available, no backend needed) ──────────
  const CHAN_COLOR: Record<string,[string,string]> = {
    rail:  ["#fef2f2","#991b1b"],   // red-50 / red-800
    sea:   ["#fffbeb","#92400e"],   // amber-50 / amber-800
    road:  ["#f0fdf4","#166534"],   // green-50 / green-800
  }
  const STATE_STYLE: Record<string,[string,string]> = {
    GATE_OUT:    ["#f0fdf4","#166534"],   // success  — green-50 / green-800
    SERVED:      ["#eff6ff","#1e40af"],   // active   — blue-50  / blue-800
    AT_POSITION: ["#fffbeb","#92400e"],   // warning  — amber-50 / amber-800
    CHECKED_IN:  ["#faf5ff","#6b21a8"],   // planned  — purple-50 / purple-800
    IN_QUEUE:    ["#f3f4f6","#374151"],   // neutral  — gray-100 / gray-700
    APPROACHING: ["#faf5ff","#6b21a8"],   // planned  — purple-50 / purple-800
    EXPECTED:    ["#f3f4f6","#374151"],   // neutral  — gray-100 / gray-700
  }
  const GATE_STATE_I18N: Record<string,string> = {
    GATE_OUT:    "gateStatus.gateOut",
    SERVED:      "gateStatus.served",
    AT_POSITION: "gateStatus.atPosition",
    CHECKED_IN:  "gateStatus.checkedIn",
    IN_QUEUE:    "gateStatus.inQueue",
    APPROACHING: "gateStatus.approaching",
    EXPECTED:    "gateStatus.expected",
  }
  function stateLabel(s: string) { return GATE_STATE_I18N[s] ? t(GATE_STATE_I18N[s]) : s }
  function dirFromPurpose(p:string){ return /drop|inbound/i.test(p)?"IN":/pickup|retrieval/i.test(p)?"OUT":"EMPTY" }

  // Build a plate-keyed lookup from the combined gate-seed so we can enrich visits
  // with channel, consignee, seal, size, LFD urgency, hold, chassis, etc.
  const gateSeedByPlate = new Map(
    [...INBOUND_SEED, ...OUTBOUND_SEED].map(r => [r.plate, r])
  )

  // Compute actual turnaround (minutes) from queue-in → gate-out timestamps
  function calcTurn(queueIn: string|null, gateOut: string|null): number {
    if (!queueIn || !gateOut) return 0
    const [qh, qm] = queueIn.split(":").map(Number)
    const [gh, gm] = gateOut.split(":").map(Number)
    return Math.max(0, (gh * 60 + gm) - (qh * 60 + qm))
  }

  const seedGtxRows = visits.map(v => {
    const gsRow = gateSeedByPlate.get(v.plate)
    const ch  = gsRow?.channel ?? (containers.find(c => c.id === v.container)?.channel ?? "road")
    const dir = dirFromPurpose(v.purpose)
    // For GATE_OUT visits the stored turn is 0; compute it from timestamps instead
    const actualTurn = Number(v.turn) > 0 ? Number(v.turn) : calcTurn(v.queueIn, v.gateOut)
    return { visit:v, cont: containers.find(c=>c.id===v.container), ch, dir, gsRow, actualTurn }
  }).sort((a,b) => {
    const ta = a.visit.gateOut??a.visit.served??a.visit.atPosition??a.visit.checkIn??a.visit.queueIn??""
    const tb = b.visit.gateOut??b.visit.served??b.visit.atPosition??b.visit.checkIn??b.visit.queueIn??""
    return tb.localeCompare(ta)
  })

  const filteredGtxRows = seedGtxRows.filter(r =>
    (gtxChanFilter==="all" || r.ch===gtxChanFilter) &&
    (gtxDirFilter==="all"  || r.dir===gtxDirFilter)
  )

  const turnsWithData = seedGtxRows.filter(r => r.actualTurn > 0)
  const gtxKpis = {
    total:     seedGtxRows.length,
    road:      seedGtxRows.filter(r=>r.ch==="road").length,
    sea:       seedGtxRows.filter(r=>r.ch==="sea").length,
    rail:      seedGtxRows.filter(r=>r.ch==="rail").length,
    avgTurn:   (turnsWithData.reduce((s,r)=>s+r.actualTurn,0)/Math.max(1,turnsWithData.length)).toFixed(1),
    completed: seedGtxRows.filter(r=>r.visit.state==="GATE_OUT").length,
    withHold:  seedGtxRows.filter(r=>r.gsRow?.hold).length,
  }

  const pickableContainers = backendContainers.filter(c=>c.status==="in_transit"||c.status==="yard")
  const selVisit: Visit = visits.find(v=>v.id===sel)||visits[0]
  const idx = (v:Visit)=>STEPS.indexOf(v.state)
  const apptData = appointments.find(a=>a.window===apptSel)||appointments[0]
  if (!selVisit) return null

  const isPickup = /pickup|retrieval/i.test(selVisit.purpose)
  const pickupContainer = isPickup ? containers.find(c=>c.id===selVisit.container)??null : null
  const rehandleCheck = pickupContainer ? computeRehandleCost(pickupContainer.address,containers) : null

  // ── Step 2: Lane summary ──────────────────────────────────────────────────
  const laneCountsByState = lanes.reduce<Record<string,number>>((acc,l) => {
    acc[l.state] = (acc[l.state]||0)+1; return acc
  }, {})
  const laneSummaryParts = [
    `${lanes.length} lanes`,
    laneCountsByState.free ? `${laneCountsByState.free} free` : null,
    laneCountsByState.occupied ? `${laneCountsByState.occupied} occupied` : null,
    (laneCountsByState.assigned||0)+(laneCountsByState.loading||0)+(laneCountsByState.staged||0)+(laneCountsByState.clearing||0)
      ? `${(laneCountsByState.assigned||0)+(laneCountsByState.loading||0)+(laneCountsByState.staged||0)+(laneCountsByState.clearing||0)} in use` : null,
  ].filter(Boolean).join(" · ")

  // ── Yard Ready helper ────────────────────────────────────────────────────
  function visitYardReady(v: Visit): 'green' | 'amber' | 'red' | 'na' {
    // Pre-staged: already sitting in a staging lane
    if (v.lane.startsWith('S-')) return 'green'
    // Only outbound pickups need a pre-staging readiness check
    if (!/pickup|retrieval/i.test(v.purpose)) return 'na'
    // Look up the container address and count blocking units
    const cont = containers.find(c => c.id === v.container)
    if (!cont) return 'amber'
    const check = computeRehandleCost(cont.address, containers)
    return check.accessible ? 'amber' : 'red'
  }

  // ── AT_POSITION transition handler ───────────────────────────────────────
  async function handleAtPosition() {
    if (atPositioning || atPositionDone) return
    setAtPositioning(true)
    try {
      const now  = new Date()
      const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`
      await backendApi.patchVisit(selVisit.id, { state: "AT_POSITION", at_position: time })
      await refresh(["visits"])
      setAtPositionDone(true)
    } catch (err) {
      console.error("[GateConsole] at-position failed:", err)
    } finally {
      setAtPositioning(false)
    }
  }

  // ── Step 3: Column helpers ────────────────────────────────────────────────
  function toggleVisitCol(col: VisitCol) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(col)) { if (next.size > 1) next.delete(col) }
      else next.add(col)
      return next
    })
  }

  // ── Step 4: Check-in handler ──────────────────────────────────────────────
  async function handleCheckIn() {
    if (checkingIn||checkInDone) return
    setCheckingIn(true)
    try {
      const now=new Date()
      const time=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`
      const freeLane=lanes.find(l=>l.state==="free")
      await backendApi.patchVisit(selVisit.id,{state:"CHECKED_IN",check_in:time,lane_id:freeLane?.id??(selVisit.lane||null)})
      if (freeLane) {
        await backendApi.patchLane(freeLane.id,{state:"occupied",visit_id:selVisit.id,since:time})
      }
      await refresh(["visits","lanes"])
      setCheckInDone(true)
    } catch (err) {
      console.error("[GateConsole] check-in failed:",err)
      // intentionally NOT setting checkInDone — let the user retry
    }
    finally { setCheckingIn(false) }
  }

  // ── Step 4: Accordion header ──────────────────────────────────────────────
  function AccordionHeader({ label, open, onToggle, count }: { label:string; open:boolean; onToggle:()=>void; count?:string }) {
    return (
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-[#f9fafb] transition-colors"
        style={{ borderTop:"1px solid #e5e7eb" }}>
        <div className="flex items-center gap-2">
          <span className="ds-label font-bold text-neutral-500">{label}</span>
          {count && <span className="text-[10px] text-neutral-400">{count}</span>}
        </div>
        <span style={{ fontSize:9, color:"#9ca3af" }}>{open?"▲":"▼"}</span>
      </button>
    )
  }

  // ── Dark-mode colour tokens (computed inline to avoid global CSS) ─────────
  const dk = darkMode
  const C = {
    pageBg:       dk ? "#0f1117" : "#f4f5f7",
    surface0:     dk ? "#1a1d27" : "#ffffff",
    surface1:     dk ? "#222533" : "#f9fafb",
    surface2:     dk ? "#2a2e3f" : "#f3f4f6",
    border:       dk ? "rgba(255,255,255,0.08)" : "#e5e7eb",
    borderMid:    dk ? "rgba(255,255,255,0.12)" : "#d1d5db",
    text:         dk ? "#f1f5f9" : "#111827",
    textMuted:    dk ? "#8b95a8" : "#6b7280",
    textDim:      dk ? "#4a5568" : "#9ca3af",
    dangerBg:     dk ? "rgba(220,38,38,0.18)" : "#fef2f2",
    dangerFg:              "#dc2626",
    dangerBorder: dk ? "rgba(220,38,38,0.35)" : "#fecaca",
    warnBg:       dk ? "rgba(217,119,6,0.18)"  : "#fffbeb",
    warnFg:                "#d97706",
    warnBorder:   dk ? "rgba(217,119,6,0.35)"  : "#fde68a",
    successBg:    dk ? "rgba(5,150,105,0.18)"  : "#f0fdf4",
    successFg:             "#059669",
    accentBg:     dk ? "rgba(37,99,235,0.18)"  : "#eff6ff",
    accentFg:              "#2563eb",
    purpleBg:     dk ? "rgba(124,58,237,0.18)" : "#faf5ff",
    purpleFg:              "#7c3aed",
    amberBg:      dk ? "rgba(217,119,6,0.15)"  : "#fffbeb",
    amberFg:               "#d97706",
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto" style={{ background: C.pageBg, color: C.text }}>

      {/* ── Breadcrumb + header row ─────────────────────────────────────────── */}
      <div className="flex-none" style={{ background: C.surface0, borderBottom: `1px solid ${C.border}` }}>
        {/* Breadcrumb */}
        <div className="px-5 pt-3 pb-1 flex items-center gap-1.5" style={{ fontSize:11, color: C.textDim }}>
          <span>Operations</span>
          <span style={{ color: C.textDim }}>/</span>
          <span style={{ color: C.textMuted, fontWeight:500 }}>Gate &amp; Appointments</span>
        </div>
        {/* Title row */}
        <div className="px-5 pb-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse inline-block" />
            <span style={{ fontWeight:600, fontSize:15, letterSpacing:"-0.3px", color: C.text }}>Gate &amp; Appointments</span>
          </div>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: C.textMuted }}>{utcTime} UTC</span>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* Language toggle */}
            <div className="flex rounded overflow-hidden" style={{ border:`1px solid ${C.border}` }}>
              {(["en","es"] as const).map(l => (
                <button key={l} onClick={()=>setLang(l)}
                  className="px-2.5 py-1 text-[11px] font-semibold uppercase transition-colors"
                  style={{ background: lang===l ? "#111827" : C.surface1, color: lang===l ? "#fff" : C.textMuted }}>
                  {l}
                </button>
              ))}
            </div>
            {/* Refresh */}
            <button onClick={()=>refresh(["visits","lanes","containers"])}
              className="ds-btn ds-btn-ghost flex items-center gap-1"
              style={{ color: C.textMuted }}>
              ↺ Refresh
            </button>
            {/* Dark mode */}
            <button onClick={()=>setDarkMode(d=>!d)}
              className="ds-btn ds-btn-ghost"
              style={{ color: C.textMuted }}>
              {darkMode ? "☀ Light" : "☾ Dark"}
            </button>
            {/* Primary CTA */}
            {tab==="gtx"&&backendConnected ? (
              <button onClick={()=>setShowGateInForm(f=>!f)}
                className="ds-btn ds-btn-primary">
                {showGateInForm?t("common.cancel"):t("gate.gateIn")}
              </button>
            ) : (
              <button onClick={handleCheckIn} disabled={checkingIn}
                className="ds-btn ds-btn-primary" style={{ opacity:checkingIn?0.5:1 }}>
                {checkInDone?"✓ Served · pass issued":checkingIn?t("gate.checkingIn"):"Check in next"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <TabBar
        items={[
          { id: "visits",    label: t("gate.tab.visits")                       },
          { id: "inbound",   label: t("gate.tab.inbound",   inboundRows.length)  },
          { id: "outbound",  label: t("gate.tab.outbound",  outboundRows.length) },
          { id: "gtx",       label: t("gate.tab.transactions")                 },
          { id: "inspection",label: t("gate.tab.inspection")                   },
        ]}
        active={tab}
        onChange={id => { setTab(id as typeof tab); setFilterPill("all"); setSearchQuery("") }}
      />

      {/* ── KPI stat cards — shown for inbound / outbound tabs ──────────────── */}
      {(tab === "inbound" || tab === "outbound") && (() => {
        const isOut = tab === "outbound"

        const ibTotal    = inboundRows.length
        const ibCleared  = inboundRows.filter(r => r.channel === "road" && !r.hold).length
        const ibHolds    = inboundRows.filter(r => r.hold).length
        const ibLfdRisk  = inboundRows.filter(r => r.hoursToLFD < 24 && r.hoursToLFD >= 0).length
        const ibBreached = inboundRows.filter(r => r.hoursToLFD < 0).length
        const ibHoldTypes = (() => {
          const types: Record<string,number> = {}
          inboundRows.forEach(r => { if (r.hold) types[r.hold] = (types[r.hold]||0)+1 })
          return Object.entries(types).map(([k,n])=>`${n} ${k}`).join(" · ") || "none"
        })()

        const obTotal    = outboundRows.length
        const obGateOut  = outboundRows.filter(r => r.gateStatus === "GATE_OUT").length
        const obPending  = obTotal - obGateOut
        const obFlagged  = outboundRows.filter(r => r.excl || r.hold).length
        const obBreached = outboundRows.filter(r => r.hoursToLFD < 0).length
        const obHolds    = outboundRows.filter(r => r.hold).length

        type Card = { label:string; value:string; sub:string; variant:"normal"|"danger"|"warning" }
        const cards: Card[] = isOut ? [
          { label:"Dispatching today",   value:String(obTotal),    sub:`${obPending} still pending`,     variant:"normal"  },
          { label:"Gate-out complete",   value:String(obGateOut),  sub:`${obPending} awaiting gate-out`, variant:"normal"  },
          { label:"LFD at risk",         value:String(obBreached), sub:"detention accruing now",         variant: obBreached>0?"danger":"normal" },
          { label:"Holds active",        value:String(obHolds+obFlagged), sub:"clearance flags",         variant: (obHolds+obFlagged)>0?"warning":"normal" },
        ] : [
          { label:"Arriving today",      value:String(ibTotal),    sub:`${ibTotal} booked`,              variant:"normal"  },
          { label:"Cleared to receive",  value:String(ibCleared),  sub:`${ibHolds} on hold`,             variant: ibHolds>0?"warning":"normal" },
          { label:"LFD at risk",         value:String(ibLfdRisk+ibBreached), sub:"within 24 h — act now",variant: (ibLfdRisk+ibBreached)>0?"danger":"normal" },
          { label:"Holds active",        value:String(ibHolds),    sub:ibHoldTypes,                      variant: ibHolds>0?"warning":"normal" },
        ]

        const cardBg  = (v: Card["variant"]) =>
          v==="danger"  ? C.dangerBg  :
          v==="warning" ? C.warnBg    : C.surface0
        const cardBorder = (v: Card["variant"]) =>
          v==="danger"  ? C.dangerBorder  :
          v==="warning" ? C.warnBorder    : C.border
        const valColor = (v: Card["variant"]) =>
          v==="danger"  ? C.dangerFg  :
          v==="warning" ? C.warnFg    : C.text

        return (
          <div className="flex-none grid grid-cols-4 gap-3 px-5 py-3"
            style={{ background: C.pageBg, borderBottom:`1px solid ${C.border}` }}>
            {cards.map(card => (
              <div key={card.label} className="flex flex-col gap-1 rounded-[10px]"
                style={{ padding:"14px 16px", background: cardBg(card.variant), border:`1px solid ${cardBorder(card.variant)}` }}>
                <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.5px", textTransform:"uppercase", color: C.textMuted }}>{card.label}</span>
                <span style={{ fontSize:26, fontWeight:600, fontFamily:"var(--font-mono)", lineHeight:1, letterSpacing:"-0.5px", color: valColor(card.variant) }}>{card.value}</span>
                <span style={{ fontSize:12, fontWeight:400, color: C.textDim }}>{card.sub}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── Legacy KPI bar — only for other tabs (visits / gtx / appts) ─────── */}
      {(tab !== "inbound" && tab !== "outbound") && dbLoading && (
        <div className="flex-none border-b border-[#e5e7eb] bg-white">
          <div className="flex items-stretch">
            {[0,1,2].map(i => <Skeleton key={i} variant="kpi" />)}
          </div>
        </div>
      )}

      {/* ════════════════════ VISITS TAB ════════════════════ */}
      {tab==="visits" && (
        <div className="grid flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns:"minmax(420px,1fr) clamp(280px,28vw,380px)" }}>
          <div className="flex flex-col min-h-0 overflow-auto bg-white">

            {/* ── Step 2: Lane summary / expandable cards ────────────────── */}
            <div className="flex items-center gap-2.5 px-4 py-2 border-b border-[#e5e7eb]">
              <span className="ds-label text-neutral-500">{t("gate.lanes")}</span>
              <span className="text-[11.5px] text-neutral-700 font-medium">{laneSummaryParts}</span>
              <button onClick={()=>setLanesExpanded(v=>!v)}
                className="ml-auto text-[11px] px-2.5 py-1 text-neutral-500 hover:text-neutral-800"
                style={{ border:"1px solid #e5e7eb", borderRadius:5 }}>
                {lanesExpanded?t("gate.hideLanes"):t("gate.showLanes")}
              </button>
            </div>
            {/* Lane cards — expandable */}
            <div style={{ overflow:"hidden", maxHeight:lanesExpanded?160:0, transition:"max-height 200ms ease" }}>
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-[#e5e7eb]">
                {lanes.map(l => {
                  const st=LANE_STYLE[l.state]||LANE_STYLE.free
                  return (
                    <div key={l.id} className="border px-2 py-1 min-w-[86px]"
                      style={{ background:st[0], borderColor:st[1], color:st[2], borderRadius:5 }}>
                      <div className="text-[11px] font-bold font-mono">{l.id}</div>
                      <div className="text-[10px] opacity-80">{l.state+(l.visit?" · "+l.visit:"")}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Step 3: Visit table with column chooser ────────────────── */}
            {/* Table toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e5e7eb] flex-none">
              <span className="text-[11px] text-neutral-500"><span className="font-mono">{visits.length}</span> visits active</span>
              <div ref={colChooserRef} className="relative ml-auto">
                <button onClick={()=>setColChooserOpen(v=>!v)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#374151]"
                  style={{ border:"1px solid #e5e7eb", borderRadius:5 }}>
                  Columns <span style={{ fontSize:8 }}>{colChooserOpen?"▲":"▼"}</span>
                </button>
                {colChooserOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 bg-white"
                    style={{ border:"1px solid #e5e7eb", borderRadius:5, boxShadow:"0 4px 12px rgba(0,0,0,0.10)", padding:"6px 0", minWidth:150 }}>
                    {VISIT_COLS.map(col => (
                      <label key={col} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#f9fafb] text-[11px]">
                        <input type="checkbox" checked={visibleCols.has(col)} onChange={()=>toggleVisitCol(col)} className="accent-[#111827]" />
                        {VISIT_COL_LABELS[col]}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full border-collapse" style={{ fontSize:11 }}>
                <thead>
                  <tr>
                    {visibleCols.has("TRUCK")      && <th className="ds-th text-left">{t("gate.col.truck")}</th>}
                    {visibleCols.has("LIFECYCLE") && <th className="ds-th text-left">{t("gate.col.lifecycle")}</th>}
                    {visibleCols.has("TURN")      && <th className="ds-th text-left">{t("gate.col.turn")}</th>}
                    {visibleCols.has("YARD_READY")&& <th className="ds-th text-left">{t("gate.col.yardReady")}</th>}
                    {visibleCols.has("PURPOSE")   && <th className="ds-th text-left">{t("gate.col.purpose")}</th>}
                    {visibleCols.has("CONTAINER") && <th className="ds-th text-left">{t("gate.col.container")}</th>}
                    {visibleCols.has("APPT")      && <th className="ds-th text-left">{t("gate.col.appt")}</th>}
                    {visibleCols.has("EXCLUSION") && <th className="ds-th text-left">{t("gate.col.exclusion")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {dbLoading && visits.length === 0 ? (
                    Array.from({length:5},(_,i) => (
                      <tr key={`sk-${i}`}><td colSpan={visibleCols.size} className="px-4 py-1"><Skeleton variant="row" /></td></tr>
                    ))
                  ) : !dbLoading && visits.length === 0 ? (
                    <tr><td colSpan={visibleCols.size} className="px-4 py-4 text-[11px] text-neutral-400">No visits found.</td></tr>
                  ) : visits.map(v=>(
                    <tr key={v.id} onClick={()=>setSel(v.id)}
                      className="cursor-pointer hover:bg-[#f9fafb] border-b border-[#f3f4f6] transition-colors"
                      style={{ background:v.id===sel?"#fef2f2":undefined, minHeight:44 }}>
                      {/* TRUCK */}
                      {visibleCols.has("TRUCK") && (
                        <td className="py-2.5 pl-4 pr-2" style={{ borderLeft:`3px solid ${v.id===sel?"#dc2626":v.excl?"#d97706":"transparent"}` }}>
                          <div className="font-bold font-mono">{v.plate}</div>
                          <div className="text-[10px] text-neutral-500 font-mono">{v.id} · {v.carrier}</div>
                        </td>
                      )}
                      {/* LIFECYCLE / STATE */}
                      {visibleCols.has("LIFECYCLE") && (
                        <td className="px-2 py-2.5">
                          <div className="flex gap-0.5 items-center">
                            {STEPS.slice(1).map((st,i)=>(
                              <span key={st} title={st} className="w-3 h-1.5 inline-block"
                                style={{ background:i<idx(v)-1?"#111827":i===idx(v)-1?"#dc2626":"#e5e7eb" }} />
                            ))}
                          </div>
                          <div className="text-[10px] text-neutral-500 mt-0.5">{stateLabel(v.state)}</div>
                        </td>
                      )}
                      {/* TURN */}
                      {visibleCols.has("TURN") && (
                        <td className={`px-2 py-2.5 font-mono font-bold ${v.turn>=15?"text-[#dc2626]":""}`}>{v.turn?v.turn+"′":"—"}</td>
                      )}
                      {/* YARD READY */}
                      {visibleCols.has("YARD_READY") && (() => {
                        const yr = visitYardReady(v)
                        const cfg = {
                          green: { dot:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0", label: t("gate.yardReady.green") },
                          amber: { dot:"#d97706", bg:"#fffbeb", border:"#fde68a", label: t("gate.yardReady.amber") },
                          red:   { dot:"#dc2626", bg:"#fef2f2", border:"#fecaca", label: t("gate.yardReady.red")   },
                          na:    { dot:"#9ca3af", bg:"transparent", border:"transparent", label: "—" },
                        }[yr]
                        return (
                          <td className="px-2 py-2.5">
                            {yr === 'na' ? <span className="text-neutral-400 text-[10.5px]">—</span> : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ background: cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:4 }}>
                                <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: cfg.dot }} />
                                {cfg.label}
                              </span>
                            )}
                          </td>
                        )
                      })()}
                      {/* PURPOSE */}
                      {visibleCols.has("PURPOSE") && (
                        <td className="px-2 py-2.5" style={{ fontSize:11 }}>{v.purpose}</td>
                      )}
                      {/* CONTAINER */}
                      {visibleCols.has("CONTAINER") && (
                        <td className="px-2 py-2.5 font-mono" style={{ fontSize:11 }}>{v.container}</td>
                      )}
                      {/* APPT */}
                      {visibleCols.has("APPT") && (
                        <td className="px-2 py-2.5 font-mono" style={{ fontSize:11 }}>{v.appt}</td>
                      )}
                      {/* EXCLUSION */}
                      {visibleCols.has("EXCLUSION") && (
                        <td className="px-2 py-2.5 text-[10.5px] text-[#dc2626] leading-tight">{v.excl||""}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Detail panel — Step 4: progressive ───────────────────────── */}
          <div className="flex flex-col min-h-0 overflow-auto bg-white" style={{ borderLeft:"1px solid #e5e7eb" }}>
            <div className="px-4 pt-4 pb-3">
              <div className="ds-label text-neutral-500"><span className="font-mono">{selVisit.id}</span> · {selVisit.purpose}</div>
              <div className="font-semibold text-[17px] mt-1 tracking-tight font-mono">{selVisit.plate}</div>
              <div className="text-[12px] text-neutral-600 mt-0.5">
                {selVisit.carrier} · {selVisit.driver} · lane <span className="font-mono">{selVisit.lane}</span>
                {selVisit.stagingLane && (
                  <> · staging <span className="font-mono font-semibold" style={{ color:"#16a34a" }}>{selVisit.stagingLane}</span></>
                )}
              </div>
              {/* Yard Ready badge */}
              {(() => {
                const yr = visitYardReady(selVisit)
                if (yr === 'na') return null
                const cfg = {
                  green: { dot:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0", text:"#15803d", label: t("gate.yardReady.green"), desc: t("gate.yardReady.greenDesc") },
                  amber: { dot:"#d97706", bg:"#fffbeb", border:"#fde68a", text:"#92400e", label: t("gate.yardReady.amber"), desc: t("gate.yardReady.amberDesc") },
                  red:   { dot:"#dc2626", bg:"#fef2f2", border:"#fecaca", text:"#991b1b", label: t("gate.yardReady.red"),   desc: t("gate.yardReady.redDesc")   },
                }[yr]
                return (
                  <div className="flex items-start gap-2 mt-2 px-3 py-2 text-[11.5px]"
                    style={{ background: cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:5, color: cfg.text }}>
                    <span className="w-2 h-2 rounded-full flex-none mt-0.5" style={{ background: cfg.dot }} />
                    <div>
                      <span className="font-semibold">{t("gate.col.yardReady")}: {cfg.label}</span>
                      <span className="ml-2 font-normal opacity-80">{cfg.desc}</span>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Step 4: Lifecycle timeline — always visible */}
            <div className="border-t border-[#e5e7eb]">
              {[
                {k:"Queue geofence (t₀)", v:selVisit.queueIn},
                {k:"Check-in",            v:selVisit.checkIn},
                {k:"At position",         v:selVisit.atPosition},
                {k:"Served",              v:selVisit.served},
                {k:"Barrier release (t₁)",v:selVisit.gateOut},
                {k:"Turn time",           v:selVisit.turn?selVisit.turn+" min":"running"},
              ].map((t,i)=>(
                <div key={t.k} className="flex gap-3 items-baseline px-4 py-2 border-b border-[#f3f4f6] text-[11.5px]">
                  <span className="w-2 h-2 flex-none inline-block"
                    style={{ background:!t.v?"#e5e7eb":i===5?"#dc2626":"#1f2937", borderRadius:2 }} />
                  <span className="flex-1" style={{ color:!t.v?"#6b7280":"#111827" }}>{t.k}</span>
                  <span className="font-mono font-semibold" style={{ color:!t.v?"#6b7280":"#111827" }}>{t.v||"—"}</span>
                </div>
              ))}
            </div>

            {/* Step 4: Interchange receipt — accordion */}
            <AccordionHeader label="Interchange receipt" open={receiptOpen} onToggle={()=>setReceiptOpen(v=>!v)} />
            <div style={{ overflow:"hidden", maxHeight:receiptOpen?200:0, transition:"max-height 200ms ease" }}>
              <div className="px-4 py-2">
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    {k:"Direction",    v:selVisit.purpose.includes("Empty")?"Gate-out":"Gate-in",  red:false},
                    {k:"Seal",         v:"AR"+(400000+selVisit.turn*137),                           red:false},
                    {k:"Condition",    v:selVisit.excl?"Incomplete":"Sound",                        red:!!selVisit.excl},
                    {k:"Acknowledged", v:selVisit.excl?"Pending driver":"Driver + clerk",           red:false},
                  ].map(e=>(
                    <div key={e.k} className="border border-[#e5e7eb] px-2 py-1.5 min-w-[90px]" style={{ borderRadius:5 }}>
                      <div className="ds-label text-neutral-500">{e.k}</div>
                      <div className={`text-[11.5px] font-semibold ${e.red?"text-[#dc2626]":""}`}>{e.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 4: EIR photos — accordion */}
            <AccordionHeader label="EIR photos" open={eirPhotosOpen} onToggle={()=>setEirPhotosOpen(v=>!v)} count={eirDone?"4 captured":undefined} />
            <div style={{ overflow:"hidden", maxHeight:eirPhotosOpen?140:0, transition:"max-height 200ms ease" }}>
              <div className="px-4 py-2">
                <div className="flex gap-1">
                  {["front","left","right","rear"].map(p=>(
                    <div key={p} className="flex-1 h-11 border-2 border-dashed flex flex-col items-center justify-center gap-0.5"
                      style={{ background:eirDone?"#f0fdf4":"transparent", borderColor:eirDone?"#059669":"#d1d5db", borderRadius:5 }}>
                      <span className="text-[9px] text-neutral-500 capitalize">{p}</span>
                      {eirDone && <span className="text-[8px]" style={{ color:"#059669" }}>✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Yard accessibility (pickup visits) — unchanged */}
            {rehandleCheck && (
              <>
                <div className="px-4 pt-3 pb-1.5 ds-label text-neutral-500 font-bold" style={{ borderTop:"1px solid #e5e7eb" }}>Yard accessibility</div>
                <div className="px-4 pb-3 flex flex-col gap-2">
                  <div className="text-[11.5px] text-[#374151]">Container at <span className="font-mono">{pickupContainer!.address}</span></div>
                  {rehandleCheck.accessible ? (
                    <div className="flex items-start gap-2 px-3 py-2 text-[11.5px]" style={{ background:"#f0fdf4", border:"1px solid #059669", borderRadius:5, color:"#065f46" }}>
                      <span className="font-bold leading-none mt-px">✓</span><span>Direct access — no rehandles required</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 px-3 py-2 text-[11.5px]" style={{ background:"#fffbeb", border:"1px solid #d97706", borderRadius:5, color:"#92400e" }}>
                      <span className="font-bold leading-none mt-px">▲</span>
                      <div>
                        <div className="font-semibold">{rehandleCheck.rehandles} rehandle{rehandleCheck.rehandles!==1?"s":""} required<span className="font-normal ml-2">≈ {(rehandleCheck.rehandles*4.8).toFixed(0)}′ added</span></div>
                        <div className="mt-1 text-[10.5px] leading-relaxed">Blocking: {rehandleCheck.blocking.map(c=><span key={c.id} className="font-mono mr-1.5">{c.id}</span>)}</div>
                      </div>
                    </div>
                  )}
                  {rehandleCheck.rehandles>2 && (
                    <div className="px-3 py-2.5 text-[11.5px] leading-snug" style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:5, color:"#991b1b" }}>
                      <span className="font-bold">This pickup requires {rehandleCheck.rehandles} rehandles.</span> Consider staging first or notify the planner.
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Step 4: Actions — primary + more actions dropdown */}
            <div className="px-4 pt-3 pb-4" style={{ borderTop:"1px solid #e5e7eb" }}>
              {/* Primary action — Gate-in */}
              <div className="ds-label text-neutral-400 mb-1.5">Gate-in</div>
              <button className="w-full text-[11.5px] text-left px-3 py-2.5 font-semibold mb-1"
                style={{ background:"#111827", color:"#fff", borderRadius:5 }}
                onClick={handleCheckIn} disabled={checkingIn}>
                {checkInDone?"✓ Checked in and assigned to lane":checkingIn?t("gate.checkingIn"):"Check in and assign lane"}
              </button>
              {checkInDone && (
                <div className="text-[10px] font-semibold text-[#059669] mb-1.5 px-0.5">EDI 322 sent ✓</div>
              )}
              {/* AT_POSITION action — shown once checked in */}
              {(selVisit.state === "CHECKED_IN" || checkInDone) && (() => {
                const yr = visitYardReady(selVisit)
                const blocked = yr === 'red'
                return (
                  <div className="mt-2 mb-1">
                    <div className="ds-label text-neutral-400 mb-1.5">At position</div>
                    {blocked ? (
                      <div className="px-3 py-2.5 text-[11.5px] leading-snug"
                        style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:5, color:"#991b1b" }}>
                        <div className="font-semibold mb-0.5">⛔ {t("gate.yardReady.red")} — {t("gate.atPositionBlocked")}</div>
                        <div className="text-[10.5px] font-normal" style={{ color:"#dc2626" }}>{t("gate.atPositionBlockedDesc")}</div>
                      </div>
                    ) : (
                      <button className="w-full text-[11.5px] text-left px-3 py-2.5 font-semibold"
                        style={{
                          background: atPositionDone ? "#059669" : "#1d4ed8",
                          color:"#fff", borderRadius:5,
                          opacity: atPositioning ? 0.5 : 1,
                          cursor: atPositionDone ? "default" : "pointer",
                        }}
                        onClick={handleAtPosition} disabled={atPositioning || atPositionDone}>
                        {atPositionDone ? "✓ At position — processing started" : atPositioning ? "Moving to position…" : "Mark at position"}
                      </button>
                    )}
                  </div>
                )
              })()}
              {/* More actions dropdown */}
              <div ref={moreActionsRef} className="relative">
                <button onClick={()=>setMoreActionsOpen(v=>!v)}
                  className="w-full text-[11.5px] text-left px-3 py-2 font-semibold flex items-center justify-between"
                  style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:5 }}>
                  <span>More actions</span>
                  <span style={{ fontSize:9 }}>{moreActionsOpen?"▲":"▼"}</span>
                </button>
                {moreActionsOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white flex flex-col"
                    style={{ border:"1px solid #e5e7eb", borderRadius:5, boxShadow:"0 4px 12px rgba(0,0,0,0.10)", overflow:"hidden" }}>
                    <button className="text-[11.5px] text-left px-3 py-2.5 font-semibold hover:bg-[#f9fafb] transition-colors"
                      style={{ color:"#374151", borderBottom:"1px solid #f3f4f6" }}
                      onClick={()=>{ setEirDone(true); setMoreActionsOpen(false) }}>
                      {eirDone?"✓ EIR photos captured · 4 attached":"Capture EIR photos"}
                    </button>
                    <button className="text-[11.5px] text-left px-3 py-2.5 font-semibold hover:bg-[#f9fafb] transition-colors"
                      style={{ color:"#374151", borderBottom:exclOpen?"1px solid #f3f4f6":"none" }}
                      onClick={()=>{ setExclOpen(o=>!o); setMoreActionsOpen(false) }}>
                      {exclReason?`✓ Exclusion: ${exclReason}`:"Record exclusion reason"}
                    </button>
                  </div>
                )}
              </div>
              {exclOpen && !exclReason && (
                <div className="border border-[#e5e7eb] p-2 flex flex-col gap-1 mt-2" style={{ background:"#f9fafb", borderRadius:5 }}>
                  <div className="ds-label text-neutral-500 mb-1">Select reason</div>
                  {EXCL_REASONS.map(r=>(
                    <button key={r} onClick={()=>{ setExclReason(r); setExclOpen(false) }}
                      className="text-left px-2 py-2 text-[11.5px] transition-colors"
                      style={{ background:"white", border:"1px solid #e5e7eb", borderRadius:5, color:"#374151" }}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-neutral-500 leading-relaxed mt-2">
                {selVisit.excl
                  ? "Excluded time is measured and shown against the visit — not removed from the record."
                  : `Pre-staged outbound: container already on ground at ${selVisit.lane}.`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ GATE TRANSACTIONS TAB ════════════════════ */}
      {tab==="gtx" && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-[#f8f9fa]">

          {/* ── Summary KPI strip ─────────────────────────────────────────── */}
          <div className="flex flex-none border-b border-[#e5e7eb] bg-white">
            {[
              { k:"Visits today",  v:String(gtxKpis.total),     sub:"all states",                color:undefined },
              { k:"Completed",     v:String(gtxKpis.completed), sub:"gate-out issued",           color:undefined },
              { k:"Road",          v:String(gtxKpis.road),      sub:"road transport",            color:"#16a34a" },
              { k:"Sea",           v:String(gtxKpis.sea),       sub:"sea freight",               color:"#2563eb" },
              { k:"Rail",          v:String(gtxKpis.rail),      sub:"rail / intermodal",         color:"#7c3aed" },
              { k:"Holds",         v:String(gtxKpis.withHold),  sub:"action required",           color:gtxKpis.withHold>0?"#dc2626":undefined },
              { k:"Avg turn",      v:`${gtxKpis.avgTurn}′`,     sub:"queue-in → gate-out",       color:parseFloat(gtxKpis.avgTurn)>15?"#dc2626":parseFloat(gtxKpis.avgTurn)>10?"#d97706":undefined },
            ].map(m => (
              <div key={m.k} className="flex-1 px-4 py-2.5 flex flex-col gap-0.5 border-r border-[#e5e7eb]">
                <span className="ds-label text-neutral-500">{m.k}</span>
                <span className="font-mono font-bold text-[22px] leading-none" style={{ color:m.color }}>{m.v}</span>
                <span className="text-[10px] text-neutral-400">{m.sub}</span>
              </div>
            ))}
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-5 py-2 border-b border-[#e5e7eb] bg-white flex-none">
            <span className="text-[10.5px] font-semibold text-neutral-400 tracking-wide">CHANNEL</span>
            {(["all","road","sea","rail"] as const).map(ch => (
              <button key={ch} onClick={()=>setGtxChanFilter(ch)}
                className="text-[11px] px-2.5 py-1 font-semibold rounded capitalize transition-colors"
                style={{
                  background: gtxChanFilter===ch ? (ch==="all"?"#111827":(CHAN_COLOR as Record<string,[string,string]>)[ch]?.[0]??"#f3f4f6") : "#f3f4f6",
                  color:      gtxChanFilter===ch ? (ch==="all"?"#fff":(CHAN_COLOR as Record<string,[string,string]>)[ch]?.[1]??"#374151") : "#6b7280",
                  border:     `1px solid ${gtxChanFilter===ch ? (ch==="all"?"#111827":(CHAN_COLOR as Record<string,[string,string]>)[ch]?.[1]??"#d1d5db") : "#e5e7eb"}`,
                }}>
                {ch==="all"?"All channels":ch}
              </button>
            ))}
            <span className="text-[10.5px] font-semibold text-neutral-400 tracking-wide ml-4">DIRECTION</span>
            {(["all","IN","OUT","EMPTY"] as const).map(d => (
              <button key={d} onClick={()=>setGtxDirFilter(d)}
                className="text-[11px] px-2.5 py-1 font-semibold rounded transition-colors"
                style={{
                  background: gtxDirFilter===d?"#111827":"#f3f4f6",
                  color:      gtxDirFilter===d?"#fff":"#6b7280",
                  border:     `1px solid ${gtxDirFilter===d?"#111827":"#e5e7eb"}`,
                }}>
                {d==="all"?"All":d==="IN"?t("gate.purpose.inbound"):d==="OUT"?t("gate.purpose.outbound"):t("gate.purpose.empty")}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-neutral-400">{filteredGtxRows.length} of {seedGtxRows.length} visits</span>

            {/* Backend gate-in button (only when connected) */}
            {backendConnected && (
              <button onClick={()=>setShowGateInForm(f=>!f)}
                className="text-[11px] px-3 py-1.5 font-semibold"
                style={{ background:"#111827", color:"#fff", borderRadius:5 }}>
                {showGateInForm?t("common.cancel"):`+ ${t("gate.gateIn")}`}
              </button>
            )}
          </div>

          {/* ── Backend gate-in form (when connected) ─────────────────────── */}
          {backendConnected && showGateInForm && (
            <div className="mx-5 mt-3 border border-[#e5e7eb] px-5 py-4 flex-none bg-white" style={{ borderRadius:5 }}>
              <div className="ds-label text-neutral-500 font-bold mb-3">Record gate in</div>
              <div className="grid gap-3" style={{ gridTemplateColumns:"1fr 1fr" }}>
                <div className="col-span-2">
                  <label className="ds-label text-neutral-500 block mb-1">{t("gate.container")}</label>
                  <ContainerPicker containers={pickableContainers} value={gateInContId} onChange={(id)=>setGateInContId(id)} placeholder="Search container number…" />
                </div>
                <div>
                  <label className="ds-label text-neutral-500 block mb-1">Truck plate</label>
                  <input type="text" placeholder="e.g. AB 123 CD" value={gateInPlate} onChange={e=>setGateInPlate(e.target.value)}
                    className="w-full border border-[#e5e7eb] px-2 py-1.5 text-[12px] font-mono" style={{ borderRadius:5 }} />
                </div>
                <div>
                  <label className="ds-label text-neutral-500 block mb-1">Driver ref</label>
                  <input type="text" placeholder="Driver ID or name" value={gateInDriver} onChange={e=>setGateInDriver(e.target.value)}
                    className="w-full border border-[#e5e7eb] px-2 py-1.5 text-[12px]" style={{ borderRadius:5 }} />
                </div>
                <div className="col-span-2">
                  <label className="ds-label text-neutral-500 block mb-1">Carrier ref</label>
                  <input type="text" placeholder="Booking or carrier reference" value={gateInCarrier} onChange={e=>setGateInCarrier(e.target.value)}
                    className="w-full border border-[#e5e7eb] px-2 py-1.5 text-[12px]" style={{ borderRadius:5 }} />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleGateIn} disabled={submittingGateIn}
                  style={{ background:"#111827", color:"#fff", border:"none", borderRadius:5, fontSize:12, padding:"5px 14px", fontWeight:600, opacity:submittingGateIn?0.5:1 }}>
                  {submittingGateIn?"Submitting…":"Submit gate in"}
                </button>
                <button style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:5, fontSize:12, padding:"5px 14px", fontWeight:600 }}
                  onClick={()=>{ setShowGateInForm(false); setGateInContId(""); setGateInPlate(""); setGateInDriver(""); setGateInCarrier("") }}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          {/* ── Turnaround toast ──────────────────────────────────────────── */}
          {turnaroundToast && (
            <div className="mx-5 mt-3 px-4 py-3 text-[12px] font-semibold flex justify-between items-center flex-none"
              style={{ background:"#f0fdf4", border:"1px solid #059669", color:"#065f46", borderRadius:5 }}>
              <span>✓ {turnaroundToast}</span>
              <button onClick={()=>setTurnaroundToast(null)} className="text-[13px] hover:opacity-70" style={{ color:"#059669" }}>✕</button>
            </div>
          )}

          {/* ── Transaction log table ─────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr style={{ background:"#fff", borderBottom:"2px solid #e5e7eb" }}>
                  {["VISIT", t("gate.container"), t("gate.channel"), "DIRECTION", t("gate.col.purpose"),
                    "QUEUE IN", "CHECK IN", t("gate.gateOut"), "TURN",
                    "TRUCK · DRIVER", "CONSIGNEE", "SEAL #", t("gate.status")].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold tracking-wider text-neutral-400 whitespace-nowrap"
                      style={{ borderBottom:"1px solid #e5e7eb" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredGtxRows.map(({ visit:v, ch, gsRow, actualTurn }) => {
                  const [chanBg, chanFg] = CHAN_COLOR[ch] ?? ["#f3f4f6","#6b7280"]
                  const [stBg,  stFg]   = STATE_STYLE[v.state] ?? ["#f3f4f6","#6b7280"]
                  const isLive  = v.state !== "GATE_OUT" && v.state !== "EXPECTED"
                  const isExcl  = !!(v.excl ?? gsRow?.excl)
                  const lfdH    = gsRow?.hoursToLFD ?? null
                  const lfdColor = lfdH == null ? "#9ca3af" : lfdH < 0 ? "#dc2626" : lfdH < 24 ? "#dc2626" : lfdH < 72 ? "#d97706" : "#059669"
                  const lfdLabel = lfdH == null ? null : lfdH < 0 ? `LFD breached ${Math.abs(lfdH)}h ago` : `LFD ${lfdH}h`
                  return (
                    <tr key={v.id}
                      className="border-b border-[#f3f4f6] transition-colors"
                      style={{ background: v.state==="GATE_OUT" ? "#fafafa" : "#fff" }}
                      onMouseEnter={e=>(e.currentTarget.style.background="#f0f9ff")}
                      onMouseLeave={e=>(e.currentTarget.style.background=v.state==="GATE_OUT"?"#fafafa":"#fff")}>

                      {/* Visit ID */}
                      <td className="px-3 py-2.5 font-mono text-[11px] font-bold text-neutral-400 whitespace-nowrap">{v.id}</td>

                      {/* Container + size + LFD */}
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-bold text-[12px] text-neutral-900">{v.container}</div>
                        {gsRow && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9.5px] text-neutral-400 font-medium">{gsRow.size}</span>
                            {lfdLabel && (
                              <span className="text-[9.5px] font-semibold" style={{ color: lfdColor }}>{lfdLabel}</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Channel pill */}
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold capitalize"
                          style={{ background:chanBg, color:chanFg, border:`1px solid ${chanFg}30` }}>
                          {ch==="road"?"🚛":ch==="sea"?"🚢":"🚂"} {ch==="road"?"Road":ch==="sea"?"Sea":"Rail"}
                        </span>
                      </td>

                      {/* Direction */}
                      <td className="px-3 py-2.5">
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: dirFromPurpose(v.purpose)==="IN"?"#eff6ff":dirFromPurpose(v.purpose)==="OUT"?"#faf5ff":"#f0fdf4", color: dirFromPurpose(v.purpose)==="IN"?"#1d4ed8":dirFromPurpose(v.purpose)==="OUT"?"#6d28d9":"#065f46" }}>
                          {dirFromPurpose(v.purpose)==="IN"?"↓ IN":dirFromPurpose(v.purpose)==="OUT"?"↑ OUT":"⇄ EMPTY"}
                        </span>
                      </td>

                      {/* Purpose */}
                      <td className="px-3 py-2.5 text-[11.5px] text-neutral-700 whitespace-nowrap">{v.purpose}</td>

                      {/* Timestamps */}
                      <td className="px-3 py-2.5 font-mono text-[11.5px] text-neutral-700">{v.queueIn??<span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2.5 font-mono text-[11.5px] text-neutral-700">{v.checkIn??<span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2.5 font-mono text-[11.5px]"
                        style={{ color:v.gateOut?"#059669":isLive?"#d97706":"#9ca3af", fontWeight:v.gateOut?600:400 }}>
                        {v.gateOut??( isLive ? <span style={{color:"#d97706"}}>● running</span> : "—" )}
                      </td>

                      {/* Turn (computed) */}
                      <td className="px-3 py-2.5 font-mono font-bold text-[12px]"
                        style={{ color: actualTurn===0?"#9ca3af":actualTurn>20?"#dc2626":actualTurn>12?"#d97706":"#059669" }}>
                        {actualTurn>0?`${actualTurn}′`:"—"}
                      </td>

                      {/* Truck · Driver */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-mono text-[11.5px] font-semibold">{v.plate}</div>
                        <div className="text-[10.5px] text-neutral-500">{v.driver}</div>
                      </td>

                      {/* Consignee (from gate-seed) */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {gsRow
                          ? <div>
                              <div className="text-[11.5px] text-neutral-800 font-medium">{gsRow.consignee}</div>
                              <div className="text-[10px] text-neutral-400">{gsRow.carrierName}</div>
                            </div>
                          : <span className="text-neutral-300">—</span>}
                      </td>

                      {/* Seal # */}
                      <td className="px-3 py-2.5 font-mono text-[11px] text-neutral-600 whitespace-nowrap">
                        {gsRow?.sealNumber ?? <span className="text-neutral-300">—</span>}
                      </td>

                      {/* Status + hold badge */}
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="ds-badge" style={{ background:stBg, color:stFg }}>
                            {stateLabel(v.state)}
                          </span>
                          {gsRow?.hold && (
                            <span className="ds-badge ds-badge-warning" style={{ marginTop:2 }}>
                              🔒 {gsRow.hold === "customs" ? "Customs hold" : gsRow.hold === "quality" ? "Quality hold" : "Damage hold"}
                            </span>
                          )}
                          {isExcl && (
                            <span className="ds-badge ds-badge-warning" style={{ marginTop:2, maxWidth:160 }}>
                              ⚠ {v.excl ?? gsRow?.excl}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* ── Recent Gate Events (from story seed) ──────────────────────── */}
            <div className="mx-5 mt-5 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="ds-label text-neutral-500 font-bold tracking-widest">RECENT GATE EVENTS</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" }}>
                  live feed
                </span>
              </div>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
                    {["TIME","GATE","TYPE","CONTAINER","CHASSIS","STAGING","SEAL #","NOTE","PLAN REF"].map(h=>(
                      <th key={h} className="px-3 py-1.5 text-left text-[10px] font-bold tracking-wider text-neutral-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STORY_GATE_TXNS.map((txn, i) => {
                    const typeCfg =
                      txn.type === "IN"   ? { bg:"#eff6ff", fg:"#1d4ed8", label:"↓ IN"   } :
                      txn.type === "OUT"  ? { bg:"#f0fdf4", fg:"#16a34a", label:"↑ OUT"  } :
                                            { bg:"#faf5ff", fg:"#7c3aed", label:"⚓ HOOK" }
                    return (
                      <tr key={i} className="border-b border-[#f3f4f6] hover:bg-[#f8faff]">
                        <td className="px-3 py-2 font-mono font-semibold text-[11.5px] text-neutral-800 whitespace-nowrap">{txn.time}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-neutral-500">{txn.gate}</td>
                        <td className="px-3 py-2">
                          <span className="text-[10.5px] font-bold px-2 py-0.5 rounded"
                            style={{ background:typeCfg.bg, color:typeCfg.fg }}>
                            {typeCfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-[11.5px] text-neutral-900">{txn.containerId}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">{txn.chassisId}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-neutral-500">{txn.stagingSlot ?? <span className="text-neutral-300">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">{txn.sealNumber}</td>
                        <td className="px-3 py-2 text-[11px] text-neutral-600 max-w-[200px]">{txn.note}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {txn.planRef
                            ? <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold" style={{ background:"#f3f4f6", color:"#374151" }}>{txn.planRef}</span>
                            : <span className="text-neutral-300">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Backend transactions section — shown additionally when connected */}
            {backendConnected && txGroups.length > 0 && (
              <div className="mt-6 px-5 pb-4">
                <div className="ds-label text-neutral-500 mb-3">LIVE ENGINE TRANSACTIONS</div>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>{[t("gate.container"),t("gate.gateIn"),t("gate.gateOut"),"TURNAROUND",t("gate.plate"),t("gate.driver"),t("gate.carrier"),""].map(h=>(
                      <th key={h} className="ds-th text-left">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {txLoading
                      ? Array.from({length:5},(_,i) => (
                          <tr key={`sk-${i}`}><td colSpan={8} className="px-2 py-1"><Skeleton variant="row" /></td></tr>
                        ))
                      : txGroups.map(g=>{
                          const inTime=g.inTx?.actual_arrival??g.inTx?.created_at??null
                          const outTime=g.outTx?.actual_departure??g.outTx?.created_at??null
                          const hasIn=!!g.inTx; const hasOut=!!g.outTx; const isRunning=hasIn&&!hasOut
                          return (
                            <tr key={g.key} className="border-b border-[#f3f4f6] hover:bg-[#f9fafb]">
                              <td className="py-2 px-3"><div className="font-mono font-bold text-[11.5px]">{g.containerNumber}</div></td>
                              <td className="px-3 py-2 font-mono">{hasIn?fmtTime(inTime):"—"}</td>
                              <td className="px-3 py-2 font-mono" style={{ color:isRunning?"#d97706":undefined }}>{hasOut?fmtTime(outTime):isRunning?"In yard":"—"}</td>
                              <td className="px-3 py-2 font-mono font-semibold" style={{ color:isRunning?"#d97706":undefined }}>{hasIn?fmtTurnaround(inTime,outTime):"—"}</td>
                              <td className="px-3 py-2 font-mono">{g.inTx?.truck_license_plate??g.outTx?.truck_license_plate??"—"}</td>
                              <td className="px-3 py-2">{g.inTx?.driver_ref??g.outTx?.driver_ref??"—"}</td>
                              <td className="px-3 py-2">{g.inTx?.carrier_ref??g.outTx?.carrier_ref??"—"}</td>
                              <td className="px-3 py-2">
                                {isRunning&&g.containerId!=null&&(
                                  <button disabled={gateOutLoading===g.containerId} onClick={()=>handleGateOut(g.containerId!,inTime)}
                                    style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:5, fontSize:10.5, padding:"3px 10px", fontWeight:600 }}>
                                    {gateOutLoading===g.containerId?"…":t("gate.gateOut")}
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════ APPOINTMENTS TAB ════════════════════ */}

      {/* ════════════════════ INBOUND / OUTBOUND SHARED RENDERER ════════════════════ */}
      {(tab === "inbound" || tab === "outbound") && (() => {
        const isInbound = tab === "inbound"
        const allRows   = isInbound ? inboundRows : outboundRows
        // Story-enriched column flags — additive, invisible on rows that lack the field
        const hasAsn    = allRows.some(r => !!(r as any).asnReceivedAt)
        const hasEta    = allRows.some(r => !!(r as any).etaOriginal)
        const extraCols = (hasAsn ? 1 : 0) + (hasEta ? 1 : 0)

        // ── Alert priority sort ───────────────────────────────────────────
        const alertScore = (r: LiveGateRow) =>
          r.hoursToLFD < 0 ? 3 : r.hold ? 2 : r.excl ? 1 : 0

        // ── Filter + search ───────────────────────────────────────────────
        const visibleRows = [...allRows]
          .sort((a, b) => alertScore(b) - alertScore(a))
          .filter(r => {
            if (filterPill === "alerts") return r.hoursToLFD < 0 || !!r.hold || !!r.excl
            if (filterPill === "holds")    return !!r.hold
            if (filterPill === "in_queue") return r.gateStatus === "IN_QUEUE"
            if (filterPill === "in_yard")  return r.gateStatus === "SERVED"
            return true
          })
          .filter(r => {
            if (!searchQuery) return true
            const q = searchQuery.toLowerCase()
            return [r.containerId, r.consignee, r.driver, r.plate, r.carrierName, r.trucker, r.scac,
                    (r as any).orderId, (r as any).shipmentId]
              .some(f => f?.toLowerCase().includes(q))
          })

        const alertCount  = allRows.filter(r => r.hoursToLFD < 0 || !!r.hold || !!r.excl).length
        const holdsCount  = allRows.filter(r => !!r.hold).length
        const queueCount  = allRows.filter(r => r.gateStatus === "IN_QUEUE").length
        const yardCount   = allRows.filter(r => r.gateStatus === "SERVED").length

        // ── Channel badge config ──────────────────────────────────────────
        const chanIcon: Record<string, string> = { road:"✓", sea:"▲", rail:"✕" }
        const chanBgFg: Record<string,[string,string]> = {
          road:  ["#f0fdf4","#166534"],   // green-50  / green-800
          sea:   ["#fffbeb","#92400e"],   // amber-50  / amber-800
          rail:  ["#fef2f2","#991b1b"],   // red-50    / red-800
        }

        // ── Status chip config ────────────────────────────────────────────
        const statusChip: Record<string,[string,string,string]> = {
          GATE_OUT:    ["#f0fdf4","#166534", t("gateStatus.gateOut")],    // green-50  / green-800
          SERVED:      ["#eff6ff","#1e40af", t("gateStatus.served")],     // blue-50   / blue-800
          CHECKED_IN:  ["#faf5ff","#6b21a8", t("gateStatus.checkedIn")],  // purple-50 / purple-800
          AT_POSITION: ["#fffbeb","#92400e", t("gateStatus.atPosition")], // amber-50  / amber-800
          IN_QUEUE:    ["#f3f4f6","#374151", t("gateStatus.inQueue")],    // gray-100  / gray-700
          APPROACHING: ["#faf5ff","#6b21a8", t("gateStatus.approaching")],// purple-50 / purple-800
          EXPECTED:    ["#f3f4f6","#374151", t("gateStatus.expected")],   // gray-100  / gray-700
        }

        // ── LFD colour helper ─────────────────────────────────────────────
        const lfdColor = (h: number) =>
          h < 0   ? C.dangerFg :
          h < 24  ? C.warnFg   : C.text

        // ── Row background ────────────────────────────────────────────────
        const rowBg = (r: LiveGateRow) =>
          r.hoursToLFD < 0 ? C.dangerBg :
          r.hold            ? C.warnBg   :
          r.excl            ? C.warnBg   : C.surface0

        const hoverBg = C.surface1

        const TH = "px-3 py-2 text-left whitespace-nowrap"
        const thStyle: React.CSSProperties = {
          fontSize:10, fontWeight:700, letterSpacing:"0.06em",
          textTransform:"uppercase", color: C.textMuted
        }

        return (
          <div className="flex-1 min-h-0 overflow-auto flex flex-col" style={{ background: C.pageBg }}>

            {/* ── Filter toolbar ── */}
            <div className="flex-none flex items-center gap-2 px-5 py-2.5 flex-wrap"
              style={{ background: C.surface0, borderBottom:`1px solid ${C.border}` }}>

              <span style={{ fontSize:12, fontWeight:600, color: C.textMuted }}>
                <span className="font-mono">{visibleRows.length}</span>
                <span className="ml-1">{isInbound ? "inbound" : "outbound"}</span>
              </span>

              {/* Pills */}
              {([
                { id:"all",       label:t("common.all"),          dot:null,     count: allRows.length },
                { id:"alerts",    label:"Alerts",                 dot:C.dangerFg, count: alertCount },
                { id:"holds",     label:"Holds",                  dot:C.warnFg,   count: holdsCount },
                { id:"in_queue",  label:t("gateStatus.inQueue"),  dot:null,     count: queueCount },
                { id:"in_yard",   label:t("gateStatus.served"),   dot:null,     count: yardCount  },
              ] as { id:"all"|"alerts"|"holds"|"in_queue"|"in_yard"; label:string; dot:string|null; count:number }[]).map(pill => {
                const active = filterPill === pill.id
                return (
                  <button key={pill.id} onClick={()=>setFilterPill(pill.id)}
                    className="ds-filter-pill"
                    style={active ? {
                      background:"#eef2ff", color:"#4f46e5", borderColor:"#c7d2fe"
                    } : {
                      color: C.textMuted, borderColor: C.border
                    }}>
                    {pill.dot && <span style={{ width:6, height:6, borderRadius:"50%", background: pill.dot, flexShrink:0, marginRight:5, display:"inline-block" }} />}
                    {pill.label}
                    <span style={{ fontFamily:"var(--font-mono)", fontSize:11, opacity:0.6 }}>{pill.count}</span>
                  </button>
                )
              })}

              {/* Search */}
              <div className="ml-auto relative">
                <input
                  type="text"
                  placeholder="Search container, consignee, driver…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={e => (e.currentTarget.style.borderColor = "#4f46e5")}
                  onBlur={e => (e.currentTarget.style.borderColor = C.border)}
                  style={{
                    height:36, fontSize:14, minWidth:240, width:260,
                    padding:"0 12px 0 36px",
                    background: C.surface1, border:`0.5px solid ${C.border}`,
                    borderRadius:5, color: C.text, fontFamily:"inherit", outline:"none",
                    transition:"border-color 0.12s",
                  }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ fontSize:16, color: C.textDim, lineHeight:1 }}>⌕</span>
              </div>

              {/* Live indicator */}
              {liveError && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ background: C.warnBg, color: C.warnFg }}>⚠ seed fallback</span>
              )}
              {fetchedAt && !liveError && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ background: C.successBg, color: C.successFg }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse"
                    style={{ background: C.successFg }} />
                  Live · {fmtTimestamp(fetchedAt)} UTC
                </span>
              )}
            </div>

            {/* ── Table ── */}
            <div className="flex-1 min-h-0 overflow-auto rounded-lg mx-5 my-3"
              style={{ border:`1px solid ${C.border}` }}>
              <table className="w-full border-collapse" style={{ fontSize:13 }}>
                <thead style={{ position:"sticky", top:0, zIndex:10 }}>
                  <tr style={{ background: C.surface0, borderBottom:`1.5px solid ${C.borderMid}` }}>
                    <th className={TH} style={thStyle}>Container</th>
                    <th className={TH} style={thStyle}>References</th>
                    <th className={TH} style={thStyle}>Consignee</th>
                    <th className={TH} style={thStyle}>Shipping line</th>
                    <th className={TH} style={thStyle}>Road carrier</th>
                    <th className={TH} style={thStyle}>Driver / Plate</th>
                    <th className={TH} style={thStyle}>Channel</th>
                    <th className={TH} style={{ ...thStyle, textAlign:"center" }}>Appt</th>
                    <th className={TH} style={{ ...thStyle, textAlign:"right" }}>LFD</th>
                    <th className={TH} style={thStyle}>Hold</th>
                    <th className={TH} style={thStyle}>Status</th>
                    {isInbound && hasAsn && <th className={TH} style={thStyle}>ASN rcvd</th>}
                    {isInbound && hasEta && <th className={TH} style={{ ...thStyle, textAlign:"center" as const }}>ETA orig → rev</th>}
                    <th className={TH} style={{ ...thStyle, color:"transparent" }}>·</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={12 + extraCols} className="px-5 py-8 text-center"
                      style={{ color: C.textDim, fontSize:12 }}>
                      No containers match the current filter.
                    </td></tr>
                  )}
                  {visibleRows.map((r, i) => {
                    const isBreach  = r.hoursToLFD < 0
                    const isWarn    = !isBreach && r.hoursToLFD < 24
                    const bg        = rowBg(r)
                    const [chBg, chFg] = chanBgFg[r.channel] ?? ["#f3f4f6","#6b7280"]
                    const [stBg, stFg, stLabel] = statusChip[r.gateStatus] ?? ["#f3f4f6","#9ca3af","—"]
                    const lfdLabel  = isBreach ? "Breached" : `${r.hoursToLFD}h`
                    const freeSub   = r.freeDays != null
                      ? `${r.freeDays}d ${r.detentionBasis ?? "cal"}`
                      : null
                    const grossT    = (r.grossKg / 1000).toFixed(1)

                    // Alert tag below container ID
                    const alertTag: { text:string; fg:string; bg:string } | null =
                      isBreach && r.hold === "customs" ? { text:"Customs hold — pending ARCA",       fg:"#b45309", bg:"#fef3c7" } :
                      isBreach                         ? { text:"LFD breached — priority putaway",   fg:C.dangerFg, bg:C.dangerBg } :
                      r.hold === "customs"             ? { text:"Customs hold — pending ARCA",       fg:"#b45309", bg:"#fef3c7" } :
                      r.hold === "quality"             ? { text:"Quality hold — surveyor required",  fg:"#b45309", bg:"#fef3c7" } :
                      r.hold === "damage"              ? { text:"Damage hold — surveyor notified",   fg:"#b45309", bg:"#fef3c7" } :
                      r.excl?.includes("arrival")      ? { text:`Early arrival — before appointment`, fg:"#b45309", bg:"#fef3c7" } :
                      r.excl                           ? { text: r.excl,                             fg:"#b45309", bg:"#fef3c7" } :
                      null

                    const tdStyle: React.CSSProperties = {
                      padding:"12px 12px", borderBottom:`0.5px solid ${C.border}`,
                      verticalAlign:"top", background: bg, minHeight:52,
                    }

                    return (
                      <tr key={i}
                        onMouseEnter={e => {
                          Array.from(e.currentTarget.cells).forEach(td => {
                            (td as HTMLElement).style.background = hoverBg
                          })
                        }}
                        onMouseLeave={e => {
                          Array.from(e.currentTarget.cells).forEach(td => {
                            (td as HTMLElement).style.background = bg
                          })
                        }}>

                        {/* 1. Container ID + size·weight subtitle + alert tag */}
                        <td style={{ ...tdStyle, borderLeft: isBreach ? "3px solid #ef4444" : r.hold||r.excl ? "3px solid #f59e0b" : "3px solid transparent" }}>
                          <div className="font-mono" style={{ fontSize:14, fontWeight:500, color: C.text, letterSpacing:"0.01em" }}>{r.containerId}</div>
                          <div style={{ fontSize:12, fontWeight:500, color: C.textMuted, marginTop:3 }}>{r.size} · {grossT}t</div>
                          {alertTag && (
                            <div className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded"
                              style={{ fontSize:11, fontWeight:600, background: alertTag.bg, color: alertTag.fg }}>
                              {isBreach ? "⚠" : "!"} {alertTag.text}
                            </div>
                          )}
                          {/* Story: chassis ID + special instructions */}
                          {isInbound && !!(r as any).chassis && (
                            <div style={{ fontSize:11, fontWeight:500, color: C.accentFg, marginTop:4 }}>
                              🔗 {(r as any).chassis}
                            </div>
                          )}
                          {isInbound && !!(r as any).specialInstructions && (
                            <div style={{ fontSize:11, color:"#b45309", marginTop:2, fontStyle:"italic" }}>
                              {(r as any).specialInstructions}
                            </div>
                          )}
                        </td>

                        {/* 2. Reference IDs — ORD / SHP badges with click-to-copy */}
                        {(() => {
                          const orderId    = (r as any).orderId    as string | undefined
                          const shipmentId = (r as any).shipmentId as string | undefined
                          const ordKey = `${r.containerId}:ord`
                          const shpKey = `${r.containerId}:shp`
                          const copy = (text: string, key: string) => {
                            navigator.clipboard.writeText(text)
                            setCopiedId(key)
                            setTimeout(() => setCopiedId(p => p === key ? null : p), 1500)
                          }
                          return (
                            <td style={{ ...tdStyle, minWidth:124 }}>
                              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>

                                {/* Order badge */}
                                {orderId ? (
                                  <span
                                    className="ds-badge ds-badge-active"
                                    title={`Copy order ID ${orderId}`}
                                    style={{ cursor:"pointer", display:"inline-flex", alignItems:"baseline",
                                      gap:4, userSelect:"none",
                                      opacity: copiedId === ordKey ? 0.55 : 1,
                                      transition:"opacity 0.12s" }}
                                    onClick={() => copy(orderId, ordKey)}
                                  >
                                    {copiedId === ordKey ? (
                                      <span style={{ fontSize:10, fontWeight:700, color:"#166534" }}>✓ Copied</span>
                                    ) : (
                                      <>
                                        <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.06em",
                                          textTransform:"uppercase", opacity:0.65 }}>ORD</span>
                                        <span className="font-mono" style={{ fontSize:11, fontWeight:600 }}>{orderId}</span>
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color: C.textDim, fontSize:13 }}>—</span>
                                )}

                                {/* Shipment badge */}
                                {shipmentId ? (
                                  <span
                                    className="ds-badge ds-badge-neutral"
                                    title={`Copy shipment ID ${shipmentId}`}
                                    style={{ cursor:"pointer", display:"inline-flex", alignItems:"baseline",
                                      gap:4, userSelect:"none",
                                      opacity: copiedId === shpKey ? 0.55 : 1,
                                      transition:"opacity 0.12s" }}
                                    onClick={() => copy(shipmentId, shpKey)}
                                  >
                                    {copiedId === shpKey ? (
                                      <span style={{ fontSize:10, fontWeight:700, color:"#166534" }}>✓ Copied</span>
                                    ) : (
                                      <>
                                        <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.06em",
                                          textTransform:"uppercase", opacity:0.65 }}>SHP</span>
                                        <span className="font-mono" style={{ fontSize:11, fontWeight:600 }}>{shipmentId}</span>
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color: C.textDim, fontSize:13 }}>—</span>
                                )}

                              </div>
                            </td>
                          )
                        })()}

                        {/* 3. Consignee */}
                        <td style={tdStyle}>
                          <div style={{ fontSize:14, fontWeight:500, color: C.text, whiteSpace:"nowrap" }}>{r.consignee}</div>
                          <div className="font-mono" style={{ fontSize:12, fontWeight:500, color: C.textMuted, marginTop:3 }}>{r.sealNumber}</div>
                        </td>

                        {/* 3. Shipping line — carrier name / SCAC */}
                        <td style={tdStyle}>
                          <div style={{ fontSize:14, fontWeight:500, color: C.text, whiteSpace:"nowrap" }}>{r.carrierName}</div>
                          <div className="font-mono" style={{ fontSize:12, fontWeight:500, color: C.accentFg, marginTop:3, letterSpacing:"0.06em" }}>{r.scac}</div>
                        </td>

                        {/* 4. Road carrier — trucker name / SCAC */}
                        <td style={tdStyle}>
                          <div style={{ fontSize:14, fontWeight:500, color: C.text, whiteSpace:"nowrap" }}>{r.trucker}</div>
                          <div className="font-mono" style={{ fontSize:12, fontWeight:500, color: C.purpleFg, marginTop:3, letterSpacing:"0.06em" }}>{r.truckerScac}</div>
                        </td>

                        {/* 5. Driver / Plate */}
                        <td style={tdStyle}>
                          <div style={{ fontSize:14, fontWeight:500, color: C.text }}>{r.driver}</div>
                          <div className="font-mono" style={{ fontSize:12, fontWeight:500, color: C.textMuted, marginTop:3, padding:"1px 5px", borderRadius:3, background: C.surface2, display:"inline-block" }}>{r.plate}</div>
                        </td>

                        {/* 6. Channel badge */}
                        <td style={tdStyle}>
                          <span className="ds-badge" style={{ background: chBg, color: chFg }}>
                            {chanIcon[r.channel] ?? "?"} {r.channel === "road" ? "Road" : r.channel === "sea" ? "Sea" : "Rail"}
                          </span>
                        </td>

                        {/* 7. Appointment */}
                        <td style={{ ...tdStyle, textAlign:"center" }}>
                          <span className="font-mono" style={{ fontSize:14, fontWeight:500, color: C.text }}>{r.appt}</span>
                        </td>

                        {/* 8. LFD — right-aligned + free days subtitle */}
                        <td style={{ ...tdStyle, textAlign:"right" }}>
                          <div className="font-mono" style={{ fontSize:14, fontWeight:600, color: lfdColor(r.hoursToLFD) }}>
                            {lfdLabel}
                          </div>
                          {freeSub && (
                            <div style={{ fontSize:12, fontWeight:500, color: C.textMuted, marginTop:3 }}>{freeSub}</div>
                          )}
                        </td>

                        {/* 9. Hold */}
                        <td style={tdStyle}>
                          {r.hold === "customs" ? (
                            <span className="ds-badge ds-badge-danger">Customs</span>
                          ) : r.hold === "quality" ? (
                            <span className="ds-badge ds-badge-warning">Quality</span>
                          ) : r.hold === "damage" ? (
                            <span className="ds-badge ds-badge-warning">Damage</span>
                          ) : (
                            <span style={{ color: C.textDim, fontSize:14 }}>—</span>
                          )}
                        </td>

                        {/* 10. Status chip */}
                        <td style={tdStyle}>
                          <span className="ds-badge" style={{ background: stBg, color: stFg }}>
                            {stLabel}
                          </span>
                        </td>

                        {/* 10a. ASN received (story inbound rows only) */}
                        {isInbound && hasAsn && (
                          <td style={tdStyle}>
                            {(r as any).asnReceivedAt ? (
                              <>
                                <div style={{ fontSize:12, fontWeight:600, color:"#166534" }}>✓ received</div>
                                <div className="font-mono" style={{ fontSize:11, color: C.textMuted, marginTop:2 }}>
                                  {String((r as any).asnReceivedAt).slice(0,10)}
                                </div>
                              </>
                            ) : (
                              <span style={{ color: C.textDim, fontSize:14 }}>—</span>
                            )}
                          </td>
                        )}

                        {/* 10b. ETA original → revised (story inbound rows only) */}
                        {isInbound && hasEta && (
                          <td style={{ ...tdStyle, textAlign:"center" }}>
                            {(r as any).etaOriginal ? (
                              <div className="font-mono" style={{ fontSize:12, fontWeight:600 }}>
                                {(r as any).etaRevised && (r as any).etaRevised !== (r as any).etaOriginal ? (
                                  <>
                                    <span style={{ color: C.textMuted }}>{(r as any).etaOriginal}</span>
                                    <span style={{ color: C.textDim }}> → </span>
                                    <span style={{ color:"#d97706" }}>{(r as any).etaRevised}</span>
                                  </>
                                ) : (
                                  <span style={{ color: C.text }}>{(r as any).etaOriginal}</span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: C.textDim, fontSize:14 }}>—</span>
                            )}
                          </td>
                        )}

                        {/* 11. Seal (compact) */}
                        <td style={{ ...tdStyle, textAlign:"right" }}>
                          <div className="font-mono" style={{ fontSize:12, fontWeight:500, color: C.textDim }}>{r.sealNumber}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ════════════════════ INSPECTION TAB ════════════════════ */}
      {tab === "inspection" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <GateInspection onNavigate={onNavigate} />
        </div>
      )}
    </div>
  )
}
