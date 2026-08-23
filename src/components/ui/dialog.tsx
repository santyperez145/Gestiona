import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// ── Dialog ───────────────────────────────────────────────────────────────────
// Elevated workspace surface with one consistent modal hierarchy.

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

// ── Overlay — frosted dark ────────────────────────────────────────────────────
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50",
      "bg-black/75 backdrop-blur-[3px]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// ── Content ───────────────────────────────────────────────────────────────────
const dialogSizeClasses = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[calc(100vw-1.5rem)]",
} as const;

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: keyof typeof dialogSizeClasses;
  hideClose?: boolean;
  overlayClassName?: string;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = "md", hideClose = false, overlayClassName, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      aria-describedby={undefined}
      {...props}
      className={cn(
        // Layout
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
        "w-[calc(100vw-1.5rem)] max-h-[calc(100vh-2rem)] overflow-y-auto",
        dialogSizeClasses[size],
        // Appearance — popover surface, elevated
        "rounded-[14px] border border-border/80",
        "bg-popover",
        "shadow-elevated",
        // Inner top highlight (dark theme only)
        "dark:before:absolute dark:before:inset-x-0 dark:before:top-0 dark:before:h-px dark:before:bg-gradient-to-r dark:before:from-white/6 dark:before:via-white/10 dark:before:to-transparent",
        // Spacing
        "p-5 sm:p-6",
        // Animation
        "duration-200",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%]",
        className,
      )}
    >
      {/* Inner top highlight layer */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-px bg-gradient-to-r from-white/5 via-white/9 to-transparent dark:block" />

      {children}

      {/* Close button — small, unobtrusive */}
      {!hideClose && (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4",
            "flex h-6 w-6 items-center justify-center rounded-[5px]",
            "text-muted-foreground/50 border border-border/40",
            "hover:text-foreground hover:border-border/70 hover:bg-muted/50",
            "transition-all duration-150",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:pointer-events-none",
          )}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

// ── DialogHeader ──────────────────────────────────────────────────────────────
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 mb-4", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

// ── DialogFooter ──────────────────────────────────────────────────────────────
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      "mt-5 pt-4 border-t border-border/40",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

// ── DialogTitle ───────────────────────────────────────────────────────────────
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-[1.05rem] font-display font-semibold leading-tight tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// ── DialogDescription ─────────────────────────────────────────────────────────
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[13px] text-muted-foreground/65 leading-relaxed", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
