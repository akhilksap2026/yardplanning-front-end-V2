import { useState, useEffect, useRef } from "react"
import { ALL_COLS, DEFAULT_COLS } from "@/utils/plannerHelpers"
import type { Col } from "@/utils/plannerHelpers"

export function usePlannerFilters() {
  const [q,              setQ]              = useState("")
  const [filter,         setFilter]         = useState("ALL")
  const [visibleCols,    setVisibleCols]    = useState<Set<Col>>(new Set(DEFAULT_COLS))
  const [colChooserOpen, setColChooserOpen] = useState(false)
  const colChooserRef = useRef<HTMLDivElement>(null)

  function toggleCol(col: Col) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(col)) { if (next.size > 2) next.delete(col) }
      else next.add(col)
      return next
    })
  }

  // Close column chooser on outside click
  useEffect(() => {
    if (!colChooserOpen) return
    function handler(e: MouseEvent) {
      if (colChooserRef.current && !colChooserRef.current.contains(e.target as Node)) {
        setColChooserOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [colChooserOpen])

  return {
    q, setQ,
    filter, setFilter,
    visibleCols, toggleCol,
    colChooserOpen, setColChooserOpen, colChooserRef,
    ALL_COLS,
  }
}
