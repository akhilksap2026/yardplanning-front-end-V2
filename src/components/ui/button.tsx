import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f46e5] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:     "bg-[#111827] text-white hover:bg-[#1f2937]",
        destructive: "bg-[#dc2626] text-white hover:bg-[#b91c1c]",
        outline:     "border border-[#d1d5db] bg-white text-[#374151] hover:bg-[#f9fafb]",
        secondary:   "border border-[#d1d5db] bg-white text-[#374151] hover:bg-[#f9fafb]",
        ghost:       "bg-transparent text-[#6b7280] hover:bg-black/[0.04] hover:text-[#111827] font-normal",
        brand:       "bg-[#4f46e5] text-white hover:bg-[#4338ca]",
      },
      size: {
        default: "h-9 px-4 py-2",           /* 36px — primary / secondary */
        sm:      "h-8 px-3 py-1.5 text-xs", /* 32px — ghost / toolbar */
        lg:      "h-10 px-5 py-2.5",        /* 40px — modal CTA */
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
