import { useState, useEffect, useMemo, useRef } from "react"
import Skeleton from "@/components/ui/Skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useData } from "@/lib/DataContext"
import type { Container } from "@/data/yard-data"
import { OPERATORS } from "@/data/yard-data"
import { CARRIERS } from "@/data/reference-pools"
import { backendApi } from "@/lib/backend-api"
import type { BackendContainerDetail, BackendForecast } from "@/lib/backend-api"
import PhysicalYardMap from "@/components/yard/PhysicalYardMap"
import BlockInteriorView from "@/components/yard/BlockInteriorView"
import SlotStackView from "@/components/yard/SlotStackView"
import type { ViewContainer } from "@/components/yard/types"
import {
  computeBlockLayouts, computeLiveBlockLayouts,
  computeEquipmentPositions, computeMoveTrails,
  computeHotByBlock, computeDetentionExposure, computeRehandleByBlock,
} from "@/lib/yard-layout"
import { containerColor as _containerColor, LEGENDS, LEGEND_ENTRIES } from "@/lib/yard-color"
import type { ColorMode } from "@/lib/yard-color"
import { YT } from "@/lib/yard-tokens"
import { useLang } from "@/lib/i18n"

interface Props {
  focus: string | null
  onNavigate: (target: string, focus?: string) => void
}

type DataSource = "seed" | "live"
type ZoomLevel  = "yard" | "block"   // "slot" removed — slot detail lives in drawer

// ── Shift Story — Phase 3.4 ───────────────────────────────────────────────────
interface ShiftStoryStep {
  id:            number
  title:         string
  time:          string
  narration:     string
  highlightMode: "none" | "hot" | "detention"
  zoom:          number
  focusX?:       number
  focusY?:       number
}

const SHIFT_STORY: ShiftStoryStep[] = [
  {
    id: 1, title: "Inbound wave arrives", time: "06:00",
    narration: "Three trucks clear the gate. System reads ASNs and locks in putaway slots in Zones A and B — the 15-minute yard clock starts.",
    highlightMode: "none", zoom: 0.35, focusX: 1150, focusY: 700,
  },
  {
    id: 2, title: "Hot container flagged", time: "08:30",
    narration: "Free time expires in 3 h. Carrier detention clock is live. System auto-escalates priority and alerts the operator.",
    highlightMode: "hot", zoom: 0.82,
  },
  {
    id: 3, title: "Zero-rehandle retrieval locked in", time: "09:15",
    narration: "Top-of-stack, zero moves needed first. Justin on Reach Stacker assigned — 12 min ETA. System protects the truck-turn window.",
    highlightMode: "hot", zoom: 0.88,
  },
  {
    id: 4, title: "Detention avoided — $8.4 k protected", time: "09:45",
    narration: "Container staged and carrier confirmed before LFD. Detention exposure this shift: $0. An $8.4 k risk turned into a non-event.",
    highlightMode: "detention", zoom: 0.37, focusX: 1150, focusY: 650,
  },
]

// Seed-constant truck-turn P90 (matches the Dashboard view figure)
const TRUCK_P90 = "21.4′"

// Small donut ring showing occupancy — WCAG AA verified on the dark panel
function OccupancyRing({ pct, size = 32 }: { pct: number; size?: number }) {
  const r    = (size - 5) / 2
  const circ = 2 * Math.PI * r
  const arc  = Math.min(pct / 100, 1) * circ
  const color = pct > 85 ? "#f87171" : pct > 65 ? "#fbbf24" : "#34d399"
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }} aria-hidden="true">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3.5"
        strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round"/>
    </svg>
  )
}

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
  const colorDropdownRef  = useRef<HTMLDivElement>(null)
  // Drawer focus management — save what opened it so we can return focus on close
  const drawerPanelRef   = useRef<HTMLDivElement>(null)
  const drawerInvokerRef = useRef<HTMLElement | null>(null)

  // ── Step 2: floating legend ───────────────────────────────────────────────
  const [legendExpanded, setLegendExpanded] = useState(false)

  // ── Step 3: drawer ────────────────────────────────────────────────────────
  const [drawerOpen,      setDrawerOpen]      = useState(false)
  // When true, the block drawer shows only hot containers (hoursToLFD ≤ 4 h).
  // Set to true by handleHotBadgeClick; cleared on normal block click or close.
  const [drawerHotFilter, setDrawerHotFilter] = useState(false)
  const [panelCollapsed,  setPanelCollapsed]  = useState(false)

  // ── Shift Story state — Phase 3.4 ─────────────────────────────────────────
  const [storyMode,    setStoryMode]    = useState(false)
  const [storyStep,    setStoryStep]    = useState(0)
  const [storyPlaying, setStoryPlaying] = useState(false)

  // ── Keyboard UX helpers — Phase 3.5 ───────────────────────────────────────
  const [shortcutOpen,   setShortcutOpen]   = useState(false)
  const [fitViewSeq,     setFitViewSeq]     = useState(0)
  const [commandedView,  setCommandedView]  = useState<{ cx: number; cy: number; zoom: number; seq: number } | null>(null)

  // ── Colorblind-safe mode — Phase 3.6 ──────────────────────────────────────
  const [cbMode, setCbMode] = useState(false)

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

  // ── Drawer focus management ───────────────────────────────────────────────
  // Open: move focus into panel after slide animation. Close: return to invoker.
  useEffect(() => {
    if (!drawerOpen) {
      drawerInvokerRef.current?.focus()
      return
    }
    const timer = setTimeout(() => {
      drawerPanelRef.current
        ?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]')
        ?.focus()
    }, 280) // matches slide transition (260 ms + small buffer)
    return () => clearTimeout(timer)
  }, [drawerOpen])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return
      if (view !== "map") return
      switch (e.key) {
        case "Escape":
          if (shortcutOpen)  { setShortcutOpen(false); break }
          if (storyMode)     { setStoryMode(false); setStoryPlaying(false); setStoryStep(0); break }
          if (drawerOpen) {
            // Esc drills back one level: slot → block → close (mirrors onBack chain)
            if (drawerMode === "slot") { setSelectedSlot(null); setDrawerMode("block") }
            else { setDrawerOpen(false); setSelectedSlot(null) }
          } else if (zoomLevel === "block") { setZoomLevel("yard"); setSelectedSlot(null) }
          break
        case "1": setZoomLevel("yard"); setSelectedSlot(null); setDrawerOpen(false); break
        case "2": if (selectedBlockLabel || activeLiveBlock) setZoomLevel("block"); break
        case "e": case "E": setShowEquipment(v => !v); break
        case "t": case "T": setShowTrails(v => !v); break
        case "h": case "H": setShowCongestion(v => !v); break
        case "p": case "P": setPlannerMode(v => !v); break
        case "f": case "F": setFitViewSeq(s => s + 1); break
        case "?": setShortcutOpen(v => !v); break
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, zoomLevel, drawerOpen, selectedBlockLabel, selectedSlot, shortcutOpen, storyMode])

  // ── Auto-clear planner toast ──────────────────────────────────────────────
  useEffect(() => {
    if (!plannerToast) return
    const t = setTimeout(() => setPlannerToast(null), 3500)
    return () => clearTimeout(t)
  }, [plannerToast])

  // ── Story: pan/zoom when step changes ────────────────────────────────────
  useEffect(() => {
    if (!storyMode) return
    const step = SHIFT_STORY[storyStep]
    if (!step) return
    let cx = step.focusX ?? 1150, cy = step.focusY ?? 650
    if (step.highlightMode === "hot" && hotByBlock) {
      const entry = [...hotByBlock.entries()].find(([, n]) => n > 0)
      if (entry) {
        const bl = blockLayouts.find(l => l.label === entry[0])
        if (bl) { cx = bl.x + bl.w / 2; cy = bl.y + bl.h / 2 }
      }
    }
    setCommandedView({ cx, cy, zoom: step.zoom, seq: storyStep * 100 + step.id })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyMode, storyStep])

  // ── Story: auto-advance when playing ─────────────────────────────────────
  useEffect(() => {
    if (!storyPlaying || !storyMode) return
    const t = setTimeout(() => {
      if (storyStep < SHIFT_STORY.length - 1) setStoryStep(s => s + 1)
      else setStoryPlaying(false)
    }, 5200)
    return () => clearTimeout(t)
  }, [storyPlaying, storyMode, storyStep])

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
    try {
      // DEFERRED: no backend route yet — backendApi.forecast(3)
    } catch (err) { console.error("[YardMap] forecast:", err) }
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

  // Hot-container counts per block — feeds z5 pulsing badge in PhysicalYardMap
  const hotByBlock = useMemo(() => computeHotByBlock(containers), [containers])

  // Detention exposure — computed from carrier schedules; drives the interactive KPI + block highlight
  const detentionExposure = useMemo(() => computeDetentionExposure(containers, CARRIERS), [containers])

  // Rehandle debt — RESHUFFLE move count per source block; drives the ↻N glyph at z5
  const rehandleByBlock = useMemo(() => computeRehandleByBlock(moves), [moves])

  // Worst LFD tier per block — drives colorblind shape glyphs (Phase 3.6)
  const worstLfdByBlock = useMemo(() => {
    const map = new Map<string, "breached" | "risk24" | "risk72">()
    for (const c of containers) {
      const label = `${c.zone}-${String(c.block).padStart(2, "0")}`
      const cur = map.get(label)
      const next: "breached" | "risk24" | "risk72" | null =
        c.hoursToLFD < 0    ? "breached" :
        c.hoursToLFD <= 24  ? "risk24"   :
        c.hoursToLFD <= 72  ? "risk72"   : null
      if (!next) continue
      if (!cur || next === "breached" || (next === "risk24" && cur === "risk72"))
        map.set(label, next)
    }
    return map
  }, [containers])

  // Total hot containers across all blocks — for collapsed status strip + HOT KPI cell
  const hotCount = useMemo(
    () => [...hotByBlock.values()].reduce((s, v) => s + v, 0),
    [hotByBlock],
  )

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
  type DrawerMode = "zone" | "block" | "slot" | "detention"
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("block")
  const [detentionHovered, setDetentionHovered] = useState(false)
  const [drawerZone, setDrawerZone] = useState<string | null>(null)

  function lowestOccupancyInZone(zone: string): string {
    const zoneLayouts = blockLayouts.filter(l => l.zone === zone)
    if (!zoneLayouts.length) return "S-01"
    return zoneLayouts.sort((a, b) => a.occupancyPct - b.occupancyPct)[0].label
  }

  /** Open the block drawer pre-filtered to only show hot containers (LFD ≤ 4 h).
   *  Called when the user clicks the ⏱ badge on a block in PhysicalYardMap (z5). */
  function handleHotBadgeClick(blockLabel: string) {
    drawerInvokerRef.current = document.activeElement as HTMLElement
    setSelectedBlockLabel(blockLabel)
    setDrawerMode("block")
    setDrawerZone(null)
    setSelectedSlot(null)
    setDrawerOpen(true)
    setDrawerHotFilter(true)
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
          onBack={() => { setSelectedSlot(null); setDrawerMode("block") }}
          onBackAll={() => { setDrawerOpen(false); setSelectedSlot(null) }}
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
          onBack={() => { setSelectedSlot(null); setDrawerMode("block") }}
          onBackAll={() => { setDrawerOpen(false); setSelectedSlot(null) }}
          onNavigate={onNavigate}
        />
      )
    }
    return null
  }

  // ── Floating legend entries (label, color, shape) — Phase 3.6 ───────────
  const legendEntries: [string, string, string][] = isLive
    ? [["Occupied","#374151","■"],["Empty","#e5e7eb","○"],["Hazmat + occupied","#f97316","◆"],["Hazmat empty","#fed7aa","◆"]]
    : LEGEND_ENTRIES[mode]

  // ── Drawer content resolver ───────────────────────────────────────────────
  function drawerContent() {
    // ── Detention worklist ────────────────────────────────────────────────
    if (drawerMode === "detention") {
      const { rows, totalUsd } = detentionExposure
      const bCount = rows.filter(r => r.status === "breached").length
      const rCount = rows.length - bCount
      return (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="flex items-start justify-between px-4 py-3 border-b border-[#e5e7eb] flex-none">
            <div>
              <div className="font-black text-[15px] tracking-tight leading-tight">Detention exposure</div>
              <div className="text-[10.5px] text-neutral-500 mt-0.5">
                {bCount > 0 && <span className="text-red-600 font-bold">{bCount} breached</span>}
                {bCount > 0 && rCount > 0 && <span className="mx-1">·</span>}
                {rCount > 0 && <span className="text-amber-600 font-semibold">{rCount} at risk</span>}
                {rows.length === 0 && <span>No exposure</span>}
                {rows.length > 0 && <span className="ml-2 font-black text-red-700">${Math.round(totalUsd).toLocaleString()} at risk</span>}
              </div>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-neutral-700 text-lg leading-none transition-colors">×</button>
          </div>
          {/* Legend — shape + color (always, not just cbMode) */}
          <div className="px-4 py-1.5 border-b border-[#f3f4f6] flex-none">
            <div className="flex gap-5 text-[10px] text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span style={{ fontSize: 11, fontWeight: 800, color: YT.signalBreach, lineHeight: 1 }}>▲</span>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: YT.signalBreach }}/>
                <span>Breached LFD</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ fontSize: 11, fontWeight: 800, color: YT.signalWarnText, lineHeight: 1 }}>◉</span>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: YT.signalWarn }}/>
                <span>At risk ≤ 24 h</span>
              </span>
            </div>
          </div>
          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {rows.map(r => {
              const blockLabel = `${r.zone}-${String(r.block).padStart(2, "0")}`
              const isBreached = r.status === "breached"
              const accentColor = isBreached ? YT.signalBreach : YT.signalWarnText
              const lfdLabel = isBreached
                ? `BREACHED ${Math.abs(Math.round(r.hoursToLFD))}h ago`
                : `LFD in ${Math.round(r.hoursToLFD)}h`
              return (
                <button key={r.containerId}
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-[#f3f4f6] hover:bg-[#fafafa] transition-colors"
                  onClick={() => {
                    setSelectedBlockLabel(blockLabel)
                    setSelectedSlot({ col: r.slot, row: r.row })
                    setDrawerMode("slot")
                  }}
                >
                  <div className="w-2.5 h-2.5 flex-none rounded-sm mt-0.5" style={{ background: accentColor }}/>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[12px] font-bold text-neutral-900">{r.containerId}</div>
                    <div className="text-[10.5px] text-neutral-500 truncate">{r.carrierName} · {r.address}</div>
                  </div>
                  <div className="text-right flex-none">
                    <div className="text-[10px] font-semibold" style={{ color: accentColor }}>{lfdLabel}</div>
                    <div className="text-[11px] font-black" style={{ color: accentColor }}>${Math.round(r.exposureUsd)}</div>
                  </div>
                </button>
              )
            })}
            {rows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                <div className="text-[14px] font-semibold">No detention exposure</div>
                <div className="text-[11px] mt-1">All containers within free time</div>
              </div>
            )}
          </div>
        </div>
      )
    }

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
                  <div className="text-[11px] font-mono" style={{ color: c.hoursToLFD < 24 ? YT.signalBreach : c.hoursToLFD < 72 ? YT.signalWarnText : YT.labelMuted }}>
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
      // Hot-filter: when the drawer was opened via the ⏱ badge, show only
      // containers within 4 h of LFD. (-9999 = live mode / unavailable — excluded.)
      const rawContainers  = isLive ? liveBlockViewContainers : selectedBlockViewContainers
      const viewContainers = drawerHotFilter && !isLive
        ? rawContainers.filter(c => c.hoursToLFD !== -9999 && c.hoursToLFD <= 4)
        : rawContainers
      return (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Block header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e5e7eb] flex-none">
            <div>
              <div className="font-black text-[15px] tracking-tight">{label}</div>
              <div className="text-[10.5px] text-neutral-500 mt-0.5">{zoneDef.name}</div>
            </div>
            <button onClick={() => { setDrawerOpen(false); setSelectedBlockLabel(null); setSelectedSlot(null); setDrawerHotFilter(false) }}
              className="text-neutral-400 hover:text-neutral-800 transition-colors"
              style={{ width:26, height:26, borderRadius:"50%", background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>
              ✕
            </button>
          </div>
          {/* Hot-filter indicator — visible only when opened via the hot badge */}
          {drawerHotFilter && !isLive && (
            <div className="flex items-center justify-between px-3 py-1.5 flex-none border-b border-red-100" style={{ background:"#fef2f2" }}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-700">
                <span>⏱</span>
                <span>{viewContainers.length} hot container{viewContainers.length !== 1 ? "s" : ""} · LFD ≤ 4 h</span>
              </div>
              <button className="text-[10px] font-semibold text-red-500 hover:text-red-800 transition-colors"
                onClick={() => setDrawerHotFilter(false)}>
                Show all
              </button>
            </div>
          )}
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

        {/* Shift Story play button — 90-second exec walkthrough (Phase 3.4) */}
        {view === "map" && !isLive && (
          <button
            onClick={() => {
              if (storyMode) { setStoryMode(false); setStoryPlaying(false); setStoryStep(0) }
              else { setStoryMode(true); setStoryStep(0); setStoryPlaying(true) }
            }}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 font-semibold transition-colors"
            style={{ border: "1px solid #e5e7eb", borderRadius: 5, background: storyMode ? "#111827" : "transparent", color: storyMode ? "#fff" : "#374151" }}
            title="Shift Story — guided 90-second exec demo"
          >
            {storyMode ? "■ Story" : "▶ Story"}
          </button>
        )}

        {/* ? shortcut hint */}
        {view === "map" && (
          <button onClick={() => setShortcutOpen(true)}
            className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors font-mono"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}
            title="Keyboard shortcuts">
            ?
          </button>
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

      {/* Keyboard shortcut cheatsheet — ? key opens, Esc closes — Phase 3.5 */}
      {shortcutOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.38)" }}
          onClick={() => setShortcutOpen(false)}>
          <div style={{ width: 308, background: "white", borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", padding: "22px 26px" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 16 }}>Keyboard shortcuts</div>
            {([
              ["H",    "Toggle heat map (congestion)"],
              ["T",    "Toggle move trails"],
              ["E",    "Toggle equipment"],
              ["P",    "Toggle planner mode"],
              ["F",    "Fit yard to view"],
              ["1",    "Yard-level view"],
              ["2",    "Block-level view"],
              ["Esc",  "Close drawer or go back"],
              ["?",    "This cheatsheet"],
            ] as [string, string][]).map(([key, desc]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 12, color: "#475569" }}>{desc}</span>
                <kbd style={{ fontSize: 10, fontFamily: "ui-monospace,monospace", fontWeight: 700, background: "#f1f5f9", color: "#1e293b", padding: "2px 7px", borderRadius: 5, border: "1px solid #e2e8f0", flexShrink: 0 }}>{key}</kbd>
              </div>
            ))}
            <button onClick={() => setShortcutOpen(false)}
              style={{ marginTop: 16, width: "100%", fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MAP VIEW — 3-column layout: left panel | map | right drawer
      ══════════════════════════════════════════════════════════════════════ */}
      {view==="map" && (
        <div className="flex flex-1 min-h-0">

          {/* ── LEFT PANEL ─────────────────────────────────────────────────────────
              Dark-glass panel: rgba(15,20,30,0.92) + blur(14px).
              WCAG AA verified against effective blended bg ~#1F232C:
                labels rgba(255,255,255,0.55)  → 6.1:1  ✓
                values rgba(255,255,255,0.90)  → 13.4:1 ✓
                red    #f87171                 → 5.6:1  ✓
                amber  #fbbf24                 → 9.6:1  ✓
          ────────────────────────────────────────────────────────────────────── */}
          {panelCollapsed ? (

            /* ── COLLAPSED: 48 px status strip ─────────────────────────────── */
            <div className="flex-none flex flex-col items-center overflow-hidden"
              style={{ width: 48, background: "rgba(15,20,30,0.92)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderRight: "1px solid rgba(255,255,255,0.09)" }}>
              {/* Expand toggle */}
              <button onClick={() => setPanelCollapsed(false)}
                className="w-12 h-10 flex items-center justify-center flex-none hover:bg-white/10 transition-colors"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)", fontSize: 10 }}
                title="Expand panel">
                ▶
              </button>
              {/* Vertical status: occupancy · TEU · hot · detention */}
              <div className="flex-1 flex items-center justify-center overflow-hidden" style={{ padding: "12px 0" }}>
                <span style={{
                  writingMode: "vertical-rl" as const,
                  transform: "rotate(180deg)",
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "rgba(255,255,255,0.60)",
                  whiteSpace: "nowrap",
                }}>
                  {occupancyPct}%&nbsp;·&nbsp;{totalTEU}&nbsp;TEU&nbsp;·&nbsp;⏱{hotCount}&nbsp;·&nbsp;{detentionExposure.totalUsd >= 1000 ? `$${(detentionExposure.totalUsd/1000).toFixed(1)}k` : `$${Math.round(detentionExposure.totalUsd)}`}
                </span>
              </div>
            </div>

          ) : (

            /* ── EXPANDED: full 224 px panel ────────────────────────────────── */
            <div className="w-56 flex-none flex flex-col overflow-y-auto"
              style={{ background: "rgba(15,20,30,0.92)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderRight: "1px solid rgba(255,255,255,0.09)" }}>

              {/* Solid header band — anchors the section; text never on raw map */}
              <div className="flex items-center justify-between px-4 py-2 flex-none"
                style={{ background: "rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.18em", color: "rgba(255,255,255,0.55)" }}>
                  {isLive ? "LIVE YARD" : "TERMINAL"}
                </span>
                <button onClick={() => setPanelCollapsed(true)}
                  className="rounded px-1 hover:bg-white/10 transition-colors"
                  style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}
                  title="Collapse to status strip">
                  ◀
                </button>
              </div>

              {/* ── SEED KPIs — money-and-risk leads ──────────────────────────── */}
              {!isLive && (
                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>

                  {/* 1 · DETENTION RISK — largest figure, drillable */}
                  <button
                    className="w-full text-left px-4 pt-3 pb-2.5 hover:bg-white/[0.04] transition-colors"
                    onMouseEnter={() => setDetentionHovered(true)}
                    onMouseLeave={() => setDetentionHovered(false)}
                    onClick={() => {
                      setDetentionHovered(false)
                      setDrawerMode("detention")
                      setDrawerZone(null)
                      setSelectedBlockLabel(null)
                      setSelectedSlot(null)
                      setDrawerHotFilter(false)
                      setDrawerOpen(true)
                    }}
                    title="Hover to highlight contributing blocks on map · Click to open worklist">
                    <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.16em", color: "rgba(255,255,255,0.55)", marginBottom: 5 }}>DETENTION RISK</div>
                    <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, color: "#f87171", fontFamily: "ui-monospace,monospace" }}>
                      {detentionExposure.totalUsd >= 1000
                        ? `$${(detentionExposure.totalUsd / 1000).toFixed(1)}k`
                        : `$${Math.round(detentionExposure.totalUsd)}`}
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.36)", marginTop: 4, letterSpacing: "0.06em" }}>↗ next 72 h · hover to highlight blocks</div>
                  </button>

                  {/* 2 · HOT containers + Occupancy ring */}
                  <div className="grid grid-cols-2 px-4 py-2.5 gap-3"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    <div>
                      <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", marginBottom: 5 }}>HOT ⏱</div>
                      <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1, fontFamily: "ui-monospace,monospace", color: hotCount > 0 ? "#f87171" : "rgba(255,255,255,0.85)" }}>
                        {hotCount}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>OCCUPANCY</div>
                      <div className="flex items-center gap-1.5">
                        <OccupancyRing pct={occupancyPct} />
                        <span style={{ fontSize: 17, fontWeight: 900, lineHeight: 1, color: occupancyPct > 85 ? "#f87171" : occupancyPct > 65 ? "#fbbf24" : "rgba(255,255,255,0.85)" }}>
                          {occupancyPct}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3 · TEU · Avg tier · Truck-turn P90 */}
                  <div className="grid grid-cols-3 px-4 pb-2.5 gap-1"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    {[
                      { label: "TEU",      value: String(totalTEU) },
                      { label: "AVG TIER", value: String(avgTier)  },
                      { label: "TURN P90", value: TRUCK_P90        },
                    ].map(({ label, value }) => (
                      <div key={label} className="pt-2">
                        <div style={{ fontSize: 7.5, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1, fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.85)" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── LIVE KPIs ─────────────────────────────────────────────────── */}
              {isLive && (
                <div className="px-4 pt-3 pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {[
                    { k: "Slots",     v: `${backendSlots.filter(s => s.occupied_container_id != null).length}/${backendSlots.length}` },
                    { k: "Occupancy", v: backendSlots.length ? Math.round(backendSlots.filter(s => s.occupied_container_id != null).length / backendSlots.length * 100) + "%" : "—" },
                  ].map(m => (
                    <div key={m.k} className="flex justify-between items-baseline py-1">
                      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)" }}>{m.k}</span>
                      <span style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.90)" }}>{m.v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Zone list ─────────────────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-3 pb-2">
                  <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>ZONES</div>
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
                        className="w-full text-left px-2 py-2 rounded mb-1 transition-colors hover:bg-white/[0.06]"
                        style={{ background: isActive ? "rgba(255,255,255,0.13)" : undefined, border: `1px solid ${isActive ? "rgba(255,255,255,0.22)" : "transparent"}` }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 900, fontSize: 12, color: "rgba(255,255,255,0.90)", flexShrink: 0 }}>{s.z.id}</span>
                            <span className="truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{s.shortName}</span>
                          </div>
                          <span style={{ fontSize: 10.5, fontFamily: "ui-monospace,monospace", fontWeight: 600, flexShrink: 0, marginLeft: 4, color: s.pct > 85 ? "#f87171" : s.pct > 65 ? "#fbbf24" : "rgba(255,255,255,0.70)" }}>
                            {s.pct}%
                          </span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
                          <div className="h-1 rounded-full transition-all"
                            style={{ width: `${Math.min(s.pct, 100)}%`, background: s.pct > 85 ? "#f87171" : s.pct > 65 ? "#fbbf24" : "rgba(255,255,255,0.38)" }} />
                        </div>
                        <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.33)", marginTop: 3 }}>{s.cnt} units · {s.z.blocks}bl {s.z.rows}row</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── Overlays ──────────────────────────────────────────────────── */}
              {!isLive && (
                <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>OVERLAYS</div>
                  {([
                    { label: "Equipment [E]",   on: showEquipment,  set: setShowEquipment  },
                    { label: "Move trails [T]", on: showTrails,     set: setShowTrails     },
                    { label: "Heat map [H]",    on: showCongestion, set: setShowCongestion },
                    { label: "Planner [P]",     on: plannerMode,    set: setPlannerMode    },
                    { label: "CB-safe shapes",  on: cbMode,         set: setCbMode         },
                  ] as { label: string; on: boolean; set: (v: boolean) => void }[]).map(o => (
                    <label key={o.label} className="flex items-center justify-between py-1 cursor-pointer">
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }}>{o.label}</span>
                      <button
                        onClick={() => o.set(!o.on)}
                        className="relative inline-flex h-4 w-7 items-center flex-none transition-colors"
                        style={{ background: o.on ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.16)", borderRadius: 10 }}>
                        <span className="inline-block h-3 w-3 shadow transition-transform flex-none"
                          style={{ borderRadius: "50%", background: o.on ? "#0F141E" : "rgba(255,255,255,0.80)", transform: o.on ? "translateX(14px)" : "translateX(2px)" }} />
                      </button>
                    </label>
                  ))}
                </div>
              )}

              {/* ── Legend — Phase 3.6: shape+color when CB-safe mode is on ──── */}
              <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>
                  LEGEND · {isLive ? "LIVE" : mode.toUpperCase()}{cbMode && " · ◆ CB-SAFE"}
                </div>
                {legendEntries.map(([label, color, shape]) => (
                  <div key={label} className="flex items-center gap-2 py-0.5">
                    {cbMode ? (
                      /* CB-safe: colour square + shape char side-by-side */
                      <div className="flex items-center gap-1 flex-none" style={{ width: 22 }}>
                        <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                        <span style={{ fontSize: 10, fontWeight: 800, color, lineHeight: 1 }}>{shape}</span>
                      </div>
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-sm flex-none" style={{ background: color, border: "1px solid rgba(255,255,255,0.15)" }} />
                    )}
                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)" }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* ── Shift timeline scrubber ───────────────────────────────────── */}
              {!isLive && (
                <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>SHIFT TIMELINE</div>
                  <input type="range" min={360} max={1320} step={5}
                    value={scrubberMin ?? 360}
                    onChange={e => setScrubberMin(Number(e.target.value))}
                    className="w-full mb-1"
                    style={{ accentColor: "rgba(255,255,255,0.70)" }} />
                  <div className="flex justify-between items-center">
                    <span style={{ fontSize: 9.5, fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.38)" }}>06:00</span>
                    {scrubberMin !== null ? (
                      <button onClick={() => setScrubberMin(null)}
                        className="hover:text-white/80 transition-colors"
                        style={{ fontSize: 9.5, fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.55)" }}>
                        {String(Math.floor(scrubberMin / 60)).padStart(2, "0")}:{String(scrubberMin % 60).padStart(2, "0")} ✕
                      </button>
                    ) : (
                      <span style={{ fontSize: 9.5, fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.38)" }}>22:00</span>
                    )}
                  </div>
                  {scrubberMin !== null && (
                    <div style={{ fontSize: 9.5, color: "#fbbf24", marginTop: 4 }}>
                      {activeMoveBlocks.size} active block{activeMoveBlocks.size !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
                    drawerInvokerRef.current = document.activeElement as HTMLElement
                    setSelectedBlockLabel(label)
                    setDrawerMode("block")
                    setDrawerZone(null)
                    setSelectedSlot(null)
                    setDrawerOpen(true)
                    setDrawerHotFilter(false)   // normal click → show all containers
                  }}
                  zoneNames={zoneNames}
                  equipment={equipmentPositions}
                  showEquipment={showEquipment}
                  moveTrails={moveTrails}
                  showTrails={showTrails}
                  congestionByBlock={congestionByBlock}
                  showCongestion={showCongestion}
                  activeMoveBlocks={scrubberMin !== null ? activeMoveBlocks : undefined}
                  hotByBlock={hotByBlock}
                  onHotBadgeClick={handleHotBadgeClick}
                  highlightBlocks={
                    storyMode && SHIFT_STORY[storyStep]?.highlightMode === "hot"
                      ? new Set([...(hotByBlock?.keys() ?? [])].filter(k => (hotByBlock?.get(k) ?? 0) > 0))
                      : storyMode && SHIFT_STORY[storyStep]?.highlightMode === "detention"
                        ? detentionExposure.blockSet
                        : detentionHovered ? detentionExposure.blockSet : undefined
                  }
                  rehandleByBlock={rehandleByBlock}
                  commandedView={commandedView}
                  fitViewSeq={fitViewSeq}
                  cbMode={cbMode}
                  worstLfdByBlock={worstLfdByBlock}
                />
              </>
            )}

            {isLive && backendSlots.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <div style={{ maxWidth: 340, textAlign: "center", padding: "32px 28px", background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 30, marginBottom: 12, opacity: 0.22 }}>📡</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: YT.valueStrong, marginBottom: 6, letterSpacing: "-0.01em" }}>
                    No yard data yet
                  </div>
                  <div style={{ fontSize: 12.5, color: YT.labelMuted, lineHeight: 1.65 }}>
                    Backend is connected but returned no slot data. Check the planning engine, or switch to Seed mode to explore the demo yard.
                  </div>
                  <button onClick={() => setDataSource("seed")}
                    style={{ marginTop: 16, fontSize: 11, fontWeight: 700, color: "#374151", background: "white", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 16px", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                    Switch to Seed mode
                  </button>
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

            {/* ── Shift Story narration overlay — Phase 3.4 ────────────────────
                Dark-glass card anchored at map bottom-centre.
                Shows step title, narration text, step dots, and play controls.
                Pointer-events disabled on the wrapper; re-enabled on controls.
            ─────────────────────────────────────────────────────────────── */}
            {storyMode && view === "map" && (
              <div className="absolute left-1/2 pointer-events-none"
                style={{ bottom: 28, transform: "translateX(-50%)", zIndex: 30, width: 480 }}>
                <div style={{
                  background: "rgba(15,20,30,0.93)", backdropFilter: "blur(14px)",
                  border: "1px solid rgba(255,255,255,0.11)", borderRadius: 12, padding: "14px 18px 12px",
                }}>
                  {/* Header: label · time · step dots */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "rgba(255,255,255,0.40)" }}>SHIFT STORY</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>·</span>
                    <span style={{ fontSize: 9, fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.45)" }}>
                      {SHIFT_STORY[storyStep]?.time}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 5, pointerEvents: "auto" }}>
                      {SHIFT_STORY.map((_, i) => (
                        <button key={i} onClick={() => { setStoryStep(i); setStoryPlaying(false) }}
                          style={{ width: 7, height: 7, borderRadius: "50%", border: "none", cursor: "pointer", padding: 0,
                            background: i === storyStep ? "#f87171" : i < storyStep ? "rgba(255,255,255,0.50)" : "rgba(255,255,255,0.16)" }}/>
                      ))}
                    </div>
                  </div>
                  {/* Step title — aria-live announces step changes to screen readers */}
                  <div aria-live="polite" aria-atomic="true"
                    style={{ fontSize: 13.5, fontWeight: 800, color: "rgba(255,255,255,0.94)", marginBottom: 5, letterSpacing: "-0.01em" }}>
                    {SHIFT_STORY[storyStep]?.title}
                  </div>
                  {/* Narration */}
                  <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.60, marginBottom: 10 }}>
                    {SHIFT_STORY[storyStep]?.narration}
                  </div>
                  {/* Play controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, pointerEvents: "auto" }}>
                    <button onClick={() => { setStoryStep(s => Math.max(0, s - 1)); setStoryPlaying(false) }}
                      disabled={storyStep === 0}
                      style={{ fontSize: 14, color: storyStep === 0 ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.60)", background: "none", border: "none", cursor: storyStep === 0 ? "default" : "pointer", padding: "0 4px", lineHeight: 1 }}>
                      ◀
                    </button>
                    <button onClick={() => setStoryPlaying(v => !v)}
                      style={{ fontSize: 11, fontWeight: 700, color: storyPlaying ? "#fbbf24" : "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, cursor: "pointer", padding: "4px 13px" }}>
                      {storyPlaying ? "⏸ Pause" : "▶ Play"}
                    </button>
                    <button onClick={() => { setStoryStep(s => Math.min(SHIFT_STORY.length - 1, s + 1)); setStoryPlaying(false) }}
                      disabled={storyStep === SHIFT_STORY.length - 1}
                      style={{ fontSize: 14, color: storyStep === SHIFT_STORY.length - 1 ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.60)", background: "none", border: "none", cursor: storyStep === SHIFT_STORY.length - 1 ? "default" : "pointer", padding: "0 4px", lineHeight: 1 }}>
                      ▶
                    </button>
                    <button onClick={() => { setStoryMode(false); setStoryPlaying(false); setStoryStep(0) }}
                      style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.36)", background: "none", border: "none", cursor: "pointer" }}>
                      ✕ Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Zone R — pre-clearance panel (Phase 3.7 restyle) ─────────────
                Solid dark header band (#1e293b) = WCAG AA (white: 14.7:1).
                When Shift Story is active, rows highlight based on story step.
            ─────────────────────────────────────────────────────────────── */}
            {(() => {
              const storyCtrs = containers.filter(c => !!(c as any).story)
              if (!storyCtrs.length) return null
              return (
                <div style={{ position:"absolute", bottom:8, left:8, zIndex:20, maxWidth:420,
                  background:"white", border:"1px solid rgba(30,41,59,0.18)", borderRadius:10,
                  boxShadow:"0 4px 20px rgba(0,0,0,0.13)", overflow:"hidden" }}>

                  {/* Solid header band — YT.panelHeaderBg, WCAG AA: white 14.7:1 */}
                  <div style={{ padding:"7px 12px 7px 14px", display:"flex", alignItems:"center", gap:8, background: YT.panelHeaderBg }}>
                    <span style={{ fontSize:9, fontWeight:900, letterSpacing:"0.14em",
                      textTransform:"uppercase" as const, color:"#fff" }}>
                      Zone R — Pre-clearance
                    </span>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.50)", marginLeft:2 }}>
                      {storyCtrs.length} container{storyCtrs.length !== 1 ? "s" : ""}
                    </span>
                    {storyMode && (
                      <span style={{ marginLeft:"auto", fontSize:8.5, fontWeight:700, letterSpacing:"0.12em",
                        color: storyStep === 3 ? "#34d399" : storyStep >= 1 ? "#fbbf24" : "rgba(255,255,255,0.45)" }}>
                        {storyStep === 3 ? "✓ CLEARED" : storyStep >= 1 ? "⏱ HOT" : "● WAVE ARRIVED"}
                      </span>
                    )}
                  </div>

                  {/* Column headers */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 0.7fr", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                    {["Container","Slot","Status"].map(h => (
                      <div key={h} style={{ padding:"4px 10px", fontSize:9.5, fontWeight:700, color:"#64748b", letterSpacing:"0.07em", textTransform:"uppercase" as const }}>{h}</div>
                    ))}
                  </div>

                  <div style={{ overflow:"auto", maxHeight:192 }}>
                    {storyCtrs.map(c => {
                      // Story step highlighting
                      const isHot = (c as any).hoursToLFD !== undefined && (c as any).hoursToLFD <= 4
                      const rowFocus =
                        storyMode && storyStep === 0 ? "wave" :
                        storyMode && storyStep >= 1 && storyStep <= 2 && isHot ? "hot" :
                        storyMode && storyStep === 3 ? "cleared" : null
                      const rowBg   = rowFocus === "hot" ? "#fff7ed" : rowFocus === "cleared" ? "#f0fdf4" : rowFocus === "wave" ? "#f0f9ff" : undefined
                      const barColor= rowFocus === "hot" ? "#f59e0b" : rowFocus === "cleared" ? "#16a34a" : rowFocus === "wave" ? "#0ea5e9" : "transparent"

                      const lfdH: number | undefined = (c as any).hoursToLFD
                      const statusChip = storyMode && storyStep === 3
                        ? { bg:"#dcfce7", color:"#16a34a", label:"✓ Cleared" }
                        : isHot
                          ? { bg:"#fee2e2", color:"#dc2626", label:"⏱ Hot" }
                          : { bg:"#f1f5f9", color:"#64748b", label:c.status || "RECEIVED" }

                      return (
                        <div key={c.id}
                          onClick={() => setSel(c.id)}
                          className="cursor-pointer hover:bg-[#f0f9ff] transition-colors"
                          style={{ display:"grid", gridTemplateColumns:"1fr 1fr 0.7fr",
                            borderBottom:"1px solid #f1f5f9",
                            borderLeft:`3px solid ${barColor}`,
                            background:rowBg }}>
                          <div className="font-mono" style={{ padding:"5px 10px", fontWeight:700, fontSize:11, color:"#0f172a" }}>{c.id}</div>
                          <div className="font-mono" style={{ padding:"5px 10px", fontSize:11, color:"#0369a1" }}>{(c as any).address || "—"}</div>
                          <div style={{ padding:"5px 10px" }}>
                            <span style={{ fontSize:9, fontWeight:700, borderRadius:4, padding:"2px 6px",
                              background:statusChip.bg, color:statusChip.color }}>
                              {statusChip.label}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    {storyCtrs.length === 0 && (
                      <div style={{ padding:"16px 14px", fontSize:11, color:"#94a3b8" }}>No containers in pre-clearance</div>
                    )}
                  </div>
                </div>
              )
            })()}
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
            {/* Fixed-width inner — focus trap + dialog role for keyboard/AT users */}
            <div className="flex flex-col h-full min-h-0" style={{ width: 440 }}
              ref={drawerPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label={
                drawerMode === "slot"      ? "Container slot detail" :
                drawerMode === "block"     ? `Block ${selectedBlockLabel ?? ""}` :
                drawerMode === "zone"      ? "Zone detail" :
                                             "Detention worklist"
              }
              onKeyDown={e => {
                if (e.key !== "Tab") return
                const all = Array.from(
                  drawerPanelRef.current?.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], input, select, textarea, [tabindex="0"]'
                  ) ?? []
                )
                if (all.length < 2) return
                const first = all[0], last = all[all.length - 1]
                if (e.shiftKey) {
                  if (document.activeElement === first) { e.preventDefault(); last.focus() }
                } else {
                  if (document.activeElement === last)  { e.preventDefault(); first.focus() }
                }
              }}>
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
