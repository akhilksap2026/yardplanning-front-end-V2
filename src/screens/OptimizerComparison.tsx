import { OPTIMIZER_VS_BASELINE } from "@/data/plan-metrics"

export default function OptimizerComparison() {
  const { rows, headline, objective } = OPTIMIZER_VS_BASELINE

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--ds-surface)", display: "flex", flexDirection: "column" }}>

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>
          Plan quality — optimizer vs. first-in-first-out
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Same 72 containers, same trucks. One planned by YMSNow, one run FIFO.
        </div>
      </div>

      {/* ── Headline KPI strip ─────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        gap: 10, padding: "16px 24px 4px", flexShrink: 0,
      }}>
        {[
          { label: "Moves saved",          value: `${headline.movesSaved} fewer moves`   },
          { label: "Reshuffles avoided",   value: `${headline.reshufflesSaved} fewer`    },
          { label: "Detention avoided",    value: `$${headline.detentionAvoidedK}k`      },
          { label: "Faster truck turns",   value: `${headline.turnFasterPct}% faster`    },
        ].map(c => (
          <div key={c.label} className="ds-card" style={{ padding: "12px 14px" }}>
            <div className="ds-label" style={{ marginBottom: 6 }}>{c.label}</div>
            <div className="ds-kpi" style={{ color: "#059669", fontSize: 22 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── Comparison table ──────────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 0", flexShrink: 0 }}>
        <div className="ds-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="ds-th" style={{ textAlign: "left",   width: "28%", paddingLeft: 16  }}>Metric</th>
                <th className="ds-th" style={{ textAlign: "right",  width: "18%" }}>YMSNow</th>
                <th className="ds-th" style={{ textAlign: "right",  width: "18%" }}>FIFO baseline</th>
                <th className="ds-th" style={{ textAlign: "right",  width: "18%" }}>Delta</th>
                <th className="ds-th" style={{ textAlign: "right",  width: "18%", paddingRight: 16 }}>Improvement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.metric}
                  style={{ background: i % 2 === 0 ? "transparent" : "var(--ds-surface-hover, #fafafa)" }}>
                  <td className="ds-td" style={{ paddingLeft: 16, fontWeight: 500 }}>
                    {r.metric}
                    {"optimized_note" in r && r.optimized_note && (
                      <span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)", fontWeight: 400, marginTop: 1 }}>
                        {r.optimized_note}
                      </span>
                    )}
                  </td>
                  {/* YMSNow — accent green */}
                  <td className="ds-td ds-mono" style={{ textAlign: "right", color: "#059669", fontWeight: 600 }}>
                    {r.optimized}
                  </td>
                  {/* Baseline — muted gray */}
                  <td className="ds-td ds-mono" style={{ textAlign: "right", color: "var(--text-muted)" }}>
                    {r.baseline}
                  </td>
                  {/* Delta */}
                  <td className="ds-td ds-mono" style={{ textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }}>
                    {r.delta}
                  </td>
                  {/* Improvement — accent chip */}
                  <td className="ds-td" style={{ textAlign: "right", paddingRight: 16 }}>
                    {r.pct ? (
                      <span style={{
                        display: "inline-block", fontSize: 11, fontWeight: 700,
                        padding: "2px 8px", borderRadius: 4,
                        background: "var(--ds-accent-bg)", color: "var(--ds-accent)",
                        border: "1px solid var(--ds-accent-border)",
                      }}>
                        {r.pct}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Objective weights panel ──────────────────────────────────── */}
      <div style={{ padding: "14px 24px 0", flexShrink: 0 }}>
        <div className="ds-card" style={{ padding: "14px 16px" }}>
          <div className="ds-label" style={{ marginBottom: 10 }}>What the optimizer minimized</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {objective.map(o => (
              <div key={o.k}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{o.k}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                    color: "var(--ds-accent)" }}>{o.pct}%</span>
                </div>
                <div style={{ height: 6, background: "var(--ds-border)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${o.pct}%`,
                    background: "var(--ds-accent)", borderRadius: 3,
                    transition: "width 400ms ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footnote ─────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 20px", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Baseline derived from the yard's own pre-optimizer truck-turn profile.
          Optimized figures from plan PLAN-20260815-01.
        </div>
      </div>

    </div>
  )
}
