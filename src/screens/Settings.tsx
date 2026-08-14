import { useState } from "react"
import WeightFactorsTab   from "./settings/WeightFactorsTab"
import PriorityFactorsTab from "./settings/PriorityFactorsTab"
import AdapterHealthTab   from "./settings/AdapterHealthTab"
import MasterDataTab      from "./settings/MasterDataTab"
import RolesTab           from "./settings/RolesTab"
import SolverConfigTab    from "./settings/SolverConfigTab"
import OptimizerRunsTab   from "./settings/OptimizerRunsTab"
import ForecastTab        from "./settings/ForecastTab"
import { useData } from "@/lib/DataContext"

const TABS = [
  { id: "weights",    label: "Priority weights",  desc: "What the engine optimises for"       },
  { id: "connections",label: "Connections",       desc: "Live data feeds & integrations"       },
  { id: "yard",       label: "Yard setup",        desc: "Carriers, zones, operators, holidays" },
  { id: "roles",      label: "Roles & access",    desc: "Who can see and do what"              },
  { id: "engine",     label: "Engine config",     desc: "Solver knobs & auto-tune"             },
  { id: "forecast",   label: "Forecast",          desc: "Capacity outlook"                     },
]

type EngineSubTab = "solver" | "optimizer"

export default function SettingsScreen() {
  const [tab, setTab] = useState("weights")
  const { backendConnected } = useData()
  const [engineSub, setEngineSub] = useState<EngineSubTab>("solver")

  const active = TABS.find(t => t.id === tab)!

  return (
    <div className="flex flex-col h-full min-h-0 bg-white text-neutral-900">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-[#e5e7eb] flex-none">
        <div>
          <div className="font-semibold text-[15px] tracking-tight">Settings</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">{active.desc}</div>
        </div>
        <div className="ml-auto text-[11px] text-neutral-400">Changes are audited · applied on next plan generation</div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-none border-b border-[#e5e7eb] bg-white overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="text-[12px] px-5 py-2.5 font-bold whitespace-nowrap transition-colors flex-none"
            style={{
              background:   tab === t.id ? "#111827" : "transparent",
              color:        tab === t.id ? "#fff"    : "#374151",
              borderBottom: tab === t.id ? "2px solid #111827" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

        {tab === "weights" && (
          <>
            {/* Sub-tabs: seed weights vs live backend weights */}
            <div className="flex border-b border-[#e5e7eb] bg-[#f9fafb] flex-none">
              {[
                { id: "seed", label: "Demo weights" },
                { id: "live", label: "Live engine weights" },
              ].map(s => (
                <button key={s.id}
                  onClick={() => setTab(s.id === "seed" ? "weights-seed" : "weights-live")}
                  className="text-[11px] px-4 py-2 font-semibold transition-colors"
                  style={{
                    background: (s.id === "seed" && tab === "weights") || tab === "weights-" + s.id ? "#fff" : "transparent",
                    color:      (s.id === "seed" && tab === "weights") || tab === "weights-" + s.id ? "#111827" : "#6b7280",
                    borderBottom: (s.id === "seed" && tab === "weights") || tab === "weights-" + s.id ? "2px solid #111827" : "2px solid transparent",
                  }}>
                  {s.label}
                  {s.id === "live" && !backendConnected && <span className="ml-1.5 text-[10px] text-neutral-400">(offline)</span>}
                </button>
              ))}
            </div>
            <WeightFactorsTab />
          </>
        )}

        {tab === "weights-seed" && <WeightFactorsTab />}
        {tab === "weights-live" && <PriorityFactorsTab />}

        {tab === "connections" && <AdapterHealthTab />}
        {tab === "yard"        && <MasterDataTab />}
        {tab === "roles"       && <RolesTab />}

        {tab === "forecast"    && <ForecastTab />}

        {tab === "engine" && (
          <>
            {/* Engine sub-tabs */}
            <div className="flex border-b border-[#e5e7eb] bg-[#f9fafb] flex-none">
              {([
                { id: "solver",    label: "Solver knobs"  },
                { id: "optimizer", label: "Auto-tune"      },
              ] as { id: EngineSubTab; label: string }[]).map(s => (
                <button key={s.id} onClick={() => setEngineSub(s.id)}
                  className="text-[11px] px-4 py-2 font-semibold transition-colors"
                  style={{
                    background:   engineSub === s.id ? "#fff"    : "transparent",
                    color:        engineSub === s.id ? "#111827" : "#6b7280",
                    borderBottom: engineSub === s.id ? "2px solid #111827" : "2px solid transparent",
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
            {engineSub === "solver"    && <SolverConfigTab />}
            {engineSub === "optimizer" && <OptimizerRunsTab />}
          </>
        )}
      </div>
    </div>
  )
}
