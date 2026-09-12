/**
 * Nerqia Sheet — Panel con estilo cockpit propio
 *
 * Un panel modal que se desplaza desde el lado derecho
 * con overlay borroso y barra de acento lateral.
 *
 * API: Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader,
 * SheetTitle, SheetFooter
 */
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

export interface SheetHeaderProps {
  children?: React.ReactNode;
  className?: string;
  title?: string;
}

export interface SheetFooterProps {
  children?: React.ReactNode;
  className?: string;
}

export interface SheetContentProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  children: React.ReactNode;
  side?: "right" | "left";
  showHighlight?: boolean;
  title?: React.ReactNode;
  showClose?: boolean;
  closeLabel?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Sheet — Contenedor raíz, no renderiza nada directamente
 */
export function Sheet({ children, open = true, onOpenChange }: { children?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  if (!open) return null;
  return <div className="relative w-full">{children}</div>;
}

/**
 * SheetOverlay — Overlay oscuro con blur
 */
export function SheetOverlay({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
    />
  );
}

/**
 * SheetContent — Panel principal con acento izquierdo
 */
export function SheetContent({
  side = "right",
  title,
  showHighlight = true,
  showClose = true,
  closeLabel = "Cerrar",
  children,
  className,
  open = true,
  onOpenChange,
  ...rest
}: SheetContentProps) {
  const sideClassMap = {
    right:
      "fixed inset-y-0 right-0 top-0 bottom-0 w-full sm:max-w-sm max-w-md overflow-y-auto transform transition-transform ease-out duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
    left:
      "fixed inset-y-0 left-0 top-0 bottom-0 w-full sm:max-w-sm max-w-md overflow-y-auto transform transition-transform ease-out duration-300 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
  };

  const highlightClass = showHighlight
    ? "pointer-events-none absolute inset-x-0 top-0 h-px hidden dark:block bg-gradient-to-r from-white/5 via-white/8 to-transparent"
    : "";

  const closeButtonClass = cn(
    "absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-[5px]",
    "text-muted-foreground/45 border border-border/35",
    "hover:text-foreground hover:border-border/60 hover:bg-muted/40",
    "transition-all duration-150",
    "focus:outline-none focus:ring-1 focus:ring-ring",
    "disabled:pointer-events-none",
  );

  const closeIconClass = "h-3.5 w-3.5";

  return (
    <div
      className={cn(
        sideClassMap[side],
        "bg-card text-card-foreground rounded-[10px] border border-border/60 shadow-xl p-4",
        className,
      )}
      {...rest}
    >
      {/* Top highlight for dark theme */}
      {showHighlight && side === "right" && highlightClass}

      {/* Header with title and close button */}
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {showClose && (
            <button
              onClick={() => onOpenChange?.(false)}
              className={closeButtonClass}
            >
              <svg
                className={closeIconClass}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  className="stroke-2 stroke-currentColor"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="sr-only">{closeLabel}</span>
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

/**
 * SheetHeader — Header del sheet
 */
export function SheetHeader({ children, className, title }: SheetHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2 p-4", className)}>
      {title && <h3 className="text-lg font-semibold text-foreground">{title}</h3>}
      {children}
    </div>
  );
}
SheetHeader.displayName = "SheetHeader";

/**
 * SheetFooter — Footer del sheet
 */
export function SheetFooter({ children, className }: SheetFooterProps) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-5 pt-4 border-t border-border/40", className)}>
      {children}
    </div>
  );
}
SheetFooter.displayName = "SheetFooter";

/**
 * SheetTitle — Título del sheet
 */
export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}
SheetTitle.displayName = "SheetTitle";

/**
 * SheetDescription — Descripción del sheet
 */
export function SheetDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
SheetDescription.displayName = "SheetDescription";

/**
 * SheetTrigger — Trigger para abrir el sheet
 */
export function SheetTrigger({
  asChild = false,
  className,
  children,
  ...props
}: {
  asChild?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-2 rounded-full bg-primary/5 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 transition-colors",
        className,
      )}
      {...props}
    >
      {asChild ? children : (
        <span className="flex items-center gap-2">
          {/* Icon placeholder - consumer provides their own */}
        </span>
      )}
    </button>
  );
}
SheetTrigger.displayName = "SheetTrigger";

/**
 * SheetClose — Botón de cerrar
 */
export const SheetClose = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button ref={ref} className={cn("rounded-md p-1 text-muted-foreground hover:text-foreground", className)} {...props}>
      {children}
    </button>
  )
);
SheetClose.displayName = "SheetClose";

export default Sheet;