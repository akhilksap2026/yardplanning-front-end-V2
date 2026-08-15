/**
 * gate-seed.ts
 * Realistic seed rows for the Inbound and Outbound container tabs.
 * IDs match the container_ids in planningResults.json so joins work correctly.
 */

export interface GateContainerRow {
  containerId:  string
  size:         string          // "20ft" | "40ft" | "40ft HC"
  consignee:    string          // owner / receiving company
  carrierName:  string          // shipping line
  trucker:      string          // road transport company
  driver:       string
  plate:        string          // truck license plate
  channel:      "verde" | "naranja" | "rojo"
  appt:         string          // "HH:MM" appointment window
  gateStatus:   "GATE_OUT" | "SERVED" | "AT_POSITION" | "CHECKED_IN" | "IN_QUEUE" | "APPROACHING" | "EXPECTED"
  hoursToLFD:   number          // negative = breached
  hold:         "customs" | "quality" | "damage" | null
  excl:         string | null   // gate exclusion note
  grossKg:      number
  isoType:      string
  sealNumber:   string
}

// ── Inbound containers ─────────────────────────────────────────────────────
// Coming into the yard for putaway. Mix of gate lifecycle states across the day.

export const INBOUND_SEED: GateContainerRow[] = [
  {
    containerId: "OOLU0000043",
    size: "40ft HC", consignee: "Bosch Argentina", carrierName: "OOCL",
    trucker: "Transportes Rivas", driver: "M. Coronel", plate: "AD 190 QT",
    channel: "verde", appt: "06:30", gateStatus: "GATE_OUT",
    hoursToLFD: 48, hold: null, excl: null,
    grossKg: 24_800, isoType: "45G1", sealNumber: "BRG-441892",
  },
  {
    containerId: "TCLU0000041",
    size: "20ft", consignee: "Magna Rosario", carrierName: "Triton Container",
    trucker: "Log. Andina", driver: "R. Paz", plate: "AE 552 RB",
    channel: "verde", appt: "06:45", gateStatus: "SERVED",
    hoursToLFD: 72, hold: null, excl: null,
    grossKg: 18_400, isoType: "22G1", sealNumber: "TRI-009341",
  },
  {
    containerId: "MSCU0000040",
    size: "40ft", consignee: "Denso Sudamérica", carrierName: "MSC",
    trucker: "Drayage Sur", driver: "L. Ferreyra", plate: "AB 774 JD",
    channel: "naranja", appt: "07:00", gateStatus: "AT_POSITION",
    hoursToLFD: 20, hold: "customs", excl: "Customs hold — pending ARCA release",
    grossKg: 21_200, isoType: "42G1", sealNumber: "MSC-774002",
  },
  {
    containerId: "MSCU0000045",
    size: "40ft HC", consignee: "Autopartes del Sur SA", carrierName: "MSC",
    trucker: "Transportes Rivas", driver: "S. Ojeda", plate: "AG 018 WX",
    channel: "verde", appt: "07:15", gateStatus: "CHECKED_IN",
    hoursToLFD: 96, hold: null, excl: null,
    grossKg: 27_600, isoType: "45G1", sealNumber: "MSC-553318",
  },
  {
    containerId: "HLXU0000044",
    size: "20ft", consignee: "ZF Pilar", carrierName: "Hapag-Lloyd",
    trucker: "Log. Andina", driver: "D. Barrios", plate: "AH 336 PL",
    channel: "verde", appt: "07:30", gateStatus: "IN_QUEUE",
    hoursToLFD: 60, hold: null, excl: null,
    grossKg: 16_900, isoType: "22G1", sealNumber: "HL-091222",
  },
  {
    containerId: "TCLU0000046",
    size: "40ft", consignee: "Continental Arg.", carrierName: "Triton Container",
    trucker: "Drayage Sur", driver: "N. Vera", plate: "AJ 905 ZR",
    channel: "verde", appt: "08:00", gateStatus: "APPROACHING",
    hoursToLFD: 84, hold: null, excl: null,
    grossKg: 22_300, isoType: "42G1", sealNumber: "TRI-223891",
  },
  {
    containerId: "CMAU0000042",
    size: "40ft HC", consignee: "Valeo BA", carrierName: "CMA CGM",
    trucker: "Transportes Rivas", driver: "F. Altamirano", plate: "AK 213 FW",
    channel: "rojo", appt: "08:30", gateStatus: "EXPECTED",
    hoursToLFD: -6, hold: "quality", excl: "LFD breached — priority putaway flagged",
    grossKg: 29_100, isoType: "45G1", sealNumber: "CMA-881045",
  },
  {
    containerId: "CMAU0000047",
    size: "20ft", consignee: "Magna Rosario", carrierName: "CMA CGM",
    trucker: "Log. Andina", driver: "G. Sandoval", plate: "AL 774 RT",
    channel: "verde", appt: "09:00", gateStatus: "EXPECTED",
    hoursToLFD: 120, hold: null, excl: null,
    grossKg: 17_500, isoType: "22G1", sealNumber: "CMA-330712",
  },
]

// ── Outbound containers ────────────────────────────────────────────────────
// Already in the yard, being staged for truck pickup / export loading.

export const OUTBOUND_SEED: GateContainerRow[] = [
  {
    containerId: "TCLU0000006",
    size: "40ft HC", consignee: "Denso Sudamérica", carrierName: "Triton Container",
    trucker: "Drayage Sur", driver: "P. Molina", plate: "AC 883 MN",
    channel: "verde", appt: "06:15", gateStatus: "GATE_OUT",
    hoursToLFD: 0, hold: null, excl: null,
    grossKg: 23_400, isoType: "45G1", sealNumber: "TRI-661002",
  },
  {
    containerId: "OOLU0000008",
    size: "20ft", consignee: "Autopartes del Sur SA", carrierName: "OOCL",
    trucker: "Transportes Rivas", driver: "J. Álvarez", plate: "AF 421 KL",
    channel: "verde", appt: "06:30", gateStatus: "GATE_OUT",
    hoursToLFD: 2, hold: null, excl: null,
    grossKg: 14_200, isoType: "22G1", sealNumber: "OOC-019931",
  },
  {
    containerId: "MSCU0000005",
    size: "40ft", consignee: "Bosch Argentina", carrierName: "MSC",
    trucker: "Log. Andina", driver: "C. Ríos", plate: "AM 330 BV",
    channel: "naranja", appt: "07:00", gateStatus: "SERVED",
    hoursToLFD: 8, hold: null, excl: "Weight discrepancy — reweigh in progress",
    grossKg: 26_800, isoType: "42G1", sealNumber: "MSC-002441",
  },
  {
    containerId: "HLXU0000004",
    size: "20ft", consignee: "ZF Pilar", carrierName: "Hapag-Lloyd",
    trucker: "Drayage Sur", driver: "E. Méndez", plate: "AN 551 KQ",
    channel: "verde", appt: "07:15", gateStatus: "AT_POSITION",
    hoursToLFD: 14, hold: null, excl: null,
    grossKg: 15_600, isoType: "22G1", sealNumber: "HL-773401",
  },
  {
    containerId: "CMAU0000007",
    size: "40ft HC", consignee: "Continental Arg.", carrierName: "CMA CGM",
    trucker: "Transportes Rivas", driver: "H. Quiroga", plate: "AO 882 YT",
    channel: "verde", appt: "07:30", gateStatus: "CHECKED_IN",
    hoursToLFD: 22, hold: null, excl: null,
    grossKg: 28_900, isoType: "45G1", sealNumber: "CMA-110938",
  },
  {
    containerId: "HLXU0000009",
    size: "40ft", consignee: "Valeo BA", carrierName: "Hapag-Lloyd",
    trucker: "Log. Andina", driver: "I. Soria", plate: "AP 221 NM",
    channel: "verde", appt: "08:00", gateStatus: "IN_QUEUE",
    hoursToLFD: 36, hold: null, excl: null,
    grossKg: 19_700, isoType: "42G1", sealNumber: "HL-992215",
  },
  {
    containerId: "MSCU0000000",
    size: "20ft", consignee: "Magna Rosario", carrierName: "MSC",
    trucker: "Drayage Sur", driver: "K. Peralta", plate: "AQ 664 JF",
    channel: "verde", appt: "08:30", gateStatus: "APPROACHING",
    hoursToLFD: 48, hold: null, excl: null,
    grossKg: 16_100, isoType: "22G1", sealNumber: "MSC-880041",
  },
  {
    containerId: "CMAU0000002",
    size: "40ft HC", consignee: "Autopartes del Sur SA", carrierName: "CMA CGM",
    trucker: "Transportes Rivas", driver: "L. Ferreyra", plate: "AB 774 JD",
    channel: "rojo", appt: "09:00", gateStatus: "EXPECTED",
    hoursToLFD: -12, hold: "damage", excl: "Damage code D4 — surveyor notified",
    grossKg: 24_300, isoType: "45G1", sealNumber: "CMA-554103",
  },
  {
    containerId: "TCLU0000001",
    size: "40ft", consignee: "Denso Sudamérica", carrierName: "Triton Container",
    trucker: "Log. Andina", driver: "M. Vargas", plate: "AR 117 WS",
    channel: "verde", appt: "09:30", gateStatus: "EXPECTED",
    hoursToLFD: 56, hold: null, excl: null,
    grossKg: 21_800, isoType: "42G1", sealNumber: "TRI-330991",
  },
  {
    containerId: "OOLU0000003",
    size: "20ft", consignee: "Bosch Argentina", carrierName: "OOCL",
    trucker: "Drayage Sur", driver: "N. Vera", plate: "AJ 905 ZR",
    channel: "verde", appt: "10:00", gateStatus: "EXPECTED",
    hoursToLFD: 72, hold: null, excl: null,
    grossKg: 13_900, isoType: "22G1", sealNumber: "OOC-773290",
  },
]
