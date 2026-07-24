import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // ── Base ─────────────────────────────────────────────────────────────────
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-medium " +
  "transition-all duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "disabled:pointer-events-none disabled:opacity-40 " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // ── Primary — theme-driven gradient + glow shadow ────────────────
        default:
          "gradient-gold text-primary-foreground font-semibold " +
          "shadow-gold " +
          "hover:brightness-110 hover:shadow-[0_4px_22px_-3px_hsl(var(--primary)/0.60)] " +
          "active:scale-[0.97] active:brightness-95",

        // ── Destructive ─────────────────────────────────────────────────
        destructive:
          "bg-destructive/85 text-destructive-foreground " +
          "shadow-[0_2px_10px_-2px_hsl(0_68%_50%/0.30)] " +
          "hover:bg-destructive hover:shadow-[0_4px_18px_-2px_hsl(0_68%_50%/0.42)] " +
          "active:scale-[0.97]",

        // ── Outline — dark bg, gold-tinted border on hover ──────────────
        outline:
          "border border-border/70 bg-transparent text-foreground/80 " +
          "hover:border-primary/35 hover:bg-primary/6 hover:text-primary " +
          "active:scale-[0.97]",

        // ── Secondary — muted dark fill ─────────────────────────────────
        secondary:
          "bg-secondary text-secondary-foreground " +
          "hover:bg-secondary/65 " +
          "active:scale-[0.97]",

        // ── Ghost — transparent, subtle hover ───────────────────────────
        ghost:
          "text-foreground/65 hover:bg-muted/70 hover:text-foreground " +
          "active:scale-[0.97]",

        // ── Link ────────────────────────────────────────────────────────
        link:
          "text-primary underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm:      "h-8 rounded-[7px] px-3 text-[13px]",
        lg:      "h-11 rounded-[9px] px-6 text-[15px]",
        xs:      "h-6 rounded-[6px] px-2 text-[11px] gap-1",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size:    "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
