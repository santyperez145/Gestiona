/**
 * Nerqia Tabs — Pestañas con estilo cockpit
 *
 * API compatible: Tabs, TabsList, TabsTrigger, TabsContent
 */
import { cn } from "@/lib/utils";
import { useState, useId, createContext, useContext, forwardRef, ReactNode } from "react";

interface TabsProps {
  children: ReactNode;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

interface TabsTriggerProps {
  children: React.ReactNode;
  value: string;
  className?: string;
  disabled?: boolean;
}

interface TabsContentProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

// Context
interface TabsContext {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  orientation: "horizontal" | "vertical";
}

const TabsContext = createContext<TabsContext | null>(null);
function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tabs components must be used within Tabs");
  return context;
}

// Root
export function Tabs({
  children,
  defaultValue,
  value,
  onValueChange,
  orientation = "horizontal",
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const controlledValue = value !== undefined;
  const currentValue = controlledValue ? value : internalValue;

  const handleValueChange = (newValue: string) => {
    if (!controlledValue) setInternalValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ value: currentValue, onValueChange: handleValueChange, orientation }}>
      <div className="relative">{children}</div>
    </TabsContext.Provider>
  );
}

// List
export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, orientation = "horizontal", ...props }, ref) => {
    const { orientation: ctxOrientation } = useTabsContext();
    const finalOrientation = orientation ?? ctxOrientation;

    return (
      <div
        ref={ref}
        role="tablist"
        aria-orientation={finalOrientation}
        className={cn(
          "flex flex-wrap items-center gap-1",
          finalOrientation === "horizontal" ? "" : "flex-col",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsList.displayName = "TabsList";

// Trigger
export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, children, disabled = false, ...props }, ref) => {
    const { value: currentValue, onValueChange } = useTabsContext();
    const isActive = currentValue === value;

    return (
      <button
        ref={ref}
        role="tab"
        aria-selected={isActive}
        aria-disabled={disabled}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-[6px] border px-3 py-1.5 text-sm font-medium",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/50",
          isActive
            ? "border-primary/40 bg-primary/10 text-primary"
            : "",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        onClick={() => !disabled && onValueChange(value)}
        {...props}
      >
        <span className="sr-only">{isActive ? "Seleccionado" : ""}</span>
        {children}
      </button>
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

// Content
export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const { value: currentValue } = useTabsContext();
    const isActive = currentValue === value;

    return (
      <div
        ref={ref}
        role="tabpanel"
        hidden={!isActive}
        className={cn(
          "mt-2 border border-border/40 bg-card rounded-[6px] p-4",
          "animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsContent.displayName = "TabsContent";