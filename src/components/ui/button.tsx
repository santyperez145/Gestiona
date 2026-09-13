// Nerqia Button — Botón completamente propio, sin shadcn/ui
// Diseño: acento izquierdo, sombra sutil, bordes redondeados 10px, transición 200ms
// Usa tokens de diseño Nerqia: primary para acción principal, outline con border-border y bg-card.
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon" | "xs" | "full";
  asChild?: boolean;
}

// Variant classes for Nerqia Button
// La acción principal usa el token de color principal (`bg-primary`),
// outline usa `border-border` y `bg-card` para respetar la superficie,
// y secundario usa `bg-muted` para no competir con la acción principal.
export const buttonVariants = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
  outline: "border border-border bg-card text-foreground hover:bg-muted hover:border-primary/60",
  secondary: "bg-muted text-foreground hover:bg-muted/80 border border-border",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  link: "text-primary underline-offset-[3px] hover:text-primary/80",
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
          "inline-flex items-center justify-center whitespace-nowrap font-display transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:pointer-events-none",
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