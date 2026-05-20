import * as React from "react";

import { cn } from "@/lib/utils";

// ── Input ────────────────────────────────────────────────────────────────────
// Darker bg than the page, gold aura on focus instead of the generic ring.
// Slightly tighter height. Distinctive without being weird.

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // ── Base ──────────────────────────────────────────────────────
          "flex h-9 w-full rounded-[7px]",
          "border border-border/55",
          "bg-[hsl(228_26%_5.5%)]",
          "px-3 py-2 text-[13px] text-foreground",
          // ── Placeholder ───────────────────────────────────────────────
          "placeholder:text-muted-foreground/40",
          // ── Focus — gold aura, NOT the generic ring ───────────────────
          "transition-[border-color,box-shadow] duration-150",
          "focus-visible:outline-none",
          "focus-visible:border-primary/45",
          "focus-visible:shadow-[0_0_0_3px_hsl(38_82%_52%/0.08),inset_0_0_0_1px_hsl(38_82%_52%/0.12)]",
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
