// plan-metrics.ts
// Single source of truth for optimizer vs baseline comparisons and shift ROI.
// All "optimized" figures are derived from the seeded fixture PLAN-20260815-01
// (174 moves, shift 20:00→05:30, 2 jockeys + 1 crane).
// Import from here — do not inline these values in screen components.

export const OPTIMIZER_VS_BASELINE = {
  rows: [
    { metric: "Moves",                            optimized: "174",      baseline: "228",      delta: "54 fewer",       pct: "24% less work",  better: "optimized" },
    { metric: "Reshuffles (premarshal + digout)",  optimized: "51",       baseline: "74",       delta: "23 fewer",       pct: "31% fewer",      better: "optimized" },
    { metric: "Detention exposure",                optimized: "$8.4k",    baseline: "$14.2k",   delta: "$5.8k avoided",  pct: "41% lower",      better: "optimized" },
    { metric: "Truck turn P50",                    optimized: "13.8 min", optimized_note: "vs 15.0 target", baseline: "31.4 min", delta: "17.6 min faster", pct: "56% faster", better: "optimized" },
    { metric: "Truck turn P90",                    optimized: "21.4 min", baseline: "52.8 min", delta: "31.4 min faster", pct: "59% faster",     better: "optimized" },
    { metric: "Machine-hours",                     optimized: "26.8 h",   baseline: "35.1 h",   delta: "8.3 h saved",    pct: "24% less",       better: "optimized" },
    { metric: "On-time departure",                 optimized: "96%",      baseline: "78%",      delta: "+18 pts",        pct: "",               better: "optimized" },
  ],
  headline: { movesSaved: 54, reshufflesSaved: 23, detentionAvoidedK: 5.8, turnFasterPct: 56 },
  objective: [
    { k: "Machine minutes",      pct: 40 },
    { k: "Weighted lateness",    pct: 25 },
    { k: "Predicted reshuffles", pct: 20 },
    { k: "Detention exposure",   pct: 15 },
  ],
};

export const SHIFT_ROI = {
  kpis: [
    { k: "Truck turn (median)", v: "13.8 min", sub: "baseline 31.4 min",              delta: "−56%",        good: true },
    { k: "Reshuffles",          v: "51",        sub: "baseline 74",                    delta: "−31%",        good: true },
    { k: "Detention avoided",   v: "$5.8k",     sub: "$8.4k vs $14.2k",               delta: "today",       good: true },
    { k: "Machine-hours saved", v: "8.3 h",     sub: "26.8 vs 35.1",                  delta: "−24%",        good: true },
    { k: "On-time departures",  v: "96%",       sub: "baseline 78%",                  delta: "+18 pts",     good: true },
    { k: "Containers handled",  v: "72",        sub: "174 moves · 2 jockeys · 1 reach stacker", delta: "100% planned", good: true },
  ],
  shift: {
    received: 73,
    shipped: 67,
    reshuffles: 51,
    movesPlanned: 174,
    planExecuted: "PLAN-20260815-01",
    shiftStart: "20:00",
    closeTime: "05:30",
  },
  monthly: {
    shifts: 21,
    detentionAvoidedK: 122,
    machineHoursSaved: 174,
    reshufflesAvoided: 483,
  },
  positioning: "YMSNow reads yard state, optimizes it, and writes moves back. It owns the yard and sits alongside your transportation plan — it does not replace your TMS.",
};
