import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const ADAPTERS = [
  { name: "SAP — orders & deliveries",   mechanism: "IDoc DELVRY / ORDERS",    state: "HEALTHY",  delay: "4 s",   errors: 0, note: "Idempotent by delivery number; replay tested" },
  { name: "SAP — goods receipt",         mechanism: "OData, D-03 open",         state: "PENDING",  delay: "—",     errors: 0, note: "Blocked on D-03: does YOS own the receipt posting?" },
  { name: "Terminal 4 BACTSSA",          mechanism: "REST API",                 state: "HEALTHY",  delay: "31 s",  errors: 0, note: "Turnos and gate-out confirmations" },
  { name: "Exolgan Dock Sud",            mechanism: "Portal scrape + manual",   state: "DEGRADED", delay: "18 min",errors: 3, note: "No API — manual entry is a supported path, not a failure" },
  { name: "Carrier EDI",                 mechanism: "COPARN / CODECO / COARRI", state: "PHASE 2",  delay: "—",     errors: 0, note: "Manual master fallback until Phase 2" },
  { name: "ARCA / broker",              mechanism: "Broker system feed",        state: "HEALTHY",  delay: "2 min", errors: 0, note: "Channel, authorisation, libramiento" },
  { name: "Driver ETA (telematics)",     mechanism: "Geofence webhook",         state: "HEALTHY",  delay: "9 s",   errors: 0, note: "Replaces the static 90-minute arrival assumption" },
  { name: "Machine telemetry / RTLS",    mechanism: "CAN + GPS",                state: "PHASE 2",  delay: "—",     errors: 0, note: "Learned travel matrix waits on this" },
  { name: "Weather (wind)",              mechanism: "Weather API",              state: "HEALTHY",  delay: "5 min", errors: 0, note: "Feeds hard constraint on crane operations" },
]

function stateVariant(st: string): "green" | "red" | "muted" {
  return st === "HEALTHY" ? "green" : st === "DEGRADED" ? "red" : "muted"
}

export default function AdapterHealthTab() {
  const [replayed, setReplayed] = useState(false)
  const [degraded, setDegraded] = useState(false)

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="px-5 pt-4 pb-2">
        <div className="font-semibold text-[13.5px]">Data connections</div>
        <div className="text-[11.5px] text-neutral-500 mt-0.5">Live feeds that the planning engine reads. Degraded or pending connections fall back to manual entry.</div>
      </div>

      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {[
              { h: "System",  pl: 20, pr: 12 },
              { h: "Status",  pl: 12, pr: 12 },
              { h: "Delay",   pl: 12, pr: 12 },
              { h: "Errors",  pl: 12, pr: 12 },
              { h: "Notes",   pl: 12, pr: 20 },
            ].map(col => (
              <th key={col.h} className="ds-th text-left"
                style={{ paddingLeft: col.pl, paddingRight: col.pr }}>{col.h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ADAPTERS.map(a => {
            const isRoadmap = a.state === "PENDING" || a.state === "PHASE 2"
            return (
              <tr key={a.name} className="border-b border-[#f3f4f6]"
                style={{
                  borderLeft: `3px solid ${a.state === "DEGRADED" ? "#d97706" : "transparent"}`,
                  opacity:    isRoadmap ? 0.5 : 1,
                }}>
                <td className="py-2.5 pl-5 pr-3">
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-[10.5px] text-neutral-500">{a.mechanism}</div>
                  {isRoadmap && <div className="text-[10px] text-neutral-400 italic mt-0.5">On roadmap</div>}
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={stateVariant(a.state)} className="text-[10px]">{a.state}</Badge>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11.5px]">{a.delay}</td>
                <td className={`px-3 py-2.5 font-mono text-[11.5px] ${a.errors > 0 && !replayed ? "text-[#dc2626] font-bold" : ""}`}>
                  {a.name === "Exolgan Dock Sud" && replayed ? 0 : a.errors}
                </td>
                <td className="px-3 py-2.5 pr-5 text-[11.5px] text-neutral-600 leading-snug">{a.note}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="px-5 py-4 flex gap-2">
        <Button variant="secondary" size="sm" className="text-xs" style={{ borderRadius: 5 }}
          onClick={() => setReplayed(true)}>
          {replayed ? "✓ 3 errors cleared" : "Retry failed messages"}
        </Button>
        <Button variant="ghost" size="sm" className="text-xs" style={{ borderRadius: 5 }}
          onClick={() => setDegraded(!degraded)}>
          {degraded ? "Exit degraded mode" : "Enter degraded mode"}
        </Button>
      </div>
    </div>
  )
}
