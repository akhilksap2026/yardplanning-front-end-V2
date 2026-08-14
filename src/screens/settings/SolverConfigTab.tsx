import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useData } from "@/lib/DataContext"
import { backendApi } from "@/lib/backend-api"
import type { BackendSolverConfig } from "@/lib/backend-api"

type SaveStatus = "idle" | "saving" | "success" | "error"

const SEARCH_KNOBS: Array<{ key: keyof BackendSolverConfig; label: string; step: number; min: number; max: number; hint: string }> = [
  { key: "num_search_workers",      label: "Search workers",          step: 1,    min: 1,    max: 32,    hint: "Parallel workers the engine runs during planning" },
  { key: "candidate_k",             label: "Candidates per move",     step: 1,    min: 1,    max: 100,   hint: "How many alternative sequences the engine evaluates" },
  { key: "portfolio_variant_count", label: "Plan variants",           step: 1,    min: 1,    max: 20,    hint: "Number of complete plan variants generated before picking the best" },
]

const PHYSICAL_KNOBS: Array<{ key: keyof BackendSolverConfig; label: string; step: number; min: number; max: number; hint: string }> = [
  { key: "base_move_minutes",             label: "Base move time (min)",      step: 0.5,  min: 0.5,  max: 30,    hint: "Assumed time for a single crane or truck move" },
  { key: "max_travel_distance",           label: "Max travel distance",       step: 1,    min: 1,    max: 1000,  hint: "Maximum distance the engine will route a yard truck" },
  { key: "jockey_speed_distance_divisor", label: "Truck speed factor",        step: 0.1,  min: 0.1,  max: 20,    hint: "Calibrates how truck travel time scales with distance" },
  { key: "detention_urgency_window_days", label: "Detention urgency window",  step: 1,    min: 1,    max: 30,    hint: "Days before LFD when detention urgency factor activates" },
  { key: "unplaced_penalty",              label: "Unplaced move penalty",     step: 100,  min: 0,    max: 100000,hint: "Score penalty for any move left unassigned in a plan" },
  { key: "score_scaling_factor",          label: "Score scale",               step: 0.01, min: 0.01, max: 10,    hint: "Multiplier applied to the final planning score" },
  { key: "tier_multiplier",              label: "Stack tier multiplier",      step: 0.1,  min: 0.1,  max: 5,     hint: "Extra cost per additional tier height in the stack" },
]

const DEMO_CONFIG: BackendSolverConfig = {
  id:                            1,
  version:                       3,
  source:                        "manual",
  is_active:                     true,
  created_by:                    "seed",
  tuning_run_id:                 null,
  notes:                         null,
  created_at:                    "2026-08-11T22:14:00Z",
  num_search_workers:            4,
  candidate_k:                   10,
  portfolio_variant_count:       5,
  base_move_minutes:             8,
  gate_bay:                      0,
  gate_row:                      0,
  max_travel_distance:           500,
  jockey_speed_distance_divisor: 5,
  detention_urgency_window_days: 3,
  unplaced_penalty:              10000,
  score_scaling_factor:          1.0,
  tier_multiplier:               1.5,
}

export default function SolverConfigTab() {
  const { backendConnected } = useData()

  const [solverConfig,     setSolverConfig]     = useState<BackendSolverConfig | null>(null)
  const [solverEdits,      setSolverEdits]      = useState<Partial<BackendSolverConfig>>({})
  const [solverLoading,    setSolverLoading]    = useState(false)
  const [solverSaveStatus, setSolverSaveStatus] = useState<SaveStatus>("idle")

  useEffect(() => {
    if (!backendConnected) {
      setSolverConfig(DEMO_CONFIG)
      setSolverEdits({})
      return
    }
    setSolverLoading(true)
    backendApi.getActiveSolverConfig()
      .then(cfg => { setSolverConfig(cfg); setSolverEdits({}) })
      .catch(err => console.error("[Settings] solver config fetch:", err))
      .finally(() => setSolverLoading(false))
  }, [backendConnected])

  function getSolverVal(key: keyof BackendSolverConfig): number {
    if (key in solverEdits) return solverEdits[key] as number
    if (solverConfig)       return solverConfig[key] as number
    return 0
  }

  function setSolverVal(key: keyof BackendSolverConfig, val: number) {
    setSolverEdits(prev => ({ ...prev, [key]: val }))
  }

  async function saveSolverConfig() {
    if (!backendConnected) {
      // Demo mode — apply edits locally
      setSolverConfig(prev => prev ? { ...prev, ...solverEdits } : prev)
      setSolverEdits({})
      setSolverSaveStatus("success")
      setTimeout(() => setSolverSaveStatus("idle"), 3000)
      return
    }
    if (!solverConfig || Object.keys(solverEdits).length === 0) return
    setSolverSaveStatus("saving")
    try {
      const updated = await backendApi.updateSolverConfig(solverEdits)
      setSolverConfig(updated); setSolverEdits({}); setSolverSaveStatus("success")
    } catch (err) {
      console.error("[Settings] solver save:", err); setSolverSaveStatus("error")
    }
    setTimeout(() => setSolverSaveStatus("idle"), 4000)
  }

  if (solverLoading) return <div className="px-5 py-6 text-[12px] text-neutral-500">Loading solver configuration…</div>
  if (!solverConfig) return <div className="px-5 py-6 text-[12px] text-neutral-500">No solver configuration available.</div>

  const editCount = Object.keys(solverEdits).length

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {!backendConnected && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[#e5e7eb] bg-[#fffbeb]">
          <span className="text-[11px] font-semibold text-amber-700">Demo values — connect the engine to persist changes</span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(420px,1fr) clamp(260px,28vw,360px)" }}>
        {/* Left — knob editor */}
        <div className="border-r border-[#e5e7eb] pb-6 overflow-auto">

          {/* Version badge */}
          <div className="px-5 pt-3 pb-3 flex items-center gap-3 border-b border-[#f3f4f6]">
            <div>
              <div className="text-[11px] text-neutral-400 font-semibold uppercase tracking-widest">Active config</div>
              <div className="font-mono font-bold text-[20px]">v{solverConfig.version}</div>
            </div>
            <div className="px-2 py-1 border border-neutral-200 text-[11px] font-semibold uppercase tracking-wider text-neutral-500" style={{ borderRadius: 5 }}>
              {solverConfig.source}
            </div>
            <div className="text-[10.5px] text-neutral-400">
              Created {new Date(solverConfig.created_at).toLocaleDateString()}
            </div>
          </div>

          {/* Search parameters */}
          <div className="px-5 pt-4 pb-1 font-semibold text-[13px]">Search parameters</div>
          {SEARCH_KNOBS.map(({ key, label, step, min, max, hint }) => {
            const val   = getSolverVal(key)
            const dirty = key in solverEdits
            return (
              <div key={key} className="px-5 py-2.5 border-b border-[#f3f4f6]">
                <div className="flex justify-between items-baseline text-[12px] mb-1">
                  <span className="font-semibold">{label}</span>
                  <span className={`font-mono font-bold ${dirty ? "text-[#dc2626]" : "text-neutral-400"}`}>{val}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={val}
                  onChange={e => setSolverVal(key, +e.target.value)}
                  className="w-full accent-[#111827]" />
                <div className="text-[10.5px] text-neutral-400 mt-0.5">{hint}</div>
              </div>
            )
          })}

          {/* Physical calibration */}
          <div className="px-5 pt-4 pb-1 font-semibold text-[13px]">Physical calibration</div>
          {PHYSICAL_KNOBS.map(({ key, label, step, min, max, hint }) => {
            const val   = getSolverVal(key)
            const dirty = key in solverEdits
            return (
              <div key={key} className="px-5 py-2.5 border-b border-[#f3f4f6]">
                <div className="flex justify-between items-baseline text-[12px] mb-1">
                  <span className="font-semibold">{label}</span>
                  <span className={`font-mono font-bold ${dirty ? "text-[#dc2626]" : "text-neutral-400"}`}>
                    {Number.isInteger(val) ? val : Number(val).toFixed(2)}
                  </span>
                </div>
                <input type="range" min={min} max={max} step={step} value={val}
                  onChange={e => setSolverVal(key, +e.target.value)}
                  className="w-full accent-[#111827]" />
                <div className="text-[10.5px] text-neutral-400 mt-0.5">{hint}</div>
              </div>
            )
          })}

          {/* Status & actions */}
          {solverSaveStatus === "success" && (
            <div className="mx-5 mt-3 px-3 py-2 border text-[12px] font-semibold" style={{ background: "#f0fdf4", borderColor: "#059669", color: "#059669" }}>
              ✓ Configuration saved
            </div>
          )}
          {solverSaveStatus === "error" && (
            <div className="mx-5 mt-3 px-3 py-2 border text-[12px] font-semibold" style={{ background: "#fef2f2", borderColor: "#dc2626", color: "#dc2626" }}>
              Save failed — check console
            </div>
          )}
          <div className="px-5 pt-4 pb-2 flex gap-2">
            <Button size="sm" className="text-xs" style={{ borderRadius: 5 }} onClick={saveSolverConfig}
              disabled={editCount === 0 || solverSaveStatus === "saving"}>
              {solverSaveStatus === "saving" ? "Saving…" : editCount > 0 ? `Save (${editCount} change${editCount > 1 ? "s" : ""})` : "Save"}
            </Button>
            <Button variant="secondary" size="sm" className="text-xs" style={{ borderRadius: 5 }}
              disabled={editCount === 0} onClick={() => setSolverEdits({})}>
              Discard changes
            </Button>
          </div>
          <div className="px-5 pb-4 text-[10.5px] text-neutral-400">Changes apply to the next plan generation.</div>
        </div>

        {/* Right — current values summary */}
        <div className="overflow-auto px-4 py-4">
          <div className="font-semibold text-[13px] mb-3">Current values</div>
          {([...SEARCH_KNOBS, ...PHYSICAL_KNOBS]).map(({ key, label }) => {
            const val    = getSolverVal(key)
            const edited = key in solverEdits
            return (
              <div key={key} className="py-2 border-b border-[#f3f4f6] flex justify-between gap-3 text-[11.5px]">
                <span className={`text-neutral-600 ${edited ? "font-semibold" : ""}`}>{label}</span>
                <span className={`font-mono font-semibold ${edited ? "text-[#dc2626]" : ""}`}>
                  {Number.isInteger(val) ? val : Number(val).toFixed(3)}
                  {edited && <span className="ml-1 text-[9px] text-[#dc2626] font-bold">EDITED</span>}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
