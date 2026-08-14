import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f46e5] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:     "bg-[#4f46e5] text-white hover:bg-[#4338ca] shadow-sm",
        destructive: "bg-[#dc2626] text-white hover:bg-[#b91c1c] shadow-sm",
        outline:     "border border-[#e5e7eb] bg-white text-[#374151] hover:bg-[#f9fafb] shadow-sm",
        secondary:   "border border-[#e5e7eb] bg-white text-[#374151] hover:bg-[#f9fafb] shadow-sm",
        ghost:       "hover:bg-[#f1f5f9] text-[#374151]",
        brand:       "bg-[#4f46e5] text-white hover:bg-[#4338ca] shadow-sm",
      },
      size: {
        default: "h-8 px-3 py-1.5 rounded-[6px]",
        sm:      "h-7 px-2.5 py-1 text-xs rounded-[5px]",
        lg:      "h-10 px-5 py-2 rounded-[6px]",
        icon:    "h-8 w-8 rounded-[6px]",
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
