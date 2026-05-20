import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// ── Badge ────────────────────────────────────────────────────────────────────
// Deliberately NOT round pills — rectangular labels like terminal status codes.
// Uses JetBrains Mono for a data-native feel. All-caps, very tight tracking.

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[3px] border " +
  "px-[5px] py-[2px] " +
  "text-[10px] font-bold font-mono uppercase tracking-[0.08em] leading-none " +
  "transition-colors select-none",
  {
    variants: {
      variant: {
        default:     "bg-primary/14 text-primary border-primary/28",
        secondary:   "bg-secondary text-secondary-foreground border-secondary/60",
        destructive: "bg-destructive/12 text-destructive border-destructive/28",
        outline:     "bg-transparent text-foreground/70 border-border/60",
        success:     "bg-success/12 text-success border-success/28",
        warning:     "bg-warning/12 text-warning border-warning/28",
        blue:        "bg-blue-500/12 text-blue-400 border-blue-500/28",
        purple:      "bg-violet-500/12 text-violet-400 border-violet-500/28",
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
