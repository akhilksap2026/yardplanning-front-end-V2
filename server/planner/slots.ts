/**
 * server/planner/slots.ts — Shared slot-map builder.
 *
 * Builds the same sequential slot-ID assignment that GET /api/planner/yard uses,
 * so that solver-generated to_slot_id/from_slot_id integers resolve correctly
 * when the frontend looks them up in the slots array.
 *
 * Zone iteration order: ORDER BY id (alphabetical: A,B,C,D,E,F,Q,R,S).
 * Inner loops: block → row → bay → tier (matching the /yard route).
 */
import type { SolverZone, SolverSlot } from './types.js'

/**
 * Build a complete slot list from zone definitions.
 * @param zones Must be sorted alphabetically by id (matches ORDER BY id in DB).
 * @param occupiedAddresses Set of address strings that are currently occupied.
 * @param occupiedByMap Map from address → container_id.
 */
export function buildSlotMap(
  zones: SolverZone[],
  occupiedAddresses: Set<string>,
  occupiedByMap: Map<string, string>,
): SolverSlot[] {
  const slots: SolverSlot[] = []
  let slotId = 1

  for (const z of zones) {
    for (let b = 1; b <= z.blocks; b++) {
      for (let r = 1; r <= z.rows; r++) {
        for (let s = 1; s <= z.slots; s++) {
          for (let t = 1; t <= z.maxTiers; t++) {
            const address = `${z.id}-${String(b).padStart(2, '0')}-${r}-${s}-${t}`
            const occupied = occupiedAddresses.has(address)
            slots.push({
              id: slotId++,
              address,
              zone_id: z.id,
              block: b,
              row: r,
              bay: s,
              tier: t,
              is_hazmat_approved: z.hazmat,
              is_occupied: occupied,
              occupied_by: occupiedByMap.get(address) ?? null,
            })
          }
        }
      }
    }
  }

  return slots
}

/** Lookup slot ID by address (fast, from pre-built map). */
export function buildAddressToIdMap(slots: SolverSlot[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of slots) m.set(s.address, s.id)
  return m
}

/** Parse an address string into its components. Returns null if invalid. */
export function parseAddress(address: string): {
  zone_id: string; block: number; row: number; bay: number; tier: number
} | null {
  const parts = address.split('-')
  if (parts.length !== 5) return null
  const [zone_id, blockStr, rowStr, bayStr, tierStr] = parts
  const block = parseInt(blockStr, 10)
  const row   = parseInt(rowStr, 10)
  const bay   = parseInt(bayStr, 10)
  const tier  = parseInt(tierStr, 10)
  if (isNaN(block) || isNaN(row) || isNaN(bay) || isNaN(tier)) return null
  return { zone_id, block, row, bay, tier }
}

/**
 * Manhattan distance between two slot positions in the abstract yard grid.
 * Zone offsets are scaled so cross-zone travel is more expensive than in-zone.
 */
const ZONE_X_OFFSET: Record<string, number> = {
  A: 0, B: 12, C: 24, D: 30, E: 36, F: 48, Q: 56, R: 62, S: 70,
}

export function slotDistance(
  zone1: string, block1: number, row1: number, bay1: number,
  zone2: string, block2: number, row2: number, bay2: number,
): number {
  const x1 = (ZONE_X_OFFSET[zone1] ?? 0) + (block1 - 1) * 10 + bay1
  const x2 = (ZONE_X_OFFSET[zone2] ?? 0) + (block2 - 1) * 10 + bay2
  return Math.abs(x1 - x2) + Math.abs(row1 - row2)
}
