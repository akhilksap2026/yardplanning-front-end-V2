import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded-full",
  {
    variants: {
      variant: {
        default:   "bg-[#eef2ff] text-[#4f46e5] border border-[#c7d2fe]",
        brand:     "bg-[#4f46e5] text-white",
        secondary: "bg-[#f1f5f9] text-[#475569] border border-[#e2e8f0]",
        outline:   "border border-[#e5e7eb] text-[#6b7280] bg-white",
        muted:     "bg-[#f3f4f6] text-[#6b7280]",
        amber:     "bg-[#fffbeb] text-[#b45309] border border-[#fde68a]",
        red:       "bg-[#fef2f2] text-[#dc2626] border border-[#fecaca]",
        green:     "bg-[#f0fdf4] text-[#059669] border border-[#bbf7d0]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
