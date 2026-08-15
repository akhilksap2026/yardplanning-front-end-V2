interface AccordionHeaderProps {
  label: string
  open: boolean
  onToggle: () => void
  count?: string
}

export default function AccordionHeader({ label, open, onToggle, count }: AccordionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-[var(--ds-surface-hover)] transition-colors"
      style={{ borderTop: "1px solid var(--ds-border)" }}
    >
      <div className="flex items-center gap-2">
        <span className="ds-label font-bold text-[var(--ds-muted)]">{label}</span>
        {count && <span className="text-[10px] text-[var(--ds-subtle)]">{count}</span>}
      </div>
      <span style={{ fontSize: 9, color: "var(--ds-subtle)" }}>{open ? "▲" : "▼"}</span>
    </button>
  )
}
