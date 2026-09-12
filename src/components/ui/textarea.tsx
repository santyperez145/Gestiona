/**
 * Nerqia Textarea — Área de texto propia
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { forwardRef, useId } from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  helperText?: string;
  label?: string;
  error?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, helperText, label, error = false, id, disabled, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || `nerqia-textarea-${generatedId}`;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    const baseClasses = cn(
      "flex h-16 w-full rounded-[8px] border bg-card/90 px-3 py-2 text-sm resize-none",
      "placeholder:text-muted-foreground/60",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/55",
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
        <textarea
          id={inputId}
          ref={ref}
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
Textarea.displayName = "Textarea";

export { Textarea };
export default Textarea;