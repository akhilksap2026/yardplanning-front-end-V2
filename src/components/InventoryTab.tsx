import { useMemo } from "react"
import { useData } from "@/lib/DataContext"
import type { Zone } from "@/data/yard-data"

// ── colour tokens (match design system) ──────────────────────────────────────
const BORDER  = "1px solid #e5e7eb"
const MUTED   = "#6b7280"
const RED     = "#dc2626"
const AMBER   = "#d97706"
const GREEN   = "#059669"
const NAVY    = "#111827"

// ── tiny shared primitives ────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white flex flex-col" style={{ border: BORDER, borderRadius: 5 }}>
      <div className="px-4 py-2 border-b" style={{ borderColor: "#e5e7eb" }}>
        <span className="font-semibold text-[13px]" style={{ color: NAVY }}>{title}</span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-[10.5px] font-semibold tracking-wide uppercase"
        style={{ color: MUTED, borderBottom: BORDER, background: "#f9fafb" }}>
      {children}
    </th>
  )
}

function Td({ children, mono, red, green, muted }: {
  children: React.ReactNode; mono?: boolean; red?: boolean; green?: boolean; muted?: boolean
}) {
  const color = red ? RED : green ? GREEN : muted ? MUTED : NAVY
  return (
    <td className={`px-4 py-2 text-[12px] align-middle${mono ? " font-mono" : ""}`}
        style={{ color, borderBottom: BORDER }}>
      {children}
    </td>
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-block px-2 py-0.5 text-[10.5px] font-semibold rounded"
          style={{ background: color + "15", color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  )
}

function UtilBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? RED : pct >= 70 ? AMBER : GREEN
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "#f3f4f6" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, background: color, height: "100%", borderRadius: 9999 }} />
      </div>
      <span className="text-[11px] font-mono" style={{ color, minWidth: 36, textAlign: "right" }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function InventoryTab() {
  const { containers, zones } = useData()

  // ── derived sets ────────────────────────────────────────────────────────────
  const aging      = useMemo(() => containers.filter(c => (c.ageDays  ?? 0) > 15).sort((a,b)=>(b.ageDays??0)-(a.ageDays??0)), [containers])
  const damaged    = useMemo(() => containers.filter(c => c.hold === "damage"),                                                   [containers])
  const highValue  = useMemo(() => containers.filter(c => c.highValue === true),                                                  [containers])
  const reefers    = useMemo(() => containers.filter(c => c.reefer === true),                                                     [containers])

  // Reefer compliance: all seed reefers have tempSetPoint "-18°C" and are in-tolerance in demo
  const reeferOk   = reefers.length   // all compliant in seed

  // ── zone slot availability ───────────────────────────────────────────────────
  // Exclude gate/staging lanes (R, S) — they are transient, not inventory positions
  const inventoryZones: Zone[] = useMemo(
    () => zones.filter(z => !["R","S"].includes(z.id)),
    [zones]
  )

  const slotStats = useMemo(() => {
    return inventoryZones.map(z => {
      const capacity  = z.blocks * z.rows * z.slots * z.maxTiers   // total stackable positions
      const occupied  = containers.filter(c => c.zone === z.id).length
      const free      = Math.max(0, capacity - occupied)
      const pct       = capacity > 0 ? (occupied / capacity) * 100 : 0
      return { zone: z, capacity, occupied, free, pct }
    })
  }, [inventoryZones, containers])

  // ── summary KPIs ─────────────────────────────────────────────────────────────
  const totalContainers = containers.length
  const totalFree       = slotStats.reduce((sum, s) => sum + s.free, 0)
  const totalCapacity   = slotStats.reduce((sum, s) => sum + s.capacity, 0)

  const kpis = [
    { label: "Total on-hand",    value: String(totalContainers),  sub: "all zones"            },
    { label: "Capacity free",    value: String(totalFree),        sub: `of ${totalCapacity}`, color: totalFree < 50 ? RED : undefined },
    { label: "Aging (>15 days)", value: String(aging.length),     sub: "dwells at risk",      color: aging.length > 0 ? AMBER : undefined },
    { label: "Holds",            value: String(damaged.length),   sub: "M&R / quarantine",    color: damaged.length > 0 ? RED : undefined },
  ]

  // ── zone display label (strip "Zone X — " prefix for brevity) ───────────────
  const shortName = (z: Zone) => z.name.replace(/^Zone [A-Z] — /, "")

  return (
    <div className="flex flex-col gap-4 p-5 overflow-auto h-full" style={{ background: "#f4f5f7" }}>

      {/* ── KPI strip ──────────────────────────────────────────────────────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {kpis.map(k => (
          <div key={k.label} className="bg-white px-4 py-3 flex flex-col gap-0.5" style={{ border: BORDER, borderRadius: 5 }}>
            <span className="text-[10.5px] font-semibold tracking-wide uppercase" style={{ color: MUTED }}>{k.label}</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-semibold leading-none" style={{ fontSize: 28, color: k.color ?? NAVY }}>{k.value}</span>
              <span className="text-[11px]" style={{ color: MUTED }}>{k.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 2: slot availability + reefer compliance ───────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr auto" }}>

        {/* Slot availability table */}
        <Card title="Slots available per zone">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Zone</Th>
                <Th>Capacity</Th>
                <Th>Occupied</Th>
                <Th>Free</Th>
                <Th>Utilisation</Th>
              </tr>
            </thead>
            <tbody>
              {slotStats.map(s => (
                <tr key={s.zone.id} className="hover:bg-[#f9fafb]">
                  <Td>
                    <span className="font-mono font-semibold mr-2" style={{ color: NAVY }}>{s.zone.id}</span>
                    <span style={{ color: MUTED, fontSize: 11 }}>{shortName(s.zone)}</span>
                  </Td>
                  <Td mono>{s.capacity}</Td>
                  <Td mono>{s.occupied}</Td>
                  <Td mono green={s.free > 20} red={s.free < 10}>{s.free}</Td>
                  <td className="px-4 py-2 align-middle" style={{ borderBottom: BORDER, minWidth: 140 }}>
                    <UtilBar pct={s.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Reefer compliance card */}
        <div className="bg-white flex flex-col gap-3 px-5 py-4" style={{ border: BORDER, borderRadius: 5, minWidth: 230 }}>
          <span className="font-semibold text-[13px]" style={{ color: NAVY }}>Reefer temp compliance</span>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold" style={{ fontSize: 36, color: GREEN }}>{reeferOk}</span>
            <div className="flex flex-col">
              <span className="text-[11.5px]" style={{ color: MUTED }}>of {reefers.length} within set point</span>
              <span className="text-[11px] font-semibold" style={{ color: GREEN }}>✓ All compliant</span>
            </div>
          </div>
          <div className="text-[11px] leading-relaxed" style={{ color: MUTED }}>
            Zone F · set point −18 °C<br />
            Genset log current · logger intact
          </div>
          {reefers.slice(0, 3).map(c => (
            <div key={c.id} className="flex items-center justify-between text-[11px]" style={{ borderTop: BORDER, paddingTop: 4 }}>
              <span className="font-mono" style={{ color: NAVY }}>{c.id}</span>
              <span style={{ color: GREEN, fontWeight: 600 }}>−18 °C ✓</span>
            </div>
          ))}
          {reefers.length > 3 && (
            <div className="text-[11px]" style={{ color: MUTED }}>+{reefers.length - 3} more units all compliant</div>
          )}
        </div>
      </div>

      {/* ── Row 3: aging + high-value side by side ─────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Aging containers */}
        <Card title={`Aging containers — dwell >15 days (${aging.length})`}>
          {aging.length === 0 ? (
            <div className="px-4 py-6 text-[12px]" style={{ color: MUTED }}>No containers dwelling over 15 days.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Container</Th>
                  <Th>Zone</Th>
                  <Th>Dwell days</Th>
                  <Th>Hold</Th>
                </tr>
              </thead>
              <tbody>
                {aging.map(c => (
                  <tr key={c.id} className="hover:bg-[#f9fafb]">
                    <Td mono>{c.id}</Td>
                    <td className="px-4 py-2 text-[12px] align-middle font-mono" style={{ borderBottom: BORDER }}>
                      <span className="font-semibold">{c.zone}</span>
                      <span className="text-[10.5px] ml-1" style={{ color: MUTED }}>{c.address}</span>
                    </td>
                    <Td mono red={(c.ageDays ?? 0) > 25}>{c.ageDays ?? "—"}</Td>
                    <td className="px-4 py-2 align-middle" style={{ borderBottom: BORDER }}>
                      {c.hold
                        ? <Pill label={c.hold} color={c.hold === "damage" ? RED : c.hold === "customs" ? AMBER : "#7c3aed"} />
                        : <span className="text-[11px]" style={{ color: MUTED }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* High-value units */}
        <Card title={`High-value units (${highValue.length})`}>
          {highValue.length === 0 ? (
            <div className="px-4 py-6 text-[12px]" style={{ color: MUTED }}>No high-value containers on record.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Container</Th>
                  <Th>Zone / address</Th>
                  <Th>ISO type</Th>
                  <Th>Dwell</Th>
                </tr>
              </thead>
              <tbody>
                {highValue.map(c => (
                  <tr key={c.id} className="hover:bg-[#f9fafb]">
                    <td className="px-4 py-2 text-[12px] align-middle" style={{ borderBottom: BORDER }}>
                      <span className="font-mono font-semibold" style={{ color: NAVY }}>{c.id}</span>
                      <span className="ml-2 text-[10px] font-semibold px-1 py-0.5 rounded" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>HV</span>
                    </td>
                    <td className="px-4 py-2 text-[12px] align-middle font-mono" style={{ borderBottom: BORDER }}>
                      <span className="font-semibold">{c.zone}</span>
                      <span className="text-[10.5px] ml-1" style={{ color: MUTED }}>{c.address}</span>
                    </td>
                    <Td mono muted={!c.isoType}>{c.isoType ?? "—"}</Td>
                    <Td mono muted={!c.ageDays}>{c.ageDays != null ? `${c.ageDays} d` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ── Row 4: M&R / damage holds ─────────────────────────────────────────── */}
      <Card title={`M&R / Quarantine holds (${damaged.length})`}>
        {damaged.length === 0 ? (
          <div className="px-4 py-6 text-[12px]" style={{ color: MUTED }}>No containers on damage hold.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Container</Th>
                <Th>Zone / address</Th>
                <Th>ISO type</Th>
                <Th>Damage code</Th>
                <Th>Hold reason</Th>
                <Th>Dwell</Th>
              </tr>
            </thead>
            <tbody>
              {damaged.map(c => (
                <tr key={c.id} className="hover:bg-[#fff7f7]">
                  <Td mono>{c.id}</Td>
                  <td className="px-4 py-2 text-[12px] align-middle font-mono" style={{ borderBottom: BORDER }}>
                    <span className="font-semibold">{c.zone}</span>
                    <span className="text-[10.5px] ml-1" style={{ color: MUTED }}>{c.address}</span>
                  </td>
                  <Td mono muted={!c.isoType}>{c.isoType ?? "—"}</Td>
                  <td className="px-4 py-2 align-middle" style={{ borderBottom: BORDER }}>
                    {c.damageCode
                      ? <span className="font-mono text-[11.5px] font-semibold" style={{ color: RED }}>{c.damageCode}</span>
                      : <span className="text-[11px]" style={{ color: MUTED }}>—</span>}
                  </td>
                  <td className="px-4 py-2 align-middle" style={{ borderBottom: BORDER }}>
                    <Pill label={c.hold ?? "damage"} color={RED} />
                  </td>
                  <Td mono muted={!c.ageDays}>{c.ageDays != null ? `${c.ageDays} d` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

    </div>
  )
}
