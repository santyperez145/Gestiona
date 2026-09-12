/**
 * Nerqia Select — Select propio sin shadcn/ui
 *
 * API compatible con shadcn Select: Select, SelectTrigger, SelectValue, SelectContent, SelectItem
 */
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect, useId, forwardRef, createContext, useContext } from "react";
import { Portal } from "@/components/ui/portal";

interface SelectProps {
  children: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
}

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  children?: React.ReactNode;
}

interface SelectValueProps {
  placeholder?: string;
}

interface SelectContentProps {
  children: React.ReactNode;
  position?: "popper" | "item-aligned";
  sideOffset?: number;
  className?: string;
}

interface SelectItemProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

interface SelectLabelProps {
  children: React.ReactNode;
  className?: string;
}

interface SelectSeparatorProps {
  className?: string;
}

interface SelectGroupProps {
  children: React.ReactNode;
  className?: string;
}

// Context para compartir estado
const SelectContext = createContext<{
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

function useSelectContext() {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error("Select compounds must be used within Select");
  }
  return context;
}

// Select root
export function Select({
  children,
  value,
  onValueChange,
  defaultValue,
  disabled = false,
}: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue || "");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isControlled = value !== undefined;

  const currentValue = isControlled ? value : internalValue;

  const handleValueChange = (newValue: string) => {
    if (!isControlled) setInternalValue(newValue);
    onValueChange?.(newValue);
    setOpen(false);
  };

  const contextValue = {
    value: currentValue || "",
    onValueChange: handleValueChange,
    disabled,
    triggerRef,
    contentRef,
    open,
    setOpen,
  };

  return (
    <SelectContext.Provider value={contextValue}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

// Trigger
export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, disabled, children, ...props }, ref) => {
    const { value, onValueChange, disabled: ctxDisabled, triggerRef, open, setOpen } = useSelectContext();
    const isDisabled = disabled || ctxDisabled;

    return (
      <button
        ref={(el) => {
          triggerRef.current = el;
          if (ref) {
            if (typeof ref === "function") ref(el);
            else ref.current = el;
          }
        }}
        type="button"
        disabled={isDisabled}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-[8px] border bg-card/90 px-3 py-2 text-sm",
          "placeholder:text-muted-foreground/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/55",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "transition-all duration-200",
          "border-border/70 hover:border-primary/30",
          isDisabled ? "opacity-60" : "",
          className,
        )}
        onClick={() => !isDisabled && setOpen(!open)}
        {...props}
      >
        {children || <SelectValue placeholder="Seleccionar..." />}
        <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50", open && "rotate-180")} />
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

// SelectValue (placeholder)
export function SelectValue({ placeholder }: SelectValueProps) {
  const { value } = useSelectContext();
  return (
    <span className={cn("truncate", value ? "text-foreground" : "text-muted-foreground/60")}>
      {value || placeholder}
    </span>
  );
}

// SelectContent (portal)
export function SelectContent({ children, className, position = "popper", sideOffset = 4 }: SelectContentProps) {
  const { value, onValueChange, disabled, contentRef, open, setOpen } = useSelectContext();

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={contentRef}
        className={cn(
          "relative z-50 max-h-96 overflow-y-auto rounded-[8px] border bg-card text-card-foreground shadow-xl",
          "border-border/70",
          "animate-in fade-in-0 zoom-in-95",
          className,
        )}
        style={{ maxWidth: "var(--radix-select-trigger-width)" }}
      >
        <div className="p-1">{children}</div>
      </div>
    </Portal>
  );
}

// SelectItem
export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, value, children, disabled = false, ...props }, ref) => {
    const { value: currentValue, onValueChange, disabled: ctxDisabled } = useSelectContext();
    const isSelected = currentValue === value;
    const isDisabled = disabled || ctxDisabled;

    return (
      <div
        ref={ref}
        role="option"
        aria-selected={isSelected}
        aria-disabled={isDisabled}
        data-value={value}
        data-disabled={isDisabled}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-[6px] px-3 py-1.5 text-sm outline-none",
          "transition-colors",
          isDisabled
            ? "text-muted-foreground/50 pointer-events-none"
            : "focus:bg-primary/10 focus:text-primary data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary",
          isSelected && "bg-primary/10 text-primary",
          className,
        )}
        onPointerDown={(e) => {
          e.preventDefault();
          if (!isDisabled) onValueChange(value);
        }}
        {...props}
      >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          {isSelected && <Check className="h-3.5 w-3.5" />}
        </span>
        <span className="pl-8">{children}</span>
      </div>
    );
  }
);
SelectItem.displayName = "SelectItem";

// SelectGroup
export function SelectGroup({ children, className }: SelectGroupProps) {
  return <div className={cn("relative", className)}>{children}</div>;
}

// SelectLabel
export function SelectLabel({ children, className }: SelectLabelProps) {
  return (
    <div className={cn("px-3 py-1.5 text-xs font-medium text-muted-foreground", className)}>
      {children}
    </div>
  );
}

// SelectSeparator
export function SelectSeparator({ className }: SelectSeparatorProps) {
  return <div className={cn("-mx-1 my-1 h-px bg-muted", className)} />;
}