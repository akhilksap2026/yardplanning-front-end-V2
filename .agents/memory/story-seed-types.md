---
name: Story seed type shapes
description: Actual field names on StoryPlan, ContextPlan, StoryShiftSummary — different from the "obvious" guesses
---

## StoryPlan (story-seed.ts)
- `code`, `title` (NOT `label`), `status: PlanStatus`, `startTime`, `endTime`, `startMin`, `endMin`, `crew: string[]`, `story: true`
- Optional: `supersededBy?`, `supersededAt?`
- NO `window`, NO `label`, NO `moves` field

## ContextPlan (context-seed.ts)
- `code`, `title` (NOT `label`), `status: ContextPlanStatus`, `startTime`, `endTime`, `startMin`, `endMin`, `crew: string[]`, `story: false`
- NO `window`, NO `label`, NO `moves` field

## StoryShiftSummary (story-seed.ts)
- `received`, `shipped`, `chassisReturned`, `chassisTotal`, `slotsReconciled: boolean`
- `disruptionsHandled`, `disruptionAvgResolveMin`, `plansExecuted: string[]`, `plansSuperseded: string[]`
- `closeTime: string`, `story: true`
- NO `asOf`, NO `shift`, NO `containersIn/Out`, NO `movesDone`, NO `avgCycle`, NO `planAdherence`, NO `detentionRisk`, NO `unresolved`

**Why:** These were the source of TS2339 errors in Step 5 screen rendering. The type was designed during seeding before screen rendering was planned — field names were chosen for narrative clarity, not screen labels.

**How to apply:** When using these types in JSX, derive display values:
- window → `` `${p.startTime}–${p.endTime}` ``
- moves → `stepsForPlan(p.code).length` (story) or `0` (context)
- KPI labels → map StoryShiftSummary fields to meaningful display strings in the consuming component
