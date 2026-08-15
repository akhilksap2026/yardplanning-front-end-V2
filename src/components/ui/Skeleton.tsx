interface SkeletonProps {
  variant?: "text" | "kpi" | "row" | "card"
  className?: string
}

/**
 * Skeleton placeholder with animated shimmer.
 * Variants:
 *   text  — single short text line
 *   kpi   — KPI block (label + big number, matches KPI strip cell height)
 *   row   — full-width table/list row bar
 *   card  — taller card-height block
 */
export default function Skeleton({ variant = "text", className = "" }: SkeletonProps) {
  const base = "skeleton-shimmer rounded"

  if (variant === "kpi") {
    return (
      <div className={`flex-1 basis-36 px-5 py-2.5 flex flex-col gap-1.5 ${className}`}>
        <div className={`${base} h-2.5 w-20`} />
        <div className={`${base} h-7 w-12`} />
      </div>
    )
  }

  if (variant === "row") {
    return (
      <div className={`${base} h-[38px] w-full rounded-sm ${className}`} />
    )
  }

  if (variant === "card") {
    return (
      <div className={`${base} h-32 w-full rounded-md ${className}`} />
    )
  }

  // text
  return (
    <div className={`${base} h-3 w-3/4 ${className}`} />
  )
}
