import * as React from "react";

import { cn } from "@/lib/utils";

// ── Input ────────────────────────────────────────────────────────────────────
// Bright, calm input treatment shared by filters, forms and data toolbars.

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // ── Base ──────────────────────────────────────────────────────
          "flex h-10 w-full rounded-[9px]",
          "border border-border/85",
          "bg-card/90",
          "px-3 py-2 text-[13px] text-foreground",
          // ── Placeholder ───────────────────────────────────────────────
          "placeholder:text-muted-foreground/55",
          // ── Focus — primary-colored aura, NOT the generic ring ─────────
          "transition-[border-color,box-shadow] duration-150",
          "focus-visible:outline-none",
          "hover:border-primary/25 focus-visible:border-primary/55",
          "focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.1)]",
          // ── States ────────────────────────────────────────────────────
          "disabled:cursor-not-allowed disabled:opacity-40",
          // ── File input ────────────────────────────────────────────────
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          // ── Number input — hide spinners ──────────────────────────────
          "[&[type=number]]:[-moz-appearance:textfield]",
          "[&[type=number]]::[&::-webkit-outer-spin-button]:appearance-none",
          "[&[type=number]]::[&::-webkit-inner-spin-button]:appearance-none",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
