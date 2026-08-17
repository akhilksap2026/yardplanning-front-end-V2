import { useState } from "react"
import { containerColor } from "@/lib/yard-color"
import type { ColorMode } from "@/lib/yard-color"
import type { ViewContainer } from "./types"

interface Props {
  blockLabel:       string
  zoneName:         string
  slotCol:          number
  rowNum:           number
  maxTiers:         number
  containers:       ViewContainer[]   // all in this slot (one per occupied tier)
  mode:             ColorMode
  onBack:           () => void
  onNavigate?:      (screen: string, focusId?: string) => void
  plannerMode?:     boolean
  onPlannerAction?: (action: string, containerId: string) => void
}

export default function SlotStackView({
  blockLabel, zoneName, slotCol, rowNum, maxTiers,
  containers, mode, onBack, onNavigate,
  plannerMode = false, onPlannerAction,
}: Props) {
  const [selTier, setSelTier] = useState<number | null>(
    containers.length > 0 ? containers[0].tier : null,
  )

  const slotAddr = `${blockLabel}-${rowNum}-${slotCol}`
  const selC = containers.find(c => c.tier === selTier) ?? containers[0] ?? null

  // All containers in this slot (for rehandle colour mode)
  const sameSlot = containers

  // Tiers from top to bottom
  const tierNums = Array.from({ length: maxTiers }, (_, i) => maxTiers - i)

  const isDark = (bg: string) =>
    /^#[0-5]/.test(bg) || ["#4b5563","#374151","#111827","#9b1c1c"].includes(bg)

  function lfdLabel(h: number) {
    if (h < 0) return `−${Math.abs(h)} h breached`
    return `${h} h`
  }
  function lfdColor(h: number) {
    if (h < 0)   return "#dc2626"
    if (h <= 24) return "#f59e0b"
    return "#6b7280"
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-neutral-200 flex-none bg-[#fafafa]">
        <button
          onClick={onBack}
          className="font-semibold text-[12px] text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1"
        >
          ← {blockLabel}
        </button>
        <div className="w-px h-4 bg-neutral-300" />
        <span className="font-black text-[17px] tracking-tight font-mono">{slotAddr}</span>
        <span className="text-[12px] text-neutral-500">
          Bay {slotCol} · Row {rowNum} · {zoneName.replace("Zone ","").split(" — ")[0]}
        </span>
        <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 flex-none"
          style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:5, color:"#374151" }}>
          {containers.length}/{maxTiers} tiers occupied
        </span>
      </div>

      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 text-[10.5px] text-neutral-400 flex gap-1.5 border-b border-neutral-100 flex-none">
        <span className="hover:text-neutral-700 cursor-pointer" onClick={() => { onBack(); onBack() }}>Yard</span>
        <span>›</span>
        <span className="hover:text-neutral-700 cursor-pointer" onClick={onBack}>{blockLabel}</span>
        <span>›</span>
        <span className="text-neutral-500 font-medium">Bay {slotCol} / Row {rowNum}</span>
      </div>

      {/* ── Tier selector — horizontal scrollable row ────────────────────── */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto border-b border-neutral-200 flex-none"
        style={{ background:"#fafafa" }}>
        <div className="text-[9.5px] font-bold tracking-wider text-neutral-400 self-center whitespace-nowrap mr-1">
          TIER STACK
        </div>
        {tierNums.map(tier => {
          const c        = containers.find(x => x.tier === tier)
          const bg       = c ? containerColor(c, mode, sameSlot) : "#e5e7eb"
          const selected = selTier === tier
          return (
            <div
              key={tier}
              onClick={() => c && setSelTier(tier)}
              className="flex-none rounded"
              style={{
                minWidth: 110, padding: "8px 10px",
                border:      `2px solid ${selected ? "#dc2626" : c ? "#9ca3af" : "#d1d5db"}`,
                borderLeft:  c ? `5px solid ${bg}` : "2px solid #d1d5db",
                borderStyle: !c ? "dashed" : undefined,
                background:  selected ? "#fef2f2" : c ? "#fff" : "#f9fafb",
                cursor:      c ? "pointer" : "default",
                opacity:     c ? 1 : 0.55,
                boxShadow:   selected ? "0 0 0 2px rgba(220,38,38,0.15)" : "none",
                transition:  "border-color 100ms, background 100ms",
              }}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[9px] font-bold tracking-wider text-neutral-400">TIER {tier}</span>
                {c && (
                  <span className="text-[8px] px-1 py-0.5 font-semibold rounded"
                    style={{ background: bg, color: isDark(bg) ? "#fff" : "#111827" }}>
                    {mode.slice(0,3).toUpperCase()}
                  </span>
                )}
              </div>
              {c ? (
                <>
                  <div className="font-mono font-bold text-[12px] leading-tight truncate">{c.id}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">{c.size}</div>
                  {c.hoursToLFD !== -9999 && (
                    <div className="text-[10px] font-medium mt-0.5" style={{ color: lfdColor(c.hoursToLFD) }}>
                      LFD {lfdLabel(c.hoursToLFD)}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[11px] text-neutral-400 mt-0.5">Empty</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Detail panel — full width, scrollable ───────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selC ? (
          <>
            {/* Container identity */}
            <div className="px-5 pt-4 pb-3 border-b border-neutral-200">
              <div className="text-[10.5px] font-semibold tracking-wide text-neutral-400 mb-1">
                {slotAddr} · TIER {selC.tier}
              </div>
              <div className="font-mono font-black text-[24px] tracking-tight leading-none">{selC.id}</div>
              <div className="text-[12.5px] text-neutral-600 mt-1.5">
                {selC.consignee}{selC.consignee !== "—" && selC.carrierName !== "—" ? " · " : ""}{selC.carrierName !== "—" ? selC.carrierName : ""}
              </div>
            </div>

            {/* Why here */}
            {selC.whyHere && (
              <div className="px-5 py-3 border-b border-neutral-200" style={{ background:"#fff7f7" }}>
                <div className="text-[9.5px] font-bold tracking-widest text-[#a01f14] mb-0.5 uppercase">Why here</div>
                <div className="text-[9px] font-semibold tracking-wide text-[#c0392b] opacity-70 mb-1.5">
                  PIFO — Priority-In-First-Out
                </div>
                <div className="text-[12.5px] leading-relaxed text-neutral-800">{selC.whyHere}</div>
              </div>
            )}

            {/* Properties — 2-column grid */}
            <div className="grid border-b border-neutral-200" style={{ gridTemplateColumns:"1fr 1fr" }}>
              {(([
                ["Size",         selC.size,                                              false],
                ["Gross weight", `${(selC.grossKg / 1000).toFixed(1)} t`,               selC.grossKg > 28000],
                ["Status",       selC.status.replace(/_/g," ").toLowerCase(),           false],
                ...(selC.hoursToLFD !== -9999
                  ? [["Hours to LFD", selC.hoursToLFD < 0
                      ? `Breached ${Math.abs(selC.hoursToLFD)} h` : `${selC.hoursToLFD} h`,
                      selC.hoursToLFD <= 24] as [string, string, boolean]]
                  : []),
                ...(selC.channel !== "—"
                  ? [["Customs channel", selC.channel, selC.channel === "rail" || selC.channel === "sea"] as [string, string, boolean]]
                  : []),
                ["Dwell",        `${selC.dwellDays} days`,                              false],
                ["Priority",     selC.priority,                                         selC.priority === "P1"],
                ["Hazmat",       selC.hazmat ? "Yes ⚠" : "No",                         selC.hazmat],
                ...(selC.seal !== "—"     ? [["Seal",     selC.seal,     false] as [string,string,boolean]] : []),
                ...(selC.terminal !== "—" ? [["Terminal", selC.terminal, false] as [string,string,boolean]] : []),
              ]) as [string, string, boolean][]).map(([k, v, red]) => (
                <div key={k} className="flex flex-col gap-0.5 px-5 py-2.5 border-b border-r border-neutral-100">
                  <span className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">{k}</span>
                  <span className="text-[13px] font-semibold" style={{ color: red ? "#dc2626" : "#111827" }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Move history */}
            <div className="px-5 pt-3 pb-1">
              <div className="text-[9.5px] font-bold tracking-widest text-neutral-400 uppercase mb-2">Move history</div>
              {[
                { t:"05:12", what:`Placed at ${blockLabel}-${rowNum}-${slotCol} by OP-207 (RS-02), 4.2′` },
                { t:"04:48", what:"Received from receiving lane R-02" },
                { t:"04:31", what:`Gate-in · EIR captured · seal ${selC.seal !== "—" ? selC.seal : "—"} verified` },
                { t:"02:55", what:`Departed ${selC.terminal !== "—" ? selC.terminal : "origin"}` },
              ].map(h => (
                <div key={h.t} className="flex gap-3 py-2 border-b border-neutral-100 text-[11.5px]">
                  <span className="text-neutral-400 tabular-nums font-mono w-10 flex-none">{h.t}</span>
                  <span className="flex-1 leading-snug text-neutral-700">{h.what}</span>
                </div>
              ))}
            </div>

            {/* Planner actions */}
            {plannerMode && selC && onPlannerAction && (
              <div className="px-5 pt-3 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-wide"
                    style={{ background:"#16a34a", color:"#fff", borderRadius:3 }}>Planner</span>
                  <span className="text-[9.5px] font-bold tracking-widest text-neutral-400 uppercase">Planned actions</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { action:"retrieval",  label:"Plan retrieval",       sub:"→ S-01 (staging)",                       color:"#1d4ed8" },
                    { action:"reposition", label:"Plan reposition",      sub:"→ lowest-occupancy slot in zone",        color:"#7c3aed" },
                    { action:"stage",      label:"Stage for outbound",   sub:"→ S-01",                                 color:"#b45309" },
                  ].map(({ action, label, sub, color }) => (
                    <button key={action}
                      onClick={() => onPlannerAction(action, selC.id)}
                      className="text-left px-3 py-2.5 text-[12px] font-semibold hover:opacity-90 transition-opacity rounded"
                      style={{ background:color, color:"#fff", border:"none" }}>
                      {label}
                      <span className="block text-[10px] font-normal opacity-75 mt-0.5">{selC.id} {sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Navigate to */}
            {onNavigate && (
              <div className="px-5 pt-3 pb-5">
                <div className="text-[9.5px] font-bold tracking-widest text-neutral-400 uppercase mb-2">Navigate to</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { screen:"S4", label:"View in planner →" },
                    { screen:"S7", label:"Related events in the tower →" },
                    { screen:"S2", label:"Container in the gate console →" },
                  ].map(({ screen, label }) => (
                    <button key={screen}
                      className="text-left text-[12px] px-3 py-2.5 font-semibold transition-colors hover:bg-neutral-100"
                      style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:5, color:"#374151" }}
                      onClick={() => onNavigate(screen, selC.id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-5 py-8 text-[12px] text-neutral-400 text-center">
            Select an occupied tier above to see container details.
          </div>
        )}
      </div>
    </div>
  )
}
