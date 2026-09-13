/**
 * Nerqia Switch — Interruptor propio
 * Diseño: pista acentuada, thumb animado con cobalto
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }>(
  ({ className, checked = false, onCheckedChange, disabled = false, ...props }, ref) => {
    return (
      <button
        ref={ref}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange?.(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-[2px] transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          checked
            ? "bg-primary border-primary"
            : "bg-transparent border-border/30 hover:border-border/60",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-lg transition-transform duration-200",
            checked && "translate-x-5",
            disabled && "opacity-50",
          )}
        />
      </button>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };