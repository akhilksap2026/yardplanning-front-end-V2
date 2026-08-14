/**
 * server/index.ts — Entry point.
 * Imports the Express app from app.ts and binds to localhost only.
 * Port 8000 is not externally mapped in .replit; the API is reached
 * via the Vite dev proxy (/api → localhost:8000) in development and
 * served same-origin in production builds.
 */
import { app } from './app.js'

const PORT = Number(process.env.PORT) || 8000
app.listen(PORT, '127.0.0.1', () =>
  console.log(`YardOS API on 127.0.0.1:${PORT} (loopback only)`)
)
