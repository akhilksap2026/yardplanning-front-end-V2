import { cn } from "@/lib/utils"

export interface TabBarItem {
  id: string
  label: string
  /** Optional numeric badge shown after the label */
  count?: number
}

interface TabBarProps {
  items: TabBarItem[]
  active: string
  onChange: (id: string) => void
  /**
   * "default"  — full-width bar, dark-fill active tab, sits on white.
   * "compact"  — narrower text/padding, white-fill active tab on surface-hover bg.
   *              Use for sub-tabs nested inside a content area.
   */
  variant?: "default" | "compact"
  className?: string
}

/**
 * Canonical tab-bar / segmented-navigation component for YardOS.
 *
 * Active state  (default):  dark bg  + white text  + 2px bottom border
 * Active state  (compact):  white bg + fg text     + 2px bottom border
 * Inactive state both:      transparent bg, secondary/muted text, invisible 2px border
 */
export default function TabBar({
  items,
  active,
  onChange,
  variant = "default",
  className,
}: TabBarProps) {
  const isCompact = variant === "compact"

  return (
    <div
      className={cn(
        "flex flex-none border-b border-[var(--ds-border)] overflow-x-auto",
        isCompact ? "bg-[var(--ds-surface-hover)]" : "bg-white",
        className
      )}
    >
      {items.map(item => {
        const isActive = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "whitespace-nowrap transition-colors flex-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)] focus-visible:ring-inset",
              isCompact
                ? "text-[11px] px-4 py-2 font-semibold"
                : "text-[11.5px] px-4 py-2.5 font-bold"
            )}
            style={{
              background: isActive
                ? isCompact ? "#fff" : "var(--ds-fg)"
                : "transparent",
              color: isActive
                ? isCompact ? "var(--ds-fg)" : "#fff"
                : isCompact ? "var(--ds-muted)" : "var(--ds-fg-secondary)",
              borderBottom: isActive
                ? "2px solid var(--ds-fg)"
                : "2px solid transparent",
            }}
          >
            {item.label}
            {item.count != null && (
              <span
                className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] px-1 rounded-full text-[9px] font-bold leading-[1.15rem] tabular-nums"
                style={{
                  background: isActive
                    ? isCompact ? "var(--ds-border)" : "rgba(255,255,255,0.22)"
                    : "var(--ds-border)",
                  color: isActive
                    ? isCompact ? "var(--ds-fg)" : "#fff"
                    : "var(--ds-muted)",
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
