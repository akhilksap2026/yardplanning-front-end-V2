/**
 * server/migrate.ts — Idempotent schema migrations.
 * Called from server/app.ts on every startup before routes are registered.
 * Every statement must be safe to run multiple times (ADD COLUMN IF NOT EXISTS, etc.).
 */
import { pool } from './db.js'

export async function runMigrations(): Promise<void> {
  const client = await pool.connect()
  try {
    // Task #7 — greedy solver: add per-move timeline columns
    await client.query(`
      ALTER TABLE planner_moves
        ADD COLUMN IF NOT EXISTS start_time_min NUMERIC(7,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS end_time_min   NUMERIC(7,2) NOT NULL DEFAULT 0
    `)
    console.log('[migrate] planner_moves timeline columns: ok')

    // Task #8 — LLM narration: add narration column to planner_plans
    await client.query(`
      ALTER TABLE planner_plans
        ADD COLUMN IF NOT EXISTS narration TEXT
    `)
    console.log('[migrate] planner_plans.narration column: ok')
  } catch (err) {
    console.error('[migrate] migration failed — server will not start:', err)
    throw err
  } finally {
    client.release()
  }
}
