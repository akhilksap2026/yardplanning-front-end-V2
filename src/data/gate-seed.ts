/**
 * gate-seed.ts
 * Realistic seed rows for the Inbound and Outbound container tabs.
 * The Planner KPI cards import INBOUND_SEED.length / OUTBOUND_SEED.length
 * directly, so counts are always in sync.
 *
 * scac        = shipping-line BIC/SCAC (always the first 4 chars of containerId)
 * truckerScac = road-carrier SCAC from the truckers lookup table
 */
import { CONTEXT_GATE_ROWS } from "./context-seed";

export interface GateContainerRow {
  containerId:  string
  scac:         string           // shipping-line BIC/SCAC — first 4 chars of containerId
  size:         string           // "20ft" | "40ft" | "40ft HC"
  consignee:    string           // owner / receiving company
  carrierName:  string           // shipping line full name
  truckerScac:  string           // road-carrier SCAC (RIVA / LAND / DSUR / EDPL)
  trucker:      string           // road transport company full name
  driver:       string
  plate:        string           // truck license plate (Argentine format)
  channel:      "road" | "sea" | "rail"
  appt:         string           // "HH:MM" appointment window
  gateStatus:   "GATE_OUT" | "SERVED" | "AT_POSITION" | "CHECKED_IN" | "IN_QUEUE" | "APPROACHING" | "EXPECTED"
  hoursToLFD:   number           // negative = breached
  hold:         "customs" | "quality" | "damage" | null
  excl:         string | null    // gate exclusion / alert note
  grossKg:      number
  isoType:      string
  sealNumber:   string
  /** Populated by the live API join — free days granted by the shipping line */
  freeDays?:           number
  /** Populated by the live API join — detention rate basis */
  detentionBasis?:     string
  /** ISO-8601 datetime when the ASN/booking was received at the gate system */
  asnReceivedAt?:      string
  /** "HH:MM" original ETA before any revision */
  etaOriginal?:        string
  /** "HH:MM" revised ETA (differs from etaOriginal when an ETA_REVISION fired) */
  etaRevised?:         string
  /** Chassis ID that arrived or departed with this container */
  chassis?:            string
  /** Free-text handling instructions surfaced in the gate detail panel */
  specialInstructions?: string
  /** true on the 4 story gate rows; false on context-generated rows */
  story?:              boolean
  /** ERP / TMS order reference — ORD-###### format */
  orderId?:            string
  /** Shipping / booking shipment reference — SHP-###### format */
  shipmentId?:         string
}

// ─── INBOUND — 28 containers ──────────────────────────────────────────────

const _INBOUND_BASE: GateContainerRow[] = [
  { containerId:"OOLU0000043", scac:"OOLU", size:"40ft HC", consignee:"Bosch Argentina",        carrierName:"OOCL",            truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"M. Coronel",   plate:"AD 190 QT", channel:"road",    appt:"06:00", gateStatus:"GATE_OUT",    hoursToLFD:48,  hold:null,      excl:null,                                          grossKg:24_800, isoType:"45G1", sealNumber:"BRG-441892" },
  { containerId:"TCLU0000041", scac:"TCLU", size:"20ft",    consignee:"Magna Rosario",           carrierName:"Triton Container", truckerScac:"LAND", trucker:"Log. Andina",       driver:"R. Paz",       plate:"AE 552 RB", channel:"road",    appt:"06:15", gateStatus:"GATE_OUT",    hoursToLFD:72,  hold:null,      excl:null,                                          grossKg:18_400, isoType:"22G1", sealNumber:"TRI-009341" },
  { containerId:"MSCU0000040", scac:"MSCU", size:"40ft",    consignee:"Denso Sudamérica",        carrierName:"MSC",             truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"L. Ferreyra",  plate:"AB 774 JD", channel:"sea",     appt:"06:30", gateStatus:"GATE_OUT",    hoursToLFD:20,  hold:"customs", excl:"Customs hold — pending ARCA release",         grossKg:21_200, isoType:"42G1", sealNumber:"MSC-774002" },
  { containerId:"MSCU0000045", scac:"MSCU", size:"40ft HC", consignee:"Autopartes del Sur SA",   carrierName:"MSC",             truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"S. Ojeda",     plate:"AG 018 WX", channel:"road",    appt:"06:45", gateStatus:"SERVED",      hoursToLFD:96,  hold:null,      excl:null,                                          grossKg:27_600, isoType:"45G1", sealNumber:"MSC-553318" },
  { containerId:"HLXU0000044", scac:"HLXU", size:"20ft",    consignee:"ZF Pilar",                carrierName:"Hapag-Lloyd",     truckerScac:"LAND", trucker:"Log. Andina",       driver:"D. Barrios",   plate:"AH 336 PL", channel:"road",    appt:"07:00", gateStatus:"SERVED",      hoursToLFD:60,  hold:null,      excl:null,                                          grossKg:16_900, isoType:"22G1", sealNumber:"HL-091222"  },
  { containerId:"TCLU0000046", scac:"TCLU", size:"40ft",    consignee:"Continental Arg.",        carrierName:"Triton Container", truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"N. Vera",      plate:"AJ 905 ZR", channel:"road",    appt:"07:15", gateStatus:"AT_POSITION", hoursToLFD:84,  hold:null,      excl:null,                                          grossKg:22_300, isoType:"42G1", sealNumber:"TRI-223891" },
  { containerId:"CMAU0000042", scac:"CMAU", size:"40ft HC", consignee:"Valeo BA",                carrierName:"CMA CGM",         truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"F. Altamirano",plate:"AK 213 FW", channel:"rail",    appt:"07:30", gateStatus:"CHECKED_IN",  hoursToLFD:4,   hold:null,      excl:"LFD critical — 4 h remaining, express putaway sequenced", grossKg:29_100, isoType:"45G1", sealNumber:"CMA-881045" },
  { containerId:"CMAU0000047", scac:"CMAU", size:"20ft",    consignee:"Magna Rosario",           carrierName:"CMA CGM",         truckerScac:"LAND", trucker:"Log. Andina",       driver:"G. Sandoval",  plate:"AL 774 RT", channel:"road",    appt:"07:45", gateStatus:"CHECKED_IN",  hoursToLFD:120, hold:null,      excl:null,                                          grossKg:17_500, isoType:"22G1", sealNumber:"CMA-330712" },
  { containerId:"MAEU0000051", scac:"MAEU", size:"40ft HC", consignee:"Toyota Argentina",        carrierName:"Maersk",          truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"P. Giménez",   plate:"AM 881 XQ", channel:"road",    appt:"08:00", gateStatus:"IN_QUEUE",    hoursToLFD:108, hold:null,      excl:null,                                          grossKg:25_400, isoType:"45G1", sealNumber:"MAE-002109" },
  { containerId:"CSNU0000052", scac:"CSNU", size:"40ft",    consignee:"Pirelli Arg.",            carrierName:"Cosco Shipping",  truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"A. Lucero",    plate:"AN 334 BT", channel:"road",    appt:"08:15", gateStatus:"IN_QUEUE",    hoursToLFD:55,  hold:null,      excl:null,                                          grossKg:23_100, isoType:"42G1", sealNumber:"CSN-771204" },
  { containerId:"EGLV0000053", scac:"EGLV", size:"20ft",    consignee:"3M Argentina",            carrierName:"Evergreen",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"C. Ríos",      plate:"AO 556 NM", channel:"sea",     appt:"08:30", gateStatus:"IN_QUEUE",    hoursToLFD:18,  hold:null,      excl:"Early arrival — 22 min before window",        grossKg:14_700, isoType:"22G1", sealNumber:"EGL-443901" },
  { containerId:"YMLU0000054", scac:"YMLU", size:"40ft HC", consignee:"Gestamp Argentina",        carrierName:"Yang Ming",       truckerScac:"LAND", trucker:"Log. Andina",       driver:"B. Ledesma",   plate:"AP 119 KQ", channel:"road",    appt:"08:45", gateStatus:"APPROACHING", hoursToLFD:78,  hold:null,      excl:null,                                          grossKg:26_900, isoType:"45G1", sealNumber:"YML-990312" },
  { containerId:"HLXU0000055", scac:"HLXU", size:"20ft",    consignee:"Renault Argentina",        carrierName:"Hapag-Lloyd",     truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"E. Méndez",    plate:"AQ 772 JF", channel:"road",    appt:"09:00", gateStatus:"APPROACHING", hoursToLFD:90,  hold:null,      excl:null,                                          grossKg:15_300, isoType:"22G1", sealNumber:"HL-228801"  },
  { containerId:"MSCU0000056", scac:"MSCU", size:"40ft",    consignee:"Faurecia Argentina",        carrierName:"MSC",             truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"H. Quiroga",   plate:"AR 443 WS", channel:"road",    appt:"09:15", gateStatus:"APPROACHING", hoursToLFD:65,  hold:null,      excl:null,                                          grossKg:20_600, isoType:"42G1", sealNumber:"MSC-661034" },
  { containerId:"OOLU0000057", scac:"OOLU", size:"40ft HC", consignee:"Stellantis Argentina",         carrierName:"OOCL",            truckerScac:"LAND", trucker:"Log. Andina",       driver:"I. Soria",     plate:"AS 885 YT", channel:"road",    appt:"09:30", gateStatus:"EXPECTED",    hoursToLFD:144, hold:null,      excl:null,                                          grossKg:28_200, isoType:"45G1", sealNumber:"OOC-112038" },
  { containerId:"TCLU0000058", scac:"TCLU", size:"20ft",    consignee:"General Motors Arg.",            carrierName:"Triton Container", truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"K. Peralta",   plate:"AT 227 NM", channel:"road",    appt:"09:45", gateStatus:"EXPECTED",    hoursToLFD:48,  hold:null,      excl:null,                                          grossKg:16_800, isoType:"22G1", sealNumber:"TRI-554217" },
  { containerId:"CMAU0000059", scac:"CMAU", size:"40ft",    consignee:"PPG Industries Arg.",       carrierName:"CMA CGM",         truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"M. Vargas",    plate:"AU 669 JF", channel:"rail",    appt:"10:00", gateStatus:"EXPECTED",    hoursToLFD:14,  hold:"customs", excl:"IMO cargo — DGA clearance in progress, expected by 11:00", grossKg:22_900, isoType:"42G1", sealNumber:"CMA-773104" },
  { containerId:"MAEU0000060", scac:"MAEU", size:"40ft HC", consignee:"Shell Argentina",         carrierName:"Maersk",          truckerScac:"LAND", trucker:"Log. Andina",       driver:"F. Altamirano",plate:"AV 112 RT", channel:"road",    appt:"10:15", gateStatus:"EXPECTED",    hoursToLFD:36,  hold:null,      excl:null,                                          grossKg:24_100, isoType:"45G1", sealNumber:"MAE-881002" },
  { containerId:"CSNU0000061", scac:"CSNU", size:"20ft",    consignee:"Tenneco Argentina",        carrierName:"Cosco Shipping",  truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"G. Sandoval",  plate:"AW 334 BV", channel:"road",    appt:"10:30", gateStatus:"EXPECTED",    hoursToLFD:52,  hold:null,      excl:null,                                          grossKg:18_700, isoType:"22G1", sealNumber:"CSN-220941" },
  { containerId:"EGLV0000062", scac:"EGLV", size:"40ft",    consignee:"Eaton Argentina",         carrierName:"Evergreen",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"J. Álvarez",   plate:"AX 776 KQ", channel:"sea",     appt:"10:45", gateStatus:"EXPECTED",    hoursToLFD:14,  hold:null,      excl:null,                                          grossKg:21_500, isoType:"42G1", sealNumber:"EGL-009312" },
  { containerId:"YMLU0000063", scac:"YMLU", size:"40ft HC", consignee:"Scania Argentina",        carrierName:"Yang Ming",       truckerScac:"LAND", trucker:"Log. Andina",       driver:"P. Molina",    plate:"AY 118 WS", channel:"road",    appt:"11:00", gateStatus:"EXPECTED",    hoursToLFD:72,  hold:null,      excl:null,                                          grossKg:27_300, isoType:"45G1", sealNumber:"YML-441009" },
  { containerId:"HLXU0000064", scac:"HLXU", size:"20ft",    consignee:"Volvo Group Arg.",        carrierName:"Hapag-Lloyd",     truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"S. Ojeda",     plate:"AZ 550 YT", channel:"road",    appt:"11:15", gateStatus:"EXPECTED",    hoursToLFD:96,  hold:null,      excl:null,                                          grossKg:15_900, isoType:"22G1", sealNumber:"HL-882211"  },
  { containerId:"MSCU0000065", scac:"MSCU", size:"40ft",    consignee:"DB Schenker Arg.",   carrierName:"MSC",             truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"D. Barrios",   plate:"BA 221 NM", channel:"road",    appt:"11:30", gateStatus:"EXPECTED",    hoursToLFD:110, hold:null,      excl:null,                                          grossKg:19_400, isoType:"42G1", sealNumber:"MSC-330714" },
  { containerId:"OOLU0000066", scac:"OOLU", size:"40ft HC", consignee:"Kuehne+Nagel Arg.",        carrierName:"OOCL",            truckerScac:"LAND", trucker:"Log. Andina",       driver:"N. Vera",      plate:"BB 663 JF", channel:"road",    appt:"11:45", gateStatus:"EXPECTED",    hoursToLFD:88,  hold:null,      excl:null,                                          grossKg:26_100, isoType:"45G1", sealNumber:"OOC-554891" },
  { containerId:"TCLU0000067", scac:"TCLU", size:"20ft",    consignee:"Bridgestone Arg.",        carrierName:"Triton Container", truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"L. Ferreyra",  plate:"BC 115 BV", channel:"sea",     appt:"12:00", gateStatus:"EXPECTED",    hoursToLFD:22,  hold:null,      excl:"Reefer unit — pre-cooling bay reserved",       grossKg:14_200, isoType:"22R1", sealNumber:"TRI-009900" },
  { containerId:"CMAU0000068", scac:"CMAU", size:"40ft",    consignee:"Michelin Argentina",      carrierName:"CMA CGM",         truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"R. Paz",       plate:"BD 447 KQ", channel:"road",    appt:"12:30", gateStatus:"EXPECTED",    hoursToLFD:56,  hold:null,      excl:null,                                          grossKg:23_800, isoType:"42G1", sealNumber:"CMA-110234" },
  { containerId:"MAEU0000069", scac:"MAEU", size:"40ft HC", consignee:"Lear Corporation Arg.",            carrierName:"Maersk",          truckerScac:"LAND", trucker:"Log. Andina",       driver:"C. Ríos",      plate:"BE 889 WS", channel:"road",    appt:"13:00", gateStatus:"EXPECTED",    hoursToLFD:130, hold:null,      excl:null,                                          grossKg:28_600, isoType:"45G1", sealNumber:"MAE-773412" },
  { containerId:"CSNU0000070", scac:"CSNU", size:"20ft",    consignee:"Volkswagen Argentina",       carrierName:"Cosco Shipping",  truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"E. Méndez",    plate:"BF 221 YT", channel:"road",    appt:"13:30", gateStatus:"EXPECTED",    hoursToLFD:68,  hold:null,      excl:null,                                          grossKg:17_100, isoType:"22G1", sealNumber:"CSN-883201" },
  { containerId:"EGLV0000071", scac:"EGLV", size:"40ft",    consignee:"Siemens Argentina",          carrierName:"Evergreen",       truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"A. Lucero",    plate:"BG 443 WS", channel:"road",    appt:"14:00", gateStatus:"EXPECTED",    hoursToLFD:80,  hold:null,      excl:null,                                          grossKg:22_100, isoType:"42G1", sealNumber:"EGL-334102" },
  { containerId:"YMLU0000072", scac:"YMLU", size:"40ft HC", consignee:"ABB Argentina",              carrierName:"Yang Ming",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"B. Ledesma",   plate:"BH 885 KQ", channel:"sea",     appt:"14:15", gateStatus:"EXPECTED",    hoursToLFD:16,  hold:null,      excl:"Early documentation — BL pending bank release",grossKg:26_400, isoType:"45G1", sealNumber:"YML-112931" },
  { containerId:"HLXU0000073", scac:"HLXU", size:"20ft",    consignee:"Emerson Argentina",          carrierName:"Hapag-Lloyd",     truckerScac:"LAND", trucker:"Log. Andina",       driver:"C. Ríos",      plate:"BI 227 YT", channel:"road",    appt:"14:30", gateStatus:"EXPECTED",    hoursToLFD:92,  hold:null,      excl:null,                                          grossKg:14_900, isoType:"22G1", sealNumber:"HL-771033"  },
  { containerId:"MSCU0000074", scac:"MSCU", size:"40ft",    consignee:"Schneider Electric Arg.",    carrierName:"MSC",             truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"D. Barrios",   plate:"BJ 669 NM", channel:"road",    appt:"14:45", gateStatus:"EXPECTED",    hoursToLFD:44,  hold:null,      excl:null,                                          grossKg:20_800, isoType:"42G1", sealNumber:"MSC-220012" },
  { containerId:"OOLU0000075", scac:"OOLU", size:"40ft HC", consignee:"Honeywell Argentina",        carrierName:"OOCL",            truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"E. Méndez",    plate:"BK 112 JF", channel:"road",    appt:"15:00", gateStatus:"EXPECTED",    hoursToLFD:120, hold:null,      excl:null,                                          grossKg:25_200, isoType:"45G1", sealNumber:"OOC-882034" },
  { containerId:"TCLU0000076", scac:"TCLU", size:"20ft",    consignee:"Caterpillar Argentina",      carrierName:"Triton Container", truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"F. Altamirano",plate:"BL 554 WS", channel:"rail",    appt:"15:15", gateStatus:"EXPECTED",    hoursToLFD:28,  hold:"customs", excl:"AFIP hold — SIMI approval received, clearance completing", grossKg:16_300, isoType:"22G1", sealNumber:"TRI-991234" },
  { containerId:"CMAU0000077", scac:"CMAU", size:"40ft",    consignee:"Cummins Argentina",          carrierName:"CMA CGM",         truckerScac:"LAND", trucker:"Log. Andina",       driver:"G. Sandoval",  plate:"BM 886 KQ", channel:"road",    appt:"15:30", gateStatus:"EXPECTED",    hoursToLFD:60,  hold:null,      excl:null,                                          grossKg:23_500, isoType:"42G1", sealNumber:"CMA-443012" },
  { containerId:"MAEU0000078", scac:"MAEU", size:"40ft HC", consignee:"Parker Hannifin Arg.",       carrierName:"Maersk",          truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"H. Quiroga",   plate:"BN 228 YT", channel:"road",    appt:"15:45", gateStatus:"EXPECTED",    hoursToLFD:76,  hold:null,      excl:null,                                          grossKg:27_800, isoType:"45G1", sealNumber:"MAE-330091" },
  { containerId:"CSNU0000079", scac:"CSNU", size:"20ft",    consignee:"SKF Argentina",              carrierName:"Cosco Shipping",  truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"I. Soria",     plate:"BO 770 NM", channel:"road",    appt:"16:00", gateStatus:"EXPECTED",    hoursToLFD:52,  hold:null,      excl:null,                                          grossKg:15_700, isoType:"22G1", sealNumber:"CSN-110223" },
  { containerId:"EGLV0000080", scac:"EGLV", size:"40ft",    consignee:"NSK Argentina",              carrierName:"Evergreen",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"J. Álvarez",   plate:"BP 412 JF", channel:"sea",     appt:"16:15", gateStatus:"EXPECTED",    hoursToLFD:28,  hold:null,      excl:"Appointment window conflict — reschedule pending",grossKg:21_900, isoType:"42G1", sealNumber:"EGL-773904" },
  { containerId:"YMLU0000081", scac:"YMLU", size:"40ft HC", consignee:"NTN Argentina",              carrierName:"Yang Ming",       truckerScac:"LAND", trucker:"Log. Andina",       driver:"K. Peralta",   plate:"BQ 854 WS", channel:"road",    appt:"16:30", gateStatus:"EXPECTED",    hoursToLFD:100, hold:null,      excl:null,                                          grossKg:28_300, isoType:"45G1", sealNumber:"YML-009123" },
  { containerId:"HLXU0000082", scac:"HLXU", size:"20ft",    consignee:"Timken Argentina",           carrierName:"Hapag-Lloyd",     truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"L. Ferreyra",  plate:"BR 196 KQ", channel:"road",    appt:"16:45", gateStatus:"EXPECTED",    hoursToLFD:64,  hold:null,      excl:null,                                          grossKg:13_800, isoType:"22G1", sealNumber:"HL-221104"  },
  { containerId:"MSCU0000083", scac:"MSCU", size:"40ft",    consignee:"Knorr-Bremse Arg.",          carrierName:"MSC",             truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"M. Vargas",    plate:"BS 538 YT", channel:"road",    appt:"17:00", gateStatus:"EXPECTED",    hoursToLFD:88,  hold:null,      excl:null,                                          grossKg:22_600, isoType:"42G1", sealNumber:"MSC-880312" },
  { containerId:"OOLU0000084", scac:"OOLU", size:"40ft HC", consignee:"Hella Argentina",            carrierName:"OOCL",            truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"N. Vera",      plate:"BT 880 NM", channel:"road",    appt:"17:15", gateStatus:"EXPECTED",    hoursToLFD:112, hold:null,      excl:null,                                          grossKg:26_700, isoType:"45G1", sealNumber:"OOC-553921" },
  { containerId:"TCLU0000085", scac:"TCLU", size:"20ft",    consignee:"Plastic Omnium Arg.",        carrierName:"Triton Container", truckerScac:"LAND", trucker:"Log. Andina",       driver:"S. Ojeda",     plate:"BU 222 JF", channel:"rail",    appt:"17:30", gateStatus:"EXPECTED",    hoursToLFD:18,  hold:"damage",  excl:"Damage survey complete — minor dent, cleared for delivery", grossKg:17_400, isoType:"22G1", sealNumber:"TRI-441980" },
  { containerId:"CMAU0000086", scac:"CMAU", size:"40ft",    consignee:"Magna Córdoba",              carrierName:"CMA CGM",         truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"R. Paz",       plate:"BV 664 WS", channel:"road",    appt:"17:45", gateStatus:"EXPECTED",    hoursToLFD:40,  hold:null,      excl:null,                                          grossKg:24_400, isoType:"42G1", sealNumber:"CMA-992301" },
  { containerId:"MAEU0000087", scac:"MAEU", size:"40ft HC", consignee:"Fiat Argentina",             carrierName:"Maersk",          truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"A. Lucero",    plate:"BW 006 KQ", channel:"road",    appt:"18:00", gateStatus:"EXPECTED",    hoursToLFD:132, hold:null,      excl:null,                                          grossKg:29_000, isoType:"45G1", sealNumber:"MAE-112891" },
  { containerId:"CSNU0000088", scac:"CSNU", size:"40ft",    consignee:"John Deere Argentina",       carrierName:"Cosco Shipping",  truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"B. Ledesma",   plate:"BX 448 YT", channel:"sea",     appt:"18:15", gateStatus:"EXPECTED",    hoursToLFD:20,  hold:null,      excl:"Consignee customs agent not confirmed",        grossKg:23_200, isoType:"42G1", sealNumber:"CSN-334112" },
  { containerId:"EGLV0000089", scac:"EGLV", size:"20ft",    consignee:"CNH Industrial Arg.",        carrierName:"Evergreen",       truckerScac:"LAND", trucker:"Log. Andina",       driver:"C. Ríos",      plate:"BY 890 NM", channel:"road",    appt:"18:30", gateStatus:"EXPECTED",    hoursToLFD:56,  hold:null,      excl:null,                                          grossKg:16_600, isoType:"22G1", sealNumber:"EGL-009445" },
  { containerId:"YMLU0000090", scac:"YMLU", size:"40ft HC", consignee:"Case IH Argentina",          carrierName:"Yang Ming",       truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"D. Barrios",   plate:"BZ 132 JF", channel:"road",    appt:"18:45", gateStatus:"EXPECTED",    hoursToLFD:88,  hold:null,      excl:null,                                          grossKg:27_500, isoType:"45G1", sealNumber:"YML-881204" },
]

// ─── OUTBOUND — 31 containers ─────────────────────────────────────────────

const _OUTBOUND_BASE: GateContainerRow[] = [
  { containerId:"TCLU0000006", scac:"TCLU", size:"40ft HC", consignee:"Denso Sudamérica",        carrierName:"Triton Container", truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"P. Molina",    plate:"AC 883 MN", channel:"road",    appt:"06:00", gateStatus:"GATE_OUT",    hoursToLFD:0,   hold:null,      excl:null,                                          grossKg:23_400, isoType:"45G1", sealNumber:"TRI-661002" },
  { containerId:"OOLU0000008", scac:"OOLU", size:"20ft",    consignee:"Autopartes del Sur SA",   carrierName:"OOCL",            truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"J. Álvarez",   plate:"AF 421 KL", channel:"road",    appt:"06:15", gateStatus:"GATE_OUT",    hoursToLFD:2,   hold:null,      excl:null,                                          grossKg:14_200, isoType:"22G1", sealNumber:"OOC-019931" },
  { containerId:"MSCU0000005", scac:"MSCU", size:"40ft",    consignee:"Bosch Argentina",         carrierName:"MSC",             truckerScac:"LAND", trucker:"Log. Andina",       driver:"C. Ríos",      plate:"AM 330 BV", channel:"sea",     appt:"06:30", gateStatus:"SERVED",      hoursToLFD:8,   hold:null,      excl:"Weight discrepancy — reweigh in progress",    grossKg:26_800, isoType:"42G1", sealNumber:"MSC-002441" },
  { containerId:"HLXU0000004", scac:"HLXU", size:"20ft",    consignee:"ZF Pilar",                carrierName:"Hapag-Lloyd",     truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"E. Méndez",    plate:"AN 551 KQ", channel:"road",    appt:"06:45", gateStatus:"SERVED",      hoursToLFD:14,  hold:null,      excl:null,                                          grossKg:15_600, isoType:"22G1", sealNumber:"HL-773401"  },
  { containerId:"CMAU0000007", scac:"CMAU", size:"40ft HC", consignee:"Continental Arg.",        carrierName:"CMA CGM",         truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"H. Quiroga",   plate:"AO 882 YT", channel:"road",    appt:"07:00", gateStatus:"AT_POSITION", hoursToLFD:22,  hold:null,      excl:null,                                          grossKg:28_900, isoType:"45G1", sealNumber:"CMA-110938" },
  { containerId:"HLXU0000009", scac:"HLXU", size:"40ft",    consignee:"Valeo BA",                carrierName:"Hapag-Lloyd",     truckerScac:"LAND", trucker:"Log. Andina",       driver:"I. Soria",     plate:"AP 221 NM", channel:"road",    appt:"07:15", gateStatus:"AT_POSITION", hoursToLFD:36,  hold:null,      excl:null,                                          grossKg:19_700, isoType:"42G1", sealNumber:"HL-992215"  },
  { containerId:"MSCU0000000", scac:"MSCU", size:"20ft",    consignee:"Magna Rosario",           carrierName:"MSC",             truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"K. Peralta",   plate:"AQ 664 JF", channel:"road",    appt:"07:30", gateStatus:"CHECKED_IN",  hoursToLFD:48,  hold:null,      excl:null,                                          grossKg:16_100, isoType:"22G1", sealNumber:"MSC-880041" },
  { containerId:"CMAU0000002", scac:"CMAU", size:"40ft HC", consignee:"Autopartes del Sur SA",   carrierName:"CMA CGM",         truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"L. Ferreyra",  plate:"AB 774 JD", channel:"rail",    appt:"07:45", gateStatus:"CHECKED_IN",  hoursToLFD:6,   hold:"damage",  excl:"Damage survey in progress — surveyor on site",grossKg:24_300, isoType:"45G1", sealNumber:"CMA-554103" },
  { containerId:"TCLU0000001", scac:"TCLU", size:"40ft",    consignee:"Denso Sudamérica",        carrierName:"Triton Container", truckerScac:"LAND", trucker:"Log. Andina",       driver:"M. Vargas",    plate:"AR 117 WS", channel:"road",    appt:"08:00", gateStatus:"IN_QUEUE",    hoursToLFD:56,  hold:null,      excl:null,                                          grossKg:21_800, isoType:"42G1", sealNumber:"TRI-330991" },
  { containerId:"OOLU0000003", scac:"OOLU", size:"20ft",    consignee:"Bosch Argentina",         carrierName:"OOCL",            truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"N. Vera",      plate:"AJ 905 ZR", channel:"road",    appt:"08:15", gateStatus:"IN_QUEUE",    hoursToLFD:72,  hold:null,      excl:null,                                          grossKg:13_900, isoType:"22G1", sealNumber:"OOC-773290" },
  { containerId:"MAEU0000010", scac:"MAEU", size:"40ft HC", consignee:"Toyota Argentina",        carrierName:"Maersk",          truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"F. Altamirano",plate:"AK 213 FW", channel:"road",    appt:"08:30", gateStatus:"IN_QUEUE",    hoursToLFD:30,  hold:null,      excl:null,                                          grossKg:25_700, isoType:"45G1", sealNumber:"MAE-443012" },
  { containerId:"CSNU0000011", scac:"CSNU", size:"40ft",    consignee:"Pirelli Arg.",            carrierName:"Cosco Shipping",  truckerScac:"LAND", trucker:"Log. Andina",       driver:"G. Sandoval",  plate:"AL 774 RT", channel:"sea",     appt:"08:45", gateStatus:"APPROACHING", hoursToLFD:16,  hold:null,      excl:"Seal number mismatch — re-inspection required",grossKg:22_400, isoType:"42G1", sealNumber:"CSN-991043" },
  { containerId:"EGLV0000012", scac:"EGLV", size:"20ft",    consignee:"3M Argentina",            carrierName:"Evergreen",       truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"S. Ojeda",     plate:"AG 018 WX", channel:"road",    appt:"09:00", gateStatus:"APPROACHING", hoursToLFD:44,  hold:null,      excl:null,                                          grossKg:13_400, isoType:"22G1", sealNumber:"EGL-771204" },
  { containerId:"YMLU0000013", scac:"YMLU", size:"40ft HC", consignee:"Gestamp Argentina",        carrierName:"Yang Ming",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"D. Barrios",   plate:"AH 336 PL", channel:"road",    appt:"09:15", gateStatus:"APPROACHING", hoursToLFD:60,  hold:null,      excl:null,                                          grossKg:27_100, isoType:"45G1", sealNumber:"YML-220391" },
  { containerId:"HLXU0000014", scac:"HLXU", size:"40ft",    consignee:"Renault Argentina",        carrierName:"Hapag-Lloyd",     truckerScac:"LAND", trucker:"Log. Andina",       driver:"R. Paz",       plate:"AE 552 RB", channel:"road",    appt:"09:30", gateStatus:"EXPECTED",    hoursToLFD:80,  hold:null,      excl:null,                                          grossKg:20_900, isoType:"42G1", sealNumber:"HL-334801"  },
  { containerId:"MSCU0000015", scac:"MSCU", size:"20ft",    consignee:"Faurecia Argentina",        carrierName:"MSC",             truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"A. Lucero",    plate:"AN 334 BT", channel:"road",    appt:"09:45", gateStatus:"EXPECTED",    hoursToLFD:92,  hold:null,      excl:null,                                          grossKg:15_200, isoType:"22G1", sealNumber:"MSC-990234" },
  { containerId:"OOLU0000016", scac:"OOLU", size:"40ft HC", consignee:"Stellantis Argentina",         carrierName:"OOCL",            truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"B. Ledesma",   plate:"AO 556 NM", channel:"road",    appt:"10:00", gateStatus:"EXPECTED",    hoursToLFD:40,  hold:null,      excl:null,                                          grossKg:29_300, isoType:"45G1", sealNumber:"OOC-882301" },
  { containerId:"TCLU0000017", scac:"TCLU", size:"40ft",    consignee:"General Motors Arg.",            carrierName:"Triton Container", truckerScac:"LAND", trucker:"Log. Andina",       driver:"H. Quiroga",   plate:"AP 221 NM", channel:"sea",     appt:"10:15", gateStatus:"EXPECTED",    hoursToLFD:12,  hold:"customs", excl:"AFIP inspection hold — manifest query",        grossKg:22_700, isoType:"42G1", sealNumber:"TRI-112091" },
  { containerId:"CMAU0000018", scac:"CMAU", size:"20ft",    consignee:"PPG Industries Arg.",       carrierName:"CMA CGM",         truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"I. Soria",     plate:"AQ 664 JF", channel:"road",    appt:"10:30", gateStatus:"EXPECTED",    hoursToLFD:64,  hold:null,      excl:null,                                          grossKg:18_800, isoType:"22G1", sealNumber:"CMA-443910" },
  { containerId:"MAEU0000019", scac:"MAEU", size:"40ft HC", consignee:"Shell Argentina",         carrierName:"Maersk",          truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"K. Peralta",   plate:"AR 443 WS", channel:"road",    appt:"10:45", gateStatus:"EXPECTED",    hoursToLFD:52,  hold:null,      excl:null,                                          grossKg:26_600, isoType:"45G1", sealNumber:"MAE-330892" },
  { containerId:"CSNU0000020", scac:"CSNU", size:"40ft",    consignee:"Tenneco Argentina",        carrierName:"Cosco Shipping",  truckerScac:"LAND", trucker:"Log. Andina",       driver:"M. Coronel",   plate:"AD 190 QT", channel:"road",    appt:"11:00", gateStatus:"EXPECTED",    hoursToLFD:76,  hold:null,      excl:null,                                          grossKg:24_100, isoType:"42G1", sealNumber:"CSN-110934" },
  { containerId:"EGLV0000021", scac:"EGLV", size:"20ft",    consignee:"Eaton Argentina",         carrierName:"Evergreen",       truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"M. Vargas",    plate:"AS 885 YT", channel:"road",    appt:"11:15", gateStatus:"EXPECTED",    hoursToLFD:100, hold:null,      excl:null,                                          grossKg:14_700, isoType:"22G1", sealNumber:"EGL-881012" },
  { containerId:"YMLU0000022", scac:"YMLU", size:"40ft HC", consignee:"Scania Argentina",        carrierName:"Yang Ming",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"P. Giménez",   plate:"AT 227 NM", channel:"rail",    appt:"11:30", gateStatus:"EXPECTED",    hoursToLFD:24,  hold:null,      excl:null,                                          grossKg:27_900, isoType:"45G1", sealNumber:"YML-009812" },
  { containerId:"HLXU0000023", scac:"HLXU", size:"40ft",    consignee:"Volvo Group Arg.",        carrierName:"Hapag-Lloyd",     truckerScac:"LAND", trucker:"Log. Andina",       driver:"F. Altamirano",plate:"AU 669 JF", channel:"road",    appt:"11:45", gateStatus:"EXPECTED",    hoursToLFD:84,  hold:null,      excl:null,                                          grossKg:21_200, isoType:"42G1", sealNumber:"HL-220933"  },
  { containerId:"MSCU0000024", scac:"MSCU", size:"20ft",    consignee:"DB Schenker Arg.",   carrierName:"MSC",             truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"G. Sandoval",  plate:"AV 112 RT", channel:"road",    appt:"12:00", gateStatus:"EXPECTED",    hoursToLFD:58,  hold:null,      excl:null,                                          grossKg:16_400, isoType:"22G1", sealNumber:"MSC-774110" },
  { containerId:"OOLU0000025", scac:"OOLU", size:"40ft HC", consignee:"Kuehne+Nagel Arg.",        carrierName:"OOCL",            truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"S. Ojeda",     plate:"AW 334 BV", channel:"road",    appt:"12:15", gateStatus:"EXPECTED",    hoursToLFD:44,  hold:null,      excl:null,                                          grossKg:25_800, isoType:"45G1", sealNumber:"OOC-332011" },
  { containerId:"TCLU0000026", scac:"TCLU", size:"40ft",    consignee:"Bridgestone Arg.",        carrierName:"Triton Container", truckerScac:"LAND", trucker:"Log. Andina",       driver:"D. Barrios",   plate:"AX 776 KQ", channel:"road",    appt:"12:30", gateStatus:"EXPECTED",    hoursToLFD:32,  hold:null,      excl:null,                                          grossKg:20_300, isoType:"42G1", sealNumber:"TRI-881023" },
  { containerId:"CMAU0000027", scac:"CMAU", size:"20ft",    consignee:"Michelin Argentina",      carrierName:"CMA CGM",         truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"N. Vera",      plate:"AY 118 WS", channel:"sea",     appt:"12:45", gateStatus:"EXPECTED",    hoursToLFD:20,  hold:null,      excl:"Late documentation — BL not confirmed",        grossKg:17_900, isoType:"22G1", sealNumber:"CMA-663091" },
  { containerId:"MAEU0000028", scac:"MAEU", size:"40ft HC", consignee:"Lear Corporation Arg.",            carrierName:"Maersk",          truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"L. Ferreyra",  plate:"AZ 550 YT", channel:"road",    appt:"13:00", gateStatus:"EXPECTED",    hoursToLFD:68,  hold:null,      excl:null,                                          grossKg:28_100, isoType:"45G1", sealNumber:"MAE-112034" },
  { containerId:"CSNU0000029", scac:"CSNU", size:"40ft",    consignee:"Volkswagen Argentina",       carrierName:"Cosco Shipping",  truckerScac:"LAND", trucker:"Log. Andina",       driver:"R. Paz",       plate:"BA 221 NM", channel:"road",    appt:"13:30", gateStatus:"EXPECTED",    hoursToLFD:88,  hold:null,      excl:null,                                          grossKg:23_600, isoType:"42G1", sealNumber:"CSN-441203" },
  { containerId:"EGLV0000030", scac:"EGLV", size:"20ft",    consignee:"Toyota Argentina",        carrierName:"Evergreen",       truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"E. Méndez",    plate:"BB 663 JF", channel:"road",    appt:"14:00", gateStatus:"EXPECTED",    hoursToLFD:104, hold:null,      excl:null,                                          grossKg:14_500, isoType:"22G1", sealNumber:"EGL-220831" },
  { containerId:"YMLU0000031", scac:"YMLU", size:"40ft HC", consignee:"Bosch Argentina",         carrierName:"Yang Ming",       truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"P. Giménez",   plate:"BC 105 KQ", channel:"road",    appt:"14:15", gateStatus:"EXPECTED",    hoursToLFD:60,  hold:null,      excl:null,                                          grossKg:28_000, isoType:"45G1", sealNumber:"YML-334201" },
  { containerId:"HLXU0000032", scac:"HLXU", size:"20ft",    consignee:"3M Argentina",            carrierName:"Hapag-Lloyd",     truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"S. Ojeda",     plate:"BD 447 WS", channel:"sea",     appt:"14:30", gateStatus:"EXPECTED",    hoursToLFD:18,  hold:null,      excl:"Paperwork discrepancy — revised BL awaited",   grossKg:14_100, isoType:"22G1", sealNumber:"HL-991023"  },
  { containerId:"MSCU0000033", scac:"MSCU", size:"40ft",    consignee:"Denso Sudamérica",        carrierName:"MSC",             truckerScac:"LAND", trucker:"Log. Andina",       driver:"D. Barrios",   plate:"BE 889 YT", channel:"road",    appt:"14:45", gateStatus:"EXPECTED",    hoursToLFD:76,  hold:null,      excl:null,                                          grossKg:21_600, isoType:"42G1", sealNumber:"MSC-443820" },
  { containerId:"OOLU0000034", scac:"OOLU", size:"40ft HC", consignee:"Valeo BA",                carrierName:"OOCL",            truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"N. Vera",      plate:"BF 221 NM", channel:"road",    appt:"15:00", gateStatus:"EXPECTED",    hoursToLFD:88,  hold:null,      excl:null,                                          grossKg:26_300, isoType:"45G1", sealNumber:"OOC-773012" },
  { containerId:"TCLU0000035", scac:"TCLU", size:"20ft",    consignee:"Continental Arg.",        carrierName:"Triton Container", truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"L. Ferreyra",  plate:"BG 663 JF", channel:"rail",    appt:"15:15", gateStatus:"EXPECTED",    hoursToLFD:16,  hold:"customs", excl:"Customs clearance underway — verifier confirmed 13:30", grossKg:16_700, isoType:"22G1", sealNumber:"TRI-880903" },
  { containerId:"CMAU0000036", scac:"CMAU", size:"40ft",    consignee:"Faurecia Argentina",      carrierName:"CMA CGM",         truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"R. Paz",       plate:"BH 105 KQ", channel:"road",    appt:"15:30", gateStatus:"EXPECTED",    hoursToLFD:44,  hold:null,      excl:null,                                          grossKg:22_900, isoType:"42G1", sealNumber:"CMA-334102" },
  { containerId:"MAEU0000037", scac:"MAEU", size:"40ft HC", consignee:"Pirelli Arg.",            carrierName:"Maersk",          truckerScac:"LAND", trucker:"Log. Andina",       driver:"A. Lucero",    plate:"BI 447 WS", channel:"road",    appt:"15:45", gateStatus:"EXPECTED",    hoursToLFD:96,  hold:null,      excl:null,                                          grossKg:27_200, isoType:"45G1", sealNumber:"MAE-221034" },
  { containerId:"CSNU0000038", scac:"CSNU", size:"20ft",    consignee:"Gestamp Argentina",       carrierName:"Cosco Shipping",  truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"B. Ledesma",   plate:"BJ 889 YT", channel:"road",    appt:"16:00", gateStatus:"EXPECTED",    hoursToLFD:52,  hold:null,      excl:null,                                          grossKg:15_000, isoType:"22G1", sealNumber:"CSN-112034" },
  { containerId:"EGLV0000039", scac:"EGLV", size:"40ft",    consignee:"Renault Argentina",       carrierName:"Evergreen",       truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"H. Quiroga",   plate:"BK 221 NM", channel:"road",    appt:"16:15", gateStatus:"EXPECTED",    hoursToLFD:68,  hold:null,      excl:null,                                          grossKg:20_400, isoType:"42G1", sealNumber:"EGL-994312" },
  { containerId:"YMLU0000040", scac:"YMLU", size:"40ft HC", consignee:"Stellantis Argentina",    carrierName:"Yang Ming",       truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"I. Soria",     plate:"BL 663 JF", channel:"road",    appt:"16:30", gateStatus:"EXPECTED",    hoursToLFD:84,  hold:null,      excl:null,                                          grossKg:29_100, isoType:"45G1", sealNumber:"YML-440892" },
  { containerId:"HLXU0000041", scac:"HLXU", size:"20ft",    consignee:"General Motors Arg.",     carrierName:"Hapag-Lloyd",     truckerScac:"LAND", trucker:"Log. Andina",       driver:"K. Peralta",   plate:"BM 105 KQ", channel:"sea",     appt:"16:45", gateStatus:"EXPECTED",    hoursToLFD:24,  hold:null,      excl:"Inspection scheduled — bay 3 reserved",        grossKg:14_800, isoType:"22G1", sealNumber:"HL-332041"  },
  { containerId:"MSCU0000042", scac:"MSCU", size:"40ft",    consignee:"PPG Industries Arg.",     carrierName:"MSC",             truckerScac:"DSUR", trucker:"Drayage Sur",       driver:"M. Vargas",    plate:"BN 447 WS", channel:"road",    appt:"17:00", gateStatus:"EXPECTED",    hoursToLFD:72,  hold:null,      excl:null,                                          grossKg:21_100, isoType:"42G1", sealNumber:"MSC-663904" },
  { containerId:"OOLU0000043b", scac:"OOLU", size:"40ft HC", consignee:"Tenneco Argentina",      carrierName:"OOCL",            truckerScac:"EDPL", trucker:"Expreso del Plata", driver:"F. Altamirano",plate:"BO 889 YT", channel:"road",    appt:"17:15", gateStatus:"EXPECTED",    hoursToLFD:104, hold:null,      excl:null,                                          grossKg:25_900, isoType:"45G1", sealNumber:"OOC-112891" },
  { containerId:"TCLU0000044b", scac:"TCLU", size:"20ft",    consignee:"Scania Argentina",       carrierName:"Triton Container", truckerScac:"RIVA", trucker:"Transportes Rivas", driver:"G. Sandoval",  plate:"BP 221 NM", channel:"road",    appt:"17:30", gateStatus:"EXPECTED",    hoursToLFD:48,  hold:null,      excl:null,                                          grossKg:17_300, isoType:"22G1", sealNumber:"TRI-991801" },
  { containerId:"CMAU0000045b", scac:"CMAU", size:"40ft",    consignee:"Volvo Group Arg.",       carrierName:"CMA CGM",         truckerScac:"LAND", trucker:"Log. Andina",       driver:"J. Álvarez",   plate:"BQ 663 JF", channel:"road",    appt:"17:45", gateStatus:"EXPECTED",    hoursToLFD:80,  hold:null,      excl:null,                                          grossKg:23_700, isoType:"42G1", sealNumber:"CMA-881923" },
];

// ── Story gate rows ────────────────────────────────────────────────────────────

const _STORY_INBOUND: GateContainerRow[] = [
  {
    containerId:"EITU3333307", scac:"EGLV", size:"40ft HC",
    consignee:"Meridian Auto Parts", carrierName:"Evergreen",
    truckerScac:"SCAC1", trucker:"Seaboard Cartage Co.",
    driver:"A. Vega", plate:"CA 014 SC", channel:"road",
    appt:"14:00", gateStatus:"SERVED", hoursToLFD:96,
    hold:null, excl:null, grossKg:24_600, isoType:"45G1", sealNumber:"EIT-334120",
    story:true, asnReceivedAt:"2026-08-15T23:59", etaOriginal:"14:00", etaRevised:"14:15",
    chassis:"CB211111",
  },
  {
    containerId:"DAIU4444460", scac:"DAIU", size:"40ft",
    consignee:"Cordoba Industrial", carrierName:"DAL Shipping",
    truckerScac:"SCAC2", trucker:"Summit Container Lines",
    driver:"B. Castro", plate:"CB 088 SM", channel:"road",
    appt:"15:00", gateStatus:"AT_POSITION", hoursToLFD:108,
    hold:null, excl:"Early arrival — 35 min ahead of window",
    grossKg:21_900, isoType:"42G1", sealNumber:"DAI-771905",
    story:true, asnReceivedAt:"2026-08-15T23:59", etaOriginal:"15:00", etaRevised:"14:25",
    chassis:"CB22222",
  },
  {
    containerId:"GAIU7777765", scac:"GAIU", size:"20ft",
    consignee:"Rosario Logistics", carrierName:"Gold Star Line",
    truckerScac:"SCAC3", trucker:"Sierra Drayage Group",
    driver:"C. Mora", plate:"CC 152 SG", channel:"road",
    appt:"14:50", gateStatus:"EXPECTED", hoursToLFD:84,
    hold:null, excl:null, grossKg:16_400, isoType:"22G1", sealNumber:"GAI-220338",
    story:true, asnReceivedAt:"2026-08-16T05:30", etaOriginal:"14:50", etaRevised:"14:50",
    chassis:"CB211111",
  },
];

const _STORY_OUTBOUND: GateContainerRow[] = [
  {
    containerId:"MSCU1234566", scac:"MSCU", size:"40ft HC",
    consignee:"Denso Sudamérica", carrierName:"MSC",
    truckerScac:"SCAC1", trucker:"Seaboard Cartage Co.",
    driver:"R. Quintero", plate:"CA 014 SC", channel:"road",
    appt:"14:23", gateStatus:"GATE_OUT", hoursToLFD:6,
    hold:null, excl:null, grossKg:23_400, isoType:"45G1", sealNumber:"MSC-661002",
    story:true, chassis:"CABC54321",
    specialInstructions:"Reefer genset OFF — dry load. Deliver dock 4, appointment held.",
  },
];

// ── Reference ID lookup — ORD / SHP keyed by containerId (exported for live-row merge) ──
// ~60 % both · ~15 % orderId only · ~15 % shipmentId only · ~10 % neither
export const GATE_REF_IDS: Record<string, { orderId?: string; shipmentId?: string }> = {
  // ── Inbound ──────────────────────────────────────────────────────────────
  "OOLU0000043": { orderId:"ORD-441892", shipmentId:"SHP-220134" },
  "TCLU0000041": { orderId:"ORD-119032" },
  "MSCU0000040": { orderId:"ORD-774005", shipmentId:"SHP-330219" },
  "MSCU0000045": { shipmentId:"SHP-553318" },
  "HLXU0000044": { orderId:"ORD-091222", shipmentId:"SHP-448801" },
  // TCLU0000046  — neither
  "CMAU0000042": { orderId:"ORD-881045", shipmentId:"SHP-662234" },
  "CMAU0000047": { orderId:"ORD-330712" },
  "MAEU0000051": { orderId:"ORD-002109", shipmentId:"SHP-771008" },
  "CSNU0000052": { shipmentId:"SHP-441204" },
  "EGLV0000053": { orderId:"ORD-443901", shipmentId:"SHP-220918" },
  "YMLU0000054": { orderId:"ORD-990312", shipmentId:"SHP-663451" },
  // HLXU0000055  — neither
  "MSCU0000056": { orderId:"ORD-661034", shipmentId:"SHP-770891" },
  "OOLU0000057": { orderId:"ORD-112038" },
  "TCLU0000058": { orderId:"ORD-554217", shipmentId:"SHP-221045" },
  "CMAU0000059": { orderId:"ORD-773104", shipmentId:"SHP-119003" },
  "MAEU0000060": { shipmentId:"SHP-881002" },
  "CSNU0000061": { orderId:"ORD-220941", shipmentId:"SHP-442891" },
  "EGLV0000062": { orderId:"ORD-009312", shipmentId:"SHP-553120" },
  "YMLU0000063": { orderId:"ORD-441009", shipmentId:"SHP-664231" },
  "HLXU0000064": { orderId:"ORD-882211" },
  "MSCU0000065": { orderId:"ORD-330714", shipmentId:"SHP-881903" },
  "OOLU0000066": { shipmentId:"SHP-554891" },
  "TCLU0000067": { orderId:"ORD-009900", shipmentId:"SHP-220135" },
  "CMAU0000068": { orderId:"ORD-110234", shipmentId:"SHP-661092" },
  "MAEU0000069": { orderId:"ORD-773412", shipmentId:"SHP-330871" },
  "CSNU0000070": { orderId:"ORD-883201" },
  "EGLV0000071": { orderId:"ORD-334102", shipmentId:"SHP-441203" },
  "YMLU0000072": { shipmentId:"SHP-112931" },
  "HLXU0000073": { orderId:"ORD-771033", shipmentId:"SHP-882109" },
  "MSCU0000074": { orderId:"ORD-220012", shipmentId:"SHP-553804" },
  "OOLU0000075": { orderId:"ORD-882034", shipmentId:"SHP-220919" },
  "TCLU0000076": { orderId:"ORD-991234" },
  "CMAU0000077": { orderId:"ORD-443012", shipmentId:"SHP-771892" },
  "MAEU0000078": { shipmentId:"SHP-330091" },
  "CSNU0000079": { orderId:"ORD-110223", shipmentId:"SHP-442019" },
  "EGLV0000080": { orderId:"ORD-773904", shipmentId:"SHP-663120" },
  "YMLU0000081": { orderId:"ORD-009123", shipmentId:"SHP-880312" },
  "HLXU0000082": { orderId:"ORD-221104" },
  "MSCU0000083": { orderId:"ORD-880391", shipmentId:"SHP-443120" },
  "OOLU0000084": { shipmentId:"SHP-553921" },
  "TCLU0000085": { orderId:"ORD-441980", shipmentId:"SHP-221034" },
  "CMAU0000086": { orderId:"ORD-992301", shipmentId:"SHP-664012" },
  // MAEU0000087  — neither
  "CSNU0000088": { orderId:"ORD-334112" },
  "EGLV0000089": { orderId:"ORD-009445", shipmentId:"SHP-772019" },
  "YMLU0000090": { orderId:"ORD-881204", shipmentId:"SHP-334201" },

  // ── Outbound ─────────────────────────────────────────────────────────────
  "TCLU0000006": { orderId:"ORD-661002", shipmentId:"SHP-441923" },
  "OOLU0000008": { orderId:"ORD-019931" },
  "MSCU0000005": { orderId:"ORD-002441", shipmentId:"SHP-330712" },
  "HLXU0000004": { shipmentId:"SHP-773401" },
  "CMAU0000007": { orderId:"ORD-110938", shipmentId:"SHP-441092" },
  "HLXU0000009": { orderId:"ORD-992215", shipmentId:"SHP-663804" },
  // MSCU0000000  — neither
  "CMAU0000002": { orderId:"ORD-554103" },
  "TCLU0000001": { orderId:"ORD-330991", shipmentId:"SHP-221043" },
  "OOLU0000003": { shipmentId:"SHP-773290" },
  "MAEU0000010": { orderId:"ORD-443012", shipmentId:"SHP-882034" },
  "CSNU0000011": { orderId:"ORD-991043", shipmentId:"SHP-334892" },
  "EGLV0000012": { orderId:"ORD-771204" },
  "YMLU0000013": { orderId:"ORD-220391", shipmentId:"SHP-441023" },
  "HLXU0000014": { shipmentId:"SHP-334801" },
  "MSCU0000015": { orderId:"ORD-990234", shipmentId:"SHP-663019" },
  "OOLU0000016": { orderId:"ORD-882301", shipmentId:"SHP-441203" },
  "TCLU0000017": { orderId:"ORD-112091" },
  "CMAU0000018": { orderId:"ORD-443910", shipmentId:"SHP-880012" },
  "MAEU0000019": { shipmentId:"SHP-330892" },
  "CSNU0000020": { orderId:"ORD-110934", shipmentId:"SHP-662891" },
  // EGLV0000021  — neither
  "YMLU0000022": { orderId:"ORD-009812", shipmentId:"SHP-441290" },
  "HLXU0000023": { orderId:"ORD-220933" },
  "MSCU0000024": { orderId:"ORD-774110", shipmentId:"SHP-330893" },
  "OOLU0000025": { shipmentId:"SHP-332011" },
  "TCLU0000026": { orderId:"ORD-881023", shipmentId:"SHP-441924" },
  "CMAU0000027": { orderId:"ORD-663091" },
  "MAEU0000028": { orderId:"ORD-112034", shipmentId:"SHP-773012" },
  "CSNU0000029": { orderId:"ORD-441203", shipmentId:"SHP-663891" },
  "EGLV0000030": { shipmentId:"SHP-220831" },
  "YMLU0000031": { orderId:"ORD-334201", shipmentId:"SHP-881023" },
  "HLXU0000032": { orderId:"ORD-991023" },
  "MSCU0000033": { orderId:"ORD-443820", shipmentId:"SHP-220136" },
  "OOLU0000034": { orderId:"ORD-773012", shipmentId:"SHP-442891" },
  "TCLU0000035": { orderId:"ORD-880903" },
  // CMAU0000036  — neither
  "MAEU0000037": { orderId:"ORD-221034", shipmentId:"SHP-663120" },
  "CSNU0000038": { shipmentId:"SHP-112034" },
  "EGLV0000039": { orderId:"ORD-994312", shipmentId:"SHP-441025" },
  "YMLU0000040": { orderId:"ORD-440892", shipmentId:"SHP-882019" },
  "HLXU0000041": { orderId:"ORD-332041" },
  "MSCU0000042": { orderId:"ORD-663904", shipmentId:"SHP-441205" },
  "OOLU0000043b": { orderId:"ORD-112891", shipmentId:"SHP-330019" },
  "TCLU0000044b": { shipmentId:"SHP-991801" },
  "CMAU0000045b": { orderId:"ORD-881923", shipmentId:"SHP-663020" },

  // ── Story rows ────────────────────────────────────────────────────────────
  "EITU3333307": { orderId:"ORD-334120", shipmentId:"SHP-770891" },
  "DAIU4444460": { orderId:"ORD-771905", shipmentId:"SHP-441024" },
  "GAIU7777765": { orderId:"ORD-220338" },
  "MSCU1234566": { orderId:"ORD-661003", shipmentId:"SHP-440912" },
}

// ── Final merged exports (base + context + story) ─────────────────────────────

export const INBOUND_SEED: GateContainerRow[] = [
  ..._INBOUND_BASE.map(r => ({ ...r, ...GATE_REF_IDS[r.containerId] })),
  ...(CONTEXT_GATE_ROWS.filter(r => r.direction === "inbound") as GateContainerRow[]),
  ..._STORY_INBOUND.map(r => ({ ...r, ...GATE_REF_IDS[r.containerId] })),
];

export const OUTBOUND_SEED: GateContainerRow[] = [
  ..._OUTBOUND_BASE.map(r => ({ ...r, ...GATE_REF_IDS[r.containerId] })),
  ...(CONTEXT_GATE_ROWS.filter(r => r.direction === "outbound") as GateContainerRow[]),
  ..._STORY_OUTBOUND.map(r => ({ ...r, ...GATE_REF_IDS[r.containerId] })),
];
