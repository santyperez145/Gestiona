import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// ── Badge ────────────────────────────────────────────────────────────────────
// Nerqia status labels. Tinted surfaces with a thin border instead of the
// default pastel shadcn look. Higher contrast and more ownable.

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border " +
  "px-1.5 py-1 " +
  "text-[10px] font-semibold uppercase tracking-[0.07em] leading-none " +
  "transition-colors select-none",
  {
    variants: {
      variant: {
        default:     "bg-primary/12 text-primary border-primary/25",
        secondary:   "bg-secondary text-secondary-foreground border-secondary/55",
        destructive: "bg-destructive/12 text-destructive border-destructive/25",
        outline:     "bg-transparent text-foreground/70 border-border/60",
        success:     "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
        warning:     "bg-amber-500/12 text-amber-700 border-amber-500/28 dark:text-amber-300",
        blue:        "bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-300",
        purple:      "bg-primary/10 text-primary border-primary/22",
        warm:        "bg-[hsl(var(--nerqia-warm)/0.12)] text-[hsl(var(--nerqia-warm))] border-[hsl(var(--nerqia-warm)/0.30)]",
        teal:        "bg-[hsl(var(--nerqia-teal)/0.12)] text-[hsl(var(--nerqia-teal))] border-[hsl(var(--nerqia-teal)/0.30)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
