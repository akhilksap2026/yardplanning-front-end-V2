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

type Screen  = "plan" | "yard" | "gate" | "tower" | "operator" | "settings"
type Persona = "manager" | "ops" | "operator"

const PERSONAS: { id: Persona; name: string; sub: string; screens: Screen[] | "*" }[] = [
  { id: "manager",  name: "Manager",  sub: "Yard Manager · full authority", screens: "*" },
  { id: "ops",      name: "Ops",      sub: "Gate & yard front line",        screens: ["yard", "gate"] },
  { id: "operator", name: "Operator", sub: "Tablet · device-bound",         screens: ["operator"] },
]

const NAV_ITEMS: { id: Screen; group: string; name: string; crumb: string; alert?: boolean }[] = [
  { id: "tower",    group: "Today's Operations", name: "Control Tower",       crumb: "Control Tower",       alert: true },
  { id: "plan",     group: "Today's Operations", name: "Night-before Plan",   crumb: "Night-before Plan"   },
  { id: "yard",     group: "Yard",               name: "Yard Map",            crumb: "Yard Map"            },
  { id: "gate",     group: "Movement",           name: "Gate & Appointments", crumb: "Gate & Appointments", alert: true },
  { id: "operator", group: "Movement",           name: "Operator Tablet",     crumb: "Operator Tablet"     },
  { id: "settings", group: "Configuration",      name: "Settings",            crumb: "Settings"            },
]
const NAV_GROUPS = [...new Set(NAV_ITEMS.map(i => i.group))]

const STORY = [
  { screen: "plan"     as Screen, step: "Step 1 of 5", title: "Night-before plan — 96 moves, ranked",   persona: "Yard Manager · Martín R." },
  { screen: "yard"     as Screen, step: "Step 2 of 5", title: "Yard state at shift start",               persona: "Yard Manager · Martín R." },
  { screen: "gate"     as Screen, step: "Step 3 of 5", title: "Morning arrivals against the plan",       persona: "Gate & Yard Ops · Diego V." },
  { screen: "tower"    as Screen, step: "Step 4 of 5", title: "RS-03 fault — 14 moves replanned",        persona: "Yard Manager · Martín R." },
  { screen: "operator" as Screen, step: "Step 5 of 5", title: "MV-1028 in the cab — OCR mismatch",       persona: "Operator · R. Giménez" },
]

const ALL_SLICES: RefreshSlice[] = [
  "moves", "containers", "events", "visits", "lanes", "appointments", "diffRows", "operatorTasks",
]

// Nav icons (simple SVG-as-emoji stand-ins, replaced with clean Unicode symbols)
const NAV_ICONS: Record<Screen, string> = {
  tower:    "⬡",
  plan:     "◈",
  yard:     "▦",
  gate:     "⊞",
  operator: "⊟",
  settings: "⊙",
}

function allowed(persona: Persona, screen: Screen): boolean {
  if (screen === "settings") return persona === "manager"
  const p = PERSONAS.find(x => x.id === persona)!
  return p.screens === "*" || (p.screens as Screen[]).includes(screen)
}

// ── Inner shell ───────────────────────────────────────────────────────────────
function AppShell() {
  const { moves, events, visits, refresh, backendConnected, dbLoading, reconnectBackend } = useData()

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

  const activeGroup = NAV_ITEMS.find(i => i.id === screen)?.group ?? ""
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([activeGroup]))
  const [storyExpanded, setStoryExpanded] = useState(false)

  useEffect(() => { localStorage.setItem("yardos:showDemo", String(showDemo)) }, [showDemo])

  useEffect(() => {
    const group = NAV_ITEMS.find(i => i.id === screen)?.group
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
    tower: events.filter(e => e.state === "awaiting").length || events.length,
    plan:  moves.length,
    gate:  visits.filter(v => ["IN_QUEUE", "APPROACHING", "EXPECTED"].includes(v.state)).length,
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
      S1: "yard", S2: "gate", S4: "plan", S6: "operator", S7: "tower", SET: "settings",
    }
    const s = (map[target] || target) as Screen
    if (!allowed(persona, s)) { setPersona("manager"); setScreen(s); setFocus(f || null); return }
    setScreen(s); setFocus(f || null)
  }

  function switchPersona(id: Persona) {
    const p2 = PERSONAS.find(x => x.id === id)!
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

  const story = STORY[storyIdx]
  const p     = PERSONAS.find(x => x.id === persona)!
  const ok    = allowed(persona, screen)
  const crumb = NAV_ITEMS.find(i => i.id === screen)?.crumb ?? ""

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
            background: "#ffffff",
            borderRight: "1px solid #e5e7eb",
            boxShadow: "1px 0 0 0 #f3f4f6",
          }}
        >
          {/* Logo */}
          <div
            className="flex items-center gap-2.5 px-4 py-3.5 flex-none"
            style={{ borderBottom: "1px solid #f3f4f6" }}
          >
            <div
              className="flex-none flex items-center justify-center text-white font-black text-[11px] tracking-tight"
              style={{ width: 32, height: 32, background: "#4f46e5", borderRadius: 8 }}
            >YO</div>
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="font-bold text-[13px] tracking-tight" style={{ color: "#111827" }}>YardOS</span>
              <span className="ds-label">Operations Console</span>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2.5 flex-none">
            <button
              onClick={() => setPaletteOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
              style={{
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 7,
                fontSize: 11,
                color: "#9ca3af",
              }}
            >
              <span style={{ opacity: 0.7, fontSize: 13 }}>⌕</span>
              <span>Search container, plate…</span>
              <span className="ml-auto font-mono" style={{ fontSize: 10, color: "#c4c9d4", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>⌘K</span>
            </button>
          </div>

          {/* ── Nav groups ── */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {NAV_GROUPS.map(group => {
              const isExpanded = expandedGroups.has(group)
              const items      = NAV_ITEMS.filter(item => item.group === group)

              return (
                <div key={group} className="mt-3">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group)}
                    className="w-full flex items-center gap-1 px-2 py-1 text-left rounded"
                    style={{ color: "#9ca3af" }}
                  >
                    <span className="ds-label flex-1" style={{ color: "inherit", letterSpacing: "0.08em" }}>{group}</span>
                    <span style={{ fontSize: 8, opacity: 0.5 }}>{isExpanded ? "▲" : "▼"}</span>
                  </button>

                  {/* Items */}
                  {isExpanded && items.map(item => {
                    const isAllowed = allowed(persona, item.id)
                    const isActive  = screen === item.id
                    const badge     = BADGE_COUNT[item.id]
                    return (
                      <button
                        key={item.id}
                        onClick={() => { if (isAllowed) setScreen(item.id) }}
                        title={!isAllowed ? `${p.name} cannot access ${item.name}` : undefined}
                        className="w-full flex items-center gap-2.5 px-3 py-[7px] mt-0.5 text-left"
                        style={{
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? "#4f46e5" : isAllowed ? "#4b5563" : "#c4c9d4",
                          background: isActive ? "#eef2ff" : "transparent",
                          borderRadius: 7,
                          opacity: isAllowed ? 1 : 0.45,
                          cursor: isAllowed ? "pointer" : "not-allowed",
                          borderLeft: `2px solid ${isActive ? "#4f46e5" : "transparent"}`,
                          paddingLeft: isActive ? 10 : 12,
                        }}
                        onMouseEnter={e => { if (!isActive && isAllowed) (e.currentTarget as HTMLElement).style.background = "#f8fafc" }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isActive ? "#eef2ff" : "transparent" }}
                      >
                        <span
                          className="flex-none text-[11px] select-none"
                          style={{ color: isActive ? "#4f46e5" : "#9ca3af", lineHeight: 1 }}
                        >
                          {NAV_ICONS[item.id]}
                        </span>
                        <span className="flex-1 truncate">{item.name}</span>
                        {badge != null && badge > 0 && (
                          <span
                            className="flex-none flex items-center justify-center font-semibold"
                            style={{
                              minWidth: 18, height: 18, borderRadius: 9, fontSize: 10,
                              background: item.alert ? "#4f46e5" : "#e5e7eb",
                              color: item.alert ? "#fff" : "#6b7280",
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
            style={{ borderTop: "1px solid #f3f4f6" }}
          >
            <div
              className="flex-none flex items-center justify-center text-white font-black text-[11px]"
              style={{ width: 32, height: 32, background: "#4f46e5", borderRadius: 8 }}
            >{p.name[0]}</div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[12px] font-semibold truncate" style={{ color: "#111827" }}>{p.name}</span>
              <span className="text-[10px] truncate" style={{ color: "#9ca3af" }}>{p.sub}</span>
            </div>
          </div>
        </div>

        {/* ── Topbar ───────────────────────────────────────────────────────── */}
        <div
          className="col-start-2 flex items-center gap-3 px-5 bg-white"
          style={{ borderBottom: "1px solid #e5e7eb", height: 52, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
        >
          {/* Breadcrumb */}
          <div className="flex items-baseline gap-1.5" style={{ fontSize: 12 }}>
            <span style={{ color: "#9ca3af" }}>Operations</span>
            <span style={{ color: "#d1d5db" }}>/</span>
            <span className="font-semibold" style={{ color: "#111827", fontSize: 13 }}>{crumb}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* DB loading indicator */}
            {dbLoading && (
              <span
                className="flex items-center gap-1.5 px-2.5 py-1"
                style={{ fontSize: 11, color: "#d97706", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 6 }}
              >
                <span className="animate-spin text-[10px]">↻</span> Syncing…
              </span>
            )}

            {/* Live sync dot */}
            <div className="relative group">
              <span className="flex items-center gap-1.5 select-none" style={{ fontSize: 11, color: "#6b7280", cursor: "default" }}>
                <span
                  className="flex-none rounded-full"
                  style={{
                    width: 7, height: 7,
                    background: refreshing ? "#d97706" : "#22c55e",
                    boxShadow: refreshing ? "none" : "0 0 0 3px rgba(34,197,94,0.18)",
                  }}
                />
                Live
              </span>
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "#1e293b", color: "#e2e8f0", fontSize: 10.5, padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 50 }}
              >
                Last sync: {syncLabel}
              </div>
            </div>

            {/* Reconnect — shown only when backend offline */}
            {!backendConnected && (
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="px-3 py-1.5 font-semibold disabled:opacity-50"
                style={{ fontSize: 11, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 6 }}
              >
                {reconnecting ? "↻ Connecting…" : "↻ Reconnect"}
              </button>
            )}

            {/* ── Persona dropdown ── */}
            <div ref={personaRef} className="relative">
              <button
                onClick={() => setPersonaOpen(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 font-semibold"
                style={{ fontSize: 11, background: "#f8fafc", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6 }}
              >
                <span
                  className="flex-none flex items-center justify-center text-white font-black"
                  style={{ width: 18, height: 18, background: "#4f46e5", borderRadius: 5, fontSize: 10 }}
                >{p.name[0]}</span>
                {p.name}
                <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 1 }}>{personaOpen ? "▲" : "▼"}</span>
              </button>

              {personaOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 z-50"
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    overflow: "hidden",
                    minWidth: 200,
                    boxShadow: "0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04)",
                  }}
                >
                  {PERSONAS.map(px => (
                    <button
                      key={px.id}
                      onClick={() => { switchPersona(px.id); setPersonaOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                      style={{
                        fontSize: 11,
                        color: persona === px.id ? "#4f46e5" : "#374151",
                        fontWeight: persona === px.id ? 600 : 400,
                        background: persona === px.id ? "#eef2ff" : "transparent",
                        borderLeft: `2px solid ${persona === px.id ? "#4f46e5" : "transparent"}`,
                      }}
                      onMouseEnter={e => { if (persona !== px.id) (e.currentTarget as HTMLElement).style.background = "#f8fafc" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = persona === px.id ? "#eef2ff" : "transparent" }}
                    >
                      <span
                        className="flex-none flex items-center justify-center text-white font-black"
                        style={{ width: 20, height: 20, background: persona === px.id ? "#4f46e5" : "#e5e7eb", color: persona === px.id ? "#fff" : "#6b7280", borderRadius: 5, fontSize: 10 }}
                      >{px.name[0]}</span>
                      <div className="flex flex-col gap-0.5">
                        <span>{px.name}</span>
                        <span style={{ fontSize: 9.5, color: "#9ca3af", fontWeight: 400 }}>{px.sub}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 font-semibold disabled:opacity-50"
              style={{ fontSize: 11, background: "#f8fafc", border: "1px solid #e5e7eb", color: "#374151", borderRadius: 6 }}
            >
              {refreshing ? "↻ Syncing…" : "↻ Refresh"}
            </button>

            {/* Demo toggle */}
            <button
              onClick={() => setShowDemo(v => !v)}
              title="Toggle demo story bar"
              className="px-3 py-1.5 font-semibold"
              style={{
                fontSize: 11,
                background: showDemo ? "#4f46e5" : "#f8fafc",
                border: `1px solid ${showDemo ? "#4f46e5" : "#e5e7eb"}`,
                color: showDemo ? "#fff" : "#6b7280",
                borderRadius: 6,
              }}
            >
              🎬 Demo
            </button>

            {/* Bell */}
            <button
              aria-label="Notifications"
              className="flex items-center justify-center"
              style={{
                width: 32, height: 32,
                fontSize: 14, color: "#9ca3af",
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
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
                    style={{ fontSize: 10.5, padding: "1px 8px", border: "1px solid #d97706", background: "#fffbeb", color: "#b45309", borderRadius: 5 }}
                  >
                    tracking {focus} ✕
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
                {storyExpanded ? "← Back" : "←"}
              </button>
              <button
                onClick={() => goStory(1)}
                className="flex items-center gap-1 px-2.5 py-1 font-semibold"
                style={{ fontSize: 11, background: "#4f46e5", color: "#fff", border: "1px solid #4f46e5", borderRadius: 5 }}
              >
                {storyExpanded ? "Next step →" : "→"}
              </button>
            </div>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────────── */}
        <div
          className="col-start-2 row-start-3 min-w-0 min-h-0 overflow-hidden relative"
          style={{ background: "#f1f5f9" }}
        >
          {!ok ? (
            <div className="h-full flex items-start p-5">
              <div
                className="p-5"
                style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, maxWidth: 420, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
              >
                <div className="font-semibold text-[13px] mb-1" style={{ color: "#111827" }}>
                  {p.name} cannot access {crumb}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Switch persona in the top bar to continue.</div>
              </div>
            </div>
          ) : screen === "plan"     ? <NightPlanner  focus={focus} onNavigate={navigate} />
            : screen === "yard"     ? <YardMap        focus={focus} onNavigate={navigate} />
            : screen === "gate"     ? <GateConsole    focus={focus} />
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
