/**
 * Nerqia Label — Etiqueta de formulario con estilo cockpit
 *
 * Tamaño reducido, transformado a mayúsculas, espaciado amplio,
 * diferenciable de estilos de fondo (primary/warm/teal/danger).
 */
import { cn } from "@/lib/utils";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  variant?: "primary" | "warm" | "teal" | "danger";
}

export default function NerqiaLabel({
  className,
  htmlFor,
  variant = "primary",
  children,
  ...props
}: LabelProps) {
  const variantClasses = {
    primary: "text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70 font-display",
    warm: "text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-500/70 font-display",
    teal: "text-[10px] font-semibold uppercase tracking-[0.1em] text-teal-500/70 font-display",
    danger: "text-[10px] font-semibold uppercase tracking-[0.1em] text-red-500/70 font-display",
  };

  return (
    <label
      htmlFor={htmlFor}
      className={cn(variantClasses[variant], "peer-disabled:cursor-not-allowed peer-disabled:opacity-50", className)}
      {...props}
    >
      {children}
    </label>
  );
}