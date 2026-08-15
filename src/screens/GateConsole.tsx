import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useData } from "@/lib/DataContext"
import type { Visit } from "@/data/yard-ops"
import { backendApi, type BackendGateTransaction, type LiveGateRow } from "@/lib/backend-api"
import ContainerPicker from "@/components/ContainerPicker"
import { computeRehandleCost } from "@/lib/utils"
import GateInspection from "@/components/gate/GateInspection"
import { allSteps } from "@/data/planningData"
import { INBOUND_SEED, OUTBOUND_SEED } from "@/data/gate-seed"
import { useLang } from "@/lib/i18n"

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
const VISIT_COLS = ["TRUCK","LIFECYCLE","TURN","PURPOSE","CONTAINER","APPT","EXCLUSION"] as const
type VisitCol = typeof VISIT_COLS[number]
const DEFAULT_VISIT_COLS = new Set<VisitCol>(["TRUCK","LIFECYCLE","TURN"])
const VISIT_COL_LABELS: Record<VisitCol, string> = {
  TRUCK: "TRUCK", LIFECYCLE: "STATE", TURN: "TURN",
  PURPOSE: "PURPOSE", CONTAINER: "CONTAINER", APPT: "APPT", EXCLUSION: "EXCLUSION",
}

export default function GateConsole({ focus, onNavigate }: Props) {
  const { visits, lanes, appointments, refresh, backendConnected, backendContainers, containers } = useData()
  const { t } = useLang()

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
  const colChooserRef  = useRef<HTMLDivElement>(null)
  const moreActionsRef = useRef<HTMLDivElement>(null)

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
  }, [sel])

  useEffect(() => {
    if (tab !== "gtx" || !backendConnected) return
    loadTransactions()
  }, [tab, backendConnected])

  async function loadTransactions() {
    setTxLoading(true)
    try { const data = await backendApi.gateTransactions(); setTransactions(data) }
    catch (err) { console.error("[GateConsole] load transactions:", err) }
    finally { setTxLoading(false) }
  }

  async function handleGateIn() {
    setSubmittingGateIn(true)
    try {
      await backendApi.createGateTransaction({
        gate_type: "in",
        container_id: gateInContId !== "" ? Number(gateInContId) : undefined,
        truck_license_plate: gateInPlate || undefined,
        driver_ref: gateInDriver || undefined,
        carrier_ref: gateInCarrier || undefined,
      })
      setShowGateInForm(false)
      setGateInContId(""); setGateInPlate(""); setGateInDriver(""); setGateInCarrier("")
      await loadTransactions()
    } catch (err) { console.error("[GateConsole] gate in:", err) }
    finally { setSubmittingGateIn(false) }
  }

  async function handleGateOut(containerId: number, inTime: string | null) {
    setGateOutLoading(containerId)
    try {
      const tx = await backendApi.createGateTransaction({ gate_type: "out", container_id: containerId })
      await loadTransactions()
      if (inTime && tx.actual_departure) {
        const diffMs = new Date(tx.actual_departure).getTime() - new Date(inTime).getTime()
        const msg = `Gate out confirmed · turnaround ${Math.round(diffMs/60_000)}′`
        setTurnaroundToast(msg)
        if (toastTimeout.current) clearTimeout(toastTimeout.current)
        toastTimeout.current = setTimeout(() => setTurnaroundToast(null), 6000)
      }
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

  function fmtTime(iso:string|null):string {
    if (!iso) return "—"
    const d=new Date(iso); return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})
  }
  function fmtTurnaround(inIso:string|null,outIso:string|null):string {
    if (!inIso) return "—"
    const mins=Math.round((( outIso?new Date(outIso).getTime():Date.now())-new Date(inIso).getTime())/60_000)
    return `${mins}′${outIso?"":` (running)`}`
  }

  // ── Seed-derived GTX rows (always available, no backend needed) ──────────
  const CHAN_COLOR: Record<string,[string,string]> = {
    rojo:    ["#fef2f2","#dc2626"],
    naranja: ["#fffbeb","#d97706"],
    verde:   ["#f0fdf4","#16a34a"],
  }
  const STATE_STYLE: Record<string,[string,string]> = {
    GATE_OUT:    ["#f3f4f6","#6b7280"],
    SERVED:      ["#f0fdf4","#059669"],
    AT_POSITION: ["#eff6ff","#2563eb"],
    CHECKED_IN:  ["#fffbeb","#d97706"],
    IN_QUEUE:    ["#fff7ed","#ea580c"],
    APPROACHING: ["#faf5ff","#7c3aed"],
    EXPECTED:    ["#f9fafb","#9ca3af"],
  }
  function stateLabel(s:string){return({GATE_OUT:"Completed",SERVED:"In yard",AT_POSITION:"At position",CHECKED_IN:"Checked in",IN_QUEUE:"In queue",APPROACHING:"Approaching",EXPECTED:"Expected"})[s]??s}
  function dirFromPurpose(p:string){ return /drop|inbound/i.test(p)?"IN":/pickup|retrieval/i.test(p)?"OUT":"EMPTY" }

  const seedGtxRows = visits.map(v => {
    const cont = containers.find(c => c.id === v.container)
    const ch = cont?.channel ?? "verde"
    const dir = dirFromPurpose(v.purpose)
    return { visit:v, cont, ch, dir }
  }).sort((a,b) => {
    const ta = a.visit.gateOut??a.visit.served??a.visit.atPosition??a.visit.checkIn??a.visit.queueIn??""
    const tb = b.visit.gateOut??b.visit.served??b.visit.atPosition??b.visit.checkIn??b.visit.queueIn??""
    return tb.localeCompare(ta)
  })

  const filteredGtxRows = seedGtxRows.filter(r =>
    (gtxChanFilter==="all" || r.ch===gtxChanFilter) &&
    (gtxDirFilter==="all"  || r.dir===gtxDirFilter)
  )

  const gtxKpis = {
    total:   seedGtxRows.length,
    verde:   seedGtxRows.filter(r=>r.ch==="verde").length,
    naranja: seedGtxRows.filter(r=>r.ch==="naranja").length,
    rojo:    seedGtxRows.filter(r=>r.ch==="rojo").length,
    avgTurn: (seedGtxRows.filter(r=>r.visit.turn>0).reduce((s,r)=>s+r.visit.turn,0)/Math.max(1,seedGtxRows.filter(r=>r.visit.turn>0).length)).toFixed(1),
    completed: seedGtxRows.filter(r=>r.visit.state==="GATE_OUT").length,
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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">

      {/* Header */}
      <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[15px] tracking-tight">{t("gate.title")}</span>
          <span className="text-[11px] text-neutral-500">{t("gate.subtitle")}</span>
        </div>
        <div className="flex ml-3" style={{ border:"1px solid #e5e7eb", borderRadius:5, overflow:"hidden" }}>
          {([
            { k:"visits",    label:t("gate.tab.visits") },
            { k:"inbound",   label:t("gate.tab.inbound", inboundRows.length) },
            { k:"outbound",  label:t("gate.tab.outbound", outboundRows.length) },
            { k:"gtx",       label:t("gate.tab.transactions") },
            { k:"appts",     label:t("gate.tab.appointments") },
            { k:"inspection",label:t("gate.tab.inspection") },
          ] as const).map(({ k, label }) => (
            <button key={k} onClick={()=>setTab(k)}
              className="text-[11.5px] px-3 py-1.5 font-bold transition-colors"
              style={{ background:tab===k?"#111827":"transparent", color:tab===k?"#fff":"#374151" }}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          {tab==="gtx"&&backendConnected ? (
            <button onClick={()=>setShowGateInForm(f=>!f)}
              style={{ background:"#111827", color:"#fff", border:"none", borderRadius:5, fontSize:12, padding:"5px 14px", fontWeight:600 }}>
              {showGateInForm?t("common.cancel"):t("gate.gateIn")}
            </button>
          ) : (
            <button onClick={handleCheckIn} disabled={checkingIn}
              style={{ background:"#111827", color:"#fff", border:"none", borderRadius:5, fontSize:12, padding:"5px 14px", fontWeight:600, opacity:checkingIn?0.5:1 }}>
              {checkInDone?"V-2043 served · gate pass issued":checkingIn?t("gate.checkingIn"):t("gate.checkIn")}
            </button>
          )}
        </div>
      </div>

      {/* ── Collapsible KPI bar — computed live from inbound/outbound rows ─── */}
      {(() => {
        const isOut = tab === "outbound"

        // ── Inbound counts ────────────────────────────────────────────────
        const ibTotal      = inboundRows.length
        const ibCleared    = inboundRows.filter(r => r.channel === "verde" && !r.hold).length
        const ibHolds      = inboundRows.filter(r => r.hold).length
        const ibLfdRisk    = inboundRows.filter(r => r.hoursToLFD < 24).length
        const ibReceived   = inboundRows.filter(r => r.gateStatus === "GATE_OUT" || r.gateStatus === "SERVED").length
        const ibCarriers   = new Set(inboundRows.map(r => r.carrierName)).size
        const ibHoldTypes  = (() => {
          const types: Record<string,number> = {}
          inboundRows.forEach(r => { if (r.hold) types[r.hold] = (types[r.hold]||0)+1 })
          return Object.entries(types).map(([k,n])=>`${n} ${k}`).join(" · ") || "none"
        })()

        // ── Outbound counts ───────────────────────────────────────────────
        const obTotal      = outboundRows.length
        const obGateOut    = outboundRows.filter(r => r.gateStatus === "GATE_OUT").length
        const obPending    = obTotal - obGateOut
        const obFlagged    = outboundRows.filter(r => r.excl || r.hold).length
        const obBreached   = outboundRows.filter(r => r.hoursToLFD < 0).length
        const obCarriers   = new Set(outboundRows.map(r => r.carrierName)).size

        const primaryKpis = isOut ? [
          { k:t("gate.kpi.dispatchingToday"),  v:String(obTotal),   sub:t("gate.kpi.scheduledExport"),  red:false },
          { k:t("gate.kpi.gateOutComplete"),   v:String(obGateOut), sub:`${obPending} ${t("gate.kpi.stillPending")}`, red:false },
          { k:t("gate.kpi.flaggedIssues"),     v:String(obFlagged), sub:t("gate.kpi.clearanceFlags"),   red:obFlagged > 0 },
        ] : [
          { k:t("gate.kpi.arrivingToday"),     v:String(ibTotal),   sub:t("gate.kpi.bookedToday"),      red:false },
          { k:t("gate.kpi.clearedToReceive"),  v:String(ibCleared), sub:`${ibHolds} ${t("gate.kpi.onHold")}`, red:ibHolds > 0 },
          { k:t("gate.kpi.lfdAtRisk"),         v:String(ibLfdRisk), sub:t("gate.kpi.within24h"),        red:ibLfdRisk > 0 },
        ]

        const secondaryKpis = isOut ? [
          { k:t("gate.kpi.detentionBreached"), v:String(obBreached), sub:t("gate.kpi.detentionRisk"),   red:obBreached > 0 },
          { k:t("gate.kpi.shippingLines"),     v:String(obCarriers), sub:t("gate.kpi.carriersToday"),   red:false },
          { k:t("gate.kpi.stillToDispatch"),   v:String(obPending),  sub:t("gate.kpi.awaitingGateOut"), red:false },
        ] : [
          { k:t("gate.kpi.alreadyReceived"),   v:String(ibReceived), sub:t("gate.kpi.gateOutComplete2"), red:false },
          { k:t("gate.kpi.holdsActive"),       v:String(ibHolds),    sub:ibHoldTypes,                   red:ibHolds > 0 },
          { k:t("gate.kpi.shippingLines"),     v:String(ibCarriers), sub:t("gate.kpi.carriersToday"),   red:false },
        ]

        return (
          <div className="flex-none border-b border-[#e5e7eb] bg-white">
            {/* Primary row */}
            <div className="flex items-stretch">
              {primaryKpis.map(m => (
                <div key={m.k} className="flex-1 basis-36 px-5 py-2.5 border-r border-[#e5e7eb] flex flex-col gap-0.5">
                  <span className="ds-label text-neutral-500">{m.k}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-semibold leading-none" style={{ fontSize:24, color:m.red?"#dc2626":undefined }}>{m.v}</span>
                    <span className="text-[11px] text-neutral-500">{m.sub}</span>
                  </div>
                </div>
              ))}
              <button onClick={()=>setKpiExpanded(v=>!v)}
                className="flex items-center gap-1.5 px-4 text-[11px] text-[#6b7280] hover:text-[#374151] hover:bg-[#f9fafb] transition-colors"
                style={{ whiteSpace:"nowrap" }}>
                {kpiExpanded?t("gate.kpi.fewerMetrics"):t("gate.kpi.moreMetrics")}
              </button>
            </div>
            {/* Secondary row */}
            <div style={{ overflow:"hidden", maxHeight:kpiExpanded?120:0, transition:"max-height 200ms ease" }}>
              <div className="flex border-t border-[#e5e7eb]">
                {secondaryKpis.map(m => (
                  <div key={m.k} className="flex-1 basis-36 px-5 py-2.5 border-r border-[#e5e7eb] flex flex-col gap-0.5">
                    <span className="ds-label text-neutral-500">{m.k}</span>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono font-semibold leading-none" style={{ fontSize:24, color:m.red?"#dc2626":undefined }}>{m.v}</span>
                      <span className="text-[11px] text-neutral-500">{m.sub}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

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
                    {visibleCols.has("TRUCK")     && <th className="ds-th text-left">{t("gate.col.truck")}</th>}
                    {visibleCols.has("LIFECYCLE") && <th className="ds-th text-left">{t("gate.col.lifecycle")}</th>}
                    {visibleCols.has("TURN")      && <th className="ds-th text-left">{t("gate.col.turn")}</th>}
                    {visibleCols.has("PURPOSE")   && <th className="ds-th text-left">{t("gate.col.purpose")}</th>}
                    {visibleCols.has("CONTAINER") && <th className="ds-th text-left">{t("gate.col.container")}</th>}
                    {visibleCols.has("APPT")      && <th className="ds-th text-left">{t("gate.col.appt")}</th>}
                    {visibleCols.has("EXCLUSION") && <th className="ds-th text-left">{t("gate.col.exclusion")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visits.map(v=>(
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
                          <div className="text-[10px] text-neutral-500 mt-0.5">{v.state.replace(/_/g," ").toLowerCase()}</div>
                        </td>
                      )}
                      {/* TURN */}
                      {visibleCols.has("TURN") && (
                        <td className={`px-2 py-2.5 font-mono font-bold ${v.turn>=15?"text-[#dc2626]":""}`}>{v.turn?v.turn+"′":"—"}</td>
                      )}
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
              <div className="text-[12px] text-neutral-600 mt-0.5">{selVisit.carrier} · {selVisit.driver} · lane <span className="font-mono">{selVisit.lane}</span></div>
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
              { k:"Visits today",  v:String(gtxKpis.total),     sub:"all states",        color:undefined },
              { k:"Completed",     v:String(gtxKpis.completed), sub:"gate-out issued",   color:undefined },
              { k:"Verde ✓",       v:String(gtxKpis.verde),     sub:"standard channel",  color:"#16a34a" },
              { k:"Naranja !",     v:String(gtxKpis.naranja),   sub:"inspection routed", color:"#d97706" },
              { k:"Rojo ✕",        v:String(gtxKpis.rojo),      sub:"customs controlled",color:"#dc2626" },
              { k:"Avg turn",      v:`${gtxKpis.avgTurn}′`,     sub:"vs 15′ target",     color:parseFloat(gtxKpis.avgTurn)>15?"#dc2626":undefined },
            ].map(m => (
              <div key={m.k} className="flex-1 px-4 py-2.5 flex flex-col gap-0.5 border-r border-[#e5e7eb]">
                <span className="ds-label text-neutral-500">{m.k}</span>
                <span className="font-mono font-bold text-[24px] leading-none" style={{ color:m.color }}>{m.v}</span>
                <span className="text-[10px] text-neutral-400">{m.sub}</span>
              </div>
            ))}
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-5 py-2 border-b border-[#e5e7eb] bg-white flex-none">
            <span className="text-[10.5px] font-semibold text-neutral-400 tracking-wide">CHANNEL</span>
            {(["all","verde","naranja","rojo"] as const).map(ch => (
              <button key={ch} onClick={()=>setGtxChanFilter(ch)}
                className="text-[11px] px-2.5 py-1 font-semibold rounded capitalize transition-colors"
                style={{
                  background: gtxChanFilter===ch ? (ch==="all"?"#111827":CHAN_COLOR[ch]?.[0]??"#f3f4f6") : "#f3f4f6",
                  color:      gtxChanFilter===ch ? (ch==="all"?"#fff":CHAN_COLOR[ch]?.[1]??"#374151") : "#6b7280",
                  border:     `1px solid ${gtxChanFilter===ch ? (ch==="all"?"#111827":CHAN_COLOR[ch]?.[1]??"#d1d5db") : "#e5e7eb"}`,
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
                  {["VISIT",t("gate.container"),t("gate.channel"),"DIRECTION",t("gate.col.purpose"),"QUEUE IN","CHECK IN",t("gate.gateOut"),"TURN","TRUCK · DRIVER",t("gate.carrier"),t("gate.col.appt"),t("gate.status")].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold tracking-wider text-neutral-400 whitespace-nowrap"
                      style={{ borderBottom:"1px solid #e5e7eb" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredGtxRows.map(({ visit:v, ch }) => {
                  const [chanBg, chanFg] = CHAN_COLOR[ch] ?? ["#f3f4f6","#6b7280"]
                  const [stBg,  stFg]   = STATE_STYLE[v.state] ?? ["#f3f4f6","#6b7280"]
                  const isLive  = v.state !== "GATE_OUT" && v.state !== "EXPECTED"
                  const isExcl  = !!v.excl
                  return (
                    <tr key={v.id}
                      className="border-b border-[#f3f4f6] transition-colors"
                      style={{ background: v.state==="GATE_OUT" ? "#fafafa" : "#fff" }}
                      onMouseEnter={e=>(e.currentTarget.style.background="#f0f9ff")}
                      onMouseLeave={e=>(e.currentTarget.style.background=v.state==="GATE_OUT"?"#fafafa":"#fff")}>

                      {/* Visit ID */}
                      <td className="px-3 py-2.5 font-mono text-[11px] font-bold text-neutral-400 whitespace-nowrap">{v.id}</td>

                      {/* Container */}
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-bold text-[12px] text-neutral-900">{v.container}</div>
                      </td>

                      {/* Channel pill */}
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold capitalize"
                          style={{ background:chanBg, color:chanFg, border:`1px solid ${chanFg}30` }}>
                          {ch==="verde"?"✓":ch==="naranja"?"!":"✕"} {ch}
                        </span>
                      </td>

                      {/* Direction */}
                      <td className="px-3 py-2.5">
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: dirFromPurpose(v.purpose)==="IN"?"#eff6ff":dirFromPurpose(v.purpose)==="OUT"?"#faf5ff":"#f0fdf4", color: dirFromPurpose(v.purpose)==="IN"?"#1d4ed8":dirFromPurpose(v.purpose)==="OUT"?"#6d28d9":"#065f46" }}>
                          {dirFromPurpose(v.purpose)==="IN"?"↓ Inbound":dirFromPurpose(v.purpose)==="OUT"?"↑ Outbound":"⇄ Empty"}
                        </span>
                      </td>

                      {/* Purpose */}
                      <td className="px-3 py-2.5 text-[11.5px] text-neutral-700 whitespace-nowrap">{v.purpose}</td>

                      {/* Timestamps */}
                      <td className="px-3 py-2.5 font-mono text-[11.5px] text-neutral-700">{v.queueIn??<span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2.5 font-mono text-[11.5px] text-neutral-700">{v.checkIn??<span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2.5 font-mono text-[11.5px]"
                        style={{ color:v.gateOut?"#059669":isLive?"#d97706":"#9ca3af", fontWeight:v.gateOut?600:400 }}>
                        {v.gateOut??( isLive ? <span style={{color:"#d97706"}}>running</span> : "—" )}
                      </td>

                      {/* Turn */}
                      <td className="px-3 py-2.5 font-mono font-bold text-[12px]"
                        style={{ color: v.turn===0?"#9ca3af":v.turn>15?"#dc2626":v.turn>10?"#d97706":"#059669" }}>
                        {v.turn>0?`${v.turn}′`:"—"}
                      </td>

                      {/* Truck · Driver */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-mono text-[11.5px] font-semibold">{v.plate}</div>
                        <div className="text-[10.5px] text-neutral-500">{v.driver}</div>
                      </td>

                      {/* Carrier */}
                      <td className="px-3 py-2.5 text-[11.5px] text-neutral-700 whitespace-nowrap">{v.carrier}</td>

                      {/* Lane */}
                      <td className="px-3 py-2.5 font-mono text-[11.5px] text-neutral-600">{v.lane}</td>

                      {/* Status */}
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                            style={{ background:stBg, color:stFg }}>
                            {stateLabel(v.state)}
                          </span>
                          {isExcl && (
                            <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background:"#fef9c3", color:"#713f12", maxWidth:140 }}>
                              ⚠ {v.excl}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

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
                      ? <tr><td colSpan={8} className="px-3 py-4 text-neutral-400 text-[11px]">{t("common.loading")}</td></tr>
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
      {tab==="appts" && (
        <div className="grid flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns:"minmax(360px,1fr) clamp(260px,26vw,360px)" }}>
          <div className="overflow-auto bg-white" style={{ borderRight:"1px solid #e5e7eb" }}>
            <div className="px-4 pt-3 pb-1.5 ds-label text-neutral-500 font-bold">Bookable windows · Tue 12 Aug · capacity from machine-hours, not lanes</div>
            {appointments.map(a=>(
              <button key={a.window} onClick={()=>setApptSel(a.window)}
                className="block w-full text-left px-4 py-2 border-b border-[#f3f4f6] hover:bg-[#f9fafb] transition-colors"
                style={{ borderLeft:`3px solid ${a.window===apptSel?"#dc2626":a.over?"#d97706":"transparent"}`, background:a.window===apptSel?"#fef2f2":undefined }}>
                <div className="flex items-center gap-3">
                  <span className="text-[12.5px] font-bold font-mono w-12">{a.window}</span>
                  <div className="flex gap-0.5 flex-1">
                    {Array.from({length:Math.max(a.capacity,a.booked)},(_,i)=>(
                      <span key={i} className="w-6 h-4 border inline-block"
                        style={{ background:i<a.booked?(i>=a.capacity?"#dc2626":"#111827"):"transparent", borderColor:i>=a.capacity?"#dc2626":"#6b7280" }} />
                    ))}
                  </div>
                  <span className={`text-[11px] font-mono w-32 text-right ${a.over?"text-[#dc2626]":"text-neutral-500"}`}>
                    {a.booked}/{a.capacity}{a.noShow?" · "+a.noShow+" no-show":""}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {apptData && (
            <div className="overflow-auto bg-white">
              <div className="px-4 pt-4 pb-2">
                <div className="text-[9.5px] font-semibold tracking-wide text-neutral-400 mb-1">ASN — advance ship notice</div>
                <div className="ds-label text-neutral-500">{t("gate.appts.window")} <span className="font-mono">{apptData.window}</span></div>
                <div className="font-semibold text-[16px] mt-1"><span className="font-mono">{apptData.booked}</span> {t("gate.appts.booked")} of <span className="font-mono">{apptData.capacity}</span> {t("gate.appts.capacity")}</div>
              </div>
              {[
                {k:"Capacity basis",           v:"3 RS + 1 EH · 11.4 moves/h"},
                {k:"Machine minutes committed",v:(apptData.booked*4.8).toFixed(1)+"′"},
                {k:"Purpose mix",              v:"2 pickup · 1 empty · 1 drop"},
                {k:"Overbooking policy",       v:apptData.over?"1 over — accepted with queue risk":"within capacity",red:apptData.over},
                {k:"No-show handling",         v:apptData.noShow?"slot released to waitlist":"n/a"},
              ].map(d=>(
                <div key={d.k} className="flex justify-between gap-3 px-4 py-1.5 border-b border-[#f3f4f6] text-[11.5px]">
                  <span className="text-neutral-500">{d.k}</span>
                  <span className={`font-semibold text-right font-mono ${d.red?"text-[#dc2626]":""}`}>{d.v}</span>
                </div>
              ))}
              <div className="px-4 pt-3 pb-1.5 ds-label text-neutral-500 font-bold">Smoothing recommendation</div>
              <div className="px-4 pb-4 text-[12px] leading-relaxed text-neutral-700">
                {smoothed?"Applied: three 07:30 bookings moved to 10:00–11:00. Projected P90 in the peak improves 3.4 minutes.":"Move three bookings out of 07:30 into the 10:00–11:00 trough. The peak consumes 62% of arrivals against 41% of machine capacity."}
              </div>
              <button className="mx-4 mb-4 text-[11.5px] text-left px-3 py-2 font-semibold"
                style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:5 }}
                onClick={()=>setSmoothed(true)}>
                {smoothed?"Smoothing applied · 3 windows retimed":"Apply smoothing"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ INBOUND / OUTBOUND SHARED RENDERER ════════════════════ */}
      {(tab === "inbound" || tab === "outbound") && (() => {
        const isInbound = tab === "inbound"
        const rows = isInbound ? inboundRows : outboundRows
        const title = isInbound ? "Inbound containers" : "Outbound containers"
        const subtitle = isInbound
          ? `${rows.length} containers scheduled for putaway today`
          : `${rows.length} containers staged for truck loading today`

        const CHAN_PILL: Record<string,[string,string,string]> = {
          verde:   ["#f0fdf4","#15803d","✓ Verde"],
          naranja: ["#fffbeb","#d97706","! Naranja"],
          rojo:    ["#fef2f2","#dc2626","✕ Rojo"],
        }
        const GATE_STATE: Record<string,[string,string]> = {
          GATE_OUT:    ["#f3f4f6","#6b7280"],
          SERVED:      ["#f0fdf4","#059669"],
          AT_POSITION: ["#eff6ff","#2563eb"],
          CHECKED_IN:  ["#fffbeb","#d97706"],
          IN_QUEUE:    ["#fff7ed","#ea580c"],
          APPROACHING: ["#faf5ff","#7c3aed"],
          EXPECTED:    ["#f9fafb","#6b7280"],
        }
        const gateStateLabel: Record<string,string> = {
          GATE_OUT:"Completed", SERVED:"In yard", AT_POSITION:"At position",
          CHECKED_IN:"Checked in", IN_QUEUE:"In queue", APPROACHING:"Approaching", EXPECTED:"Expected",
        }

        return (
          <div className="flex-1 min-h-0 overflow-auto">

            {/* ── Sticky header bar ── */}
            <div className="px-5 pt-3 pb-2 flex items-center gap-3 border-b border-[#e5e7eb] bg-white sticky top-0 z-10">
              <span className="font-semibold text-[13px]">{title}</span>
              <span className="text-[11px] text-[#9ca3af]">{subtitle}</span>
              <div className="ml-auto flex items-center gap-2">
                {liveError && (
                  <span className="text-[10px] text-[#d97706] font-medium px-2 py-0.5 rounded"
                    style={{ background:"#fffbeb" }}>⚠ seed fallback</span>
                )}
                {fetchedAt && !liveError && (
                  <span className="flex items-center gap-1 text-[10px] text-[#059669] font-medium px-2 py-0.5 rounded"
                    style={{ background:"#f0fdf4" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#059669] inline-block animate-pulse" />
                    Live · {fetchedAt.slice(11,19)} UTC
                  </span>
                )}
              </div>
            </div>

            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-[41px] z-10">
                <tr style={{ background:"#fff", borderBottom:"2px solid #e5e7eb" }}>
                  {[
                    t("gate.container"),"SIZE","CONSIGNEE",
                    "LINE SCAC",t("gate.carrier"),
                    "TRUCK SCAC",t("gate.trucker"),
                    t("gate.channel"),t("gate.appt"),t("gate.driver"),t("gate.plate"),"LFD",t("gate.freeDays"),t("gate.hold"),t("gate.status")
                  ].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold tracking-wider text-neutral-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const lfdLabel   = r.hoursToLFD < 0 ? "BREACHED" : `${r.hoursToLFD}h`
                  const lfdRed     = r.hoursToLFD < 24
                  const freeDays   = r.freeDays
                  const detBasis   = r.detentionBasis
                  const [chanBg, chanFg, chanLabel] = CHAN_PILL[r.channel] ?? ["#f3f4f6","#6b7280","—"]
                  const [gBg, gFg] = GATE_STATE[r.gateStatus] ?? ["#f3f4f6","#6b7280"]
                  const rowBg = r.excl ? "#fffbeb" : "#fff"

                  return (
                    <tr key={i}
                      className="border-b border-[#f3f4f6] transition-colors"
                      style={{ background: rowBg }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f0f9ff")}
                      onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>

                      {/* Container ID */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-[12px] text-neutral-900">{r.containerId}</div>
                        {r.excl && <div className="text-[9.5px] text-[#d97706] mt-0.5 leading-tight max-w-[160px]">{r.excl}</div>}
                      </td>

                      {/* Size + ISO type */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="text-[11.5px] font-semibold text-neutral-700">{r.size}</div>
                        <div className="text-[10px] text-neutral-400 font-mono">{r.isoType}</div>
                      </td>

                      {/* Consignee */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="text-[11.5px] font-semibold text-neutral-900">{r.consignee}</div>
                        <div className="text-[10px] text-neutral-400">{(r.grossKg / 1000).toFixed(1)} t gross</div>
                      </td>

                      {/* Shipping-line SCAC */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-mono font-bold text-[11.5px] px-1.5 py-0.5 rounded tracking-widest"
                          style={{ background:"#eff6ff", color:"#1d4ed8" }}>
                          {r.scac}
                        </span>
                      </td>

                      {/* Carrier full name */}
                      <td className="px-3 py-3 text-[11.5px] text-neutral-700 whitespace-nowrap">{r.carrierName}</td>

                      {/* Trucker SCAC */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-mono font-bold text-[11.5px] px-1.5 py-0.5 rounded tracking-widest"
                          style={{ background:"#faf5ff", color:"#7c3aed" }}>
                          {r.truckerScac}
                        </span>
                      </td>

                      {/* Trucker full name */}
                      <td className="px-3 py-3 text-[11.5px] text-neutral-600 whitespace-nowrap">{r.trucker}</td>

                      {/* Customs channel */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold"
                          style={{ background: chanBg, color: chanFg, border: `1px solid ${chanFg}30` }}>
                          {chanLabel}
                        </span>
                      </td>

                      {/* Appointment */}
                      <td className="px-3 py-3 font-mono text-[12px] font-semibold text-neutral-700 whitespace-nowrap">{r.appt}</td>

                      {/* Driver */}
                      <td className="px-3 py-3 text-[11.5px] text-neutral-700 whitespace-nowrap">{r.driver}</td>

                      {/* Truck plate */}
                      <td className="px-3 py-3 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded" style={{ background:"#f3f4f6" }}>{r.plate}</span>
                      </td>

                      {/* LFD */}
                      <td className="px-3 py-3 font-mono text-[11.5px] whitespace-nowrap font-bold"
                        style={{ color: lfdRed ? "#dc2626" : "#374151" }}>
                        {lfdLabel}
                      </td>

                      {/* Free days (live from carriers table) */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {freeDays != null
                          ? <div>
                              <span className="font-mono text-[11.5px] text-neutral-700 font-semibold">{freeDays}d</span>
                              {detBasis && <div className="text-[9.5px] text-neutral-400 capitalize">{detBasis}</div>}
                            </div>
                          : <span className="text-neutral-300 text-[11px]">—</span>}
                      </td>

                      {/* Hold */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.hold
                          ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#fef2f2] text-[#dc2626] capitalize">{r.hold}</span>
                          : <span className="text-[11px] text-neutral-300">—</span>}
                      </td>

                      {/* Gate status */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold"
                          style={{ background: gBg, color: gFg }}>
                          {gateStateLabel[r.gateStatus] ?? r.gateStatus}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
