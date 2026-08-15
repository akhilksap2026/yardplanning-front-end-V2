/**
 * Shared time-formatting utilities.
 *
 * All functions that produce "HH:MM" output use UTC so that values
 * stay consistent regardless of the browser's local timezone. Seed
 * data stored as "HH:MM" strings is treated as already-formatted
 * and returned as-is.
 */

/**
 * fmtTime — universal "HH:MM" formatter.
 *
 * Accepts:
 *  - number  : minutes since midnight  (e.g. 870 → "14:30")
 *  - "HH:MM" : already-formatted string (returned as-is)
 *  - ISO string: any Date-parseable string, rendered in UTC ("2026-08-14 05:38:13+00" → "05:38")
 *  - Date    : rendered in UTC
 *  - null / undefined → "—"
 */
export function fmtTime(
  input: string | number | Date | null | undefined,
): string {
  if (input == null) return "—"

  // ── number: minutes since midnight ──────────────────────────────────────
  if (typeof input === "number") {
    const abs = Math.abs(input)
    const h   = Math.floor(abs / 60)
    const m   = abs % 60
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0")
  }

  // ── Date object ──────────────────────────────────────────────────────────
  if (input instanceof Date) {
    return input.toISOString().slice(11, 16)
  }

  // ── string ───────────────────────────────────────────────────────────────
  if (input === "—") return "—"

  // "HH:MM" — already formatted, pass through unchanged
  if (/^\d{2}:\d{2}$/.test(input)) return input

  // ISO timestamp (Postgres "YYYY-MM-DD HH:mm:ss.ffffff+00" or "…Z") → UTC HH:MM
  try {
    const iso = new Date(input).toISOString()
    return iso.slice(11, 16)
  } catch {
    return "—"
  }
}

/**
 * fmtTimestamp — "HH:MM:SS" for audit logs and detailed views.
 *
 * Input: ISO timestamp string or null.
 * Output: UTC "HH:MM:SS" (e.g. "05:38:13")
 */
export function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toISOString().slice(11, 19)
  } catch {
    return "—"
  }
}

/**
 * fmtDuration — human-readable elapsed/planned duration.
 *
 * < 60 min → "X′"
 * ≥ 60 min → "Xh Ym" (drops "0m" when there are no leftover minutes)
 */
export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}′`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
