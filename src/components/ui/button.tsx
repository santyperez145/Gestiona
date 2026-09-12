/**
 * Nerqia Button — Botón completamente propio, sin shadcn/ui
 * Diseño: acento izquierdo, sombra sutil, bordes redondeados 10px, transición 200ms
 */
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon" | "xs" | "full";
  asChild?: boolean;
}

// Variant classes for Nerqia Button
export const buttonVariants = {
  default: "bg-[#173aef] text-white hover:bg-[#1430c7] shadow-[0_2px_14px_rgba(23,58,239,0.25)]",
  destructive: "bg-red-600 text-white hover:bg-red-700 shadow-[0_2px_14px_rgba(220,38,38,0.25)]",
  outline: "border-[1.5px] border-[#173aef]/40 bg-[#0b1120] text-[#173aef] hover:bg-[#173aef]/10 hover:border-[#173aef]/60",
  secondary: "bg-[#14b8a6]/15 text-[#14b8a6] hover:bg-[#14b8a6]/25 border border-[#14b8a6]/20",
  ghost: "text-[#b0bec5] hover:text-white hover:bg-white/5",
  link: "text-[#173aef] underline-offset-[3px] hover:text-[#14b8a6]",
};

// Size classes for Nerqia Button
export const buttonSizes = {
  default: "h-10 px-5 py-2.5 text-[13px] font-medium tracking-[0.01em] rounded-[10px]",
  sm: "h-8 px-3.5 py-1.5 text-[11px] rounded-[8px]",
  lg: "h-12 px-7 py-3 text-[14px] rounded-[12px]",
  icon: "h-10 w-10 rounded-[10px]",
  xs: "h-6 px-2 py-0.5 text-[10px] rounded-[6px]",
  full: "w-full h-10 rounded-[10px]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-display transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173aef]/40 disabled:opacity-40 disabled:pointer-events-none",
          buttonVariants[variant],
          buttonSizes[size],
          className,
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
export default Button;