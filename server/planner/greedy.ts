/**
 * server/planner/greedy.ts — Greedy solver loop.
 *
 * Algorithm:
 *  1. Score all eligible containers by urgency (descending).
 *  2. For each container:
 *     a. Determine move reason (inbound/outbound/marshal/shuffle).
 *     b. Joint (jockey × slot) search over all eligible jockeys × candidate slots.
 *        A destination slot is available only if the assigning jockey's start time
 *        is >= slotFreeAt[slotId] (time-aware occupancy).
 *     c. Assign move; update per-jockey free time; update slotFreeAt:
 *        - source slot freeAt = endTime (reserved until the container is gone)
 *        - destination slot freeAt = Infinity (occupied indefinitely)
 *  3. Stop when max_moves_per_plan is reached or time budget is exhausted.
 *
 * Frozen-move contract (for replans):
 *  - frozenContainerIds: exclude these containers from new assignments.
 *  - frozenDestinations: slot IDs already owned by in-progress/done moves — forced freeAt=Infinity.
 *  - frozenSources: slot IDs freed by those moves — forced freeAt=0 (available).
 *  - frozenJockeyEndTimes: per-jockey end time from their last frozen move —
 *    fresh moves for that jockey queue after the frozen end time.
 */
import { pool } from '../db.js'
import { buildSlotMap, buildAddressToIdMap, slotDistance } from './slots.js'
import { scoreContainer, classifyMoveReason } from './scoring.js'
import { jockeyAvailable, hazmMatCertOk, equipmentDepthOk, equipmentCanStack, hazmatSlotOk } from './constraints.js'
import { SOLVER_CONFIG } from './config.js'
import type {
  SolverZone, SolverContainer, SolverJockey, SolverWeight,
  SolverSlot, AssignedMove, MoveReason, SolverResult,
} from './types.js'

// ── Off-yard origin classification ────────────────────────────────────────────
// Containers at receiving lanes or customs hold are operationally "off-yard":
// they are scheduled to arrive at a yard slot, but the slot they're catalogued
// under must NOT be treated as occupied or subsequently released.
// Classification is based on container STATUS, not address resolution, because
// receiving-lane containers often carry valid yard addresses as their intended
// inbound slot rather than their current physical location.
const OFF_YARD_STATUSES = new Set(['AT_RECEIVING_LANE', 'AT_GATE'])

function isOffYard(c: SolverContainer): boolean {
  return OFF_YARD_STATUSES.has(c.status) || c.row === 0
}

// ── Target zone preferences ───────────────────────────────────────────────────

function preferredZones(c: SolverContainer, reason: MoveReason): string[] {
  if (reason === 'inbound_placement') {
    if (c.hazmat) return ['D']
    if (c.empty)  return ['Q', 'F']
    return ['A', 'B', 'E', 'C']
  }
  if (reason === 'outbound_staging') return ['S', 'F', 'R']
  return [c.zone_id, 'A', 'B', 'E', 'C']
}

function maxTier(reason: MoveReason): number {
  if (reason === 'inbound_placement') return 3
  if (reason === 'outbound_staging')  return 1
  return 2
}

// ── Speed factor ──────────────────────────────────────────────────────────────

function equipmentSpeedFactor(equipmentType: string | null): number {
  const t = (equipmentType ?? '').toLowerCase()
  if (t.includes('terminal tractor')) return 1.3
  if (t.includes('empty handler'))    return 0.8
  return 1.0
}

// ── Duration estimation ───────────────────────────────────────────────────────

function estimateDuration(
  fromZone: string, fromBlock: number, fromRow: number, fromBay: number,
  toZone: string,   toBlock: number,   toRow: number,   toBay: number,
  speedFactor: number,
): number {
  const dist = slotDistance(fromZone, fromBlock, fromRow, fromBay, toZone, toBlock, toRow, toBay)
  const travel = dist / SOLVER_CONFIG.jockey_speed_divisor
  const raw = (SOLVER_CONFIG.base_move_minutes + travel) / Math.max(speedFactor, 0.5)
  return Math.max(1, Math.round(raw * 10) / 10)
}

// ── Joint (slot × jockey) pair search with time-aware availability ─────────────

interface Pair {
  slot: SolverSlot
  jockey: SolverJockey
  zonePriority: number
  dist: number
  startTime: number
  duration: number
}

/**
 * Find the best (slot, jockey) pair for the given container.
 *
 * A destination slot is eligible only if:
 *   - slot.is_occupied === false (no permanent container there), AND
 *   - the jockey's earliest start time >= slotFreeAt[slot.id]
 *     (the slot is not reserved by another move still in progress)
 */
function findBestPair(
  container: SolverContainer,
  eligibleJockeys: SolverJockey[],
  slots: SolverSlot[],
  reason: MoveReason,
  jockeyFreeAt: Map<string, number>,
  slotFreeAt: Map<number, number>,
): Pair | null {
  const zones = preferredZones(container, reason)
  const tier  = maxTier(reason)

  let best: Pair | null = null

  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi]

    const zoneCandidates = slots.filter(s =>
      s.zone_id === zone &&
      s.tier <= tier &&
      !s.is_occupied &&
      (!container.hazmat || s.is_hazmat_approved),
    )
    if (!zoneCandidates.length) continue

    for (const jockey of eligibleJockeys) {
      if (jockeyAvailable(jockey) !== null) continue
      if (hazmMatCertOk(jockey, container) !== null) continue
      if (jockey.max_row_depth === 0) continue

      const jStartTime = jockeyFreeAt.get(jockey.id) ?? 0

      // Source row-depth check: jockey must be able to reach the container's current row.
      // Skip for off-yard containers (receiving lane / gate): their catalogued yard address
      // is an intended destination, not a physical location, so no source-access check applies.
      if (!isOffYard(container) && equipmentDepthOk(jockey, container.row) !== null) continue

      for (const slot of zoneCandidates) {
        if (equipmentCanStack(jockey, slot.tier) !== null) continue  // tier/stacking capability
        if (equipmentDepthOk(jockey, slot.row) !== null) continue    // row-depth at destination
        if (hazmatSlotOk(container, slot) !== null) continue

        // Time-aware availability: check this slot is free when jockey arrives
        const freesAt = slotFreeAt.get(slot.id) ?? 0
        if (jStartTime < freesAt) continue   // slot still reserved by a prior releasing move

        const dist = slotDistance(
          jockey.current_zone_id ?? container.zone_id,
          jockey.current_block, jockey.current_row, jockey.current_bay,
          slot.zone_id, slot.block, slot.row, slot.bay,
        )
        const duration = estimateDuration(
          container.zone_id, container.block, container.row, container.slot,
          slot.zone_id, slot.block, slot.row, slot.bay,
          jockey.speed_factor,
        )
        const startTime = jStartTime

        const cost = zi * 10_000 + dist + startTime * 0.01
        const prevCost = best
          ? best.zonePriority * 10_000 + best.dist + best.startTime * 0.01
          : Infinity

        if (cost < prevCost) {
          best = { slot, jockey, zonePriority: zi, dist, startTime, duration }
        }
      }
    }

    if (best && best.zonePriority === zi) break
  }

  return best
}

// ── Load data from DB ─────────────────────────────────────────────────────────

async function loadZones(): Promise<SolverZone[]> {
  const { rows } = await pool.query<SolverZone>(`
    SELECT id, name, blocks, rows, slots,
           max_tiers AS "maxTiers", hazmat, customs
    FROM zones ORDER BY id
  `)
  return rows
}

async function loadContainers(): Promise<SolverContainer[]> {
  const { rows } = await pool.query(`
    SELECT id, zone_id, block, row_num AS row, slot, tier, address,
           status, hazmat, imdg, channel,
           hours_to_lfd::float AS hours_to_lfd,
           dwell_days::float AS dwell_days,
           priority, empty, size
    FROM containers
    WHERE status IN ('IN_YARD','STAGED','AT_RECEIVING_LANE','AT_GATE','CUSTOMS_CONTROLLED')
    ORDER BY id
  `)
  return rows.map((r: Record<string, unknown>) => ({ ...r, urgency_score: 0 })) as SolverContainer[]
}

async function loadJockeys(): Promise<SolverJockey[]> {
  const { rows } = await pool.query(`
    SELECT o.id, o.name, o.certs, o.status, o.equipment_id,
           e.type AS equipment_type,
           COALESCE(e.max_row_depth, 1) AS max_row_depth
    FROM operators o
    LEFT JOIN equipment e ON e.id = o.equipment_id
    ORDER BY o.id
  `)
  return (rows as Array<{
    id: string; name: string; certs: string[]; status: string;
    equipment_id: string | null; equipment_type: string | null; max_row_depth: number
  }>).map(r => ({
    ...r,
    busy_until_min: 0,
    speed_factor: equipmentSpeedFactor(r.equipment_type),
    current_zone_id: null as string | null,
    current_block: 1,
    current_row: 1,
    current_bay: 1,
  }))
}

async function loadWeights(): Promise<SolverWeight[]> {
  const { rows } = await pool.query<SolverWeight>(`
    SELECT factor_name, weight::float AS weight, is_hard_constraint, source_field
    FROM solver_weights
    ORDER BY display_order
  `)
  return rows
}

// ── Main solver entry point ───────────────────────────────────────────────────

export async function runGreedySolver(opts: {
  timeBudgetMs?: number
  frozenContainerIds?: Set<string>
  frozenDestinations?: Set<string>
  frozenSources?: Set<string>
  frozenJockeyEndTimes?: Map<string, number>
  disruptedJockeyId?: string | null
  disruptedContainerId?: string | null
} = {}): Promise<SolverResult> {
  const startMs = Date.now()
  const timeBudget = opts.timeBudgetMs ?? 9_000

  const [zones, containers, jockeys, weights] = await Promise.all([
    loadZones(),
    loadContainers(),
    loadJockeys(),
    loadWeights(),
  ])

  // ── Build slot map ─────────────────────────────────────────────────────────
  // Only yard-located containers (IN_YARD, STAGED, CUSTOMS_CONTROLLED) actually
  // occupy a yard slot. OFF_YARD containers (AT_RECEIVING_LANE, AT_GATE) carry
  // an intended inbound address — including them would incorrectly block those
  // slots for new assignments.
  const yardContainers = containers.filter(c => !isOffYard(c))
  const occupiedAddresses = new Set<string>(yardContainers.map(c => c.address))
  const occupiedByMap = new Map<string, string>(yardContainers.map(c => [c.address, c.id]))
  const slots = buildSlotMap(zones, occupiedAddresses, occupiedByMap)
  const addrToId = buildAddressToIdMap(slots)

  // ── Time-aware slot availability ───────────────────────────────────────────
  // slotFreeAt[id] = earliest shift-minute when this slot can be used as a destination.
  // Infinity means permanently occupied. 0 (default) means immediately free.
  const slotFreeAt = new Map<number, number>()

  // Seed slotFreeAt from the static occupancy built by buildSlotMap
  // (slots marked is_occupied = true are locked unless a frozen source frees them)
  for (const s of slots) {
    if (s.is_occupied) slotFreeAt.set(s.id, Infinity)
  }

  // Apply frozen-move slot effects:
  if (opts.frozenDestinations) {
    for (const idStr of opts.frozenDestinations) {
      const slotId = parseInt(idStr, 10)
      const s = slots.find(sl => sl.id === slotId)
      if (s) { s.is_occupied = true; slotFreeAt.set(slotId, Infinity) }
    }
  }
  if (opts.frozenSources) {
    // The container has physically moved out — the source is now available
    for (const idStr of opts.frozenSources) {
      const slotId = parseInt(idStr, 10)
      const s = slots.find(sl => sl.id === slotId)
      if (s) { s.is_occupied = false; s.occupied_by = undefined; slotFreeAt.set(slotId, 0) }
    }
  }

  // ── Per-jockey free-at time ────────────────────────────────────────────────
  const jockeyFreeAt = new Map<string, number>(opts.frozenJockeyEndTimes ?? [])

  // ── Filter jockeys and build exclusion set ─────────────────────────────────
  const activeJockeys = jockeys.filter(j =>
    !(opts.disruptedJockeyId && j.id === opts.disruptedJockeyId)
  )

  const excludedContainerIds = new Set<string>(opts.frozenContainerIds ?? [])
  if (opts.disruptedContainerId) excludedContainerIds.add(opts.disruptedContainerId)

  // ── Score containers ───────────────────────────────────────────────────────
  const scored = containers
    .filter(c => !excludedContainerIds.has(c.id))
    .map(c => ({ ...c, urgency_score: scoreContainer(c, weights, SOLVER_CONFIG) }))
    .filter(c => c.urgency_score >= SOLVER_CONFIG.min_urgency_score)
    .sort((a, b) => b.urgency_score - a.urgency_score)

  // ── Greedy assignment loop ─────────────────────────────────────────────────
  const moves: AssignedMove[] = []
  const unplaced: { container_id: string; reason: string }[] = []
  let seq = 1
  let objectiveValue = 0

  // slotById for fast lookup
  const slotById = new Map<number, SolverSlot>(slots.map(s => [s.id, s]))

  for (const c of scored) {
    if (Date.now() - startMs > timeBudget) {
      unplaced.push({ container_id: c.id, reason: 'time_budget_exceeded' })
      continue
    }
    if (moves.length >= SOLVER_CONFIG.max_moves_per_plan) {
      unplaced.push({ container_id: c.id, reason: 'max_moves_reached' })
      continue
    }

    const reason = classifyMoveReason(c) as MoveReason
    const pair = findBestPair(c, activeJockeys, slots, reason, jockeyFreeAt, slotFreeAt)

    if (!pair) {
      unplaced.push({ container_id: c.id, reason: 'no_feasible_pair' })
      continue
    }

    const { slot: targetSlot, jockey, startTime, duration } = pair
    const endTime = startTime + duration

    // Determine whether this container is at an off-yard location (receiving lane/gate).
    // Classification is based on container STATUS, not address resolution, because
    // receiving-lane containers carry valid yard addresses as their intended inbound slot
    // (not their current physical location). Off-yard containers must NOT lock yard slots.
    const offYard = isOffYard(c)
    const fromId  = offYard ? null : (addrToId.get(c.address) ?? null)
    const toId    = targetSlot.id

    moves.push({
      container_id: c.id,
      jockey_id: jockey.id,
      from_slot_id: fromId ?? 0,       // 0 = "off-yard origin" sentinel; stored as "0" in DB
      to_slot_id: toId,
      from_address: c.address,
      to_address: targetSlot.address,
      sequence_number: seq++,
      estimated_duration_min: duration,
      start_time_min: Math.round(startTime * 100) / 100,
      end_time_min:   Math.round(endTime   * 100) / 100,
      reason,
      move_type: reason,
    })

    objectiveValue += c.urgency_score

    // Update per-jockey free time
    jockeyFreeAt.set(jockey.id, endTime)

    // Update jockey position
    jockey.current_zone_id = targetSlot.zone_id
    jockey.current_block   = targetSlot.block
    jockey.current_row     = targetSlot.row
    jockey.current_bay     = targetSlot.bay

    // Time-aware slot update:
    // - Source slot (yard only): released at endTime so other moves can target it afterward.
    //   Only update if the container was actually at a yard slot (fromId != null)
    //   and that slot's occupied_by matches this container (prevents double-release bugs).
    if (fromId !== null) {
      const fromSlot = slotById.get(fromId)
      if (fromSlot && fromSlot.occupied_by === c.id) {
        fromSlot.is_occupied = false
        fromSlot.occupied_by = undefined
        slotFreeAt.set(fromId, endTime)  // available to new moves after endTime
      }
      // If occupied_by doesn't match (e.g. address collision), leave the slot locked.
    }
    // Non-yard sources (fromId === null) do not affect slotFreeAt — no yard slot is released.

    // - Destination: mark permanently occupied
    targetSlot.is_occupied = true
    targetSlot.occupied_by = c.id
    slotFreeAt.set(toId, Infinity)    // permanently occupied by placed container
  }

  const solveSeconds = (Date.now() - startMs) / 1000

  return {
    moves,
    unplaced,
    objective_value: Math.round(objectiveValue * 100) / 100,
    solve_seconds: Math.round(solveSeconds * 100) / 100,
    solver_status: moves.length > 0 ? 'feasible' : 'empty',
    strategy: 'greedy',
  }
}
