/**
 * Nerqia Radio Group — Botones de opción propia
 * API: RadioGroup, RadioGroupItem, RadioGroupItem props { value, disabled, asChild }
 */
import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    ref={ref}
    className={cn(
      "flex items-center gap-1 rounded-[10px] border border-[#173aef]/20 bg-[rgba(23,58,239,0.1)] p-1",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173aef]/40 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-[#173aef]/30 bg-transparent hover:bg-[#173aef]/5 hover:text-[#173aef] transition-all duration-200",
      "data-[state=checked]:bg-[#173aef] data-[state=checked]:border-[#173aef] data-[state=checked]:text-white",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173aef]/40 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <Check className="h-3.5 w-3.5" />
    </RadioGroupPrimitive.Indicator>
    {children}
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };