/**
 * server/planner/scoring.ts — Container urgency scoring for the greedy solver.
 *
 * Each container gets a scalar urgency score. Higher = move sooner.
 * The formula is a weighted sum of normalised factor values.
 * Hard-constraint factors (is_hard_constraint=true) contribute to priority
 * but do NOT add to the objective_value (they're treated as must-do).
 */
import type { SolverContainer, SolverWeight } from './types.js'
import type { SolverConfig } from './config.js'

/** Normalise hours_to_lfd to [0,1]: 0 h → 1.0, window h → 0.0, already overdue → 1.5. */
function detentionFactor(hoursToLfd: number | null, windowHours: number): number {
  if (hoursToLfd == null) return 0
  if (hoursToLfd <= 0) return 1.5              // overdue — super-urgent
  if (hoursToLfd >= windowHours) return 0
  return 1 - hoursToLfd / windowHours
}

/** Priority text → numeric urgency contribution. */
function priorityFactor(priority: string): number {
  switch (priority?.toUpperCase()) {
    case 'CRITICAL': return 1.0
    case 'HIGH':     return 0.7
    case 'NORMAL':   return 0.3
    default:         return 0.1
  }
}

/** Dwell days normalised to [0,1] using a soft cap at 30 days. */
function dwellFactor(dwellDays: number): number {
  return Math.min(dwellDays / 30, 1)
}

/** Tier contributes slightly to urgency (higher tier = slightly easier to move first). */
function tierFactor(tier: number): number {
  return Math.max(0, (tier - 1) / 3)  // tier 1→0, tier 4→1
}

/** Channel urgency: RED > ORANGE > GREEN */
function channelFactor(channel: string): number {
  switch (channel?.toUpperCase()) {
    case 'RED':    return 1.0
    case 'ORANGE': return 0.5
    default:       return 0
  }
}

/**
 * Compute urgency score for a single container.
 * Returns a non-negative float; larger = higher priority.
 */
export function scoreContainer(
  c: SolverContainer,
  weights: SolverWeight[],
  cfg: SolverConfig,
): number {
  const wMap = new Map(weights.map(w => [w.factor_name, w]))

  const get = (name: string, fallback = 1): number =>
    (wMap.get(name)?.weight ?? fallback)

  let score = 0

  // Detention urgency — highest weight by default (3.0)
  score += get('detention_urgency') * detentionFactor(c.hours_to_lfd, cfg.detention_urgency_window)

  // Hazmat — treated as urgency boost (separate from hard constraint)
  if (c.hazmat) {
    score += get('hazmat_priority', 2.5) * 0.5
  }

  // Priority level (CRITICAL/HIGH/NORMAL/LOW)
  score += get('priority_level', 2.0) * priorityFactor(c.priority)

  // Dwell days
  score += get('dwell_days', 1.5) * dwellFactor(c.dwell_days)

  // Slot tier (higher tier → slight urgency bonus so we clearout top first)
  score += get('slot_tier', 0.5) * tierFactor(c.tier)

  // Channel (RED custom hold)
  score += channelFactor(c.channel) * 0.5

  return score
}

/** Classify what kind of move this container needs. */
export function classifyMoveReason(
  c: SolverContainer,
): 'inbound_placement' | 'outbound_staging' | 'shuffle' | 're_marshal' {
  if (c.status === 'AT_RECEIVING_LANE' || c.status === 'AT_GATE') return 'inbound_placement'
  if (c.hours_to_lfd != null && c.hours_to_lfd < 48) return 'outbound_staging'
  if (c.tier > 1) return 're_marshal'
  return 'shuffle'
}
