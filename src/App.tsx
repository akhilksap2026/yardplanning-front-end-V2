import { useState, useEffect, useRef } from "react"
import { DataProvider, useData } from "@/lib/DataContext"
import type { RefreshSlice } from "@/lib/DataContext"
import NightPlanner from "@/screens/NightPlanner"
import YardMap from "@/screens/YardMap"
import GateConsole from "@/screens/GateConsole"
import ControlTower from "@/screens/ControlTower"
import OperatorTablet from "@/screens/OperatorTablet"
import SettingsScreen from "@/screens/Settings"
import CommandPalette from "@/components/CommandPalette"
import LiveOps from "@/screens/LiveOps"
import { useLang } from "@/lib/i18n"

type Screen  = "plan" | "yard" | "gate" | "tower" | "operator" | "settings" | "liveops"
type Persona = "manager" | "ops" | "operator"

// Static persona / nav definitions — labels are translated at render time via t()
const PERSONA_DEFS: { id: Persona; nameKey: string; subKey: string; screens: Screen[] | "*" }[] = [
  { id: "manager",  nameKey: "persona.manager",  subKey: "persona.manager.sub", screens: "*" },
  { id: "ops",      nameKey: "persona.ops",      subKey: "persona.ops.sub",     screens: ["yard", "gate"] },
  { id: "operator", nameKey: "persona.operator", subKey: "persona.operator.sub",screens: ["operator"] },
]

// Keep legacy PERSONAS shape for compat helpers that use .name / .sub
const PERSONAS_STATIC = [
  { id: "manager"  as Persona, name: "Manager",  sub: "Yard Manager · full authority", screens: "*" as const },
  { id: "ops"      as Persona, name: "Ops",      sub: "Gate & yard front line",        screens: ["yard", "gate"] as Screen[] },
  { id: "operator" as Persona, name: "Operator", sub: "Tablet · device-bound",         screens: ["operator"] as Screen[] },
]

type NavGroupKey = "nav.group.todaysOps" | "nav.group.yard" | "nav.group.movement" | "nav.group.config"

const NAV_ITEMS: { id: Screen; groupKey: NavGroupKey; nameKey: string; alert?: boolean }[] = [
  { id: "liveops",  groupKey: "nav.group.todaysOps", nameKey: "nav.liveops",   alert: true },
  { id: "tower",    groupKey: "nav.group.todaysOps", nameKey: "nav.tower",     alert: true },
  { id: "plan",     groupKey: "nav.group.todaysOps", nameKey: "nav.plan"                  },
  { id: "yard",     groupKey: "nav.group.yard",      nameKey: "nav.yard"                  },
  { id: "gate",     groupKey: "nav.group.movement",  nameKey: "nav.gate",      alert: true },
  { id: "operator", groupKey: "nav.group.movement",  nameKey: "nav.operator"              },
  { id: "settings", groupKey: "nav.group.config",    nameKey: "nav.settings"              },
]
const NAV_GROUP_KEYS: NavGroupKey[] = [
  "nav.group.todaysOps", "nav.group.yard", "nav.group.movement", "nav.group.config",
]

const STORY = [
  // ── Act 1: The engine thinks at 9 PM ─────────────────────────────────────
  { screen: "plan"     as Screen, step: "Step 1 of 10",  title: "9 PM · engine reads yard state, detention deadlines and 6 available operators — builds tomorrow's plan",                                        persona: "Yard Manager · Martín R." },
  { screen: "plan"     as Screen, step: "Step 2 of 10",  title: "Engine asks 'what happens downstream?' — filter to Pre-Marshal to see 49 crane moves needed before target containers become reachable",         persona: "Yard Manager · Martín R." },
  { screen: "plan"     as Screen, step: "Step 3 of 10",  title: "Select any move — WHY callout explains the downstream reason; planning score shows how urgently the engine ranked this step",                   persona: "Yard Manager · Martín R." },
  // ── Act 2: The yard manager sets the strategy ─────────────────────────────
  { screen: "settings" as Screen, step: "Step 4 of 10",  title: "Priority model — raise detention weight and the engine shifts sequence; lower it and customer cutoffs take over; the strategy is yours to set", persona: "Yard Manager · Martín R." },
  // ── Act 3: The plan is handed to the shift ────────────────────────────────
  { screen: "plan"     as Screen, step: "Step 5 of 10",  title: "Show Gantt — 6 operators, 154 steps, no overlap, no idle gaps; the engine has already done the scheduling so the shift can just execute",      persona: "Yard Manager · Martín R." },
  { screen: "operator" as Screen, step: "Step 6 of 10",  title: "Jockey's view — scan TCLU0000006, confirm identity, pick from Bay 9 · R1 · T1, move to staging; no decisions, just execution",               persona: "Operator · R. Giménez"    },
  // ── Act 4: The yard in motion ─────────────────────────────────────────────
  { screen: "yard"     as Screen, step: "Step 7 of 10",  title: "Yard map at shift start — slot occupancy, stack depth and hot containers plotted by position; shows where the plan will create pressure",      persona: "Yard Manager · Martín R." },
  { screen: "gate"     as Screen, step: "Step 8 of 10",  title: "Morning arrivals — each inbound container matched to the plan on entry; mismatches and inspection holds surfaced before they reach the yard",   persona: "Gate Ops · Diego V."      },
  // ── Act 5: Reality changes — engine adapts ────────────────────────────────
  { screen: "tower"    as Screen, step: "Step 9 of 10",  title: "10:30 AM · disruption detected — 2 steps blocked, cascade risk across 3 operators identified in seconds; engine flags before the yard feels it", persona: "Yard Manager · Martín R." },
  { screen: "liveops"  as Screen, step: "Step 10 of 10", title: "Continuous cycle: Predict → Plan → Execute → Monitor → Replan — affected moves redistributed, operators see updated queues, yard keeps moving", persona: "Yard Manager · Martín R." },
]

const ALL_SLICES: RefreshSlice[] = [
  "moves", "containers", "events", "visits", "lanes", "appointments", "diffRows", "operatorTasks",
]

// Nav icons (simple SVG-as-emoji stand-ins, replaced with clean Unicode symbols)
const NAV_ICONS: Record<Screen, string> = {
  liveops:  "◉",
  tower:    "⬡",
  plan:     "◈",
  yard:     "▦",
  gate:     "⊞",
  operator: "⊟",
  settings: "⊙",
}

function allowed(persona: Persona, screen: Screen): boolean {
  if (screen === "settings") return persona === "manager"
  const p = PERSONAS_STATIC.find(x => x.id === persona)!
  return p.screens === "*" || (p.screens as Screen[]).includes(screen)
}

// ── Inner shell ───────────────────────────────────────────────────────────────
function AppShell() {
  const { moves, events, visits, refresh, backendConnected, dbLoading, reconnectBackend } = useData()
  const { t, lang, setLang } = useLang()

  const [persona,      setPersona]      = useState<Persona>("manager")
  const [screen,       setScreen]       = useState<Screen>("plan")
  const [focus,        setFocus]        = useState<string | null>(null)
  const [storyIdx,     setStoryIdx]     = useState(0)
  const [paletteOpen,  setPaletteOpen]  = useState(false)
  const [showDemo,     setShowDemo]     = useState(() => localStorage.getItem("yardos:showDemo") !== "false")
  const [refreshing,   setRefreshing]   = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [syncLabel,    setSyncLabel]    = useState("just now")
  const lastSyncRef = useRef(Date.now())

  const [personaOpen, setPersonaOpen] = useState(false)
  const personaRef = useRef<HTMLDivElement>(null)

  const activeGroup = NAV_ITEMS.find(i => i.id === screen)?.groupKey ?? ""
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([activeGroup]))
  const [storyExpanded, setStoryExpanded] = useState(false)

  useEffect(() => { localStorage.setItem("yardos:showDemo", String(showDemo)) }, [showDemo])

  useEffect(() => {
    const group = NAV_ITEMS.find(i => i.id === screen)?.groupKey
    if (group) setExpandedGroups(prev => new Set([...prev, group]))
  }, [screen])

  useEffect(() => {
    if (!personaOpen) return
    function handler(e: MouseEvent) {
      if (personaRef.current && !personaRef.current.contains(e.target as Node)) {
        setPersonaOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [personaOpen])

  const BADGE_COUNT: Partial<Record<Screen, number>> = {
    liveops: events.filter(e => e.severity === "high" || e.state === "awaiting").length,
    tower:   events.filter(e => e.state === "awaiting").length || events.length,
    plan:    moves.length,
    gate:    visits.filter(v => ["IN_QUEUE", "APPROACHING", "EXPECTED"].includes(v.state)).length,
  }

  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - lastSyncRef.current) / 1000)
      setSyncLabel(s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`)
    }, 10_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true); setSyncLabel("syncing…")
    try {
      await refresh(ALL_SLICES)
      lastSyncRef.current = Date.now()
      setSyncLabel("just now")
    } finally { setRefreshing(false) }
  }

  async function handleReconnect() {
    if (reconnecting) return
    setReconnecting(true)
    try { await reconnectBackend() } finally { setReconnecting(false) }
  }

  function goStory(delta: number) {
    const next = Math.max(0, Math.min(STORY.length - 1, storyIdx + delta))
    setStoryIdx(next)
    setScreen(STORY[next].screen)
  }

  function navigate(target: string, f?: string) {
    const map: Record<string, Screen> = {
      S1: "yard", S2: "gate", S4: "plan", S6: "operator", S7: "tower", S8: "liveops", SET: "settings",
    }
    const s = (map[target] || target) as Screen
    if (!allowed(persona, s)) { setPersona("manager"); setScreen(s); setFocus(f || null); return }
    setScreen(s); setFocus(f || null)
  }

  function switchPersona(id: Persona) {
    const p2 = PERSONAS_STATIC.find(x => x.id === id)!
    const first: Screen = p2.screens === "*"
      ? screen
      : (p2.screens as Screen[]).includes(screen) ? screen : (p2.screens as Screen[])[0]
    setPersona(id); setScreen(first)
  }

  function toggleGroup(group: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const story  = STORY[storyIdx]
  const pDef   = PERSONA_DEFS.find(x => x.id === persona)!
  const ok     = allowed(persona, screen)
  const navItem = NAV_ITEMS.find(i => i.id === screen)
  const crumb  = navItem ? t(navItem.nameKey) : ""
  // Translated persona name/sub for current persona
  const pName  = t(pDef.nameKey)
  const pSub   = t(pDef.subKey)

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(target, f) => { navigate(target, f); setPaletteOpen(false) }}
      />

      <div
        className="grid h-screen overflow-hidden"
        style={{
          gridTemplateColumns: "220px minmax(0,1fr)",
          gridTemplateRows: showDemo ? "52px 34px minmax(0,1fr)" : "52px 0px minmax(0,1fr)",
        }}
      >
        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <div
          className="flex flex-col overflow-y-auto overflow-x-hidden"
          style={{
            gridRow: "1 / -1",
            background: "var(--ds-surface)",
            borderRight: "1px solid var(--ds-border)",
            boxShadow: "1px 0 0 0 var(--ds-border-lt)",
          }}
        >
          {/* Logo */}
          <div
            className="flex items-center gap-2.5 px-4 py-3.5 flex-none"
            style={{ borderBottom: "1px solid var(--ds-border-lt)" }}
          >
            <div
              className="flex-none flex items-center justify-center text-white font-black text-[11px] tracking-tight"
              style={{ width: 32, height: 32, background: "var(--ds-accent)", borderRadius: 8 }}
            >YO</div>
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="font-bold text-[13px] tracking-tight text-[var(--ds-fg)]">{t("app.title")}</span>
              <span className="ds-label">{t("app.subtitle")}</span>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2.5 flex-none">
            <button
              onClick={() => setPaletteOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
              style={{
                background: "var(--ds-surface-hover)",
                border: "1px solid var(--ds-border)",
                borderRadius: 7,
                fontSize: 11,
                color: "var(--ds-subtle)",
              }}
            >
              <span style={{ opacity: 0.7, fontSize: 13 }}>⌕</span>
              <span>{t("app.search")}</span>
              <span className="ml-auto font-mono" style={{ fontSize: 10, color: "#c4c9d4", background: "var(--ds-border-lt)", border: "1px solid var(--ds-border)", borderRadius: 4, padding: "1px 5px" }}>⌘K</span>
            </button>
          </div>

          {/* ── Nav groups ── */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {NAV_GROUP_KEYS.map(groupKey => {
              const isExpanded = expandedGroups.has(groupKey)
              const items      = NAV_ITEMS.filter(item => item.groupKey === groupKey)
              const groupLabel = t(groupKey)

              return (
                <div key={groupKey} className="mt-3">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="w-full flex items-center gap-1 px-2 py-1 text-left rounded"
                    style={{ color: "var(--ds-subtle)" }}
                  >
                    <span className="ds-label flex-1" style={{ color: "inherit", letterSpacing: "0.08em" }}>{groupLabel}</span>
                    <span style={{ fontSize: 8, opacity: 0.5 }}>{isExpanded ? "▲" : "▼"}</span>
                  </button>

                  {/* Items */}
                  {isExpanded && items.map(item => {
                    const isAllowed = allowed(persona, item.id)
                    const isActive  = screen === item.id
                    const badge     = BADGE_COUNT[item.id]
                    const itemName  = t(item.nameKey)
                    return (
                      <button
                        key={item.id}
                        onClick={() => { if (isAllowed) setScreen(item.id) }}
                        title={!isAllowed ? t("app.noAccess", pName, itemName) : undefined}
                        className={`w-full flex items-center gap-2.5 px-3 py-[7px] mt-0.5 text-left ${
                          isActive
                            ? "bg-[var(--ds-accent-bg)]"
                            : isAllowed ? "hover:bg-[var(--ds-surface-hover)]" : ""
                        }`}
                        style={{
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? "var(--ds-accent)" : isAllowed ? "#4b5563" : "#c4c9d4",
                          borderRadius: 7,
                          opacity: isAllowed ? 1 : 0.45,
                          cursor: isAllowed ? "pointer" : "not-allowed",
                          borderLeft: `2px solid ${isActive ? "var(--ds-accent)" : "transparent"}`,
                          paddingLeft: isActive ? 10 : 12,
                        }}
                      >
                        <span
                          className="flex-none text-[11px] select-none"
                          style={{ color: isActive ? "var(--ds-accent)" : "var(--ds-subtle)", lineHeight: 1 }}
                        >
                          {NAV_ICONS[item.id]}
                        </span>
                        <span className="flex-1 truncate">{itemName}</span>
                        {badge != null && badge > 0 && (
                          <span
                            className="flex-none flex items-center justify-center font-semibold"
                            style={{
                              minWidth: 18, height: 18, borderRadius: 9, fontSize: 10,
                              background: item.alert ? "var(--ds-accent)" : "var(--ds-border)",
                              color: item.alert ? "#fff" : "var(--ds-muted)",
                              padding: "0 5px",
                            }}
                          >{badge}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* User row — pinned to bottom */}
          <div
            className="flex items-center gap-2.5 px-3 py-3 flex-none"
            style={{ borderTop: "1px solid var(--ds-border-lt)" }}
          >
            <div
              className="flex-none flex items-center justify-center text-white font-black text-[11px]"
              style={{ width: 32, height: 32, background: "var(--ds-accent)", borderRadius: 8 }}
            >{pName[0]}</div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[12px] font-semibold truncate" style={{ color: "var(--ds-fg)" }}>{pName}</span>
              <span className="text-[10px] truncate" style={{ color: "var(--ds-subtle)" }}>{pSub}</span>
            </div>
          </div>
        </div>

        {/* ── Topbar ───────────────────────────────────────────────────────── */}
        <div
          className="col-start-2 flex items-center gap-3 px-5 bg-white"
          style={{ borderBottom: "1px solid var(--ds-border)", height: 52, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
        >
          {/* Breadcrumb */}
          <div className="flex items-baseline gap-1.5" style={{ fontSize: 12 }}>
            <span style={{ color: "var(--ds-subtle)" }}>Operations</span>
            <span style={{ color: "#d1d5db" }}>/</span>
            <span className="font-semibold" style={{ color: "var(--ds-fg)", fontSize: 13 }}>{crumb}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* DB loading indicator */}
            {dbLoading && (
              <span
                className="flex items-center gap-1.5 px-2.5 py-1"
                style={{ fontSize: 11, color: "var(--ds-amber)", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 6 }}
              >
                <span className="animate-spin text-[10px]">↻</span> {t("app.syncing")}
              </span>
            )}

            {/* Live sync dot */}
            <div className="relative group">
              <span className="flex items-center gap-1.5 select-none" style={{ fontSize: 11, color: "var(--ds-muted)", cursor: "default" }}>
                <span
                  className="flex-none rounded-full"
                  style={{
                    width: 7, height: 7,
                    background: refreshing ? "var(--ds-amber)" : "#22c55e",
                    boxShadow: refreshing ? "none" : "0 0 0 3px rgba(34,197,94,0.18)",
                  }}
                />
                {t("app.live")}
              </span>
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "#1e293b", color: "#e2e8f0", fontSize: 10.5, padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 50 }}
              >
                {t("app.lastSync", syncLabel)}
              </div>
            </div>

            {/* Reconnect — shown only when backend offline */}
            {!backendConnected && (
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="px-3 py-1.5 font-semibold disabled:opacity-50"
                style={{ fontSize: 11, background: "#fef2f2", border: "1px solid #fecaca", color: "var(--ds-red)", borderRadius: 6 }}
              >
                {reconnecting ? t("app.connecting") : t("app.reconnect")}
              </button>
            )}

            {/* ── Persona dropdown ── */}
            <div ref={personaRef} className="relative">
              <button
                onClick={() => setPersonaOpen(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 font-semibold"
                style={{ fontSize: 11, background: "var(--ds-surface-hover)", color: "var(--ds-fg-secondary)", border: "1px solid var(--ds-border)", borderRadius: 6 }}
              >
                <span
                  className="flex-none flex items-center justify-center text-white font-black"
                  style={{ width: 18, height: 18, background: "var(--ds-accent)", borderRadius: 5, fontSize: 10 }}
                >{pName[0]}</span>
                {pName}
                <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 1 }}>{personaOpen ? "▲" : "▼"}</span>
              </button>

              {personaOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 z-50"
                  style={{
                    background: "var(--ds-surface)",
                    border: "1px solid var(--ds-border)",
                    borderRadius: 8,
                    overflow: "hidden",
                    minWidth: 200,
                    boxShadow: "0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04)",
                  }}
                >
                  {PERSONA_DEFS.map(px => {
                    const pxName = t(px.nameKey)
                    const pxSub  = t(px.subKey)
                    const isSelected = persona === px.id
                    return (
                      <button
                        key={px.id}
                        onClick={() => { switchPersona(px.id); setPersonaOpen(false) }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${
                          isSelected ? "bg-[var(--ds-accent-bg)]" : "hover:bg-[var(--ds-surface-hover)]"
                        }`}
                        style={{
                          fontSize: 11,
                          color: isSelected ? "var(--ds-accent)" : "var(--ds-fg-secondary)",
                          fontWeight: isSelected ? 600 : 400,
                          borderLeft: `2px solid ${isSelected ? "var(--ds-accent)" : "transparent"}`,
                        }}
                      >
                        <span
                          className="flex-none flex items-center justify-center text-white font-black"
                          style={{ width: 20, height: 20, background: isSelected ? "var(--ds-accent)" : "var(--ds-border)", color: isSelected ? "#fff" : "var(--ds-muted)", borderRadius: 5, fontSize: 10 }}
                        >{pxName[0]}</span>
                        <div className="flex flex-col gap-0.5">
                          <span>{pxName}</span>
                          <span style={{ fontSize: 9.5, color: "var(--ds-subtle)", fontWeight: 400 }}>{pxSub}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Language toggle — compact pill */}
            <button
              onClick={() => void setLang(lang === "en" ? "es" : "en")}
              className="flex items-center gap-0.5 font-mono font-semibold"
              style={{ fontSize: 10.5, background: "var(--ds-surface-hover)", border: "1px solid var(--ds-border)", color: "var(--ds-fg-secondary)", borderRadius: 6, padding: "3px 10px", letterSpacing: "0.04em" }}
            >
              <span style={{ color: lang === "en" ? "var(--ds-accent)" : "var(--ds-subtle)" }}>EN</span>
              <span style={{ color: "#d1d5db", margin: "0 3px" }}>|</span>
              <span style={{ color: lang === "es" ? "var(--ds-accent)" : "var(--ds-subtle)" }}>ES</span>
            </button>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 font-semibold disabled:opacity-50"
              style={{ fontSize: 11, background: "var(--ds-surface-hover)", border: "1px solid var(--ds-border)", color: "var(--ds-fg-secondary)", borderRadius: 6 }}
            >
              {refreshing ? t("app.syncing_btn") : t("app.refresh")}
            </button>

            {/* Demo toggle */}
            <button
              onClick={() => setShowDemo(v => !v)}
              title={t("app.toggleDemo")}
              className="px-3 py-1.5 font-semibold"
              style={{
                fontSize: 11,
                background: showDemo ? "var(--ds-accent)" : "var(--ds-surface-hover)",
                border: `1px solid ${showDemo ? "var(--ds-accent)" : "var(--ds-border)"}`,
                color: showDemo ? "#fff" : "var(--ds-muted)",
                borderRadius: 6,
              }}
            >
              🎬 {t("app.demo")}
            </button>

            {/* Bell */}
            <button
              aria-label={t("app.notifications")}
              className="flex items-center justify-center"
              style={{
                width: 32, height: 32,
                fontSize: 14, color: "var(--ds-subtle)",
                background: "var(--ds-surface-hover)",
                border: "1px solid var(--ds-border)",
                borderRadius: 6,
              }}
            >
              🔔
            </button>
          </div>
        </div>

        {/* ── Story bar ────────────────────────────────────────────────────── */}
        {showDemo && (
          <div
            className="col-start-2 flex items-center gap-2.5 px-4"
            style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", height: 34, overflow: "hidden" }}
          >
            <button
              onClick={() => setStoryExpanded(v => !v)}
              className="flex items-center gap-1.5 flex-none"
              title={storyExpanded ? "Collapse story bar" : "Expand story bar"}
            >
              <span
                className="font-semibold px-1.5 py-0.5 ds-label"
                style={{ background: "#fde68a", color: "#78350f", letterSpacing: "0.06em", borderRadius: 4 }}
              >DEMO</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e" }}>{story.step}</span>
              <span style={{ fontSize: 8, color: "#a16207" }}>{storyExpanded ? "▲" : "▼"}</span>
            </button>

            {storyExpanded && (
              <>
                <span style={{ fontSize: 12, color: "#92400e" }}>
                  — <strong>{story.title}</strong>
                </span>
                <span style={{ fontSize: 11, color: "#a16207" }}>· {story.persona}</span>
                {focus && (
                  <button
                    onClick={() => setFocus(null)}
                    className="font-semibold"
                    style={{ fontSize: 10.5, padding: "1px 8px", border: "1px solid var(--ds-amber)", background: "#fffbeb", color: "#b45309", borderRadius: 5 }}
                  >
                    {t("app.tracking", focus)} ✕
                  </button>
                )}
              </>
            )}

            <div className="ml-auto flex gap-1.5 flex-none">
              <button
                onClick={() => goStory(-1)}
                className="flex items-center gap-1 px-2.5 py-1 font-medium"
                style={{ fontSize: 11, border: "1px solid #fde68a", background: "white", color: "#92400e", borderRadius: 5 }}
              >
                {storyExpanded ? t("app.back") : "←"}
              </button>
              <button
                onClick={() => goStory(1)}
                className="flex items-center gap-1 px-2.5 py-1 font-semibold"
                style={{ fontSize: 11, background: "var(--ds-accent)", color: "#fff", border: "1px solid var(--ds-accent)", borderRadius: 5 }}
              >
                {storyExpanded ? t("app.next") : "→"}
              </button>
            </div>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────────── */}
        <div
          className="col-start-2 row-start-3 min-w-0 min-h-0 overflow-hidden relative"
          style={{ background: "var(--ds-background)" }}
        >
          {!ok ? (
            <div className="h-full flex items-start p-5">
              <div
                className="p-5"
                style={{ background: "var(--ds-surface)", border: "1px solid var(--ds-border)", borderRadius: 8, maxWidth: 420, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
              >
                <div className="font-semibold text-[13px] mb-1" style={{ color: "var(--ds-fg)" }}>
                  {t("app.noAccess", pName, crumb)}
                </div>
                <div style={{ fontSize: 12, color: "var(--ds-muted)" }}>{t("app.switchPersona")}</div>
              </div>
            </div>
          ) : screen === "liveops"  ? <LiveOps       onNavigate={navigate} />
            : screen === "plan"     ? <NightPlanner  focus={focus} onNavigate={navigate} />
            : screen === "yard"     ? <YardMap        focus={focus} onNavigate={navigate} />
            : screen === "gate"     ? <GateConsole    focus={focus} onNavigate={navigate} />
            : screen === "tower"    ? <ControlTower   focus={focus} />
            : screen === "operator" ? <OperatorTablet />
            : screen === "settings" ? <SettingsScreen />
            : null}
        </div>
      </div>
    </>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <DataProvider>
      <AppShell />
    </DataProvider>
  )
}
