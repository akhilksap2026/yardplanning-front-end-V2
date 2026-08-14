/**
 * Display-label utilities for YardOS planning data.
 *
 * All mappings live here so they can be changed in one place.
 * Import these functions into any component that renders planningData fields.
 *
 * Constraints:
 *  - Do NOT modify planningResults.json or planningData.ts types here.
 *  - Do NOT alter container IDs, operator names, timestamps, or coordinates.
 *  - These are display-only transformations.
 */

import type { PlanningStep } from "@/data/planningData"

// ── Operation labels ─────────────────────────────────────────────────────────

const OPERATION_DISPLAY: Record<string, string> = {
  "Premarshal ahead of retrieval":       "Pre-Marshal",
  "Digout to clear an overstow":         "Digout",
  "Outbound staging and truck loading":  "Outbound",
  "Discharge from vessel":               "Vessel Discharge",
  "Putaway":                             "Putaway",
}

export function getDisplayOperation(operation: string): string {
  return OPERATION_DISPLAY[operation] ?? operation
}

// Operations that represent extra (non-productive) movements
export function isExtraMovement(operation: string): boolean {
  return (
    operation === "Premarshal ahead of retrieval" ||
    operation === "Digout to clear an overstow"
  )
}

// ── Move method labels ───────────────────────────────────────────────────────

export function getDisplayMoveMethod(step: PlanningStep): string {
  const { move_method, operation, planned_step, step_number } = step

  if (!move_method) return "—"

  switch (move_method) {
    case "Yard-truck haul":
      return "Drive"

    case "Move to staging":
      return "Move to Staging"

    case "Inspection":
      // Final confirmation step within a Putaway → location confirmation
      return operation === "Putaway" ? "Confirm Location" : "Inspect Container"

    case "Crane lift": {
      // Within-sequence position: prefer planned_step, fall back to step_number
      const seqPos = planned_step ?? step_number ?? 1

      if (operation === "Putaway") {
        return "Stack Container"
      }
      if (operation === "Digout to clear an overstow") {
        return "Reaccommodate"
      }
      if (operation === "Premarshal ahead of retrieval") {
        // First crane lift in the premarshal sequence = pick the target container
        // Subsequent lifts = intermediate reshuffles to clear blocking containers
        return seqPos > 1 ? "Reshuffle" : "Pick from Stack"
      }
      // Discharge from vessel, Outbound staging — picking containers
      if (
        operation === "Discharge from vessel" ||
        operation === "Outbound staging and truck loading"
      ) {
        return "Pick from Stack"
      }
      return "Crane Move"
    }

    default:
      return move_method
  }
}

// ── Equipment type badge ─────────────────────────────────────────────────────

export type EquipmentType = { icon: string; label: string; bg: string; text: string }

export function getEquipmentType(step: PlanningStep): EquipmentType {
  switch (step.move_method) {
    case "Crane lift":
      return { icon: "🏗️", label: "Crane",      bg: "#eff6ff", text: "#1d4ed8" }
    case "Yard-truck haul":
      return { icon: "🚛", label: "Yard Truck", bg: "#fefce8", text: "#a16207" }
    case "Move to staging":
      return { icon: "🚛", label: "Yard Truck", bg: "#fefce8", text: "#a16207" }
    case "Inspection":
      return { icon: "👁️", label: "Manual",     bg: "#f3f4f6", text: "#374151" }
    default:
      return { icon: "⚙️", label: step.move_method ?? "—", bg: "#f3f4f6", text: "#374151" }
  }
}

// ── Status colors ────────────────────────────────────────────────────────────

export type StatusStyle = { bg: string; text: string; border: string }

export const STATUS_COLORS: Record<string, StatusStyle> = {
  Planned:   { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },   // blue
  Completed: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },   // green
  Blocked:   { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },   // amber
}

export function getStatusStyle(status: string | null | undefined): StatusStyle {
  return STATUS_COLORS[status ?? ""] ?? { bg: "#f3f4f6", text: "#6b7280", border: "#e5e7eb" }
}

// ── Container ID display ─────────────────────────────────────────────────────

/**
 * Returns the container_id if present, otherwise a contextual anonymous label
 * derived from the operation type. Never returns null or an empty string.
 */
export function getDisplayContainerId(step: PlanningStep): string {
  if (step.container_id) return step.container_id
  switch (step.operation) {
    case "Premarshal ahead of retrieval":
      return "Blocking unit"
    case "Digout to clear an overstow":
      return "Overstow unit"
    case "Discharge from vessel":
      return "Vessel unit"
    default:
      return "Untracked unit"
  }
}

/** True when the container ID was synthesised (no real ID in the data). */
export function isAnonymousContainer(step: PlanningStep): boolean {
  return step.container_id == null
}

// ── WHY callout generation ────────────────────────────────────────────────────

/**
 * Returns the operator_pickup text if present, otherwise generates a
 * contextual explanation from the available step fields. Always returns a
 * non-empty string — never falls back to a raw operation key.
 */
export function generateWhyText(step: PlanningStep): string {
  if (step.operator_pickup) return step.operator_pickup

  const method = getDisplayMoveMethod(step)
  const cid    = step.container_id ?? null

  const fmtBay = (bay: number | string | null | undefined): string => {
    if (bay == null) return "yard"
    if (bay === "GATE / OFF-YARD") return "the gate"
    return `Bay ${bay}`
  }
  const from = fmtBay(step.origin?.bay)
  const to   = fmtBay(step.destination?.bay)

  switch (step.operation) {
    case "Premarshal ahead of retrieval":
      return cid
        ? `${method} ${cid} from ${from} to ${to} to open retrieval path for target container`
        : `${method} blocking unit from ${from} to ${to} — intermediate reshuffle to clear access`
    case "Digout to clear an overstow":
      return cid
        ? `${method} ${cid} from ${from} to ${to} to clear overstow blocking the outbound container`
        : `${method} overstow unit from ${from} to ${to} — must be cleared before target can be retrieved`
    case "Outbound staging and truck loading":
      return cid
        ? `${method} ${cid} from ${from} to ${to} — staged for outbound truck loading`
        : `${method} unit from ${from} to ${to} for outbound truck loading`
    case "Discharge from vessel":
      return cid
        ? `Discharge ${cid} from vessel and deliver to ${to}`
        : `Discharge vessel unit — container ID not yet assigned; deliver to ${to}`
    case "Putaway":
      return cid
        ? `Put away ${cid} from ${from} to assigned storage slot at ${to}`
        : `Put away inbound unit from ${from} to assigned slot at ${to}`
    default:
      return `${getDisplayOperation(step.operation)} — ${method} from ${from} to ${to}`
  }
}
