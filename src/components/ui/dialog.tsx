import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// ── Dialog ───────────────────────────────────────────────────────────────────
// Dark overlay with backdrop blur. Content is darker than card bg with layered
// shadows and inner highlight. Close button is a small square icon button.

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
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      aria-describedby={undefined}
      {...props}
      className={cn(
        // Layout
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
        "w-[calc(100vw-1.5rem)] max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto",
        // Appearance — darker than bg, elevated
        "rounded-[12px] border border-border/50",
        "bg-[hsl(228_26%_6%)]",
        "shadow-[0_0_0_1px_hsl(228_30%_16%/0.4)_inset,0_24px_64px_-8px_hsl(0_0%_0%/0.7),0_8px_24px_-4px_hsl(0_0%_0%/0.5)]",
        // Inner top highlight
        "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-white/6 before:via-white/10 before:to-transparent",
        "relative overflow-hidden",
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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/5 via-white/9 to-transparent" />

      {children}

      {/* Close button — small, unobtrusive */}
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
