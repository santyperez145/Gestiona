/**
 * Nerqia Select — Select propio sin shadcn/ui
 *
 * API compatible con shadcn Select: Select, SelectTrigger, SelectValue,
 * SelectContent, SelectItem, SelectGroup, SelectLabel, SelectSeparator.
 *
 * Accesibilidad (patrón combobox de APG):
 * - el foco queda en el trigger y se navega con `aria-activedescendant`;
 * - teclado completo: flechas, Home/End, Enter/Espacio, Escape y typeahead;
 * - cierra al hacer click afuera o con Escape, devolviendo el foco al trigger;
 * - el panel se ancla al trigger (posición fija) y voltea hacia arriba si no
 *   entra abajo, en vez de aparecer suelto al final del body.
 */
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";
import {
  useState, useRef, useEffect, useLayoutEffect, useCallback, useId, useMemo,
  Children, isValidElement,
  forwardRef, createContext, useContext,
} from "react";
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
  textValue?: string;
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

function optionDomId(listboxId: string, value: string) {
  return `${listboxId}-opt-${encodeURIComponent(value)}`;
}

function optionLabelText(children: React.ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (!isValidElement<{ children?: React.ReactNode; hidden?: boolean; "aria-hidden"?: boolean | string }>(child)) return "";
    if (child.props.hidden || child.props["aria-hidden"] === true || child.props["aria-hidden"] === "true") return "";
    return optionLabelText(child.props.children);
  }).join("");
}

function optionLabels(children: React.ReactNode, labels = new Map<string, string>()): Map<string, string> {
  Children.forEach(children, child => {
    if (!isValidElement<{ children?: React.ReactNode; value?: string; textValue?: string }>(child)) return;
    if (child.type === SelectItem && typeof child.props.value === "string") {
      const text = child.props.textValue ?? optionLabelText(child.props.children);
      labels.set(child.props.value, text.replace(/\s+/g, " ").trim());
    } else {
      optionLabels(child.props.children, labels);
    }
  });
  return labels;
}

// Context para compartir estado
interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: (open: boolean) => void;
  highlighted: string | null;
  setHighlighted: (value: string | null) => void;
  listboxId: string;
  labels: Map<string, string>;
}

const SelectContext = createContext<SelectContextValue | null>(null);

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
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // Resolve labels before the portal mounts; deriving them also drops stale context.
  const labels = useMemo(() => optionLabels(children), [children]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const isControlled = value !== undefined;

  const currentValue = isControlled ? value : internalValue;

  const handleValueChange = (newValue: string) => {
    if (!isControlled) setInternalValue(newValue);
    onValueChange?.(newValue);
    setOpen(false);
    // Devolver el foco al trigger tras elegir con el mouse o el teclado.
    triggerRef.current?.focus();
  };

  const contextValue: SelectContextValue = {
    value: currentValue || "",
    onValueChange: handleValueChange,
    disabled,
    triggerRef,
    contentRef,
    open,
    setOpen,
    highlighted,
    setHighlighted,
    listboxId,
    labels,
  };

  return (
    <SelectContext.Provider value={contextValue}>
      <div className="relative min-w-0">{children}</div>
    </SelectContext.Provider>
  );
}

/** Opciones habilitadas del panel, en orden de documento. */
function enabledOptionsOf(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'))
    .filter(el => el.getAttribute("aria-disabled") !== "true");
}

// Trigger
export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, disabled, children, onKeyDown, onClick, id, ...props }, ref) => {
    const {
      disabled: ctxDisabled, triggerRef, contentRef, open, setOpen,
      value, onValueChange, highlighted, setHighlighted, listboxId, labels,
    } = useSelectContext();
    const isDisabled = disabled || ctxDisabled;
    const typeahead = useRef<{ buffer: string; timer: number | null }>({ buffer: "", timer: null });

    const moveHighlight = (delta: number) => {
      const options = enabledOptionsOf(contentRef.current);
      if (!options.length) return;
      const values = options.map(el => el.getAttribute("data-value") || "");
      const currentIndex = highlighted ? values.indexOf(highlighted) : -1;
      let next = currentIndex + delta;
      if (next < 0) next = 0;
      if (next > options.length - 1) next = options.length - 1;
      const target = values[next];
      setHighlighted(target);
      options[next]?.scrollIntoView?.({ block: "nearest" });
    };

    const jumpTo = (position: "first" | "last") => {
      const options = enabledOptionsOf(contentRef.current);
      if (!options.length) return;
      const el = position === "first" ? options[0] : options[options.length - 1];
      setHighlighted(el.getAttribute("data-value"));
      el.scrollIntoView?.({ block: "nearest" });
    };

    const runTypeahead = (char: string) => {
      const state = typeahead.current;
      state.buffer += char.toLowerCase();
      if (state.timer) window.clearTimeout(state.timer);
      state.timer = window.setTimeout(() => { state.buffer = ""; }, 600);
      const options = enabledOptionsOf(contentRef.current);
      const match = options.find(el =>
        (labels.get(el.getAttribute("data-value") || "") ?? el.textContent ?? "").trim().toLowerCase().startsWith(state.buffer),
      );
      if (match) {
        setHighlighted(match.getAttribute("data-value"));
        match.scrollIntoView?.({ block: "nearest" });
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || isDisabled) return;
      const key = event.key;

      if (!open) {
        if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
          event.preventDefault();
          setOpen(true);
        }
        return;
      }

      switch (key) {
        case "ArrowDown": event.preventDefault(); moveHighlight(1); break;
        case "ArrowUp": event.preventDefault(); moveHighlight(-1); break;
        case "Home": event.preventDefault(); jumpTo("first"); break;
        case "End": event.preventDefault(); jumpTo("last"); break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (highlighted && enabledOptionsOf(contentRef.current).some(el => el.getAttribute("data-value") === highlighted)) {
            onValueChange(highlighted);
          }
          break;
        case "Escape":
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          break;
        case "Tab":
          setOpen(false);
          break;
        default:
          if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            runTypeahead(key);
          }
      }
    };

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
        id={id ?? `${listboxId}-trigger`}
        disabled={isDisabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && highlighted ? optionDomId(listboxId, highlighted) : undefined}
        aria-autocomplete="none"
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
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !isDisabled) setOpen(!open);
        }}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children || <SelectValue placeholder="Seleccionar..." />}
        <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

// SelectValue: muestra la etiqueta legible del valor elegido (no el valor crudo).
export function SelectValue({ placeholder }: SelectValueProps) {
  const { value, labels } = useSelectContext();
  const label = value ? labels.get(value) : "";
  return (
    <span data-unresolved={value && !label ? "" : undefined} className={cn("min-w-0 flex-1 truncate text-left", label ? "text-foreground" : "text-muted-foreground")}>
      {value ? label || "Selección no disponible" : placeholder}
    </span>
  );
}

// SelectContent (portal anclado al trigger)
export function SelectContent({ children, className, sideOffset = 4 }: SelectContentProps) {
  const { triggerRef, contentRef, open, setOpen, value, highlighted, setHighlighted, listboxId } = useSelectContext();
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; placement: "bottom" | "top" } | null>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimated = Math.min(384, contentRef.current?.offsetHeight || 240);
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: "bottom" | "top" = spaceBelow < estimated && rect.top > spaceBelow ? "top" : "bottom";
    const width = Math.min(rect.width, Math.max(0, window.innerWidth - 16));
    setCoords({
      top: placement === "bottom" ? rect.bottom + sideOffset : rect.top - sideOffset,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      placement,
    });
  }, [triggerRef, contentRef, sideOffset]);

  // Keep the active descendant valid as async options change while open.
  useLayoutEffect(() => {
    if (!open) {
      if (highlighted !== null) setHighlighted(null);
      return;
    }
    reposition();
    const options = enabledOptionsOf(contentRef.current);
    const values = options.map(el => el.getAttribute("data-value") || "");
    const initial = highlighted && values.includes(highlighted)
      ? highlighted
      : value && values.includes(value) ? value : values[0] ?? null;
    if (highlighted !== initial) setHighlighted(initial);
    const activeEl = options.find(el => el.getAttribute("data-value") === initial);
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }, [open, children, value, highlighted, setHighlighted, reposition, contentRef]);

  // Cerrar al hacer click afuera; reubicar ante scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onReflow = () => reposition();
    // Consume Escape before a parent dialog's document capture listener.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !contentRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, reposition, setOpen, contentRef, triggerRef]);

  if (!open) return null;
  const trigger = triggerRef.current;
  const accessibleLabel = trigger?.getAttribute("aria-label")
    || Array.from(trigger?.labels ?? []).map(label => label.textContent).join(" ").trim()
    || trigger?.textContent?.trim()
    || "Opciones";

  return (
    <Portal>
      <div
        ref={contentRef}
        id={listboxId}
        role="listbox"
        aria-label={accessibleLabel}
        aria-labelledby={trigger?.getAttribute("aria-labelledby") || undefined}
        aria-activedescendant={highlighted ? optionDomId(listboxId, highlighted) : undefined}
        className={cn(
          "z-50 max-h-96 overflow-y-auto rounded-[8px] border bg-card text-card-foreground shadow-xl",
          "border-border/70",
          "animate-in fade-in-0 zoom-in-95",
          className,
        )}
        style={{
          position: "fixed",
          top: coords ? (coords.placement === "bottom" ? coords.top : undefined) : undefined,
          bottom: coords && coords.placement === "top" ? window.innerHeight - coords.top : undefined,
          left: coords?.left,
          minWidth: coords?.width,
          maxWidth: coords ? Math.max(0, window.innerWidth - coords.left - 8) : undefined,
          pointerEvents: "auto",
          visibility: coords ? "visible" : "hidden",
        }}
      >
        <div className="p-1">{children}</div>
      </div>
    </Portal>
  );
}

// SelectItem
export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, value, children, disabled = false, textValue: _textValue, ...props }, ref) => {
    const {
      value: currentValue, onValueChange, disabled: ctxDisabled,
      highlighted, setHighlighted, listboxId,
    } = useSelectContext();
    const isSelected = currentValue === value;
    const isDisabled = disabled || ctxDisabled;
    const isHighlighted = highlighted === value;

    return (
      <div
        ref={ref}
        id={optionDomId(listboxId, value)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={isDisabled}
        data-value={value}
        data-disabled={isDisabled}
        data-highlighted={isHighlighted ? "" : undefined}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-[6px] px-3 py-1.5 text-sm outline-none",
          "transition-colors",
          isDisabled
            ? "text-muted-foreground/50 pointer-events-none"
            : "data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary",
          isSelected && "bg-primary/10 text-primary",
          className,
        )}
        onPointerDown={(e) => {
          e.preventDefault();
          if (!isDisabled) onValueChange(value);
        }}
        onPointerEnter={() => {
          if (!isDisabled) setHighlighted(value);
        }}
        {...props}
      >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          {isSelected && <Check className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1 break-words pl-8 [overflow-wrap:anywhere]">{children}</span>
      </div>
    );
  }
);
SelectItem.displayName = "SelectItem";

// SelectGroup
export function SelectGroup({ children, className }: SelectGroupProps) {
  return <div role="group" className={cn("relative", className)}>{children}</div>;
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
