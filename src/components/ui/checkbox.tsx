/**
 * Nerqia Checkbox — Casilla propia
 */
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-[6px] border-[1.5px] border-[#173aef]/30 bg-transparent transition-all duration-200 hover:border-[#173aef]/60 hover:bg-[#173aef]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173aef]/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#173aef] data-[state=checked]:border-[#173aef] data-[state=checked]:text-white data-[state=indeterminate]:bg-[#173aef] data-[state=indeterminate]:border-[#173aef] data-[state=indeterminate]:text-white",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3 w-3 stroke-[3]" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };