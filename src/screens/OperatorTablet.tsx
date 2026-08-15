import { useState, useEffect } from "react"
import { useData }         from "@/lib/DataContext"
import { backendApi }      from "@/lib/backend-api"
import type { BackendMoveDetail } from "@/lib/backend-api"
import { slotAddress, REASON_LABELS } from "@/lib/backend-adapters"
import { useLang }         from "@/lib/i18n"

// ── Design tokens ─────────────────────────────────────────────────────────────
const AMBER   = "#b45309"
const AMBER_L = "#fef3c7"
const NAVY    = "#1c2333"
const GREEN   = "#059669"
const RED     = "#dc2626"

// ── Move-type badge ───────────────────────────────────────────────────────────
function getBadge(reason: string): { bg: string; label: string } {
  const r = reason.toLowerCase()
  if (r.includes("priority"))                                                   return { bg: RED,     label: "⚡ PRIORITY" }
  if (r.includes("retrieval")||r.includes("retrieve")||r.includes("stage outbound")||r.includes("load out"))
                                                                                return { bg:"#2563eb", label: "↑ STACK"    }
  if (r.includes("put")||r.includes("unstack")||r.includes("empty return"))     return { bg: GREEN,   label: "↓ UNSTACK"  }
  if (r.includes("marshal")||r.includes("rehandle")||r.includes("shuffle")||r.includes("pre-marshal")||r.includes("restack"))
                                                                                return { bg:"#d97706", label: "⟳ RESTACK"  }
  return { bg:"#6b7280", label:"→ MOVE" }
}

// ── Types ─────────────────────────────────────────────────────────────────────
type WizardStep = "job-card" | "nav-pickup" | "scan-pickup" | "map" | "complete"
type Overlay    = null | "damage" | "cant-find" | "mismatch" | "equipment"

type DisplayTask = {
  id: string|number; seq: number; container: string
  size?: string; weight?: string; from: string; to: string
  reason: string; warn?: string; est: number
}

// ── Wizard steps (for right-panel reference) ──────────────────────────────────
const FLOW_STEPS = [
  { key:"job-card",    label:"Accept job",      note:"Review task — container ID, FROM/TO, move type. One clear CTA." },
  { key:"nav-pickup",  label:"Go to pickup",    note:"Navigate to FROM location. Large zone/row/bay for cab visibility." },
  { key:"scan-pickup", label:"Scan at pickup",  note:"Camera scan confirms the correct container before the lift starts." },
  { key:"map",         label:"Navigate & drop", note:"Yard map shows route to destination. Tap Complete when delivered." },
]

// ── Damage codes & exception options ──────────────────────────────────────────
const DAMAGE_CODES    = ["CRD-1 dent","CRD-2 scratch","BNT bent","HOL hole","RST rust","BRK broken"]
const CANT_FIND_OPTS  = ["Not at this location","Wrong bay / row","Slot is empty","Container obstructed"]
const EQUIP_OPTS      = ["Mechanical failure","Flat tyre","Hydraulic issue","Lights out","Other"]

// ── SVG icons ─────────────────────────────────────────────────────────────────
function IcoCheck() { return <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }
function IcoCamera(){ return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> }
function IcoWrench() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> }

// ── buildNavTurns — plausible yard turn list from FROM/TO addresses ────────────
function buildNavTurns(from: string, to: string): { icon: string; text: string; sub: string }[] {
  const parts = (addr: string) => addr.split(/[-·\s]+/).map(s => s.trim()).filter(Boolean)
  const fP = parts(from), tP = parts(to)
  const fZ = (fP[0] ?? "A").toUpperCase()
  const tZ = (tP[0] ?? "B").toUpperCase()
  const tRow = tP[1] ?? "01"
  const tBay = tP[2] ?? "01"

  if (/gate|staging/i.test(to)) return [
    { icon: "↑", text: `Exit Zone ${fZ} via exit aisle`,  sub: "in 30 m"     },
    { icon: "↱", text: "Turn right onto Gate Road",        sub: "in 90 m"     },
    { icon: "⊙", text: "Arrive at Gate — check in",        sub: "destination"  },
  ]

  if (fZ === tZ) return [
    { icon: "↑", text: `Head to Row ${tRow} aisle`,     sub: "in 15 m"     },
    { icon: "⊙", text: `Arrive at Bay ${tBay} — ${to}`, sub: "destination"  },
  ]

  const right = tZ > fZ
  return [
    { icon: "↑",             text: `Exit Zone ${fZ} via main aisle`,                      sub: "in 25 m"    },
    { icon: right?"↱":"↰",  text: `Turn ${right?"right":"left"} — Cross Aisle ${tZ}`,    sub: "in 70 m"    },
    { icon: "↑",             text: `Enter Zone ${tZ}, Row ${tRow}`,                       sub: "in 40 m"    },
    { icon: "⊙",             text: `Arrive at Bay ${tBay} — ${to}`,                       sub: "destination" },
  ]
}

// ── NavMap — navigation-style SVG map ─────────────────────────────────────────
function NavMap({ from, to }: { from: string; to: string }) {
  const W = 296, H = 178

  // Cubic bezier route: top-left origin → bottom-right destination
  const x0=50, y0=32, cx1=50, cy1=108, cx2=192, cy2=82, x3=240, y3=152

  // "You" at t≈0.52 on the bezier
  const t = 0.52, it = 1 - t
  const youX = Math.round(it*it*it*x0 + 3*it*it*t*cx1 + 3*it*t*t*cx2 + t*t*t*x3)
  const youY = Math.round(it*it*it*y0 + 3*it*it*t*cy1 + 3*it*t*t*cy2 + t*t*t*y3)

  const fLabel = from.length > 12 ? from.slice(0,12)+"…" : from
  const tLabel = to.length   > 12 ? to.slice(0,12)+"…"   : to
  const fW = Math.min(fLabel.length * 6 + 14, 96)
  const tW = Math.min(tLabel.length * 6 + 14, 96)

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display:"block", width:"100%" }}>
      {/* Map background */}
      <rect width={W} height={H} fill="#d9e8d9" />

      {/* Road grid — horizontal */}
      {[38, 80, 120, 158].map(y => (
        <g key={y}>
          <line x1={0} y1={y} x2={W} y2={y} stroke="#c0d4c0" strokeWidth={7} />
          <line x1={0} y1={y} x2={W} y2={y} stroke="white" strokeWidth={1.2} strokeDasharray="9,7" opacity={0.55} />
        </g>
      ))}
      {/* Road grid — vertical */}
      {[65, 145, 220].map(x => (
        <g key={x}>
          <line x1={x} y1={0} x2={x} y2={H} stroke="#c0d4c0" strokeWidth={7} />
          <line x1={x} y1={0} x2={x} y2={H} stroke="white" strokeWidth={1.2} strokeDasharray="9,7" opacity={0.55} />
        </g>
      ))}

      {/* Route glow */}
      <path d={`M${x0},${y0} C${cx1},${cy1} ${cx2},${cy2} ${x3},${y3}`}
        stroke={GREEN} strokeWidth={12} fill="none" strokeLinecap="round" opacity={0.2} />
      {/* Route line */}
      <path d={`M${x0},${y0} C${cx1},${cy1} ${cx2},${cy2} ${x3},${y3}`}
        stroke={GREEN} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* FROM marker — blue */}
      <circle cx={x0} cy={y0} r={8} fill="#3b82f6" stroke="white" strokeWidth={2.5} />
      {/* FROM label */}
      <rect x={x0+13} y={y0-13} width={fW} height={20} rx={4} fill="white" opacity={0.92} />
      <text x={x0+18} y={y0-1}   fontSize={9}   fontWeight="700" fill="#1e40af">{fLabel}</text>
      <text x={x0+18} y={y0+8.5} fontSize={7.5} fill="#6b7280">origin</text>

      {/* "You" marker — orange truck */}
      <circle cx={youX} cy={youY} r={12} fill="#ea580c" stroke="white" strokeWidth={2.5} />
      <text x={youX} y={youY+5} textAnchor="middle" fontSize={12}>🚚</text>
      {/* You label */}
      <rect x={youX+16} y={youY-11} width={30} height={15} rx={3} fill="white" opacity={0.92} />
      <text x={youX+21} y={youY+0.5} fontSize={9} fontWeight="700" fill="#c2410c">You</text>

      {/* TO marker — green with pulse ring */}
      <circle cx={x3} cy={y3} r={13} fill={GREEN} opacity={0.2} />
      <circle cx={x3} cy={y3} r={8}  fill={GREEN} stroke="white" strokeWidth={2.5} />
      {/* TO label — anchored left so it stays in bounds */}
      <rect x={x3 - tW - 2} y={y3+12} width={tW} height={20} rx={4} fill="white" opacity={0.92} />
      <text x={x3 - tW + 3} y={y3+24} fontSize={9}   fontWeight="700" fill="#065f46">{tLabel}</text>
      <text x={x3 - tW + 3} y={y3+33} fontSize={7.5} fill="#6b7280">destination</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function OperatorTablet() {
  const { operatorTasks, refresh, backendConnected, backendJockeys } = useData()
  const { t } = useLang()

  // ── Task / jockey state ───────────────────────────────────────────────────
  const [selectedJockeyId, setSelectedJockeyId] = useState<number|null>(null)
  const [engineTask,       setEngineTask]       = useState<BackendMoveDetail|null>(null)
  const [fetchingTask,     setFetchingTask]     = useState(false)
  const [noMoreTasks,      setNoMoreTasks]      = useState(false)
  const [queueIdx,         setQueueIdx]         = useState(0)
  const [completedIds,     setCompletedIds]     = useState<Set<string>>(new Set())

  // ── Wizard + overlay state ────────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>("job-card")
  const [overlay,    setOverlay]    = useState<Overlay>(null)

  // ── Scan state ────────────────────────────────────────────────────────────
  const [scanInput,  setScanInput]  = useState("")
  const [scanning,   setScanning]   = useState(false)
  const [scanResult, setScanResult] = useState<{match:boolean;scanned:string;expected:string}|null>(null)

  // ── Completion state ──────────────────────────────────────────────────────
  const [confirming,   setConfirming]   = useState(false)
  const [confirmError, setConfirmError] = useState<string|null>(null)

  // ── Exception state ───────────────────────────────────────────────────────
  const [cantFindReason, setCantFindReason] = useState<string|null>(null)
  const [equipReason,    setEquipReason]    = useState<string|null>(null)
  const [quarantine,     setQuarantine]     = useState(false)

  // ── Damage state ──────────────────────────────────────────────────────────
  const [photoCaptured, setPhotoCaptured] = useState<Record<string,boolean>>({})
  const [selectedDmg,   setSelectedDmg]   = useState<Set<string>>(new Set())

  // ── UI state ──────────────────────────────────────────────────────────────
  const [offline,        setOffline]        = useState(false)
  const [flowExpanded,   setFlowExpanded]   = useState(false)
  const [auditOpen,      setAuditOpen]      = useState(false)
  const [justCompleted,  setJustCompleted]  = useState(false)   // success toast on job-card

  // ── Derived task ──────────────────────────────────────────────────────────
  const seedTask = operatorTasks[queueIdx] ?? operatorTasks[operatorTasks.length-1]
  const displayTask: DisplayTask | null = (() => {
    if (backendConnected && engineTask) return {
      id: engineTask.id, seq: engineTask.sequence_number,
      container: engineTask.container.container_number,
      size: `${engineTask.container.size_ft}ft`, weight: "—",
      from: slotAddress(engineTask.from_slot ?? null),
      to:   slotAddress(engineTask.to_slot),
      reason: REASON_LABELS[engineTask.reason] ?? engineTask.reason,
      warn: engineTask.container.is_hazmat ? `HAZMAT class ${engineTask.container.hazmat_class ?? "?"} — follow hazmat protocol` : undefined,
      est: engineTask.estimated_duration_min,
    }
    if (!backendConnected && seedTask) {
      const s = seedTask as any
      return { id: seedTask.id, seq: parseInt(seedTask.seq)||0, container: seedTask.container??"", size: s.size, weight: s.weight, from: seedTask.from, to: seedTask.to, reason: seedTask.reason, warn: s.warn, est: Number(seedTask.est) }
    }
    return null
  })()

  const jockeyName   = backendConnected ? (backendJockeys.find(j=>j.id===selectedJockeyId)?.name ?? "Operator") : "R. Giménez"
  const initials     = jockeyName.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()
  const equipBadge   = backendConnected ? "RTG #C-3" : "RS-01"
  const pendingCount = backendConnected ? 1 : Math.max(0, operatorTasks.length - completedIds.size)
  const doneCount    = backendConnected ? 47 : completedIds.size

  const currentStepIdx = FLOW_STEPS.findIndex(s => {
    if (wizardStep === "job-card")    return s.key === "job-card"
    if (wizardStep === "nav-pickup")  return s.key === "nav-pickup"
    if (wizardStep === "scan-pickup") return s.key === "scan-pickup"
    return s.key === "map"
  })
  const safeStepIdx = Math.max(0, currentStepIdx)

  const auditEntries = displayTask ? [
    {t:"06:19:20", what:`Job #${displayTask.id} accepted — cycle clock starts`},
    {t:"06:20:05", what:`Navigated to pickup: ${displayTask.from}`},
    {t:"06:21:10", what:`Scan confirmed: ${displayTask.container}`},
    {t:"06:22:30", what:`Navigated to drop: ${displayTask.to}`},
    {t:"06:24:14", what:`Delivery confirmed — actual ${Number(displayTask.est).toFixed(1)}′`},
  ] : []

  // ── Actions ───────────────────────────────────────────────────────────────
  async function fetchNextTask(jockeyId: number) {
    setFetchingTask(true); setNoMoreTasks(false)
    try {
      const move = await backendApi.nextMove(jockeyId)
      if (move) { setEngineTask(move); resetScan() }
      else { setEngineTask(null); setNoMoreTasks(true) }
    } catch { setEngineTask(null); setNoMoreTasks(true) }
    finally { setFetchingTask(false) }
  }

  function resetScan() { setScanInput(""); setScanResult(null) }

  function resetForNextJob() {
    setWizardStep("job-card"); setOverlay(null)
    resetScan(); setQuarantine(false); setCantFindReason(null)
    setPhotoCaptured({}); setSelectedDmg(new Set()); setConfirmError(null)
  }

  useEffect(() => {
    if (backendConnected && selectedJockeyId != null) fetchNextTask(selectedJockeyId)
  }, [backendConnected, selectedJockeyId])

  // justCompleted toast auto-dismiss
  useEffect(() => {
    if (!justCompleted) return
    const t = setTimeout(() => setJustCompleted(false), 2500)
    return () => clearTimeout(t)
  }, [justCompleted])

  // Demo tap-to-scan: auto-fill the correct ID and advance
  async function demoScan() {
    if (!displayTask) return
    const correctId = backendConnected && engineTask
      ? engineTask.container.container_number
      : (seedTask?.container ?? "")
    setScanInput(correctId)
    setScanResult({ match: true, scanned: correctId, expected: correctId })
    setTimeout(() => { setWizardStep("map"); resetScan() }, 900)
  }

  async function handleScan() {
    if (!displayTask || !scanInput.trim()) return
    if (backendConnected && engineTask) {
      setScanning(true)
      try {
        const result = await backendApi.scanMove(engineTask.id, scanInput.trim())
        const res = { match: result.match, scanned: scanInput.trim(), expected: engineTask.container.container_number }
        setScanResult(res)
        if (result.match) setTimeout(() => { setWizardStep("map"); resetScan() }, 900)
        else setOverlay("mismatch")
      } catch {
        const match = scanInput.trim().toUpperCase() === engineTask.container.container_number.toUpperCase()
        const res = { match, scanned: scanInput.trim(), expected: engineTask.container.container_number }
        setScanResult(res)
        if (match) setTimeout(() => { setWizardStep("map"); resetScan() }, 900)
        else setOverlay("mismatch")
      } finally { setScanning(false) }
    } else if (!backendConnected && seedTask) {
      const match = scanInput.trim().toUpperCase() === (seedTask.container??"").toUpperCase()
      const res = { match, scanned: scanInput.trim(), expected: seedTask.container??"" }
      setScanResult(res)
      if (match) setTimeout(() => { setWizardStep("map"); resetScan() }, 900)
      else setOverlay("mismatch")
    }
  }

  async function confirmDelivery() {
    if (!displayTask) return
    setConfirming(true); setConfirmError(null)
    try {
      if (backendConnected && engineTask) {
        await backendApi.completeMove(engineTask.id)
        resetForNextJob(); setJustCompleted(true)
        fetchNextTask(selectedJockeyId!)
      } else {
        await backendApi.completeMoveById(String(displayTask.id))
        await refresh(["moves","containers"])
        setCompletedIds(prev => new Set([...prev, String(displayTask.id)]))
        setQueueIdx(prev => prev + 1)
        resetForNextJob(); setJustCompleted(true)
      }
    } catch (err) {
      setConfirmError(String(err).replace("Error: ",""))
    } finally {
      setConfirming(false)
    }
  }

  // ── Phone frame constant — fixed 680px, never resizes ────────────────────
  const phoneFrame = "w-[340px] flex flex-col overflow-hidden"
  const phoneStyle = { borderRadius:28, height:680, minHeight:680, maxHeight:680, border:`6px solid ${NAVY}` }

  // ══════════════════════════════════════════════════════════════════════════
  // EARLY RETURN: Jockey picker
  // ══════════════════════════════════════════════════════════════════════════
  const availableJockeys = backendJockeys.filter(j => j.status==="available"||j.status==="busy")
  if (backendConnected && selectedJockeyId == null) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">
        <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
          <span className="font-semibold text-[15px] tracking-tight">Operator Tablet</span>
          <span className="text-[11px] text-neutral-500 ml-2">Backend connected — select your jockey</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className={phoneFrame} style={{ ...phoneStyle, background:"#1e3a5f", height:680, minHeight:680, maxHeight:680 }}>
            <div className="flex justify-center pt-3 pb-1 flex-none"><div style={{ width:100, height:24, background:NAVY, borderRadius:12 }} /></div>
            <div className="flex flex-col items-center pt-6 pb-4 flex-none">
              <div className="w-14 h-14 flex items-center justify-center mb-3 font-black text-white text-xl" style={{ background:AMBER, borderRadius:16 }}>YO</div>
              <div className="text-white font-black text-[20px] tracking-tight">YardOS Mobile</div>
              <div className="text-white/60 text-[12px] mt-0.5">Operator app · v3.4</div>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 flex-1">
              <div className="text-white/50 text-[11px] font-semibold tracking-wider text-center mb-1">WHO ARE YOU?</div>
              {availableJockeys.length === 0
                ? <div className="bg-white/10 rounded-xl px-4 py-4 text-white/70 text-[13px] text-center">No jockeys available from engine</div>
                : availableJockeys.slice(0,4).map(j => (
                  <button key={j.id} onClick={() => setSelectedJockeyId(j.id)}
                    className="flex items-center gap-3 text-left px-4 py-3.5 transition-all active:scale-[0.97]"
                    style={{ background:"#fff", borderRadius:12 }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-[13px] text-white flex-none" style={{ background:AMBER }}>
                      {j.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[14px] text-neutral-900">{j.name}</div>
                      <div className="text-[11px] text-neutral-500 capitalize">{j.status} · speed ×{j.speed_factor}</div>
                    </div>
                    <span className="text-neutral-300">›</span>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EARLY RETURN: Loading / idle
  // ══════════════════════════════════════════════════════════════════════════
  if (backendConnected && (fetchingTask || (noMoreTasks && !engineTask))) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">
        <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
          <span className="font-semibold text-[15px] tracking-tight">Operator Tablet</span>
          <button className="ml-auto text-[12px] px-3 py-1.5" style={{ border:"1px solid #e5e7eb", borderRadius:6, color:"#374151" }}
            onClick={() => { setSelectedJockeyId(null); setEngineTask(null) }}>Switch jockey</button>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className={phoneFrame} style={phoneStyle}>
            <div className="flex justify-center pt-3 pb-1 flex-none" style={{ background:AMBER }}><div style={{ width:100, height:22, background:NAVY, borderRadius:12 }} /></div>
            <PhoneAmberHeader initials={initials} name={jockeyName} badge={equipBadge} pending={pendingCount} done={doneCount} />
            <div className="flex-1 flex items-center justify-center px-6 py-8 bg-white">
              {fetchingTask ? (
                <div className="text-center">
                  <div className="text-[32px] mb-3 animate-spin" style={{ color:AMBER }}>⟳</div>
                  <div className="font-semibold text-[15px]">Loading queue…</div>
                  <div className="text-[12px] text-neutral-500 mt-1">Fetching your next move</div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-[40px] mb-3">✓</div>
                  <div className="font-bold text-[16px] mb-1">All done for now</div>
                  <div className="text-[12px] text-neutral-500 leading-relaxed mb-5">No tasks in queue. The planner will assign your next job shortly.</div>
                  <button onClick={() => selectedJockeyId!=null && fetchNextTask(selectedJockeyId)}
                    className="w-full py-3.5 text-white font-bold text-[14px]" style={{ background:AMBER, borderRadius:12 }}>
                    Check again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!displayTask) return null

  const badge = getBadge(displayTask.reason)
  const isHazmat = !!displayTask.warn

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN WIZARD RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">

      {/* ── Desktop toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-[15px] tracking-tight">{t("operator.title")}</span>
          <span className="text-[11px] text-neutral-500">
            {jockeyName} · {backendConnected ? "engine connected" : "shift 06:00–14:00"}
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          {backendConnected && (
            <button style={{ background:"transparent", color:"#374151", border:"1px solid #e5e7eb", borderRadius:5, fontSize:12, padding:"4px 12px" }}
              onClick={() => { setSelectedJockeyId(null); setEngineTask(null) }}>
              Switch jockey
            </button>
          )}
          <button style={{ background:"transparent", color:"#374151", border:"1px solid #e5e7eb", borderRadius:5, fontSize:12, padding:"4px 12px" }}
            onClick={() => { resetForNextJob(); setQueueIdx(0); setCompletedIds(new Set()) }}>
            Restart run
          </button>
          {!backendConnected && (
            <button style={{ background:"#111827", color:"#fff", border:"none", borderRadius:5, fontSize:12, padding:"4px 12px" }}
              onClick={() => setOffline(!offline)}>
              {offline ? "Offline — 3 queued" : "Simulate offline"}
            </button>
          )}
        </div>
      </div>

      <div className="grid flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns:"minmax(360px,440px) minmax(300px,1fr)" }}>

        {/* ── Phone frame ─────────────────────────────────────────────────── */}
        <div className="border-r border-[#e5e7eb] p-6 flex justify-center overflow-auto bg-[#eef0f4]">
          <div className={phoneFrame} style={phoneStyle}>

            {/* Notch */}
            <div className="flex justify-center pt-3 pb-1 flex-none" style={{ background: AMBER }}>
              <div style={{ width:100, height:22, background:NAVY, borderRadius:12 }} />
            </div>

            {/* Amber header */}
            <PhoneAmberHeader
              initials={initials} name={jockeyName} badge={equipBadge}
              pending={pendingCount} done={doneCount}
              onEquipment={() => setOverlay(overlay === "equipment" ? null : "equipment")}
            />

            {/* Offline banner */}
            {offline && (
              <div className="flex-none px-3 py-2 text-[11px] font-semibold flex items-center gap-2"
                style={{ background:"#92400e", color:"#fef3c7" }}>
                <span>●</span> Offline — 3 actions queued, will sync on reconnect
              </div>
            )}

            {/* ── Progress bar ─────────────────────────────────────────── */}
            {true && (
              <div className="flex-none px-4 pt-3 pb-2" style={{ background:"white", borderBottom:"1px solid #f3f4f6" }}>
                <div className="flex gap-1.5 mb-1.5">
                  {FLOW_STEPS.map((s,i) => (
                    <div key={s.key} className="flex-1 h-1.5 rounded-full transition-all"
                      style={{ background: i <= safeStepIdx ? AMBER : "#e5e7eb" }} />
                  ))}
                </div>
                <div className="text-[10px] font-bold tracking-wider" style={{ color: AMBER }}>
                  STEP {safeStepIdx+1} OF {FLOW_STEPS.length} · {FLOW_STEPS[safeStepIdx].label.toUpperCase()}
                </div>
              </div>
            )}

            {/* ── Content (scrollable) ─────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto bg-white relative" style={{ scrollbarWidth:"none" }}>

              {/* ── SCREEN 1: Job Card ───────────────────────────────── */}
              {wizardStep === "job-card" && overlay === null && (
                <div className="flex flex-col">
                  {/* ✓ Previous job saved toast */}
                  {justCompleted && (
                    <div className="flex items-center gap-2 px-4 py-2.5 flex-none"
                      style={{ background: GREEN, color:"#fff" }}>
                      <span className="text-[14px]">✓</span>
                      <span className="text-[12px] font-bold">Job logged — next job ready</span>
                    </div>
                  )}
                  {/* Move type + container ID */}
                  <div className="px-4 pt-5 pb-4 border-b border-[#f3f4f6]">
                    <span className="text-[11px] font-black tracking-wider text-white px-3 py-1 rounded-full"
                      style={{ background: badge.bg }}>
                      {badge.label}
                    </span>
                    <div className="font-mono font-black tracking-tight mt-3 leading-none" style={{ fontSize:30, color:"#111827" }}>
                      {displayTask.container}
                    </div>
                    {(displayTask.size||displayTask.weight) && (
                      <div className="font-mono text-[13px] text-neutral-500 mt-1">
                        {displayTask.size}{displayTask.size&&displayTask.weight?" · ":""}{displayTask.weight}
                      </div>
                    )}
                  </div>

                  {/* FROM → TO */}
                  <div className="grid grid-cols-2 border-b border-[#f3f4f6]">
                    <div className="px-4 py-4 border-r border-[#f3f4f6]">
                      <div className="text-[10px] font-bold tracking-widest text-neutral-400 mb-1">{t("operator.from")}</div>
                      <div className="font-mono font-black text-[20px] text-neutral-900 leading-tight">{displayTask.from}</div>
                    </div>
                    <div className="px-4 py-4">
                      <div className="text-[10px] font-bold tracking-widest text-neutral-400 mb-1">{t("operator.to")}</div>
                      <div className="font-mono font-black text-[20px] text-neutral-900 leading-tight">{displayTask.to}</div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="px-4 py-3 border-b border-[#f3f4f6]" style={{ background:AMBER_L }}>
                    <div className="text-[12.5px] leading-relaxed text-neutral-700">{displayTask.reason}</div>
                  </div>

                  {/* Hazmat warning */}
                  {isHazmat && (
                    <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl flex gap-2 items-start"
                      style={{ background:"#fef2f2", border:`1.5px solid ${RED}` }}>
                      <span className="text-[16px] flex-none">⚠️</span>
                      <span className="text-[12px] font-semibold leading-relaxed" style={{ color:"#7f1d1d" }}>{displayTask.warn}</span>
                    </div>
                  )}

                  {/* Est */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[11px] text-neutral-400">Estimated time</span>
                    <span className="font-mono font-bold text-[14px]" style={{ color:AMBER }}>
                      ~{Number(displayTask.est).toFixed(1) === "NaN" ? "5.0" : Number(displayTask.est).toFixed(1)||"5.0"}′
                    </span>
                  </div>

                  {/* CTA */}
                  <div className="px-4 pt-3 pb-4">
                    <button onClick={() => setWizardStep("nav-pickup")}
                      className="w-full py-4 font-black text-[16px] text-white tracking-tight active:scale-[0.98] transition-transform"
                      style={{ background:AMBER, borderRadius:14 }}>
                      → Accept &amp; go to pickup
                    </button>
                    <button onClick={() => setOverlay("equipment")}
                      className="w-full py-3 mt-2 font-semibold text-[13px]"
                      style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:14 }}>
                      🔧 Report equipment issue
                    </button>
                  </div>

                  {/* ── My Queue ──────────────────────────────────── */}
                  <div style={{ borderTop:`2px solid #f3f4f6` }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background:"#fafafa" }}>
                      <span className="text-[10px] font-black tracking-widest text-neutral-500">MY QUEUE</span>
                      <span className="text-[10px] font-semibold" style={{ color: AMBER }}>
                        {backendConnected
                          ? "engine-managed"
                          : `${Math.max(0, operatorTasks.length - completedIds.size - 1)} more after this`}
                      </span>
                    </div>

                    {/* Current job — highlighted */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f3f4f6]"
                      style={{ background: AMBER_L }}>
                      <span className="text-[9px] font-black tracking-wider text-white px-2 py-0.5 rounded-full flex-none"
                        style={{ background: badge.bg }}>{badge.label}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono font-bold text-[13px] text-neutral-900 truncate">{displayTask.container}</div>
                        <div className="font-mono text-[10.5px] text-neutral-500 truncate">{displayTask.from} → {displayTask.to}</div>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-none"
                        style={{ background: AMBER, color:"#fff" }}>NOW</span>
                    </div>

                    {/* Upcoming jobs (seed mode) */}
                    {!backendConnected && operatorTasks.slice(queueIdx + 1, queueIdx + 5).map((task, i) => {
                      const tb = getBadge(task.reason ?? "")
                      const isDone = completedIds.has(task.id)
                      return (
                        <div key={task.id}
                          className="flex items-center gap-3 px-4 py-2.5 border-b border-[#f9fafb]"
                          style={{ opacity: isDone ? 0.4 : 1 }}>
                          <span className="text-[9px] font-bold tracking-wider text-white px-2 py-0.5 rounded-full flex-none"
                            style={{ background: tb.bg }}>{tb.label}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono font-semibold text-[12px] text-neutral-700 truncate">{task.container ?? "—"}</div>
                            <div className="font-mono text-[10px] text-neutral-400 truncate">{task.from} → {task.to}</div>
                          </div>
                          <span className="text-[10px] text-neutral-400 flex-none font-mono">#{queueIdx + i + 2}</span>
                        </div>
                      )
                    })}

                    {/* Backend mode — queue is engine-managed */}
                    {backendConnected && (
                      <div className="px-4 py-4 text-[11.5px] leading-relaxed text-neutral-400 text-center">
                        Next jobs assigned by the planning engine after each completion.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── SCREEN 2: Navigate to Pickup ─────────────────────── */}
              {wizardStep === "nav-pickup" && overlay === null && (
                <NavScreen
                  heading="Go to pickup"
                  zoneLabel={displayTask.from}
                  container={displayTask.container}
                  badge={badge}
                  ctaLabel="✓  I'm at pickup"
                  onConfirm={() => { setWizardStep("scan-pickup"); resetScan() }}
                  onCantFind={() => setOverlay("cant-find")}
                />
              )}

              {/* ── SCREEN 3: Scan at Pickup ──────────────────────────── */}
              {wizardStep === "scan-pickup" && overlay === null && (
                <div>
                  {/* Target */}
                  <div className="px-4 pt-4 pb-3 border-b border-[#f3f4f6]">
                    <div className="text-[10px] font-bold tracking-widest text-neutral-400 mb-1">SCAN THIS CONTAINER</div>
                    <div className="font-mono font-black text-[24px] text-neutral-900 tracking-tight">{displayTask.container}</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">{displayTask.from} · {badge.label}</div>
                  </div>

                  {/* Camera viewfinder — tap to demo-scan */}
                  <button onClick={demoScan}
                    className="mx-3 mt-4 overflow-hidden w-[calc(100%-24px)] active:opacity-80 transition-opacity"
                    style={{ borderRadius:12, background:"#111", height:188, display:"block", cursor:"pointer" }}>
                    <div className="flex items-center justify-center h-7 text-[9px] font-bold tracking-widest text-white/50"
                      style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                      TAP CAMERA TO SCAN
                    </div>
                    <div className="relative flex items-center justify-center" style={{ height:148 }}>
                      <div style={{ width:130, height:88, border:"2px solid rgba(255,255,255,0.2)", borderRadius:6, position:"relative" }}>
                        {/* Corner accents */}
                        {([[true,true,true,false],[true,true,false,true],[true,false,true,false],[true,false,false,true]] as const).map(([tl,_tr,bl,_br],i) => (
                          <div key={i} style={{
                            position:"absolute",
                            top:   (i<2)?-2:"auto", bottom:(i>=2)?-2:"auto",
                            left:  (i===0||i===2)?-2:"auto", right:(i===1||i===3)?-2:"auto",
                            width:12, height:12,
                            borderTop:   tl?"2px solid #f59e0b":undefined,
                            borderBottom:bl?"2px solid #f59e0b":undefined,
                            borderLeft:  (i===0||i===2)?"2px solid #f59e0b":undefined,
                            borderRight: (i===1||i===3)?"2px solid #f59e0b":undefined,
                          }} />
                        ))}
                        {/* Scan line */}
                        <div className="absolute left-0 right-0" style={{ top:"42%", height:2, background:"#f59e0b", boxShadow:"0 0 8px #f59e0b", borderRadius:1 }} />
                      </div>
                      {/* Tap hint */}
                      {!scanResult && (
                        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                          <span className="text-[9px] font-bold tracking-widest px-3 py-1 rounded-full"
                            style={{ background:"rgba(245,158,11,0.18)", color:"#f59e0b", border:"1px solid rgba(245,158,11,0.35)" }}>
                            TAP TO DEMO SCAN
                          </span>
                        </div>
                      )}
                      {/* Match overlay */}
                      {scanResult?.match && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background:"rgba(5,150,105,0.85)", borderRadius:10 }}>
                          <div className="text-white font-black text-[18px]">✓ CONFIRMED</div>
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Mismatch alert */}
                  {scanResult && !scanResult.match && (
                    <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl text-[12px]"
                      style={{ background:"#fffbeb", border:`1.5px solid #f59e0b`, color:"#92400e" }}>
                      <span className="font-bold">⚠ Mismatch</span> — scanned <span className="font-mono font-bold">{scanResult.scanned}</span>, expected <span className="font-mono font-bold">{scanResult.expected}</span>
                    </div>
                  )}

                  {/* Manual input */}
                  <div className="px-4 pt-4 pb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <IcoCamera />
                      <span className="text-[11px] font-semibold text-neutral-500">Or type manually</span>
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={scanInput}
                        onChange={e => { setScanInput(e.target.value); setScanResult(null) }}
                        onKeyDown={e => e.key==="Enter" && handleScan()}
                        placeholder={displayTask.container}
                        className="flex-1 border border-neutral-300 px-3 py-3 font-mono font-bold tracking-widest uppercase bg-white text-[14px]"
                        style={{ borderRadius:10 }} />
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="px-4 pb-5 pt-2">
                    <button onClick={handleScan} disabled={!scanInput.trim()||scanning}
                      className="w-full py-4 font-black text-[16px] text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
                      style={{ background:AMBER, borderRadius:14 }}>
                      {scanning ? "Scanning…" : "Confirm scan →"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── SCREEN 4: Navigate to drop — nav style ────────────── */}
              {wizardStep === "map" && overlay === null && (() => {
                const estMin  = Math.max(1, Number(displayTask.est) || 5)
                const distM   = Math.round(estMin * 28)
                const turns   = buildNavTurns(displayTask.from, displayTask.to)
                return (
                  <div className="flex flex-col">
                    {/* Current job header — dark */}
                    <div className="px-4 pt-3 pb-3" style={{ background: NAVY }}>
                      <div className="text-[10px] font-bold tracking-widest mb-0.5" style={{ color:"rgba(255,255,255,0.45)" }}>CURRENT JOB</div>
                      <div className="font-mono font-black text-white text-[15px] leading-tight tracking-tight">{displayTask.container}</div>
                      <div className="text-[11px] font-mono mt-0.5" style={{ color:"rgba(255,255,255,0.55)" }}>
                        {displayTask.from} <span style={{ color:"rgba(255,255,255,0.3)" }}>→</span> {displayTask.to}
                      </div>
                    </div>

                    {/* Map */}
                    <NavMap from={displayTask.from} to={displayTask.to} />

                    {/* Stats bar */}
                    <div className="flex border-b border-[#f3f4f6]" style={{ background:"white" }}>
                      {[
                        { val:`${distM} m`,    label:"TOTAL" },
                        { val:`${estMin} min`, label:"ETA"   },
                        { val:"10 km/h",       label:"SPEED" },
                      ].map((s,i) => (
                        <div key={i} className="flex-1 flex flex-col items-center py-3"
                          style={{ borderRight: i < 2 ? "1px solid #f3f4f6" : undefined }}>
                          <div className="font-black text-[16px] text-neutral-900 leading-tight">{s.val}</div>
                          <div className="text-[9px] font-bold tracking-widest text-neutral-400 mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* NEXT TURNS */}
                    <div className="px-4 pt-3 pb-1">
                      <div className="text-[10px] font-black tracking-widest text-neutral-400">NEXT TURNS</div>
                    </div>
                    <div className="flex flex-col divide-y divide-[#f3f4f6]">
                      {turns.map((turn, i) => (
                        <div key={i} className="flex items-start gap-3 px-4 py-3">
                          <div className="flex-none w-8 h-8 rounded-lg flex items-center justify-center text-[15px] font-bold"
                            style={{ background: i === 0 ? AMBER_L : "#f8fafc", border:`1.5px solid ${i === 0 ? AMBER : "#e5e7eb"}`, color: i === 0 ? AMBER : "#9ca3af" }}>
                            {turn.icon}
                          </div>
                          <div className="flex flex-col pt-0.5">
                            <span className="text-[13px] font-bold leading-snug" style={{ color: i < turns.length - 1 ? "#111827" : "#6b7280" }}>{turn.text}</span>
                            <span className="text-[11px] text-neutral-400 mt-0.5">{turn.sub}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Error */}
                    {confirmError && (
                      <div className="mx-4 mt-1 mb-0 px-3 py-2.5 rounded-xl text-[12px]"
                        style={{ background:"#fef2f2", border:`1px solid ${RED}`, color:"#7f1d1d" }}>
                        <span className="font-bold">Save failed:</span> {confirmError}
                      </div>
                    )}

                    {/* CTA */}
                    <div className="px-4 pt-3 pb-5">
                      <button onClick={confirmDelivery} disabled={confirming}
                        className="w-full py-4 font-black text-[17px] text-white disabled:opacity-50 active:scale-[0.98] transition-transform"
                        style={{ background: GREEN, borderRadius:14 }}>
                        {confirming ? "Saving…" : "✓  Arrived — Complete delivery"}
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* ──────────────────────────────────────────────────────── */}
              {/* OVERLAYS (rendered inside the scrollable content area)  */}
              {/* ──────────────────────────────────────────────────────── */}

              {/* Overlay: Can't find container */}
              {overlay === "cant-find" && (
                <div className="absolute inset-0 bg-white flex flex-col z-10">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                    <button onClick={() => setOverlay(null)} className="text-[12px] font-semibold" style={{ color:AMBER }}>← Back</button>
                    <span className="font-bold text-[13px] text-neutral-800">Can't find container</span>
                  </div>
                  <div className="px-4 pt-4 pb-2">
                    <div className="font-mono font-bold text-[16px] text-neutral-900 mb-0.5">{displayTask.container}</div>
                    <div className="text-[12px] text-neutral-500 mb-4">Expected at <span className="font-mono font-bold">{displayTask.from}</span></div>
                    <div className="text-[12px] font-semibold text-neutral-700 mb-2">What's the situation?</div>
                    <div className="flex flex-col gap-2 mb-5">
                      {CANT_FIND_OPTS.map(opt => (
                        <button key={opt} onClick={() => setCantFindReason(opt)}
                          className="text-left px-4 py-3.5 text-[13px] font-semibold transition-all"
                          style={{ borderRadius:12, border:`1.5px solid ${cantFindReason===opt?AMBER:"#e5e7eb"}`, background:cantFindReason===opt?AMBER_L:"white", color:cantFindReason===opt?"#78350f":"#374151" }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {cantFindReason && (
                    <div className="px-4 pb-5 mt-auto">
                      <button onClick={() => { setOverlay(null); setCantFindReason(null) }}
                        className="w-full py-4 font-black text-[15px] text-white mb-2"
                        style={{ background:AMBER, borderRadius:12 }}>
                        Submit report &amp; skip job →
                      </button>
                      <button onClick={() => { setOverlay(null); setCantFindReason(null) }}
                        className="w-full py-3 font-semibold text-[13px]"
                        style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:12 }}>
                        I'll look again
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Overlay: Scan mismatch */}
              {overlay === "mismatch" && (
                <div className="absolute inset-0 bg-white flex flex-col z-10">
                  <div className="px-4 py-4 border-b border-[#f3f4f6]" style={{ background:"#fffbeb" }}>
                    <div className="font-black text-[15px] text-neutral-900 mb-0.5">⚠ Scan mismatch</div>
                    <div className="text-[12px] text-neutral-600">
                      Scanned <span className="font-mono font-bold">{scanResult?.scanned.toUpperCase()}</span>
                      <br/>Expected <span className="font-mono font-bold">{scanResult?.expected}</span>
                    </div>
                  </div>
                  <div className="px-4 py-4 flex flex-col gap-2">
                    <button onClick={() => { setOverlay(null); setScanResult(null); setScanInput("") }}
                      className="w-full py-4 font-black text-[15px] text-white"
                      style={{ background:AMBER, borderRadius:12 }}>
                      Try again →
                    </button>
                    <button onClick={() => { setOverlay(null); setScanResult(null); setScanInput("") }}
                      className="w-full py-3.5 font-semibold text-[13px]"
                      style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:12 }}>
                      This IS the right container
                    </button>
                    <button onClick={() => setOverlay("cant-find")}
                      className="w-full py-3.5 font-semibold text-[13px]"
                      style={{ background:"#fef2f2", color:"#7f1d1d", border:`1.5px solid ${RED}`, borderRadius:12 }}>
                      Wrong container in slot — report
                    </button>
                  </div>
                </div>
              )}

              {/* Overlay: Damage */}
              {overlay === "damage" && (
                <div className="absolute inset-0 bg-white flex flex-col z-10">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                    <button onClick={() => setOverlay(null)} className="text-[12px] font-semibold" style={{ color:AMBER }}>← Back</button>
                    <span className="font-bold text-[13px] text-neutral-800">🚨 Report damage</span>
                    <span className="ml-auto font-mono text-[11px] text-neutral-400">{displayTask.container}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth:"none" }}>
                    {/* Photos */}
                    <div className="px-4 pt-4 pb-2">
                      <div className="text-[11px] font-bold text-neutral-500 mb-2.5 tracking-wider">CAPTURE ALL 4 SIDES</div>
                      <div className="grid grid-cols-2 gap-2">
                        {(["L-SIDE","R-SIDE","DOORS","ROOF"] as const).map(side => (
                          <button key={side} onClick={() => setPhotoCaptured(p => ({ ...p, [side]:!p[side] }))}
                            className="relative flex items-center justify-center transition-all active:scale-[0.97]"
                            style={{ height:84, background:photoCaptured[side]?"#1f2937":"#111", borderRadius:10, border:`1.5px solid ${photoCaptured[side]?GREEN:"#2d2d2d"}` }}>
                            {photoCaptured[side]
                              ? <div className="text-center"><div style={{ color:"#34d399", fontSize:18, marginBottom:2 }}>✓</div><div style={{ color:"#34d399", fontSize:11, fontWeight:700 }}>captured</div></div>
                              : <div style={{ color:"#6b7280", fontSize:22 }}>📷</div>}
                            <div className="absolute bottom-1.5 left-2 text-[9px] font-bold tracking-wider" style={{ color:photoCaptured[side]?"#6ee7b7":"#6b7280" }}>{side}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Damage codes */}
                    <div className="px-4 py-3 border-t border-[#f3f4f6]">
                      <div className="text-[11px] font-bold text-neutral-500 mb-2 tracking-wider">DAMAGE CODES · TAP ALL THAT APPLY</div>
                      <div className="flex flex-wrap gap-1.5">
                        {DAMAGE_CODES.map(code => {
                          const sel = selectedDmg.has(code)
                          return (
                            <button key={code}
                              onClick={() => setSelectedDmg(prev => { const n=new Set(prev); sel?n.delete(code):n.add(code); return n })}
                              className="text-[11px] px-3 py-1.5 font-bold transition-all"
                              style={{ borderRadius:20, border:`1.5px solid ${sel?RED:"#e5e7eb"}`, background:sel?"#fef2f2":"transparent", color:sel?RED:"#374151" }}>
                              {code}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {/* Decision */}
                    <div className="px-4 py-4 border-t border-[#f3f4f6]">
                      <div className="text-[11px] font-bold text-neutral-500 mb-2 tracking-wider">DECISION</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => { setOverlay(null); setPhotoCaptured({}); setSelectedDmg(new Set()) }}
                          className="py-4 font-black text-[13px]"
                          style={{ background:"#f0fdf4", color:"#065f46", border:`1.5px solid ${GREEN}`, borderRadius:12 }}>
                          ✓ PASS<br/><span className="font-semibold text-[11px]">continue job</span>
                        </button>
                        <button onClick={() => { setQuarantine(true); setOverlay(null); setWizardStep("job-card") }}
                          className="py-4 font-black text-[13px]"
                          style={{ background:"#fef2f2", color:"#7f1d1d", border:`1.5px solid ${RED}`, borderRadius:12 }}>
                          ✕ FAIL<br/><span className="font-semibold text-[11px]">quarantine</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Overlay: Equipment issue */}
              {overlay === "equipment" && (
                <div className="absolute inset-0 bg-white flex flex-col z-10">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                    <button onClick={() => setOverlay(null)} className="text-[12px] font-semibold" style={{ color:AMBER }}>← Back</button>
                    <span className="font-bold text-[13px] text-neutral-800">🔧 Equipment issue</span>
                  </div>
                  <div className="px-4 pt-4 pb-2">
                    <div className="text-[12px] text-neutral-600 mb-4 leading-relaxed">
                      Reporting will remove you from the active queue and notify dispatch. Select the type of issue:
                    </div>
                    <div className="flex flex-col gap-2 mb-5">
                      {EQUIP_OPTS.map(opt => (
                        <button key={opt} onClick={() => setEquipReason(opt)}
                          className="text-left px-4 py-3.5 text-[13px] font-semibold transition-all"
                          style={{ borderRadius:12, border:`1.5px solid ${equipReason===opt?RED:"#e5e7eb"}`, background:equipReason===opt?"#fef2f2":"white", color:equipReason===opt?RED:"#374151" }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {equipReason && (
                    <div className="px-4 pb-5 mt-auto">
                      <button onClick={() => { setOverlay(null); setEquipReason(null) }}
                        className="w-full py-4 font-black text-[15px] text-white"
                        style={{ background:RED, borderRadius:12 }}>
                        Report &amp; remove from queue →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Floating damage button (visible during active job steps) */}
              {overlay === null && wizardStep !== "job-card" && (
                <button onClick={() => setOverlay("damage")}
                  className="absolute bottom-4 right-4 w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-transform active:scale-95 z-10"
                  style={{ background:RED, color:"white", fontSize:16 }}
                  title="Report damage">
                  🚨
                </button>
              )}

            </div>{/* end content */}

          </div>{/* end phone frame */}
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 overflow-auto bg-white">

          {/* Step progress */}
          <div className="px-4 py-3 border-b border-[#e5e7eb]">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5 flex-none">
                {FLOW_STEPS.map((_,i) => (
                  <span key={i} className="w-2.5 h-2.5 rounded-full inline-block transition-all"
                    style={{ background: i<safeStepIdx ? AMBER : i===safeStepIdx ? "#111827" : "#e5e7eb" }} />
                ))}
              </div>
              <span className="text-[12.5px] font-semibold text-neutral-700 flex-1">
                Step {safeStepIdx+1} of {FLOW_STEPS.length}: {FLOW_STEPS[safeStepIdx].label}
              </span>
              <button onClick={() => setFlowExpanded(v=>!v)}
                className="flex-none text-[11px] text-neutral-500 hover:text-neutral-800 transition-colors"
                style={{ border:"1px solid #e5e7eb", borderRadius:5, padding:"3px 10px" }}>
                {flowExpanded ? "Hide ▲" : "Show flow ▼"}
              </button>
            </div>
          </div>

          {/* Flow steps expandable */}
          <div style={{ overflow:"hidden", maxHeight:flowExpanded?400:0, transition:"max-height 220ms ease" }}>
            <div className="border-b border-[#e5e7eb]">
              {FLOW_STEPS.map((st,i) => (
                <div key={st.key}
                  className="block w-full text-left px-4 py-3 border-b border-[#f3f4f6]"
                  style={{ borderLeft:`3px solid ${i===safeStepIdx?AMBER:"transparent"}`, background:i===safeStepIdx?AMBER_L:undefined }}>
                  <div className="flex justify-between text-[12.5px] font-semibold">
                    <span style={{ color: i<safeStepIdx ? GREEN : i===safeStepIdx ? "#111827" : "#9ca3af" }}>
                      {i<safeStepIdx ? "✓ " : ""}{st.label}
                    </span>
                    <span className="text-[11px] text-neutral-400 font-mono">{i+1}</span>
                  </div>
                  <div className="text-[11.5px] text-neutral-500 mt-0.5 leading-relaxed">{st.note}</div>
                </div>
              ))}
              {/* Edge cases reference */}
              <div className="px-4 py-3 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                <div className="text-[11px] font-bold text-neutral-400 tracking-wider mb-2">EDGE CASES (floating buttons)</div>
                {[["🚨 Damage","Active during nav + scan steps → 4-photo capture + PASS/FAIL"],["🔧 Equipment","Always in header → issue type → removes from queue"]].map(([l,n]) => (
                  <div key={l} className="mb-1.5"><span className="text-[12px] font-semibold text-neutral-700">{l}</span><div className="text-[11px] text-neutral-500">{n}</div></div>
                ))}
              </div>
            </div>
          </div>

          {/* Audit trail */}
          <button onClick={() => setAuditOpen(v=>!v)}
            className="flex items-center justify-between w-full px-4 py-3 border-b border-[#e5e7eb] hover:bg-[#f9fafb] transition-colors text-left">
            <div className="flex items-center gap-2">
              <span className="ds-label font-bold text-neutral-500">Audit log</span>
              <span className="text-[10px] text-neutral-400">{auditEntries.length} entries</span>
            </div>
            <span style={{ fontSize:9, color:"#9ca3af" }}>{auditOpen?"▲":"▼"}</span>
          </button>
          <div style={{ overflow:"hidden", maxHeight:auditOpen?300:0, transition:"max-height 200ms ease" }}>
            <div className="border-b border-[#e5e7eb]">
              {auditEntries.map(a => (
                <div key={a.t} className="flex gap-3 px-4 py-1.5 text-[11.5px] border-b border-[#f3f4f6]">
                  <span className="w-14 text-neutral-500 font-mono flex-none">{a.t}</span>
                  <span className="flex-1 leading-relaxed">{a.what}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quarantine notice */}
          {quarantine && (
            <div className="mx-4 mt-4 px-3 py-2.5 rounded-xl text-[12px]"
              style={{ background:"#fef2f2", border:`1.5px solid ${RED}`, color:"#7f1d1d" }}>
              <span className="font-bold">Container quarantined</span> — supervisor notified, replan triggered.
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-4 text-[11.5px] text-neutral-400 leading-relaxed max-w-lg">
            {backendConnected
              ? `Connected to planning engine · jockey: ${jockeyName} · scan validation live`
              : "Adoption target: 95% of moves via tablet. Bypass rate reported to supervisor daily."}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Navigate screen (shared for pickup + drop) ─────────────────────────────────
function NavScreen({ heading, zoneLabel, container, badge, ctaLabel, confirming, onConfirm, onCantFind }: {
  heading: string; zoneLabel: string; container: string
  badge: { bg: string; label: string }
  ctaLabel: string; confirming?: boolean
  onConfirm: () => void; onCantFind?: () => void
}) {
  // Parse "A-12-03" → zone / row / bay
  const parts = zoneLabel.split("-")
  const zone  = parts[0] ?? zoneLabel
  const row   = parts[1] ? `Row ${parts[1]}` : ""
  const bay   = parts[2] ? `Bay ${parts[2]}` : ""
  const sub   = [row, bay].filter(Boolean).join(" · ")

  return (
    <div className="flex flex-col px-4 pt-6 pb-5 h-full">
      <div className="text-[11px] font-bold tracking-widest text-neutral-400 mb-1">{heading.toUpperCase()}</div>

      {/* Zone — big */}
      <div className="font-black tracking-tight leading-none mb-1" style={{ fontSize:56, color:"#111827" }}>{zone}</div>
      {sub && <div className="font-mono font-bold text-[18px] text-neutral-500 mb-5">{sub}</div>}

      {/* Container reminder */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-auto"
        style={{ background:"#f9fafb", border:"1px solid #e5e7eb" }}>
        <span className="text-[10px] font-black tracking-wider text-white px-2 py-0.5 rounded-full flex-none" style={{ background:badge.bg }}>{badge.label}</span>
        <span className="font-mono font-bold text-[13px] text-neutral-800">{container}</span>
      </div>

      {/* CTAs */}
      <div className="mt-5">
        <button onClick={onConfirm} disabled={confirming}
          className="w-full py-4 font-black text-[16px] text-white tracking-tight disabled:opacity-40 active:scale-[0.98] transition-transform"
          style={{ background: AMBER, borderRadius:14 }}>
          {confirming ? "Saving…" : ctaLabel}
        </button>
        {onCantFind && (
          <button onClick={onCantFind}
            className="w-full py-3 mt-2 font-semibold text-[13px]"
            style={{ background:"white", color:"#6b7280", border:"1px solid #e5e7eb", borderRadius:14 }}>
            Can't find it →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Amber phone header ─────────────────────────────────────────────────────────
function PhoneAmberHeader({ initials, name, badge, pending, done, onEquipment }: {
  initials: string; name: string; badge: string; pending: number; done: number
  onEquipment?: () => void
}) {
  return (
    <div className="flex-none px-4 pt-3 pb-3" style={{ background: AMBER }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-[11px]"
            style={{ background:"rgba(255,255,255,0.22)", color:"#fff", border:"1.5px solid rgba(255,255,255,0.35)" }}>
            {initials}
          </div>
          <div>
            <div className="text-[9px] font-semibold text-white/60 leading-none">OPERATOR</div>
            <div className="text-[12px] font-black text-white leading-tight">{name}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-[10px] font-bold px-2.5 py-1 rounded-full"
            style={{ background:"rgba(255,255,255,0.18)", color:"#fff", border:"1px solid rgba(255,255,255,0.3)" }}>
            {badge}
          </div>
          {onEquipment && (
            <button onClick={onEquipment}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background:"rgba(255,255,255,0.18)", color:"#fff", border:"1px solid rgba(255,255,255,0.3)" }}
              title="Report equipment issue">
              <IcoWrench />
            </button>
          )}
        </div>
      </div>
      <div className="text-[10px] mt-2" style={{ color:"rgba(255,255,255,0.65)" }}>
        {pending} pending · {done} completed today
      </div>
    </div>
  )
}

// ── buildNavTurns — plausible yard turn list from FROM/TO addresses ────────────
