import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts"
import { SHIFT_ROI } from "@/data/plan-metrics"
import { InfoTip } from "@/components/InfoTip"

const { kpis, shift, monthly, positioning } = SHIFT_ROI

// ── Tooltip text ──────────────────────────────────────────────────────────────
const KPI_TIPS: Record<string, string> = {
  "Truck turn (median)":  "Half of all trucks were in and out faster than this time. Lower is better.",
  "Reshuffles":           "Extra lifts needed to reach a buried container. Fewer reshuffles = faster truck flow.",
  "Detention avoided":    "Money saved by getting containers out before their free-storage deadline expires.",
  "Machine-hours saved":  "Equipment hours freed up this shift compared to running jobs in first-in-first-out order.",
  "On-time departures":   "Share of trucks that left within their booked time window.",
  "Containers handled":   "Total containers moved through the yard during this shift.",
}

const GLANCE_TIPS: Record<string, string> = {
  "gate receptions":    "Trucks that arrived and checked in at the gate.",
  "outbound truck loads": "Loaded trucks that departed with cargo during the shift.",
  "reshuffles":         "Extra container moves needed to dig out blocked stock.",
  "shift start":        "Official start time of the planned shift.",
  "close":              "Time the last truck departed and the shift was closed.",
}

const MONTHLY_TIPS: Record<string, string> = {
  "detention avoided":   "Projected saving per month if every shift runs with this plan — no overstay fees paid to carriers.",
  "machine-hours saved": "Equipment hours recovered per month, freeing capacity for more containers.",
  "reshuffles avoided":  "Fewer wasted double-moves per month, reducing labour and wear on machinery.",
}

const CHART_TIPS: Record<string, string> = {
  "Truck turn time (P50)":
    "Median time from a truck's gate-in to gate-out. P50 means half of trucks were faster than this number.",
  "FIFO baseline (turn)":
    "What truck turns looked like before the optimizer, using first-in-first-out sequencing.",
  "Reshuffles":
    "Extra moves required to dig out containers that were buried under other cargo.",
  "FIFO baseline (reshuffles)":
    "Reshuffle count with unoptimized, first-in-first-out job sequencing.",
  "Extrapolated monthly":
    `Figures scaled from one shift × ${monthly.shifts} shifts to show full-month impact.`,
}

// ── Bar chart data ────────────────────────────────────────────────────────────
const TURN_CHART = [
  { label: "Optimized",     value: 13.8, fill: "#4f46e5" },
  { label: "FIFO baseline", value: 31.4, fill: "#e5e7eb" },
]
const RESHUFFLE_CHART = [
  { label: "Optimized",     value: 51,  fill: "#4f46e5" },
  { label: "FIFO baseline", value: 74,  fill: "#e5e7eb" },
]

// ── Tiny custom tooltip ───────────────────────────────────────────────────────
function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { value: number }[]; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: "var(--ds-fg, #111827)", color: "#fff",
      fontSize: 11, padding: "5px 10px", borderRadius: 5,
    }}>
      {payload[0].value}{unit}
    </div>
  )
}

export default function ShiftScorecard() {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--ds-surface)", display: "flex", flexDirection: "column" }}>

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>
          Shift scorecard
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Night shift, planned end-to-end — in money, not moves. Aug 15, 20:00 → 05:30 close.
        </div>
      </div>

      {/* ── 6 KPI cards ───────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3,1fr)",
        gap: 10, padding: "16px 24px 0", flexShrink: 0,
      }}>
        {kpis.map(k => (
          <div key={k.k} className="ds-card" style={{ padding: "12px 14px" }}>
            <div className="ds-label" style={{ marginBottom: 5, display: "inline-flex", alignItems: "center" }}>
              {k.k}
              {KPI_TIPS[k.k] && <InfoTip text={KPI_TIPS[k.k]} />}
            </div>
            <div className="ds-kpi" style={{ fontSize: 24, color: "var(--text-primary)" }}>{k.v}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{k.sub}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: k.good ? "#059669" : "#dc2626" }}>{k.delta}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Shift at a glance ─────────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 0", flexShrink: 0 }}>
        <div className="ds-card" style={{ padding: "12px 16px" }}>
          <div className="ds-label" style={{ marginBottom: 8 }}>Shift at a glance</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px" }}>
            {[
              { v: shift.received,     l: "gate receptions"                        },
              { v: shift.shipped,      l: "outbound truck loads"                   },
              { v: shift.reshuffles,   l: "reshuffles"                             },
              { v: shift.movesPlanned, l: `moves under plan ${shift.planExecuted}` },
              { v: shift.shiftStart,   l: "shift start"                            },
              { v: shift.closeTime,    l: "close"                                  },
            ].map(s => (
              <div key={s.l} style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
                  color: "var(--text-primary)",
                }}>{s.v}</span>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)", display: "inline-flex", alignItems: "center" }}>
                  {s.l}
                  {GLANCE_TIPS[s.l] && <InfoTip text={GLANCE_TIPS[s.l]} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Monthly extrapolation ─────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 0", flexShrink: 0 }}>
        <div className="ds-card" style={{ padding: "12px 16px" }}>
          <div className="ds-label" style={{ marginBottom: 8, display: "inline-flex", alignItems: "center" }}>
            Extrapolated monthly ({monthly.shifts} shifts)
            <InfoTip text={CHART_TIPS["Extrapolated monthly"]} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[
              { v: `$${monthly.detentionAvoidedK}k`, l: "detention avoided"   },
              { v: `${monthly.machineHoursSaved} h`, l: "machine-hours saved" },
              { v: `${monthly.reshufflesAvoided}`,   l: "reshuffles avoided"  },
            ].map(s => (
              <div key={s.l} style={{
                padding: "10px 14px", borderRadius: 8,
                background: "var(--ds-accent-bg)", border: "1px solid var(--ds-accent-border)",
              }}>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700,
                  color: "var(--ds-accent)", lineHeight: 1.1, marginBottom: 4,
                }}>{s.v}</div>
                <div className="ds-label" style={{ display: "inline-flex", alignItems: "center" }}>
                  {s.l}
                  {MONTHLY_TIPS[s.l] && <InfoTip text={MONTHLY_TIPS[s.l]} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bar charts: turn time + reshuffles ────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 10, padding: "12px 24px 0", flexShrink: 0,
      }}>

        {/* Truck turn time */}
        <div className="ds-card" style={{ padding: "12px 16px" }}>
          <div className="ds-label" style={{ marginBottom: 2, display: "inline-flex", alignItems: "center" }}>
            Truck turn time (P50)
            <InfoTip text={CHART_TIPS["Truck turn time (P50)"]} />
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 10 }}>
            minutes — lower is better
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={TURN_CHART} layout="vertical" margin={{ left: 0, right: 32, top: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="var(--ds-border)" strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 35]} tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                tickLine={false} axisLine={false} unit=" min" />
              <YAxis type="category" dataKey="label" width={80}
                tick={{ fontSize: 11, fill: "var(--text-primary)", fontWeight: 500 }}
                tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip unit=" min" />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={28}>
                {TURN_CHART.map(d => <Cell key={d.label} fill={d.fill} />)}
                <LabelList dataKey="value" position="right"
                  style={{ fontSize: 11, fontWeight: 700, fill: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
                  formatter={(v: unknown) => `${v} min`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, display: "inline-flex", alignItems: "center" }}>
            FIFO baseline = unoptimized sequencing
            <InfoTip text={CHART_TIPS["FIFO baseline (turn)"]} />
          </div>
        </div>

        {/* Reshuffles */}
        <div className="ds-card" style={{ padding: "12px 16px" }}>
          <div className="ds-label" style={{ marginBottom: 2, display: "inline-flex", alignItems: "center" }}>
            Reshuffles
            <InfoTip text={CHART_TIPS["Reshuffles"]} />
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 10 }}>
            premarshal + digout — lower is better
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={RESHUFFLE_CHART} layout="vertical" margin={{ left: 0, right: 32, top: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="var(--ds-border)" strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 90]} tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={80}
                tick={{ fontSize: 11, fill: "var(--text-primary)", fontWeight: 500 }}
                tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip unit="" />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={28}>
                {RESHUFFLE_CHART.map(d => <Cell key={d.label} fill={d.fill} />)}
                <LabelList dataKey="value" position="right"
                  style={{ fontSize: 11, fontWeight: 700, fill: "var(--text-primary)", fontFamily: "var(--font-mono)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, display: "inline-flex", alignItems: "center" }}>
            FIFO baseline = unoptimized sequencing
            <InfoTip text={CHART_TIPS["FIFO baseline (reshuffles)"]} />
          </div>
        </div>

      </div>

      {/* ── Positioning callout ────────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 20px", flexShrink: 0 }}>
        <div className="ds-card" style={{ padding: "12px 16px", borderLeft: "3px solid var(--ds-accent)" }}>
          <div className="ds-label" style={{ marginBottom: 6 }}>Where it sits vs your TMS</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.65 }}>
            {positioning}
          </div>
        </div>
      </div>

    </div>
  )
}
