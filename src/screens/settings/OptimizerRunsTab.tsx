import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useData } from "@/lib/DataContext"
import { backendApi } from "@/lib/backend-api"
import type { BackendOptimizerRun } from "@/lib/backend-api"

type SaveStatus = "idle" | "saving" | "success" | "error"

const OPTIMIZER_LEVELS: Array<{ label: string; desc: string; trials: number }> = [
  { label: "Quick",    desc: "~5 trials — completes in seconds",       trials: 5  },
  { label: "Balanced", desc: "~20 trials — recommended, ~1–2 minutes", trials: 20 },
  { label: "Thorough", desc: "~50 trials — may take 5+ minutes",       trials: 50 },
]

const DEMO_RUN: Omit<BackendOptimizerRun, "id" | "best_score" | "applied_at" | "best_knobs" | "created_at" | "completed_at" | "total_trials"> = {
  status: "completed", batch_size: 5, replay_sample_size: 10,
  replay_window_days: 7, data_source: "historical", replay_plan_ids: null,
  error_message: null,
}

const DEMO_RUN_HISTORY: BackendOptimizerRun[] = [
  { ...DEMO_RUN, id: 7, total_trials: 20, best_score: 0.87, applied_at: "2026-08-11T21:30:00Z", best_knobs: { candidate_k: 12, num_search_workers: 4, tier_multiplier: 1.4 }, created_at: "2026-08-11T21:28:00Z", completed_at: "2026-08-11T21:30:00Z" },
  { ...DEMO_RUN, id: 6, total_trials: 50, best_score: 0.84, applied_at: null,                   best_knobs: { candidate_k: 8,  num_search_workers: 6, tier_multiplier: 1.6 }, created_at: "2026-08-10T14:00:00Z", completed_at: "2026-08-10T14:07:00Z" },
  { ...DEMO_RUN, id: 5, total_trials: 5,  best_score: 0.79, applied_at: null,                   best_knobs: { candidate_k: 10, num_search_workers: 4, tier_multiplier: 1.5 }, created_at: "2026-08-09T09:15:00Z", completed_at: "2026-08-09T09:16:00Z" },
]

export default function OptimizerRunsTab() {
  const { backendConnected } = useData()

  const [activeRun,      setActiveRun]      = useState<BackendOptimizerRun | null>(null)
  const [runHistory,     setRunHistory]     = useState<BackendOptimizerRun[]>([])
  const [optimizerBusy,  setOptimizerBusy]  = useState(false)
  const [optimizerError, setOptimizerError] = useState<string | null>(null)
  const [applyStatus,    setApplyStatus]    = useState<SaveStatus>("idle")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!backendConnected) {
      setRunHistory(DEMO_RUN_HISTORY)
      return
    }
    // DEFERRED: no backend route yet — backendApi.listOptimizerRuns()
    // Demo history already set above via DEMO_RUN_HISTORY
  }, [backendConnected])

  // Poll active run (backend only)
  useEffect(() => {
    if (!backendConnected || !activeRun || (activeRun.status !== "pending" && activeRun.status !== "running")) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        // DEFERRED: no backend route yet — backendApi.getOptimizerRun(activeRun.id)
      } catch (err) { console.error("[Settings] poll optimizer run:", err) }
    }, 3000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [backendConnected, activeRun?.id, activeRun?.status])

  async function startOptimizerRun(trials: number) {
    setOptimizerBusy(true); setOptimizerError(null)
    if (!backendConnected) {
      // Demo mode — simulate a run completing
      await new Promise(r => setTimeout(r, 800))
      const demoRun: BackendOptimizerRun = {
        ...DEMO_RUN,
        id: runHistory.length + 8, total_trials: trials,
        best_score: +(0.80 + Math.random() * 0.12).toFixed(2), applied_at: null,
        best_knobs: { candidate_k: 10 + Math.floor(Math.random() * 5), num_search_workers: 4, tier_multiplier: 1.5 },
        created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      }
      setActiveRun(demoRun)
      setRunHistory(prev => [demoRun, ...prev])
      setOptimizerBusy(false)
      return
    }
    try {
      // DEFERRED: no backend route yet — backendApi.startOptimizerRun({ total_trials: trials })
    } catch (err) {
      setOptimizerError(err instanceof Error ? err.message : "Failed to start optimizer run")
    } finally { setOptimizerBusy(false) }
  }

  async function applyOptimizerRun(id: number) {
    setApplyStatus("saving")
    if (!backendConnected) {
      await new Promise(r => setTimeout(r, 500))
      setRunHistory(prev => prev.map(r => r.id === id ? { ...r, applied_at: new Date().toISOString() } : r))
      setApplyStatus("success")
      setTimeout(() => setApplyStatus("idle"), 3000)
      return
    }
    try {
      // DEFERRED: no backend route yet — backendApi.applyOptimizerRun(id)
      setApplyStatus("success")
    } catch (err) {
      console.error("[Settings] apply optimizer run:", err); setApplyStatus("error")
    }
    setTimeout(() => setApplyStatus("idle"), 4000)
  }

  const statusColor = (s: string) =>
    s === "completed" ? "#059669" : s === "failed" || s === "cancelled" ? "#dc2626" : "#d97706"

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {!backendConnected && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[#e5e7eb] bg-[#fffbeb]">
          <span className="text-[11px] font-semibold text-amber-700">Demo mode — new runs simulate locally and are not persisted</span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(380px,1fr) minmax(320px,1fr)" }}>

        {/* Left — start + active run */}
        <div className="border-r border-[#e5e7eb] overflow-auto pb-6">
          <div className="px-5 pt-4 pb-1 font-semibold text-[13px]">Run auto-tune</div>
          <div className="px-5 text-[11.5px] text-neutral-500 pb-3">
            The engine tests different solver knob combinations and finds the set that scores highest on your current yard data.
          </div>
          <div className="px-5 pb-4 flex flex-col gap-2">
            {OPTIMIZER_LEVELS.map(({ label, desc, trials }) => (
              <button key={label} onClick={() => startOptimizerRun(trials)}
                disabled={optimizerBusy || (!!activeRun && (activeRun.status === "pending" || activeRun.status === "running"))}
                className="text-left px-4 py-3 border border-neutral-200 hover:border-neutral-400 hover:bg-[#f9fafb] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderRadius: 5 }}>
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-[13px]">{label}</span>
                  <span className="font-mono text-[10px] text-neutral-400">{trials} trials</span>
                </div>
                <div className="text-[11.5px] text-neutral-500 mt-0.5">{desc}</div>
              </button>
            ))}
          </div>

          {optimizerError && (
            <div className="mx-5 mb-3 px-3 py-2 border text-[12px]" style={{ background: "#fef2f2", borderColor: "#dc2626", color: "#dc2626" }}>
              {optimizerError}
            </div>
          )}

          {/* Active run card */}
          {activeRun && (
            <div className="px-5">
              <div className="font-semibold text-[13px] mb-2">Current run</div>
              <div className="border border-neutral-200 px-4 py-4 bg-white" style={{ borderRadius: 5 }}>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="font-semibold text-[14px]">Run #{activeRun.id}</span>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: statusColor(activeRun.status) }}>
                    {activeRun.status}
                  </span>
                </div>

                {(activeRun.status === "running" || activeRun.status === "completed") && (
                  <div className="text-[12px] text-neutral-600 mb-1">
                    {activeRun.total_trials} trials
                    {activeRun.best_score != null && <> · best score <strong className="font-mono">{activeRun.best_score.toFixed(2)}</strong></>}
                  </div>
                )}
                {activeRun.status === "pending" && (
                  <div className="text-[12px] text-neutral-500">Queued — waiting for engine capacity…</div>
                )}

                {activeRun.status === "completed" && activeRun.best_knobs && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-neutral-500 mb-1">Best configuration found</div>
                    <div className="bg-[#f9fafb] border border-neutral-200 px-3 py-2 max-h-32 overflow-auto rounded">
                      {Object.entries(activeRun.best_knobs).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-[11px] py-0.5">
                          <span className="text-neutral-600 font-mono">{k}</span>
                          <span className="font-mono font-semibold">{typeof v === "number" ? (Number.isInteger(v) ? v : Number(v).toFixed(3)) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                    {applyStatus === "success" && (
                      <div className="mt-2 px-3 py-2 border text-[12px] font-semibold" style={{ background: "#f0fdf4", borderColor: "#059669", color: "#059669" }}>✓ Applied to solver config</div>
                    )}
                    {applyStatus === "error" && (
                      <div className="mt-2 px-3 py-2 border text-[12px]" style={{ background: "#fef2f2", borderColor: "#dc2626", color: "#dc2626" }}>Apply failed — check console</div>
                    )}
                    <div className="mt-2">
                      <Button size="sm" className="text-xs" style={{ borderRadius: 5 }}
                        onClick={() => applyOptimizerRun(activeRun.id)}
                        disabled={applyStatus === "saving"}>
                        {applyStatus === "saving" ? "Applying…" : "Apply to solver config"}
                      </Button>
                    </div>
                  </div>
                )}

                {(activeRun.status === "pending" || activeRun.status === "running") && (
                  <div className="mt-3">
                    <Button variant="secondary" size="sm" className="text-xs" style={{ borderRadius: 5 }}
                      onClick={() => setActiveRun(prev => prev ? { ...prev, status: "cancelled" } : null)}>
                      Cancel run
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right — run history */}
        <div className="overflow-auto">
          <div className="px-5 pt-4 pb-1 font-semibold text-[13px]">Run history</div>
          {runHistory.length === 0 ? (
            <div className="px-5 py-4 text-[12px] text-neutral-500">No runs yet. Start one on the left.</div>
          ) : (
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  {["Run", "Status", "Trials", "Best score", "Applied"].map(h => (
                    <th key={h} className="ds-th text-left" style={{ paddingLeft: h === "Run" ? 20 : undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runHistory.map(r => (
                  <tr key={r.id} className="border-b border-[#f3f4f6] hover:bg-[#f9fafb]">
                    <td className="py-2 pl-5 pr-3 font-mono font-bold">#{r.id}</td>
                    <td className="px-3 py-2">
                      <span className="font-semibold" style={{ color: statusColor(r.status) }}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{r.total_trials}</td>
                    <td className="px-3 py-2 font-mono">{r.best_score != null ? r.best_score.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 text-neutral-500">
                      {r.applied_at
                        ? <span className="text-[#059669] font-semibold">✓ {new Date(r.applied_at).toLocaleDateString()}</span>
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
