// Seed data — deterministic seeded PRNG so output is identical every load
const rnd = (() => { let s = 0x5f3a91; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const LETTER: Record<string, number> = {};
"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => {
  LETTER[c] = [10,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29,30,31,32,34,35,36,37,38][i];
});
function checkDigit(pfx: string) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = pfx[i];
    const v = /[0-9]/.test(ch) ? +ch : LETTER[ch];
    sum += v * Math.pow(2, i);
  }
  const cd = sum % 11;
  return cd === 10 ? 0 : cd;
}
function makeId(owner: string) {
  const serial = String(int(100000, 999999));
  const pfx = owner + "U" + serial;
  return pfx + checkDigit(pfx);
}

export const CARRIERS = [
  { code: "MSCU", name: "MSC", freeDays: 7, basis: "calendar", tiers: [[8,14,45],[15,21,90],[22,99,150]] },
  { code: "MAEU", name: "Maersk", freeDays: 10, basis: "working", tiers: [[11,17,40],[18,24,85],[25,99,140]] },
  { code: "CMAU", name: "CMA CGM", freeDays: 7, basis: "calendar", tiers: [[8,14,50],[15,21,95],[22,99,160]] },
  { code: "HLXU", name: "Hapag-Lloyd", freeDays: 5, basis: "calendar", tiers: [[6,12,55],[13,20,100],[21,99,165]] },
  { code: "COSU", name: "COSCO", freeDays: 14, basis: "calendar", tiers: [[15,21,38],[22,28,80],[29,99,135]] }
];
export const CONSIGNEES = ["Autopartes del Sur SA","Bosch Argentina","Denso Sudamérica","Magna Rosario","Valeo BA","ZF Pilar","Continental Arg."];
export const VESSELS = ["MSC LUCIA V.412E","MAERSK SALINA V.238W","CMA CGM ANDES V.117N","SANTOS EXPRESS V.902","CAP SAN LORENZO V.331"];
export const TERMINALS = ["TRP Terminal 5","Terminal 4 BACTSSA","Exolgan Dock Sud","Terminales Río de la Plata"];
export const DEPOTS = [
  { id:"DEP-01", name:"Depósito Zárate", carrier:"MSCU", risk:"low", window:"07:00–15:00" },
  { id:"DEP-02", name:"Sur Empty Park", carrier:"MAEU", risk:"medium", window:"08:00–17:00" },
  { id:"DEP-03", name:"Dock Sud Depot", carrier:"CMAU", risk:"high", window:"06:00–12:00" },
  { id:"DEP-04", name:"Pilar Interior", carrier:"HLXU", risk:"low", window:"07:30–16:00" }
];

export interface Zone {
  id: string; name: string; blocks: number; rows: number; slots: number; maxTiers: number; ceiling: number; hazmat: boolean; customs: boolean;
  reefer?: boolean; quarantine?: boolean;
}
export const ZONES: Zone[] = [
  { id:"A", name:"Zone A — Dry / general (loaded)", blocks:6, rows:3, slots:10, maxTiers:4, ceiling:0.85, hazmat:false, customs:false },
  { id:"B", name:"Zone B — Dry / general (loaded)", blocks:6, rows:3, slots:10, maxTiers:4, ceiling:0.85, hazmat:false, customs:false },
  { id:"C", name:"Zone C — Customs hold", blocks:4, rows:2, slots:8, maxTiers:3, ceiling:0.80, hazmat:false, customs:true },
  { id:"D", name:"Zone D — Hazmat / IMDG", blocks:2, rows:2, slots:6, maxTiers:2, ceiling:0.70, hazmat:true, customs:false },
  { id:"E", name:"Zone E — Empty depot", blocks:4, rows:3, slots:10, maxTiers:4, ceiling:0.90, hazmat:false, customs:false },
  { id:"R", name:"Gate-in / receiving", blocks:1, rows:1, slots:12, maxTiers:1, ceiling:1.0, hazmat:false, customs:false },
  { id:"S", name:"Staging (drop & hook)", blocks:1, rows:1, slots:10, maxTiers:1, ceiling:1.0, hazmat:false, customs:false },
  { id:"F", name:"Zone F — Reefer / food-grade", blocks:2, rows:2, slots:8, maxTiers:3, ceiling:0.80, hazmat:false, customs:false, reefer:true },
  { id:"Q", name:"Zone Q — Quarantine / M&R", blocks:1, rows:1, slots:6, maxTiers:1, ceiling:1.0, hazmat:false, customs:false, quarantine:true },
];

export const EQUIPMENT = [
  { id:"RS-01", type:"Reach stacker", model:"Kalmar DRG450", maxRowDepth:3, status:"available", hourMeter:11840, maintenanceDue:"in 140 h" },
  { id:"RS-02", type:"Reach stacker", model:"Kalmar DRG450", maxRowDepth:3, status:"available", hourMeter:9620, maintenanceDue:"in 380 h" },
  { id:"RS-03", type:"Reach stacker", model:"Hyster RS46", maxRowDepth:2, status:"available", hourMeter:14210, maintenanceDue:"in 60 h" },
  { id:"EH-01", type:"Empty handler", model:"SMV 4.5", maxRowDepth:4, status:"available", hourMeter:7330, maintenanceDue:"in 500 h" },
  { id:"TT-01", type:"Terminal tractor", model:"Terberg YT223", maxRowDepth:0, status:"maintenance", hourMeter:20110, maintenanceDue:"in service" }
];

export const OPERATORS = [
  { id:"OP-114", name:"R. Giménez", equipment:"RS-01", certs:["IMDG","RS"], shift:"06:00–14:00", status:"on shift" },
  { id:"OP-207", name:"M. Sosa", equipment:"RS-02", certs:["RS"], shift:"06:00–14:00", status:"on shift" },
  { id:"OP-231", name:"L. Duarte", equipment:"RS-03", certs:["RS"], shift:"06:00–14:00", status:"on shift" },
  { id:"OP-308", name:"F. Ríos", equipment:"EH-01", certs:["EH"], shift:"06:00–14:00", status:"on shift" },
  { id:"OP-402", name:"C. Ledesma", equipment:"RS-01", certs:["IMDG","RS"], shift:"14:00–22:00", status:"off shift" }
];

const CHANNELS = ["verde","verde","verde","naranja","rojo"];
const STATUSES = ["IN_YARD","IN_YARD","IN_YARD","IN_YARD","STAGED","AT_RECEIVING_LANE","CUSTOMS_CONTROLLED"];

export interface Container {
  id: string; zone: string; block: number; row: number; slot: number; tier: number; address: string;
  size: string; grossKg: number; carrier: string; carrierName: string; consignee: string; vessel: string;
  terminal: string; hazmat: boolean; imdg: string | null; channel: string; status: string;
  hoursToLFD: number; dwellDays: number; priority: string; empty: boolean; whyHere: string; seal: string;
  // ── optional expert attributes (additive — absence means unknown/N/A) ──────
  isoType?: string;
  reefer?: boolean;
  tempSetPoint?: string;
  tareKg?: number;
  damageCode?: string;
  hold?: "customs" | "quality" | "damage" | null;
  highValue?: boolean;
  ageDays?: number;
}

function buildContainers(): Container[] {
  const out: Container[] = [];
  const reasons = [
    "Gate-adjacent: LFD in {h} h, pre-positioned for retrieval without a dig-out.",
    "Ground tier in {z}: 30.4 t exceeds the RS46 capacity chart above tier 2.",
    "Deep and low: red-channel dwell forecast 9.2 days, kept clear of short-dwell stacks.",
    "Stacked over a later-due box; zero predicted rehandles before its retrieval window.",
    "IMDG {c} segregation: only Zone D satisfies the class matrix against neighbours.",
    "Block balanced: Zone B at 81% against an 85% ceiling, workload spread from A."
  ];
  ZONES.filter(z => !"RS".includes(z.id)).forEach(z => {
    let damageAssigned = 0; // track damage-hold containers per zone (cap at 2 for Q)
    for (let b = 1; b <= z.blocks; b++) {
      for (let r = 1; r <= z.rows; r++) {
        for (let s = 1; s <= z.slots; s++) {
          const stack = int(0, z.maxTiers);
          for (let t = 1; t <= stack; t++) {
            if (rnd() > 0.88) continue;
            const carrier = pick(CARRIERS);
            const empty = z.id === "E";
            const hoursToLFD = empty ? int(4, 60) : int(-18, 190);
            const channel = z.id === "C" ? pick(["naranja","rojo"]) : pick(CHANNELS);
            const imdg = z.id === "D" ? pick(["3","8","9","5.1"]) : null;

            // Zone-specific placement reason
            const whyRaw = z.id === "F"
              ? "Reefer slot: cold-chain integrity maintained at -18°C — plugged since gate-in."
              : z.id === "Q"
              ? "Quarantine hold: M&R inspection pending — cleared from active traffic."
              : pick(reasons)
                  .replace("{h}", String(Math.max(0, hoursToLFD)))
                  .replace("{z}", z.id)
                  .replace("{c}", imdg || "3");

            const dwellDays = int(1, 26);

            // Zone Q: first 2 containers get a damage hold
            const giveDamage = z.id === "Q" && damageAssigned < 2;
            if (giveDamage) damageAssigned++;

            out.push({
              id: makeId(carrier.code.slice(0,3)),
              zone: z.id, block: b, row: r, slot: s, tier: t,
              address: `${z.id}-${String(b).padStart(2,"0")}-${r}-${s}-${t}`,
              size: rnd() > 0.75 ? "20GP" : (rnd() > 0.5 ? "40HC" : "40GP"),
              grossKg: empty ? int(2200,3900) : int(9800,30400),
              carrier: carrier.code, carrierName: carrier.name,
              consignee: empty ? "—" : pick(CONSIGNEES),
              vessel: pick(VESSELS), terminal: pick(TERMINALS),
              hazmat: z.id === "D", imdg,
              channel: empty ? "—" : channel,
              status: empty ? "IN_YARD" : pick(STATUSES),
              hoursToLFD, dwellDays, priority: pick(["P1","P2","P2","P3","P3","P4"]),
              empty, whyHere: whyRaw, seal: "AR" + int(200000,999999),
              // ── new optional fields ──────────────────────────────────────────
              ageDays: dwellDays,
              ...(z.id === "F"
                ? { reefer: true, tempSetPoint: "-18°C" }
                : {}),
              ...(giveDamage
                ? { damageCode: "DO-R-BT-ST", hold: "damage" as const }
                : {}),
              ...(!empty && rnd() < 0.04
                ? { highValue: true }
                : {}),
            });
          }
        }
      }
    }
  });
  return out;
}

// Explicit seed containers for Zone F (Reefer / food-grade) and Zone Q (Quarantine / M&R).
// The deterministic PRNG in buildContainers() produces zero-height stacks for these zones,
// so we append a small realistic set here.
const ZONE_F_CONTAINERS: Container[] = [
  {
    id: "MSCU3849207",
    zone:"F", block:1, row:1, slot:1, tier:1,
    address:"F-01-1-1-1", size:"40HC", grossKg:18400,
    carrier:"MSCU", carrierName:"MSC", consignee:"Bosch Argentina",
    vessel:"MSC LUCIA V.412E", terminal:"TRP Terminal 5",
    hazmat:false, imdg:null, channel:"verde", status:"IN_YARD",
    hoursToLFD:36, dwellDays:4, priority:"P2", empty:false,
    whyHere:"Reefer zone: temperature-controlled cargo requires plug-in bay; set-point −18 °C.",
    seal:"AR481293"
  },
  {
    id: "MAEU5120473",
    zone:"F", block:1, row:1, slot:2, tier:1,
    address:"F-01-1-2-1", size:"40HC", grossKg:14200,
    carrier:"MAEU", carrierName:"Maersk", consignee:"Denso Sudamérica",
    vessel:"MAERSK SALINA V.238W", terminal:"Terminal 4 BACTSSA",
    hazmat:false, imdg:null, channel:"verde", status:"IN_YARD",
    hoursToLFD:52, dwellDays:3, priority:"P2", empty:false,
    whyHere:"Reefer zone: food-grade pharmaceutical shipment; continuous monitoring active.",
    seal:"AR620841"
  },
  {
    id: "CMAU7733185",
    zone:"F", block:1, row:2, slot:1, tier:1,
    address:"F-01-2-1-1", size:"20GP", grossKg:11800,
    carrier:"CMAU", carrierName:"CMA CGM", consignee:"Valeo BA",
    vessel:"CMA CGM ANDES V.117N", terminal:"Exolgan Dock Sud",
    hazmat:false, imdg:null, channel:"verde", status:"IN_YARD",
    hoursToLFD:18, dwellDays:6, priority:"P1", empty:false,
    whyHere:"Reefer zone: LFD in 18 h, pre-positioned for earliest retrieval window.",
    seal:"AR715503"
  },
  {
    id: "HLXU9016542",
    zone:"F", block:2, row:1, slot:1, tier:1,
    address:"F-02-1-1-1", size:"40HC", grossKg:22100,
    carrier:"HLXU", carrierName:"Hapag-Lloyd", consignee:"ZF Pilar",
    vessel:"SANTOS EXPRESS V.902", terminal:"Terminales Río de la Plata",
    hazmat:false, imdg:null, channel:"verde", status:"IN_YARD",
    hoursToLFD:72, dwellDays:2, priority:"P3", empty:false,
    whyHere:"Reefer zone: frozen auto-parts requiring sub-zero storage per shipper instruction.",
    seal:"AR344987"
  },
  {
    id: "COSU2487316",
    zone:"F", block:2, row:1, slot:2, tier:1,
    address:"F-02-1-2-1", size:"40GP", grossKg:16500,
    carrier:"COSU", carrierName:"COSCO", consignee:"Magna Rosario",
    vessel:"MSC LUCIA V.412E", terminal:"TRP Terminal 5",
    hazmat:false, imdg:null, channel:"naranja", status:"IN_YARD",
    hoursToLFD:44, dwellDays:5, priority:"P2", empty:false,
    whyHere:"Reefer zone: orange-channel inspection pending; held in temp-controlled bay during review.",
    seal:"AR562104"
  },
];

const ZONE_Q_CONTAINERS: Container[] = [
  {
    id: "MSCU1048579",
    zone:"Q", block:1, row:1, slot:1, tier:1,
    address:"Q-01-1-1-1", size:"40GP", grossKg:21300,
    carrier:"MSCU", carrierName:"MSC", consignee:"Autopartes del Sur SA",
    vessel:"CMA CGM ANDES V.117N", terminal:"Exolgan Dock Sud",
    hazmat:false, imdg:null, channel:"rojo", status:"CUSTOMS_CONTROLLED",
    hoursToLFD:96, dwellDays:11, priority:"P1", empty:false,
    whyHere:"Quarantine hold: M&R inspection booked 10:00 — door seal damage reported at gate-in.",
    seal:"AR839201"
  },
  {
    id: "MAEU3674921",
    zone:"Q", block:1, row:1, slot:2, tier:1,
    address:"Q-01-1-2-1", size:"20GP", grossKg:9700,
    carrier:"MAEU", carrierName:"Maersk", consignee:"Continental Arg.",
    vessel:"MAERSK SALINA V.238W", terminal:"Terminal 4 BACTSSA",
    hazmat:false, imdg:null, channel:"naranja", status:"CUSTOMS_CONTROLLED",
    hoursToLFD:120, dwellDays:8, priority:"P2", empty:false,
    whyHere:"Quarantine hold: awaiting SENASA phytosanitary clearance before release.",
    seal:"AR473629"
  },
  {
    id: "CMAU5890438",
    zone:"Q", block:1, row:1, slot:3, tier:1,
    address:"Q-01-1-3-1", size:"40HC", grossKg:2800,
    carrier:"CMAU", carrierName:"CMA CGM", consignee:"—",
    vessel:"SANTOS EXPRESS V.902", terminal:"Terminales Río de la Plata",
    hazmat:false, imdg:null, channel:"—", status:"IN_YARD",
    hoursToLFD:48, dwellDays:3, priority:"P3", empty:true,
    whyHere:"M&R bay: empty unit with forklift pocket damage — awaiting structural inspection sign-off.",
    seal:"AR610057"
  },
];

export const CONTAINERS: Container[] = [
  ...buildContainers(),
  ...ZONE_F_CONTAINERS,
  ...ZONE_Q_CONTAINERS,
];

/**
 * Returns the set of container IDs considered "hot" for the current shift:
 * – hoursToLFD ≤ 4.
 * Pass nowHour (0–23) to override the real clock (useful for testing / seed mode).
 */
export function getHotContainers(containers: Container[], _nowHour?: number): Set<string> {
  const hot = new Set<string>()
  for (const c of containers) {
    if (!c.empty && c.hoursToLFD <= 4) hot.add(c.id)
  }
  return hot
}

export const MOVE_TYPES = ["RETRIEVE_STAGE","PLACE_INBOUND","RESHUFFLE","LOAD_OUTBOUND","PRE_MARSHAL","RECEIVE_FROM_LANE","MOVE_INSPECTION"];
export const TYPE_LABEL: Record<string, string> = {
  RETRIEVE_STAGE: "Retrieve", PLACE_INBOUND: "Put-away", RESHUFFLE: "Rehandle",
  LOAD_OUTBOUND: "Load out", PRE_MARSHAL: "Pre-marshal", RECEIVE_FROM_LANE: "Gate receipt",
  MOVE_INSPECTION: "Move to inspection"
};
const MOVE_REASONS: Record<string, string> = {
  RETRIEVE_STAGE: "LFD in {h} h — staged ahead of the 08:40 appointment to protect free time.",
  PLACE_INBOUND: "Slot scores 92: no buried earlier-due box, 140 m travel, ground tier fit.",
  RESHUFFLE: "Dig-out: one box above an earlier-due unit; cheaper now than at retrieval.",
  LOAD_OUTBOUND: "Truck booked 08:15; container pre-staged at S-01-1-{s}-1, 15-min turn protected.",
  PRE_MARSHAL: "Idle window 11:20–11:50 — removes two predicted rehandles this afternoon.",
  RECEIVE_FROM_LANE: "Receiving lane R-{s} clears before the 07:30 arrival wave.",
  MOVE_INSPECTION: "Orange channel: inspection bay booked 10:00 with ARCA verifier."
};

export interface Move {
  id: string; seq: number; type: string; containerId: string; from: string; to: string;
  equipment: string; operator: string; operatorName: string; estMin: number; start: string; end: string;
  startMin: number; endMin: number; state: string; frozen: boolean; priority: string; reason: string;
  reason_text: string | null;
}

function buildMoves(): Move[] {
  const out: Move[] = [];
  let t = 6 * 60;
  const onShift = OPERATORS.filter(o => o.status === "on shift");
  for (let i = 1; i <= 96; i++) {
    const type = pick(MOVE_TYPES);
    const c = pick(CONTAINERS);
    const op = pick(onShift);
    const est = +(2.6 + rnd() * 4.4).toFixed(1);
    const start = t;
    t += Math.round(est) + int(0, 2);
    if (i % 4 === 0) t += 1;
    const hh = (m: number) => String(Math.floor(m/60)).padStart(2,"0") + ":" + String(m%60).padStart(2,"0");
    out.push({
      id: "MV-" + String(1000 + i),
      seq: i, type, containerId: c.id,
      from: type === "PLACE_INBOUND" ? "R-01-1-"+int(1,12)+"-1" : c.address,
      to: type === "RETRIEVE_STAGE" || type === "LOAD_OUTBOUND" ? "S-01-1-"+int(1,10)+"-1" : c.address.replace(/-\d$/, "-"+int(1,3)),
      equipment: op.equipment, operator: op.id, operatorName: op.name,
      estMin: est, start: hh(start), end: hh(start+Math.round(est)),
      startMin: start, endMin: start+Math.round(est),
      state: i<=6?"DONE":i<=8?"IN_PROGRESS":i<=30?"ASSIGNED":"PLANNED",
      frozen: i<=12,
      priority: c.priority,
      reason: MOVE_REASONS[type].replace("{h}",String(Math.max(0,c.hoursToLFD))).replace("{s}",String(int(1,10))),
      reason_text: null
    });
  }
  return out;
}

const _builtMoves = buildMoves()

// ── DEMO: deliberately-illegal move — triggers Rule B (tier-4-row-1-only) ────
// Destination "A-03-2-5-4": tier=4, row=2 → Rule B fires.
// This move exists ONLY to demonstrate the hard-filter UI in Night Planner.
// Remove or replace with a real move before using in production.
const _demoContainer = CONTAINERS.find(c => c.zone === "A" && !c.empty && c.grossKg > 20000) ?? CONTAINERS[0]
const DEMO_ILLEGAL_MOVE: Move = {
  id: "MV-9001", seq: 97, type: "RESHUFFLE",
  containerId: _demoContainer.id,
  from: _demoContainer.address,
  to: "A-03-2-5-4",   // tier=4, row=2 → Rule B: tier 4 not permitted beyond row 1
  equipment: "RS-01", operator: "OP-114", operatorName: "R. Giménez",
  estMin: 8.2, start: "13:45", end: "13:53", startMin: 825, endMin: 833,
  state: "PLANNED", frozen: false, priority: "P2",
  reason: "Pre-shift density stack — tier 4 for space saving.",
  reason_text: null,
}

// ── DEMO: size-mismatch move — triggers Rule C (20ft cannot stack on 40ft) ───
// Finds a ground-tier 40GP in Zone A and a 20GP mover at runtime, so the
// demo works regardless of PRNG seed. Clearly commented as demo-only.
const _40gpBelow = CONTAINERS.find(c => c.size === "40GP" && c.tier === 1 && c.zone === "A" && !c.empty)
const _20gpMover = CONTAINERS.find(c => c.size === "20GP" && !c.empty && c.id !== _40gpBelow?.id)
const DEMO_SIZE_MISMATCH_MOVE: Move | undefined = _40gpBelow && _20gpMover
  ? {
      id: "MV-9002", seq: 98, type: "RESHUFFLE",
      containerId: _20gpMover.id,
      from: _20gpMover.address,
      // Destination: one tier above the 40GP container → Rule C fires
      to: (() => { const p = _40gpBelow.address.split("-"); p[4] = String(_40gpBelow.tier + 1); return p.join("-") })(),
      equipment: "RS-02", operator: "OP-207", operatorName: "M. Sosa",
      estMin: 6.5, start: "14:00", end: "14:06", startMin: 840, endMin: 846,
      state: "PLANNED", frozen: false, priority: "P3",
      reason: "Density restack — short-side onto long-side for space efficiency.",
      reason_text: null,
    }
  : undefined

export const MOVES: Move[] = [
  ..._builtMoves,
  DEMO_ILLEGAL_MOVE,
  ...(DEMO_SIZE_MISMATCH_MOVE ? [DEMO_SIZE_MISMATCH_MOVE] : []),
]

// ── Outbound retrieval planning step ─────────────────────────────────────────
//
// This function represents the RETRIEVE_STAGE selection pass that runs AFTER
// inbound placement (buildMoves above). It is a pure function: given a
// container snapshot, it returns the set of retrieval moves that must be
// sequenced to protect free-time windows.
//
// Rules:
//   1. Only IN_YARD, non-empty containers with hoursToLFD ≤ 72 qualify.
//   2. Sort ascending by hoursToLFD (most urgent first).
//   3. Each move is RETRIEVE_STAGE with origin = current address,
//      destination = "" (assigned by the placement step that follows).
//   4. reason_text is set; the legacy `reason` field mirrors it for
//      compatibility with existing display code.

export function buildRetrievalMoves(containers: Container[]): Move[] {
  const urgent = containers
    .filter(c => c.status === "IN_YARD" && !c.empty && c.hoursToLFD <= 72)
    .sort((a, b) => a.hoursToLFD - b.hoursToLFD)

  return urgent.map((c, i) => {
    const hours = Math.max(0, Math.round(c.hoursToLFD))
    const reasonText = `LFD in ${hours}h — retrieval sequenced to protect free time.`
    return {
      id: `RTV-${String(i + 1).padStart(4, "0")}`,
      seq: 0,            // sequenced in the ordering step
      type: "RETRIEVE_STAGE",
      containerId: c.id,
      from: c.address,
      to: "",            // destination assigned by placement step
      equipment: "",     // assigned by dispatch step
      operator: "",
      operatorName: "",
      estMin: 0,
      start: "",
      end: "",
      startMin: 0,
      endMin: 0,
      state: "PLANNED",
      frozen: false,
      priority: c.priority,
      reason: reasonText,
      reason_text: reasonText,
    }
  })
}

export const EXCEPTIONS = [
  { id:"EX-01", type:"ZONE_FULL", severity:"high", subject:"Zone C at 80% ceiling", detail:"Two orange-channel arrivals have no eligible customs-controlled slot. Overflow policy requires a ceiling override.", action:"Request override" },
  { id:"EX-02", type:"NO_CERTIFIED_OPERATOR", severity:"high", subject:"IMDG class 5.1 retrieval 09:20", detail:"Only OP-114 is IMDG certified on shift and is committed to a frozen chain until 09:40.", action:"Escalate" },
  { id:"EX-03", type:"WEIGHT_VS_REACH", severity:"medium", subject:"MSCU4419307 — 30.4 t at row 3", detail:"C4 violation against the Hyster RS46 capacity chart. Re-sited to row 1, tier 1 in Zone B.", action:"Accept re-site" }
];

export const ASSUMPTIONS = [
  { k:"Weight snapshot", v:"WS-2026-08-10#a41f9c", note:"frozen at generation" },
  { k:"Machines available", v:"3 RS + 1 EH", note:"TT-01 in maintenance" },
  { k:"Shift pattern", v:"1 shift · 06:00–14:00", note:"D-10 unconfirmed" },
  { k:"Inbound mode", v:"Drop-and-go", note:"D-01 assumption" },
  { k:"Bonded status", v:"Not bonded", note:"D-02 unanswered" },
  { k:"Arrival profile", v:"34 containers · peak 07:00–09:30", note:"from terminal feed" },
  { k:"Wind forecast", v:"22 km/h peak", note:"below tier-3 limit" },
  { k:"Travel matrix", v:"Geometry-seeded", note:"learned actuals from wk 6" }
];
