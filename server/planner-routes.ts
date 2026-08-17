/**
 * server/planner-routes.ts — YardOS planning engine API routes.
 *
 * Mounted at /api/planner by server/app.ts.
 * Implements the BackendXxx-shaped responses that src/lib/backend-api.ts expects.
 * These routes are separate from the existing /api/* routes (which return
 * YardOS seed-format data) to avoid shape conflicts.
 */
import { Router } from 'express'
import { pool } from './db.js'
import { runGreedySolver } from './planner/greedy.js'
import { narratePlan } from './planner/narrate.js'
import type { NarrationInput } from './planner/narrate.js'
import type { SolverResult, MoveReason } from './planner/types.js'

export const plannerRouter = Router()

// ── Stable integer ID from text string ───────────────────────────────────────
// Uses DJB2 hash to derive a consistent positive integer from a text ID.
function stableId(text: string): number {
  if (!text) return 0
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0
  }
  return (h % 2_147_483_647) + 1
}

// ── Equipment type → jockey speed_factor ─────────────────────────────────────
function speedFactor(equipmentType: string | null): number {
  const t = (equipmentType ?? '').toLowerCase()
  if (t.includes('terminal tractor')) return 1.3
  if (t.includes('empty handler')) return 0.8
  return 1.0
}

// ── Map YardOS container status → ContainerStatus ────────────────────────────
function toContainerStatus(status: string): string {
  switch (status?.toUpperCase()) {
    case 'STAGED':            return 'staged'
    case 'AT_RECEIVING_LANE':
    case 'GATE_IN':           return 'in_transit'
    case 'GATE_OUT':
    case 'DEPARTED':          return 'departed'
    default:                  return 'yard'
  }
}

// ── Map YardOS container priority/channel → damage_status ────────────────────
function toDamageStatus(channel: string, whyHere: string | null): string {
  if (channel === 'RED') return 'hold'
  const why = (whyHere ?? '').toLowerCase()
  if (why.includes('damage') || why.includes('inspect') || why.includes('structural')) return 'minor'
  return 'none'
}

// ── Parse size text → size_ft ────────────────────────────────────────────────
function toSizeFt(size: string): number {
  const m = size?.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : 20
}

// ── Hours-to-LFD → ISO detention_expiry ──────────────────────────────────────
function toDetentionExpiry(hoursToLfd: number | null): string | null {
  if (hoursToLfd == null) return null
  const d = new Date(Date.now() + hoursToLfd * 3_600_000)
  return d.toISOString()
}

// ── Shape a planner_moves DB row → BackendMove ────────────────────────────────
function shapeMove(row: {
  id: number; plan_id: number; container_id: string | null; jockey_id: string | null;
  from_slot_id: string | null; to_slot_id: string; sequence_number: number;
  estimated_duration_min: string | number;
  start_time_min?: string | number | null;
  end_time_min?: string | number | null;
  status: string; reason: string | null;
  scanned_confirmed: boolean
}) {
  return {
    id: row.id,
    plan_id: row.plan_id,
    container_id: row.container_id ? stableId(row.container_id) : null,
    jockey_id: row.jockey_id ? stableId(row.jockey_id) : null,
    from_slot_id: row.from_slot_id ? parseInt(row.from_slot_id, 10) : null,
    to_slot_id: parseInt(row.to_slot_id, 10),
    sequence_number: row.sequence_number,
    estimated_duration_min: Number(row.estimated_duration_min),
    start_time_min: row.start_time_min != null ? Number(row.start_time_min) : 0,
    end_time_min:   row.end_time_min   != null ? Number(row.end_time_min)   : 0,
    status: row.status,
    reason: row.reason ?? 'shuffle',
    scanned_confirmed: row.scanned_confirmed,
  }
}

// ── Shape a planner_plans DB row → BackendPlan ────────────────────────────────
function shapePlan(row: Record<string, unknown>) {
  return {
    id: row.id,
    plan_date: row.plan_date,
    status: row.status,
    strategy: row.strategy,
    generated_at: row.generated_at,
    confirmed_at: row.confirmed_at ?? null,
    parent_plan_id: row.parent_plan_id ?? null,
    solve_seconds: row.solve_seconds != null ? Number(row.solve_seconds) : null,
    objective_value: row.objective_value != null ? Number(row.objective_value) : null,
    best_bound: row.best_bound != null ? Number(row.best_bound) : null,
    gap_percent: row.gap_percent != null ? Number(row.gap_percent) : null,
    solver_status: row.solver_status ?? null,
    solver_config_id: row.solver_config_id ?? null,
    narration: row.narration != null ? String(row.narration) : null,
  }
}

// ── Build NarrationInput from SolverResult + operator names ───────────────────
async function buildNarrationInput(
  planId: number,
  planDate: string,
  strategy: string,
  result: SolverResult,
): Promise<NarrationInput> {
  // Collect unique jockey text-IDs from moves
  const jockeyIds = [...new Set(result.moves.map(m => m.jockey_id).filter(Boolean))] as string[]

  // Fetch operator names + certs in one query (small set)
  let jockeyMap = new Map<string, { name: string; certs: string[] }>()
  if (jockeyIds.length > 0) {
    const { rows } = await pool.query<{ id: string; name: string; certs: string[] }>(
      `SELECT id, name, certs FROM operators WHERE id = ANY($1::text[])`,
      [jockeyIds]
    )
    for (const r of rows) jockeyMap.set(r.id, { name: r.name, certs: r.certs ?? [] })
  }

  // Per-jockey move counts
  const jockeyMoveCounts = new Map<string, number>()
  const moveBreakdown: Record<string, number> = {}
  for (const m of result.moves) {
    if (m.jockey_id) jockeyMoveCounts.set(m.jockey_id, (jockeyMoveCounts.get(m.jockey_id) ?? 0) + 1)
    moveBreakdown[m.reason] = (moveBreakdown[m.reason] ?? 0) + 1
  }

  const jockeySummary = jockeyIds.map(id => ({
    name:       jockeyMap.get(id)?.name ?? id,
    certs:      jockeyMap.get(id)?.certs ?? [],
    move_count: jockeyMoveCounts.get(id) ?? 0,
  })).sort((a, b) => b.move_count - a.move_count)

  // Top moves: first 5 in sequence order (they are already sorted by urgency score → assignment order)
  const topMoves = result.moves.slice(0, 5).map(m => ({
    container_id: m.container_id,
    reason:       m.reason,
    start_min:    m.start_time_min,
    duration_min: m.estimated_duration_min,
  }))

  return {
    plan_id:        planId,
    plan_date:      planDate,
    strategy,
    solve_seconds:  result.solve_seconds,
    total_moves:    result.moves.length,
    unplaced_count: result.unplaced.length,
    move_breakdown: moveBreakdown,
    jockey_summary: jockeySummary,
    top_moves:      topMoves,
    unplaced:       result.unplaced,
  }
}

// ── Fire-and-forget narration (runs after plan commit) ───────────────────────
async function narrateAfterCommit(
  planId: number,
  planDate: string,
  strategy: string,
  result: SolverResult,
): Promise<void> {
  try {
    const input = await buildNarrationInput(planId, planDate, strategy, result)
    const narration = await narratePlan(input)
    if (narration) {
      await pool.query(
        `UPDATE planner_plans SET narration = $1 WHERE id = $2`,
        [narration, planId]
      )
      console.log(`[narrate] plan #${planId} narration stored`)
    }
  } catch (err) {
    console.error(`[narrate] fire-and-forget narration failed for plan #${planId}:`, err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/yard
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/yard', async (_, res) => {
  try {
    const [zonesRes, containersRes] = await Promise.all([
      pool.query<{
        id: string; name: string; blocks: number; rows: number;
        slots: number; maxTiers: number; hazmat: boolean
      }>(`SELECT id, name, blocks, rows, slots, max_tiers AS "maxTiers", hazmat
          FROM zones ORDER BY id`),
      // Exclude off-yard containers (AT_RECEIVING_LANE / AT_GATE) — they carry their
      // intended inbound yard address, not their current physical location.  Including
      // them would mark those slots as occupied and block valid new assignments.
      pool.query<{
        id: string; zone_id: string; block: number; row: number;
        slot: number; tier: number
      }>(`SELECT id, zone_id, block, row_num AS row, slot, tier
          FROM containers
          WHERE status NOT IN ('AT_RECEIVING_LANE','AT_GATE')`),
    ])

    const zones = zonesRes.rows
    const containers = containersRes.rows

    const occupiedMap = new Map<string, string>()
    for (const c of containers) {
      const key = `${c.zone_id}-${String(c.block).padStart(2,'0')}-${c.row}-${c.slot}-${c.tier}`
      occupiedMap.set(key, c.id)
    }

    const totalRows = zones.reduce((s, z) => s + z.rows, 0)
    const maxTier   = zones.reduce((m, z) => Math.max(m, z.maxTiers), 0)
    const maxSlots  = zones.reduce((m, z) => Math.max(m, z.slots), 0)

    const yard = { id: 1, name: 'Terminal Yard', rows: totalRows, bays_per_row: maxSlots, max_tier: maxTier }

    const slots: object[] = []
    let slotId = 1
    for (const z of zones) {
      const yardId = stableId(z.id) % 1000 + 1
      for (let b = 1; b <= z.blocks; b++) {
        for (let r = 1; r <= z.rows; r++) {
          for (let s = 1; s <= z.slots; s++) {
            for (let t = 1; t <= z.maxTiers; t++) {
              const key = `${z.id}-${String(b).padStart(2,'0')}-${r}-${s}-${t}`
              const occupiedId = occupiedMap.get(key)
              slots.push({
                id: slotId++,
                yard_id: yardId,
                block: String(b),
                bay: s,
                row: r,
                tier: t,
                is_hazmat_approved: z.hazmat,
                is_reefer_capable: false,
                occupied_container_id: occupiedId ? stableId(occupiedId) : null,
              })
            }
          }
        }
      }
    }

    res.json({ yard, slots })
  } catch (err) {
    console.error('[planner] /yard error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/jockeys
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/jockeys', async (_, res) => {
  try {
    const { rows } = await pool.query<{
      id: string; name: string; certs: string[];
      status: string; equipment_type: string | null
    }>(`SELECT o.id, o.name, o.certs, o.status,
               e.type AS equipment_type
        FROM operators o
        LEFT JOIN equipment e ON e.id = o.equipment_id
        ORDER BY o.id`)

    const statusMap: Record<string, string> = {
      'on shift': 'available', 'on_shift': 'available',
      'off shift': 'off_shift', 'off_shift': 'off_shift',
      'on_break': 'on_break', 'break': 'on_break',
      'busy': 'busy', 'in_use': 'busy',
    }

    const jockeys = rows.map(r => {
      const certs: string[] = r.certs ?? []
      const restrictions: string[] = []
      if (!certs.includes('IMDG')) restrictions.push('no_hazmat')

      return {
        id: stableId(r.id),
        name: r.name,
        speed_factor: speedFactor(r.equipment_type),
        status: statusMap[r.status?.toLowerCase()] ?? 'available',
        restrictions,
      }
    })

    res.json(jockeys)
  } catch (err) {
    console.error('[planner] /jockeys error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/containers
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/containers', async (req, res) => {
  try {
    const statusParam = req.query.status as string | undefined
    const reverseMap: Record<string, string[]> = {
      yard:       ['IN_YARD', 'CUSTOMS_CONTROLLED'],
      staged:     ['STAGED'],
      in_transit: ['AT_RECEIVING_LANE', 'GATE_IN'],
      departed:   ['GATE_OUT', 'DEPARTED'],
    }

    let whereClause = ''
    const params: string[][] = []
    if (statusParam && reverseMap[statusParam]) {
      whereClause = `WHERE status = ANY($1::text[])`
      params.push(reverseMap[statusParam])
    }

    const { rows } = await pool.query<{
      id: string; size: string; status: string; hazmat: boolean;
      imdg: string | null; channel: string; hours_to_lfd: number | null;
      address: string; why_here: string | null;
    }>(`SELECT id, size, status, hazmat, imdg, channel,
               hours_to_lfd::float AS hours_to_lfd,
               address, why_here
        FROM containers ${whereClause} ORDER BY id`,
      params.length ? params : undefined)

    const result = rows.map(r => ({
      id: stableId(r.id),
      container_number: r.id,
      order_id: null,
      size_ft: toSizeFt(r.size),
      status: toContainerStatus(r.status),
      is_hazmat: r.hazmat,
      hazmat_class: r.imdg ?? null,
      damage_status: toDamageStatus(r.channel, r.why_here),
      detention_expiry: toDetentionExpiry(r.hours_to_lfd),
      current_slot_id: stableId(r.address),
    }))

    res.json(result)
  } catch (err) {
    console.error('[planner] /containers error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/orders
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/orders', async (_, res) => {
  try {
    const { rows } = await pool.query<{
      id: string; carrier: string | null; purpose: string;
      appt: string | null; container: string | null; state: string
    }>(`SELECT id, carrier, purpose, appt_time AS appt, container_id AS container, state
        FROM visits
        WHERE purpose IN ('DELIVERY','PICKUP','EXPORT','IMPORT','REPO')
        ORDER BY appt_time, id`)

    const purposeToOrderType: Record<string, string> = {
      DELIVERY: 'inbound_full',
      IMPORT:   'inbound_full',
      PICKUP:   'outbound_full_to_dc',
      EXPORT:   'outbound_full_to_dc',
      REPO:     'outbound_empty_for_pickup',
    }

    const result = rows.map(r => ({
      id: stableId(r.id),
      origin: r.carrier ?? 'UNKNOWN',
      destination: 'YARD',
      eta: r.appt ?? new Date().toISOString(),
      priority: 1,
      order_type: purposeToOrderType[r.purpose] ?? 'inbound_full',
      customer_name: r.carrier ?? 'Unknown',
    }))

    res.json(result)
  } catch (err) {
    console.error('[planner] /orders error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/weights
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/weights', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, factor_name, weight::float, is_hard_constraint,
              transform_type, source_field, transform_params, null_default::float,
              display_order, updated_at, updated_by
       FROM solver_weights ORDER BY display_order, factor_name`
    )
    res.json(rows.map(r => ({
      id: r.id,
      factor_name: r.factor_name,
      weight: r.weight,
      is_hard_constraint: r.is_hard_constraint,
      transform_type: r.transform_type ?? null,
      source_field: r.source_field ?? null,
      transform_params: r.transform_params ?? null,
      null_default: r.null_default ?? null,
      display_order: r.display_order,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
    })))
  } catch (err) {
    console.error('[planner] /weights error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /api/planner/weights/batch
plannerRouter.put('/weights/batch', async (req, res) => {
  try {
    const { weights, updated_by = 'yard_manager' } = req.body as {
      weights: { factor_name: string; weight: number }[]
      updated_by?: string
    }
    if (!Array.isArray(weights)) {
      return res.status(400).json({ error: 'weights array required' })
    }

    const { rows: existing } = await pool.query(`SELECT factor_name FROM solver_weights`)
    const knownFactors = new Set(existing.map((r: { factor_name: string }) => r.factor_name))
    const warnings: string[] = []

    for (const w of weights) {
      if (!knownFactors.has(w.factor_name)) {
        warnings.push(`Unknown factor '${w.factor_name}' — skipped`)
        continue
      }
      await pool.query(
        `UPDATE solver_weights
         SET weight = $1, updated_by = $2, updated_at = NOW()
         WHERE factor_name = $3`,
        [w.weight, updated_by, w.factor_name]
      )
    }

    const { rows: allWeights } = await pool.query(
      `SELECT id, factor_name, weight::float, is_hard_constraint,
              transform_type, source_field, transform_params, null_default::float,
              display_order, updated_at, updated_by
       FROM solver_weights ORDER BY display_order, factor_name`
    )
    res.json({ weights: allWeights, warnings })
  } catch (err) {
    console.error('[planner] /weights/batch error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/planner/plans/generate
// Run greedy solver and persist the result.
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.post('/plans/generate', async (req, res) => {
  try {
    const {
      strategy: requestedStrategy = 'greedy',
      time_budget_seconds = 10,
      plan_date = new Date().toISOString().split('T')[0],
    } = req.body as {
      strategy?: string
      time_budget_seconds?: number | null
      plan_date?: string | null
    }

    // Both 'greedy' and 'cp_sat' run the greedy engine (CP-SAT is a future upgrade path).
    // Always persist 'greedy' to accurately reflect what ran.
    const strategy = 'greedy'
    if (requestedStrategy !== 'greedy') {
      console.log(`[planner] strategy '${requestedStrategy}' requested; running greedy (cp_sat not yet available)`)
    }

    const timeBudgetMs = (time_budget_seconds ?? 10) * 1000

    console.log(`[planner] generating plan: strategy=${strategy} budget=${timeBudgetMs}ms`)

    // Run the solver
    const result = await runGreedySolver({ timeBudgetMs })

    // Persist in a transaction
    const client = await pool.connect()
    let planId: number
    try {
      await client.query('BEGIN')

      const { rows: planRows } = await client.query(
        `INSERT INTO planner_plans
           (plan_date, status, strategy, solve_seconds, objective_value, solver_status)
         VALUES ($1, 'draft', $2, $3, $4, $5)
         RETURNING id, plan_date, status, strategy, generated_at, confirmed_at,
                   parent_plan_id, solve_seconds::float, objective_value::float,
                   best_bound::float, gap_percent::float, solver_status, solver_config_id`,
        [plan_date, strategy, result.solve_seconds, result.objective_value, result.solver_status]
      )
      planId = planRows[0].id as number

      // Insert moves
      for (const m of result.moves) {
        await client.query(
          `INSERT INTO planner_moves
             (plan_id, container_id, jockey_id, from_slot_id, to_slot_id,
              sequence_number, estimated_duration_min, start_time_min, end_time_min,
              status, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'planned', $10)`,
          [
            planId,
            m.container_id,
            m.jockey_id,
            String(m.from_slot_id),
            String(m.to_slot_id),
            m.sequence_number,
            m.estimated_duration_min,
            m.start_time_min,
            m.end_time_min,
            m.reason,
          ]
        )
      }

      await client.query('COMMIT')

      // Load the full plan back
      const plan = shapePlan(planRows[0])
      const { rows: moves } = await pool.query(
        `SELECT id, plan_id, container_id, jockey_id,
                from_slot_id, to_slot_id, sequence_number,
                estimated_duration_min, start_time_min::float, end_time_min::float,
                status, reason, scanned_confirmed
         FROM planner_moves WHERE plan_id = $1 ORDER BY sequence_number`,
        [planId]
      )

      console.log(`[planner] plan #${planId} generated: ${moves.length} moves, ${result.unplaced.length} unplaced`)

      res.json({ ...plan, moves: moves.map(shapeMove) })

      // Fire-and-forget narration — runs after response is sent so a slow OpenAI
      // call never delays the client. Failures are logged but never propagate.
      narrateAfterCommit(planId, plan_date as string, strategy, result).catch(() => {})
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[planner] /plans/generate error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/plans
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/plans', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, plan_date, status, strategy,
              generated_at, confirmed_at, parent_plan_id,
              solve_seconds::float, objective_value::float,
              best_bound::float, gap_percent::float,
              solver_status, solver_config_id
       FROM planner_plans ORDER BY generated_at DESC`
    )
    res.json(rows.map(shapePlan))
  } catch (err) {
    console.error('[planner] /plans error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/plans/:id
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/plans/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid plan id' })

    const { rows: plans } = await pool.query(
      `SELECT id, plan_date, status, strategy,
              generated_at, confirmed_at, parent_plan_id,
              solve_seconds::float, objective_value::float,
              best_bound::float, gap_percent::float,
              solver_status, solver_config_id, narration
       FROM planner_plans WHERE id = $1`,
      [id]
    )
    if (!plans.length) return res.status(404).json({ error: 'Plan not found' })

    const { rows: moves } = await pool.query(
      `SELECT id, plan_id, container_id, jockey_id,
              from_slot_id, to_slot_id, sequence_number,
              estimated_duration_min, start_time_min::float, end_time_min::float,
              status, reason, scanned_confirmed
       FROM planner_moves WHERE plan_id = $1 ORDER BY sequence_number`,
      [id]
    )

    res.json({ ...shapePlan(plans[0]), moves: moves.map(shapeMove) })
  } catch (err) {
    console.error('[planner] /plans/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/planner/plans/:id/narrate
// Re-narrate an existing plan (or narrate for the first time).
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.post('/plans/:id/narrate', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid plan id' })

    // Load plan metadata
    const { rows: plans } = await pool.query<{
      id: number; plan_date: string; strategy: string;
      solve_seconds: number | null; objective_value: number | null; solver_status: string | null
    }>(
      `SELECT id, plan_date, strategy, solve_seconds::float, objective_value::float, solver_status
       FROM planner_plans WHERE id = $1`,
      [id]
    )
    if (!plans.length) return res.status(404).json({ error: 'Plan not found' })
    const plan = plans[0]

    // Load moves from DB to reconstruct the NarrationInput
    const { rows: moveRows } = await pool.query<{
      container_id: string | null; jockey_id: string | null;
      reason: string | null; estimated_duration_min: number; start_time_min: number
    }>(
      `SELECT container_id, jockey_id, reason,
              estimated_duration_min::float, start_time_min::float
       FROM planner_moves WHERE plan_id = $1 ORDER BY sequence_number`,
      [id]
    )

    // Unplaced containers are not stored separately — reconstruct what we can from DB
    // (we store them as moves with reason='max_moves_reached' etc. in unplaced log if needed;
    // for re-narration just report 0 unplaced from DB perspective)

    // Build a minimal SolverResult-like object for the narration helper
    const mockResult: SolverResult = {
      moves: moveRows
        .filter(m => m.container_id && m.jockey_id)
        .map((m, i) => ({
          container_id:          m.container_id!,
          jockey_id:             m.jockey_id!,
          from_slot_id:          0,
          to_slot_id:            0,
          from_address:          '',
          to_address:            '',
          sequence_number:       i + 1,
          estimated_duration_min: m.estimated_duration_min,
          start_time_min:        m.start_time_min,
          end_time_min:          m.start_time_min + m.estimated_duration_min,
          reason:                (m.reason ?? 'shuffle') as MoveReason,
          move_type:             m.reason ?? 'shuffle',
        })),
      unplaced: [],
      objective_value: plan.objective_value ?? 0,
      solve_seconds:   plan.solve_seconds   ?? 0,
      solver_status:   (plan.solver_status  ?? 'feasible') as 'feasible' | 'optimal' | 'timeout' | 'empty',
      strategy:        plan.strategy,
    }

    const input = await buildNarrationInput(id, plan.plan_date, plan.strategy, mockResult)
    const narration = await narratePlan(input)

    if (narration === null) {
      return res.status(503).json({ error: 'Narration unavailable — OpenAI key not configured or API call failed' })
    }

    await pool.query(
      `UPDATE planner_plans SET narration = $1 WHERE id = $2`,
      [narration, id]
    )

    res.json({ narration })
  } catch (err) {
    console.error('[planner] POST /plans/:id/narrate error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/planner/plans/:id/confirm
// Mark a plan as confirmed; supersede any prior confirmed plan.
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.post('/plans/:id/confirm', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid plan id' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Check the plan exists and is not already superseded — BEFORE touching anything else
      const { rows: check } = await client.query(
        `SELECT id, status FROM planner_plans WHERE id = $1 FOR UPDATE`,
        [id]
      )
      if (!check.length) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Plan not found' })
      }
      if (check[0].status === 'superseded') {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Cannot confirm a superseded plan' })
      }

      // Safe to supersede any other confirmed plan now that we know this one exists
      await client.query(
        `UPDATE planner_plans SET status = 'superseded'
         WHERE status = 'confirmed' AND id != $1`,
        [id]
      )

      // Confirm this plan
      const { rows } = await client.query(
        `UPDATE planner_plans
         SET status = 'confirmed', confirmed_at = NOW()
         WHERE id = $1
         RETURNING id, plan_date, status, strategy, generated_at, confirmed_at,
                   parent_plan_id, solve_seconds::float, objective_value::float,
                   best_bound::float, gap_percent::float, solver_status, solver_config_id`,
        [id]
      )
      await client.query('COMMIT')

      res.json(shapePlan(rows[0]))
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[planner] /plans/:id/confirm error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/planner/plans/:id/replan
// Create a new plan derived from the given plan.
// Frozen moves (in_progress/done) are copied verbatim into the new plan.
// Their container IDs are excluded from the fresh solve to avoid conflicts.
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.post('/plans/:id/replan', async (req, res) => {
  try {
    const parentId = parseInt(req.params.id, 10)
    if (!Number.isInteger(parentId)) return res.status(400).json({ error: 'Invalid plan id' })

    const {
      reason = 'manual_replan',
      time_budget_seconds = 10,
    } = req.body as { reason?: string; time_budget_seconds?: number }

    // Load parent plan + frozen moves atomically
    const { rows: parentRows } = await pool.query(
      `SELECT id, plan_date, strategy FROM planner_plans WHERE id = $1`,
      [parentId]
    )
    if (!parentRows.length) return res.status(404).json({ error: 'Parent plan not found' })

    const { rows: allParentMoves } = await pool.query(
      `SELECT id, container_id, jockey_id, from_slot_id, to_slot_id,
              sequence_number, estimated_duration_min::float,
              start_time_min::float, end_time_min::float,
              status, reason, scanned_confirmed
       FROM planner_moves WHERE plan_id = $1 ORDER BY sequence_number`,
      [parentId]
    )

    // Split parent moves into frozen (keep as-is) vs planned (re-solve)
    type FrozenRow = {
      container_id: string; jockey_id: string | null
      from_slot_id: string | null; to_slot_id: string
      sequence_number: number; estimated_duration_min: number
      start_time_min: number; end_time_min: number
      status: string; reason: string | null; scanned_confirmed: boolean
    }
    const frozenMoves = allParentMoves.filter(
      (m: { status: string }) => m.status === 'in_progress' || m.status === 'done'
    ) as FrozenRow[]

    const frozenContainerIds = new Set<string>(
      frozenMoves.map(m => m.container_id).filter(Boolean)
    )
    // Frozen move destinations are still occupied; sources have been freed
    const frozenDestinations = new Set<string>(
      frozenMoves.map(m => m.to_slot_id).filter(Boolean)
    )
    const frozenSources = new Set<string>(
      frozenMoves.map(m => m.from_slot_id).filter(Boolean) as string[]
    )
    // Per-jockey end times from frozen moves (so fresh moves queue after them)
    const frozenJockeyEndTimes = new Map<string, number>()
    for (const m of frozenMoves) {
      if (!m.jockey_id) continue
      const cur = frozenJockeyEndTimes.get(m.jockey_id) ?? 0
      if (m.end_time_min > cur) frozenJockeyEndTimes.set(m.jockey_id, m.end_time_min)
    }

    console.log(`[planner] replan of #${parentId}: ${frozenContainerIds.size} frozen containers, reason=${reason}`)

    // Run solver excluding frozen containers; reserves frozen destinations; frees frozen sources
    const result = await runGreedySolver({
      timeBudgetMs: (time_budget_seconds ?? 10) * 1000,
      frozenContainerIds,
      frozenDestinations,
      frozenSources,
      frozenJockeyEndTimes,
    })

    const planDate = parentRows[0].plan_date ?? new Date().toISOString().split('T')[0]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: planRows } = await client.query(
        `INSERT INTO planner_plans
           (plan_date, status, strategy, parent_plan_id, solve_seconds, objective_value, solver_status)
         VALUES ($1, 'draft', 'greedy', $2, $3, $4, $5)
         RETURNING id, plan_date, status, strategy, generated_at, confirmed_at,
                   parent_plan_id, solve_seconds::float, objective_value::float,
                   best_bound::float, gap_percent::float, solver_status, solver_config_id`,
        [planDate, parentId, result.solve_seconds, result.objective_value, result.solver_status]
      )
      const newPlanId = planRows[0].id as number

      // 1. Copy frozen moves verbatim (status + timing preserved, plan_id updated)
      let seq = 1
      for (const m of frozenMoves) {
        await client.query(
          `INSERT INTO planner_moves
             (plan_id, container_id, jockey_id, from_slot_id, to_slot_id,
              sequence_number, estimated_duration_min, start_time_min, end_time_min,
              status, reason, scanned_confirmed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            newPlanId, m.container_id, m.jockey_id,
            m.from_slot_id, m.to_slot_id,
            seq++, m.estimated_duration_min, m.start_time_min, m.end_time_min,
            m.status, m.reason, m.scanned_confirmed,
          ]
        )
      }

      // 2. Insert fresh solver moves (sequence continues after frozen)
      for (const m of result.moves) {
        await client.query(
          `INSERT INTO planner_moves
             (plan_id, container_id, jockey_id, from_slot_id, to_slot_id,
              sequence_number, estimated_duration_min, start_time_min, end_time_min,
              status, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'planned', $10)`,
          [
            newPlanId, m.container_id, m.jockey_id,
            String(m.from_slot_id), String(m.to_slot_id),
            seq++, m.estimated_duration_min, m.start_time_min, m.end_time_min, m.reason,
          ]
        )
      }

      await client.query('COMMIT')

      const plan = shapePlan(planRows[0])
      const { rows: moves } = await pool.query(
        `SELECT id, plan_id, container_id, jockey_id,
                from_slot_id, to_slot_id, sequence_number,
                estimated_duration_min, start_time_min::float, end_time_min::float,
                status, reason, scanned_confirmed
         FROM planner_moves WHERE plan_id = $1 ORDER BY sequence_number`,
        [newPlanId]
      )

      console.log(`[planner] replan #${newPlanId} (parent #${parentId}): ${frozenMoves.length} frozen + ${result.moves.length} new moves`)

      res.json({ ...plan, moves: moves.map(shapeMove) })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[planner] /plans/:id/replan error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/planner/plans/:id
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.delete('/plans/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid plan id' })

    await pool.query(`DELETE FROM planner_plans WHERE id = $1`, [id])
    res.status(204).send()
  } catch (err) {
    console.error('[planner] DELETE /plans/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/planner/moves/:id — advance move status (planned→in_progress→done)
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.patch('/moves/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid move id' })

    const { status, scanned_confirmed } = req.body as {
      status?: string
      scanned_confirmed?: boolean
    }

    const validStatuses = ['planned', 'in_progress', 'done', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
    }

    const setClauses: string[] = []
    const params: unknown[] = []

    if (status) {
      params.push(status)
      setClauses.push(`status = $${params.length}`)
    }
    if (scanned_confirmed !== undefined) {
      params.push(scanned_confirmed)
      setClauses.push(`scanned_confirmed = $${params.length}`)
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE planner_moves SET ${setClauses.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, plan_id, container_id, jockey_id,
                 from_slot_id, to_slot_id, sequence_number,
                 estimated_duration_min, start_time_min::float, end_time_min::float,
                 status, reason, scanned_confirmed`,
      params
    )

    if (!rows.length) return res.status(404).json({ error: 'Move not found' })
    res.json(shapeMove(rows[0]))
  } catch (err) {
    console.error('[planner] PATCH /moves/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/disruptions
// POST /api/planner/disruptions — auto-triggers replan on CONTAINER_HOLD or OPERATOR_UNAVAILABLE
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/disruptions', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, event_type, affected_container_id, affected_order_id,
              affected_jockey_id, occurred_at, description, triggered_replan_id
       FROM planner_disruptions ORDER BY occurred_at DESC`
    )
    res.json(rows)
  } catch (err) {
    console.error('[planner] /disruptions error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

plannerRouter.post('/disruptions', async (req, res) => {
  try {
    const {
      event_type,
      affected_container_id = null,
      affected_jockey_id = null,
      description = '',
    } = req.body as {
      event_type: string
      affected_container_id?: number | null
      affected_jockey_id?: number | null
      description?: string
    }

    if (!event_type) {
      return res.status(400).json({ error: 'event_type is required' })
    }

    // Resolve stableId integers → DB text IDs.
    // The frontend sends stableId(container.id) as the integer; we reverse it by
    // scanning the relevant table and matching the hash. This is O(N) but N is small.
    let resolvedContainerTextId: string | null = null
    let resolvedJockeyTextId: string | null = null

    if (affected_container_id != null) {
      const { rows: allContainers } = await pool.query(`SELECT id FROM containers`)
      resolvedContainerTextId = allContainers.find(
        (r: { id: string }) => stableId(r.id) === affected_container_id
      )?.id ?? null
      if (!resolvedContainerTextId) {
        console.warn(`[planner] disruption: could not resolve container stableId ${affected_container_id}`)
      }
    }

    if (affected_jockey_id != null) {
      const { rows: allOperators } = await pool.query(`SELECT id FROM operators`)
      resolvedJockeyTextId = allOperators.find(
        (r: { id: string }) => stableId(r.id) === affected_jockey_id
      )?.id ?? null
      if (!resolvedJockeyTextId) {
        console.warn(`[planner] disruption: could not resolve jockey stableId ${affected_jockey_id}`)
      }
    }

    // Insert the disruption (store resolved text IDs, not stableId integers)
    const { rows: disruptionRows } = await pool.query(
      `INSERT INTO planner_disruptions
         (event_type, affected_container_id, affected_jockey_id, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type, affected_container_id, affected_order_id,
                 affected_jockey_id, occurred_at, description, triggered_replan_id`,
      [event_type, resolvedContainerTextId, resolvedJockeyTextId, description]
    )
    const disruption = disruptionRows[0]

    // Auto-replan on hard disruptions
    const AUTO_REPLAN_EVENTS = [
      'CONTAINER_HOLD', 'inspection_hold',
      'jockey_unavailable', 'OPERATOR_UNAVAILABLE',
    ]
    if (AUTO_REPLAN_EVENTS.includes(event_type)) {
      // Find current confirmed plan
      const { rows: confirmedPlans } = await pool.query(
        `SELECT id, plan_date FROM planner_plans WHERE status = 'confirmed'
         ORDER BY generated_at DESC LIMIT 1`
      )

      if (confirmedPlans.length > 0) {
        const parentId = confirmedPlans[0].id as number
        const planDate = confirmedPlans[0].plan_date as string

        try {
          // Load frozen moves from confirmed plan (in_progress/done — never re-assigned)
          const { rows: frozenMoves } = await pool.query(
            `SELECT container_id, jockey_id, from_slot_id, to_slot_id,
                    sequence_number, estimated_duration_min::float,
                    start_time_min::float, end_time_min::float,
                    status, reason, scanned_confirmed
             FROM planner_moves
             WHERE plan_id = $1 AND status IN ('in_progress','done')
             ORDER BY sequence_number`,
            [parentId]
          )
          type DF = {
            container_id: string; jockey_id: string | null
            from_slot_id: string | null; to_slot_id: string
            sequence_number: number; estimated_duration_min: number
            start_time_min: number; end_time_min: number
            status: string; reason: string | null; scanned_confirmed: boolean
          }
          const fm = frozenMoves as DF[]
          const frozenContainerIds = new Set<string>(fm.map(m => m.container_id).filter(Boolean))
          const frozenDestinations  = new Set<string>(fm.map(m => m.to_slot_id).filter(Boolean))
          const frozenSources       = new Set<string>(fm.map(m => m.from_slot_id).filter(Boolean) as string[])
          const frozenJockeyEndTimes = new Map<string, number>()
          for (const m of fm) {
            if (!m.jockey_id) continue
            const cur = frozenJockeyEndTimes.get(m.jockey_id) ?? 0
            if (m.end_time_min > cur) frozenJockeyEndTimes.set(m.jockey_id, m.end_time_min)
          }

          // Run solver: exclude frozen + held container, exclude unavailable jockey
          const result = await runGreedySolver({
            timeBudgetMs: 8_000,
            frozenContainerIds,
            frozenDestinations,
            frozenSources,
            frozenJockeyEndTimes,
            disruptedContainerId: resolvedContainerTextId,
            disruptedJockeyId: resolvedJockeyTextId,
          })

          const client = await pool.connect()
          try {
            await client.query('BEGIN')

            const { rows: planRows } = await client.query(
              `INSERT INTO planner_plans
                 (plan_date, status, strategy, parent_plan_id,
                  solve_seconds, objective_value, solver_status)
               VALUES ($1, 'draft', 'greedy', $2, $3, $4, $5)
               RETURNING id`,
              [planDate, parentId, result.solve_seconds, result.objective_value, result.solver_status]
            )
            const newPlanId = planRows[0].id as number

            // 1. Copy frozen moves verbatim (timing preserved)
            const fm2 = frozenMoves as DF[]
            let seq = 1
            for (const m of fm2) {
              await client.query(
                `INSERT INTO planner_moves
                   (plan_id, container_id, jockey_id, from_slot_id, to_slot_id,
                    sequence_number, estimated_duration_min, start_time_min, end_time_min,
                    status, reason, scanned_confirmed)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [newPlanId, m.container_id, m.jockey_id, m.from_slot_id, m.to_slot_id,
                 seq++, m.estimated_duration_min, m.start_time_min, m.end_time_min,
                 m.status, m.reason, m.scanned_confirmed]
              )
            }

            // 2. Insert fresh solver moves
            for (const m of result.moves) {
              await client.query(
                `INSERT INTO planner_moves
                   (plan_id, container_id, jockey_id, from_slot_id, to_slot_id,
                    sequence_number, estimated_duration_min, start_time_min, end_time_min,
                    status, reason)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',$10)`,
                [newPlanId, m.container_id, m.jockey_id,
                 String(m.from_slot_id), String(m.to_slot_id),
                 seq++, m.estimated_duration_min, m.start_time_min, m.end_time_min, m.reason]
              )
            }

            // Link disruption → triggered replan
            await client.query(
              `UPDATE planner_disruptions SET triggered_replan_id = $1 WHERE id = $2`,
              [newPlanId, disruption.id]
            )
            disruption.triggered_replan_id = newPlanId

            await client.query('COMMIT')
            console.log(
              `[planner] auto-replan #${newPlanId} triggered by ${event_type}: ` +
              `${frozenMoves.length} frozen + ${result.moves.length} new moves`
            )
          } catch (replanErr) {
            await client.query('ROLLBACK')
            console.error('[planner] auto-replan transaction failed:', replanErr)
          } finally {
            client.release()
          }
        } catch (solverErr) {
          console.error('[planner] auto-replan solver failed:', solverErr)
        }
      }
    }

    res.status(201).json(disruption)
  } catch (err) {
    console.error('[planner] POST /disruptions error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
