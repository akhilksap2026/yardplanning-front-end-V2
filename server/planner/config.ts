/**
 * server/planner/config.ts — Greedy solver tuneable defaults.
 * All values here can be overridden at call-time via the request body.
 * Future: load from solver_config table.
 */
export const SOLVER_CONFIG = {
  /** Top-K candidates considered per container when picking a jockey. */
  candidate_k: 3,

  /** Base minutes for a single container move (at speed_factor = 1.0, distance = 0). */
  base_move_minutes: 4,

  /** Gate location: block column used for inbound distance calculation. */
  gate_bay: 1,
  /** Gate location: row used for inbound distance calculation. */
  gate_row: 1,

  /** Max Manhattan distance units allowed for a jockey assignment (soft cap). */
  max_travel_distance: 999,

  /**
   * Scale factor: distance_units / jockey_speed_divisor = extra minutes added to
   * base_move_minutes for travel. Larger → distance costs more.
   */
  jockey_speed_divisor: 10,

  /** Hours-to-LFD threshold at which a container gets maximum detention urgency. */
  detention_urgency_window: 72,

  /** Hard ceiling on moves emitted per plan (prevents run-away plans). */
  max_moves_per_plan: 150,

  /** Minimum urgency score to bother assigning a move. */
  min_urgency_score: 0.1,
} as const

export type SolverConfig = typeof SOLVER_CONFIG
