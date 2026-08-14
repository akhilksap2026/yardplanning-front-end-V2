/**
 * src/lib/placement-rules.ts — Pure hard-filter rule checks.
 *
 * checkPlacementRules() takes a proposed move and the current container
 * snapshot and returns either:
 *   null    — move is legal (no rule fires)
 *   string  — human-readable block message (move is illegal)
 *
 * These are DISPLAY-ONLY checks. They never mutate data or call the engine.
 *
 * Address format confirmed from utils.ts / yard-data.ts:
 *   "Z-BB-R-S-T"
 *   parts[0] = zone   (single letter,        e.g. "A")
 *   parts[1] = block  (zero-padded 2 digits, e.g. "03")
 *   parts[2] = row    (1-based integer)
 *   parts[3] = slot   (1-based integer)
 *   parts[4] = tier   (1-based integer, 1 = ground)
 *
 * Example: "A-03-2-5-4" → zone=A, block=03, row=2, slot=5, tier=4
 */

import type { Container } from "@/data/yard-data"

/** Minimal move shape needed for rule evaluation. */
export interface MoveForRuleCheck {
  containerId: string
  to: string
}

// ── Address parser ────────────────────────────────────────────────────────────

interface ParsedAddr {
  zone: string; block: string; row: number; slot: string; tier: number
}

function parseAddress(addr: string): ParsedAddr | null {
  const parts = addr.split("-")
  if (parts.length < 5) return null
  const row  = parseInt(parts[2], 10)
  const tier = parseInt(parts[4], 10)
  if (isNaN(row) || isNaN(tier)) return null
  return { zone: parts[0], block: parts[1], row, slot: parts[3], tier }
}

// ── Rule A — No-crush ─────────────────────────────────────────────────────────
//
// A loaded container (grossKg ≥ 8 000) may NOT stack directly onto an empty
// container. Empty ISO boxes bear tare weight only (~2–4 t); a full box above
// risks structural collapse and voids the EIR.
//
// Trigger conditions (all must be true):
//   • Destination tier > 1 (something is below)
//   • Moving container is loaded (grossKg ≥ 8 000 kg)
//   • Container immediately below (same zone-block-row-slot, tier-1) is empty

function checkNoCrush(
  move: MoveForRuleCheck,
  containers: Container[],
  dest: ParsedAddr,
): string | null {
  if (dest.tier <= 1) return null                        // ground — nothing below

  const mover = containers.find(c => c.id === move.containerId)
  if (!mover || mover.grossKg < 8_000) return null       // tare/lightweight — skip

  const belowAddr = `${dest.zone}-${dest.block}-${dest.row}-${dest.slot}-${dest.tier - 1}`
  const below = containers.find(c => c.address === belowAddr)
  if (!below || !below.empty) return null                 // nothing there, or not empty

  const heavyT = (mover.grossKg / 1000).toFixed(1)
  const lightT = (below.grossKg  / 1000).toFixed(1)
  return `No-crush rule: ${heavyT} t loaded cannot stack on ${lightT} t empty.`
}

// ── Rule C — Size mismatch ────────────────────────────────────────────────────
//
// A 20 ft container may not stack on a 40 ft container, and vice versa.
// Mixed-length stacks are mechanically unsound: the shorter box overhangs or
// is unsupported, risking tipping and corner-casting damage.
//
// Length is read from the first two characters of the ISO size code:
//   "20GP" → "20"  |  "40GP" → "40"  |  "40HC" → "40"
//
// Guard: if no container exists at tier-1 (ground slot or gap) — no block.

function checkSizeMismatch(
  move: MoveForRuleCheck,
  containers: Container[],
  dest: ParsedAddr,
): string | null {
  if (dest.tier <= 1) return null            // ground placement — nothing below

  const mover = containers.find(c => c.id === move.containerId)
  if (!mover?.size) return null

  const belowAddr = `${dest.zone}-${dest.block}-${dest.row}-${dest.slot}-${dest.tier - 1}`
  const below = containers.find(c => c.address === belowAddr)
  if (!below?.size) return null              // gap — nothing to mismatch against

  const moverLen = mover.size.slice(0, 2)   // "20" or "40"
  const belowLen = below.size.slice(0, 2)

  if (moverLen !== belowLen) {
    return `Size mismatch: ${mover.size} cannot stack on ${below.size}.`
  }
  return null
}

// ── Rule B — Tier-4 row-1 only ────────────────────────────────────────────────
//
// Reach-stackers can safely place at tier 4 only on row 1 (closest to the
// machine travel path). Rows 2+ at tier 4 exceed the rated tipping load.
// Source: Kalmar DRG450 capacity chart, row-depth × tier matrix.

function checkTier4Row1Only(dest: ParsedAddr): string | null {
  if (dest.tier === 4 && dest.row > 1) {
    return `Tier 4 permitted on row 1 only (reach-stacker tipping limit). Destination is row ${dest.row}.`
  }
  return null
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run all placement rules against a proposed move.
 * Returns the FIRST rule message that fires, or null if the move is legal.
 * Rules are checked cheapest-first (no container lookup needed for Rule B).
 */
export function checkPlacementRules(
  move: MoveForRuleCheck,
  containers: Container[],
): string | null {
  const dest = parseAddress(move.to)
  if (!dest) return null        // unparseable address — never false-block

  return (
    checkTier4Row1Only(dest) ??
    checkNoCrush(move, containers, dest) ??
    checkSizeMismatch(move, containers, dest)
  )
}
