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
