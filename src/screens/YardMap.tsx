import { useState, useEffect, useMemo, useRef } from "react"
import Skeleton from "@/components/ui/Skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useData } from "@/lib/DataContext"
import type { Container } from "@/data/yard-data"
import { OPERATORS } from "@/data/yard-data"
import { backendApi } from "@/lib/backend-api"
import type { BackendContainerDetail, BackendForecast } from "@/lib/backend-api"
import PhysicalYardMap from "@/components/yard/PhysicalYardMap"
import BlockInteriorView from "@/components/yard/BlockInteriorView"
import SlotStackView from "@/components/yard/SlotStackView"
import type { ViewContainer } from "@/components/yard/types"
import {
  computeBlockLayouts, computeLiveBlockLayouts,
  computeEquipmentPositions, computeMoveTrails,
} from "@/lib/yard-layout"
import { containerColor as _containerColor, LEGENDS } from "@/lib/yard-color"
import type { ColorMode } from "@/lib/yard-color"
import { useLang } from "@/lib/i18n"

interface Props {
  focus: string | null
  onNavigate: (target: string, focus?: string) => void
}

type DataSource = "seed" | "live"
type ZoomLevel  = "yard" | "block"   // "slot" removed — slot detail lives in drawer

const containerColor = _containerColor

const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  status:   "Status",
  lfd:      "LFD urgency",
  channel:  "Channel",
  dwell:    "Dwell days",
  priority: "Priority",
  rehandle: "Rehandle risk",
}

export default function YardMap({ focus, onNavigate }: Props) {
  const {
    containers, zones, moves, turnByHour, cycleByType, capacity,
    backendConnected, backendSlots, backendContainers,
  } = useData()

  const { t } = useLang()

  // ── Existing seed state ───────────────────────────────────────────────────
  const [view,  setView]  = useState<"map"|"dash">("map")
  const [mode,  setMode]  = useState<ColorMode>("status")
  const [q,     setQ]     = useState("")
  const [zone,  setZone]  = useState("A")
  const [block, setBlock] = useState(1)
  const [row,   setRow]   = useState(1)
  const [sel,   setSel]   = useState<string|null>(() => {
    const first = containers.find(c => c.zone==="A"&&c.block===1&&c.row===1)
    return first?.id || null
  })

  // ── Physical map + drill-down state ──────────────────────────────────────
  const [selectedBlockLabel, setSelectedBlockLabel] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("yard")
  const [selectedSlot, setSelectedSlot] = useState<{ col: number; row: number } | null>(null)

  // ── Overlay / planner state ───────────────────────────────────────────────
  const [showEquipment,  setShowEquipment]  = useState(false)
  const [showTrails,     setShowTrails]     = useState(false)
  const [showCongestion, setShowCongestion] = useState(false)
  const [plannerMode,    setPlannerMode]    = useState(false)
  const [plannerToast,   setPlannerToast]   = useState<string | null>(null)
  const [scrubberMin,    setScrubberMin]    = useState<number | null>(null)

  // ── Live-yard state ───────────────────────────────────────────────────────
  const [dataSource,    setDataSource]    = useState<DataSource>("seed")
  const [liveBlock,     setLiveBlock]     = useState<string | null>(null)
  const [liveRow,       setLiveRow]       = useState(1)
  const [selSlot,       setSelSlot]       = useState<number | null>(null)
  const [liveDetail,    setLiveDetail]    = useState<BackendContainerDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [forecast,      setForecast]      = useState<BackendForecast | null>(null)
  const [loadingFcast,  setLoadingFcast]  = useState(false)

  // ── Step 1: toolbar dropdown / switch state ───────────────────────────────
  const [colorDropdownOpen, setColorDropdownOpen] = useState(false)
  const colorDropdownRef = useRef<HTMLDivElement>(null)

  // ── Step 2: floating legend ───────────────────────────────────────────────
  const [legendExpanded, setLegendExpanded] = useState(false)

  // ── Step 3: drawer ────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Outside-click: color dropdown ────────────────────────────────────────
  useEffect(() => {
    if (!colorDropdownOpen) return
    const h = (e: MouseEvent) => {
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(e.target as Node))
        setColorDropdownOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [colorDropdownOpen])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return
      if (view !== "map") return
      switch (e.key) {
        case "Escape":
          if (drawerOpen) { setDrawerOpen(false); setSelectedSlot(null) }
          else if (zoomLevel === "block") { setZoomLevel("yard"); setSelectedSlot(null) }
          break
        case "1": setZoomLevel("yard"); setSelectedSlot(null); setDrawerOpen(false); break
        case "2": if (selectedBlockLabel || activeLiveBlock) setZoomLevel("block"); break
        case "e": case "E": setShowEquipment(v => !v); break
        case "t": case "T": setShowTrails(v => !v); break
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, zoomLevel, drawerOpen, selectedBlockLabel, selectedSlot])

  // ── Auto-clear planner toast ──────────────────────────────────────────────
  useEffect(() => {
    if (!plannerToast) return
    const t = setTimeout(() => setPlannerToast(null), 3500)
    return () => clearTimeout(t)
  }, [plannerToast])

  // ── Existing effects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sel && containers.length) {
      const first = containers.find(c => c.zone==="A"&&c.block===1&&c.row===1)
      if (first) setSel(first.id)
    }
  }, [containers])

  useEffect(() => {
    if (!focus) return
    const c = containers.find(x => x.id === focus)
    if (c) { setSel(c.id); setZone(c.zone); setBlock(c.block); setRow(c.row); setView("map"); setDataSource("seed") }
  }, [focus, containers])

  useEffect(() => { setLiveDetail(null) }, [selSlot])

  // ── Live-yard derived data ────────────────────────────────────────────────
  const liveBlockMap = (() => {
    const map = new Map<string, typeof backendSlots>()
    for (const s of backendSlots) {
      if (!map.has(s.block)) map.set(s.block, [])
      map.get(s.block)!.push(s)
    }
    return map
  })()

  const liveBlockKeys = Array.from(liveBlockMap.keys()).sort()

  const liveZones = liveBlockKeys.map(blk => {
    const slots = liveBlockMap.get(blk)!
    const total = slots.length
    const occupied = slots.filter(s => s.occupied_container_id != null).length
    const pct = total > 0 ? Math.round(occupied / total * 100) : 0
    const hasHazmat = slots.some(s => s.is_hazmat_approved)
    return { blk, total, occupied, pct, hasHazmat }
  })

  const activeLiveBlock = liveBlock ?? liveBlockKeys[0] ?? null
  const activeLiveSlots = activeLiveBlock ? (liveBlockMap.get(activeLiveBlock) ?? []) : []

  const liveBays  = Array.from(new Set(activeLiveSlots.map(s => s.bay))).sort((a, b) => a - b)
  const liveTiers = Array.from(new Set(activeLiveSlots.map(s => s.tier))).sort((a, b) => b - a)
  const liveRows  = Array.from(new Set(activeLiveSlots.map(s => s.row))).sort((a, b) => a - b)
  const activeRow = liveRows.includes(liveRow) ? liveRow : (liveRows[0] ?? 1)

  const selSlotData   = backendSlots.find(s => s.id === selSlot)
  const liveContainer = selSlotData?.occupied_container_id != null
    ? backendContainers.find(c => c.id === selSlotData.occupied_container_id)
    : null

  function hoursToDetention(expiry: string | null): number | null {
    if (!expiry) return null
    return Math.round((new Date(expiry).getTime() - Date.now()) / 3_600_000)
  }

  async function loadLiveDetail() {
    if (!liveContainer || loadingDetail) return
    setLoadingDetail(true)
    try { const detail = await backendApi.container(liveContainer.id); setLiveDetail(detail) }
    catch (err) { console.error("[YardMap] container detail:", err) }
    finally { setLoadingDetail(false) }
  }

  async function loadForecast() {
    if (loadingFcast) return
    setLoadingFcast(true)
    try { const f = await backendApi.forecast(3); setForecast(f) }
    catch (err) { console.error("[YardMap] forecast:", err) }
    finally { setLoadingFcast(false) }
  }

  // ── Block layouts (seed) ──────────────────────────────────────────────────
  const blockLayouts = useMemo(() => computeBlockLayouts(zones, containers), [zones, containers])
  const zoneNames    = useMemo(() => Object.fromEntries(zones.map(z => [z.id, z.name])), [zones])

  // ── KPI values ────────────────────────────────────────────────────────────
  // Zones excluded from terminal capacity/occupancy math (transient or non-storage)
  const EXCLUDED_ZONES = new Set(["R", "S", "Q"])

  const seedContainers = useMemo(() => containers.filter(c => !EXCLUDED_ZONES.has(c.zone)), [containers])
  const totalCapacity  = useMemo(() => zones.filter(z => !EXCLUDED_ZONES.has(z.id)).reduce((s, z) => s + z.blocks * z.rows * z.slots * z.maxTiers, 0), [zones])
  const occupancyPct   = totalCapacity > 0 ? Math.round(seedContainers.length / totalCapacity * 100) : 0
  const totalTEU       = useMemo(() => seedContainers.reduce((s, c) => s + (c.size.startsWith("40") ? 2 : 1), 0), [seedContainers])
  const avgTier        = seedContainers.length > 0 ? (seedContainers.reduce((s, c) => s + c.tier, 0) / seedContainers.length).toFixed(1) : "—"
  const totalBlocks    = useMemo(() => zones.filter(z => !EXCLUDED_ZONES.has(z.id)).reduce((s, z) => s + z.blocks, 0), [zones])
  const totalZones     = zones.filter(z => !EXCLUDED_ZONES.has(z.id)).length

  const selectedLayout  = blockLayouts.find(l => l.label === selectedBlockLabel) ?? null
  const selectedZoneDef = selectedLayout ? zones.find(z => z.id === selectedLayout.zone) : null

  // ── Search ────────────────────────────────────────────────────────────────
  const all   = containers
  const ql    = q.trim().toLowerCase()
  const match = (c: Container) =>
    !ql || (c.id + c.consignee + c.address + c.carrierName).toLowerCase().includes(ql)

  // ── Block interior containers (seed) ──────────────────────────────────────
  const selectedBlockViewContainers = useMemo((): ViewContainer[] =>
    selectedLayout
      ? containers
          .filter(c => c.zone === selectedLayout.zone && c.block === selectedLayout.block)
          .map(c => ({
            id: c.id, tier: c.tier, slotCol: c.slot, rowNum: c.row,
            zone: c.zone, block: c.block, size: c.size, status: c.status,
            hoursToLFD: c.hoursToLFD, priority: c.priority, consignee: c.consignee,
            carrierName: c.carrierName, hazmat: c.hazmat,
            channel: c.channel, dwellDays: c.dwellDays, grossKg: c.grossKg,
            whyHere: c.whyHere, seal: c.seal, terminal: c.terminal, empty: c.empty,
          }))
      : [],
    [containers, selectedLayout],
  )

  // ── Live block layouts + containers ───────────────────────────────────────
  const liveBlockLayouts = useMemo(() => computeLiveBlockLayouts(liveZones, zones), [liveZones, zones])

  const liveBlockViewContainers = useMemo((): ViewContainer[] => {
    if (!activeLiveBlock) return []
    return activeLiveSlots
      .filter(s => s.occupied_container_id != null)
      .map(s => {
        const bc = backendContainers.find(c => c.id === s.occupied_container_id)
        return {
          id:          bc?.container_number ?? String(s.occupied_container_id),
          tier:        s.tier, slotCol: s.bay, rowNum: s.row,
          zone:        activeLiveBlock[0] ?? "?",
          block:       parseInt(activeLiveBlock.split("-")[1] ?? "1", 10) || 1,
          size:        bc ? `${bc.size_ft}ft` : "?",
          status:      bc?.status ?? "UNKNOWN",
          hoursToLFD:  -9999, priority: "—", consignee: "—", carrierName: "—",
          hazmat:      bc?.is_hazmat ?? s.is_hazmat_approved,
          channel:     "road", dwellDays: 0, grossKg: 0, whyHere: "", seal: "—", terminal: "—", empty: false,
        } satisfies ViewContainer
      })
  }, [activeLiveBlock, activeLiveSlots, backendContainers])

  const liveBlockNumCols  = liveBays.length  > 0 ? Math.max(...liveBays)  : 10
  const liveBlockNumRows  = liveRows.length  > 0 ? Math.max(...liveRows)  : 3
  const liveBlockMaxTiers = liveTiers.length > 0 ? Math.max(...liveTiers) : 4
  const activeLiveZoneDef = zones.find(z => z.id === (activeLiveBlock?.[0] ?? ""))

  const matchingBlockLabels = useMemo(() => {
    if (!ql) return new Set<string>()
    return new Set(
      containers
        .filter(c => (c.id + c.consignee + c.address + c.carrierName).toLowerCase().includes(ql))
        .map(c => `${c.zone}-${String(c.block).padStart(2, "0")}`),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ql, containers])

  // ── Computed overlays ─────────────────────────────────────────────────────
  const equipmentPositions = useMemo(() => computeEquipmentPositions(OPERATORS, moves, blockLayouts), [moves, blockLayouts])
  const moveTrails         = useMemo(() => computeMoveTrails(moves, blockLayouts), [moves, blockLayouts])

  const congestionByBlock = useMemo(() => {
    const map = new Map<string, number>()
    for (const layout of blockLayouts) {
      const active = moves.filter(m =>
        (m.state === "IN_PROGRESS" || m.state === "ASSIGNED") &&
        (m.from.startsWith(layout.label) || m.to.startsWith(layout.label))
      ).length
      const eq = equipmentPositions.filter(e => e.currentBlock === layout.label).length
      map.set(layout.label, Math.min(1, (active + eq) / 4))
    }
    return map
  }, [blockLayouts, moves, equipmentPositions])

  const activeMoveBlocks = useMemo(() => {
    if (scrubberMin === null) return new Set<string>()
    const active = moves.filter(m => m.startMin <= scrubberMin && m.endMin >= scrubberMin)
    return new Set(
      active.flatMap(m => {
        const from = m.from.match(/^([A-Z]-\d+)/)?.[1]
        const to   = m.to.match(/^([A-Z]-\d+)/)?.[1]
        return [from, to].filter(Boolean) as string[]
      }),
    )
  }, [moves, scrubberMin])

  // ── Zone-level stats for left panel ──────────────────────────────────────
  const zoneStats = useMemo(() =>
    zones
      .filter(z => !EXCLUDED_ZONES.has(z.id))
      .map(z => {
        const cnt = containers.filter(c => c.zone === z.id).length
        const cap = z.blocks * z.rows * z.slots * z.maxTiers
        const pct = cap > 0 ? Math.round(cnt / cap * 100) : 0
        const shortName = z.name.replace(/^Zone [A-Z] — /, "")
        return { z, cnt, cap, pct, shortName }
      }),
    [zones, containers],
  )

  // ── Drawer mode ───────────────────────────────────────────────────────────
  type DrawerMode = "zone" | "block" | "slot"
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("block")
  const [drawerZone, setDrawerZone] = useState<string | null>(null)

  function lowestOccupancyInZone(zone: string): string {
    const zoneLayouts = blockLayouts.filter(l => l.zone === zone)
    if (!zoneLayouts.length) return "S-01"
    return zoneLayouts.sort((a, b) => a.occupancyPct - b.occupancyPct)[0].label
  }

  function handlePlannerAction(action: string, containerId: string) {
    const c = containers.find(x => x.id === containerId)
    const zone = c?.zone ?? "A"
    const dest = action === "reposition" ? lowestOccupancyInZone(zone) : "S-01"
    const verb = action === "retrieval" ? "Retrieval planned" : action === "reposition" ? "Reposition planned" : "Outbound staging planned"
    setPlannerToast(`${verb}: ${containerId} → ${dest}`)
  }

  const isLive = dataSource === "live"

  // ── Drawer slot content ───────────────────────────────────────────────────
  function drawerSlotView() {
    if (!selectedSlot) return null
    if (!isLive && selectedBlockLabel && selectedZoneDef) {
      return (
        <SlotStackView
          blockLabel={selectedBlockLabel}
          zoneName={selectedZoneDef.name}
          slotCol={selectedSlot.col}
          rowNum={selectedSlot.row}
          maxTiers={selectedZoneDef.maxTiers}
          containers={selectedBlockViewContainers.filter(c => c.slotCol === selectedSlot.col && c.rowNum === selectedSlot.row)}
          mode={mode}
          onBack={() => { setDrawerOpen(false); setSelectedSlot(null) }}
          onNavigate={onNavigate}
          plannerMode={plannerMode}
          onPlannerAction={handlePlannerAction}
        />
      )
    }
    if (isLive && activeLiveBlock) {
      return (
        <SlotStackView
          blockLabel={activeLiveBlock}
          zoneName={activeLiveZoneDef?.name ?? activeLiveBlock}
          slotCol={selectedSlot.col}
          rowNum={selectedSlot.row}
          maxTiers={liveBlockMaxTiers}
          containers={liveBlockViewContainers.filter(c => c.slotCol === selectedSlot.col && c.rowNum === selectedSlot.row)}
          mode={mode}
          onBack={() => { setDrawerOpen(false); setSelectedSlot(null) }}
        />
      )
    }
    return null
  }

  // ── Floating legend items ─────────────────────────────────────────────────
  const legendItems: [string, string][] = isLive
    ? [["Occupied","#374151"],["Empty","#e5e7eb"],["Hazmat + occupied","#f97316"],["Hazmat empty","#fed7aa"]]
    : LEGENDS[mode]

  // ── Drawer content resolver ───────────────────────────────────────────────
  function drawerContent() {
    if (drawerMode === "zone" && drawerZone) {
      const stat = zoneStats.find(s => s.z.id === drawerZone)
      const zoneDef = zones.find(z => z.id === drawerZone)
      const zoneContainers = containers
        .filter(c => c.zone === drawerZone)
        .sort((a, b) => a.hoursToLFD - b.hoursToLFD)
        .slice(0, 20)
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto">
          {/* Zone header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#e5e7eb] flex-none">
            <div>
              <div className="font-black text-[17px] tracking-tight">{t("yard.zone", drawerZone)}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{stat?.shortName}</div>
            </div>
            <button onClick={() => { setDrawerOpen(false); setDrawerZone(null) }}
              className="text-neutral-400 hover:text-neutral-800 transition-colors"
              style={{ width:28, height:28, borderRadius:"50%", background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>
              ✕
            </button>
          </div>
          {/* Zone KPIs */}
          <div className="grid grid-cols-2 gap-px border-b border-[#e5e7eb] flex-none" style={{ background:"#e5e7eb" }}>
            {[
              { k:"Containers", v:String(stat?.cnt ?? 0), sub:"on ground" },
              { k:"Occupancy",  v:`${stat?.pct ?? 0}%`,   sub:`of ${stat?.cap ?? 0} slots`, red:(stat?.pct ?? 0) > 85 },
              { k:"Blocks",     v:String(zoneDef?.blocks ?? "—"), sub:`${zoneDef?.rows} rows · ${zoneDef?.slots} slots` },
              { k:"Max tiers",  v:String(zoneDef?.maxTiers ?? "—"), sub:"stack limit" },
            ].map(m => (
              <div key={m.k} className="px-4 py-3 bg-white flex flex-col gap-0.5">
                <span className="ds-label text-neutral-500">{m.k}</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-black text-[20px] leading-none" style={{ color:('red' in m && m.red)?"#dc2626":undefined }}>{m.v}</span>
                  <span className="text-[11px] text-neutral-500">{m.sub}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Container list */}
          <div className="flex-1 overflow-auto">
            <div className="px-4 pt-3 pb-1 ds-label text-neutral-400">CONTAINERS — sorted by LFD urgency</div>
            {zoneContainers.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[#f3f4f6] hover:bg-[#fafafa] transition-colors">
                <div
                  className="w-2.5 h-2.5 flex-none rounded-sm"
                  style={{ background: containerColor({ status:c.status, hoursToLFD:c.hoursToLFD, channel:c.channel, dwellDays:c.dwellDays, priority:c.priority }, mode) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] font-bold text-neutral-900">{c.id}</div>
                  <div className="text-[10.5px] text-neutral-500 truncate">{c.consignee} · {c.carrierName}</div>
                </div>
                <div className="text-right flex-none">
                  <div className="text-[11px] font-mono" style={{ color: c.hoursToLFD < 24 ? "#dc2626" : c.hoursToLFD < 72 ? "#d97706" : "#6b7280" }}>
                    {c.hoursToLFD < 0 ? "BREACHED" : `${c.hoursToLFD}h LFD`}
                  </div>
                  <div className="text-[10.5px] text-neutral-400 font-mono">{c.address}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (drawerMode === "slot" && selectedSlot && drawerSlotView()) {
      return (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Back to block */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e5e7eb] flex-none bg-[#fafafa]">
            <button onClick={() => { setSelectedSlot(null); setDrawerMode("block") }}
              className="text-[11px] text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1">
              ← {t("yard.block")} {selectedBlockLabel ?? activeLiveBlock}
            </button>
            <span className="text-neutral-300 text-xs">›</span>
            <span className="text-[11px] text-neutral-700 font-semibold">Bay {selectedSlot.col} · {t("yard.row")} {selectedSlot.row}</span>
            <button onClick={() => { setDrawerOpen(false); setSelectedSlot(null); setDrawerMode("block") }}
              className="ml-auto text-neutral-400 hover:text-neutral-800 transition-colors"
              style={{ width:24, height:24, borderRadius:"50%", background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11 }}>
              ✕
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">{drawerSlotView()}</div>
        </div>
      )
    }

    if (drawerMode === "block" || (!drawerMode && selectedBlockLabel)) {
      const label = isLive ? activeLiveBlock : selectedBlockLabel
      const zoneDef = isLive ? activeLiveZoneDef : selectedZoneDef
      if (!label || !zoneDef) return null
      const viewContainers = isLive ? liveBlockViewContainers : selectedBlockViewContainers
      return (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Block header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e5e7eb] flex-none">
            <div>
              <div className="font-black text-[15px] tracking-tight">{label}</div>
              <div className="text-[10.5px] text-neutral-500 mt-0.5">{zoneDef.name}</div>
            </div>
            <button onClick={() => { setDrawerOpen(false); setSelectedBlockLabel(null); setSelectedSlot(null) }}
              className="text-neutral-400 hover:text-neutral-800 transition-colors"
              style={{ width:26, height:26, borderRadius:"50%", background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>
              ✕
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <BlockInteriorView
              blockLabel={label} zoneName={zoneDef.name}
              numCols={isLive ? liveBlockNumCols : zoneDef.slots}
              numRows={isLive ? liveBlockNumRows : zoneDef.rows}
              maxTiers={isLive ? liveBlockMaxTiers : zoneDef.maxTiers}
              containers={viewContainers} mode={mode} searchQuery={q}
              selectedSlot={selectedSlot}
              onSlotClick={(col, row) => { setSelectedSlot({ col, row }); setDrawerMode("slot") }}
              onBack={() => { setDrawerOpen(false); setSelectedBlockLabel(null); setSelectedSlot(null) }}
            />
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white text-neutral-900">

      {/* ══════════════════════════════════════════════════════════════════════
          COMPACT TOOLBAR
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-[#e5e7eb] flex-none bg-white">

        {/* Title */}
        <span className="font-black text-[15px] tracking-tight mr-1">{t("yard.title")}</span>

        {/* Map / Dashboard toggle */}
        <div className="flex" style={{ border:"1px solid #e5e7eb", borderRadius:5, overflow:"hidden" }}>
          {(["map","dash"] as const).map((k,i)=>(
            <button key={k} onClick={()=>setView(k)}
              className="text-[11px] px-3 py-1.5 font-bold transition-colors"
              style={{ borderRight:i===0?"1px solid #e5e7eb":undefined, background:view===k?"#111827":"transparent", color:view===k?"#fff":"#374151" }}>
              {k==="map"?"Map":"Dashboard"}
            </button>
          ))}
        </div>

        {/* Data source toggle */}
        <div className="flex items-center gap-1.5">
          <button
            disabled={!backendConnected}
            title={!backendConnected ? "Backend unavailable" : undefined}
            onClick={() => setDataSource(ds => ds === "seed" ? "live" : "seed")}
            className="relative inline-flex h-5 w-9 items-center flex-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: dataSource === "live" ? "#111827" : "#d1d5db", borderRadius: 10 }}
          >
            <span className="inline-block h-3.5 w-3.5 bg-white shadow transition-transform flex-none"
              style={{ borderRadius: "50%", transform: dataSource === "live" ? "translateX(20px)" : "translateX(2px)" }} />
          </button>
          <span className="text-[11px] text-neutral-600 font-medium">
            {dataSource === "live" ? (backendConnected ? "Live" : "Offline") : "Seed"}
          </span>
        </div>

        {/* Search */}
        {view==="map" && (
          <Input
            placeholder={t("common.search")}
            value={q} onChange={e => setQ(e.target.value)}
            className="w-52 h-7 text-xs"
          />
        )}

        {/* Color-by dropdown — toolbar position */}
        {view==="map" && !isLive && (
          <div ref={colorDropdownRef} className="relative">
            <button
              onClick={() => setColorDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 font-semibold"
              style={{ border:"1px solid #e5e7eb", borderRadius:5, color:"#374151" }}
            >
              Color: {COLOR_MODE_LABELS[mode]}
              <span style={{ fontSize:8, color:"#9ca3af" }}>{colorDropdownOpen?"▲":"▼"}</span>
            </button>
            {colorDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 bg-white"
                style={{ border:"1px solid #e5e7eb", borderRadius:5, boxShadow:"0 4px 12px rgba(0,0,0,0.10)", minWidth:160, overflow:"hidden" }}>
                {(["status","lfd","channel","dwell","priority","rehandle"] as ColorMode[]).map(k => (
                  <button key={k} onClick={() => { setMode(k); setColorDropdownOpen(false) }}
                    className="w-full text-left px-3 py-2 text-[11px] transition-colors hover:bg-[#f9fafb]"
                    style={{ fontWeight:mode===k?700:400, color:mode===k?"#111827":"#374151", background:mode===k?"#f9fafb":"transparent", borderBottom:"1px solid #f3f4f6" }}>
                    {COLOR_MODE_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status chip */}
        <span className="ml-auto text-[11px] text-neutral-400">
          {isLive
            ? `${backendContainers.length} containers · live yard`
            : ql
              ? `${all.filter(match).length} of ${all.length} match`
              : `${seedContainers.length} units · ${totalZones} zones`}
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAP VIEW — 3-column layout: left panel | map | right drawer
      ══════════════════════════════════════════════════════════════════════ */}
      {view==="map" && (
        <div className="flex flex-1 min-h-0">

          {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
          <div className="w-56 flex-none border-r border-[#e5e7eb] flex flex-col bg-white overflow-y-auto">

            {/* ── KPI summary ── */}
            {!isLive && (
              <div className="px-4 pt-3 pb-2 border-b border-[#e5e7eb]">
                <div className="ds-label text-neutral-400 mb-2">TERMINAL</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { k:"Occupancy", v:`${occupancyPct}%`, red:occupancyPct>85 },
                    { k:"TEU",       v:String(totalTEU),   red:false },
                    { k:"Avg tier",  v:`${avgTier}`,       red:false },
                    { k:"Detention", v:"$8.4k",            red:true  },
                  ].map(m => (
                    <div key={m.k} className="flex flex-col gap-0.5">
                      <span className="ds-label text-neutral-400">{m.k}</span>
                      <span className="font-black text-[22px] leading-none" style={{ color:m.red?"#dc2626":undefined }}>{m.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live KPIs */}
            {isLive && (
              <div className="px-4 pt-3 pb-2 border-b border-[#e5e7eb]">
                <div className="ds-label text-neutral-400 mb-2">LIVE YARD</div>
                {[
                  { k:"Slots", v:`${backendSlots.filter(s=>s.occupied_container_id!=null).length}/${backendSlots.length}` },
                  { k:"Occupancy", v:backendSlots.length?Math.round(backendSlots.filter(s=>s.occupied_container_id!=null).length/backendSlots.length*100)+"%" : "—" },
                ].map(m=>(
                  <div key={m.k} className="flex justify-between items-baseline py-1">
                    <span className="text-[10.5px] text-neutral-500">{m.k}</span>
                    <span className="font-black text-[22px] leading-none">{m.v}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Zone list ── */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 pt-3 pb-1.5">
                <div className="ds-label text-neutral-400 mb-2">ZONES</div>
                {zoneStats.map(s => {
                  const isActive = drawerZone === s.z.id && drawerMode === "zone" && drawerOpen
                  return (
                    <button
                      key={s.z.id}
                      onClick={() => {
                        setDrawerZone(s.z.id)
                        setDrawerMode("zone")
                        setSelectedSlot(null)
                        setSelectedBlockLabel(null)
                        setDrawerOpen(true)
                      }}
                      className="w-full text-left px-2.5 py-2 rounded mb-1 transition-colors"
                      style={{ background: isActive ? "#f0f9ff" : "transparent", border: `1px solid ${isActive ? "#bae6fd" : "transparent"}` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-[12px] text-neutral-900">{s.z.id}</span>
                          <span className="text-[10px] text-neutral-400 truncate max-w-[90px]">{s.shortName}</span>
                        </div>
                        <span className="text-[10.5px] font-mono font-semibold flex-none"
                          style={{ color: s.pct > 85 ? "#dc2626" : s.pct > 65 ? "#d97706" : "#374151" }}>
                          {s.pct}%
                        </span>
                      </div>
                      {/* Occupancy bar */}
                      <div className="h-1 rounded-full overflow-hidden" style={{ background:"#f3f4f6" }}>
                        <div className="h-1 rounded-full transition-all"
                          style={{ width:`${Math.min(s.pct, 100)}%`, background: s.pct > 85 ? "#dc2626" : s.pct > 65 ? "#d97706" : "#6b7280" }} />
                      </div>
                      <div className="text-[9.5px] text-neutral-400 mt-1">{s.cnt} units · {s.z.blocks}bl {s.z.rows}row</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Overlays ── */}
            {!isLive && (
              <div className="px-4 py-3 border-t border-[#e5e7eb]">
                <div className="ds-label text-neutral-400 mb-2">OVERLAYS</div>
                {([
                  { label:"Equipment [E]", on:showEquipment,  set:setShowEquipment  },
                  { label:"Move trails [T]", on:showTrails,   set:setShowTrails     },
                  { label:"Heat map",      on:showCongestion, set:setShowCongestion },
                  { label:"Planner",       on:plannerMode,    set:setPlannerMode    },
                ] as {label:string;on:boolean;set:(v:boolean)=>void}[]).map(o => (
                  <label key={o.label} className="flex items-center justify-between py-1 cursor-pointer">
                    <span className="text-[11px] text-neutral-600">{o.label}</span>
                    <button
                      onClick={() => o.set(!o.on)}
                      className="relative inline-flex h-4 w-7 items-center flex-none transition-colors"
                      style={{ background: o.on ? "#111827" : "#d1d5db", borderRadius: 10 }}
                    >
                      <span className="inline-block h-3 w-3 bg-white shadow transition-transform flex-none"
                        style={{ borderRadius:"50%", transform: o.on ? "translateX(14px)" : "translateX(2px)" }} />
                    </button>
                  </label>
                ))}
              </div>
            )}

            {/* ── Legend ── */}
            <div className="px-4 py-3 border-t border-[#e5e7eb]">
              <div className="ds-label text-neutral-400 mb-2">LEGEND · {isLive ? "LIVE" : mode.toUpperCase()}</div>
              {legendItems.map(([label, color]) => (
                <div key={label} className="flex items-center gap-2 py-0.5">
                  <div className="w-2.5 h-2.5 rounded-sm flex-none" style={{ background:color, border:"1px solid rgba(0,0,0,0.12)" }} />
                  <span className="text-[10.5px] text-neutral-600">{label}</span>
                </div>
              ))}
            </div>

            {/* ── Time scrubber ── */}
            {!isLive && (
              <div className="px-4 py-3 border-t border-[#e5e7eb]" style={{ background:"#fafafa" }}>
                <div className="ds-label text-neutral-400 mb-2">SHIFT TIMELINE</div>
                <input type="range" min={360} max={1320} step={5}
                  value={scrubberMin ?? 360}
                  onChange={e => setScrubberMin(Number(e.target.value))}
                  className="w-full accent-neutral-800 mb-1" />
                <div className="flex justify-between items-center">
                  <span className="text-[9.5px] text-neutral-400 tabular">06:00</span>
                  {scrubberMin !== null ? (
                    <button onClick={() => setScrubberMin(null)} className="text-[9.5px] text-neutral-400 hover:text-neutral-700">
                      {String(Math.floor(scrubberMin/60)).padStart(2,"0")}:{String(scrubberMin%60).padStart(2,"0")} ✕
                    </button>
                  ) : <span className="text-[9.5px] text-neutral-400 tabular">22:00</span>}
                </div>
                {scrubberMin !== null && (
                  <div className="text-[9.5px] text-amber-700 mt-1">{activeMoveBlocks.size} active block{activeMoveBlocks.size!==1?"s":""}</div>
                )}
              </div>
            )}
          </div>

          {/* ── CENTRE — map always at yard level ──────────────────────────────── */}
          <div className="flex-1 relative min-w-0 flex flex-col">
            {!isLive && blockLayouts.length === 0 && (
              <div className="flex-1 p-4">
                <Skeleton variant="card" className="h-full min-h-[200px]" />
              </div>
            )}
            {!isLive && blockLayouts.length > 0 && (
              <>
                {backendSlots.length === 0 ? null : null /* seed always shows */}
                <PhysicalYardMap
                  layouts={blockLayouts}
                  selectedBlock={selectedBlockLabel}
                  onSelectBlock={label => {
                    setSelectedBlockLabel(label)
                    setDrawerMode("block")
                    setDrawerZone(null)
                    setSelectedSlot(null)
                    setDrawerOpen(true)
                  }}
                  zoneNames={zoneNames}
                  equipment={equipmentPositions}
                  showEquipment={showEquipment}
                  moveTrails={moveTrails}
                  showTrails={showTrails}
                  congestionByBlock={congestionByBlock}
                  showCongestion={showCongestion}
                  activeMoveBlocks={scrubberMin !== null ? activeMoveBlocks : undefined}
                />
              </>
            )}

            {isLive && backendSlots.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <div className="bg-neutral-50 px-8 py-6 max-w-sm text-center" style={{ border:"1px solid #e5e7eb", borderRadius:5 }}>
                  <div className="font-black text-[16px] mb-2">No slot data from backend</div>
                  <div className="text-[12.5px] text-neutral-600 leading-relaxed">Backend connected but returned no yard slots. Check the planning engine.</div>
                </div>
              </div>
            )}

            {isLive && backendSlots.length > 0 && (
              <PhysicalYardMap
                layouts={liveBlockLayouts}
                selectedBlock={activeLiveBlock}
                onSelectBlock={blk => {
                  setLiveBlock(blk)
                  setDrawerMode("block")
                  setDrawerZone(null)
                  setSelectedSlot(null)
                  setDrawerOpen(true)
                }}
                zoneNames={zoneNames}
                showEquipment={false}
                showTrails={false}
                showCongestion={false}
              />
            )}
          </div>

          {/* ── RIGHT DRAWER — flex sibling that slides in ─────────────────────── */}
          <div
            className="flex-none overflow-hidden border-l border-[#e5e7eb] flex flex-col bg-white"
            style={{
              width: drawerOpen ? 440 : 0,
              transition: "width 260ms cubic-bezier(.4,0,.2,1)",
              minWidth: 0,
            }}
          >
            {/* Fixed-width inner so content never reflows during animation */}
            <div className="flex flex-col h-full min-h-0" style={{ width: 440 }}>
              {drawerOpen ? drawerContent() : null}
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DASHBOARD VIEW (unchanged)
      ══════════════════════════════════════════════════════════════════════ */}
      {view==="dash" && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="flex flex-wrap py-1">
            {[
              {k:"Truck turn P50",v:"13.8′",target:"15.0′",baseline:"31.4′",verdict:"WITHIN",red:false},
              {k:"Truck turn P90",v:"21.4′",target:"22.0′",baseline:"52.8′",verdict:"WITHIN",red:false},
              {k:"Job cycle P50", v:"4.9′", target:"5.0′", baseline:"8.7′", verdict:"WITHIN",red:false},
              {k:"Job cycle P90", v:"7.6′", target:"7.5′", baseline:"14.2′",verdict:"OVER 0.1′",red:true},
            ].map(c=>(
              <div key={c.k} className="flex-1 basis-52 px-5 py-4">
                <div className="flex justify-between items-baseline">
                  <span className="ds-label text-neutral-500">{c.k}</span>
                  <span className={`text-[10px] font-bold tracking-wider ${c.red?"text-[#dc2626]":""}`}>{c.verdict}</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className={`font-black text-[26px] leading-none tracking-tight ${c.red?"text-[#dc2626]":""}`}>{c.v}</span>
                  <span className="text-[11.5px] text-neutral-500">target {c.target} · baseline {c.baseline}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid min-h-80" style={{ gridTemplateColumns:"minmax(360px,1fr) minmax(320px,1fr)" }}>
            <div className="px-5 py-4" style={{ borderRight:"1px solid #f3f4f6" }}>
              <div className="ds-label text-neutral-500 font-bold mb-3">Truck turn by hour</div>
              <div className="flex items-end gap-2 h-40">
                {turnByHour.map(t=>(
                  <div key={t.hour} className="flex-1 flex flex-col justify-end gap-0.5 h-full">
                    <div className="bg-neutral-300" style={{height:((t.p90-t.p50)/28*100).toFixed(1)+"%"}} />
                    <div className={t.p50>15?"bg-[#dc2626]":"bg-neutral-800"} style={{height:(t.p50/28*100).toFixed(1)+"%"}} />
                    <span className="text-[9.5px] text-neutral-500">{t.hour}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-neutral-500 mt-3 leading-relaxed">Grey is P90, solid is P50. The 08:00 hour breaches — inbound put-away competes with outbound loading.</p>
              <div className="mt-5 ds-label text-neutral-500 font-bold mb-2">Machine job cycle by move type</div>
              {cycleByType.map(r=>(
                <div key={r.type} className="py-2.5">
                  <div className="flex justify-between text-[11.5px]">
                    <span>{r.type}</span>
                    <span className="tabular text-neutral-500">P50 <strong className={r.p50>5?"text-[#dc2626]":""}>{r.p50.toFixed(1)}′</strong> · P90 {r.p90.toFixed(1)}′ · n={r.n}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4">
              <div className="flex items-baseline gap-3 mb-4">
                <div className="ds-label text-neutral-500 font-bold">
                  {forecast ? "Forecast from planning engine" : "Machine-hours required vs available"}
                </div>
                {backendConnected && !forecast && (
                  <Button variant="secondary" size="sm" className="text-[10.5px]" onClick={loadForecast} disabled={loadingFcast}>
                    {loadingFcast ? t("common.loading") : "Load forecast"}
                  </Button>
                )}
                {forecast && (
                  <button className="text-[10.5px] text-neutral-400 hover:text-neutral-700" onClick={() => setForecast(null)}>← seed data</button>
                )}
              </div>
              {!forecast && capacity.map(c=>(
                <div key={c.month} className="py-3">
                  <div className="flex justify-between text-[11.5px]">
                    <span className="font-semibold">{c.month} · {c.volume} containers</span>
                    <span className={`tabular ${c.breach?"text-[#dc2626]":"text-neutral-600"}`}>{c.required.toFixed(1)} req / {c.available.toFixed(1)} avail</span>
                  </div>
                  <div className="relative h-2 bg-neutral-100 mt-2">
                    <div className={c.breach?"bg-[#dc2626]":"bg-neutral-600"} style={{position:"absolute",left:0,top:0,bottom:0,width:Math.min(100,c.required/55*100).toFixed(0)+"%"}} />
                    <div className="absolute top-[-2px] h-3 w-0.5 bg-neutral-900" style={{left:(c.available/55*100).toFixed(0)+"%"}} />
                  </div>
                  <div className="text-[10.5px] text-neutral-500 mt-1.5">{c.breach?"breach — "+(c.required-c.available).toFixed(1)+" machine-hours short":"within available hours"}</div>
                </div>
              ))}
              {forecast && (
                <>
                  {forecast.first_over_capacity_day && (
                    <div className="mb-4 px-3 py-2.5 text-[11.5px] text-amber-900" style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:5 }}>
                      First over-capacity day: <strong>{forecast.first_over_capacity_day}</strong>
                    </div>
                  )}
                  <div className="flex items-end gap-1.5 h-36 mb-4">
                    {forecast.points.map(p => {
                      const maxOcc = Math.max(...forecast.points.map(x => x.projected_occupancy), p.capacity)
                      return (
                        <div key={p.day} className="flex-1 flex flex-col justify-end items-center gap-0.5 h-full min-w-[18px]">
                          <div className="w-full relative flex items-end justify-center h-full">
                            <div className="absolute bottom-0 w-full opacity-30 bg-neutral-400" style={{height:(p.capacity/maxOcc*100).toFixed(1)+"%"}} />
                            <div className={`w-[60%] ${p.over_capacity?"bg-[#dc2626]":"bg-neutral-700"}`} style={{height:(p.projected_occupancy/maxOcc*100).toFixed(1)+"%"}} />
                          </div>
                          <span className="text-[8px] text-neutral-500 rotate-45 origin-left mt-1">{p.day.slice(5)}</span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">Dark bar is projected occupancy vs grey cap bar. Red = over capacity.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Planner toast */}
      {plannerToast && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2.5 px-4 py-2.5 text-[12px] font-semibold text-green-900"
          style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:6, boxShadow:"0 4px 12px rgba(0,0,0,0.10)" }}>
          <span style={{ color:"#16a34a", fontSize:16 }}>✓</span>
          {plannerToast}
        </div>
      )}
    </div>
  )
}
