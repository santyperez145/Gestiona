import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// ── Badge ────────────────────────────────────────────────────────────────────
// Compact status labels with sufficient contrast in both themes.

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border " +
  "px-1.5 py-1 " +
  "text-[10px] font-semibold uppercase tracking-[0.06em] leading-none " +
  "transition-colors select-none",
  {
    variants: {
      variant: {
        default:     "bg-primary/14 text-primary border-primary/28",
        secondary:   "bg-secondary text-secondary-foreground border-secondary/60",
        destructive: "bg-destructive/12 text-destructive border-destructive/28",
        outline:     "bg-transparent text-foreground/70 border-border/60",
        success:     "bg-emerald-500/12 text-emerald-700 border-emerald-500/28 dark:text-emerald-300",
        warning:     "bg-amber-500/14 text-amber-700 border-amber-500/30 dark:text-amber-300",
        blue:        "bg-blue-500/12 text-blue-700 border-blue-500/28 dark:text-blue-300",
        purple:      "bg-violet-500/12 text-violet-700 border-violet-500/28 dark:text-violet-300",
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
