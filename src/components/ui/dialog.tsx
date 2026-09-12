/**
 * Nerqia Dialog — Modal con estilo cockpit propio
 *
 * API compatible con shadcn/ui Dialog:
 * - Dialog: open, onOpenChange, children
 * - DialogContent: children, className, size
 * - DialogHeader: title, description
 * - DialogFooter: children
 * - DialogTitle, DialogDescription
 * - DialogTrigger, DialogClose (passthrough)
 */
import { cn } from "@/lib/utils";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "default" | "md" | "lg" | "xl";
}

interface DialogHeaderProps {
  title?: string;
  description?: string;
}

const dialogSizes = {
  sm: "max-w-sm",
  default: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

// Root (passthrough para compatibilidad)
function Dialog({ children }: DialogProps) {
  return <div className="relative">{children}</div>;
}

// Trigger (passthrough)
const DialogTrigger = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button ref={ref} className={className} {...props}>
      {children}
    </button>
  )
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
  ({ className, size = "default", children, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
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
  )
);
DialogContent.displayName = "DialogContent";

// Header
function DialogHeader({ title, description }: DialogHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
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