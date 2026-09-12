/**
 * Nerqia Dialog — Modal con estilo cockpit propio
 *
 * API compatible con shadcn/ui Dialog:
 * - Dialog: open, onOpenChange, children
 * - DialogContent: children, className, size
 * - DialogHeader: title, description, children
 * - DialogFooter: children
 * - DialogTitle, DialogDescription
 * - DialogTrigger, DialogClose (passthrough)
 */
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "default" | "md" | "lg" | "xl" | "full";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Oculta el botón de cierre (compat shadcn; este Dialog no lo renderiza). */
  hideClose?: boolean;
  /** Clase extra para el overlay oscuro. */
  overlayClassName?: string;
  /** Compat shadcn/Radix: se aceptan pero este Dialog no captura el foco. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: PointerEvent) => void;
}

interface DialogHeaderProps {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
}

const dialogSizes = {
  sm: "max-w-sm",
  default: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-none",
};

// Root (passthrough para compatibilidad)
function Dialog({ children, open = true, onOpenChange }: DialogProps) {
  if (!open) return null;
  return <div className="relative">{children}</div>;
}

// Trigger (passthrough). `asChild` clona el hijo (patrón shadcn) para no anidar
// un <button> dentro de otro cuando el consumidor pasa su propio Button.
interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}
const DialogTrigger = forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ className, children, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={className} {...props}>
        {children}
      </Comp>
    );
  }
);
DialogTrigger.displayName = "DialogTrigger";

// Portal
function DialogPortal({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">{children}</div>;
}

// Overlay
function DialogOverlay({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]", className)}
      {...props}
    />
  );
}

// Content
const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  (
    {
      className, size = "default", children, open = true, onOpenChange,
      // Compat shadcn: se aceptan para no romper consumidores ni fugar props no-DOM.
      hideClose: _hideClose, overlayClassName, onEscapeKeyDown: _onEscapeKeyDown,
      onPointerDownOutside: _onPointerDownOutside, ...props
    },
    ref,
  ) => {
    if (!open) return null;
    return (
      <DialogPortal>
        <DialogOverlay className={overlayClassName} />
        <div
          ref={ref}
          className={cn(
            "relative z-50 grid w-full gap-4 border bg-card p-6 shadow-xl",
            "rounded-[8px] border-border/70",
            "animate-in fade-in-0 zoom-in-95",
            dialogSizes[size],
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </DialogPortal>
    );
  }
);
DialogContent.displayName = "DialogContent";

// Header
function DialogHeader({ children, className, title, description }: DialogHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {children && children}
    </div>
  );
}
DialogHeader.displayName = "DialogHeader";

// Footer
function DialogFooter({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 pt-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}
DialogFooter.displayName = "DialogFooter";

// Title
const DialogTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
  )
);
DialogTitle.displayName = "DialogTitle";

// Description
const DialogDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
DialogDescription.displayName = "DialogDescription";

// Close
const DialogClose = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button ref={ref} className={cn("rounded-md p-1 text-muted-foreground hover:text-foreground", className)} {...props}>
      {children}
    </button>
  )
);
DialogClose.displayName = "DialogClose";

export {
  Dialog, DialogTrigger, DialogPortal, DialogOverlay, DialogContent,
  DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogClose,
};
export default Dialog;