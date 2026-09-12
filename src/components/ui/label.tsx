/**
 * Nerqia Label — Etiqueta de formulario con estilo propio
 *
 * API compatible con shadcn/ui Label:
 * - className: string
 * - htmlFor?: string
 * - children: React.ReactNode
 */
import { cn } from "@/lib/utils";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70 font-display",
        className,
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
export default Label;