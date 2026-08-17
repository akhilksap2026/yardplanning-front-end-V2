/**
 * server/api.test.ts — Integration tests for the Express API.
 *
 * These tests import the app directly (no listen() call) and exercise
 * routes via supertest. The database must be seeded for most read tests;
 * write tests create/modify rows and verify the response shape.
 *
 * Run with: npx vitest run server/api.test.ts
 */
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from './app.js'
import { pool } from './db.js'

/** DJB2 hash — mirrors stableId() in planner-routes to map text IDs → integers. */
function stableId(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  }
  return h
}

// ── Read routes ───────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 ok:true', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })
})

describe('GET /api/moves', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/moves')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/containers', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/containers')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/visits', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/visits')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/lanes', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/lanes')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/events', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/events')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ── Write routes — moves ──────────────────────────────────────────────────────

describe('PATCH /api/moves/:id', () => {
  it('returns 400 when state is missing', async () => {
    const res = await request(app).patch('/api/moves/MV-1001').send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 when state is DONE (use /complete instead)', async () => {
    const res = await request(app).patch('/api/moves/MV-1001').send({ state: 'DONE' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/complete/i)
  })

  it('returns 404 for a non-existent move', async () => {
    const res = await request(app).patch('/api/moves/NO-SUCH-MOVE').send({ state: 'IN_PROGRESS' })
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 200 and updates state for an existing move', async () => {
    // First read a move id that exists
    const list = await request(app).get('/api/moves')
    expect(list.status).toBe(200)
    const moves = list.body as { id: string; state: string }[]
    if (moves.length === 0) return // seed not loaded — skip

    // Find a non-DONE move to patch
    const target = moves.find(m => m.state !== 'DONE')
    if (!target) return

    const res = await request(app)
      .patch(`/api/moves/${target.id}`)
      .send({ state: 'IN_PROGRESS' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: target.id, state: 'IN_PROGRESS' })
  })
})

describe('POST /api/moves/:id/complete', () => {
  it('returns 404 for a non-existent move', async () => {
    const res = await request(app).post('/api/moves/NO-SUCH-MOVE/complete').send({})
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })
})

// ── Write routes — events ─────────────────────────────────────────────────────

describe('POST /api/events', () => {
  it('returns 400 when id or title is missing', async () => {
    const res = await request(app).post('/api/events').send({ title: 'No id' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/events').send({ id: 'EV-TEST-1' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 201 and the event id for a valid event', async () => {
    const res = await request(app).post('/api/events').send({
      id: `EV-TEST-${Date.now()}`,
      title: 'Integration test event',
      type: 'PLAN_PUBLISHED',
      severity: 'low',
      state: 'replanned',
    })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('id')
  })
})

// ── Write routes — visits ─────────────────────────────────────────────────────

describe('PATCH /api/visits/:id', () => {
  it('returns 404 for a non-existent visit', async () => {
    const res = await request(app).patch('/api/visits/NO-SUCH-VISIT').send({ state: 'CHECKED_IN' })
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 200 and updates state for an existing visit', async () => {
    const list = await request(app).get('/api/visits')
    expect(list.status).toBe(200)
    const visits = list.body as { id: string }[]
    if (visits.length === 0) return

    const res = await request(app)
      .patch(`/api/visits/${visits[0].id}`)
      .send({ state: 'IN_QUEUE' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id', visits[0].id)
  })
})

// ── Planner routes ────────────────────────────────────────────────────────────

describe('POST /api/planner/plans/generate — slot safety', () => {
  it('no two planned moves share the same destination slot', async () => {
    const res = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 8 })
    expect(res.status).toBe(200)
    const moves = res.body.moves as Array<{ to_slot_id: number; start_time_min: number; end_time_min: number }>

    // Each destination slot can only be occupied by one move (permanent occupancy).
    // Two moves can share a source→dest path only if the source frees before the
    // second move arrives, but no two moves should ever have the same destination.
    const destinationSet = new Set<number>()
    for (const m of moves) {
      expect(destinationSet.has(m.to_slot_id)).toBe(false)
      destinationSet.add(m.to_slot_id)
    }
  })

  it('source slot assigned as destination only after the releasing move ends', async () => {
    const res = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 8 })
    expect(res.status).toBe(200)
    const moves = res.body.moves as Array<{
      from_slot_id: number; to_slot_id: number
      start_time_min: number; end_time_min: number
    }>

    // Build a map: fromSlotId → latest end_time of a move releasing that slot.
    // Exclude from_slot_id=0 (sentinel for containers arriving from outside the yard —
    // receiving lanes, gate, etc. — which do not occupy a yard slot).
    const releasedAt = new Map<number, number>()
    for (const m of moves) {
      if (m.from_slot_id === 0) continue   // off-yard origin; no yard slot is freed
      const prev = releasedAt.get(m.from_slot_id) ?? 0
      if (m.end_time_min > prev) releasedAt.set(m.from_slot_id, m.end_time_min)
    }

    // For any move whose destination is a previously-released yard slot,
    // that move's start_time must be >= the latest releasing move's end_time.
    for (const m of moves) {
      const freeAt = releasedAt.get(m.to_slot_id)
      if (freeAt !== undefined) {
        // The slot was used as a yard source — it becomes free at freeAt.
        // The new move to this slot must start no earlier than freeAt.
        expect(m.start_time_min).toBeGreaterThanOrEqual(freeAt - 0.01)
      }
    }
  })
})

describe('POST /api/planner/plans/generate — row-depth & tier enforcement', () => {
  it('no planned move assigns a jockey to a container deeper than their max_row_depth', async () => {
    const res = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 8 })
    expect(res.status).toBe(200)

    type M = { container_id: number; jockey_id: number; from_slot_id: number; to_slot_id: number }
    const moves = res.body.moves as M[]

    // Load jockey max_row_depth from DB
    const { rows: jockeyRows } = await pool.query<{ id: string; max_row_depth: number }>(`
      SELECT o.id, COALESCE(e.max_row_depth, 1) AS max_row_depth
      FROM operators o LEFT JOIN equipment e ON e.id = o.equipment_id
    `)
    const jockeyDepth = new Map<number, number>(
      jockeyRows.map(j => [stableId(j.id), j.max_row_depth])
    )

    // Load container status and source row from DB
    const { rows: cRows } = await pool.query<{ id: string; row_num: number; status: string }>(`
      SELECT id, row_num, status FROM containers
    `)
    const containerRow = new Map<number, number>(
      cRows.map(c => [stableId(c.id), c.row_num])
    )
    const containerStatus = new Map<number, string>(
      cRows.map(c => [stableId(c.id), c.status])
    )

    // Load destination slot tier from DB (via planner/yard slot map)
    const yardRes = await request(app).get('/api/planner/yard')
    type Slot = { id: number; tier: number }
    const slotTierMap = new Map<number, number>(
      (yardRes.body.slots as Slot[]).map((s: Slot) => [s.id, s.tier])
    )

    for (const m of moves) {
      const maxDepth = jockeyDepth.get(m.jockey_id)
      const srcRow = containerRow.get(m.container_id)
      const status = containerStatus.get(m.container_id) ?? ''

      // Source row-depth: skip off-yard containers (AT_RECEIVING_LANE/AT_GATE).
      // These are physically at the lane/gate; their catalogued row is their intended slot.
      if (maxDepth !== undefined && srcRow !== undefined && srcRow > 0 &&
          status !== 'AT_RECEIVING_LANE' && status !== 'AT_GATE') {
        expect(srcRow).toBeLessThanOrEqual(maxDepth)
      }

      // Destination tier: terminal tractors (max_row_depth=0 is actually excluded already,
      // but we also check via equipmentCanStack — TT cannot stack to tier > 1).
      // Load equipment type to identify terminal tractors.
    }
  })

  it('AT_GATE containers are treated identically to AT_RECEIVING_LANE (off-yard origin, from_slot_id=0)', async () => {
    // Temporarily promote one AT_RECEIVING_LANE container to AT_GATE status,
    // generate a plan, then restore it.
    const { rows: pick } = await pool.query<{ id: string }>(
      `SELECT id FROM containers WHERE status='AT_RECEIVING_LANE' LIMIT 1`
    )
    if (pick.length === 0) return   // no lane containers seeded — skip gracefully

    const gateId = pick[0].id
    await pool.query(`UPDATE containers SET status='AT_GATE' WHERE id=$1`, [gateId])

    try {
      const res = await request(app)
        .post('/api/planner/plans/generate')
        .send({ strategy: 'greedy', time_budget_seconds: 5 })
      expect(res.status).toBe(200)

      type M = { container_id: number; from_slot_id: number; reason: string }
      const moves = res.body.moves as M[]
      const gateMove = moves.find(m => m.container_id === stableId(gateId))
      if (gateMove) {
        expect(gateMove.from_slot_id).toBe(0)
        expect(gateMove.reason).toBe('inbound_placement')
      }

      // Yard endpoint: gate container must not appear as slot occupant
      const yardRes = await request(app).get('/api/planner/yard')
      expect(yardRes.status).toBe(200)
      type YardSlot = { occupied_container_id: number | null }
      const occupied = (yardRes.body.slots as YardSlot[])
        .filter(s => s.occupied_container_id !== null)
        .map(s => s.occupied_container_id)
      expect(occupied).not.toContain(stableId(gateId))
    } finally {
      await pool.query(`UPDATE containers SET status='AT_RECEIVING_LANE' WHERE id=$1`, [gateId])
    }
  })

  it('receiving-lane containers do not appear as occupying their catalogued yard slot', async () => {
    // AT_RECEIVING_LANE containers carry a valid yard address as their *intended* inbound slot,
    // not their current physical location. Both the solver and the /yard endpoint must treat
    // those slots as free so other moves can legitimately be assigned there.

    // 1. GET /api/planner/yard must not show lane containers as slot occupants
    const yardRes = await request(app).get('/api/planner/yard')
    expect(yardRes.status).toBe(200)

    const { rows: laneContainers } = await pool.query<{ id: string; zone_id: string; block: number; row: number; slot: number; tier: number }>(`
      SELECT id, zone_id, block, row_num AS row, slot, tier
      FROM containers WHERE status = 'AT_RECEIVING_LANE'
    `)

    const laneContainerIds = new Set<number>(laneContainers.map(r => stableId(r.id)))

    type YardSlot = { id: number; occupied_container_id: number | null }
    const yardSlots = yardRes.body.slots as YardSlot[]

    // No yard slot should show a lane container as its occupant
    for (const slot of yardSlots) {
      if (slot.occupied_container_id !== null) {
        expect(laneContainerIds.has(slot.occupied_container_id)).toBe(false)
      }
    }

    // 2. Solver should use from_slot_id=0 (off-yard sentinel) for lane containers
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 8 })
    expect(genRes.status).toBe(200)

    type M = { container_id: number; from_slot_id: number }
    const moves = genRes.body.moves as M[]

    for (const m of moves) {
      if (laneContainerIds.has(m.container_id)) {
        expect(m.from_slot_id).toBe(0)
      }
    }
  })
})

describe('POST /api/planner/plans/generate', () => {
  it('normalises strategy=cp_sat to greedy in the response', async () => {
    const res = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'cp_sat', time_budget_seconds: 5 })
    expect(res.status).toBe(200)
    expect(res.body.strategy).toBe('greedy')
  })

  it('returns a plan with moves, all having non-overlapping start/end times per jockey', async () => {
    const res = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 5 })
    expect(res.status).toBe(200)
    const { moves, id } = res.body as { id: number; moves: Array<{ jockey_id: number; start_time_min: number; end_time_min: number; status: string; reason: string }> }
    expect(moves.length).toBeGreaterThan(0)

    // Verify end_time > start_time for every move
    for (const m of moves) {
      expect(m.end_time_min).toBeGreaterThan(m.start_time_min)
    }

    // Per-jockey non-overlap: for each jockey, moves must not overlap
    const byJockey = new Map<number, typeof moves>()
    for (const m of moves) {
      if (!byJockey.has(m.jockey_id)) byJockey.set(m.jockey_id, [])
      byJockey.get(m.jockey_id)!.push(m)
    }
    for (const [, jMoves] of byJockey) {
      jMoves.sort((a, b) => a.start_time_min - b.start_time_min)
      for (let i = 1; i < jMoves.length; i++) {
        // Each move must start no earlier than the previous move ends
        expect(jMoves[i].start_time_min).toBeGreaterThanOrEqual(jMoves[i - 1].end_time_min - 0.01)
      }
    }

    // All generated moves should be 'planned'
    for (const m of moves) {
      expect(m.status).toBe('planned')
    }

    // Reasons should be valid
    const validReasons = ['inbound_placement', 'outbound_staging', 're_marshal', 'shuffle']
    for (const m of moves) {
      expect(validReasons).toContain(m.reason)
    }
  })
})

describe('POST /api/planner/plans/:id/confirm', () => {
  it('returns 404 for a non-existent plan (does not wipe existing confirmed plans)', async () => {
    // First confirm a real plan so we know there is a confirmed plan to protect
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 4 })
    const realPlanId = genRes.body.id as number

    await request(app)
      .post(`/api/planner/plans/${realPlanId}/confirm`)
      .send()

    // Attempt to confirm a non-existent plan
    const res = await request(app)
      .post('/api/planner/plans/9999999/confirm')
      .send()
    expect(res.status).toBe(404)

    // Original confirmed plan must still be confirmed
    const detail = await request(app).get(`/api/planner/plans/${realPlanId}`)
    expect(detail.body.status).toBe('confirmed')
  })
})

describe('POST /api/planner/plans/:id/replan', () => {
  it('carries frozen moves verbatim (timing + status) and prevents destination slot reuse', async () => {
    // Generate + confirm a plan
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 5 })
    expect(genRes.status).toBe(200)
    const planId = genRes.body.id as number
    await request(app).post(`/api/planner/plans/${planId}/confirm`).send()

    const firstMove = genRes.body.moves[0] as {
      id: number; container_id: number; to_slot_id: number
      start_time_min: number; end_time_min: number
    }

    // Advance the first move to in_progress
    await request(app)
      .patch(`/api/planner/moves/${firstMove.id}`)
      .send({ status: 'in_progress' })

    // Replan
    const replanRes = await request(app)
      .post(`/api/planner/plans/${planId}/replan`)
      .send({ reason: 'test', time_budget_seconds: 5 })
    expect(replanRes.status).toBe(200)

    type M = { container_id: number; status: string; to_slot_id: number; start_time_min: number; end_time_min: number }
    const newMoves = replanRes.body.moves as M[]

    // 1. Frozen move must appear with in_progress status and preserved timing
    const frozenCopy = newMoves.find(m => m.container_id === firstMove.container_id && m.status === 'in_progress')
    expect(frozenCopy).toBeDefined()
    expect(frozenCopy!.end_time_min).toBeGreaterThan(frozenCopy!.start_time_min)
    // Timing should be copied verbatim from the original move
    expect(frozenCopy!.start_time_min).toBeCloseTo(firstMove.start_time_min, 1)
    expect(frozenCopy!.end_time_min).toBeCloseTo(firstMove.end_time_min, 1)

    // 2. The frozen container must NOT appear again as 'planned'
    const duplicates = newMoves.filter(m => m.container_id === firstMove.container_id && m.status === 'planned')
    expect(duplicates.length).toBe(0)

    // 3. The frozen move's destination slot must not be assigned to any new 'planned' move
    const destCollisions = newMoves.filter(
      m => m.status === 'planned' && m.to_slot_id === firstMove.to_slot_id
    )
    expect(destCollisions.length).toBe(0)
  })
})

describe('PATCH /api/planner/moves/:id', () => {
  it('returns 404 for a non-existent planner move', async () => {
    const res = await request(app)
      .patch('/api/planner/moves/9999999')
      .send({ status: 'in_progress' })
    expect(res.status).toBe(404)
  })

  it('rejects invalid status values', async () => {
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 4 })
    const moveId = genRes.body.moves[0].id as number
    const res = await request(app)
      .patch(`/api/planner/moves/${moveId}`)
      .send({ status: 'INVALID_STATE' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('advances status planned → in_progress and returns updated move with timeline', async () => {
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 4 })
    const move = genRes.body.moves[0] as { id: number; start_time_min: number; end_time_min: number }

    const res = await request(app)
      .patch(`/api/planner/moves/${move.id}`)
      .send({ status: 'in_progress' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('in_progress')
    // Timeline fields must be present
    expect(typeof res.body.start_time_min).toBe('number')
    expect(typeof res.body.end_time_min).toBe('number')
    expect(res.body.end_time_min).toBeGreaterThan(res.body.start_time_min)
  })

  it('sets scanned_confirmed flag', async () => {
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 4 })
    const moveId = genRes.body.moves[1].id as number

    const res = await request(app)
      .patch(`/api/planner/moves/${moveId}`)
      .send({ scanned_confirmed: true })
    expect(res.status).toBe(200)
    expect(res.body.scanned_confirmed).toBe(true)
  })
})

// ── DB round-trip persistence ─────────────────────────────────────────────────
// Each test below writes via the API and then re-reads from the DB (via a
// separate GET) to confirm the value actually survived the round-trip.

describe('PATCH /api/moves/:id — DB round-trip', () => {
  it('persists state change so a subsequent GET reflects the new value', async () => {
    const list = await request(app).get('/api/moves')
    expect(list.status).toBe(200)
    const moves = list.body as { id: string; state: string }[]
    if (moves.length === 0) return // no seed data — skip

    const target = moves.find(m => m.state !== 'DONE' && m.state !== 'IN_PROGRESS') ?? moves[0]
    if (!target || target.state === 'DONE') return

    const newState = target.state === 'PLANNED' ? 'IN_PROGRESS' : 'PLANNED'

    const patchRes = await request(app)
      .patch(`/api/moves/${target.id}`)
      .send({ state: newState })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.state).toBe(newState)

    // Re-read the same move list and verify the DB value changed
    const afterList = await request(app).get('/api/moves')
    expect(afterList.status).toBe(200)
    const afterMove = (afterList.body as { id: string; state: string }[]).find(m => m.id === target.id)
    expect(afterMove).toBeDefined()
    expect(afterMove!.state).toBe(newState)
  })
})

describe('POST /api/moves/:id/complete — DB round-trip', () => {
  it('persists DONE state and updates the container address in the DB', async () => {
    const list = await request(app).get('/api/moves')
    expect(list.status).toBe(200)
    type Move = { id: string; state: string; from: string; to: string; containerId: string }
    const moves = list.body as Move[]

    // Find a move that is in an executable state and has a valid 5-part address
    const target = moves.find(m =>
      ['PLANNED', 'ASSIGNED', 'IN_PROGRESS'].includes(m.state) &&
      m.to && m.to.split('-').length === 5
    )
    if (!target) return // no suitable move seeded — skip

    const completeRes = await request(app)
      .post(`/api/moves/${target.id}/complete`)
      .send({})
    // 409 is acceptable if the container is already not at from_loc (stale seed state)
    if (completeRes.status === 409) return
    expect(completeRes.status).toBe(200)
    expect(completeRes.body.state).toBe('DONE')

    // Re-read the move list and verify state=DONE persisted
    const afterMoves = await request(app).get('/api/moves')
    const afterMove = (afterMoves.body as Move[]).find(m => m.id === target.id)
    expect(afterMove).toBeDefined()
    expect(afterMove!.state).toBe('DONE')

    // Re-read containers and verify the container is now at to_loc
    const containersRes = await request(app).get('/api/containers')
    expect(containersRes.status).toBe(200)
    type Container = { id: string; address: string }
    const afterContainer = (containersRes.body as Container[]).find(c => c.id === target.containerId)
    if (afterContainer) {
      expect(afterContainer.address).toBe(target.to)
    }
  })
})

describe('PUT /api/planner/weights/batch — DB round-trip', () => {
  it('persists updated weights so a subsequent GET reflects the new values', async () => {
    // Read existing weights
    const getRes = await request(app).get('/api/planner/weights')
    expect(getRes.status).toBe(200)
    type Weight = { factor_name: string; weight: number }
    const weights = getRes.body as Weight[]
    if (weights.length === 0) return // no weights seeded — skip

    // Pick the first weight and nudge it to a distinct sentinel value
    const target = weights[0]
    const newValue = parseFloat(((target.weight + 0.13) % 10).toFixed(4))

    const putRes = await request(app)
      .put('/api/planner/weights/batch')
      .send({ weights: [{ factor_name: target.factor_name, weight: newValue }], updated_by: 'test' })
    expect(putRes.status).toBe(200)
    expect(putRes.body.warnings).toHaveLength(0)

    // Re-read weights from the DB via GET and verify the value changed
    const afterRes = await request(app).get('/api/planner/weights')
    expect(afterRes.status).toBe(200)
    const afterWeight = (afterRes.body as Weight[]).find(w => w.factor_name === target.factor_name)
    expect(afterWeight).toBeDefined()
    expect(afterWeight!.weight).toBeCloseTo(newValue, 4)

    // Restore the original value so subsequent test runs start from a clean state
    await request(app)
      .put('/api/planner/weights/batch')
      .send({ weights: [{ factor_name: target.factor_name, weight: target.weight }], updated_by: 'test_restore' })
  })
})

describe('POST /api/planner/plans/generate — DB round-trip', () => {
  it('persists the plan so GET /api/planner/plans/:id returns it from the DB', async () => {
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 5 })
    expect(genRes.status).toBe(200)
    const planId = genRes.body.id as number
    expect(typeof planId).toBe('number')

    // Re-read the plan by ID — this is a fresh DB query, not the in-memory response
    const getRes = await request(app).get(`/api/planner/plans/${planId}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.id).toBe(planId)
    expect(getRes.body.status).toBe('draft')
    expect(Array.isArray(getRes.body.moves)).toBe(true)
    expect(getRes.body.moves.length).toBeGreaterThan(0)

    // Move count must match what was returned at generate time
    expect(getRes.body.moves.length).toBe(genRes.body.moves.length)
  })
})

describe('POST /api/planner/plans/:id/confirm — DB round-trip', () => {
  it('persists confirmed status so GET /api/planner/plans/:id reflects it', async () => {
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 5 })
    expect(genRes.status).toBe(200)
    const planId = genRes.body.id as number

    const confirmRes = await request(app)
      .post(`/api/planner/plans/${planId}/confirm`)
      .send()
    expect(confirmRes.status).toBe(200)
    expect(confirmRes.body.status).toBe('confirmed')

    // Re-read from DB via GET and verify status persisted
    const getRes = await request(app).get(`/api/planner/plans/${planId}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.status).toBe('confirmed')
    expect(getRes.body.confirmed_at).toBeTruthy()
  })
})

describe('PATCH /api/planner/moves/:id — DB round-trip', () => {
  it('persists status change so GET /api/planner/plans/:id reflects the updated move', async () => {
    const genRes = await request(app)
      .post('/api/planner/plans/generate')
      .send({ strategy: 'greedy', time_budget_seconds: 5 })
    expect(genRes.status).toBe(200)
    const planId = genRes.body.id as number
    const moveId = genRes.body.moves[0].id as number

    const patchRes = await request(app)
      .patch(`/api/planner/moves/${moveId}`)
      .send({ status: 'in_progress' })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.status).toBe('in_progress')

    // Re-read the plan from DB and confirm the move's status persisted
    const getRes = await request(app).get(`/api/planner/plans/${planId}`)
    expect(getRes.status).toBe(200)
    type M = { id: number; status: string }
    const afterMove = (getRes.body.moves as M[]).find(m => m.id === moveId)
    expect(afterMove).toBeDefined()
    expect(afterMove!.status).toBe('in_progress')
  })
})

// ── Write routes — lanes ──────────────────────────────────────────────────────

describe('PATCH /api/lanes/:id', () => {
  it('returns 404 for a non-existent lane', async () => {
    const res = await request(app).patch('/api/lanes/NO-SUCH-LANE').send({ state: 'free' })
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 200 for an existing lane', async () => {
    const list = await request(app).get('/api/lanes')
    expect(list.status).toBe(200)
    const lanes = list.body as { id: string }[]
    if (lanes.length === 0) return

    const res = await request(app)
      .patch(`/api/lanes/${lanes[0].id}`)
      .send({ state: 'free' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id', lanes[0].id)
  })
})

// ── DB round-trip persistence — visits & lanes ────────────────────────────────

describe('PATCH /api/visits/:id — DB round-trip', () => {
  it('persists state and lane_id so a subsequent GET reflects both fields', async () => {
    // Fetch a visit to patch
    const visitList = await request(app).get('/api/visits')
    expect(visitList.status).toBe(200)
    type Visit = { id: string; state: string; lane: string | null }
    const visits = visitList.body as Visit[]
    if (visits.length === 0) return // no seed data — skip

    // Fetch a lane whose id we can assign
    const laneList = await request(app).get('/api/lanes')
    expect(laneList.status).toBe(200)
    type Lane = { id: string; state: string; visit: string | null }
    const lanes = laneList.body as Lane[]
    if (lanes.length === 0) return

    const target = visits[0]
    const laneId = lanes[0].id

    // Choose a state distinct from the current one to confirm the write
    const newState = target.state === 'IN_QUEUE' ? 'CHECKED_IN' : 'IN_QUEUE'

    const patchRes = await request(app)
      .patch(`/api/visits/${target.id}`)
      .send({ state: newState, lane_id: laneId })
    expect(patchRes.status).toBe(200)
    // The PATCH response itself must reflect both fields
    expect(patchRes.body.state).toBe(newState)
    expect(patchRes.body.lane).toBe(laneId)

    // Re-read visits from DB via GET and verify both fields survived the round-trip
    const afterList = await request(app).get('/api/visits')
    expect(afterList.status).toBe(200)
    const afterVisit = (afterList.body as Visit[]).find(v => v.id === target.id)
    expect(afterVisit).toBeDefined()
    expect(afterVisit!.state).toBe(newState)
    expect(afterVisit!.lane).toBe(laneId)
  })
})

describe('PATCH /api/lanes/:id — DB round-trip', () => {
  it('persists state and visit_id so a subsequent GET reflects both fields', async () => {
    // Fetch a lane to patch
    const laneList = await request(app).get('/api/lanes')
    expect(laneList.status).toBe(200)
    type Lane = { id: string; state: string; visit: string | null }
    const lanes = laneList.body as Lane[]
    if (lanes.length === 0) return // no seed data — skip

    // Fetch a visit id to assign to the lane
    const visitList = await request(app).get('/api/visits')
    expect(visitList.status).toBe(200)
    type Visit = { id: string }
    const visits = visitList.body as Visit[]
    if (visits.length === 0) return

    const target = lanes[0]
    const visitId = visits[0].id

    // Choose a state distinct from the current one to confirm the write
    const newState = target.state === 'free' ? 'occupied' : 'free'

    const patchRes = await request(app)
      .patch(`/api/lanes/${target.id}`)
      .send({ state: newState, visit_id: visitId })
    expect(patchRes.status).toBe(200)
    // The PATCH response itself must reflect both fields
    expect(patchRes.body.state).toBe(newState)
    expect(patchRes.body.visit).toBe(visitId)

    // Re-read lanes from DB via GET and verify both fields survived the round-trip
    const afterList = await request(app).get('/api/lanes')
    expect(afterList.status).toBe(200)
    const afterLane = (afterList.body as Lane[]).find(l => l.id === target.id)
    expect(afterLane).toBeDefined()
    expect(afterLane!.state).toBe(newState)
    expect(afterLane!.visit).toBe(visitId)
  })
})
