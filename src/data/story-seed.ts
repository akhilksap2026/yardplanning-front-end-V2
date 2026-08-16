/**
 * story-seed.ts
 * Story-core module: the "One Shift in the Life of a YMSNow Yard" demo story.
 * Every record carries `story: true` so screens can filter it in or out.
 * All times are for the Aug 13 2026 14:00–15:09 shift window.
 *
 * Nothing imports this file yet — Step 4 will merge it into the live exports.
 * It is self-contained and must compile cleanly on its own.
 */

import { TRUCKERS as REF_TRUCKERS } from "./reference-pools";

// ── Utility ────────────────────────────────────────────────────────────────────

/** Parse "HH:MM" → minutes since midnight */
export function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// ── Story truckers (extracted from the shared pool) ───────────────────────────

export const SCAC1 = REF_TRUCKERS.find(t => t.scac === "SCAC1")!;
export const SCAC2 = REF_TRUCKERS.find(t => t.scac === "SCAC2")!;
export const SCAC3 = REF_TRUCKERS.find(t => t.scac === "SCAC3")!;

// ── Story operators ────────────────────────────────────────────────────────────

export interface StoryOperator {
  id:        string;
  name:      string;
  equipment: string;
  certs:     string[];
  shift:     string;
  status:    string;
  story:     true;
}

export const STORY_OPERATORS: StoryOperator[] = [
  { id:"OP-J01", name:"Justin", equipment:"ForkLift1", certs:["RS","IMDG"], shift:"14:00–22:00", status:"on shift", story:true },
  { id:"OP-J02", name:"James",  equipment:"Jockey1",   certs:["TT"],        shift:"14:00–22:00", status:"on shift", story:true },
  { id:"OP-M01", name:"Mike",   equipment:"—",         certs:["INSPECT"],   shift:"14:00–22:00", status:"on shift", story:true },
];

// ── Story equipment ────────────────────────────────────────────────────────────

export interface StoryEquipment {
  id:          string;
  type:        string;
  model:       string;
  hourMeter:   number;
  operator:    string; // operator name
  /** Operational status, compatible with the base EQUIPMENT status field */
  status:      string;
  story:       true;
}

export const STORY_EQUIPMENT: StoryEquipment[] = [
  { id:"ForkLift1", type:"Reach stacker",    model:"Kalmar DRG450", hourMeter:12480, operator:"Justin", status:"in_use",  story:true },
  { id:"Jockey1",   type:"Terminal tractor", model:"Terberg YT223", hourMeter:18320, operator:"James",  status:"in_use",  story:true },
];

// ── Story chassis ──────────────────────────────────────────────────────────────

export interface StoryChassis {
  id:              string;
  spec:            string;   // e.g. "40ft gooseneck"
  homeRow:         string;   // e.g. "CHA0101"
  ownedBy:         string;   // SCAC or "yard"
  status:          "available" | "in_use" | "departed" | "returned";
  currentLocation: string | null;
  story:           true;
}

export const STORY_CHASSIS: StoryChassis[] = [
  {
    id:              "CABC54321",
    spec:            "40ft gooseneck",
    homeRow:         "CHA0101",
    ownedBy:         "SCAC1",
    status:          "departed",   // left mounted on MSCU1234566
    currentLocation: null,
    story:           true,
  },
  {
    id:              "CB211111",
    spec:            "40ft standard",
    homeRow:         "CHA0101",
    ownedBy:         "yard",
    status:          "returned",
    currentLocation: "CHA0101",
    story:           true,
  },
  {
    id:              "CB22222",
    spec:            "40ft standard",
    homeRow:         "CHA0102",
    ownedBy:         "yard",
    status:          "returned",
    currentLocation: "CHA0102",
    story:           true,
  },
];

// ── Story containers ───────────────────────────────────────────────────────────
// Every Container interface field is populated.
// vessel is left "" — vessels are out of scope for this app.

export interface StoryContainer {
  // ── Core Container fields ──────────────────────────────────────────────────
  id:          string;
  zone:        string;
  block:       number;
  row:         number;
  slot:        number;
  tier:        number;
  address:     string;
  size:        string;
  grossKg:     number;
  carrier:     string;
  carrierName: string;
  consignee:   string;
  vessel:      string;   // "" — vessels out of scope
  terminal:    string;   // "" — not tracked for story containers
  hazmat:      boolean;
  imdg:        string | null;
  channel:     string;
  status:      string;
  hoursToLFD:  number;
  dwellDays:   number;
  priority:    string;
  empty:       boolean;
  whyHere:     string;
  seal:        string;
  // ── Optional expert attributes ─────────────────────────────────────────────
  isoType?:            string;
  tareKg?:             number;
  // ── Story-specific attributes ──────────────────────────────────────────────
  story:               true;
  role:                "inbound" | "outbound" | "rehandle" | "housekeeping";
  finalSlot?:          string;
  stackPos?:           string;
  stagePos?:           string;
  specialInstructions?: string;
}

export const STORY_CONTAINERS: StoryContainer[] = [
  // ── Inbound 1: Evergreen EITU3333307 ──────────────────────────────────────
  {
    id: "EITU3333307",
    zone: "R", block: 1, row: 1, slot: 1, tier: 1,
    address: "GATE",
    size: "40ft HC", grossKg: 24600, carrier: "EGLV", carrierName: "Evergreen",
    consignee: "Meridian Auto Parts",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "IN_YARD",
    hoursToLFD: 96, dwellDays: 0, priority: "P3", empty: false,
    whyHere: "Inbound drop — putaway to DB0203 per shift plan P-200.",
    seal: "EIT-334120",
    isoType: "45G1", tareKg: 3980,
    story: true, role: "inbound", finalSlot: "DB0203",
  },
  // ── Inbound 2: DAL Shipping DAIU4444460 ───────────────────────────────────
  {
    id: "DAIU4444460",
    zone: "R", block: 1, row: 1, slot: 2, tier: 1,
    address: "GATE",
    size: "40ft", grossKg: 21900, carrier: "DAIU", carrierName: "DAL Shipping",
    consignee: "Cordoba Industrial",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "IN_YARD",
    hoursToLFD: 108, dwellDays: 0, priority: "P3", empty: false,
    whyHere: "Inbound drop — arrived 35 min early; plan P-400 issued after P-300 superseded.",
    seal: "DAI-771905",
    isoType: "42G1", tareKg: 3750,
    story: true, role: "inbound", finalSlot: "DB0209",
  },
  // ── Inbound 3: Gold Star Line GAIU7777765 ─────────────────────────────────
  {
    id: "GAIU7777765",
    zone: "R", block: 1, row: 1, slot: 3, tier: 1,
    address: "GATE",
    size: "20ft", grossKg: 16400, carrier: "GAIU", carrierName: "Gold Star Line",
    consignee: "Rosario Logistics",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "IN_YARD",
    hoursToLFD: 84, dwellDays: 0, priority: "P3", empty: false,
    whyHere: "Inbound drop — ASN received 13:30; putaway to DB0211 per plan P-500.",
    seal: "GAI-220338",
    isoType: "22G1", tareKg: 2180,
    story: true, role: "inbound", finalSlot: "DB0211",
  },
  // ── Outbound: MSC MSCU1234566 ─────────────────────────────────────────────
  {
    id: "MSCU1234566",
    zone: "R", block: 1, row: 1, slot: 1, tier: 1,
    address: "RA0101",
    size: "40ft HC", grossKg: 23400, carrier: "MSCU", carrierName: "MSC",
    consignee: "Denso Sudamérica",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "STAGED",
    hoursToLFD: 6, dwellDays: 4, priority: "P2", empty: false,
    whyHere: "Outbound — staged for truck pick-up per plan P-100.",
    seal: "MSC-661002",
    isoType: "45G1", tareKg: 3900,
    story: true, role: "outbound", stackPos: "RA0101", stagePos: "STG0203",
    specialInstructions: "Reefer genset OFF — dry load. Deliver dock 4, appointment held.",
  },
  // ── Rehandle 1: MSC MSCU2345179 ───────────────────────────────────────────
  {
    id: "MSCU2345179",
    zone: "R", block: 1, row: 1, slot: 4, tier: 1,
    address: "RA0101",
    size: "40ft", grossKg: 19800, carrier: "MSCU", carrierName: "MSC",
    consignee: "Bosch Argentina",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "IN_YARD",
    hoursToLFD: 40, dwellDays: 6, priority: "P3", empty: false,
    whyHere: "Rehandle — digout required to clear overstow blocking outbound P-100.",
    seal: "MSC-334120",
    isoType: "42G1",
    story: true, role: "rehandle",
  },
  // ── Rehandle 2: MSC MSCU3451236 ───────────────────────────────────────────
  {
    id: "MSCU3451236",
    zone: "R", block: 1, row: 1, slot: 5, tier: 1,
    address: "RA0101",
    size: "20ft", grossKg: 15200, carrier: "MSCU", carrierName: "MSC",
    consignee: "Magna Rosario",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "IN_YARD",
    hoursToLFD: 52, dwellDays: 3, priority: "P4", empty: false,
    whyHere: "Rehandle — digout required to clear overstow blocking outbound P-100.",
    seal: "MSC-118093",
    isoType: "22G1",
    story: true, role: "rehandle",
  },
  // ── Housekeeping: MSC MSCU4512362 ─────────────────────────────────────────
  {
    id: "MSCU4512362",
    zone: "R", block: 1, row: 1, slot: 2, tier: 1,
    address: "RA0102",
    size: "40ft", grossKg: 20400, carrier: "MSCU", carrierName: "MSC",
    consignee: "Valeo BA",
    vessel: "", terminal: "",
    hazmat: false, imdg: null, channel: "road", status: "IN_YARD",
    hoursToLFD: 64, dwellDays: 5, priority: "P4", empty: false,
    whyHere: "Housekeeping move — density balance in RA row during outbound staging.",
    seal: "MSC-990241",
    isoType: "42G1",
    story: true, role: "housekeeping",
  },
];

// ── ASN records (Advance Shipping Notifications) ───────────────────────────────

export interface StoryASN {
  containerId:    string;
  truckerScac:    string;
  truckerName:    string;
  asnReceivedAt:  string;    // ISO-8601 datetime
  appt:           string;    // "HH:MM"
  etaOriginal:    string;    // "HH:MM"
  etaRevised:     string;    // "HH:MM"
  story:          true;
}

export const STORY_ASNS: StoryASN[] = [
  {
    containerId:   "EITU3333307",
    truckerScac:   "SCAC1",
    truckerName:   SCAC1.name,
    asnReceivedAt: "2026-08-12T23:59",
    appt:          "14:00",
    etaOriginal:   "14:00",
    etaRevised:    "14:15",
    story: true,
  },
  {
    containerId:   "DAIU4444460",
    truckerScac:   "SCAC2",
    truckerName:   SCAC2.name,
    asnReceivedAt: "2026-08-12T23:59",
    appt:          "15:00",
    etaOriginal:   "15:00",
    etaRevised:    "14:25",  // early arrival
    story: true,
  },
  {
    containerId:   "GAIU7777765",
    truckerScac:   "SCAC3",
    truckerName:   SCAC3.name,
    asnReceivedAt: "2026-08-13T13:30",
    appt:          "14:50",
    etaOriginal:   "14:50",
    etaRevised:    "14:50",
    story: true,
  },
];

// ── Plans ──────────────────────────────────────────────────────────────────────

export type PlanStatus = "draft" | "confirmed" | "in_progress" | "superseded";

export interface StoryPlan {
  code:          string;
  title:         string;
  status:        PlanStatus;
  startTime:     string;    // "HH:MM"
  endTime:       string;    // "HH:MM"
  startMin:      number;
  endMin:        number;
  crew:          string[];  // operator names
  supersededBy?: string;    // plan code
  supersededAt?: string;    // ISO-8601 datetime
  story:         true;
}

export const STORY_PLANS: StoryPlan[] = [
  {
    code:      "P-100",
    title:     "Stage outbound MSCU123456-6",
    status:    "confirmed",
    startTime: "14:00", endTime: "14:07",
    startMin:  minutesFromHHMM("14:00"), endMin: minutesFromHHMM("14:07"),
    crew:      ["Justin","James"],
    story:     true,
  },
  {
    code:      "P-200",
    title:     "Putaway EITU333330-7",
    status:    "confirmed",
    startTime: "14:15", endTime: "14:43",
    startMin:  minutesFromHHMM("14:15"), endMin: minutesFromHHMM("14:43"),
    crew:      ["Justin","James","Mike"],
    story:     true,
  },
  {
    code:         "P-300",
    title:        "Putaway DAIU444446-0 (stale)",
    status:       "superseded",
    startTime:    "15:00", endTime: "15:18",  // original planned window
    startMin:     minutesFromHHMM("15:00"), endMin: minutesFromHHMM("15:18"),
    crew:         ["Justin","James","Mike"],
    supersededBy: "P-400",
    supersededAt: "2026-08-13T14:26",
    story:        true,
  },
  {
    code:      "P-400",
    title:     "Putaway DAIU444446-0 (early arrival)",
    status:    "in_progress",
    startTime: "14:30", endTime: "14:48",
    startMin:  minutesFromHHMM("14:30"), endMin: minutesFromHHMM("14:48"),
    crew:      ["Justin","James","Mike"],
    story:     true,
  },
  {
    code:      "P-500",
    title:     "Putaway GAIU777776-5",
    status:    "confirmed",
    startTime: "15:00", endTime: "15:09",
    startMin:  minutesFromHHMM("15:00"), endMin: minutesFromHHMM("15:09"),
    crew:      ["Justin","James","Mike"],
    story:     true,
  },
];

// ── Steps ──────────────────────────────────────────────────────────────────────

export interface StoryStep {
  planCode:     string;
  seq:          number;
  operation:    string;
  containerId:  string | null;   // null for chassis-only moves
  from:         string;
  to:           string;
  operator:     string;
  equipment:    string | null;
  chassis:      string | null;
  startTime:    string;          // "HH:MM"
  endTime:      string;          // "HH:MM"
  startMin:     number;
  endMin:       number;
  method:       string;
  note?:        string;
  pairedWith?:  number;          // seq of parallel companion step
  story:        true;
}

function step(
  planCode: string, seq: number, operation: string,
  containerId: string | null, from: string, to: string,
  operator: string, equipment: string | null, chassis: string | null,
  startTime: string, endTime: string,
  method: string, extra?: Partial<Pick<StoryStep, "note"|"pairedWith">>
): StoryStep {
  return {
    planCode, seq, operation, containerId, from, to,
    operator, equipment, chassis,
    startTime, endTime,
    startMin: minutesFromHHMM(startTime),
    endMin:   minutesFromHHMM(endTime),
    method, story: true, ...extra,
  };
}

export const STORY_STEPS: StoryStep[] = [
  // ── P-100: Stage outbound MSCU1234566 (7 steps) ────────────────────────────
  step("P-100",1,"Outbound staging", "MSCU1234566","RA0101","RA0101",  "Justin","ForkLift1",null,       "14:00","14:02","Crane lift"),
  step("P-100",2,"Fetch chassis",    null,          "CHA0101","RA0101","James", "Jockey1",  "CABC54321","14:00","14:03","Yard-truck haul"),
  step("P-100",3,"Mount container",  "MSCU1234566","RA0101","RA0101",  "Justin","ForkLift1","CABC54321","14:03","14:05","Crane lift",   { pairedWith:2 }),
  step("P-100",4,"Move to staging",  "MSCU1234566","RA0101","STG0203", "James", "Jockey1",  "CABC54321","14:05","14:06","Move to staging"),
  step("P-100",5,"Digout",           "MSCU2345179","RA0101","RA0104",  "Justin","ForkLift1",null,       "14:05","14:06","Crane lift"),
  step("P-100",6,"Digout",           "MSCU3451236","RA0101","RA0105",  "Justin","ForkLift1",null,       "14:06","14:07","Crane lift"),
  step("P-100",7,"Housekeeping",     "MSCU4512362","RA0102","RA0106",  "James", "Jockey1",  null,       "14:06","14:07","Move to staging"),

  // ── P-200: Putaway EITU3333307 (5 steps) ────────────────────────────────────
  step("P-200",1,"Inspection",       "EITU3333307","GATE","GATE",     "Mike",  null,        "CB211111","14:15","14:20","Inspection"),
  step("P-200",2,"Hook chassis",     "EITU3333307","STG0202","STG0202","James","Jockey1",   "CB211111","14:30","14:32","Yard-truck haul"),
  step("P-200",3,"Drive to block",   "EITU3333307","STG0202","DB",    "James", "Jockey1",   "CB211111","14:32","14:36","Yard-truck haul"),
  step("P-200",4,"Demount + stack",  "EITU3333307","DB","DB0203",     "Justin","ForkLift1", "CB211111","14:38","14:41","Crane lift"),
  step("P-200",5,"Chassis home",     null,          "DB","CHA0101",   "James", "Jockey1",   "CB211111","14:41","14:43","Yard-truck haul"),

  // ── P-400: Putaway DAIU4444460 (early arrival) (5 steps) ──────────────────
  step("P-400",1,"Inspection",       "DAIU4444460","GATE","GATE",     "Mike",  null,        "CB22222", "14:30","14:34","Inspection"),
  step("P-400",2,"Hook chassis",     "DAIU4444460","STG0202","STG0202","James","Jockey1",   "CB22222", "14:36","14:38","Yard-truck haul"),
  step("P-400",3,"Drive to block",   "DAIU4444460","STG0202","DB",    "James", "Jockey1",   "CB22222", "14:38","14:41","Yard-truck haul"),
  step("P-400",4,"Demount + stack",  "DAIU4444460","DB","DB0209",     "Justin","ForkLift1", "CB22222", "14:43","14:46","Crane lift"),
  step("P-400",5,"Chassis home",     null,          "DB","CHA0102",   "James", "Jockey1",   "CB22222", "14:46","14:48","Yard-truck haul"),

  // ── P-500: Putaway GAIU7777765 (5 steps) ────────────────────────────────────
  step("P-500",1,"Inspection",       "GAIU7777765","GATE","GATE",     "Mike",  null,        "CB211111","15:00","15:03","Inspection"),
  step("P-500",2,"Hook chassis",     "GAIU7777765","STG0201","STG0201","James","Jockey1",   "CB211111","15:03","15:05","Yard-truck haul"),
  step("P-500",3,"Drive to block",   "GAIU7777765","STG0201","DB",    "James", "Jockey1",   "CB211111","15:05","15:07","Yard-truck haul"),
  step("P-500",4,"Demount + stack",  "GAIU7777765","DB","DB0211",     "Justin","ForkLift1", "CB211111","15:07","15:09","Crane lift"),
  step("P-500",5,"Chassis home",     null,          "DB","CHA0101",   "James", "Jockey1",   "CB211111","15:07","15:09","Yard-truck haul"),
];

// ── Gate transactions ──────────────────────────────────────────────────────────

export type GateTxnType = "IN" | "OUT" | "HOOK";

export interface StoryGateTxn {
  time:        string;      // "HH:MM"
  timeMin:     number;
  gate:        string;      // e.g. "Gate1"
  type:        GateTxnType;
  containerId: string;
  chassisId:   string;
  stagingSlot: string | null;
  sealNumber:  string;
  note:        string;
  planRef?:    string;       // plan code linked to this transaction
  story:       true;
}

export const STORY_GATE_TXNS: StoryGateTxn[] = [
  {
    time: "14:15", timeMin: minutesFromHHMM("14:15"),
    gate: "Gate1", type: "IN",
    containerId: "EITU3333307", chassisId: "CB211111", stagingSlot: "STG0202",
    sealNumber: "EIT-334120", note: "Seal verified · clean",
    planRef: "P-200", story: true,
  },
  {
    time: "14:23", timeMin: minutesFromHHMM("14:23"),
    gate: "Gate2", type: "HOOK",
    containerId: "MSCU1234566", chassisId: "CABC54321", stagingSlot: "STG0203",
    sealNumber: "MSC-661002", note: "Pickup driver hooked staged box",
    story: true,
  },
  {
    time: "14:25", timeMin: minutesFromHHMM("14:25"),
    gate: "Gate2", type: "OUT",
    containerId: "MSCU1234566", chassisId: "CABC54321", stagingSlot: null,
    sealNumber: "MSC-661002", note: "Departure — container + chassis together",
    story: true,
  },
  {
    time: "14:25", timeMin: minutesFromHHMM("14:25"),
    gate: "Gate1", type: "IN",
    containerId: "DAIU4444460", chassisId: "CB22222", stagingSlot: "STG0202",
    sealNumber: "DAI-771905", note: "Early arrival — 35 min ahead",
    planRef: "P-400", story: true,
  },
  {
    time: "14:50", timeMin: minutesFromHHMM("14:50"),
    gate: "Gate2", type: "IN",
    containerId: "GAIU7777765", chassisId: "CB211111", stagingSlot: "STG0201",
    sealNumber: "GAI-220338", note: "On-time arrival · ASN matched",
    planRef: "P-500", story: true,
  },
];

// ── Events ─────────────────────────────────────────────────────────────────────
// Matches the Event interface shape from yard-ops.ts, with additional optional
// fields for story-specific metadata (supersedes, issues, resolutionMin).

export interface StoryEvent {
  id:          string;
  time:        string;
  type:        string;
  severity:    string;
  state:       string;
  auto:        string;
  title:       string;
  detail:      string;
  diff: {
    cancelled:  number;
    added:      number;
    reassigned: number;
    frozenKept: number;
    deltaMin:   number;
    adherence:  number;
  };
  supersedes?:    string;   // plan code this event supersedes
  issues?:        string;   // plan code this event creates
  resolutionMin?: number;   // minutes from event to plan issued
  story:          true;
}

export const STORY_EVENTS: StoryEvent[] = [
  {
    id:       "EV-9001",
    time:     "12:00",
    type:     "ETA_REVISION",
    severity: "low",
    state:    "suppressed",
    auto:     "Auto",
    title:    "SCAC1 truck ETA slipped to 14:15",
    detail:   "Seaboard Cartage Co. revised ETA from 14:00 to 14:15 for EITU333330-7. Plan P-200 start shifted 15 min; seven frozen steps retained without change. Stability threshold not exceeded — replan suppressed.",
    diff:     { cancelled:0, added:0, reassigned:0, frozenKept:7, deltaMin:15, adherence:0 },
    story:    true,
  },
  {
    id:       "EV-9002",
    time:     "13:30",
    type:     "ASN_RECEIVED",
    severity: "low",
    state:    "replanned",
    auto:     "Auto",
    title:    "Third ASN — GAIU777776-5 booked 14:50",
    detail:   "Sierra Drayage Group submitted ASN at 13:30 for GAIU777776-5; appointment window confirmed at 14:50. Plan P-500 created; one step added to the inbound queue.",
    diff:     { cancelled:0, added:1, reassigned:0, frozenKept:0, deltaMin:0, adherence:0 },
    story:    true,
  },
  {
    id:           "EV-9003",
    time:         "14:26",
    type:         "OUT_OF_SEQUENCE_ARRIVAL",
    severity:     "high",
    state:        "replanned",
    auto:         "Auto",
    title:        "DAIU444446-0 arrived 35 min early",
    detail:       "Summit Container Lines arrived at Gate1 at 14:25, 35 min ahead of the 15:00 window. Stale plan P-300 superseded; revised plan P-400 issued in 4 min with 6 new steps, 5 cancelled, 2 reassignments.",
    diff:         { cancelled:5, added:6, reassigned:2, frozenKept:0, deltaMin:0, adherence:0 },
    supersedes:   "P-300",
    issues:       "P-400",
    resolutionMin: 4,
    story:        true,
  },
];

// ── Shift summary ──────────────────────────────────────────────────────────────

export interface StoryShiftSummary {
  received:               number;
  shipped:                number;
  chassisReturned:        number;
  chassisTotal:           number;
  slotsReconciled:        boolean;
  disruptionsHandled:     number;
  disruptionAvgResolveMin: number;
  plansExecuted:          string[];
  plansSuperseded:        string[];
  closeTime:              string;   // "HH:MM"
  story:                  true;
}

export const STORY_SHIFT_SUMMARY: StoryShiftSummary = {
  received:               3,
  shipped:                1,
  chassisReturned:        3,
  chassisTotal:           3,
  slotsReconciled:        true,
  disruptionsHandled:     1,
  disruptionAvgResolveMin: 4,
  plansExecuted:          ["P-100","P-200","P-400","P-500"],
  plansSuperseded:        ["P-300"],
  closeTime:              "15:09",
  story:                  true,
};
