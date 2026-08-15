import { useState } from "react"
import { Button } from "@/components/ui/button"

const FACTORS = [
  { k: "Detention urgency",        w: 30, hint: "How close a container is to its free-time deadline" },
  { k: "Detention cost exposure",  w: 10, hint: "Weighted by which tariff tier the container is entering" },
  { k: "Hazmat handling",          w: 25, hint: "Outbound-due hazmat containers are prioritised highest" },
  { k: "Customer / order priority",w: 15, hint: "P1 customers moved first; P4 last" },
  { k: "Dig-out cost",             w: 12, hint: "Penalises moves that require clearing containers above" },
  { k: "Gate & appointment timing",w: 10, hint: "Trucks with imminent appointments move up the queue" },
  { k: "Customs clearance",        w:  8, hint: "Cleared containers only — awaiting inspection stays back" },
  { k: "Empty-return window",      w:  8, hint: "Empty containers due back today are treated as urgent" },
  { k: "Damage / quarantine",      w:  5, hint: "Damaged outbound-due containers routed to inspection lane" },
  { k: "Dwell time",               w:  3, hint: "Containers that have sat longest get a small boost" },
]

const GUARDRAILS = [
  { k: "Per job target turn around time",    v: "5 min",  hint: "Each individual job should complete within 5 minutes" },
  { k: "Per trailer target turn around time",v: "15 min", hint: "Each trailer visit should be fully served within 15 minutes" },
  { k: "Reassignment cap",                   v: "1 min",  hint: "Operators can only be reassigned within a 1-minute window" },
]

export default function WeightFactorsTab() {
  const [weights,   setWeights]   = useState(FACTORS.map(f => f.w))
  const [committed, setCommitted] = useState(false)

  const dirty = weights.some((w, i) => w !== FACTORS[i].w)

  return (
    <div className="grid flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns: "minmax(340px,1fr) clamp(260px,30vw,380px)" }}>

      {/* ── Left: priority sliders ─────────────────────────────────────────── */}
      <div className="border-r border-[#e5e7eb] overflow-auto pb-6">
        <div className="px-5 pt-4 pb-2">
          <div className="font-semibold text-[13.5px]">What matters most</div>
          <div className="text-[11.5px] text-neutral-500 mt-0.5">
            Drag a slider to raise or lower how much the engine values each factor. Higher weight = engine sequences that container type first.
          </div>
        </div>

        {FACTORS.map((f, i) => (
          <div key={f.k} className="px-5 py-3 border-b border-[#f3f4f6]">
            <div className="flex justify-between items-baseline mb-1">
              <span className="font-semibold text-[12.5px]">{f.k}</span>
              <span className={`font-mono font-bold text-[13px] ${weights[i] !== f.w ? "text-[#dc2626]" : "text-neutral-400"}`}>
                {weights[i]}
              </span>
            </div>
            <input type="range" min={0} max={40} value={weights[i]}
              onChange={e => {
                const w = [...weights]; w[i] = +e.target.value
                setWeights(w); setCommitted(false)
              }}
              className="w-full accent-[#111827]" />
            <div className="text-[11px] text-neutral-400 mt-1">{f.hint}</div>
          </div>
        ))}

        {/* Save */}
        <div className="px-5 pt-4 flex gap-2 items-center">
          <Button size="sm" className="text-xs" style={{ borderRadius: 5 }}
            onClick={() => setCommitted(true)}>
            {committed ? "✓ Saved" : dirty ? "Save changes" : "No changes"}
          </Button>
          {dirty && !committed && (
            <button className="text-[11px] text-neutral-400 hover:text-neutral-700"
              onClick={() => { setWeights(FACTORS.map(f => f.w)); setCommitted(false) }}>
              Reset to defaults
            </button>
          )}
        </div>
        {committed && (
          <div className="mx-5 mt-3 px-3 py-2 text-[12px] font-semibold border" style={{ background: "#f0fdf4", borderColor: "#059669", color: "#059669", borderRadius: 5 }}>
            ✓ Weights saved — applied on next plan run
          </div>
        )}
      </div>

      {/* ── Right: impact preview + guardrails ────────────────────────────── */}
      <div className="overflow-auto">

        {/* Impact preview */}
        <div className="px-5 pt-4 pb-2">
          <div className="font-semibold text-[13px]">Expected impact</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">How your changes shift the key numbers</div>
        </div>
        {[
          { k: "Detention exposure (72 h)", current: "$8.4k",  candidate: dirty ? "$6.1k"  : "$8.4k",  better: dirty  },
          { k: "Rehandles per move",        current: "0.31",   candidate: dirty ? "0.36"   : "0.31",   better: !dirty },
          { k: "Truck turn time (median)",  current: "13.4 m", candidate: dirty ? "13.9 m" : "13.4 m", better: !dirty },
          { k: "Moves resequenced",         current: "—",      candidate: dirty ? "34 of 96" : "—",    better: false  },
        ].map(s => (
          <div key={s.k} className="px-5 py-2.5 border-b border-[#f3f4f6]">
            <div className="text-[11.5px] font-semibold text-neutral-700">{s.k}</div>
            <div className="flex justify-between mt-0.5 text-[11.5px] font-mono">
              <span className="text-neutral-400">now  {s.current}</span>
              <span className={`font-bold ${dirty && !s.better ? "text-[#dc2626]" : dirty && s.better ? "text-[#059669]" : "text-neutral-400"}`}>
                est. {s.candidate}
              </span>
            </div>
          </div>
        ))}

        <div className="px-5 py-3 text-[11.5px] leading-relaxed text-neutral-600">
          {dirty
            ? "Raising detention urgency reduces exposure by ~$2.3k at the cost of slightly more rehandles per move. Good while tariff tiers are escalating."
            : "Adjust a weight above to see the trade-off. Nothing changes until you save, and the save applies to the next plan run only."}
        </div>

        {/* Engine guardrails */}
        <div className="px-5 pt-2 pb-1 border-t border-[#e5e7eb]">
          <div className="font-semibold text-[13px] mt-3 mb-0.5">Engine guardrails</div>
          <div className="text-[11px] text-neutral-400 mb-2">Fixed rules that prevent the engine from disrupting operators</div>
        </div>
        {GUARDRAILS.map(p => (
          <div key={p.k} className="px-5 py-2.5 border-b border-[#f3f4f6]">
            <div className="flex justify-between items-baseline">
              <span className="text-[12px] font-semibold">{p.k}</span>
              <span className="font-mono font-bold text-[12px]">{p.v}</span>
            </div>
            <div className="text-[10.5px] text-neutral-400 mt-0.5">{p.hint}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
