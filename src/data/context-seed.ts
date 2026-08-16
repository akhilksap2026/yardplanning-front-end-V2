/**
 * context-seed.ts
 * Medium-context module — fills the yard to realistic production scale.
 * All records carry `story: false` so they blend into background operations.
 * Generated deterministically from a seeded PRNG; output is stable across reloads.
 *
 * Nothing imports this file yet — Step 4 will merge it into the live exports.
 */

import type { Container } from "./yard-data";
import { CARRIERS, CONSIGNEES, TRUCKERS, chassisId, chaRow, containerId, planCode } from "./reference-pools";

// ── Seeded PRNG (seed differs from yard-data.ts 0x5f3a91 to avoid correlation) ──
const rnd = (() => {
  let s = 0xc4d3e2;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
})();

const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int  = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pad  = (n: number, w: number) => String(n).padStart(w, "0");
const hhmm = (m: number) => pad(Math.floor(m / 60), 2) + ":" + pad(m % 60, 2);
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// ── Zone metadata ───────────────────────────────────────────────────────────────
const ZONE_META = [
  { id:"A", blocks:6, rows:3, slots:10, maxTiers:4 },
  { id:"B", blocks:6, rows:3, slots:10, maxTiers:4 },
  { id:"C", blocks:4, rows:2, slots:8,  maxTiers:3 },
  { id:"D", blocks:2, rows:2, slots:6,  maxTiers:2 },
  { id:"E", blocks:4, rows:3, slots:10, maxTiers:4 },
  { id:"F", blocks:2, rows:2, slots:8,  maxTiers:3 },
  { id:"Q", blocks:1, rows:1, slots:6,  maxTiers:2 },
  { id:"S", blocks:1, rows:1, slots:10, maxTiers:1 },
  { id:"R", blocks:1, rows:1, slots:12, maxTiers:1 },
] as const;

// Weighted: A/B/E heavy, D/F/Q/S/R light
const ZONE_POOL = [
  "A","A","A","A","B","B","B","B","C","C","C",
  "D","D","E","E","E","E","E","F","F","F",
  "Q","Q","S","R",
] as const;

const STATUSES_POOL  = ["IN_YARD","IN_YARD","IN_YARD","STAGED","AT_RECEIVING_LANE","CUSTOMS_CONTROLLED"] as const;
const CHANNELS_POOL  = ["road","road","road","sea","rail"] as const;
const PRIORITIES_POOL = ["P1","P2","P2","P3","P3","P4"] as const;
const IMDG_POOL      = ["3","8","9","5.1","6.1"] as const;
const SIZES_POOL     = ["20GP","40GP","40GP","40HC","40HC"] as const;

const SEAL_PFX: Record<string, string> = {
  MSCU:"MSC", MAEU:"MAE", CMAU:"CMA", HLXU:"HL",
  COSU:"COS", OOLU:"OOC", EGLV:"EGL", YMLU:"YML",
  ONEU:"ONE", HMMU:"HMM",
};

type CSize = "20GP" | "40GP" | "40HC";
const ISO_OF: Record<CSize, string>          = { "20GP":"22G1","40GP":"42G1","40HC":"45G1" };
const TARE_OF: Record<CSize, [number,number]> = { "20GP":[2100,2400],"40GP":[3500,3900],"40HC":[3750,4100] };

const WHY: Record<string, string[]> = {
  A: [
    "LFD in {h} h — pre-positioned for retrieval without a dig-out.",
    "Block balanced at 78%: spread from Zone B to stay under 85% ceiling.",
    "Ground tier in Zone A: 30 t exceeds RS46 capacity chart above tier 2.",
    "Slot scores 91 — zero predicted rehandles to LFD, 135 m travel.",
  ],
  B: [
    "Zone B density stack: LFD in {h} h, kept clear of short-dwell units.",
    "Pre-marshal in idle window 11:20–11:50 — removes two afternoon rehandles.",
    "Dig-out avoided: overstow resolved at 11:40 using RS-02.",
    "Slot scores 88, 120 m travel, zero rehandles predicted.",
  ],
  C: [
    "Customs hold: ARCA orange channel — inspection bay booked 10:00.",
    "LFD in {h} h; held in customs zone pending DGA clearance.",
    "AFIP/ARCA Licencia No Automática (LNA) approval awaited — DUA on file.",
    "Sea channel selectivity check required before release to road.",
  ],
  D: [
    "IMDG class {c}: only Zone D satisfies the segregation matrix.",
    "Hazmat segregation: mandatory 3-slot buffer from non-IMDG stock maintained.",
    "DG manifest filed; Zone D pre-allocated per IMDG plan for the shift.",
  ],
  E: [
    "Empty depot: return window 07:00–15:00 confirmed.",
    "Empty unit awaiting repositioning — slot cleared of active-traffic pressure.",
    "Shippers order for empty restitution on file; scheduled for 09:00 pick-up.",
    "Idle empty: standby for reuse on next outbound booking.",
  ],
  F: [
    "Reefer zone: −18 °C cold-chain maintained since gate-in.",
    "Temperature-sensitive cargo — plug-in bay required per shipper spec.",
    "Reefer: LFD in {h} h; pre-positioned for earliest retrieval window.",
  ],
  Q: [
    "Quarantine hold: M&R inspection pending — cleared from active traffic.",
    "Structural inspection sign-off required before the unit is released.",
    "Damage hold: door seal damage noted at gate-in; surveyor booked for 10:00.",
  ],
  S: [
    "Outbound staging: truck appointment in {h} h — turn-time protected.",
    "Staged for hook-and-haul; driver appointment confirmed via WhatsApp.",
  ],
  R: [
    "At receiving lane R-{s}: EIR verified, putaway assignment pending.",
    "Receiving lane: gate-in in progress — tare weight being confirmed.",
  ],
};

// ── CONTEXT_CONTAINERS (~145) ───────────────────────────────────────────────────

let _cseq = 0;

export const CONTEXT_CONTAINERS: Container[] = Array.from({ length: 145 }, () => {
  _cseq++;
  const zId = pick(ZONE_POOL);
  const zm  = ZONE_META.find(z => z.id === zId)!;
  const blk = int(1, zm.blocks);
  const row = int(1, zm.rows);
  const slt = int(1, zm.slots);
  const tier = (zId === "S" || zId === "R") ? 1 : int(1, zm.maxTiers);
  const address = `${zId}-${pad(blk, 2)}-${row}-${slt}-${tier}`;

  const carrier   = pick(CARRIERS);
  const empty     = zId === "E";
  const sz        = pick(SIZES_POOL) as CSize;
  const isoType   = ISO_OF[sz];
  const [tLo,tHi] = TARE_OF[sz];
  const tareKg    = int(tLo, tHi);
  const grossKg   = empty ? int(2200, 3900) : int(9800, 30400);
  const consignee = empty ? "—" : pick(CONSIGNEES);
  const imdg      = zId === "D" ? pick(IMDG_POOL) : null;
  const hazmat    = zId === "D";
  const channel   = zId === "C" ? pick(["sea","rail"] as const)
                  : empty ? "—"
                  : pick(CHANNELS_POOL);
  const status    = empty ? "IN_YARD" : pick(STATUSES_POOL);
  const lfd       = empty ? int(4, 60) : int(-20, 180);
  const dwell     = int(1, 28);
  const priority  = pick(PRIORITIES_POOL);
  const seal      = (SEAL_PFX[carrier.code] ?? "AR") + "-" + pad(int(100000, 999999), 6);

  const tpls = WHY[zId] ?? WHY["A"];
  const why  = pick(tpls)
    .replace("{h}", String(Math.max(0, lfd)))
    .replace("{c}", imdg ?? "3")
    .replace("{s}", String(int(1, 10)));

  return {
    id: containerId(carrier.code, 1_000_000 + _cseq),
    zone: zId, block: blk, row, slot: slt, tier, address,
    size: sz, grossKg, carrier: carrier.code, carrierName: carrier.name,
    consignee, vessel: "", terminal: "",
    hazmat, imdg, channel, status,
    hoursToLFD: lfd, dwellDays: dwell, priority, empty,
    whyHere: why, seal,
    isoType, tareKg, ageDays: dwell, story: false,
    ...(zId === "F" ? { reefer: true, tempSetPoint: "-18°C" } : {}),
    ...(zId === "Q" && rnd() < 0.5 ? { damageCode: "DO-R-BT-ST", hold: "damage" as const } : {}),
    ...(zId === "C" && rnd() < 0.4 ? { hold: "customs" as const } : {}),
    ...(!empty && rnd() < 0.04 ? { highValue: true } : {}),
  } as Container;
});

// ── CONTEXT_CHASSIS (~47) ───────────────────────────────────────────────────────
// IDs CB300001–CB300047; home rows CHA0103–CHA0108 (beyond story's CHA0101/0102)

export interface ContextChassis {
  id:              string;
  spec:            string;
  homeRow:         string;
  ownedBy:         string;
  status:          "available" | "in_use" | "returned";
  currentLocation: string | null;
  story:           false;
}

const CHASSIS_SPECS   = ["40ft standard","40ft standard","40ft gooseneck","20ft standard","40ft flatbed"] as const;
const CHASSIS_HOME    = ["CHA0103","CHA0103","CHA0104","CHA0104","CHA0105","CHA0106","CHA0107","CHA0108"] as const;
const CHASSIS_OWNERS  = ["yard","yard","yard","yard","SCAC1","SCAC2","SCAC3","RIVA","LAND","DSUR"] as const;
const CHASSIS_ST_POOL = ["available","available","available","in_use","returned","returned"] as const;
const YARD_LOCS       = ["RA0101","RA0102","RA0103","STG0201","STG0202","STG0203","DB0101","DB0201","CHA0103"] as const;

export const CONTEXT_CHASSIS: ContextChassis[] = Array.from({ length: 47 }, (_, i) => {
  const home   = pick(CHASSIS_HOME);
  const owner  = pick(CHASSIS_OWNERS);
  const status = pick(CHASSIS_ST_POOL);
  return {
    id:              chassisId(300001 + i),
    spec:            pick(CHASSIS_SPECS),
    homeRow:         home,
    ownedBy:         owner,
    status,
    currentLocation: status === "in_use" ? pick(YARD_LOCS) : home,
    story:           false,
  };
});

// ── CONTEXT_OPERATORS (~9) ──────────────────────────────────────────────────────
// Brings the total roster to 12 with Justin / James / Mike from story-seed.

export interface ContextOperator {
  id:        string;
  name:      string;
  equipment: string;
  certs:     string[];
  shift:     string;
  status:    string;
  story:     false;
}

export const CONTEXT_OPERATORS: ContextOperator[] = [
  { id:"OP-501", name:"C. Ortega",    equipment:"RS-01", certs:["RS","IMDG"], shift:"06:00–14:00", status:"on shift",  story:false },
  { id:"OP-502", name:"M. González",  equipment:"RS-02", certs:["RS"],        shift:"06:00–14:00", status:"on shift",  story:false },
  { id:"OP-503", name:"P. Fernández", equipment:"RS-03", certs:["RS"],        shift:"06:00–14:00", status:"on shift",  story:false },
  { id:"OP-504", name:"L. Martínez",  equipment:"EH-01", certs:["EH"],        shift:"06:00–14:00", status:"on shift",  story:false },
  { id:"OP-505", name:"J. López",     equipment:"TT-01", certs:["TT"],        shift:"14:00–22:00", status:"off shift", story:false },
  { id:"OP-506", name:"C. Ramírez",   equipment:"RS-01", certs:["RS","IMDG"], shift:"14:00–22:00", status:"off shift", story:false },
  { id:"OP-507", name:"R. Silva",     equipment:"RS-02", certs:["RS"],        shift:"22:00–06:00", status:"off shift", story:false },
  { id:"OP-508", name:"A. Torres",    equipment:"EH-01", certs:["EH"],        shift:"22:00–06:00", status:"off shift", story:false },
  { id:"OP-509", name:"D. Morales",   equipment:"TT-02", certs:["TT"],        shift:"06:00–14:00", status:"on shift",  story:false },
];

// ── CONTEXT_PLANS (~13) — P-600..P-612 ─────────────────────────────────────────
// Brings the plan total to 18 with the 5 story plans.

export type ContextPlanStatus = "draft" | "confirmed" | "completed" | "in_progress";

export interface ContextPlan {
  code:      string;
  title:     string;
  status:    ContextPlanStatus;
  startTime: string;
  endTime:   string;
  startMin:  number;
  endMin:    number;
  crew:      string[];
  story:     false;
}

export const CONTEXT_PLANS: ContextPlan[] = [
  {
    code:"P-600", title:"Premarshal Zone A block 3 — morning density balance",
    status:"completed", startTime:"06:10", endTime:"06:48",
    startMin:mins("06:10"), endMin:mins("06:48"),
    crew:["C. Ortega","M. González"], story:false,
  },
  {
    code:"P-601", title:"Digout Zone B — MAEU expiry batch (4 units)",
    status:"completed", startTime:"06:45", endTime:"07:12",
    startMin:mins("06:45"), endMin:mins("07:12"),
    crew:["P. Fernández","L. Martínez"], story:false,
  },
  {
    code:"P-602", title:"Stage outbound batch 1 — HLXU × 3, CMAU × 1",
    status:"completed", startTime:"07:00", endTime:"07:28",
    startMin:mins("07:00"), endMin:mins("07:28"),
    crew:["C. Ortega","D. Morales"], story:false,
  },
  {
    code:"P-603", title:"Putaway inbound wave 1 — 6 units",
    status:"completed", startTime:"07:20", endTime:"08:05",
    startMin:mins("07:20"), endMin:mins("08:05"),
    crew:["M. González","P. Fernández","L. Martínez"], story:false,
  },
  {
    code:"P-604", title:"Rehandle Zone C customs release — COSCO × 2",
    status:"completed", startTime:"07:50", endTime:"08:18",
    startMin:mins("07:50"), endMin:mins("08:18"),
    crew:["C. Ortega","M. González"], story:false,
  },
  {
    code:"P-605", title:"Stage outbound batch 2 — MAEU × 2, YMLU × 1",
    status:"confirmed", startTime:"08:05", endTime:"08:26",
    startMin:mins("08:05"), endMin:mins("08:26"),
    crew:["D. Morales","L. Martínez"], story:false,
  },
  {
    code:"P-606", title:"Premarshal Zone B — afternoon slot pre-positioning",
    status:"confirmed", startTime:"08:30", endTime:"09:05",
    startMin:mins("08:30"), endMin:mins("09:05"),
    crew:["C. Ortega","M. González"], story:false,
  },
  {
    code:"P-607", title:"Putaway inbound wave 2 — 4 units including IMDG",
    status:"in_progress", startTime:"09:00", endTime:"09:44",
    startMin:mins("09:00"), endMin:mins("09:44"),
    crew:["M. González","P. Fernández","C. Ramírez"], story:false,
  },
  {
    code:"P-608", title:"IMDG retrieval Zone D — COSU × 2 expiry today",
    status:"confirmed", startTime:"09:30", endTime:"10:07",
    startMin:mins("09:30"), endMin:mins("10:07"),
    crew:["C. Ortega","D. Morales"], story:false,
  },
  {
    code:"P-609", title:"Empty handler cycle — Zone E density balance",
    status:"confirmed", startTime:"10:00", endTime:"10:48",
    startMin:mins("10:00"), endMin:mins("10:48"),
    crew:["L. Martínez"], story:false,
  },
  {
    code:"P-610", title:"Reefer check Zone F — plug-in and set-point verification",
    status:"confirmed", startTime:"10:30", endTime:"10:52",
    startMin:mins("10:30"), endMin:mins("10:52"),
    crew:["P. Fernández"], story:false,
  },
  {
    code:"P-611", title:"Putaway inbound wave 3 — 5 units",
    status:"draft", startTime:"11:00", endTime:"11:52",
    startMin:mins("11:00"), endMin:mins("11:52"),
    crew:["M. González","P. Fernández","D. Morales"], story:false,
  },
  {
    code:"P-612", title:"Zone B afternoon premarshal — retrieval queue prep",
    status:"draft", startTime:"11:30", endTime:"12:22",
    startMin:mins("11:30"), endMin:mins("12:22"),
    crew:["C. Ortega","C. Ramírez"], story:false,
  },
];

// ── CONTEXT_EVENTS (~14) — EV-8001..EV-8014 ────────────────────────────────────
// Brings event total to 17 with the 3 story events.

export interface ContextEvent {
  id:       string;
  time:     string;
  type:     string;
  severity: string;
  state:    string;
  auto:     string;
  title:    string;
  detail:   string;
  diff: {
    cancelled:  number;
    added:      number;
    reassigned: number;
    frozenKept: number;
    deltaMin:   number;
    adherence:  number;
  };
  story: false;
}

export const CONTEXT_EVENTS: ContextEvent[] = [
  {
    id:"EV-8001", time:"06:12", type:"WEIGHT_VARIANCE",
    severity:"medium", state:"replanned", auto:"Manual",
    title:"MAEU1000012 — 2.3 t over tare on re-weigh",
    detail:"Tare discrepancy flagged by axle-scale at receiving lane R-03. Gross declared 24 200 kg; re-weigh returned 26 500 kg. Putaway slot changed from tier 3 to tier 1 (Zone B ground row). Carrier notified per SOLAS VGM protocol.",
    diff:{ cancelled:1, added:1, reassigned:0, frozenKept:3, deltaMin:8, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8002", time:"06:34", type:"EQUIPMENT_FAILURE",
    severity:"medium", state:"resolved", auto:"Partial",
    title:"RS-02 spreader fault — 8 moves redistributed, unit back in service",
    detail:"Reach stacker RS-02 reported a spreader locking fault at Zone B-03. Eight moves redistributed to RS-01 (5) and RS-03 (3) while maintenance cleared the locking pin. RS-02 returned to service at 07:19 — all redistributed moves absorbed without plan deviation.",
    diff:{ cancelled:0, added:1, reassigned:8, frozenKept:4, deltaMin:22, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8003", time:"06:51", type:"CUSTOMS_CHANNEL_ASSIGNED",
    severity:"high", state:"replanned", auto:"Auto",
    title:"CMAU1000031 assigned orange channel",
    detail:"ARCA selectivity returned orange for CMAU1000031. Container routed to inspection bay; reserved staging slot released and backfilled with the next LFD-critical unit. Dwell forecast extended 3.8 days, re-tiering slot assignment to deep-and-low in Zone C.",
    diff:{ cancelled:1, added:2, reassigned:1, frozenKept:0, deltaMin:9, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8004", time:"07:08", type:"SHIP_DELAY",
    severity:"medium", state:"suppressed", auto:"Auto",
    title:"Maersk SALINA V.238W ETA slipped 90 min",
    detail:"Terminal feed revised ETA from 08:00 to 09:30. Projected replan saving is 2.1 machine-minutes, below the 8-minute improvement threshold. Stability controller suppressed the replan; 14 frozen steps retained without change.",
    diff:{ cancelled:0, added:0, reassigned:0, frozenKept:14, deltaMin:2, adherence:0 },
    story:false,
  },
  {
    id:"EV-8005", time:"07:22", type:"DEPOT_REDIRECTION",
    severity:"medium", state:"replanned", auto:"Auto, notify",
    title:"HLXU empty redirected — Dock Sud to Pilar Interior",
    detail:"Hapag-Lloyd redirected the empty return from Exolgan Dock Sud to Pilar Interior, window 07:30–16:00. Empty-return sequence replanned; driver notified via WhatsApp. Depot appointment rebooked through the carrier portal.",
    diff:{ cancelled:1, added:1, reassigned:1, frozenKept:0, deltaMin:5, adherence:0 },
    story:false,
  },
  {
    id:"EV-8006", time:"07:35", type:"APPOINTMENT_NO_SHOW",
    severity:"low", state:"replanned", auto:"Auto",
    title:"V-2050 no-show at 07:15 window — RIVA carrier",
    detail:"Transportes Rivas did not report within the 15-minute tolerance window. Slot released to the 08:00 waitlist; carrier no-show rate updated to 7.1% over 30 days. Re-booking offered via automated notification.",
    diff:{ cancelled:1, added:0, reassigned:0, frozenKept:0, deltaMin:6, adherence:0 },
    story:false,
  },
  {
    id:"EV-8007", time:"07:52", type:"CONTAINER_NOT_FOUND",
    severity:"medium", state:"replanned", auto:"Manual",
    title:"COSU1000058 relocated — found at B-04-2-7-2",
    detail:"OP-502 initially reported B-04-2-9-2 empty. Guided search against Zone B located the container two rows forward at B-04-2-7-2. Map corrected; retrieval order reinstated and replanned for 09:10. No free-time impact.",
    diff:{ cancelled:0, added:1, reassigned:1, frozenKept:0, deltaMin:8, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8008", time:"08:10", type:"DETENTION_BREACH",
    severity:"medium", state:"replanned", auto:"Auto",
    title:"OOLU1000074 — last-free-day passed 3 h ago, retrieval in progress",
    detail:"OOCL Tier 2 rate active at $92/day; $276 accrued. Retrieval sequenced for 08:45 with staging slot S-01-1-6-1 reserved. Container moving now; empty-return window at Sur Empty Park is 08:00–17:00 — on track to close within shift.",
    diff:{ cancelled:0, added:1, reassigned:2, frozenKept:5, deltaMin:7, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8009", time:"08:28", type:"TERMINAL_DELAY",
    severity:"medium", state:"replanned", auto:"Auto",
    title:"TRP Terminal 5 berth congestion — 3 outbound units deferred",
    detail:"TRP Terminal 5 reported a 2-hour berth slot delay for the MSC LUCIA V.412E load-out window. Three outbound containers re-staged from S-zone to Zone B deep-storage to free staging lanes for the next inbound wave. Truck appointments rescheduled via the carrier portal.",
    diff:{ cancelled:3, added:3, reassigned:0, frozenKept:6, deltaMin:14, adherence:-2 },
    story:false,
  },
  {
    id:"EV-8010", time:"08:47", type:"INSPECTION_HOLD",
    severity:"medium", state:"replanned", auto:"Auto, notify",
    title:"YMLU1000081 — AFIP physical inspection requested",
    detail:"AFIP raised a physical inspection order on YMLU1000081 (auto-parts, DUA-2026-08-16-00882). Container moved to Zone C inspection bay; retrieval slot deferred 4 hours. Consignee Magna Rosario notified; AFIP verifier appointment confirmed for 11:00.",
    diff:{ cancelled:1, added:2, reassigned:1, frozenKept:0, deltaMin:11, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8011", time:"09:15", type:"EQUIPMENT_FAILURE",
    severity:"medium", state:"replanned", auto:"Partial",
    title:"TT-01 tyre burst — terminal tractor offline 30 min",
    detail:"TT-01 (Terberg YT223) suffered a right-rear tyre burst at Zone S-01. Two outbound hook-and-haul tasks reassigned to RS-01 with a travel-time penalty of 4 min per move. Tyre change in progress; return-to-service estimate 09:45.",
    diff:{ cancelled:0, added:0, reassigned:2, frozenKept:3, deltaMin:8, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8012", time:"09:44", type:"CUSTOMS_CHANNEL_ASSIGNED",
    severity:"medium", state:"replanned", auto:"Auto",
    title:"YMLU1000093 assigned red channel — DGA verifier confirmed for 12:00",
    detail:"ARCA returned red selectivity for YMLU1000093 (chemical precursors). Container moved to Zone D hazmat row; DGA armed verifier appointment confirmed for 12:00. Dwell extended; plan adjusted without disrupting other sequences.",
    diff:{ cancelled:1, added:2, reassigned:1, frozenKept:0, deltaMin:15, adherence:-1 },
    story:false,
  },
  {
    id:"EV-8013", time:"10:22", type:"SHIP_DELAY",
    severity:"low", state:"replanned", auto:"Auto",
    title:"CMA CGM ANDES V.117N — second ETA revision +60 min",
    detail:"CMA CGM revised the arrival window for a second time; new ETA 13:45. Two pre-staged outbound units returned to Zone B to free staging capacity. Putaway sequence adjusted; affected inbound cutover moved to the 14:00 window.",
    diff:{ cancelled:2, added:2, reassigned:0, frozenKept:8, deltaMin:18, adherence:-2 },
    story:false,
  },
  {
    id:"EV-8014", time:"11:05", type:"AUDIT_DISCREPANCY",
    severity:"medium", state:"awaiting", auto:"Manual",
    title:"Cycle-count mismatch — 4 units in Zone A block 5",
    detail:"Periodic cycle-count YA-314 for Zone A block 5 returned 4 positions unmatched against the WMS map. Guided search issued to OP-503 with ranked candidates. Linked retrieval orders held pending map reconciliation. Yard manager acknowledge required.",
    diff:{ cancelled:4, added:2, reassigned:0, frozenKept:0, deltaMin:0, adherence:-4 },
    story:false,
  },
];

// ── CONTEXT_GATE_ROWS (~42 rows) ─────────────────────────────────────────────────
// Fully populated rows compatible with GateContainerRow + story flag.
// 22 inbound + 20 outbound = 42 rows.
// Combined with 3 story gate txns → ~45 total gate records.

export interface ContextGateRow {
  containerId:     string;
  scac:            string;
  size:            string;
  consignee:       string;
  carrierName:     string;
  truckerScac:     string;
  trucker:         string;
  driver:          string;
  plate:           string;
  channel:         "road" | "sea" | "rail";
  appt:            string;
  gateStatus:      "GATE_OUT" | "SERVED" | "AT_POSITION" | "CHECKED_IN" | "IN_QUEUE" | "APPROACHING" | "EXPECTED";
  hoursToLFD:      number;
  hold:            "customs" | "quality" | "damage" | null;
  excl:            string | null;
  grossKg:         number;
  isoType:         string;
  sealNumber:      string;
  freeDays?:       number;
  detentionBasis?: string;
  story:           false;
  direction:       "inbound" | "outbound";
}

// Gate pools
const GATE_SIZE_POOL  = ["20ft","40ft","40ft","40ft HC","40ft HC"] as const;
const GATE_ISO: Record<string,string> = {
  "20ft":"22G1","40ft":"42G1","40ft HC":"45G1",
};
const GATE_KG: Record<string,[number,number]> = {
  "20ft":[11000,19000],"40ft":[16000,28000],"40ft HC":[18000,30000],
};

const DRIVERS_POOL = [
  "T. Gutiérrez","N. Herrera","V. Rojas","E. Castro","K. Mendoza",
  "A. Ibáñez","S. Pereyra","H. Cabrera","W. Acosta","Q. Benítez",
  "X. Delgado","Z. Espinoza","U. Flores","Y. García","O. Jiménez",
  "P. Heredia","L. Karina","M. Lima","F. Núñez","B. Ocampo",
  "C. Pacheco","J. Quiroga","R. Rivas","S. Salazar","T. Tapia",
] as const;

// Argentine plate: 2 letters + space + 3 digits + space + 2 letters
const PLATE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ";
function genPlate(): string {
  const L = PLATE_ABC;
  const rL = () => L[int(0, L.length - 1)];
  return `${rL()}${rL()} ${pad(int(100,999),3)} ${rL()}${rL()}`;
}

// Trucker lookup (6 canonical + EDPL from original seed kept for compat)
const TRUCKER_MAP: Record<string,string> = {
  SCAC1:"Seaboard Cartage Co.", SCAC2:"Summit Container Lines",
  SCAC3:"Sierra Drayage Group", RIVA:"Transportes Rivas",
  LAND:"Log. Andina", DSUR:"Drayage Sur", EDPL:"Expreso del Plata",
};
const TRUCKER_POOL = ["RIVA","RIVA","LAND","LAND","DSUR","DSUR","EDPL","SCAC1","SCAC2","SCAC3"] as const;

// Status distributions (inbound wave spread, most rows are EXPECTED)
type GateStatus = ContextGateRow["gateStatus"];
const INBOUND_STATUS_POOL: GateStatus[]  = [
  "GATE_OUT","GATE_OUT","SERVED","AT_POSITION","CHECKED_IN",
  "IN_QUEUE","IN_QUEUE","APPROACHING","APPROACHING",
  "EXPECTED","EXPECTED","EXPECTED","EXPECTED","EXPECTED","EXPECTED","EXPECTED",
];
const OUTBOUND_STATUS_POOL: GateStatus[] = [
  "GATE_OUT","SERVED","SERVED","AT_POSITION","CHECKED_IN",
  "IN_QUEUE","IN_QUEUE","APPROACHING",
  "EXPECTED","EXPECTED","EXPECTED","EXPECTED","EXPECTED","EXPECTED","EXPECTED",
];

// Occasional holds / excl messages
const HOLD_EXCL: [ContextGateRow["hold"], string | null][] = [
  [null, null],[null, null],[null, null],[null, null],[null, null],
  ["customs", "Customs hold — pending ARCA release"],
  ["quality",  "Seal number mismatch — re-inspection required"],
  ["damage",   "Structural damage flag — surveyor required"],
  [null, "Early arrival — ahead of window"],
  [null, "Weight discrepancy — reweigh in progress"],
  [null, "BL pending bank release — documentation hold"],
  [null, "AFIP hold — SIMI clearance required"],
];

let _gseq = 0;

function makeGateRow(
  direction: "inbound" | "outbound",
  statusPool: GateStatus[],
  apptBase: number,   // minutes from midnight
): ContextGateRow {
  _gseq++;
  const carrier   = pick(CARRIERS);
  const truckerSc = pick(TRUCKER_POOL);
  const sz        = pick(GATE_SIZE_POOL);
  const isoType   = GATE_ISO[sz];
  const [kLo,kHi] = GATE_KG[sz];
  const [hold,excl] = pick(HOLD_EXCL);
  const apptMin   = apptBase + int(0, 3) * 15;  // 0/15/30/45 min increment
  const appt      = hhmm(apptMin);
  const channel   = pick(["road","road","road","sea","rail"] as const);
  const lfd       = int(-12, 168);
  const status    = pick(statusPool);
  const consignee = pick(CONSIGNEES);
  const sealPfx   = SEAL_PFX[carrier.code] ?? "AR";
  return {
    containerId:  containerId(carrier.code, 2_000_000 + _gseq),
    scac:         carrier.code,
    size:         sz,
    consignee,
    carrierName:  carrier.name,
    truckerScac:  truckerSc,
    trucker:      TRUCKER_MAP[truckerSc],
    driver:       pick(DRIVERS_POOL),
    plate:        genPlate(),
    channel,
    appt,
    gateStatus:   status,
    hoursToLFD:   lfd,
    hold,
    excl,
    grossKg:      int(kLo, kHi),
    isoType,
    sealNumber:   sealPfx + "-" + pad(int(100000, 999999), 6),
    freeDays:     carrier.freeDays,
    detentionBasis: carrier.basis,
    story:        false,
    direction,
  };
}

// 22 inbound rows across the shift window (06:00 → 17:45)
const INBOUND_APPTS  = Array.from({ length: 22 }, (_, i) => mins("06:00") + i * 30);
// 20 outbound rows
const OUTBOUND_APPTS = Array.from({ length: 20 }, (_, i) => mins("06:00") + i * 30);

export const CONTEXT_GATE_ROWS: ContextGateRow[] = [
  ...INBOUND_APPTS .map(apptBase => makeGateRow("inbound",  INBOUND_STATUS_POOL,  apptBase)),
  ...OUTBOUND_APPTS.map(apptBase => makeGateRow("outbound", OUTBOUND_STATUS_POOL, apptBase)),
];
