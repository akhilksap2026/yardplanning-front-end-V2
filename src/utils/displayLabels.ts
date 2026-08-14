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
