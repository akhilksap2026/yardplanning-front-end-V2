/**
 * src/components/gate/GateInspection.tsx
 *
 * Gate Inspection checklist — pre-entry check for every inbound / outbound truck.
 * Covers exterior condition, seal integrity, documents, reefer / hazmat (conditional),
 * and safety / PPE. Every decision is recorded on the EIR.
 *
 * Integrated as the "Inspection" tab of GateConsole.
 * Data sourced from the existing `visits` seed, enriched with inspection-specific
 * fields (seal, reefer setpoint, hazmat info, PPE status) via INSP_DATA lookup.
 *
 * The three demo visits (V-2045 = reefer, V-2046 = DG/hazmat, V-2047 = seal
 * mismatch) intentionally mirror the HTML module spec and demonstrate all five
 * inspection paths in a single demo cycle.
 */

import { useState } from "react"
import type { ReactNode } from "react"
import { useData } from "@/lib/DataContext"
import type { Visit } from "@/data/yard-ops"

// ── Types ─────────────────────────────────────────────────────────────────────

interface HazmatInfo {
  un: string; cls: string; placards: string; declaration: boolean
}

interface InspEnrichment {
  containerType: string; cargo: string
  seal: string; docSeal: string
  setpoint: string | null; temp: string | null
  hazmat: HazmatInfo | null
  driverPPE: boolean; chocks: boolean
}

interface Finding {
  surface: string; note: string; severity: string
}

interface Props {
  onNavigate?: (target: string, focus?: string) => void
}

// ── Inspection enrichment by visit ID ────────────────────────────────────────
//
// V-2045 → Reefer 40′ HC (fresh berries, in-tolerance demo)
// V-2046 → Dry 20′ DG UN 1993 Class 3 (hazmat, missing placards + PPE gap demo)
// V-2047 → Dry 40′ (seal mismatch demo: physical AR500990 vs doc AR500991)
// Others → clean dry / empty, no exceptions

const INSP: Record<string, InspEnrichment> = {
  "V-2041": { containerType:"Dry 40′ GP",     cargo:"General goods",                       seal:"AR421778", docSeal:"AR421778", setpoint:null,      temp:null,      hazmat:null, driverPPE:true,  chocks:true },
  "V-2042": { containerType:"Dry 40′ GP",     cargo:"Auto parts",                          seal:"AR500999", docSeal:"AR500999", setpoint:null,      temp:null,      hazmat:null, driverPPE:true,  chocks:true },
  "V-2043": { containerType:"Empty 20′",      cargo:"Empty return",                        seal:"AR301882", docSeal:"AR301882", setpoint:null,      temp:null,      hazmat:null, driverPPE:true,  chocks:true },
  "V-2044": { containerType:"Dry 40′ HC",     cargo:"General cargo",                       seal:"AR500990", docSeal:"AR500990", setpoint:null,      temp:null,      hazmat:null, driverPPE:true,  chocks:true },
  "V-2045": { containerType:"Reefer 40′ HC",  cargo:"Fresh berries (perishable)",          seal:"AR421887", docSeal:"AR421887", setpoint:"-0.5 °C", temp:"-0.7 °C", hazmat:null, driverPPE:true,  chocks:true },
  "V-2046": { containerType:"Dry 20′",        cargo:"General DG — UN 1993 Class 3",        seal:"AR500214", docSeal:"AR500214", setpoint:null,      temp:null,      hazmat:{ un:"UN 1993", cls:"3 (Flammable liquid)", placards:"missing rear", declaration:true }, driverPPE:false, chocks:true },
  "V-2047": { containerType:"Dry 40′",        cargo:"Auto parts",                          seal:"AR500990", docSeal:"AR500991", setpoint:null,      temp:null,      hazmat:null, driverPPE:true,  chocks:true },
  "V-2048": { containerType:"Empty 20′ GP",   cargo:"Empty return",                        seal:"AR612004", docSeal:"AR612004", setpoint:null,      temp:null,      hazmat:null, driverPPE:true,  chocks:true },
}

const DEFAULT_INSP: InspEnrichment = {
  containerType:"Dry 40′ GP", cargo:"General cargo",
  seal:"AR000000", docSeal:"AR000000",
  setpoint:null, temp:null, hazmat:null,
  driverPPE:true, chocks:true,
}

// ── Damage-diagram surfaces ───────────────────────────────────────────────────

const SURFACES = [
  { id:"roof",      label:"ROOF",         left:"10%", top:"6%",  w:"80%", h:"18%" },
  { id:"front",     label:"FRONT",        left:"10%", top:"28%", w:"18%", h:"44%" },
  { id:"leftpanel", label:"LEFT PANEL",   left:"30%", top:"28%", w:"40%", h:"44%" },
  { id:"rear",      label:"REAR / DOORS", left:"72%", top:"28%", w:"18%", h:"44%" },
  { id:"chassis",   label:"CHASSIS",      left:"10%", top:"76%", w:"80%", h:"18%" },
]

// ── Seed state — mirrors HTML module demo ─────────────────────────────────────

const SEED_FINDINGS: Record<string, Finding[]> = {
  "COSU3308834": [{ surface:"REAR / DOORS", note:"Dent 15×20 cm above right cam bar",         severity:"Minor · noted"  }],
  "COSU9082309": [],
  "MAEU2210554": [{ surface:"LEFT PANEL",   note:"Scrape 40 cm — pre-existing per prior EIR",  severity:"Pre-existing"  }],
}

const SEED_DECS: Record<string, Record<string, string>> = {
  "V-2045": { seal:"match",    docs:"cleared", reefer:"in-tolerance"           },
  "V-2046": { seal:"match",    docs:"cleared", placards:"missing", ppe:"missing"},
  "V-2047": { seal:"mismatch", docs:"pending"                                  },
}

const INSPECTOR = "D. Vega · Gate Ops"

// ── Colour helpers ────────────────────────────────────────────────────────────

const INK   = "#111827"
const RED   = "#dc2626"
const AMBER = "#b88400"
const MUTED = "#6b7280"
const DIV   = "#e5e7eb"

function toneColor(tone: "danger" | "warn" | "") {
  return tone === "danger" ? RED : tone === "warn" ? AMBER : INK
}

// ── Option-button group ───────────────────────────────────────────────────────

function OptGroup({ stepKey, currentVal, opts, onSelect }: {
  stepKey: string
  currentVal: string | undefined
  opts: [string, string, "danger" | "warn" | ""][]
  onSelect: (key: string, val: string) => void
}) {
  return (
    <div style={{ display:"flex" }}>
      {opts.map(([val, label, tone], i) => {
        const active = currentVal === val
        const col    = toneColor(tone)
        return (
          <button key={val} onClick={() => onSelect(stepKey, val)} style={{
            fontSize:10.5, padding:"5px 10px", fontWeight:700, letterSpacing:"0.02em",
            border:`1px solid ${col}`,
            borderRight: i < opts.length - 1 ? "none" : `1px solid ${col}`,
            background: active ? col : "transparent",
            color: active ? "#fff" : col,
            cursor:"pointer", fontFamily:"inherit",
          }}>{label}</button>
        )
      })}
    </div>
  )
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ label, hint, value, valueColor, children }: {
  label: string; hint: string; value?: string; valueColor?: string; children?: ReactNode
}) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:"1px solid #f3f4f6" }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12, fontWeight:600 }}>{label}</div>
        <div style={{ fontSize:10.5, color:MUTED }}>{hint}</div>
      </div>
      {value !== undefined && (
        <span style={{ fontWeight:700, fontSize:13, color:valueColor || INK, minWidth:74, textAlign:"right" as const }}>{value}</span>
      )}
      {children}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ step, title, hint, stateLabel, stateColor }: {
  step: string; title: string; hint: string; stateLabel: string; stateColor: string
}) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:12, padding:"12px 20px 6px" }}>
      <span style={{ fontSize:10, letterSpacing:"0.11em", textTransform:"uppercase" as const, color:MUTED, fontWeight:700 }}>{step}</span>
      <span style={{ fontWeight:800, fontSize:15, letterSpacing:"-0.01em" }}>{title}</span>
      <span style={{ fontSize:10.5, color:MUTED }}>{hint}</span>
      <span style={{ marginLeft:"auto", fontSize:10.5, fontWeight:700, color:stateColor }}>{stateLabel}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GateInspection({ onNavigate }: Props) {
  const { visits } = useData()

  // Queue: visits not yet fully complete
  const queue = visits.filter(v => !["SERVED","GATE_OUT"].includes(v.state))

  const [selId,    setSelId]    = useState<string>(() => queue[2]?.id || queue[0]?.id || "V-2045")
  const [findings, setFindings] = useState<Record<string, Finding[]>>(SEED_FINDINGS)
  const [decs,     setDecs]     = useState<Record<string, Record<string, string>>>(SEED_DECS)
  const [outcome,  setOutcome]  = useState<Record<string, string>>({})

  const _found = queue.find(v => v.id === selId) || queue[0]
  if (!_found) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:MUTED }}>
      No visits in inspection queue
    </div>
  )
  const cur: Visit = _found

  const insp   = INSP[cur.id]   || DEFAULT_INSP
  const vDecs  = decs[cur.id]   || {}
  const vFinds = findings[cur.container] || []

  function setDec(key: string, val: string) {
    setDecs(s => ({ ...s, [cur.id]: { ...(s[cur.id] || {}), [key]: val } }))
  }

  function recordOutcome(kind: string) {
    setOutcome(s => ({ ...s, [cur.id]: kind }))
    if (kind === "admit" && onNavigate) onNavigate("gate", cur.container)
  }

  function toggleSurface(label: string) {
    setFindings(s => {
      const cf = s[cur.container] || []
      if (cf.find(x => x.surface === label)) {
        return { ...s, [cur.container]: cf.filter(x => x.surface !== label) }
      }
      return {
        ...s,
        [cur.container]: [...cf, { surface:label, note:`Damage noted on ${label.toLowerCase()}`, severity:"Minor · noted" }],
      }
    })
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const sealMatch = insp.seal === insp.docSeal
  const reeferOk  = !!(insp.setpoint && insp.temp &&
    Math.abs(parseFloat(insp.temp) - parseFloat(insp.setpoint)) < 0.5)

  const hasSpecialStep = !!(insp.setpoint || insp.hazmat)
  const safetyN = hasSpecialStep ? "05" : "04"

  const stepDefs = [
    { n:"01", label:"Exterior",  done: true },
    { n:"02", label:"Seal",      done: vDecs.seal === "match" },
    { n:"03", label:"Documents", done: vDecs.docs === "cleared" },
    insp.setpoint
      ? { n:"04", label:"Reefer",  done: vDecs.reefer === "in-tolerance" }
      : insp.hazmat
      ? { n:"04", label:"Hazmat",  done: vDecs.placards === "ok" }
      : null,
    { n:safetyN, label:"Safety", done: insp.driverPPE && vDecs.ppe !== "missing" },
  ].filter(Boolean) as { n:string; label:string; done:boolean }[]

  const completeCount = stepDefs.filter(s => s.done).length

  // Exceptions
  const exceptions: { k:string; v:string }[] = []
  if (!sealMatch)
    exceptions.push({ k:"Seal mismatch", v:`Physical ${insp.seal} vs document ${insp.docSeal} — hold, escalate to customs.` })
  if (insp.hazmat && vDecs.placards !== "ok")
    exceptions.push({ k:"Placards missing", v:`${insp.hazmat.placards} — driver replaces before entry.` })
  if (insp.setpoint && !reeferOk)
    exceptions.push({ k:"Cold-chain out of tolerance", v:`Return-air ${insp.temp} vs setpoint ${insp.setpoint}` })
  if (!insp.driverPPE || vDecs.ppe === "missing")
    exceptions.push({ k:"Driver PPE", v:"Hi-vis vest missing — issue at gate before release." })

  const verdict      = exceptions.length === 0 ? "Ready to admit" : exceptions.length === 1 ? "Admit with note" : "Hold at gate"
  const verdictColor = exceptions.length === 0 ? INK              : exceptions.length === 1 ? AMBER              : "#b91c1c"
  const verdictSub   = exceptions.length === 0
    ? `All checks clear. Issue gate pass and route to ${insp.setpoint ? "reefer row" : insp.hazmat ? "DG block" : "assigned lane"}.`
    : `${exceptions.length} open exception${exceptions.length === 1 ? "" : "s"} — resolve before barrier release.`

  const dec = outcome[cur.id]

  // Header strip fields
  const headerFields = [
    { k:"Visit",           v:cur.id,          sub:`${cur.plate} · ${cur.carrier}`,                              color:INK   },
    { k:"Container",       v:cur.container,   sub:insp.containerType,                                           color:INK   },
    { k:"Cargo",           v:insp.cargo,      sub:cur.purpose,                                                  color:INK   },
    { k:"Seal (physical)", v:insp.seal,       sub:sealMatch ? "matches BL" : `≠ BL ${insp.docSeal}`,           color:sealMatch ? INK : RED },
    insp.setpoint
      ? { k:"Reefer",      v:`${insp.temp} / ${insp.setpoint}`, sub:reeferOk?"in tolerance":"out of tolerance", color:reeferOk ? INK : RED }
      : insp.hazmat
      ? { k:"Hazmat",      v:insp.hazmat.un,  sub:`Class ${insp.hazmat.cls}`,                                   color:RED   }
      : { k:"Class",       v:"Standard dry",  sub:"no cold-chain / DG",                                         color:INK   },
    { k:"Inspection clock",v:"04′ 12″",       sub:"target 06′00″",                                              color:INK   },
  ].filter(Boolean) as { k:string; v:string; sub:string; color:string }[]

  // Summary sidebar rows
  const summaryRows: { k:string; v:string; mark:string; color:string }[] = [
    { k:"Exterior",    v:vFinds.length ? `${vFinds.length} finding(s)` : "Clean",             mark:vFinds.length ? RED : MUTED,                            color:INK },
    { k:"Seal",        v:sealMatch ? "Match" : "Mismatch",                                    mark:sealMatch ? INK : RED,                                  color:sealMatch ? INK : RED },
    { k:"Documents",   v:vDecs.docs === "cleared" ? "Cleared" : "Pending",                    mark:vDecs.docs === "cleared" ? INK : MUTED,                 color:INK },
    insp.setpoint
      ? { k:"Reefer",  v:reeferOk ? "In tolerance" : "Out of tolerance",                      mark:reeferOk ? INK : RED,                                   color:reeferOk ? INK : RED }
      : insp.hazmat
      ? { k:"Hazmat",  v:vDecs.placards === "ok" ? "Compliant" : "Placards missing",          mark:vDecs.placards === "ok" ? INK : RED,                    color:vDecs.placards === "ok" ? INK : RED }
      : { k:"Cargo class", v:"Standard dry",                                                   mark:MUTED,                                                  color:INK },
    { k:"Safety / PPE",v:(insp.driverPPE && vDecs.ppe !== "missing") ? "OK" : "Gap",          mark:(insp.driverPPE && vDecs.ppe !== "missing") ? INK : RED, color:(insp.driverPPE && vDecs.ppe !== "missing") ? INK : RED },
  ]

  // Photo grid
  const photos = [
    { label:"FRONT",   accent:false },
    { label:"LEFT",    accent:false },
    { label:"RIGHT",   accent:false },
    { label:"REAR",    accent:false },
    { label:"SEAL",    accent:false },
    { label:"ROOF",    accent:false },
    insp.setpoint ? { label:"DISPLAY",  accent:true  } : { label:"CHASSIS",  accent:false },
    insp.hazmat   ? { label:"PLACARDS", accent:true  } : { label:"DOCS",     accent:false },
  ]

  function dotFor(id: string) {
    const d = outcome[id]
    return d === "admit" ? "#0ea678" : d === "hold" ? AMBER : d === "reject" ? RED : "#9ca3af"
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0, overflow:"hidden", fontFamily:"inherit", color:INK, background:"#fff" }}>

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", gap:18, padding:"14px 20px 12px", borderBottom:`2px solid ${DIV}`, flex:"none" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <span style={{ fontWeight:800, fontSize:19, letterSpacing:"-0.015em" }}>Gate Inspection</span>
          <span style={{ fontSize:11, color:MUTED }}>Pre-entry check — exterior, seal, documents, cargo-specific compliance · every finding is recorded on the EIR</span>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const }}>
          <span style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:"#9ca3af" }}>Queue</span>
          {queue.map(v => {
            const active  = v.id === cur.id
            const qi      = INSP[v.id] || DEFAULT_INSP
            const short   = qi.containerType.split(" ")[0]
            return (
              <button key={v.id} onClick={() => setSelId(v.id)} style={{
                fontSize:11.5, padding:"5px 10px", border:`1px solid ${DIV}`,
                background:active ? INK : "transparent", color:active ? "#fff" : INK,
                cursor:"pointer", fontWeight:700, display:"inline-flex", alignItems:"center", gap:6, fontFamily:"inherit",
              }}>
                <span style={{ width:6, height:6, background:dotFor(v.id), display:"inline-block", borderRadius:1 }} />
                {v.id} · {short}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", padding:"8px 20px", borderBottom:`1px solid ${DIV}`, flex:"none", background:"#f9fafb" }}>
        <span style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:"#9ca3af", marginRight:12 }}>Progress</span>
        {stepDefs.map(s => (
          <div key={s.n} style={{ display:"flex", alignItems:"center", gap:8, paddingRight:14, marginRight:14, borderRight:`1px solid ${DIV}` }}>
            <span style={{ width:18, height:18, background:s.done?INK:"transparent", border:`1px solid ${s.done?INK:"#9ca3af"}`, color:s.done?"#fff":MUTED, fontSize:10, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit" }}>{s.n}</span>
            <span style={{ fontSize:11, fontWeight:600, color:s.done?INK:MUTED }}>{s.label}</span>
          </div>
        ))}
        <span style={{ marginLeft:"auto", fontSize:11, color:MUTED }}>{completeCount} / {stepDefs.length} complete</span>
      </div>

      {/* ── Container info strip ────────────────────────────────────────────── */}
      <div style={{ display:"flex", flexWrap:"wrap" as const, borderBottom:`2px solid ${DIV}`, flex:"none" }}>
        {headerFields.map(h => (
          <div key={h.k} style={{ flex:"1 1 150px", padding:"11px 20px", borderRight:`1px solid ${DIV}`, display:"flex", flexDirection:"column", gap:3 }}>
            <span style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:"#9ca3af" }}>{h.k}</span>
            <span style={{ fontWeight:800, fontSize:16, lineHeight:1.15, letterSpacing:"-0.01em", color:h.color }}>{h.v}</span>
            <span style={{ fontSize:10.5, color:MUTED }}>{h.sub}</span>
          </div>
        ))}
      </div>

      {/* ── Two-panel body ──────────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) clamp(320px,30vw,420px)", flex:"1 1 auto", minHeight:0, overflow:"hidden" }}>

        {/* ── LEFT: inspection sections ────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", minHeight:0, overflowY:"auto", borderRight:`2px solid ${DIV}` }}>

          {/* 01 — Exterior condition */}
          <div style={{ borderBottom:`2px solid ${DIV}` }}>
            <SectionHead step="01" title="Exterior condition" hint="Walk-around · roof, panels, doors, chassis"
              stateLabel={`${vFinds.length} finding${vFinds.length === 1 ? "" : "s"}`}
              stateColor={vFinds.length ? RED : MUTED} />
            <div style={{ display:"flex", gap:16, padding:"6px 20px 12px", alignItems:"flex-start" }}>
              {/* Damage diagram */}
              <div style={{ flex:"0 0 240px" }}>
                <div style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:MUTED, marginBottom:5 }}>Tap surface to log damage</div>
                <div style={{ position:"relative", border:"1px solid #9ca3af", background:"#fff", padding:10, height:200 }}>
                  {SURFACES.map(sf => {
                    const hit = vFinds.find(f => f.surface === sf.label)
                    return (
                      <button key={sf.id} onClick={() => toggleSurface(sf.label)} title={sf.label} style={{
                        position:"absolute", left:sf.left, top:sf.top, width:sf.w, height:sf.h,
                        background:hit ? "#fef2f2" : "#f9fafb",
                        border:`1px solid ${hit ? RED : "#9ca3af"}`,
                        cursor:"pointer", fontSize:9.5, fontWeight:700, color:hit ? RED : MUTED,
                        letterSpacing:"0.05em", display:"flex", alignItems:"flex-end",
                        justifyContent:"flex-start", padding:"2px 4px", fontFamily:"inherit",
                      }}>{sf.label}</button>
                    )
                  })}
                </div>
              </div>
              {/* Findings list */}
              <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
                {vFinds.map((f, i) => (
                  <div key={i} style={{
                    display:"flex", gap:10, alignItems:"baseline", padding:"6px 8px",
                    borderLeft:`3px solid ${f.severity.includes("Pre") ? MUTED : RED}`,
                    background:f.severity.includes("Pre") ? "#f3f4f6" : "#fef2f2",
                  }}>
                    <span style={{ fontSize:10.5, letterSpacing:"0.06em", fontWeight:700, color:f.severity.includes("Pre") ? INK : RED, width:90, flexShrink:0 }}>{f.surface}</span>
                    <span style={{ flex:1, fontSize:11.5 }}>{f.note}</span>
                    <span style={{ fontSize:10.5, color:MUTED }}>{f.severity}</span>
                  </div>
                ))}
                <div style={{ fontSize:11, color:MUTED, marginTop:4, lineHeight:1.5 }}>
                  {vFinds.length
                    ? "Findings are attached to the EIR with photo evidence. Pre-existing marks reference the prior interchange."
                    : "No damage recorded. Photo the four faces and continue."}
                </div>
              </div>
            </div>
          </div>

          {/* 02 — Seal integrity */}
          <div style={{ borderBottom:`2px solid ${DIV}` }}>
            <SectionHead step="02" title="Seal integrity" hint="Compare physical bolt seal against booking / BL"
              stateLabel={vDecs.seal === "match" ? "Match" : vDecs.seal === "mismatch" ? "Mismatch" : vDecs.seal === "broken" ? "Broken" : "Pending"}
              stateColor={vDecs.seal === "match" ? INK : RED} />
            <div style={{ display:"flex", flexDirection:"column", padding:"0 20px 12px" }}>
              <CheckRow label="Physical seal on right door" hint="Number stamped on bolt · verify intact" value={insp.seal} valueColor={INK}>
                <OptGroup stepKey="seal" currentVal={vDecs.seal}
                  opts={[["match","Matches",""],["mismatch","Does not match","danger"],["broken","Broken / tampered","danger"]]}
                  onSelect={setDec} />
              </CheckRow>
              <CheckRow label="Seal on document (BL / booking)" hint="As stated by shipper"
                value={insp.docSeal} valueColor={sealMatch ? INK : RED} />
              <div style={{ fontSize:11, color:MUTED, marginTop:6, lineHeight:1.5 }}>
                {sealMatch
                  ? "Numbers match. Continue to documents."
                  : "Mismatch — hold at gate, notify shift lead and CSR. Do not break seal without customs presence."}
              </div>
            </div>
          </div>

          {/* 03 — Documents */}
          <div style={{ borderBottom:`2px solid ${DIV}` }}>
            <SectionHead step="03" title="Documents" hint="Booking / BL, driver ID, transport order, customs release"
              stateLabel={vDecs.docs === "cleared" ? "Cleared" : "Pending"}
              stateColor={vDecs.docs === "cleared" ? INK : MUTED} />
            <div style={{ display:"flex", flexDirection:"column", padding:"0 20px 12px" }}>
              <CheckRow label="Booking / BL matches container" hint="Container number, size/type, party">
                <OptGroup stepKey="docBL" currentVal={vDecs.docBL || (vDecs.docs === "cleared" ? "ok" : undefined)}
                  opts={[["ok","OK",""],["issue","Issue","danger"]]} onSelect={setDec} />
              </CheckRow>
              <CheckRow label="Driver ID and transport order" hint="Photo ID + carrier assignment">
                <OptGroup stepKey="docId" currentVal={vDecs.docId || (vDecs.docs === "cleared" ? "ok" : undefined)}
                  opts={[["ok","OK",""],["issue","Issue","danger"]]} onSelect={setDec} />
              </CheckRow>
              <CheckRow label="Customs / release status" hint="AFIP release or export permit on file">
                <OptGroup stepKey="docCustoms" currentVal={vDecs.docCustoms || (vDecs.docs === "cleared" ? "ok" : undefined)}
                  opts={[["ok","Released",""],["hold","Held","warn"]]} onSelect={setDec} />
              </CheckRow>
            </div>
          </div>

          {/* 04 — Reefer cold-chain check (only when setpoint present) */}
          {insp.setpoint && (
            <div style={{ borderBottom:`2px solid ${DIV}` }}>
              <SectionHead step="04" title="Reefer — cold-chain check" hint="Perishable · setpoint, return-air, genset, fuel"
                stateLabel={reeferOk ? "In tolerance" : "Out of tolerance"}
                stateColor={reeferOk ? INK : RED} />
              <div style={{ display:"flex", flexDirection:"column", padding:"0 20px 12px" }}>
                <CheckRow label="Setpoint on box" hint="Booked temperature" value={insp.setpoint} />
                <CheckRow label="Return-air reading" hint="Tolerance ±0.5 °C" value={insp.temp!} valueColor={reeferOk ? INK : RED}>
                  <OptGroup stepKey="reefer" currentVal={vDecs.reefer}
                    opts={[["in-tolerance","In tolerance",""],["out","Out of tolerance","danger"]]} onSelect={setDec} />
                </CheckRow>
                <CheckRow label="Genset / clip-on" hint="Running, fuel > 40%" value="Running · 68%" />
                <CheckRow label="Data logger present" hint="USDA / partial-load trip">
                  <OptGroup stepKey="logger" currentVal={vDecs.logger || "ok"}
                    opts={[["ok","Present",""],["na","N/A",""]]} onSelect={setDec} />
                </CheckRow>
                <div style={{ fontSize:11, color:MUTED, marginTop:6, lineHeight:1.5 }}>
                  {reeferOk
                    ? "Cold chain is intact. Prioritize for a plug-in slot within 20 minutes of gate-in."
                    : "Out of tolerance — quarantine to reefer row and page cold-chain lead."}
                </div>
              </div>
            </div>
          )}

          {/* 04 — Hazmat / DG check (only when hazmat present, and no reefer) */}
          {insp.hazmat && !insp.setpoint && (
            <div style={{ borderBottom:`2px solid ${DIV}` }}>
              <SectionHead step="04" title="Hazmat — dangerous-goods check" hint={`${insp.hazmat.un} · Class ${insp.hazmat.cls}`}
                stateLabel={vDecs.placards === "ok" ? "Compliant" : "Non-compliant"}
                stateColor={vDecs.placards === "ok" ? INK : RED} />
              <div style={{ display:"flex", flexDirection:"column", padding:"0 20px 12px" }}>
                <CheckRow label="UN number & class on declaration" hint="Matches shipping papers" value={insp.hazmat.un}>
                  <OptGroup stepKey="dgDecl" currentVal={vDecs.dgDecl || "ok"}
                    opts={[["ok","Matches",""],["issue","Mismatch","danger"]]} onSelect={setDec} />
                </CheckRow>
                <CheckRow label="Placards on all four sides" hint="Front, rear, both sides — legible"
                  value={insp.hazmat.placards} valueColor={RED}>
                  <OptGroup stepKey="placards" currentVal={vDecs.placards || "missing"}
                    opts={[["ok","All present",""],["missing","Missing","danger"]]} onSelect={setDec} />
                </CheckRow>
                <CheckRow label="Segregation compatibility" hint="Row / block accepts this class">
                  <OptGroup stepKey="segreg" currentVal={vDecs.segreg || "ok"}
                    opts={[["ok","OK",""],["issue","Conflict","danger"]]} onSelect={setDec} />
                </CheckRow>
                <CheckRow label="Emergency response info (ERG)" hint="In cab, in language of transit">
                  <OptGroup stepKey="erg" currentVal={vDecs.erg || "ok"}
                    opts={[["ok","Present",""],["missing","Missing","danger"]]} onSelect={setDec} />
                </CheckRow>
                <div style={{ fontSize:11, color:MUTED, marginTop:6, lineHeight:1.5 }}>
                  {vDecs.placards === "ok"
                    ? "Cleared for entry — assign to DG block, not general dry stack."
                    : "Rear placard missing — driver must replace before entry. This is a stop-condition under IMDG / ADR."}
                </div>
              </div>
            </div>
          )}

          {/* 04 or 05 — Safety equipment & PPE */}
          <div style={{ borderBottom:`2px solid ${DIV}` }}>
            <SectionHead step={safetyN} title="Safety equipment & PPE" hint="Driver readiness before crossing the yard"
              stateLabel={(insp.driverPPE && vDecs.ppe !== "missing") ? "OK" : "PPE gap"}
              stateColor={(insp.driverPPE && vDecs.ppe !== "missing") ? INK : RED} />
            <div style={{ display:"flex", flexDirection:"column", padding:"0 20px 12px" }}>
              <CheckRow label="Driver PPE — hi-vis + hard hat + safety boots" hint="Visible before barrier release">
                <OptGroup stepKey="ppe" currentVal={vDecs.ppe || (insp.driverPPE ? "ok" : "missing")}
                  opts={[["ok","OK",""],["missing","Missing","danger"]]} onSelect={setDec} />
              </CheckRow>
              <CheckRow label="Wheel chocks in cab" hint="Required when uncoupling">
                <OptGroup stepKey="chocks" currentVal={vDecs.chocks || "ok"}
                  opts={[["ok","Present",""],["missing","Missing","warn"]]} onSelect={setDec} />
              </CheckRow>
              <CheckRow label="Twist-locks & pins" hint="Secured on chassis">
                <OptGroup stepKey="twistlocks" currentVal={vDecs.twistlocks || "ok"}
                  opts={[["ok","OK",""],["issue","Loose","danger"]]} onSelect={setDec} />
              </CheckRow>
              {insp.hazmat && (
                <CheckRow label="Fire extinguisher in cab" hint="Charged, in date · DG requirement">
                  <OptGroup stepKey="extinguisher" currentVal={vDecs.extinguisher || "ok"}
                    opts={[["ok","OK",""],["missing","Missing","danger"]]} onSelect={setDec} />
                </CheckRow>
              )}
            </div>
          </div>

        </div>

        {/* ── RIGHT: summary panel ─────────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", minHeight:0, overflowY:"auto" }}>

          {/* Verdict */}
          <div style={{ padding:"14px 16px 10px" }}>
            <div style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:MUTED }}>Inspection summary</div>
            <div style={{ fontWeight:800, fontSize:22, letterSpacing:"-0.02em", marginTop:2, color:verdictColor }}>{verdict}</div>
            <div style={{ fontSize:11.5, color:MUTED, marginTop:3 }}>{verdictSub}</div>
          </div>

          {/* Summary rows */}
          <div style={{ borderTop:`2px solid ${DIV}` }}>
            {summaryRows.map(row => (
              <div key={row.k} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 16px", borderBottom:"1px solid #f3f4f6", fontSize:11.5 }}>
                <span style={{ width:6, height:22, background:row.mark, flex:"none" }} />
                <span style={{ flex:1 }}>{row.k}</span>
                <span style={{ fontWeight:600, color:row.color }}>{row.v}</span>
              </div>
            ))}
          </div>

          {/* Photo evidence */}
          <div style={{ padding:"12px 16px 6px", fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:MUTED }}>Photo evidence</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:5, padding:"0 16px 12px" }}>
            {photos.map(p => (
              <div key={p.label} style={{
                aspectRatio:"1", background:p.accent ? "#fef2f2" : "#e5e7eb",
                border:`1px solid ${p.accent ? RED : "#9ca3af"}`,
                display:"flex", alignItems:"flex-end", padding:4,
                fontSize:9.5, color:p.accent ? RED : MUTED, fontWeight:600, letterSpacing:"0.03em",
              }}>{p.label}</div>
            ))}
          </div>

          {/* Open exceptions */}
          {exceptions.length > 0 && (
            <div style={{ padding:"10px 16px", background:"#fef2f2", borderTop:`2px solid ${RED}`, borderBottom:`1px solid ${RED}` }}>
              <div style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:"#991b1b", fontWeight:700 }}>
                Open exceptions ({exceptions.length})
              </div>
              {exceptions.map((e, i) => (
                <div key={i} style={{ fontSize:11.5, marginTop:5, color:"#991b1b", lineHeight:1.45 }}>
                  <strong>{e.k}</strong> — {e.v}
                </div>
              ))}
            </div>
          )}

          {/* Sign-off */}
          <div style={{ padding:"12px 16px 6px", fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, color:MUTED }}>Sign-off</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, padding:"0 16px 10px" }}>
            <div style={{ border:"1px solid #d1d5db", padding:"6px 8px" }}>
              <div style={{ fontSize:10, color:MUTED, letterSpacing:"0.05em" }}>Inspector</div>
              <div style={{ fontSize:12, fontWeight:700 }}>{INSPECTOR}</div>
              <div style={{ height:1, background:INK, marginTop:12 }} />
              <div style={{ fontSize:9.5, color:MUTED, marginTop:2 }}>signed on tablet · 06:14</div>
            </div>
            <div style={{ border:"1px solid #d1d5db", padding:"6px 8px" }}>
              <div style={{ fontSize:10, color:MUTED, letterSpacing:"0.05em" }}>Driver</div>
              <div style={{ fontSize:12, fontWeight:700 }}>{cur.driver} · {cur.plate}</div>
              <div style={{ height:1, background:dec ? INK : "#d1d5db", marginTop:12 }} />
              <div style={{ fontSize:9.5, color:dec ? INK : MUTED, marginTop:2 }}>
                {dec ? "signed at gate · 06:14" : "awaiting signature"}
              </div>
            </div>
          </div>

          {/* Decision banner */}
          {dec && (
            <div style={{
              margin:"0 16px 8px",
              borderLeft:`3px solid ${dec==="admit"?"#0ea678":dec==="hold"?AMBER:RED}`,
              background:dec==="admit"?"#ecfdf5":dec==="hold"?"#fffbeb":"#fef2f2",
              padding:"8px 10px",
            }}>
              <div style={{ fontSize:10, letterSpacing:"0.09em", textTransform:"uppercase" as const, fontWeight:700, color:dec==="admit"?"#065f46":dec==="hold"?"#92400e":"#991b1b" }}>
                Decision recorded
              </div>
              <div style={{ fontSize:12, fontWeight:700, marginTop:2 }}>
                {dec === "admit"
                  ? `Admitted — routed to ${insp.setpoint ? "reefer row" : insp.hazmat ? "DG block" : "assigned lane"}`
                  : dec === "hold"
                  ? "Held at inspection bay"
                  : "Rejected at gate — turned away"}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"6px 16px 18px", marginTop:"auto" }}>
            <button onClick={() => recordOutcome("admit")} style={{
              fontSize:12, padding:"9px 12px", textAlign:"left" as const, fontWeight:700, fontFamily:"inherit",
              background:exceptions.length === 0 ? INK : "transparent",
              color:exceptions.length === 0 ? "#fff" : INK,
              border:`1px solid ${INK}`, cursor:"pointer", borderRadius:4,
            }}>
              {exceptions.length === 0 ? "Admit — issue gate pass" : "Admit with note"}
            </button>
            <button onClick={() => recordOutcome("hold")} style={{
              fontSize:12, padding:"9px 12px", textAlign:"left" as const, fontWeight:700, fontFamily:"inherit",
              background:"transparent", color:INK, border:"1px solid #d1d5db", cursor:"pointer", borderRadius:4,
            }}>
              Hold — park at inspection bay
            </button>
            <button onClick={() => recordOutcome("reject")} style={{
              fontSize:12, padding:"9px 12px", textAlign:"left" as const, fontWeight:600, fontFamily:"inherit",
              background:"transparent", color:"#991b1b", border:"1px solid #fecaca", cursor:"pointer", borderRadius:4,
            }}>
              Reject at gate — turn away
            </button>
            <div style={{ fontSize:11, color:MUTED, lineHeight:1.5, marginTop:4 }}>
              {exceptions.length === 0
                ? "On admit, the EIR is written and the visit moves to lane assignment."
                : "Each exception is stamped to the EIR — nothing is silently cleared. Driver signs on the tablet."}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
