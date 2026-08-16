import { STORY_EVENTS, STORY_STEPS } from "./story-seed";
import { CONTEXT_EVENTS } from "./context-seed";

export interface Visit {
  id: string; plate: string; carrier: string; driver: string; purpose: string; appt: string;
  queueIn: string|null; checkIn: string|null; atPosition: string|null; served: string|null;
  gateOut: string|null; state: string; turn: number; lane: string; container: string; excl: string|null;
  chassis?: string;
}

export const VISITS: Visit[] = [
  // ── 06:00–07:00 band (original story visits) ───────────────────────────────
  { id:"V-2041", plate:"AF 421 KL", carrier:"Transportes Rivas",  driver:"J. Álvarez",  purpose:"Inbound drop",    appt:"06:00", queueIn:"05:52", checkIn:"05:58", atPosition:"06:03", served:"06:09", gateOut:"06:11", state:"GATE_OUT",  turn:0,  lane:"R-03", container:"MSCU4419307", excl:null },
  { id:"V-2042", plate:"AC 883 MN", carrier:"Drayage Sur",         driver:"P. Molina",   purpose:"Customer pickup", appt:"06:15", queueIn:"06:08", checkIn:"06:14", atPosition:"06:18", served:"06:26", gateOut:null,    state:"SERVED",     turn:18, lane:"S-02", container:"MAEU3109651", excl:null },
  { id:"V-2043", plate:"AD 190 QT", carrier:"Transportes Rivas",  driver:"M. Coronel",  purpose:"Empty return",    appt:"06:30", queueIn:"06:21", checkIn:"06:29", atPosition:"06:34", served:null,    gateOut:null,    state:"AT_POSITION", turn:12, lane:"E-01", container:"CMAU9963816", excl:null },
  { id:"V-2044", plate:"AE 552 RB", carrier:"Log. Andina",         driver:"R. Paz",      purpose:"Inbound drop",    appt:"06:30", queueIn:"06:27", checkIn:"06:33", atPosition:null,    served:null,    gateOut:null,    state:"CHECKED_IN",  turn:9,  lane:"R-05", container:"HLXU7959453", excl:"Missing EIR photo set" },
  { id:"V-2045", plate:"AB 774 JD", carrier:"Drayage Sur",         driver:"L. Ferreyra", purpose:"Full transfer",   appt:"06:45", queueIn:"06:36", checkIn:null,    atPosition:null,    served:null,    gateOut:null,    state:"IN_QUEUE",    turn:6,  lane:"—",    container:"COSU3308834", excl:null },
  { id:"V-2046", plate:"AG 018 WX", carrier:"Transportes Rivas",  driver:"S. Ojeda",    purpose:"Customer pickup", appt:"07:00", queueIn:"06:41", checkIn:null,    atPosition:null,    served:null,    gateOut:null,    state:"IN_QUEUE",    turn:1,  lane:"—",    container:"COSU9082309", excl:"Early arrival — 19 min before appointment" },
  { id:"V-2047", plate:"AH 336 PL", carrier:"Log. Andina",         driver:"D. Barrios",  purpose:"Inbound drop",    appt:"07:00", queueIn:null,    checkIn:null,    atPosition:null,    served:null,    gateOut:null,    state:"APPROACHING", turn:0,  lane:"—",    container:"MAEU2210554", excl:null },
  { id:"V-2048", plate:"AJ 905 ZR", carrier:"Drayage Sur",         driver:"N. Vera",     purpose:"Empty return",    appt:"07:15", queueIn:null,    checkIn:null,    atPosition:null,    served:null,    gateOut:null,    state:"EXPECTED",    turn:0,  lane:"—",    container:"CMAU4471902", excl:null },

  // ── 07:15–08:00 band ───────────────────────────────────────────────────────
  { id:"V-2049", plate:"AK 112 WZ", carrier:"Carga Express",       driver:"B. Vargas",   purpose:"Inbound drop",    appt:"07:15", queueIn:"07:09", checkIn:"07:16", atPosition:"07:22", served:"07:38", gateOut:"07:43", state:"GATE_OUT",  turn:0,  lane:"R-01", container:"TCKU3862910", excl:null },
  { id:"V-2050", plate:"AL 345 MQ", carrier:"Flota Norte",          driver:"C. Aguirre",  purpose:"Customer pickup", appt:"07:15", queueIn:"07:12", checkIn:"07:19", atPosition:"07:26", served:"07:41", gateOut:"07:46", state:"GATE_OUT",  turn:0,  lane:"S-01", container:"TGHU4591023", excl:null },
  { id:"V-2051", plate:"AM 667 PK", carrier:"Transportes Rivas",   driver:"E. Quispe",   purpose:"Empty return",    appt:"07:30", queueIn:"07:21", checkIn:"07:28", atPosition:"07:35", served:"07:50", gateOut:"07:55", state:"GATE_OUT",  turn:0,  lane:"E-02", container:"UACU8023417", excl:null },
  { id:"V-2052", plate:"AN 890 JH", carrier:"Drayage Sur",          driver:"F. Romero",   purpose:"Inbound drop",    appt:"07:30", queueIn:"07:25", checkIn:"07:32", atPosition:"07:39", served:"07:58", gateOut:"08:03", state:"GATE_OUT",  turn:0,  lane:"R-04", container:"SUDU7104582", excl:null },
  { id:"V-2053", plate:"AP 221 TL", carrier:"Log. Andina",          driver:"G. Sánchez",  purpose:"Customer pickup", appt:"07:45", queueIn:"07:38", checkIn:"07:46", atPosition:"07:53", served:"08:09", gateOut:"08:14", state:"GATE_OUT",  turn:0,  lane:"S-02", container:"APZU2937641", excl:null },
  { id:"V-2054", plate:"AQ 543 NR", carrier:"Carga Express",        driver:"H. Torres",   purpose:"Inbound drop",    appt:"07:45", queueIn:"07:41", checkIn:"07:49", atPosition:"07:56", served:"08:13", gateOut:"08:18", state:"GATE_OUT",  turn:0,  lane:"R-02", container:"FSCU6418203", excl:null },

  // ── 08:00–09:00 band ───────────────────────────────────────────────────────
  { id:"V-2055", plate:"AR 876 SP", carrier:"Flota Norte",          driver:"I. Mendoza",  purpose:"Full transfer",   appt:"08:00", queueIn:"07:53", checkIn:"08:01", atPosition:"08:08", served:"08:27", gateOut:"08:32", state:"GATE_OUT",  turn:0,  lane:"S-03", container:"GESU9027354", excl:null },
  { id:"V-2056", plate:"AS 109 QV", carrier:"Transportes Rivas",   driver:"J. Cabrera",  purpose:"Empty return",    appt:"08:00", queueIn:"07:57", checkIn:"08:05", atPosition:"08:12", served:"08:30", gateOut:"08:35", state:"GATE_OUT",  turn:0,  lane:"E-01", container:"MSCU6738402", excl:null },
  { id:"V-2057", plate:"AT 432 HL", carrier:"Drayage Sur",          driver:"K. Herrera",  purpose:"Inbound drop",    appt:"08:15", queueIn:"08:08", checkIn:"08:15", atPosition:"08:22", served:"08:41", gateOut:"08:46", state:"GATE_OUT",  turn:0,  lane:"R-05", container:"MAEU5029163", excl:null },
  { id:"V-2058", plate:"AU 754 ZR", carrier:"Log. Andina",          driver:"L. Flores",   purpose:"Customer pickup", appt:"08:15", queueIn:"08:11", checkIn:"08:19", atPosition:"08:26", served:"08:45", gateOut:"08:50", state:"GATE_OUT",  turn:0,  lane:"S-01", container:"CMAU3841927", excl:null },
  { id:"V-2059", plate:"AV 087 KN", carrier:"Carga Express",        driver:"M. Reyes",    purpose:"Inbound drop",    appt:"08:30", queueIn:"08:22", checkIn:"08:30", atPosition:"08:37", served:"08:56", gateOut:"09:01", state:"GATE_OUT",  turn:0,  lane:"R-03", container:"COSU7294810", excl:null },
  { id:"V-2060", plate:"AW 310 BQ", carrier:"Flota Norte",          driver:"N. Castillo", purpose:"Empty return",    appt:"08:30", queueIn:"08:26", checkIn:"08:34", atPosition:"08:41", served:"09:00", gateOut:"09:05", state:"GATE_OUT",  turn:0,  lane:"E-02", container:"HLXU4608253", excl:null },
  { id:"V-2061", plate:"AX 632 VM", carrier:"Transportes Rivas",   driver:"O. Núñez",    purpose:"Customer pickup", appt:"08:45", queueIn:"08:39", checkIn:"08:47", atPosition:"08:54", served:"09:13", gateOut:"09:18", state:"GATE_OUT",  turn:0,  lane:"S-02", container:"TCKU5913748", excl:null },
  { id:"V-2062", plate:"AY 964 PJ", carrier:"Drayage Sur",          driver:"P. Vega",     purpose:"Inbound drop",    appt:"08:45", queueIn:"08:43", checkIn:"08:51", atPosition:"08:58", served:"09:18", gateOut:"09:23", state:"GATE_OUT",  turn:0,  lane:"R-01", container:"TGHU2847061", excl:null },

  // ── 09:00–10:00 band ───────────────────────────────────────────────────────
  { id:"V-2063", plate:"AZ 197 WT", carrier:"Log. Andina",          driver:"Q. Morales",  purpose:"Full transfer",   appt:"09:00", queueIn:"08:54", checkIn:"09:02", atPosition:"09:09", served:"09:28", gateOut:"09:33", state:"GATE_OUT",  turn:0,  lane:"S-03", container:"UACU4026539", excl:null },
  { id:"V-2064", plate:"BA 420 EF", carrier:"Carga Express",        driver:"R. Guzmán",   purpose:"Inbound drop",    appt:"09:00", queueIn:"08:57", checkIn:"09:05", atPosition:"09:12", served:"09:31", gateOut:"09:36", state:"GATE_OUT",  turn:0,  lane:"R-04", container:"SUDU8315904", excl:null },
  { id:"V-2065", plate:"BB 752 LH", carrier:"Flota Norte",          driver:"S. Acosta",   purpose:"Customer pickup", appt:"09:15", queueIn:"09:09", checkIn:"09:17", atPosition:"09:24", served:"09:44", gateOut:"09:49", state:"GATE_OUT",  turn:0,  lane:"S-01", container:"APZU9148627", excl:null },
  { id:"V-2066", plate:"BC 085 RT", carrier:"Transportes Rivas",   driver:"T. Pereira",  purpose:"Empty return",    appt:"09:30", queueIn:"09:23", checkIn:"09:31", atPosition:"09:38", served:"09:57", gateOut:"10:02", state:"GATE_OUT",  turn:0,  lane:"E-01", container:"FSCU3729481", excl:null },
  { id:"V-2067", plate:"BD 318 GM", carrier:"Drayage Sur",          driver:"U. Salazar",  purpose:"Inbound drop",    appt:"09:30", queueIn:"09:26", checkIn:"09:34", atPosition:"09:41", served:"10:01", gateOut:"10:06", state:"GATE_OUT",  turn:0,  lane:"R-02", container:"GESU4837029", excl:null },
  { id:"V-2068", plate:"BE 640 XP", carrier:"Log. Andina",          driver:"V. Paredes",  purpose:"Customer pickup", appt:"09:45", queueIn:"09:39", checkIn:"09:47", atPosition:"09:54", served:"10:13", gateOut:"10:18", state:"GATE_OUT",  turn:0,  lane:"S-02", container:"MSCU9042716", excl:null },
  { id:"V-2069", plate:"BF 973 CK", carrier:"Carga Express",        driver:"W. Solís",    purpose:"Inbound drop",    appt:"09:45", queueIn:"09:42", checkIn:"09:50", atPosition:"09:57", served:"10:17", gateOut:"10:22", state:"GATE_OUT",  turn:0,  lane:"R-05", container:"MAEU7163842", excl:null },

  // ── 10:00–11:00 band ───────────────────────────────────────────────────────
  { id:"V-2070", plate:"BG 206 NV", carrier:"Flota Norte",          driver:"X. Córdova",  purpose:"Full transfer",   appt:"10:00", queueIn:"09:54", checkIn:"10:02", atPosition:"10:09", served:"10:29", gateOut:"10:34", state:"GATE_OUT",  turn:0,  lane:"S-03", container:"CMAU6274910", excl:null },
  { id:"V-2071", plate:"BH 538 QB", carrier:"Transportes Rivas",   driver:"Y. Zamora",   purpose:"Empty return",    appt:"10:00", queueIn:"09:57", checkIn:"10:05", atPosition:"10:12", served:"10:32", gateOut:"10:37", state:"GATE_OUT",  turn:0,  lane:"E-02", container:"COSU2938547", excl:null },
  { id:"V-2072", plate:"BI 871 ZL", carrier:"Drayage Sur",          driver:"A. Benítez",  purpose:"Customer pickup", appt:"10:15", queueIn:"10:09", checkIn:"10:17", atPosition:"10:24", served:"10:43", gateOut:"10:48", state:"GATE_OUT",  turn:0,  lane:"S-01", container:"HLXU3809265", excl:null },
  { id:"V-2073", plate:"BJ 104 TW", carrier:"Log. Andina",          driver:"B. Cáceres",  purpose:"Inbound drop",    appt:"10:30", queueIn:"10:23", checkIn:"10:31", atPosition:"10:38", served:"10:57", gateOut:"11:02", state:"GATE_OUT",  turn:0,  lane:"R-03", container:"TCKU8526371", excl:null },
  { id:"V-2074", plate:"BK 436 HJ", carrier:"Carga Express",        driver:"C. Delgado",  purpose:"Empty return",    appt:"10:45", queueIn:"10:37", checkIn:"10:45", atPosition:"10:52", served:"11:11", gateOut:"11:16", state:"GATE_OUT",  turn:0,  lane:"E-01", container:"TGHU6190483", excl:null },

  // ── 11:00–12:00 band ───────────────────────────────────────────────────────
  { id:"V-2075", plate:"BL 769 MS", carrier:"Flota Norte",          driver:"D. Espinoza", purpose:"Full transfer",   appt:"11:00", queueIn:"10:53", checkIn:"11:01", atPosition:"11:08", served:"11:27", gateOut:"11:32", state:"GATE_OUT",  turn:0,  lane:"S-02", container:"UACU5382907", excl:null },
  { id:"V-2076", plate:"BM 002 RV", carrier:"Transportes Rivas",   driver:"E. Figueroa", purpose:"Inbound drop",    appt:"11:00", queueIn:"10:57", checkIn:"11:05", atPosition:"11:12", served:"11:31", gateOut:"11:36", state:"GATE_OUT",  turn:0,  lane:"R-01", container:"SUDU3047829", excl:null },
  { id:"V-2077", plate:"BN 334 FN", carrier:"Drayage Sur",          driver:"F. Gallardo", purpose:"Customer pickup", appt:"11:15", queueIn:"11:09", checkIn:"11:17", atPosition:"11:24", served:"11:43", gateOut:"11:48", state:"GATE_OUT",  turn:0,  lane:"S-03", container:"APZU7614230", excl:null },
  { id:"V-2078", plate:"BO 667 ZQ", carrier:"Log. Andina",          driver:"G. Ibáñez",   purpose:"Empty return",    appt:"11:30", queueIn:"11:23", checkIn:"11:31", atPosition:"11:38", served:"11:57", gateOut:"12:02", state:"GATE_OUT",  turn:0,  lane:"E-02", container:"FSCU8025163", excl:null },
  { id:"V-2079", plate:"BP 890 WM", carrier:"Carga Express",        driver:"H. Jara",     purpose:"Inbound drop",    appt:"11:45", queueIn:"11:38", checkIn:"11:46", atPosition:"11:53", served:"12:12", gateOut:"12:17", state:"GATE_OUT",  turn:0,  lane:"R-04", container:"GESU5739814", excl:null },

  // ── 12:00–13:00 band ───────────────────────────────────────────────────────
  { id:"V-2080", plate:"BQ 123 KT", carrier:"Flota Norte",          driver:"I. Lagos",    purpose:"Customer pickup", appt:"12:00", queueIn:"11:53", checkIn:"12:01", atPosition:"12:08", served:"12:27", gateOut:"12:32", state:"GATE_OUT",  turn:0,  lane:"S-01", container:"MSCU1834709", excl:null },
  { id:"V-2081", plate:"BR 455 JX", carrier:"Transportes Rivas",   driver:"J. Molina",   purpose:"Inbound drop",    appt:"12:00", queueIn:"11:57", checkIn:"12:05", atPosition:"12:12", served:"12:31", gateOut:"12:36", state:"GATE_OUT",  turn:0,  lane:"R-02", container:"MAEU6270391", excl:null },
  { id:"V-2082", plate:"BS 788 CZ", carrier:"Drayage Sur",          driver:"K. Pinto",    purpose:"Empty return",    appt:"12:15", queueIn:"12:09", checkIn:"12:17", atPosition:"12:24", served:"12:43", gateOut:"12:48", state:"GATE_OUT",  turn:0,  lane:"E-01", container:"CMAU4915872", excl:null },
  { id:"V-2083", plate:"BT 021 PH", carrier:"Log. Andina",          driver:"L. Ríos",     purpose:"Customer pickup", appt:"12:30", queueIn:"12:24", checkIn:"12:32", atPosition:"12:39", served:"12:58", gateOut:"13:03", state:"GATE_OUT",  turn:0,  lane:"S-02", container:"COSU8041736", excl:null },
  { id:"V-2084", plate:"BU 353 VM", carrier:"Carga Express",        driver:"M. Silva",    purpose:"Inbound drop",    appt:"12:45", queueIn:"12:39", checkIn:"12:47", atPosition:"12:54", served:"13:13", gateOut:"13:18", state:"GATE_OUT",  turn:0,  lane:"R-05", container:"HLXU9273054", excl:null },

  // ── 13:00–14:00 band — mix of cleared, in-progress, approaching ────────────
  { id:"V-2085", plate:"BV 685 NJ", carrier:"Flota Norte",          driver:"N. Soto",     purpose:"Full transfer",   appt:"13:00", queueIn:"12:54", checkIn:"13:02", atPosition:"13:09", served:"13:28", gateOut:"13:33", state:"GATE_OUT",  turn:0,  lane:"S-03", container:"TCKU7384921", excl:null },
  { id:"V-2086", plate:"BW 018 RQ", carrier:"Transportes Rivas",   driver:"O. Tapia",    purpose:"Inbound drop",    appt:"13:00", queueIn:"12:58", checkIn:"13:06", atPosition:"13:13", served:"13:33", gateOut:"13:38", state:"GATE_OUT",  turn:0,  lane:"R-03", container:"TGHU8046293", excl:null },
  { id:"V-2087", plate:"BX 350 HV", carrier:"Drayage Sur",          driver:"P. Urquiza",  purpose:"Customer pickup", appt:"13:15", queueIn:"13:10", checkIn:"13:18", atPosition:"13:25", served:"13:45", gateOut:null,    state:"SERVED",     turn:3,  lane:"S-01", container:"UACU3719485", excl:null },
  { id:"V-2088", plate:"BY 683 ZK", carrier:"Log. Andina",          driver:"Q. Valdivia", purpose:"Empty return",    appt:"13:30", queueIn:"13:24", checkIn:"13:32", atPosition:null,    served:null,    gateOut:null,    state:"CHECKED_IN",  turn:5,  lane:"E-02", container:"SUDU6482017", excl:null },
  { id:"V-2089", plate:"BZ 915 MF", carrier:"Carga Express",        driver:"R. Zambrano", purpose:"Inbound drop",    appt:"13:45", queueIn:"13:39", checkIn:null,    atPosition:null,    served:null,    gateOut:null,    state:"IN_QUEUE",    turn:7,  lane:"—",    container:"APZU1593840", excl:null },
  { id:"V-2090", plate:"CA 248 WN", carrier:"Flota Norte",          driver:"S. Zenteno",  purpose:"Customer pickup", appt:"14:00", queueIn:null,    checkIn:null,    atPosition:null,    served:null,    gateOut:null,    state:"APPROACHING", turn:0,  lane:"—",    container:"FSCU2807364", excl:null },
];

export const LANES = [
  { id:"R-01", type:"Receiving", state:"occupied", visit:"V-2039", since:"05:44" },
  { id:"R-02", type:"Receiving", state:"free", visit:null, since:null },
  { id:"R-03", type:"Receiving", state:"clearing", visit:"V-2041", since:"06:03" },
  { id:"R-04", type:"Receiving", state:"free", visit:null, since:null },
  { id:"R-05", type:"Receiving", state:"assigned", visit:"V-2044", since:"06:33" },
  { id:"S-01", type:"Staging", state:"staged", visit:null, since:"05:20" },
  { id:"S-02", type:"Staging", state:"loading", visit:"V-2042", since:"06:18" },
  { id:"E-01", type:"Empty", state:"occupied", visit:"V-2043", since:"06:34" }
];

export const APPOINTMENTS = Array.from({ length: 16 }, (_, i) => {
  const hour = 6 + Math.floor(i / 2);
  const half = i % 2 ? "30" : "00";
  const cap = [4,4,4,4,3,3,3,3,3,3,4,4,4,4,3,3][i];
  const booked = [3,4,3,3,3,2,2,2,1,2,2,3,2,1,1,0][i];
  return { window: String(hour).padStart(2,"0") + ":" + half, capacity: cap, booked, noShow: i===5?1:0, over: booked>cap };
});

export interface Event {
  id: string; time: string; type: string; severity: string; state: string; auto: string;
  title: string; detail: string;
  diff: { cancelled: number; added: number; reassigned: number; frozenKept: number; deltaMin: number; adherence: number };
}

const _EVENTS_BASE: Event[] = [
  { id:"EV-7741", time:"06:07", type:"EQUIPMENT_FAILURE", severity:"high", state:"replanned", auto:"Partial", title:"RS-03 hydraulic fault — out of service", detail:"Hyster RS46 reported a hydraulic fault at row C-02. 14 assigned moves redistributed across RS-01 and RS-02; one IMDG retrieval escalated because OP-114 is the sole certified operator on shift.", diff:{cancelled:0,added:2,reassigned:14,frozenKept:5,deltaMin:26,adherence:-4} },
  { id:"EV-7742", time:"06:19", type:"CUSTOMS_CHANNEL_ASSIGNED", severity:"high", state:"replanned", auto:"Auto", title:"MSCU4419307 assigned orange channel", detail:"ARCA selectivity returned Sea channel. Container routed to inspection bay, reserved staging slot released and backfilled with the next LFD-critical unit. Dwell forecast extended 4.1 days, which re-tiers its slot assignment to deep-and-low.", diff:{cancelled:1,added:3,reassigned:2,frozenKept:0,deltaMin:11,adherence:-1} },
  { id:"EV-7743", time:"06:24", type:"SHIP_DELAY", severity:"medium", state:"suppressed", auto:"Auto", title:"MSC LUCIA V.412E ETA slipped 45 min", detail:"Projected saving from resequencing is 3.2 machine-minutes, below the 8-minute minimum improvement threshold. Replan suppressed by the stability controller; the baseline holds and operators see no change.", diff:{cancelled:0,added:0,reassigned:0,frozenKept:12,deltaMin:3.2,adherence:0} },
  { id:"EV-7744", time:"06:31", type:"DEPOT_REDIRECTION", severity:"medium", state:"replanned", auto:"Auto, notify", title:"CMAU9963816 redirected to Pilar Interior", detail:"CMA CGM redirected the empty return from Dock Sud Depot to Pilar Interior, window 07:30–16:00. Empty-return sequence replanned, driver notified by WhatsApp, depot appointment rebooked.", diff:{cancelled:1,added:1,reassigned:1,frozenKept:0,deltaMin:4,adherence:0} },
  { id:"EV-7745", time:"06:38", type:"CONTAINER_NOT_FOUND", severity:"medium", state:"replanned", auto:"Manual", title:"HLXU7959453 found at B-04-2-5-2 — map corrected", detail:"OP-207 reported the original slot empty. Guided search found the container two positions forward at B-04-2-5-2. WMS map updated; retrieval order reinstated and replanned for 08:30. No free-time impact.", diff:{cancelled:0,added:1,reassigned:1,frozenKept:0,deltaMin:9,adherence:-1} },
  { id:"EV-7746", time:"06:44", type:"APPOINTMENT_NO_SHOW", severity:"low", state:"replanned", auto:"Auto", title:"V-2038 no-show at 06:15 window", detail:"Slot released back to the appointment engine and offered to the 07:00 waitlist. Carrier no-show rate now 6.2% over 30 days.", diff:{cancelled:1,added:0,reassigned:0,frozenKept:0,deltaMin:5,adherence:0} },
  { id:"EV-7747", time:"05:58", type:"DETENTION_BREACH", severity:"medium", state:"replanned", auto:"Auto", title:"MSCU4419307 last-free-day passed 2 h ago — retrieval sequenced", detail:"Tariff moved into Tier 2 at $90/day; $180 accrued. Retrieval sequenced for 07:10 with the reserved staging slot released to backfill. Empty return window at Depósito Zárate is 07:00–15:00; on track to close within shift.", diff:{cancelled:0,added:1,reassigned:3,frozenKept:4,deltaMin:6,adherence:-1} },
  { id:"EV-7748", time:"06:38", type:"AUDIT_DISCREPANCY", severity:"medium", state:"awaiting", auto:"Manual", title:"HLXU7959453 not at B-04-2-7-2", detail:"Cycle-count task YA-311 raised. Guided search issued to OP-231 with four ranked candidates. Linked order is held and the retrieval move is cancelled until the map is corrected.", diff:{cancelled:2,added:1,reassigned:0,frozenKept:0,deltaMin:0,adherence:-3} }
];

export const DIFF_ROWS = [
  { moveId:"MV-1032", action:"REASSIGNED", type:"Retrieve", before:"RS-03 · L. Duarte · 06:42", after:"RS-01 · R. Giménez · 06:48", note:"Nearest capable machine; sequence continuity kept." },
  { moveId:"MV-1034", action:"REASSIGNED", type:"Rehandle", before:"RS-03 · L. Duarte · 06:51", after:"RS-02 · M. Sosa · 06:55", note:"Within reassignment cap (2/hour) for this operator." },
  { moveId:"MV-1039", action:"ADDED", type:"Move to inspection", before:"—", after:"RS-01 · R. Giménez · 07:10", note:"Orange channel: inspection bay booked 10:00." },
  { moveId:"MV-1041", action:"CANCELLED", type:"Retrieve", before:"RS-02 · M. Sosa · 07:04", after:"—", note:"Reserved staging slot released, order re-promised." },
  { moveId:"MV-1044", action:"HELD", type:"Load out", before:"RS-01 · R. Giménez · 06:22", after:"unchanged", note:"In progress on the spreader — never cancelled." },
  { moveId:"MV-1047", action:"ADDED", type:"Pre-marshal", before:"—", after:"RS-02 · M. Sosa · 07:22", note:"Idle window absorbs the redistributed load." }
];

import { allSteps, type PlanningStep } from "./planningData"

function _fmtLoc(loc: PlanningStep["origin"]): string {
  if (!loc || loc.bay == null) return "—"
  if (loc.bay === "GATE / OFF-YARD") return "GATE"
  return `Bay-${loc.bay} R${loc.row ?? "?"} T${loc.tier ?? "?"}`
}
function _stepDur(s: PlanningStep): string {
  if (!s.estimated_start || !s.estimated_end) return "—"
  return ((new Date(s.estimated_end).getTime() - new Date(s.estimated_start).getTime()) / 60000).toFixed(1)
}

// Story tasks for Justin / James / Mike — mapped from STORY_STEPS, surfaced first
const _storyTasks = STORY_STEPS.map((s, i) => ({
  id:        `MV-ST-${String(i + 1).padStart(3, "0")}`,
  seq:       `${s.seq} of ${STORY_STEPS.filter(x => x.planCode === s.planCode).length}`,
  type:      s.operation,
  container: s.containerId ?? "",
  from:      s.from,
  to:        s.to,
  est:       String(s.endMin - s.startMin),
  reason:    `${s.planCode} · ${s.method}`,
  chassis:   s.chassis ?? undefined,
}));

export const OPERATOR_TASKS = [
  ..._storyTasks,
  ...allSteps
    .filter(s => s.operator != null && s.step_status !== "Completed")
    .slice(0, 5)
    .map((s, i) => ({
      id:        `MV-${1028 + i}`,
      seq:       `${s.planned_step ?? s.step_number ?? i + 1} of ${allSteps.filter(x => x.operator === s.operator).length}`,
      type:      s.operation,
      container: s.container_id ?? "",
      from:      _fmtLoc(s.origin),
      to:        _fmtLoc(s.destination),
      est:       _stepDur(s),
      reason:    s.operator_pickup ?? s.operation,
    })),
];

/** Seed queue for each operator — task IDs in execution order */
export const OPERATOR_QUEUES: Record<string, string[]> = {
  "OP-114": ["MV-1028", "MV-1029", "MV-1030", "MV-1031", "MV-1032"],
  "OP-J01": STORY_STEPS
    .map((s, i) => ({ id: `MV-ST-${String(i + 1).padStart(3, "0")}`, op: s.operator }))
    .filter(t => t.op === "Justin").map(t => t.id),
  "OP-J02": STORY_STEPS
    .map((s, i) => ({ id: `MV-ST-${String(i + 1).padStart(3, "0")}`, op: s.operator }))
    .filter(t => t.op === "James").map(t => t.id),
  "OP-M01": STORY_STEPS
    .map((s, i) => ({ id: `MV-ST-${String(i + 1).padStart(3, "0")}`, op: s.operator }))
    .filter(t => t.op === "Mike").map(t => t.id),
};

export const TURN_BY_HOUR = [
  { hour:"06", p50:12.1, p90:18.4, visits:9 },
  { hour:"07", p50:14.8, p90:22.6, visits:14 },
  { hour:"08", p50:16.9, p90:26.1, visits:17 },
  { hour:"09", p50:15.2, p90:23.8, visits:15 },
  { hour:"10", p50:12.6, p90:19.0, visits:11 },
  { hour:"11", p50:11.4, p90:17.2, visits:8 },
  { hour:"12", p50:10.9, p90:16.4, visits:6 },
  { hour:"13", p50:11.8, p90:17.9, visits:7 }
];

export const CYCLE_BY_TYPE = [
  { type:"Retrieve", p50:4.6, p90:6.9, n:142 },
  { type:"Load out", p50:3.9, p90:5.4, n:96 },
  { type:"Put-away", p50:5.1, p90:7.6, n:121 },
  { type:"Rehandle", p50:6.4, p90:9.8, n:38 },
  { type:"Pre-marshal", p50:5.8, p90:8.2, n:17 }
];

export const CAPACITY = [
  { month:"Aug", volume:640, required:28.4, available:32, breach:false },
  { month:"Sep", volume:720, required:31.1, available:32, breach:false },
  { month:"Oct", volume:810, required:35.6, available:32, breach:true },
  { month:"Nov", volume:900, required:40.2, available:32, breach:true },
  { month:"Dec", volume:980, required:44.8, available:40, breach:true },
  { month:"Jan", volume:1050, required:49.1, available:40, breach:true }
];

// ── Merged EVENTS export (base + story + context) ─────────────────────────────

export const EVENTS: Event[] = [
  ..._EVENTS_BASE,
  ...STORY_EVENTS,
  ...CONTEXT_EVENTS,
];
