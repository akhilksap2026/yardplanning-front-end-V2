/**
 * server/planner/types.ts — Internal solver type definitions.
 * These are distinct from the BackendXxx types in backend-api.ts.
 * The solver works in its own domain, then the route handler converts to BackendXxx.
 */

/** A yard zone loaded from the zones DB table. */
export interface SolverZone {
  id: string
  name: string
  blocks: number
  rows: number
  slots: number
  maxTiers: number
  hazmat: boolean
  customs: boolean
}

/** A slot in the yard (derived from zone dimensions). */
export interface SolverSlot {
  /** Sequential integer ID (1-based, matches /yard endpoint ordering). */
  id: number
  /** Address string, e.g. "A-01-1-1-1". */
  address: string
  zone_id: string
  block: number
  row: number
  bay: number    // slot column within the block
  tier: number
  is_hazmat_approved: boolean
  is_occupied: boolean
  occupied_by: string | null  // container id if occupied
}

/** A container candidate for the solver. */
export interface SolverContainer {
  id: string           // DB text id (e.g. "CMAU1000003")
  zone_id: string
  block: number
  row: number
  slot: number
  tier: number
  address: string
  status: string       // IN_YARD | STAGED | AT_RECEIVING_LANE | CUSTOMS_CONTROLLED
  hazmat: boolean
  imdg: string | null
  channel: string      // GREEN | ORANGE | RED
  hours_to_lfd: number | null
  dwell_days: number
  priority: string     // NORMAL | HIGH | CRITICAL
  empty: boolean
  size: string
  /** Computed urgency score (higher = move sooner). */
  urgency_score: number
}

/** An operator/jockey available to the solver. */
export interface SolverJockey {
  id: string
  name: string
  certs: string[]        // e.g. ["IMDG","RS"]
  status: string         // on shift | off shift | on_break
  equipment_id: string | null
  equipment_type: string | null
  /**
   * Maximum rows deep this equipment can reach within a block.
   * 0 = terminal tractor (flat-only, no stacking/block access).
   * 1+ = reach stacker or empty handler row reach.
   */
  max_row_depth: number
  /** Minutes from shift-start when this jockey becomes available next. */
  busy_until_min: number
  speed_factor: number
  /** Current position (for distance calc). Zone id. */
  current_zone_id: string | null
  current_block: number
  current_row: number
  current_bay: number
}

/** A weight factor loaded from solver_weights table. */
export interface SolverWeight {
  factor_name: string
  weight: number
  is_hard_constraint: boolean
  source_field: string | null
}

/** A move emitted by the solver. */
export interface AssignedMove {
  container_id: string       // DB text id
  jockey_id: string | null   // DB text id (null = unassigned)
  from_slot_id: number       // sequential slot ID
  to_slot_id: number         // sequential slot ID
  from_address: string       // human-readable address
  to_address: string         // human-readable address
  sequence_number: number
  estimated_duration_min: number
  /** Shift-relative minute when this jockey starts the move (non-overlapping per jockey). */
  start_time_min: number
  /** Shift-relative minute when this jockey finishes (start_time_min + duration). */
  end_time_min: number
  reason: MoveReason
  move_type: string
}

export type MoveReason =
  | 'inbound_placement'
  | 'outbound_staging'
  | 'shuffle'
  | 're_marshal'
  | 'replan_reassignment'

/** A container that could not be assigned in this solve run. */
export interface UnplacedContainer {
  container_id: string
  reason: string
}

/** Full result from a solver run. */
export interface SolverResult {
  moves: AssignedMove[]
  unplaced: UnplacedContainer[]
  objective_value: number
  solve_seconds: number
  solver_status: 'optimal' | 'feasible' | 'timeout' | 'empty'
  strategy: string
}
