/**
 * CommandPalette — ⌘K search across containers, moves, visits, and events.
 *
 * Uses Radix Dialog for the modal shell and implements its own lightweight
 * list navigation so we avoid adding cmdk as a dependency.
 */
import { useState, useEffect, useRef, useMemo, KeyboardEvent } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useData } from "@/lib/DataContext"
import { TYPE_LABEL } from "@/data/yard-data"

// ── Types ─────────────────────────────────────────────────────────────────────

type ResultKind = "container" | "move" | "visit" | "event"

interface SearchResult {
  id: string
  kind: ResultKind
  label: string
  sub: string
  /** Screen to navigate to */
  screen: string
  /** Focus token passed to the screen */
  focus: string
}

interface Props {
  open: boolean
  onClose: () => void
  onNavigate: (screen: string, focus?: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const KIND_BADGE: Record<ResultKind, string> = {
  container: "Container",
  move: "Move",
  visit: "Visit",
  event: "Event",
}

// Status palette — keep raw hex here because values are used for alpha-suffix
// concatenation (`KIND_COLOR[r.kind] + "15"`), which doesn't work with var().
const KIND_COLOR: Record<ResultKind, string> = {
  container: "#2563eb",
  move: "#7c3aed",
  visit: "#059669",
  event: "#dc2626",
}

const SCREEN_LABEL: Record<string, string> = {
  plan: "Planner",
  yard: "Yard Map",
  gate: "Gate & Appointments",
  tower: "Control Tower",
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CommandPalette({ open, onClose, onNavigate }: Props) {
  const data = useData()
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Build search index lazily — memoised so it only runs when data changes
  const allResults = useMemo<SearchResult[]>(() => {
    const out: SearchResult[] = []

    for (const c of data.containers) {
      out.push({
        id: c.id,
        kind: "container",
        label: c.id,
        sub: `${c.address} · ${c.carrierName} · ${c.size} · ${c.status.replace("_", " ")}`,
        screen: "yard",
        focus: c.id,
      })
    }

    for (const m of data.moves) {
      out.push({
        id: m.id,
        kind: "move",
        label: m.id,
        sub: `${TYPE_LABEL[m.type] ?? m.type} · ${m.containerId} · ${m.from} → ${m.to} · ${m.operatorName}`,
        screen: "plan",
        focus: m.id,
      })
    }

    for (const v of data.visits) {
      out.push({
        id: v.id,
        kind: "visit",
        label: v.id,
        sub: `${v.plate} · ${v.driver} · ${v.purpose} · ${v.container}`,
        screen: "gate",
        focus: v.id,
      })
    }

    for (const e of data.events) {
      out.push({
        id: e.id,
        kind: "event",
        label: e.id,
        sub: e.title,
        screen: "tower",
        focus: e.id,
      })
    }

    return out
  }, [data.containers, data.moves, data.visits, data.events])

  // Filter by query
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return allResults.filter(r =>
      r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)
    ).slice(0, 40)
  }, [allResults, query])

  useEffect(() => {
    setActiveIdx(idx => Math.min(idx, Math.max(0, results.length - 1)))
  }, [results.length])

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIdx])

  function select(r: SearchResult) {
    onNavigate(r.screen, r.focus)
    onClose()
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (results[activeIdx]) select(results[activeIdx])
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={v => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/40"
          style={{ backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-[18%] -translate-x-1/2 w-full max-w-[600px] bg-white flex flex-col"
          style={{
            maxHeight: "60vh",
            borderRadius: 12,
            border: "1px solid var(--ds-border)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)",
          }}
          aria-label="Search command palette"
          onEscapeKeyDown={onClose}
        >
          {/* Input row */}
          <div className="flex items-center gap-2 px-4 py-3.5 flex-none" style={{ borderBottom: "1px solid var(--ds-border-lt)" }}>
            <span style={{ color: "var(--ds-subtle)", fontSize: 16, lineHeight: 1 }}>⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
              onKeyDown={handleKey}
              placeholder="Search container, plate, order, move, event…"
              className="flex-1 text-[13.5px] outline-none bg-transparent placeholder:text-[#c4c9d4]"
              style={{ color: "var(--ds-fg)" }}
            />
            {query && (
              <button
                onClick={() => { setQuery(""); inputRef.current?.focus() }}
                className="flex items-center justify-center"
                style={{ width: 20, height: 20, borderRadius: 5, background: "var(--ds-border-lt)", color: "var(--ds-subtle)", fontSize: 11 }}
              >
                ✕
              </button>
            )}
            <kbd
              className="text-[10px] text-[var(--ds-subtle)] font-mono select-none"
              style={{ border: "1px solid var(--ds-border)", borderRadius: 5, padding: "2px 6px", background: "var(--ds-surface-hover)" }}
            >
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-auto">
            {!query.trim() ? (
              <div className="px-5 py-10 text-center" style={{ fontSize: 12.5, color: "var(--ds-subtle)" }}>
                Type to search containers, moves, visits, or events
              </div>
            ) : results.length === 0 ? (
              <div className="px-5 py-10 text-center" style={{ fontSize: 12.5, color: "var(--ds-subtle)" }}>
                No results for <strong style={{ color: "var(--ds-muted)" }}>"{query}"</strong>
              </div>
            ) : (
              <ul ref={listRef} role="listbox" aria-label="Search results" className="py-1.5 px-1.5">
                {results.map((r, i) => (
                  <li
                    key={r.id + r.kind}
                    role="option"
                    aria-selected={i === activeIdx}
                    onClick={() => select(r)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className="flex items-center gap-2.5 px-3 cursor-pointer"
                    style={{
                      minHeight: 40,
                      borderRadius: 7,
                      background: i === activeIdx ? "var(--ds-accent-bg)" : "transparent",
                      paddingTop: 8,
                      paddingBottom: 8,
                    }}
                  >
                    {/* Kind badge — raw hex kept because values are alpha-suffixed */}
                    <span
                      className="flex-none text-[9px] font-bold tracking-wider uppercase"
                      style={{
                        color: KIND_COLOR[r.kind],
                        background: KIND_COLOR[r.kind] + "15",
                        border: `1px solid ${KIND_COLOR[r.kind]}25`,
                        paddingLeft: 7,
                        paddingRight: 7,
                        paddingTop: 2,
                        paddingBottom: 2,
                        borderRadius: 9999,
                      }}
                    >
                      {KIND_BADGE[r.kind]}
                    </span>

                    {/* Label + sub */}
                    <span className="flex-1 min-w-0">
                      <span className="font-bold text-[13px] font-mono" style={{ color: "var(--ds-fg)" }}>{r.label}</span>
                      <span className="ml-2 text-[11.5px] truncate" style={{ color: "var(--ds-subtle)" }}>{r.sub}</span>
                    </span>

                    {/* Destination screen */}
                    <span className="flex-none text-[10px] whitespace-nowrap" style={{ color: "#c4c9d4" }}>
                      → {SCREEN_LABEL[r.screen] ?? r.screen}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer hint */}
          {results.length > 0 && (
            <div
              className="flex items-center gap-4 px-4 py-2.5 flex-none"
              style={{ borderTop: "1px solid var(--ds-border-lt)", background: "var(--ds-surface-hover)", fontSize: 10.5, color: "var(--ds-subtle)", borderRadius: "0 0 12px 12px" }}
            >
              <span>
                <kbd className="font-mono border border-[var(--ds-border)] px-1 rounded" style={{ background: "#fff" }}>↑</kbd>{" "}
                <kbd className="font-mono border border-[var(--ds-border)] px-1 rounded" style={{ background: "#fff" }}>↓</kbd>{" "}
                navigate
              </span>
              <span><kbd className="font-mono border border-[var(--ds-border)] px-1 rounded" style={{ background: "#fff" }}>↵</kbd> open</span>
              <span><kbd className="font-mono border border-[var(--ds-border)] px-1 rounded" style={{ background: "#fff" }}>Esc</kbd> close</span>
              <span className="ml-auto font-mono">{results.length} result{results.length !== 1 ? "s" : ""}</span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
