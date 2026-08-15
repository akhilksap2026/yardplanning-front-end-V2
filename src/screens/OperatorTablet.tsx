import { useState, useEffect } from "react"
import { useData } from "@/lib/DataContext"
import { backendApi } from "@/lib/backend-api"
import type { BackendMoveDetail } from "@/lib/backend-api"
import { slotAddress, REASON_LABELS } from "@/lib/backend-adapters"
import { OPERATOR_QUEUES } from "@/data/yard-ops"
import { useLang } from "@/lib/i18n"

// ── Design tokens ─────────────────────────────────────────────────────────────
const AMBER   = "#b45309"   // amber-700 — operator header
const AMBER_L = "#fef3c7"   // amber-50  — soft tint
const NAVY    = "#1c2333"   // phone frame border

// ── Move-type badge resolver ──────────────────────────────────────────────────
function getBadge(reason: string): { bg: string; label: string } {
  const r = reason.toLowerCase()
  if (r.includes("priority"))                                              return { bg:"#dc2626", label:"⚡ PRIORITY STACK" }
  if (r.includes("retrieval") || r.includes("retrieve") || r.includes("stage outbound") || r.includes("load out"))
                                                                           return { bg:"#2563eb", label:"↑ STACK" }
  if (r.includes("put") || r.includes("unstack") || r.includes("empty return"))
                                                                           return { bg:"#059669", label:"↓ UNSTACK" }
  if (r.includes("marshal") || r.includes("rehandle") || r.includes("shuffle") || r.includes("pre-marshal") || r.includes("restack"))
                                                                           return { bg:"#d97706", label:"⟳ RESTACK" }
  return { bg:"#6b7280", label:"→ MOVE" }
}

// ── Fake per-slot time labels for the queue list ──────────────────────────────
const QUEUE_TIMES = ["just now", "in 4 min", "in 12 min", "in 22 min", "in 35 min", "in 48 min"]

// ── Steps (kept for right-panel reference) ───────────────────────────────────
const STEPS = [
  { key:"instruction", label:"Instruction",    note:"One instruction per view, large type for cab visibility." },
  { key:"identify",    label:"Identification", note:"Cab OCR read — mismatch blocks the lift." },
  { key:"exception",   label:"Exception path", note:"Supervisor approval with photo and reason code, fully audited." },
  { key:"damage",      label:"Damage",         note:"Photos on the condition record; quarantine flip triggers a replan." },
  { key:"done",        label:"Completion",     note:"Actual duration recorded against the estimate." },
]

type DisplayTask = {
  id: string | number; seq: number; container: string
  size?: string; weight?: string; from: string; to: string
  reason: string; warn?: string; est: number
}
type Tab = "jobs" | "scan" | "inspect" | "activity"

// ── Damage codes ──────────────────────────────────────────────────────────────
const DAMAGE_CODES = ["CRD-1 dent","CRD-2 scratch","BNT bent","HOL hole","RST rust","BRK broken"]

// ── Inline tab icons (SVG paths) ─────────────────────────────────────────────
function IconJobs()     { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="14" height="12" rx="1.5"/><path d="M7 5V4a3 3 0 0 1 6 0v1"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="7" y1="13" x2="11" y2="13"/></svg> }
function IconScan()     { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="13" y="13" width="4" height="4" rx="0.5"/><line x1="3" y1="10" x2="17" y2="10"/></svg> }
function IconInspect()  { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="5"/><path d="m15 15 3 3"/><path d="M7 9h4M9 7v4" strokeLinecap="round"/></svg> }
function IconActivity() { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="3,14 7,9 11,12 17,5"/><line x1="3" y1="17" x2="17" y2="17"/></svg> }

// ─────────────────────────────────────────────────────────────────────────────
export default function OperatorTablet() {
  const { operatorTasks, refresh, backendConnected, backendJockeys } = useData()
  const { t } = useLang()

  // ── Existing state ────────────────────────────────────────────────────────
  const [step,         setStep]         = useState(0)
  const [reason,       setReason]       = useState<string|null>(null)
  const [quarantine,   setQuarantine]   = useState(false)
  const [offline,      setOffline]      = useState(false)
  const [confirming,   setConfirming]   = useState(false)
  const [confirmError, setConfirmError] = useState<string|null>(null)
  const [queueIdx,     setQueueIdx]     = useState(0)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [queueToast,   setQueueToast]   = useState<string|null>(null)
  const [selectedJockeyId, setSelectedJockeyId] = useState<number | null>(null)
  const [engineTask,       setEngineTask]       = useState<BackendMoveDetail | null>(null)
  const [fetchingTask,     setFetchingTask]     = useState(false)
  const [noMoreTasks,      setNoMoreTasks]      = useState(false)
  const [scanInput,   setScanInput]   = useState("")
  const [scanning,    setScanning]    = useState(false)
  const [scanResult,  setScanResult]  = useState<{ match: boolean; scanned: string; expected: string } | null>(null)
  const [flowExpanded, setFlowExpanded] = useState(false)
  const [auditOpen,    setAuditOpen]    = useState(false)

  // ── New tab + view state ─────────────────────────────────────────────────
  const [activeTab,  setActiveTab]  = useState<Tab>("jobs")
  const [jobsView,   setJobsView]   = useState<"list"|"detail">("list")
  const [photoCaptured, setPhotoCaptured] = useState<Record<string,boolean>>({})
  const [selectedDmg,   setSelectedDmg]   = useState<Set<string>>(new Set())

  const go = (i: number) => { setStep(Math.max(0, Math.min(STEPS.length-1, i))); setScanResult(null) }
  const current = STEPS[step]
  const seedTask = operatorTasks[queueIdx] ?? operatorTasks[operatorTasks.length - 1]
  const codes = ["Wrong container in slot","ID plate unreadable","Yard record out of date"]

  const displayTask: DisplayTask | null = (() => {
    if (backendConnected && engineTask) return {
      id: engineTask.id, seq: engineTask.sequence_number,
      container: engineTask.container.container_number,
      size: `${engineTask.container.size_ft}ft`, weight: "—",
      from: slotAddress(engineTask.from_slot ?? null),
      to: slotAddress(engineTask.to_slot),
      reason: REASON_LABELS[engineTask.reason] ?? engineTask.reason,
      warn: engineTask.container.is_hazmat ? `HAZMAT class ${engineTask.container.hazmat_class ?? "?"} — follow hazmat protocol` : "Follow standard lift protocols",
      est: engineTask.estimated_duration_min,
    }
    if (!backendConnected && seedTask) {
      const s = seedTask as any
      return { id: seedTask.id, seq: parseInt(seedTask.seq) || 0, container: seedTask.container ?? "", size: s.size, weight: s.weight, from: seedTask.from, to: seedTask.to, reason: seedTask.reason, warn: s.warn, est: Number(seedTask.est) }
    }
    return null
  })()

  async function fetchNextTask(jockeyId: number) {
    setFetchingTask(true); setNoMoreTasks(false)
    try {
      const move = await backendApi.nextMove(jockeyId)
      if (move) { setEngineTask(move); setScanInput(""); setScanResult(null) }
      else { setEngineTask(null); setNoMoreTasks(true) }
    } catch { setEngineTask(null); setNoMoreTasks(true) }
    finally { setFetchingTask(false) }
  }

  useEffect(() => { if (backendConnected && selectedJockeyId != null) fetchNextTask(selectedJockeyId) }, [backendConnected, selectedJockeyId])

  async function handleScan() {
    if (!displayTask || !scanInput.trim()) return
    if (backendConnected && engineTask) {
      setScanning(true)
      try {
        const result = await backendApi.scanMove(engineTask.id, scanInput.trim())
        setScanResult({ match: result.match, scanned: scanInput.trim(), expected: engineTask.container.container_number })
        if (result.match) setTimeout(() => { go(3); setActiveTab("inspect") }, 800)
      } catch {
        const match = scanInput.trim().toUpperCase() === engineTask.container.container_number.toUpperCase()
        setScanResult({ match, scanned: scanInput.trim(), expected: engineTask.container.container_number })
        if (match) setTimeout(() => { go(3); setActiveTab("inspect") }, 800)
      } finally { setScanning(false) }
    } else if (!backendConnected && seedTask) {
      const match = scanInput.trim().toUpperCase() === (seedTask.container ?? "").toUpperCase()
      setScanResult({ match, scanned: scanInput.trim(), expected: seedTask.container ?? "" })
      if (match) setTimeout(() => { go(3); setActiveTab("inspect") }, 800)
    }
  }

  async function confirmDone() {
    if (!displayTask) return
    setConfirming(true); setConfirmError(null)
    try {
      if (backendConnected && engineTask) {
        await backendApi.completeMove(engineTask.id)
        go(0); setReason(null); setQuarantine(false); setActiveTab("jobs"); setJobsView("list")
        setTimeout(async () => { if (selectedJockeyId != null) await fetchNextTask(selectedJockeyId) }, 2000)
      } else {
        await backendApi.completeMoveById(String(displayTask.id))
        await refresh(["moves","containers"])
        setCompletedIds(prev => new Set([...prev, String(displayTask.id)]))
        setTimeout(() => { setQueueIdx(prev => prev+1); go(0); setReason(null); setQuarantine(false); setScanInput(""); setScanResult(null); setActiveTab("jobs"); setJobsView("list") }, 2000)
      }
    } catch (err) { setConfirmError(String(err).replace("Error: ","")) }
    finally { setConfirming(false) }
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    if (tab === "jobs")     { go(0) }
    if (tab === "scan")     { go(1) }
    if (tab === "inspect")  { go(3) }
    if (tab === "activity") { go(4) }
  }

  function acceptJob() {
    go(1); setActiveTab("scan"); setScanInput(""); setScanResult(null)
  }

  function passInspect() {
    go(4); setActiveTab("activity")
  }

  const jockeyName = backendConnected
    ? (backendJockeys.find(j => j.id === selectedJockeyId)?.name ?? "Operator")
    : "R. Giménez"
  const initials = jockeyName.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase()
  const equipBadge = backendConnected ? "RTG #C-3" : "RS-01"
  const pendingCount = backendConnected ? 1 : Math.max(0, operatorTasks.length - completedIds.size)
  const doneCount    = backendConnected ? 47 : completedIds.size

  const availableJockeys = backendJockeys.filter(j => j.status === "available" || j.status === "busy")

  const auditEntries = displayTask ? [
    {t:"06:19:20", what:"Instruction accepted — job-cycle clock starts"},
    {t:"06:20:05", what:"Cab OCR read, mismatch against "+displayTask.container},
    {t:"06:21:48", what:"Exception raised: "+(reason||"reason code pending")},
    {t:"06:22:11", what:"Supervisor approval, 2 photos attached"},
    {t:"06:24:14", what:"Confirm done — actual "+Number(displayTask.est).toFixed(1)+"′ against "+displayTask.est+"′ estimate"},
  ] : []

  // ── Phone frame class ─────────────────────────────────────────────────────
  const phoneFrame = "w-[340px] self-start flex flex-col overflow-hidden"

  // ── Jockey picker ──────────────────────────────────────────────────────────
  if (backendConnected && selectedJockeyId == null) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">
        <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
          <span className="font-semibold text-[15px] tracking-tight">Operator Tablet</span>
          <span className="text-[11px] text-neutral-500 ml-2">Backend connected — select your jockey to continue</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className={phoneFrame} style={{ borderRadius:28, maxHeight:"min(680px, calc(100vh - 120px))", border:`6px solid ${NAVY}`, background:"#1e3a5f" }}>
            {/* Notch */}
            <div className="flex justify-center pt-3 pb-1 flex-none">
              <div style={{ width:100, height:24, background:NAVY, borderRadius:12 }} />
            </div>
            {/* Logo */}
            <div className="flex flex-col items-center pt-6 pb-4 flex-none">
              <div className="w-14 h-14 flex items-center justify-center mb-3 font-black text-white text-xl"
                style={{ background: AMBER, borderRadius:16 }}>YO</div>
              <div className="text-white font-black text-[20px] tracking-tight">YardOS Mobile</div>
              <div className="text-white/60 text-[12px] mt-0.5">Operator app · v3.4</div>
            </div>
            {/* Role cards */}
            <div className="flex flex-col gap-3 px-5 py-4 flex-1">
              <div className="text-white/50 text-[11px] font-semibold tracking-wider text-center mb-1">SELECT YOUR ROLE</div>
              {availableJockeys.length === 0 ? (
                <div className="bg-white/10 rounded-xl px-4 py-4 text-white/70 text-[13px] text-center">No jockeys available from engine</div>
              ) : (
                availableJockeys.slice(0,4).map(j => (
                  <button key={j.id} onClick={() => setSelectedJockeyId(j.id)}
                    className="flex items-center gap-3 text-left px-4 py-3.5 transition-all"
                    style={{ background:"#fff", borderRadius:12 }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-[13px] text-white flex-none"
                      style={{ background: AMBER }}>
                      {j.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[14px] text-neutral-900">{j.name}</div>
                      <div className="text-[11px] text-neutral-500 capitalize">{j.status} · speed ×{j.speed_factor}</div>
                    </div>
                    <span className="text-neutral-300 text-sm">›</span>
                  </button>
                ))
              )}
            </div>
            {/* Footer */}
            <div className="flex-none px-5 pb-6 text-center">
              <div className="text-white/40 text-[11px]">Signed in as <span className="font-bold text-white/60">{jockeyName}</span> · <span className="text-white/50">switch role</span></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading / no tasks ─────────────────────────────────────────────────────
  if (backendConnected && (fetchingTask || (noMoreTasks && !engineTask))) {
    const jockey = backendJockeys.find(j => j.id === selectedJockeyId)
    return (
      <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">
        <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
          <span className="font-semibold text-[15px] tracking-tight">Operator Tablet</span>
          <span className="text-[11px] text-neutral-500 ml-2">{jockey?.name ?? "Jockey"} · engine connected</span>
          <button className="ml-auto text-[12px] px-3 py-1.5" style={{ border:"1px solid #e5e7eb", borderRadius:6, color:"#374151" }}
            onClick={() => { setSelectedJockeyId(null); setEngineTask(null) }}>Switch jockey</button>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className={phoneFrame} style={{ borderRadius:28, maxHeight:"min(680px, calc(100vh - 120px))", border:`6px solid ${NAVY}` }}>
            {/* Amber header */}
            <PhoneAmberHeader initials={initials} name={jockeyName} badge={equipBadge} pending={pendingCount} done={doneCount} />
            <div className="flex-1 flex items-center justify-center px-6 py-8 bg-white">
              {fetchingTask ? (
                <div className="text-center">
                  <div className="text-[28px] mb-3 animate-spin select-none" style={{ color: AMBER }}>⟳</div>
                  <div className="font-semibold text-[15px]">Loading queue…</div>
                  <div className="text-[12px] text-neutral-500 mt-1">Fetching your next move from the engine</div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-[32px] mb-3">✓</div>
                  <div className="font-semibold text-[15px] mb-1">Queue empty</div>
                  <div className="text-[12px] text-neutral-600 leading-relaxed mb-4">No more tasks assigned. Check back soon or contact the planner.</div>
                  <button onClick={() => selectedJockeyId != null && fetchNextTask(selectedJockeyId)}
                    className="w-full py-3 text-white font-semibold text-[14px]"
                    style={{ background: AMBER, borderRadius:10 }}>
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

  // ── Main view ─────────────────────────────────────────────────────────────
  const badge = getBadge(displayTask.reason)

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto bg-[#f4f5f7] text-neutral-900">

      {/* Desktop toolbar */}
      <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none bg-white">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-[15px] tracking-tight">{t("operator.title")}</span>
          <span className="text-[11px] text-neutral-500">
            {jockeyName} · {backendConnected ? "engine connected" : <><span className="font-mono">RS-01</span> · shift <span className="font-mono">06:00–14:00</span></>}
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
            onClick={() => { setStep(0); setReason(null); setQuarantine(false); setScanInput(""); setScanResult(null); setQueueIdx(0); setCompletedIds(new Set()); setActiveTab("jobs"); setJobsView("list"); setPhotoCaptured({}); setSelectedDmg(new Set()) }}>
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
          <div className={phoneFrame} style={{ borderRadius:28, maxHeight:"min(720px, calc(100vh - 112px))", border:`6px solid ${NAVY}` }}>

            {/* Notch */}
            <div className="flex justify-center pt-3 pb-1 flex-none" style={{ background: AMBER }}>
              <div style={{ width:100, height:22, background:NAVY, borderRadius:12 }} />
            </div>

            {/* ── Amber header ── */}
            <PhoneAmberHeader initials={initials} name={jockeyName} badge={equipBadge} pending={pendingCount} done={doneCount} />

            {/* ── Content area (flex-1 scrollable) ── */}
            <div className="flex-1 min-h-0 overflow-y-auto bg-white" style={{ scrollbarWidth:"none" }}>

              {/* JOBS TAB */}
              {activeTab === "jobs" && jobsView === "list" && (
                <div>
                  {/* Section header */}
                  <div className="px-4 py-2.5 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                    <div className="text-[10px] font-bold tracking-widest text-neutral-500">
                      TODAY · {operatorTasks.length + (backendConnected ? 13 : 0)} JOBS ASSIGNED · {doneCount} DONE
                    </div>
                  </div>
                  {/* Task cards */}
                  {operatorTasks.map((task, i) => {
                    const isDone = completedIds.has(task.id)
                    const isCurrent = i === queueIdx
                    const tb = getBadge(task.reason ?? "")
                    return (
                      <button key={task.id}
                        onClick={() => {
                          if (isDone) return
                          if (!isCurrent) { setQueueToast("Task locked — complete the current task first"); setTimeout(()=>setQueueToast(null),2500); return }
                          setJobsView("detail")
                        }}
                        className="w-full text-left px-4 py-3 border-b border-[#f3f4f6] transition-colors"
                        style={{ background: isCurrent && !isDone ? "#fffbeb" : "white", opacity: isDone ? 0.45 : 1 }}>
                        <div className="flex items-start gap-3">
                          {/* Left accent bar */}
                          <div className="w-0.5 self-stretch mt-0.5 flex-none rounded-full" style={{ background: isCurrent && !isDone ? tb.bg : "#e5e7eb" }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[9.5px] font-bold tracking-wider text-white px-2 py-0.5 rounded-full" style={{ background: isDone ? "#9ca3af" : tb.bg }}>
                                {isDone ? "✓ DONE" : tb.label}
                              </span>
                              <span className="text-[10px] text-neutral-400 flex-none">
                                {isDone ? "done" : QUEUE_TIMES[i] ?? `in ${i * 10} min`}
                              </span>
                            </div>
                            <div className="font-mono font-bold text-[13px] text-neutral-900 truncate">{task.container ?? "—"} <span className="font-normal text-neutral-500">· {task.reason?.split("/")[0] ?? "—"}</span></div>
                            <div className="text-[11px] text-neutral-500 mt-0.5 font-mono truncate">{task.from} → {task.to}</div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  {backendConnected && (
                    <button className="w-full text-center py-3 text-[12px] font-semibold" style={{ color: AMBER }}>
                      + 8 more jobs queued →
                    </button>
                  )}
                  {queueToast && (
                    <div className="mx-3 mt-1 px-3 py-2 text-[11px]" style={{ background:"#fffbeb", border:"1px solid #fcd34d", color:"#92400e", borderRadius:8 }}>
                      {queueToast}
                    </div>
                  )}
                </div>
              )}

              {/* JOBS TAB — DETAIL (instruction step) */}
              {activeTab === "jobs" && jobsView === "detail" && (
                <div>
                  {/* Back + type badge */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                    <button onClick={() => setJobsView("list")} className="text-[11px] font-semibold" style={{ color: AMBER }}>← Queue</button>
                    <span className="text-neutral-300 text-xs">›</span>
                    <span className="text-[10.5px] font-bold tracking-wider text-white px-2 py-0.5 rounded-full" style={{ background: badge.bg }}>
                      {badge.label}
                    </span>
                    <span className="ml-auto text-[10px] text-neutral-400 font-mono">{displayTask.id}</span>
                  </div>
                  {/* Container ID */}
                  <div className="px-4 py-4 border-b border-[#f3f4f6]">
                    <div className="ds-label text-neutral-500 mb-1">Container</div>
                    <div className="font-mono font-black leading-none tracking-tight" style={{ fontSize:28, color:"#111827" }}>{displayTask.container}</div>
                    {(displayTask.size || displayTask.weight) && (
                      <div className="text-[13px] text-neutral-500 mt-1.5 font-mono">
                        {displayTask.size}{displayTask.size && displayTask.weight ? " · " : ""}{displayTask.weight}
                      </div>
                    )}
                  </div>
                  {/* From → To */}
                  <div className="grid grid-cols-2 border-b border-[#f3f4f6]">
                    <div className="px-4 py-3 border-r border-[#f3f4f6]">
                      <div className="ds-label text-neutral-500 mb-1">{t("operator.from")}</div>
                      <div className="font-mono font-bold text-[17px] text-neutral-900">{displayTask.from}</div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="ds-label text-neutral-500 mb-1">{t("operator.to")}</div>
                      <div className="font-mono font-bold text-[17px] text-neutral-900">{displayTask.to}</div>
                    </div>
                  </div>
                  {/* Reason */}
                  <div className="px-4 py-3 border-b border-[#f3f4f6]" style={{ background: AMBER_L }}>
                    <div className="text-[12.5px] leading-relaxed text-neutral-700">{displayTask.reason}</div>
                  </div>
                  {/* Warning */}
                  {displayTask.warn && (
                    <div className="px-4 py-3 border-b border-[#f3f4f6] flex gap-2.5 items-start">
                      <div className="w-1 self-stretch rounded-full flex-none" style={{ background:"#dc2626" }} />
                      <span className="text-[12.5px] leading-relaxed text-neutral-700">{displayTask.warn}</span>
                    </div>
                  )}
                  {/* Est */}
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-400">Estimated duration</span>
                    <span className="font-mono font-bold text-[14px]" style={{ color: AMBER }}>{Number(displayTask.est).toFixed(1) === "NaN" ? "~5.0" : Number(displayTask.est).toFixed(1) || "5.0"}′</span>
                  </div>
                  {/* CTA */}
                  <div className="px-4 pb-4">
                    <button onClick={acceptJob}
                      className="w-full py-4 font-bold text-[15px] text-white tracking-tight"
                      style={{ background: AMBER, borderRadius:12 }}>
                      Accept and start →
                    </button>
                    <button onClick={() => { go(2); setActiveTab("scan") }}
                      className="w-full py-3 mt-2 font-semibold text-[13px]"
                      style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:12 }}>
                      Report a problem
                    </button>
                  </div>
                </div>
              )}

              {/* SCAN TAB */}
              {activeTab === "scan" && (
                <div>
                  {/* Camera viewfinder */}
                  <div className="mx-3 mt-4 mb-0 overflow-hidden" style={{ borderRadius:12, background:"#111111", height:200 }}>
                    <div className="flex items-center justify-center h-8 text-[9.5px] font-bold tracking-widest text-white/60" style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                      SCANNING CONTAINER · KEEP CODE IN FRAME
                    </div>
                    <div className="relative flex items-center justify-center" style={{ height:152 }}>
                      {/* Viewfinder box */}
                      <div style={{ width:130, height:90, border:"2px solid rgba(255,255,255,0.25)", borderRadius:6, position:"relative" }}>
                        {/* Corner accents */}
                        {[["0","0"],["0","auto"],["auto","0"],["auto","auto"]].map(([t,b],i) => (
                          <div key={i} style={{ position:"absolute", top:t==="0"?-2:"auto", bottom:b==="auto"?undefined:b==="0"?-2:undefined, left:i<2?-2:"auto", right:i>=2?-2:undefined, width:12, height:12, borderTop:t==="0"?"2px solid #f59e0b":undefined, borderBottom:b==="0"?"2px solid #f59e0b":undefined, borderLeft:i<2?"2px solid #f59e0b":undefined, borderRight:i>=2?"2px solid #f59e0b":undefined }} />
                        ))}
                        {/* Scan line */}
                        <div className="absolute left-0 right-0" style={{ top:"40%", height:2, background:"#f59e0b", boxShadow:"0 0 8px #f59e0b", borderRadius:1, opacity: 0.9 }} />
                      </div>
                    </div>
                    {/* Detected at bottom of camera */}
                    {scanResult && (
                      <div className="text-center pb-1 font-mono text-[12px] font-bold" style={{ color:"#f59e0b" }}>
                        {scanResult.scanned.toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Detected info */}
                  <div className="px-4 pt-3 pb-2">
                    <div className="ds-label mb-1" style={{ color: AMBER }}>DETECTED</div>
                    {scanResult ? (
                      <>
                        <div className="font-mono font-black text-[17px] text-neutral-900 tracking-wider">{scanResult.scanned.toUpperCase()}</div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">{displayTask.id} · {displayTask.reason} · expected {displayTask.container}</div>
                        <div className="mt-2 px-3 py-2 text-[12px] leading-snug rounded-lg"
                          style={{ background:scanResult.match?"#f0fdf4":"#fef2f2", color:scanResult.match?"#065f46":"#7f1d1d", border:`1px solid ${scanResult.match?"#059669":"#dc2626"}` }}>
                          {scanResult.match ? "✓ Match confirmed — advancing to inspection…" : `✗ Mismatch: scanned ${scanResult.scanned} — expected ${scanResult.expected}`}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-mono font-black text-[17px] text-neutral-400">—</div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">Point camera at container ID plate</div>
                      </>
                    )}
                  </div>

                  {/* Scan input */}
                  <div className="px-4 py-2 border-t border-[#f3f4f6]">
                    <div className="ds-label text-neutral-400 mb-1.5">Type or scan code</div>
                    <div className="flex gap-2">
                      <input type="text" value={scanInput}
                        onChange={e=>{ setScanInput(e.target.value); setScanResult(null) }}
                        onKeyDown={e=>e.key==="Enter"&&handleScan()}
                        placeholder={displayTask.container}
                        className="flex-1 border border-neutral-300 px-3 py-2 font-mono font-bold tracking-widest uppercase bg-white text-[13px]"
                        style={{ borderRadius:8 }} />
                    </div>
                  </div>

                  {/* Exception section (mismatch) */}
                  {step === 2 && (
                    <div className="px-4 py-3 border-t border-[#f3f4f6]">
                      <div className="text-[12px] font-semibold text-neutral-700 mb-2">Exception — reason code required</div>
                      <div className="flex flex-col gap-1.5 mb-3">
                        {codes.map(c=>(
                          <button key={c} onClick={()=>setReason(c)}
                            className="text-left px-3 py-2.5 text-[12px] transition-colors"
                            style={{ background:reason===c?AMBER:"transparent", color:reason===c?"#fff":"#374151", border:`1px solid ${reason===c?AMBER:"#e5e7eb"}`, borderRadius:8 }}>
                            {c}
                          </button>
                        ))}
                      </div>
                      {reason && (
                        <button onClick={() => { go(3); setActiveTab("inspect") }}
                          className="w-full py-3.5 font-bold text-[14px] text-white"
                          style={{ background: AMBER, borderRadius:10 }}>
                          Submit for supervisor approval
                        </button>
                      )}
                    </div>
                  )}

                  {/* Confirm scan CTA */}
                  {step !== 2 && (
                    <div className="px-4 py-4 border-t border-[#f3f4f6]">
                      <button onClick={handleScan} disabled={!scanInput.trim() || scanning}
                        className="w-full py-4 font-bold text-[15px] text-white disabled:opacity-40"
                        style={{ background: AMBER, borderRadius:12 }}>
                        {scanning ? "Scanning…" : "Confirm scan →"}
                      </button>
                      <button onClick={() => { go(2) }}
                        className="w-full py-3 mt-2 font-semibold text-[13px]"
                        style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:12 }}>
                        Report mismatch
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* INSPECT TAB */}
              {activeTab === "inspect" && (
                <div>
                  {/* Subtitle */}
                  <div className="px-4 py-2.5 border-b border-[#f3f4f6]" style={{ background:"#fafafa" }}>
                    <div className="text-[11px] text-neutral-500">Gate-in inspection · <span className="font-mono">seal #VW-SEAL-{displayTask.seq || 887}423</span></div>
                  </div>

                  {/* Photo grid */}
                  <div className="px-4 pt-4 pb-2">
                    <div className="text-[12px] font-semibold text-neutral-700 mb-2.5">Capture photos · all 4 sides</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(["L-SIDE","R-SIDE","DOORS","ROOF"] as const).map(side => (
                        <button key={side} onClick={() => setPhotoCaptured(p => ({ ...p, [side]: !p[side] }))}
                          className="relative flex items-center justify-center transition-all"
                          style={{ height:82, background: photoCaptured[side] ? "#1f2937" : "#111111", borderRadius:10, border:`1.5px solid ${photoCaptured[side]?"#059669":"#2d2d2d"}` }}>
                          {photoCaptured[side] ? (
                            <div className="text-center">
                              <div className="text-[#34d399] text-[16px] mb-0.5">✓</div>
                              <div className="text-[#34d399] text-[11px] font-semibold">captured</div>
                            </div>
                          ) : (
                            <div className="text-neutral-600 text-[18px]">📷</div>
                          )}
                          <div className="absolute bottom-1.5 left-2 text-[9px] font-bold tracking-wider" style={{ color: photoCaptured[side] ? "#6ee7b7" : "#6b7280" }}>{side}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Damage codes */}
                  <div className="px-4 py-3 border-t border-[#f3f4f6]">
                    <div className="text-[12px] font-semibold text-neutral-700 mb-2">Damage codes · tap any that apply</div>
                    <div className="flex flex-wrap gap-1.5">
                      {DAMAGE_CODES.map(code => {
                        const sel = selectedDmg.has(code)
                        return (
                          <button key={code}
                            onClick={() => setSelectedDmg(prev => { const n = new Set(prev); sel ? n.delete(code) : n.add(code); return n })}
                            className="text-[11px] px-2.5 py-1 font-semibold transition-all"
                            style={{ borderRadius:20, border:`1.5px solid ${sel?"#dc2626":"#e5e7eb"}`, background:sel?"#fef2f2":"transparent", color:sel?"#dc2626":"#374151" }}>
                            {code}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Decision */}
                  <div className="px-4 py-3 border-t border-[#f3f4f6]">
                    <div className="text-[12px] font-semibold text-neutral-700 mb-2">Decision</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={passInspect}
                        className="py-3.5 font-bold text-[13px]"
                        style={{ background:"#f0fdf4", color:"#065f46", border:"1.5px solid #059669", borderRadius:10 }}>
                        ✓ PASS · proceed
                      </button>
                      <button onClick={() => { setQuarantine(true); passInspect() }}
                        className="py-3.5 font-bold text-[13px]"
                        style={{ background:"#fef2f2", color:"#7f1d1d", border:"1.5px solid #dc2626", borderRadius:10 }}>
                        ✕ FAIL · escalate
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ACTIVITY TAB */}
              {activeTab === "activity" && (
                <div>
                  {/* Job cycle summary */}
                  <div className="px-4 py-4 border-b border-[#f3f4f6]">
                    <div className="ds-label text-neutral-500 mb-1">Job cycle</div>
                    <div className="font-mono font-black leading-none" style={{ fontSize:32, color: AMBER }}>
                      {(() => { const n = Number(displayTask.est); return isNaN(n) || n === 0 ? "5.0" : n.toFixed(1) })()}′
                    </div>
                    <div className="text-[12px] text-neutral-500 mt-2 leading-relaxed">
                      Accepted <span className="font-mono">06:19:20</span>, confirmed <span className="font-mono">06:24:14</span>. Actual duration written to the audit record.
                    </div>
                  </div>

                  {/* Done / next-task status */}
                  <div className="px-4 py-4 border-b border-[#f3f4f6]">
                    <div className="text-[12.5px] leading-relaxed text-neutral-700">
                      {backendConnected
                        ? "Completing with the planning engine. Your next task will load in ~2 seconds."
                        : "Next task will be dispatched to your queue by the planner — check the tablet in 30 seconds."}
                    </div>
                    {confirmError && (
                      <div className="mt-3 px-3 py-2 text-[12px] rounded-lg" style={{ background:"#fef2f2", border:"1px solid #dc2626", color:"#7f1d1d" }}>
                        <span className="font-bold">Save failed:</span> {confirmError}. Check connection and try again.
                      </div>
                    )}
                  </div>

                  {/* Confirm done CTA */}
                  <div className="px-4 py-4">
                    <button onClick={confirmDone} disabled={confirming}
                      className="w-full py-4 font-bold text-[15px] text-white disabled:opacity-40"
                      style={{ background: AMBER, borderRadius:12 }}>
                      {confirming ? "Saving…" : "Confirm done"}
                    </button>
                    <button onClick={() => { setActiveTab("jobs"); setJobsView("list") }}
                      className="w-full py-3 mt-2 font-semibold text-[13px]"
                      style={{ background:"white", color:"#374151", border:"1px solid #e5e7eb", borderRadius:12 }}>
                      View my queue
                    </button>
                  </div>

                  {/* Audit trail */}
                  <div className="border-t border-[#f3f4f6]">
                    <div className="px-4 py-2.5" style={{ background:"#fafafa" }}>
                      <div className="ds-label text-neutral-400">AUDIT LOG · {auditEntries.length} entries</div>
                    </div>
                    {auditEntries.map(a => (
                      <div key={a.t} className="flex gap-3 px-4 py-2 border-b border-[#f9fafb] text-[11.5px]">
                        <span className="w-14 text-neutral-400 font-mono flex-none">{a.t}</span>
                        <span className="flex-1 leading-relaxed text-neutral-700">{a.what}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>{/* end content */}

            {/* ── Bottom nav ─────────────────────────────────────────────────── */}
            <div className="flex-none border-t border-[#e5e7eb] bg-white" style={{ borderBottomLeftRadius:22, borderBottomRightRadius:22 }}>
              <div className="grid grid-cols-4">
                {([
                  { tab:"jobs"     as Tab, label:"Jobs",     Icon:IconJobs     },
                  { tab:"scan"     as Tab, label:"Scan",     Icon:IconScan     },
                  { tab:"inspect"  as Tab, label:"Inspect",  Icon:IconInspect  },
                  { tab:"activity" as Tab, label:"Activity", Icon:IconActivity },
                ]).map(({ tab, label, Icon }) => {
                  const active = activeTab === tab
                  return (
                    <button key={tab} onClick={() => {
                        switchTab(tab)
                        if (tab === "jobs") setJobsView("detail")
                      }}
                      className="flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors"
                      style={{ color: active ? AMBER : "#9ca3af", borderTop: active ? `2px solid ${AMBER}` : "2px solid transparent" }}>
                      <Icon />
                      <span className="text-[9.5px] font-semibold">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

          </div>
        </div>

        {/* ── Right panel (step progress + audit) ─────────────────────────── */}
        <div className="flex flex-col min-h-0 overflow-auto bg-white">

          {/* Step progress */}
          <div className="px-4 py-3 border-b border-[#e5e7eb]">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5 flex-none">
                {STEPS.map((_,i)=>(
                  <span key={i} className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ background:i<step?AMBER:i===step?"#111827":"#e5e7eb" }} />
                ))}
              </div>
              <span className="text-[12.5px] font-semibold text-neutral-700 flex-1">
                Step {step+1} of 5: {STEPS[step].label}
              </span>
              <button onClick={()=>setFlowExpanded(v=>!v)}
                className="flex-none text-[11px] text-neutral-500 hover:text-neutral-800 transition-colors"
                style={{ border:"1px solid #e5e7eb", borderRadius:5, padding:"3px 10px" }}>
                {flowExpanded?"Hide ▲":"Show flow ▼"}
              </button>
            </div>
          </div>

          {/* Flow steps */}
          <div style={{ overflow:"hidden", maxHeight:flowExpanded?400:0, transition:"max-height 220ms ease" }}>
            <div className="border-b border-[#e5e7eb]">
              {STEPS.map((st,i)=>(
                <button key={st.key} onClick={()=>{ go(i); if(i===0){setActiveTab("jobs");setJobsView("detail")} else if(i===1||i===2){setActiveTab("scan")} else if(i===3){setActiveTab("inspect")} else{setActiveTab("activity")} }}
                  className="block w-full text-left px-4 py-3 border-b border-[#f3f4f6] hover:bg-[#f9fafb] transition-colors"
                  style={{ borderLeft:`3px solid ${i===step?AMBER:"transparent"}`, background:i===step?AMBER_L:undefined }}>
                  <div className="flex justify-between text-[12.5px] font-semibold">
                    <span>{st.label}</span>
                    <span className="text-[11px] text-neutral-500 font-mono">{i+1}</span>
                  </div>
                  <div className="text-[11.5px] text-neutral-600 mt-0.5 leading-relaxed">{st.note}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Audit trail accordion */}
          <button onClick={()=>setAuditOpen(v=>!v)}
            className="flex items-center justify-between w-full px-4 py-3 border-b border-[#e5e7eb] hover:bg-[#f9fafb] transition-colors text-left">
            <div className="flex items-center gap-2">
              <span className="ds-label font-bold text-neutral-500">Audit log</span>
              <span className="text-[10px] text-neutral-400">{auditEntries.length} entries</span>
            </div>
            <span style={{ fontSize:9, color:"#9ca3af" }}>{auditOpen?"▲":"▼"}</span>
          </button>
          <div style={{ overflow:"hidden", maxHeight:auditOpen?300:0, transition:"max-height 200ms ease" }}>
            <div className="border-b border-[#e5e7eb]">
              {auditEntries.map(a=>(
                <div key={a.t} className="flex gap-3 px-4 py-1.5 text-[11.5px] border-b border-[#f3f4f6]">
                  <span className="w-14 text-neutral-500 font-mono flex-none">{a.t}</span>
                  <span className="flex-1 leading-relaxed">{a.what}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer info */}
          <div className="px-4 py-4 text-[11.5px] text-neutral-500 leading-relaxed max-w-lg">
            {backendConnected
              ? `Connected to planning engine · jockey: ${jockeyName} · scan validation live`
              : "Adoption rate target: 95% of moves executed through the tablet. Bypass rate is reported to the supervisor dashboard daily."}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Shared amber phone header component ───────────────────────────────────────
function PhoneAmberHeader({ initials, name, badge, pending, done }: {
  initials: string; name: string; badge: string; pending: number; done: number
}) {
  return (
    <div className="flex-none px-4 pt-3 pb-4" style={{ background: AMBER }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-[11px]"
            style={{ background:"rgba(255,255,255,0.22)", color:"#fff", border:"1.5px solid rgba(255,255,255,0.35)" }}>
            {initials}
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-white/60 leading-none">Operador</div>
            <div className="text-[12px] font-black text-white leading-tight">{name}</div>
          </div>
        </div>
        {/* Equipment badge */}
        <div className="text-[10px] font-bold px-2.5 py-1 rounded-full"
          style={{ background:"rgba(255,255,255,0.18)", color:"#fff", border:"1px solid rgba(255,255,255,0.3)" }}>
          {badge}
        </div>
      </div>
      <div className="font-black text-white tracking-tight" style={{ fontSize:19, lineHeight:1.2 }}>Active Movements</div>
      <div className="text-[11px] mt-0.5" style={{ color:"rgba(255,255,255,0.65)" }}>
        {pending} pending · {done} completed today
      </div>
    </div>
  )
}
