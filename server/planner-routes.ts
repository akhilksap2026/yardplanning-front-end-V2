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

export const plannerRouter = Router()

// ── Stable integer ID from text string ───────────────────────────────────────
// Uses DJB2 hash to derive a consistent positive integer from a text ID.
// The solver (Task B) will use these same IDs when referencing containers/jockeys in moves.
function stableId(text: string): number {
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
  return 1.0 // reach stacker (default)
}

// ── Map YardOS container status → ContainerStatus ────────────────────────────
function toContainerStatus(status: string): string {
  switch (status?.toUpperCase()) {
    case 'STAGED':            return 'staged'
    case 'AT_RECEIVING_LANE':
    case 'GATE_IN':           return 'in_transit'
    case 'GATE_OUT':
    case 'DEPARTED':          return 'departed'
    default:                  return 'yard' // IN_YARD, CUSTOMS_CONTROLLED, etc.
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/yard
// Returns one aggregate BackendYardState built from zones + containers.
// Slots include both occupied (container present) and empty positions.
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/yard', async (_, res) => {
  try {
    const [zonesRes, containersRes] = await Promise.all([
      pool.query<{
        id: string; name: string; blocks: number; rows: number;
        slots: number; maxTiers: number; hazmat: boolean
      }>(`SELECT id, name, blocks, rows, slots, max_tiers AS "maxTiers", hazmat
          FROM zones ORDER BY id`),
      pool.query<{
        id: string; zone_id: string; block: number; row: number;
        slot: number; tier: number
      }>(`SELECT id, zone_id, block, row_num AS row, slot, tier
          FROM containers`),
    ])

    const zones = zonesRes.rows
    const containers = containersRes.rows

    // Build a lookup: "zone-block-row-slot-tier" → container id
    const occupiedMap = new Map<string, string>()
    for (const c of containers) {
      const key = `${c.zone_id}-${String(c.block).padStart(2,'0')}-${c.row}-${c.slot}-${c.tier}`
      occupiedMap.set(key, c.id)
    }

    // Aggregate yard descriptor
    const totalRows = zones.reduce((s, z) => s + z.rows, 0)
    const maxTier   = zones.reduce((m, z) => Math.max(m, z.maxTiers), 0)
    const maxSlots  = zones.reduce((m, z) => Math.max(m, z.slots), 0)

    const yard = { id: 1, name: 'Terminal Yard', rows: totalRows, bays_per_row: maxSlots, max_tier: maxTier }

    // Generate every slot position across all zones
    const slots: object[] = []
    let slotId = 1
    for (const z of zones) {
      const yardId = stableId(z.id) % 1000 + 1 // small stable int per zone
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
// Maps operators + equipment to BackendJockey shape.
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
// GET /api/planner/containers[?status=yard|staged|in_transit|departed]
// Maps containers table to BackendContainer shape.
// ─────────────────────────────────────────────────────────────────────────────
plannerRouter.get('/containers', async (req, res) => {
  try {
    // Reverse map: ContainerStatus → YardOS DB statuses
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
      current_slot_id: stableId(r.address), // stable slot reference
    }))

    res.json(result)
  } catch (err) {
    console.error('[planner] /containers error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/orders
// Maps visits to BackendOrder shape (DELIVERY and PICKUP purposes).
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

    const result = rows.map((r, i) => ({
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
// Returns solver weight factors from solver_weights table.
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
// Upsert solver weights. Validates factor names; returns warnings for unknowns.
plannerRouter.put('/weights/batch', async (req, res) => {
  try {
    const { weights, updated_by = 'yard_manager' } = req.body as {
      weights: { factor_name: string; weight: number }[]
      updated_by?: string
    }
    if (!Array.isArray(weights)) {
      return res.status(400).json({ error: 'weights array required' })
    }

    // Load known factor names
    const { rows: existing } = await pool.query(
      `SELECT factor_name FROM solver_weights`
    )
    const knownFactors = new Set(existing.map((r: { factor_name: string }) => r.factor_name))

    const warnings: string[] = []
    const updated: object[] = []

    for (const w of weights) {
      if (!knownFactors.has(w.factor_name)) {
        warnings.push(`Unknown factor '${w.factor_name}' — skipped`)
        continue
      }
      const { rows } = await pool.query(
        `UPDATE solver_weights
         SET weight = $1, updated_by = $2, updated_at = NOW()
         WHERE factor_name = $3
         RETURNING id, factor_name, weight::float, is_hard_constraint,
                   transform_type, source_field, transform_params, null_default::float,
                   display_order, updated_at, updated_by`,
        [w.weight, updated_by, w.factor_name]
      )
      if (rows.length) updated.push(rows[0])
    }

    // Return full updated list
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
// GET /api/planner/plans
// Lists planner plans (empty until solver is built in Task B).
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
    res.json(rows)
  } catch (err) {
    console.error('[planner] /plans error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/planner/plans/:id
plannerRouter.get('/plans/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid plan id' })

    const { rows: plans } = await pool.query(
      `SELECT id, plan_date, status, strategy,
              generated_at, confirmed_at, parent_plan_id,
              solve_seconds::float, objective_value::float,
              best_bound::float, gap_percent::float,
              solver_status, solver_config_id
       FROM planner_plans WHERE id = $1`,
      [id]
    )
    if (!plans.length) return res.status(404).json({ error: 'Plan not found' })

    const { rows: moves } = await pool.query(
      `SELECT id, plan_id, container_id, jockey_id,
              from_slot_id, to_slot_id, sequence_number,
              estimated_duration_min::float, status, reason, scanned_confirmed
       FROM planner_moves WHERE plan_id = $1 ORDER BY sequence_number`,
      [id]
    )

    res.json({ ...plans[0], moves })
  } catch (err) {
    console.error('[planner] /plans/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/planner/disruptions
// POST /api/planner/disruptions
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

    const { rows } = await pool.query(
      `INSERT INTO planner_disruptions
         (event_type, affected_container_id, affected_jockey_id, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type, affected_container_id, affected_order_id,
                 affected_jockey_id, occurred_at, description, triggered_replan_id`,
      [event_type, affected_container_id, affected_jockey_id, description]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error('[planner] POST /disruptions error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
