import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useData } from "@/lib/DataContext"
import { backendApi } from "@/lib/backend-api"
import type { BackendForecast } from "@/lib/backend-api"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from "recharts"

// Generate demo forecast data so the chart shows without a backend
function buildDemoForecast(months: number, capacity: number): BackendForecast {
  const points: BackendForecast["points"] = []
  const start = new Date("2026-08-14")
  const days   = months * 30
  let firstOver: string | null = null

  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const day = d.toISOString().slice(0, 10)

    // Simulate gradual growth with seasonal variation
    const trend     = 680 + i * 2.8
    const seasonal  = Math.sin((i / 14) * Math.PI) * 60
    const noise     = (Math.sin(i * 7.3) * 30)
    const occupancy = Math.round(Math.max(600, trend + seasonal + noise))
    const over      = occupancy > capacity

    if (over && !firstOver) firstOver = day
    points.push({ day, projected_inbound: Math.round(40 + Math.sin(i * 0.3) * 8), projected_occupancy: occupancy, capacity, over_capacity: over })
  }

  return {
    points,
    first_over_capacity_day: firstOver,
    assumptions: {
      avg_daily_inbound:  42,
      avg_daily_outbound: 38,
      dwell_days_p50:     4.2,
      growth_rate:        "0.9% / week",
      seasonality:        "fortnightly sine",
    },
  }
}

export default function ForecastTab() {
  const { backendConnected, backendSlots } = useData()

  const [fcastMonths,     setFcastMonths]     = useState(3)
  const [fcastCapacity,   setFcastCapacity]   = useState<number>(1124)
  const [fcastResult,     setFcastResult]     = useState<BackendForecast | null>(null)
  const [fcastLoading,    setFcastLoading]    = useState(false)
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)
  const [resetStatus,     setResetStatus]     = useState<"idle"|"resetting"|"done"|"error">("idle")

  // Keep capacity in sync with slot data when backend available
  useEffect(() => {
    if (backendSlots.length > 0) setFcastCapacity(backendSlots.length)
  }, [backendSlots.length])

  // Auto-show demo forecast when backend is not connected
  useEffect(() => {
    if (!backendConnected && !fcastResult) {
      setFcastResult(buildDemoForecast(fcastMonths, fcastCapacity))
    }
  }, [backendConnected])

  async function runForecast() {
    setFcastLoading(true)
    try {
      if (!backendConnected) {
        await new Promise(r => setTimeout(r, 600)) // brief loading feel
        setFcastResult(buildDemoForecast(fcastMonths, fcastCapacity))
      } else {
        const f = await backendApi.forecast(fcastMonths, fcastCapacity)
        setFcastResult(f)
      }
    } catch (err) {
      console.error("[Settings] forecast:", err)
    } finally { setFcastLoading(false) }
  }

  async function resetSeedData() {
    setResetStatus("resetting")
    try {
      await backendApi.resetSeed(true); setResetStatus("done")
    } catch (err) {
      console.error("[Settings] seed reset:", err); setResetStatus("error")
    }
    setTimeout(() => setResetStatus("idle"), 4000)
  }

  // Over-capacity spans for chart shading
  const overSpans: Array<{ x1: string; x2: string }> = []
  if (fcastResult) {
    let spanStart: string | null = null
    for (let i = 0; i < fcastResult.points.length; i++) {
      const p = fcastResult.points[i]
      if (p.over_capacity && !spanStart) spanStart = p.day
      if (!p.over_capacity && spanStart) {
        overSpans.push({ x1: spanStart, x2: fcastResult.points[i - 1].day })
        spanStart = null
      }
    }
    if (spanStart) overSpans.push({ x1: spanStart, x2: fcastResult.points[fcastResult.points.length - 1].day })
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
      {!backendConnected && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 border border-[#e5e7eb] bg-[#fffbeb]" style={{ borderRadius: 5 }}>
          <span className="text-[11px] font-semibold text-amber-700">Demo projection — based on typical yard growth assumptions</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-6 mb-4 border-b border-neutral-200 pb-4">
        <div className="flex flex-col gap-1">
          <label className="ds-label text-neutral-500 font-bold">Forecast horizon</label>
          <div className="flex items-center gap-3">
            <input type="range" min={1} max={12} step={1} value={fcastMonths}
              onChange={e => setFcastMonths(+e.target.value)}
              className="w-40 accent-[#111827]" />
            <span className="font-mono font-bold text-[14px] w-20">{fcastMonths} month{fcastMonths !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="ds-label text-neutral-500 font-bold">Capacity (slots)</label>
          <input type="number" min={1} max={99999} step={1} value={fcastCapacity}
            onChange={e => setFcastCapacity(+e.target.value)}
            className="w-32 h-8 border border-neutral-300 px-2 text-[12px] font-mono font-semibold"
            style={{ borderRadius: 5 }} />
        </div>
        <Button size="sm" className="text-xs" style={{ borderRadius: 5 }} onClick={runForecast} disabled={fcastLoading}>
          {fcastLoading ? "Running…" : "Run forecast"}
        </Button>
      </div>

      {/* Chart */}
      {fcastLoading && (
        <div className="border border-neutral-200 bg-[#f9fafb] px-6 py-10 text-center text-[12px] text-neutral-500 mb-4">
          Running forecast…
        </div>
      )}

      {fcastResult && !fcastLoading && (
        <div className="mb-4">
          {fcastResult.first_over_capacity_day ? (
            <div className="mb-3 px-4 py-2 border text-[12px] flex items-baseline gap-3" style={{ background: "#fffbeb", borderColor: "#d97706", color: "#92400e" }}>
              <span className="font-bold">First over-capacity day:</span>
              <span className="font-mono font-semibold">{fcastResult.first_over_capacity_day}</span>
            </div>
          ) : (
            <div className="mb-3 px-4 py-2 border text-[12px] font-semibold" style={{ background: "#f0fdf4", borderColor: "#059669", color: "#059669" }}>
              ✓ No over-capacity days in this forecast horizon
            </div>
          )}

          <div className="border border-neutral-200 bg-white" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fcastResult.points} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="day" tick={{ fontSize: 9, fill: "#9ca3af" }}
                  tickFormatter={d => d.slice(5)}
                  interval={Math.floor(fcastResult.points.length / 8)}
                />
                <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderColor: "#d1d5db" }}
                  formatter={(val, name) => [val, name === "projected_occupancy" ? "Projected occupancy" : "Capacity"]}
                />
                {overSpans.map(({ x1, x2 }, i) => (
                  <ReferenceArea key={i} x1={x1} x2={x2} fill="#fee2e2" fillOpacity={0.5} />
                ))}
                {fcastResult.first_over_capacity_day && (
                  <ReferenceLine
                    x={fcastResult.first_over_capacity_day}
                    stroke="#dc2626" strokeDasharray="4 3"
                    label={{ value: "First breach", position: "top", fontSize: 9, fill: "#dc2626" }}
                  />
                )}
                <Line type="monotone" dataKey="projected_occupancy" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="capacity" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex gap-5 mt-2 text-[11px] text-neutral-600">
            <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-[#2563eb] inline-block" /> Projected occupancy</span>
            <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-[#dc2626] inline-block" style={{ borderTop: "2px dashed #dc2626" }} /> Capacity</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 inline-block" style={{ background: "#fee2e2", border: "1px solid #fca5a5" }} /> Over capacity</span>
          </div>

          {/* Assumptions */}
          <div className="mt-4 border border-neutral-200" style={{ borderRadius: 5 }}>
            <button onClick={() => setAssumptionsOpen(v => !v)}
              className="w-full text-left px-4 py-2.5 text-[11.5px] font-semibold flex justify-between items-center hover:bg-[#f9fafb] transition-colors">
              <span>Forecast assumptions</span>
              <span className="text-neutral-400">{assumptionsOpen ? "▲" : "▼"}</span>
            </button>
            {assumptionsOpen && (
              <div className="px-4 pb-4 border-t border-neutral-200">
                {Object.entries(fcastResult.assumptions).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-b border-[#f3f4f6] text-[11.5px]">
                    <span className="text-neutral-600">{k.replace(/_/g, " ")}</span>
                    <span className="font-mono font-semibold">{JSON.stringify(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reset seed data */}
      {backendConnected && (
        <div className="border-t border-neutral-200 pt-4 mt-2">
          <div className="font-semibold text-[13px] mb-2">Demo data</div>
          <div className="flex items-center gap-4">
            <Button variant="secondary" size="sm" className="text-xs" style={{ borderRadius: 5 }}
              onClick={resetSeedData} disabled={resetStatus === "resetting"}>
              {resetStatus === "resetting" ? "Resetting…" : "Reset demo data"}
            </Button>
            {resetStatus === "done"  && <span className="text-[12px] font-semibold" style={{ color: "#059669" }}>✓ Seed data reset</span>}
            {resetStatus === "error" && <span className="text-[12px] font-semibold text-[#dc2626]">Reset failed</span>}
          </div>
        </div>
      )}
    </div>
  )
}
