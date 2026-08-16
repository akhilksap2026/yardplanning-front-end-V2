/**
 * reference-pools.ts
 * Single canonical source for shared lookup tables used by both the container
 * generator (yard-data.ts) and the story / context seeds (story-seed.ts,
 * context-seed.ts).  No other module should define its own CARRIERS or
 * CONSIGNEES list — import from here instead.
 *
 * Vessels are out of scope for this app and are intentionally omitted.
 */

// ── Carrier detention schedule ────────────────────────────────────────────────

export interface Carrier {
  code:     string;
  name:     string;
  freeDays: number;
  basis:    "calendar" | "working";
  /** [dayFrom, dayTo, usdPerDay] */
  tiers:    [number, number, number][];
}

export const CARRIERS: Carrier[] = [
  { code: "MSCU", name: "MSC",          freeDays: 7,  basis: "calendar", tiers: [[8,14,45],[15,21,90],[22,99,150]] },
  { code: "MAEU", name: "Maersk",       freeDays: 10, basis: "working",  tiers: [[11,17,40],[18,24,85],[25,99,140]] },
  { code: "CMAU", name: "CMA CGM",      freeDays: 7,  basis: "calendar", tiers: [[8,14,50],[15,21,95],[22,99,160]] },
  { code: "HLXU", name: "Hapag-Lloyd",  freeDays: 5,  basis: "calendar", tiers: [[6,12,55],[13,20,100],[21,99,165]] },
  { code: "COSU", name: "COSCO",        freeDays: 14, basis: "calendar", tiers: [[15,21,38],[22,28,80],[29,99,135]] },
  { code: "OOLU", name: "OOCL",         freeDays: 7,  basis: "calendar", tiers: [[8,14,48],[15,21,92],[22,99,155]] },
  { code: "EGLV", name: "Evergreen",    freeDays: 7,  basis: "calendar", tiers: [[8,14,46],[15,21,91],[22,99,152]] },
  { code: "YMLU", name: "Yang Ming",    freeDays: 7,  basis: "calendar", tiers: [[8,14,47],[15,21,93],[22,99,158]] },
  { code: "ONEU", name: "ONE",          freeDays: 7,  basis: "calendar", tiers: [[8,14,45],[15,21,90],[22,99,150]] },
  { code: "HMMU", name: "HMM",          freeDays: 7,  basis: "calendar", tiers: [[8,14,44],[15,21,89],[22,99,148]] },
];

// ── Road carriers / truckers ──────────────────────────────────────────────────

export interface Trucker {
  scac:        string;
  name:        string;
  region:      string;
  onTimeRate?: number; // percentage, if tracked
}

/** SCAC1/2/3 are the story-shift truckers with on-time rates; RIVA/LAND/DSUR are
 *  the legacy context-yard truckers.  All six are canonical. */
export const TRUCKERS: Trucker[] = [
  { scac: "SCAC1", name: "Seaboard Cartage Co.",  region: "Buenos Aires Metro", onTimeRate: 94 },
  { scac: "SCAC2", name: "Summit Container Lines", region: "Buenos Aires Metro", onTimeRate: 88 },
  { scac: "SCAC3", name: "Sierra Drayage Group",   region: "Gran Buenos Aires",  onTimeRate: 91 },
  { scac: "RIVA",  name: "Transportes Rivas",      region: "Buenos Aires Metro" },
  { scac: "LAND",  name: "Log. Andina",             region: "Buenos Aires Metro" },
  { scac: "DSUR",  name: "Drayage Sur",             region: "Gran Buenos Aires"  },
];

// ── Consignees ────────────────────────────────────────────────────────────────
// Exact strings already in yard-data.ts — kept in sync here as the sole source.

export const CONSIGNEES: string[] = [
  "Autopartes del Sur SA",
  "Bosch Argentina",
  "Denso Sudamérica",
  "Magna Rosario",
  "Valeo BA",
  "ZF Pilar",
  "Continental Arg.",
];

// ── Priority and channel pools (used by generator) ───────────────────────────

export const PRIORITIES = ["P1","P2","P2","P3","P3","P4"] as const;
export const CHANNELS   = ["road","road","road","sea","rail"] as const;

// ── ID helpers ────────────────────────────────────────────────────────────────

/** "CB######" — 6-digit zero-padded yard-owned chassis ID  (e.g. chassisId(211111) → "CB211111") */
export function chassisId(n: number): string {
  return "CB" + String(n).padStart(6, "0");
}

/** "CHA####" — 4-digit zero-padded chassis home-row address (e.g. chaRow(101) → "CHA0101") */
export function chaRow(n: number): string {
  return "CHA" + String(n).padStart(4, "0");
}

/** "P-###" — 3-digit zero-padded plan code (e.g. planCode(100) → "P-100") */
export function planCode(n: number): string {
  return "P-" + String(n).padStart(3, "0");
}

/** SCAC (4 chars) + 7-digit zero-padded sequence  (e.g. containerId("EITU", 3333307) → "EITU3333307") */
export function containerId(scac: string, seq: number): string {
  return scac + String(seq).padStart(7, "0");
}
