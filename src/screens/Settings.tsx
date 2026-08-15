import { useState } from "react"
import WeightFactorsTab   from "./settings/WeightFactorsTab"
import PriorityFactorsTab from "./settings/PriorityFactorsTab"
import AdapterHealthTab   from "./settings/AdapterHealthTab"
import MasterDataTab      from "./settings/MasterDataTab"
import RolesTab           from "./settings/RolesTab"
import SolverConfigTab    from "./settings/SolverConfigTab"
import OptimizerRunsTab   from "./settings/OptimizerRunsTab"
import ForecastTab        from "./settings/ForecastTab"
import { useData }        from "@/lib/DataContext"
import { useLang }        from "@/lib/i18n"

type EngineSubTab = "solver" | "optimizer"

export default function SettingsScreen() {
  const [tab, setTab]           = useState("weights")
  const { backendConnected }    = useData()
  const [engineSub, setEngineSub] = useState<EngineSubTab>("solver")
  const [langSaving, setLangSaving] = useState(false)
  const [langSaved,  setLangSaved]  = useState(false)

  const { t, lang, setLang } = useLang()

  const TABS = [
    { id: "weights",    label: t("settings.tab.weights"),     desc: t("settings.tab.weights.desc")     },
    { id: "connections",label: t("settings.tab.connections"), desc: t("settings.tab.connections.desc") },
    { id: "yard",       label: t("settings.tab.yard"),        desc: t("settings.tab.yard.desc")        },
    { id: "roles",      label: t("settings.tab.roles"),       desc: t("settings.tab.roles.desc")       },
    { id: "engine",     label: t("settings.tab.engine"),      desc: t("settings.tab.engine.desc")      },
    { id: "forecast",   label: t("settings.tab.forecast"),    desc: t("settings.tab.forecast.desc")    },
    { id: "language",   label: t("settings.tab.language"),    desc: t("settings.tab.language.desc")    },
  ]

  const active = TABS.find(t => t.id === tab) ?? TABS[0]

  async function handleSetLang(l: "en" | "es") {
    setLangSaving(true)
    setLangSaved(false)
    await setLang(l)
    setLangSaving(false)
    setLangSaved(true)
    setTimeout(() => setLangSaved(false), 2000)
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white text-neutral-900">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-[#e5e7eb] flex-none">
        <div>
          <div className="font-semibold text-[15px] tracking-tight">{t("settings.title")}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">{active.desc}</div>
        </div>
        <div className="ml-auto text-[11px] text-neutral-400">{t("settings.auditNote")}</div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-none border-b border-[#e5e7eb] bg-white overflow-x-auto">
        {TABS.map(tabItem => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id)}
            className="text-[12px] px-5 py-2.5 font-bold whitespace-nowrap transition-colors flex-none"
            style={{
              background:   tab === tabItem.id ? "#111827" : "transparent",
              color:        tab === tabItem.id ? "#fff"    : "#374151",
              borderBottom: tab === tabItem.id ? "2px solid #111827" : "2px solid transparent",
            }}>
            {tabItem.label}
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
                { id: "seed", label: t("settings.demoWeights") },
                { id: "live", label: t("settings.liveWeights") },
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
                  {s.id === "live" && !backendConnected && <span className="ml-1.5 text-[10px] text-neutral-400">{t("common.offline")}</span>}
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
                { id: "solver",    label: t("settings.solverKnobs") },
                { id: "optimizer", label: t("settings.autoTune")    },
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

        {/* ── Language tab ─────────────────────────────────────────────────── */}
        {tab === "language" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div style={{ maxWidth: 480 }}>
              <div className="font-semibold text-[14px] mb-1" style={{ color: "#111827" }}>
                {t("settings.lang.heading")}
              </div>
              <div className="text-[12px] mb-5" style={{ color: "#6b7280" }}>
                {t("settings.lang.desc")}
              </div>

              {/* Language cards */}
              <div className="flex flex-col gap-3">
                {(["en", "es"] as const).map(l => {
                  const isSelected = lang === l
                  const label = l === "en" ? t("settings.lang.selectEn") : t("settings.lang.selectEs")
                  return (
                    <button
                      key={l}
                      onClick={() => handleSetLang(l)}
                      disabled={langSaving}
                      className="flex items-center gap-3 px-4 py-3 text-left disabled:opacity-60"
                      style={{
                        border: `2px solid ${isSelected ? "#4f46e5" : "#e5e7eb"}`,
                        borderRadius: 8,
                        background: isSelected ? "#eef2ff" : "#fafafa",
                      }}
                    >
                      {/* Radio circle */}
                      <span
                        className="flex-none flex items-center justify-center"
                        style={{
                          width: 18, height: 18, borderRadius: 9,
                          border: `2px solid ${isSelected ? "#4f46e5" : "#d1d5db"}`,
                          background: isSelected ? "#4f46e5" : "white",
                        }}
                      >
                        {isSelected && <span style={{ width: 6, height: 6, borderRadius: 3, background: "white", display: "block" }} />}
                      </span>

                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-[13px]" style={{ color: isSelected ? "#4f46e5" : "#111827" }}>
                          {label}
                        </span>
                        <span className="text-[11px]" style={{ color: "#9ca3af" }}>
                          {l === "en" ? "English" : "Español · Latin American"}
                        </span>
                      </div>

                      {isSelected && (
                        <span className="ml-auto text-[11px] font-semibold" style={{ color: "#4f46e5" }}>
                          {t("settings.lang.current")}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Save feedback */}
              {(langSaving || langSaved) && (
                <div className="mt-4 text-[12px]" style={{ color: langSaved ? "#16a34a" : "#6b7280" }}>
                  {langSaving ? t("settings.lang.saving") : t("settings.lang.saved")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
