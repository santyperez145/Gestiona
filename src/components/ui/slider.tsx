/**
 * Nerqia Slider — Slider propio, sin shadcn/ui
 * Diseño: pistas personalizadas, deslizador acentuado con cobalto
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps extends React.ComponentPropsWithoutRef<"div"> {
  min?: number;
  max?: number;
  step?: number;
  value?: number[];
  onValueChange?: (value: number[]) => void;
  className?: string;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ className, min = 0, max = 100, step = 1, value, onValueChange, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full rounded-full bg-[rgba(0,0,0,0.1)]",
          "after:content-[''] after:absolute after:inset-0 after:rounded-full after:bg-[rgba(0,0,0,0.2)]",
          "cursor-pointer select-none",
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "absolute left-1 top-1/2 -translate-y-1/2 rounded-full h-3.5 w-3.5 bg-[#173aef] transition-all duration-200 ease-out",
            "data-[state=active]:left-full data-[state=active]:translate-x-[-4px] data-[state=active]:scale-125",
            "[&>span]:pointer-events-none",
            className,
          )}
        >
          <div
            className={cn(
              "absolute left-1/2 top-1/2 -translate-x-1/2 h-px w-full bg-border/30 -translate-y-1/2 rounded-full transition-all duration-200 ease-in",
              "data-[state=active]:translate-y-1 data-[state=active]:bg-[#173aef]",
              className,
            )}
          />
        </div>
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };