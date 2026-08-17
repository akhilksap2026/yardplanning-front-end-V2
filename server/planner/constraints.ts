/**
 * server/planner/constraints.ts — Hard-constraint checkers for the greedy solver.
 *
 * Hard constraints return a string (violation reason) or null (OK).
 * The greedy loop skips any jockey/slot pair that has a non-null violation.
 */
import type { SolverJockey, SolverContainer, SolverSlot } from './types.js'

/**
 * Can this jockey handle a hazmat container?
 * Requires IMDG in certs.
 */
export function hazmMatCertOk(jockey: SolverJockey, container: SolverContainer): string | null {
  if (!container.hazmat) return null
  if (jockey.certs.includes('IMDG')) return null
  return `jockey ${jockey.id} lacks IMDG cert for hazmat container ${container.id}`
}

/**
 * Can this jockey operate in this zone?
 * Terminal tractors (TT) can only reach tier 1 (flat-rack / ground level).
 * Reach stackers can reach tier 1-4. Empty handlers tier 1-4 (light loads only).
 */
export function equipmentCanStack(jockey: SolverJockey, targetTier: number): string | null {
  const t = (jockey.equipment_type ?? '').toLowerCase()
  if (t.includes('terminal tractor') && targetTier > 1) {
    return `terminal tractor ${jockey.equipment_id} cannot stack to tier ${targetTier}`
  }
  return null
}

/**
 * Is the target slot eligible for this container's hazmat status?
 */
export function hazmatSlotOk(container: SolverContainer, slot: SolverSlot): string | null {
  if (container.hazmat && !slot.is_hazmat_approved) {
    return `slot ${slot.address} is not hazmat-approved`
  }
  return null
}

/**
 * Is this slot currently free?
 */
export function slotFree(slot: SolverSlot): string | null {
  if (slot.is_occupied) {
    return `slot ${slot.address} is occupied by ${slot.occupied_by}`
  }
  return null
}

/**
 * Is the jockey available (on shift, not on break, status OK)?
 * Terminal tractors (max_row_depth=0) cannot perform block stacking operations.
 */
export function jockeyAvailable(jockey: SolverJockey): string | null {
  const s = jockey.status.toLowerCase().replace(/ /g, '_')
  if (s === 'off_shift' || s === 'off shift') {
    return `jockey ${jockey.id} is off shift`
  }
  if (s === 'on_break') {
    return `jockey ${jockey.id} is on break`
  }
  return null
}

/**
 * Can this jockey's equipment reach the target row depth?
 * max_row_depth=0 → terminal tractor, cannot enter block rows (only flat/staging operations).
 * max_row_depth=N → can access rows 1..N within a block.
 */
export function equipmentDepthOk(jockey: SolverJockey, targetRow: number): string | null {
  if (jockey.max_row_depth === 0) {
    return `terminal tractor ${jockey.equipment_id} cannot perform block row operations`
  }
  if (targetRow > jockey.max_row_depth) {
    return `equipment ${jockey.equipment_id} max_row_depth=${jockey.max_row_depth} cannot reach row ${targetRow}`
  }
  return null
}

/**
 * Aggregate all hard constraints for a candidate (jockey, container, target slot) triple.
 * Returns null if all constraints pass, or the first violation reason.
 * NOTE: equipmentDepthOk is checked separately (requires target row) via the exported helper.
 */
export function checkAllConstraints(
  jockey: SolverJockey,
  container: SolverContainer,
  targetSlot: SolverSlot,
): string | null {
  return (
    jockeyAvailable(jockey) ??
    hazmMatCertOk(jockey, container) ??
    equipmentCanStack(jockey, targetSlot.tier) ??
    equipmentDepthOk(jockey, targetSlot.row) ??
    hazmatSlotOk(container, targetSlot) ??
    slotFree(targetSlot)
  )
}
