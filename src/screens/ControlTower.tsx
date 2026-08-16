import { useState, useEffect } from "react"
import TabBar from "@/components/ui/TabBar"
import { useData } from "@/lib/DataContext"
import type { Event } from "@/data/yard-ops"
import { backendApi } from "@/lib/backend-api"
import type { BackendDisruption, DisruptionType, BackendMove } from "@/lib/backend-api"
import { computePlanDiff, slotAddressById, REASON_LABELS } from "@/lib/backend-adapters"
import ContainerPicker from "@/components/ContainerPicker"
import InventoryTab from "@/components/InventoryTab"
import { useLang } from "@/lib/i18n"
import { fmtTime } from "@/utils/time"
import Skeleton from "@/components/ui/Skeleton"

interface Props {
  focus: string | null
  onNavigate?: (target: string, focus?: string) => void
}

const CATS: Record<string, string> = {
  EQUIPMENT_FAILURE:        "Equipment",
  CUSTOMS_CHANNEL_ASSIGNED: "Customs",
  SHIP_DELAY:               "Shipping",
  DEPOT_REDIRECTION:        "Depot",
  CONTAINER_NOT_FOUND:      "Yard audit",
  APPOINTMENT_NO_SHOW:      "Gate",
  DETENTION_BREACH:         "Detention",
  AUDIT_DISCREPANCY:        "Yard audit",
  // Step 5 — story + context event types
  ETA_REVISION:             "Shipping",
  ASN_RECEIVED:             "Gate",
  OUT_OF_SEQUENCE_ARRIVAL:  "Yard audit",
  INSPECTION_HOLD:          "Yard audit",
  TERMINAL_DELAY:           "Shipping",
  WEIGHT_VARIANCE:          "Yard audit",
}

const DISRUPTION_OPTIONS: { value: DisruptionType; label: string }[] = [
  { value: "truck_accident",          label: "Truck accident" },
  { value: "ship_delay",              label: "Ship delay" },
  { value: "inspection_hold",         label: "Inspection hold" },
  { value: "out_of_sequence_arrival", label: "Out-of-sequence arrival" },
  { value: "jockey_unavailable",      label: "Jockey unavailable" },
]

const DISRUPTION_LABELS: Record<DisruptionType, string> = {
  truck_accident:          "Truck accident",
  ship_delay:              "Ship delay",
  inspection_hold:         "Inspection hold",
  out_of_sequence_arrival: "Out-of-sequence arrival",
  jockey_unavailable:      "Jockey unavailable",
}

const DISRUPTION_SEVERITY: Record<DisruptionType, "high" | "medium" | "low"> = {
  truck_accident:          "high",
  jockey_unavailable:      "high",
  inspection_hold:         "medium",
  ship_delay:              "medium",
  out_of_sequence_arrival: "low",
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
    events, diffRows, backendConnected, activePlan,
    backendContainers, backendSlots, backendJockeys,
    createDisruption, containers, zones, moves, refresh, dbLoading,
  } = useData()

  const { t } = useLang()

  const [tab,  setTab]  = useState<"events" | "inventory">("events")
  const [sel,  setSel]  = useState("")
  const [cat,  setCat]  = useState("ALL")
  const [acked, setAcked] = useState<Set<string>>(new Set())

  // Disruption modal
  const [modalOpen,        setModalOpen]        = useState(false)
  const [modalType,        setModalType]        = useState<DisruptionType>("truck_accident")
  const [modalContainer,   setModalContainer]   = useState<number | "">("")
  const [modalJockey,      setModalJockey]      = useState<number | "">("")
  const [modalDescription, setModalDescription] = useState("")
  const [modalSearch,      setModalSearch]      = useState("")
  const [injecting,        setInjecting]        = useState(false)

  const [localDisruptions, setLocalDisruptions] = useState<BackendDisruption[]>([])
  const [patchingMove,     setPatchingMove]     = useState<string | null>(null)
  const [moveError,        setMoveError]        = useState<string | null>(null)
  const [replanBanner,     setReplanBanner]     = useState<{ id: number; added: number; cancelled: number; reassigned: number } | null>(null)
  const [engineDiffRows,   setEngineDiffRows]   = useState<EngineDiffRow[] | null>(null)
  const [engineDiffStats,  setEngineDiffStats]  = useState<EngineDiffStats | null>(null)

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

  async function handleInject() {
    if (injecting) return
    setInjecting(true)
    try {
      const disruption = await createDisruption({
        event_type:            modalType,
        affected_container_id: modalContainer !== "" ? modalContainer : undefined,
        affected_jockey_id:    modalType === "jockey_unavailable" && modalJockey !== "" ? modalJockey : undefined,
        description:           modalDescription || DISRUPTION_LABELS[modalType],
      })
      if (!disruption) return
      setLocalDisruptions(prev => [disruption, ...prev])
      if (disruption.triggered_replan_id != null) {
        try {
          const newPlan  = await backendApi.plan(disruption.triggered_replan_id)
          const oldMoves: BackendMove[] = activePlan?.moves ?? []
          const newMoves: BackendMove[] = newPlan.moves
          const diff = computePlanDiff(oldMoves, newMoves)
          const rows: EngineDiffRow[] = [
            ...diff.cancelled.map(m => ({ moveId: `M-${m.id}`, action: "CANCELLED", type: REASON_LABELS[m.reason] ?? m.reason, before: slotAddressById(m.to_slot_id, backendSlots), after: "—", note: "Removed in replan" })),
            ...diff.added.map(m => ({ moveId: `M-${m.id}`, action: "ADDED", type: REASON_LABELS[m.reason] ?? m.reason, before: "—", after: slotAddressById(m.to_slot_id, backendSlots), note: "New move in replan" })),
            ...diff.reassigned.map(m => {
              const old = oldMoves.find(o => o.container_id === m.container_id)
              return { moveId: `M-${m.id}`, action: "REASSIGNED", type: REASON_LABELS[m.reason] ?? m.reason, before: slotAddressById(old?.to_slot_id ?? null, backendSlots), after: slotAddressById(m.to_slot_id, backendSlots), note: old?.jockey_id !== m.jockey_id ? "Jockey reassigned" : "Route changed" }
            }),
          ]
          setEngineDiffRows(rows)
          setEngineDiffStats({ cancelled: diff.cancelled.length, added: diff.added.length, reassigned: diff.reassigned.length, frozenKept: diff.held.length, deltaMin: `+${diff.added.length * 5}`, adherence: diff.reassigned.length > 0 ? "-3" : "0" })
          setReplanBanner({ id: disruption.triggered_replan_id, added: diff.added.length, cancelled: diff.cancelled.length, reassigned: diff.reassigned.length })
        } catch (err) {
          console.error("[ControlTower] failed to fetch replan detail:", err)
          setReplanBanner({ id: disruption.triggered_replan_id, added: 0, cancelled: 0, reassigned: 0 })
        }
      }
      setModalOpen(false); setModalDescription(""); setModalSearch(""); setModalContainer(""); setModalJockey(""); setModalType("truck_accident")
    } finally { setInjecting(false) }
  }

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

  const activeDiffRows  = engineDiffRows ?? diffRows
  const activeDiffStats = engineDiffStats ?? (selEvent ? selEvent.diff : null)

  if (!selEvent) return (
    <div className="flex flex-col h-full min-h-0 items-center justify-center bg-[#f8f9fa]">
      <div className="text-[13px] font-semibold text-neutral-500">{t("tower.noAlerts")}</div>
      <div className="text-[11px] text-neutral-400 mt-1">{t("tower.noAlertsDesc")}</div>
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#f4f5f7] text-neutral-900">

      {/* ── Disruption modal ─────────────────────────────────────────────────── */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 z-20 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[420px] bg-white" style={{ border: "1px solid var(--ds-border)", borderRadius: 6 }}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--ds-border)]">
              <div className="font-semibold text-[15px]">Simulate a disruption</div>
              <button onClick={() => setModalOpen(false)} className="text-neutral-400 hover:text-neutral-800 text-sm">✕</button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div>
                <div className="ds-label mb-1">{t("tower.whatHappened")}</div>
                <select value={modalType} onChange={e => { setModalType(e.target.value as DisruptionType); setModalJockey("") }}
                  className="w-full border border-[var(--ds-border)] px-3 py-2 text-[12.5px] bg-white" style={{ borderRadius: 5 }}>
                  {DISRUPTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <div className="ds-label mb-1">{t("tower.affectedContainer")} <span className="normal-case text-neutral-400 tracking-normal">(optional)</span></div>
                <ContainerPicker containers={backendContainers} value={modalContainer} onChange={(id, display) => { setModalContainer(id); setModalSearch(display) }} placeholder={t("tower.searchContainer")} />
                {backendContainers.length === 0 && <div className="text-[11px] text-neutral-400 mt-1">{t("tower.noBackend")}</div>}
              </div>
              {modalType === "jockey_unavailable" && (
                <div>
                  <div className="ds-label mb-1">{t("tower.affectedOperator")}</div>
                  <select value={modalJockey} onChange={e => setModalJockey(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full border border-[var(--ds-border)] px-3 py-2 text-[12.5px] bg-white" style={{ borderRadius: 5 }}>
                    <option value="">{t("tower.noneOperator")}</option>
                    {backendJockeys.map(j => <option key={j.id} value={j.id}>{j.name} · {j.status}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div className="ds-label mb-1">{t("tower.notes")} <span className="normal-case text-neutral-400 tracking-normal">(optional)</span></div>
                <textarea rows={2} placeholder={`Describe the ${DISRUPTION_LABELS[modalType].toLowerCase()}…`}
                  value={modalDescription} onChange={e => setModalDescription(e.target.value)}
                  className="w-full border border-[var(--ds-border)] px-3 py-2 text-[12.5px] resize-none" style={{ borderRadius: 5 }} />
              </div>
            </div>
            <div className="px-5 pb-4 flex justify-between items-center">
              <button onClick={() => setModalOpen(false)} className="text-xs px-3 py-2 border border-[var(--ds-border)] text-[var(--ds-fg-secondary)] bg-white" style={{ borderRadius: 5 }}>{t("common.cancel")}</button>
              <button onClick={handleInject} disabled={injecting} className="text-xs px-3 py-2 text-white" style={{ background: "var(--ds-fg)", borderRadius: 5, opacity: injecting ? 0.6 : 1 }}>
                {injecting ? "Submitting…" : t("tower.submitDisruption")}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 pt-3 pb-3 border-b border-[var(--ds-border)] flex-none bg-white">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-[15px] tracking-tight">{t("tower.title")}</span>
          <span className="text-[11px] text-neutral-500">{t("tower.subtitle")}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <div title={!backendConnected ? "Requires backend connection" : undefined}>
            <button disabled={!backendConnected} onClick={() => setModalOpen(true)}
              className="text-xs px-3 py-2 border border-[var(--ds-border)] text-[var(--ds-fg-secondary)] bg-white" style={{ borderRadius: 5, opacity: !backendConnected ? 0.5 : 1 }}>
              {t("tower.simulateDisruption")}
            </button>
          </div>
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

          {/* ── Replan banner ──────────────────────────────────────────────── */}
          {replanBanner && (
            <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--ds-border)] flex-none bg-white">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: "#059669" }}>{t("tower.planUpdated")}</span>
              <span className="text-[12px] text-neutral-700">
                {t("tower.engineAdjusted")} <span className="font-semibold">{replanBanner.reassigned} moves</span>
                {replanBanner.added > 0 && <>, {t("tower.movesAdded")} <span className="font-semibold">{replanBanner.added}</span></>}
                {replanBanner.cancelled > 0 && <>, {t("tower.movesRemoved")} <span className="font-semibold">{replanBanner.cancelled}</span></>}
              </span>
              <button className="ml-auto text-[10.5px] font-semibold text-neutral-400 hover:text-neutral-700"
                onClick={() => { setReplanBanner(null); setEngineDiffRows(null); setEngineDiffStats(null) }}>
                {t("tower.dismiss")}
              </button>
            </div>
          )}

          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <div className="flex border-b border-[var(--ds-border)] flex-none bg-white">
            {[
              { k: t("tower.kpi.alertsToday"),   v: String(events.length + localDisruptions.length), sub: t("tower.kpi.sinceShift") },
              { k: t("tower.kpi.replans"),        v: String(5 + (replanBanner ? 1 : 0)),              sub: "engine-generated" },
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
                {dbLoading && filtered.length === 0 && (
                  Array.from({length:5},(_,i) => (
                    <div key={`sk-${i}`} className="px-4 py-3 border-b border-[var(--ds-border-lt)]">
                      <Skeleton variant="row" />
                    </div>
                  ))
                )}
                {!dbLoading && filtered.length === 0 && (
                  <div className="px-4 py-4 text-[11px] text-[var(--ds-muted)]">No events match this filter.</div>
                )}
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

                {/* Backend disruptions */}
                {localDisruptions.length > 0 && (
                  <>
                    <div className="px-4 py-2 bg-[var(--ds-surface-hover)] border-b border-t border-[var(--ds-border)]">
                      <span className="ds-label">{t("tower.simulatedCount")}</span>
                      <span className="ml-2 text-[10px] text-neutral-400 font-mono">{localDisruptions.length} {t("tower.thisSession")}</span>
                    </div>
                    {localDisruptions.map(d => {
                      const sev   = DISRUPTION_SEVERITY[d.event_type] ?? "low"
                      const color = SEV_COLOR[sev]
                      const time  = fmtTime(d.occurred_at)
                      return (
                        <div key={d.id} className="px-4 py-3 border-b border-[var(--ds-border-lt)]" style={{ borderLeft: `3px solid ${color}` }}>
                          <div className="flex justify-between gap-2 mb-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{DISRUPTION_LABELS[d.event_type]}</span>
                            <span className="font-mono text-[10px] text-neutral-400">{time}</span>
                          </div>
                          <div className="text-[12px] font-semibold text-neutral-800 leading-snug">{d.description}</div>
                          {d.triggered_replan_id != null ? (
                            <button className="mt-1 text-[11px] font-semibold hover:underline" style={{ color: "#2563eb" }}
                              onClick={() => onNavigate?.("plan", String(d.triggered_replan_id))}>
                              {t("tower.viewPlan")}
                            </button>
                          ) : (
                            <div className="mt-1 text-[10.5px] text-neutral-400">{t("tower.noReplanNeeded")}</div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
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
