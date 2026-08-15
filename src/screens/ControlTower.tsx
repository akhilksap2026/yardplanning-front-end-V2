import { useState, useEffect } from "react"
import TabBar from "@/components/ui/TabBar"
import { useData } from "@/lib/DataContext"
import type { Event } from "@/data/yard-ops"
import { backendApi } from "@/lib/backend-api"
import { REASON_LABELS } from "@/lib/backend-adapters"
import InventoryTab from "@/components/InventoryTab"
import { useLang } from "@/lib/i18n"
import { fmtTime } from "@/utils/time"

interface Props {
  focus: string | null
  onNavigate?: (target: string, focus?: string) => void
}

const CATS: Record<string, string> = {
  EQUIPMENT_FAILURE:       "Equipment",
  CUSTOMS_CHANNEL_ASSIGNED:"Customs",
  SHIP_DELAY:              "Shipping",
  DEPOT_REDIRECTION:       "Depot",
  CONTAINER_NOT_FOUND:     "Yard audit",
  APPOINTMENT_NO_SHOW:     "Gate",
  DETENTION_BREACH:        "Detention",
  AUDIT_DISCREPANCY:       "Yard audit",
}


const SEV_COLOR: Record<string, string> = { high: "var(--ds-red)", medium: "var(--ds-amber)", low: "#2563eb" }

type EngineDiffRow  = { moveId: string; action: string; type: string; before: string; after: string; note: string }
type EngineDiffStats = { cancelled: number; added: number; reassigned: number; frozenKept: number; deltaMin: number | string; adherence: number | string }

// Human-readable status labels
function statusLabel(e: Event, acked: Set<string>): { text: string; color: string; bg: string } {
  if (acked.has(e.id))        return { text: "Done",       color: "#15803d", bg: "#f0fdf4" }
  if (e.state === "replanned") return { text: "Resolved",   color: "#2563eb", bg: "#eff6ff" }
  if (e.state === "suppressed")return { text: "No change",  color: "var(--ds-muted)",  bg: "var(--ds-border-lt)" }
  return                              { text: "Needs action", color: "var(--ds-amber)", bg: "#fffbeb" }
}

export default function ControlTower({ focus, onNavigate }: Props) {
  const {
    events, diffRows, backendConnected,
    containers, zones, moves, refresh,
  } = useData()

  const { t } = useLang()

  const [tab,  setTab]  = useState<"events" | "inventory">("events")
  const [sel,  setSel]  = useState("")
  const [cat,  setCat]  = useState("ALL")
  const [acked, setAcked] = useState<Set<string>>(new Set())

  const [patchingMove, setPatchingMove] = useState<string | null>(null)
  const [moveError,    setMoveError]    = useState<string | null>(null)

  useEffect(() => { if (!sel && events.length > 0) setSel(events[0].id) }, [events, sel])

  useEffect(() => {
    if (!focus) return
    const e = events.find(x => x.id === focus) || events.find(x => x.title.includes(focus) || x.detail.includes(focus))
    if (e) setSel(e.id)
  }, [focus, events])

  const cats     = ["ALL", ...Array.from(new Set(events.map(e => CATS[e.type] || e.type)))]
  const filtered = events.filter(e => cat === "ALL" || CATS[e.type] === cat)
  const selEvent = filtered.find(e => e.id === sel) || events.find(e => e.id === sel) || filtered[0] || events[0]
  const ackedEvent    = selEvent ? acked.has(selEvent.id) : false
  const awaitingCount = events.filter(e => e.state === "awaiting" && !acked.has(e.id)).length


  // Persist a move state change to the DB, then re-pull moves so all screens update.
  async function handleMoveStateChange(moveId: string, state: string) {
    setPatchingMove(moveId); setMoveError(null)
    try {
      await backendApi.patchMove(moveId, { state })
      await refresh(["moves"])
    } catch (err) {
      console.error("[ControlTower] patchMove failed:", err)
      setMoveError(`Could not update ${moveId}: ${String(err).replace("Error: ", "")}`)
    } finally { setPatchingMove(null) }
  }

  const activeDiffRows  = diffRows
  const activeDiffStats = selEvent?.diff ?? null

  if (!selEvent) return (
    <div className="flex flex-col h-full min-h-0 items-center justify-center bg-[#f8f9fa]">
      <div className="text-[13px] font-semibold text-neutral-500">{t("tower.noAlerts")}</div>
      <div className="text-[11px] text-neutral-400 mt-1">{t("tower.noAlertsDesc")}</div>
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#f4f5f7] text-neutral-900">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 pt-3 pb-3 border-b border-[var(--ds-border)] flex-none bg-white">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-[15px] tracking-tight">{t("tower.title")}</span>
          <span className="text-[11px] text-neutral-500">{t("tower.subtitle")}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => selEvent && setAcked(prev => new Set(prev).add(selEvent.id))} disabled={ackedEvent}
            className="text-xs px-3 py-2 text-white" style={{ background: "var(--ds-fg)", borderRadius: 5, opacity: ackedEvent ? 0.5 : 1 }}>
            {ackedEvent ? t("tower.acknowledged") : t("tower.acknowledge")}
          </button>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <TabBar
        items={[
          { id: "events",    label: t("tower.alerts")    },
          { id: "inventory", label: t("tower.inventory") },
        ]}
        active={tab}
        onChange={id => setTab(id as typeof tab)}
      />

      {tab === "inventory" && <InventoryTab />}

      {tab === "events" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <div className="flex border-b border-[var(--ds-border)] flex-none bg-white">
            {[
              { k: t("tower.kpi.alertsToday"),   v: String(events.length), sub: t("tower.kpi.sinceShift") },
              { k: t("tower.kpi.replans"),        v: "5",                                              sub: "engine-generated" },
              { k: t("tower.kpi.adherence"),      v: "89%",                                            sub: "target ≥ 85%" },
              { k: t("tower.kpi.needsAttn"),      v: String(awaitingCount),                            sub: awaitingCount > 0 ? t("tower.kpi.awaiting") : t("tower.kpi.allClear"), red: awaitingCount > 0 },
            ].map(m => (
              <div key={m.k} className="flex-1 px-5 py-2.5 border-r border-[var(--ds-border)] flex flex-col gap-0.5">
                <span className="ds-label">{m.k}</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-semibold leading-none" style={{ fontSize: 24, color: (m as { red?: boolean }).red ? "var(--ds-red)" : undefined }}>{m.v}</span>
                  <span className="text-[11px] text-neutral-500">{m.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Main grid ──────────────────────────────────────────────────── */}
          <div className="grid flex-1 min-h-0 overflow-hidden" style={{ gridTemplateColumns: "clamp(260px,28vw,360px) minmax(340px,1fr)" }}>

            {/* ── Left: event list ─────────────────────────────────────────── */}
            <div className="border-r border-[var(--ds-border)] flex flex-col overflow-hidden bg-white">

              {/* Category filter chips */}
              <div className="flex flex-wrap gap-1.5 px-3 py-2.5 border-b border-[var(--ds-border)]">
                {cats.map(c => (
                  <button key={c} onClick={() => setCat(c)}
                    className="text-[10.5px] font-bold px-2.5 py-1 transition-colors"
                    style={{
                      borderRadius: 4,
                      background: cat === c ? "var(--ds-fg)" : "var(--ds-border-lt)",
                      color:      cat === c ? "#fff"    : "var(--ds-fg-secondary)",
                    }}>
                    {c === "ALL" ? t("tower.tab.all") : c}
                  </button>
                ))}
              </div>

              {/* Event rows */}
              <div className="flex flex-col overflow-auto flex-1">
                {filtered.map(e => {
                  const isSelected = e.id === sel
                  const dot  = SEV_COLOR[e.severity] ?? SEV_COLOR.low
                  const stat = statusLabel(e, acked)
                  return (
                    <button key={e.id} onClick={() => setSel(e.id)}
                      className="block w-full text-left px-4 py-3 border-b border-[var(--ds-border-lt)] hover:bg-[var(--ds-surface-hover)] transition-colors"
                      style={{
                        borderLeft: `3px solid ${isSelected ? dot : "transparent"}`,
                        background: isSelected ? "#fafafa" : undefined,
                      }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="rounded-full flex-none" style={{ width: 7, height: 7, background: dot }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: dot }}>
                          {CATS[e.type] || e.type}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-neutral-400">{e.time}</span>
                      </div>
                      <div className="text-[12px] font-semibold leading-snug text-neutral-900 truncate">{e.title}</div>
                      <div className="mt-1">
                        <span className="text-[10px] font-bold px-1.5 py-0.5" style={{ background: stat.bg, color: stat.color, borderRadius: 3 }}>
                          {stat.text}
                        </span>
                      </div>
                    </button>
                  )
                })}

              </div>
            </div>

            {/* ── Right: event detail ───────────────────────────────────────── */}
            <div className="flex flex-col min-h-0 overflow-auto bg-white">

              {/* Event header */}
              <div className="px-5 pt-4 pb-3 border-b border-[var(--ds-border)]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="rounded-full flex-none" style={{ width: 8, height: 8, background: SEV_COLOR[selEvent.severity] ?? SEV_COLOR.low }} />
                  <span className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: SEV_COLOR[selEvent.severity] ?? SEV_COLOR.low }}>
                    {CATS[selEvent.type] || selEvent.type}
                  </span>
                  <span className="font-mono text-[10.5px] text-neutral-400 ml-auto">{selEvent.time}</span>
                </div>
                <div className="font-semibold text-[17px] tracking-tight leading-snug">{selEvent.title}</div>
                <div className="text-[12.5px] leading-relaxed mt-1.5 text-neutral-700 max-w-2xl">{selEvent.detail}</div>
              </div>

              {/* Plan impact summary */}
              {activeDiffStats && (
                <div className="px-5 py-3 border-b border-[var(--ds-border)] bg-[#f0fdf4]">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 mb-1">{t("tower.engineResponse")}</div>
                  <div className="text-[13px] text-neutral-800 leading-relaxed">
                    {t("tower.planAdjusted")}
                    {Number(activeDiffStats.reassigned) > 0 && <> <strong>{activeDiffStats.reassigned} {t("tower.movesReassigned")}</strong></>}
                    {Number(activeDiffStats.added) > 0 && <>, <strong>{activeDiffStats.added} {t("tower.movesAdded")}</strong></>}
                    {Number(activeDiffStats.cancelled) > 0 && <>, <strong>{activeDiffStats.cancelled} {t("tower.movesRemoved")}</strong></>}
                    {Number(activeDiffStats.reassigned) === 0 && Number(activeDiffStats.added) === 0 && Number(activeDiffStats.cancelled) === 0 && <> <strong>no changes needed</strong></>}
                    .
                  </div>
                </div>
              )}

              {/* Suppressed state */}
              {selEvent.state === "suppressed" ? (
                <div className="px-5 py-5 max-w-2xl">
                  <div className="font-semibold text-[15px] mb-2">No replan published</div>
                  <div className="text-[12.5px] leading-relaxed text-neutral-700">
                    The engine found a slightly better sequence, but the improvement was too small to justify disrupting operators mid-shift. The current plan stands — operators continue without any queue changes.
                  </div>
                  <div className="text-[12px] leading-relaxed mt-2 text-neutral-500">
                    This is intentional: a stable plan operators can trust is worth more than chasing marginal gains.
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  {activeDiffRows.length > 0 && (
                    <>
                      <div className="px-5 pt-3 pb-1">
                        <span className="ds-label">What changed in the plan</span>
                      </div>
                      {moveError && (
                        <div className="mx-5 mb-2 px-3 py-2 text-[11.5px]" style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 5 }}>
                          {moveError}
                        </div>
                      )}
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr>
                            {["Move", "Before", "After", "Reason", "Live state"].map((h, i) => (
                              <th key={h} className="ds-th text-left" style={{ paddingLeft: i === 0 ? 20 : 12, paddingRight: i === 4 ? 20 : 12 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeDiffRows.map((r, i) => {
                            const actionColor = (r as { action: string }).action === "CANCELLED" ? "var(--ds-red)"
                              : (r as { action: string }).action === "ADDED" ? "#059669"
                              : (r as { action: string }).action === "HELD"  ? "var(--ds-subtle)"
                              : "var(--ds-amber)"
                            const actionLabel = (r as { action: string }).action === "CANCELLED" ? "Removed"
                              : (r as { action: string }).action === "ADDED" ? "Added"
                              : (r as { action: string }).action === "REASSIGNED" ? "Reassigned"
                              : "Kept"
                            return (
                              <tr key={(r as { moveId: string }).moveId + i} className="border-b border-[var(--ds-border-lt)]">
                                <td className="py-2 pl-5 pr-2 align-top">
                                  <div className="font-mono font-semibold text-[11.5px]">{(r as { moveId: string }).moveId}</div>
                                  <div className="text-[10px] font-bold mt-0.5" style={{ color: actionColor }}>{actionLabel}</div>
                                </td>
                                <td className="px-3 py-2 align-top text-neutral-400 font-mono text-[11.5px]">{(r as { before: string }).before}</td>
                                <td className="px-3 py-2 align-top font-mono font-semibold text-[11.5px]">{(r as { after: string }).after}</td>
                                <td className="px-3 py-2 align-top text-neutral-600 leading-relaxed">{(r as { note: string }).note}</td>
                                <td className="py-2 pl-3 pr-5 align-top">
                                  {(() => {
                                    const moveId = (r as { moveId: string }).moveId
                                    const live = moves.find(m => m.id === moveId)
                                    if (!live) return <span className="text-[11px] text-neutral-300">—</span>
                                    if (live.state === "DONE") return <span className="text-[10.5px] font-bold" style={{ color: "#059669" }}>✓ Done</span>
                                    return (
                                      <select
                                        value={live.state}
                                        disabled={patchingMove === moveId}
                                        onChange={e => handleMoveStateChange(moveId, e.target.value)}
                                        className="border border-[var(--ds-border)] bg-white text-[11px] px-1.5 py-1"
                                        style={{ borderRadius: 4, opacity: patchingMove === moveId ? 0.5 : 1 }}>
                                        {["PLANNED", "ASSIGNED", "IN_PROGRESS"].map(s => (
                                          <option key={s} value={s}>{s === "IN_PROGRESS" ? "In progress" : s.charAt(0) + s.slice(1).toLowerCase()}</option>
                                        ))}
                                      </select>
                                    )
                                  })()}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                  {activeDiffRows.length === 0 && (
                    <div className="px-5 py-4 text-[12px] text-neutral-400">No plan changes for this alert.</div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
