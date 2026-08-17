/**
 * server/index.ts — Entry point.
 * Imports the Express app from app.ts and binds to localhost only.
 * Port 8000 is not externally mapped in .replit; the API is reached
 * via the Vite dev proxy (/api → localhost:8000) in development and
 * served same-origin in production builds.
 *
 * Migrations are awaited BEFORE the server starts listening so that routes
 * never receive traffic with missing columns.
 */
import { app } from './app.js'
import { runMigrations } from './migrate.js'

const PORT = Number(process.env.PORT) || 8000

runMigrations()
  .then(() => {
    app.listen(PORT, '127.0.0.1', () =>
      console.log(`YardOS API on 127.0.0.1:${PORT} (loopback only)`)
    )
  })
  .catch(err => {
    console.error('[startup] Migration failed — refusing to start:', err)
    process.exit(1)
  })
