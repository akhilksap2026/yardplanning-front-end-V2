import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useData } from "@/lib/DataContext"
import type { BackendWeight } from "@/lib/backend-api"

const FACTOR_LABELS: Record<string, string> = {
  detention_critical:   "Detention critical (LFD breach)",
  detention_horizon:    "Detention horizon (approaching LFD)",
  appointment_pressure: "Gate & appointment timing",
  customer_priority:    "Customer priority",
  order_priority:       "Order priority",
  dwell_age:            "Dwell age",
  reefer_power_gap:     "Reefer power gap",
  damage_flag:          "Damage / quarantine",
  rehandle_debt:        "Dig-out cost",
  empty_return:         "Empty-return window",
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  detention_critical:   20,
  detention_horizon:    11,
  appointment_pressure: 18,
  customer_priority:    12,
  order_priority:        9,
  dwell_age:             7,
  reefer_power_gap:      6,
  damage_flag:           5,
  rehandle_debt:         5,
  empty_return:          4,
}

const HARD_CONSTRAINTS = [
  { name: "Hazmat separation",    note: "Hazmat containers always isolated — not configurable" },
  { name: "Reefer power supply",  note: "Reefers must be placed near power points — not configurable" },
  { name: "Overweight bay limit", note: "Heavy containers kept to rated bays — not configurable" },
]

function humanize(name: string): string {
  return FACTOR_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

type SaveStatus = "idle" | "saving" | "success" | "error"

export default function PriorityFactorsTab() {
  const { backendConnected, backendWeights, updateWeights } = useData()

  const [localWeights, setLocalWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS)
  const [saveStatus,   setSaveStatus]   = useState<SaveStatus>("idle")
  const [saveWarnings, setSaveWarnings] = useState<string[]>([])

  useEffect(() => {
    if (backendWeights.length === 0) return
    const init: Record<string, number> = {}
    for (const w of backendWeights) {
      if (!w.is_hard_constraint) init[w.factor_name] = w.weight
    }
    if (Object.keys(init).length > 0) setLocalWeights(init)
  }, [backendWeights])

  // Use backend factors when connected, fall back to DEFAULT_WEIGHTS keys
  const softFactors: BackendWeight[] = backendConnected
    ? backendWeights.filter(w => !w.is_hard_constraint)
    : Object.keys(DEFAULT_WEIGHTS).map((k, i) => ({
        id: i + 1, factor_name: k, weight: DEFAULT_WEIGHTS[k],
        is_hard_constraint: false, transform_type: null,
        source_field: null, transform_params: null, null_default: null,
        display_order: i, updated_at: new Date().toISOString(), updated_by: "seed",
      }))

  const hardFactors: BackendWeight[] = backendConnected
    ? backendWeights.filter(w => w.is_hard_constraint)
    : HARD_CONSTRAINTS.map((c, i) => ({
        id: 100 + i, factor_name: c.name.toLowerCase().replace(/ /g, "_"),
        weight: 0, is_hard_constraint: true,
        transform_type: null, source_field: null, transform_params: null, null_default: null,
        display_order: 100 + i, updated_at: new Date().toISOString(), updated_by: "seed",
      }))

  const weightSum = softFactors.reduce((acc, f) => acc + (localWeights[f.factor_name] ?? f.weight), 0)
  const sumOk     = Math.abs(weightSum - 100) < 0.001
  const sumWarn   = weightSum >= 95 && weightSum <= 105
  const sumValid  = weightSum >= 90 && weightSum <= 110
  const sumColor  = sumOk ? "#059669" : sumWarn ? "#d97706" : "#dc2626"

  async function handleSave() {
    if (!backendConnected) { setSaveStatus("success"); setTimeout(() => setSaveStatus("idle"), 3000); return }
    setSaveStatus("saving"); setSaveWarnings([])
    try {
      const payload = softFactors.map(f => ({ factor_name: f.factor_name, weight: localWeights[f.factor_name] ?? f.weight }))
      const result  = await updateWeights(payload)
      if (result) { setSaveWarnings(result.warnings); setSaveStatus("success") }
      else setSaveStatus("error")
    } catch { setSaveStatus("error") }
    setTimeout(() => setSaveStatus("idle"), 4000)
  }

  function handleReset() { setLocalWeights({ ...DEFAULT_WEIGHTS }); setSaveStatus("idle"); setSaveWarnings([]) }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {!backendConnected && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[#e5e7eb] bg-[#fffbeb]">
          <span className="text-[11px] font-semibold text-amber-700">Demo weights — connect the engine to save changes to the live plan</span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(400px,1fr) clamp(260px,26vw,340px)" }}>
        <div className="border-r border-[#e5e7eb] pb-6 overflow-auto">

          <div className="px-5 pt-4 pb-1 flex items-baseline justify-between">
            <span className="font-semibold text-[13px]">Priority factors</span>
            <span className="text-[11px] text-neutral-400">{softFactors.length} factors</span>
          </div>

          {softFactors.map(f => {
            const val   = localWeights[f.factor_name] ?? f.weight
            const dirty = val !== (DEFAULT_WEIGHTS[f.factor_name] ?? f.weight)
            return (
              <div key={f.factor_name} className="px-5 py-2.5 border-b border-[#f3f4f6]">
                <div className="flex justify-between items-baseline text-[12px] mb-1">
                  <span className="font-semibold">{humanize(f.factor_name)}</span>
                  <span className={`font-mono font-bold ${dirty ? "text-[#dc2626]" : "text-neutral-400"}`}>
                    {val % 1 === 0 ? val : val.toFixed(1)}
                  </span>
                </div>
                <input type="range" min={0} max={50} step={0.5} value={val}
                  onChange={e => setLocalWeights(prev => ({ ...prev, [f.factor_name]: +e.target.value }))}
                  className="w-full accent-[#111827]" />
              </div>
            )
          })}

          {hardFactors.length > 0 && (
            <>
              <div className="px-5 pt-4 pb-1">
                <span className="font-semibold text-[13px]">Hard constraints</span>
                <span className="text-[11px] text-neutral-400 ml-2">always enforced · not configurable</span>
              </div>
              {hardFactors.map((f, i) => (
                <div key={f.factor_name} className="px-5 py-2.5 border-b border-[#f3f4f6] flex items-center gap-3">
                  <span className="text-neutral-400 select-none">🔒</span>
                  <div className="text-[12px] font-semibold text-neutral-600">
                    {backendConnected ? humanize(f.factor_name) : HARD_CONSTRAINTS[i]?.name ?? humanize(f.factor_name)}
                  </div>
                  {!backendConnected && (
                    <div className="text-[11px] text-neutral-400 ml-auto">{HARD_CONSTRAINTS[i]?.note}</div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Weight total */}
          <div className="px-5 pt-4 pb-1">
            <div className="flex justify-between text-[11.5px] mb-1">
              <span className="font-semibold">Weight total</span>
              <span className="font-mono font-semibold text-[15px]" style={{ color: sumColor }}>
                {weightSum % 1 === 0 ? weightSum : weightSum.toFixed(1)}
                <span className="text-[11px] font-normal text-neutral-400"> / 100</span>
              </span>
            </div>
            <div className="h-2 bg-neutral-200 rounded overflow-hidden">
              <div className="h-2 transition-all rounded" style={{
                width: Math.min(100, (weightSum / 110) * 100).toFixed(1) + "%",
                background: sumOk ? "#059669" : sumWarn ? "#d97706" : "#dc2626",
              }} />
            </div>
            <div className="text-[10.5px] mt-1" style={{ color: sumColor }}>
              {sumOk ? "✓ Weights sum to exactly 100"
                : sumWarn ? `Within tolerance — ${weightSum < 100 ? (100 - weightSum).toFixed(1) + " short" : (weightSum - 100).toFixed(1) + " over"}`
                : "Outside 90–110 range — save disabled"}
            </div>
          </div>

          {saveWarnings.length > 0 && (
            <div className="mx-5 mt-3 px-3 py-3 border text-[12px] leading-relaxed" style={{ background: "#fffbeb", borderColor: "#d97706", color: "#92400e" }}>
              <div className="font-bold mb-1">Warnings from the engine</div>
              {saveWarnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}
          {saveStatus === "success" && <div className="mx-5 mt-3 px-3 py-2 border text-[12px] font-semibold" style={{ background: "#f0fdf4", borderColor: "#059669", color: "#059669" }}>✓ Weights saved — applied on next plan run</div>}
          {saveStatus === "error"   && <div className="mx-5 mt-3 px-3 py-2 border text-[12px] font-semibold" style={{ background: "#fef2f2", borderColor: "#dc2626", color: "#dc2626" }}>Save failed — check console</div>}

          <div className="px-5 pt-4 pb-2 flex gap-2">
            <Button size="sm" className="text-xs" style={{ borderRadius: 5 }}
              onClick={handleSave} disabled={!sumValid || saveStatus === "saving"}>
              {saveStatus === "saving" ? "Saving…" : "Save weights"}
            </Button>
            <Button variant="secondary" size="sm" className="text-xs" style={{ borderRadius: 5 }} onClick={handleReset}>
              Reset to defaults
            </Button>
          </div>
          <div className="px-5 pb-4 text-[10.5px] text-neutral-400 leading-relaxed">
            Save is disabled when total falls outside 90–110. Changes apply to the next plan generation.
          </div>
        </div>

        {/* Right — factor details */}
        <div className="overflow-auto px-4 py-4">
          <div className="font-semibold text-[13px] mb-3">Factor details</div>
          {softFactors.map(f => (
            <div key={f.factor_name} className="py-2 border-b border-[#f3f4f6] text-[11.5px]">
              <div className="font-semibold">{humanize(f.factor_name)}</div>
              <div className="text-neutral-400 text-[10.5px] mt-0.5 space-y-0.5">
                {f.is_hard_constraint && <div style={{ color: "#d97706" }} className="font-bold">Hard constraint</div>}
                {f.source_field  && <div>Source: <span className="font-mono text-[10px]">{f.source_field}</span></div>}
                {f.transform_type && <div>Transform: {f.transform_type}</div>}
                {f.null_default != null && <div>Null default: <span className="font-mono">{f.null_default}</span></div>}
                <div className="text-neutral-300">Updated {new Date(f.updated_at).toLocaleDateString()} by {f.updated_by}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
