import { TYPE_LABEL } from "@/data/yard-data"

// ── Route rendering helpers ────────────────────────────────────────────────────
function LocSpan({ loc }: { loc: string }) {
  if (loc === "GATE") {
    return (
      <span className="ds-gate-pill">GATE</span>
    )
  }
  const parts = loc.split(" · ")
  if (parts.length === 1) return <span>{loc}</span>
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="ds-route-sep">·</span>}
          {p}
        </span>
      ))}
    </>
  )
}
import type { Move } from "@/data/yard-data"
import type { PlanningStep } from "@/data/planningData"
import { adaptMoveForDisplay } from "@/lib/backend-adapters"
import {
  getDisplayOperation, getDisplayMoveMethod, getEquipmentType,
  isExtraMovement, getStatusStyle, getDisplayContainerId, isAnonymousContainer,
} from "@/utils/displayLabels"
import { fmtTime, fmtLoc, stepDur } from "@/utils/plannerHelpers"
import type { Col } from "@/utils/plannerHelpers"

export type MoveRowData =
  | { source: "seed";     move: Move }
  | { source: "engine";   move: ReturnType<typeof adaptMoveForDisplay> }
  | { source: "planning"; move: PlanningStep }

interface MoveRowProps {
  m: MoveRowData
  isSelected: boolean
  onClick: () => void
  visibleCols: Set<Col>
  hotContainerIds: Set<string>
}

export default function MoveRow({ m, isSelected, onClick, visibleCols, hotContainerIds }: MoveRowProps) {
  const typeDisplay  = m.source === "planning" ? getDisplayOperation(m.move.operation)
    : m.source === "seed" ? (TYPE_LABEL[m.move.type] ?? m.move.type) : m.move.typeLabel
  const stateDisplay = m.source === "planning" ? m.move.step_status
    : m.source === "seed" ? (m.move.state ?? "") : m.move.stateLabel
  const isCompleted  = m.source === "planning" ? m.move.step_status === "Completed"
    : m.source === "seed"
      ? (m.move.state === "done" || m.move.state === "complete" || m.move.state === "completed")
      : (m.move.status === "done" || m.move.status === "cancelled")
  const frozen       = m.source === "planning" ? m.move.step_status === "Blocked" : m.move.frozen
  const windowStr    = m.source === "planning"
    ? (m.move.estimated_start
        ? fmtTime(m.move.estimated_start) + "–" + fmtTime(m.move.estimated_end)
        : m.move.step_status === "Completed" ? "✓ done" : "not scheduled")
    : m.source === "seed" ? `${m.move.start}–${m.move.end}` : `seq ${m.move.sequence_number}`
  const containerId  = m.source === "planning" ? m.move.container_id : m.move.containerId
  const seqNum       = m.source === "planning" ? (m.move.planned_step ?? m.move.step_number ?? 0) : m.move.seq
  const fromStr      = m.source === "planning" ? fmtLoc(m.move.origin) : m.move.from
  const toStr        = m.source === "planning" ? fmtLoc(m.move.destination) : m.move.to
  const operatorName = m.source === "planning" ? (m.move.operator ?? "—") : m.move.operatorName
  const equipLabel   = m.source === "planning" ? getDisplayMoveMethod(m.move) : m.move.equipment
  const estMin       = m.source === "planning" ? stepDur(m.move) : m.move.estMin
  const isHot        = m.source !== "planning" && hotContainerIds.has(containerId ?? "")
  const isExtra      = m.source === "planning" && isExtraMovement(m.move.operation)
  const equipBadge   = m.source === "planning" ? getEquipmentType(m.move) : null
  const statusStyle  = m.source === "planning" ? getStatusStyle(m.move.step_status) : null

  return (
    <tr
      onClick={onClick}
      className="cursor-pointer hover:bg-[var(--ds-surface-hover)] transition-colors"
      style={{
        background: isSelected ? "#fef3f2" : isHot ? "#fff8f5" : isCompleted ? "#fafafa" : isExtra ? "#fffbeb" : undefined,
        borderBottom: "1px solid var(--ds-border-lt)",
        minHeight: 44,
      }}
    >
      {visibleCols.has("SEQ") && (
        <td
          className="py-2.5 pl-4 pr-2.5 font-mono text-[var(--ds-subtle)]"
          style={{
            fontSize: 11,
            borderLeft: `3px solid ${
              isSelected ? "var(--ds-red)"
              : isHot    ? "#f97316"
              : frozen   ? "var(--ds-subtle)"
              : isExtra  ? "#fbbf24"
              : "transparent"
            }`,
          }}
        >
          {String(seqNum).padStart(3, "0")}
        </td>
      )}
      {visibleCols.has("WINDOW") && (
        <td className="px-3 py-2.5 font-mono whitespace-nowrap" style={{ fontSize: 11 }}>
          {windowStr}
        </td>
      )}
      {visibleCols.has("MOVE") && (
        <td className="px-3 py-2.5" style={{ fontSize: 11 }}>
          <div className="font-bold">{typeDisplay}</div>
          <div
            className="text-[10px] font-mono"
            style={{
              color: m.source === "planning" && isAnonymousContainer(m.move) ? "#d1d5db" : "var(--ds-subtle)",
              fontStyle: m.source === "planning" && isAnonymousContainer(m.move) ? "italic" : undefined,
            }}
          >
            {isHot && <span title="Hot container" className="mr-1">🔥</span>}
            {m.source === "planning" ? getDisplayContainerId(m.move) : containerId}
          </div>
        </td>
      )}
      {visibleCols.has("ROUTE") && (
        <td className="px-3 py-2.5 font-mono whitespace-nowrap" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <LocSpan loc={fromStr} />
            <span className="ds-route-arrow">→</span>
            <LocSpan loc={toStr} />
          </span>
        </td>
      )}
      {visibleCols.has("ASSIGNED") && (
        <td className="px-3 py-2.5 whitespace-nowrap" style={{ fontSize: 11 }}>
          <div>{operatorName}</div>
          {equipBadge && statusStyle ? (
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <span className="ds-badge" style={{ background: equipBadge.bg, color: equipBadge.text }}>
                {equipBadge.icon} {equipBadge.label}
              </span>
              <span className="ds-badge" style={{ background: statusStyle.bg, color: statusStyle.text }}>
                {stateDisplay}
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-[var(--ds-subtle)]">
              {equipLabel} · {stateDisplay.toLowerCase()}
            </div>
          )}
        </td>
      )}
      {visibleCols.has("EST") && (
        <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ fontSize: 11 }}>
          {estMin.toFixed(1)}′
        </td>
      )}
    </tr>
  )
}
