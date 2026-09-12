/**
 * Nerqia Input — Input con estilo cockpit
 */
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Texto de ayuda bajo el input */
  helperText?: string;
  /** Label visible (opcional, para accesibilidad) */
  label?: string;
  /** Error state */
  error?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", helperText, label, error = false, id, disabled, ...props }, ref) => {
    const inputId = id || `nerqia-input-${Math.random().toString(36).slice(2, 9)}`;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    const baseClasses = cn(
      "flex h-10 w-full rounded-[8px] border bg-background px-3 py-2 text-sm",
      "placeholder:text-muted-foreground/60",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      "disabled:cursor-not-allowed disabled:opacity-60",
      "transition-all duration-200",
      error && "border-red-500/40 focus-visible:ring-red-500/30",
      !error && "border-border/70 hover:border-primary/30",
      className,
    );

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          type={type}
          className={baseClasses}
          disabled={disabled}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-[10px] text-red-500" role="alert">
            {helperText}
          </p>
        )}
        {!error && helperText && (
          <p id={helperId} className="mt-1 text-[10px] text-muted-foreground/80">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

// Export default y nombrado para compatibilidad
export { Input };
export default Input;