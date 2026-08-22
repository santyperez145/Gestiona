import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Compact action language shared by every authenticated surface.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-transparent text-sm font-medium " +
  "transition-[transform,background-color,border-color,color,box-shadow,filter] duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-40 " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The gradient follows the official workspace primary token.
        default:
          "gradient-gold border-primary/20 text-primary-foreground font-semibold shadow-gold " +
          "hover:-translate-y-px hover:brightness-105 hover:shadow-[0_10px_24px_-14px_hsl(var(--primary)/0.85)] " +
          "active:scale-[0.97] active:brightness-95",

        // ── Destructive ─────────────────────────────────────────────────
        destructive:
          "border-destructive/20 bg-destructive/90 text-destructive-foreground " +
          "shadow-[0_2px_10px_-2px_hsl(0_68%_50%/0.30)] " +
          "hover:bg-destructive hover:shadow-[0_4px_18px_-2px_hsl(0_68%_50%/0.42)] " +
          "active:scale-[0.97]",

        // Quiet actions stay visible on the bright marketplace canvas.
        outline:
          "border-border/80 bg-card/85 text-foreground/80 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] " +
          "hover:-translate-y-px hover:border-primary/35 hover:bg-primary/6 hover:text-primary " +
          "active:scale-[0.97]",

        // ── Secondary — muted dark fill ─────────────────────────────────
        secondary:
          "border-border/55 bg-secondary/80 text-secondary-foreground " +
          "hover:border-primary/20 hover:bg-secondary " +
          "active:scale-[0.97]",

        // ── Ghost — transparent, subtle hover ───────────────────────────
        ghost:
          "text-foreground/65 hover:border-border/55 hover:bg-muted/70 hover:text-foreground " +
          "active:scale-[0.97]",

        // ── Link ────────────────────────────────────────────────────────
        link:
          "text-primary underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm:      "h-8 rounded-[8px] px-3 text-[13px]",
        lg:      "h-11 rounded-[10px] px-6 text-[15px]",
        xs:      "h-6 rounded-[6px] px-2 text-[11px] gap-1",
        icon:    "h-10 w-10",
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
