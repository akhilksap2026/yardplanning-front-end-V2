export interface KpiCellData {
  k: string
  v: string
  sub: string
  red: boolean
}

interface KpiCellProps {
  m: KpiCellData
  onClick?: () => void
}

export default function KpiCell({ m, onClick }: KpiCellProps) {
  return (
    <div
      onClick={onClick}
      className={`flex-1 basis-36 px-5 py-2.5 border-r border-[var(--ds-border)] flex flex-col gap-1 transition-colors ${
        onClick ? "cursor-pointer hover:bg-[var(--ds-surface-hover)]" : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-1">
        <span className="ds-label">{m.k}</span>
        {onClick && <span className="text-[9px] text-[var(--ds-subtle)]">↗</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono font-semibold leading-none"
          style={{ fontSize: 24, color: m.red ? "var(--ds-red)" : undefined }}
        >
          {m.v}
        </span>
        <span className="text-[11px] text-[var(--ds-subtle)]">{m.sub}</span>
      </div>
    </div>
  )
}
