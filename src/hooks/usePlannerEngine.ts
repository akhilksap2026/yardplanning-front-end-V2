import { useState, useEffect } from "react"
import { useData } from "@/lib/DataContext"
import { backendApi } from "@/lib/backend-api"
import type { BackendPlanDetail } from "@/lib/backend-api"

export type PlanSource = "seed" | "engine"

export function usePlannerEngine() {
  const { activePlan, generatePlan, confirmPlan } = useData()

  const [planSource,     setPlanSource]     = useState<PlanSource>("seed")
  const [generating,     setGenerating]     = useState(false)
  const [confirming,     setConfirming]     = useState(false)
  const [viewedPlan,     setViewedPlan]     = useState<BackendPlanDetail | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [engineSel,      setEngineSel]      = useState<number | null>(null)

  // Keep viewedPlan seeded from activePlan on first arrival
  useEffect(() => { setViewedPlan(prev => prev ?? activePlan) }, [activePlan])

  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    try {
      const plan = await generatePlan("cp_sat")
      if (plan) setViewedPlan(plan)
    } finally { setGenerating(false) }
  }

  async function handleConfirm() {
    if (!viewedPlan || confirming) return
    setConfirming(true)
    try {
      const ok = await confirmPlan(viewedPlan.id)
      if (ok) setViewedPlan(prev => prev ? { ...prev, status: "confirmed" } : prev)
    } finally { setConfirming(false) }
  }

  async function handleHistorySelect(planId: number) {
    if (historyLoading) return
    setHistoryLoading(true)
    try {
      const detail = await backendApi.plan(planId)
      setViewedPlan(detail)
    } catch (err) {
      console.error("[usePlannerEngine] history fetch failed:", err)
    } finally { setHistoryLoading(false) }
  }

  return {
    planSource, setPlanSource,
    generating,
    confirming,
    viewedPlan, setViewedPlan,
    historyLoading,
    engineSel, setEngineSel,
    handleGenerate, handleConfirm, handleHistorySelect,
  }
}
