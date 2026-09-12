/**
 * Nerqia Label — Etiqueta propia, sin shadcn/ui
 * Diseño: texto pequeño, transformado en mayúsculas, espaciado, peso y color del texto propios
 */
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8892a8] font-display",
        "block mb-1.5",
        className,
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
export default Label;