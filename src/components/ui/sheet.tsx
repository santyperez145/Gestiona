import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// ── Sheet ────────────────────────────────────────────────────────────────────
// Darker bg than page, inner top highlight, distinctive close button.
// Overlay has subtle blur — not just black.

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

// ── Overlay ───────────────────────────────────────────────────────────────────
const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

// ── Content variants ──────────────────────────────────────────────────────────
const sheetVariants = cva(
  [
    "fixed z-50",
    // Popover surface, elevated relative to the page
    "bg-popover",
    // Subtle border on the opening edge
    "shadow-[0_0_0_1px_hsl(var(--border))]",
    // Transition
    "transition-transform ease-out",
    "data-[state=open]:animate-in data-[state=closed]:animate-out",
    "data-[state=closed]:duration-250 data-[state=open]:duration-350",
    // Inner top highlight
    "overflow-hidden",
  ].join(" "),
  {
    variants: {
      side: {
        top:    "inset-x-0 top-0 border-b border-border/50 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom: "inset-x-0 bottom-0 border-t border-border/50 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left:   "inset-y-0 left-0 h-full w-3/4 border-r border-border/50 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:  "inset-y-0 right-0 h-full w-3/4 border-l border-border/50 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: { side: "right" },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), "p-6", className)}
      {...props}
    >
      {/* Top-edge inner highlight (dark theme only) */}
      {(side === "right" || side === "left") && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px hidden dark:block bg-gradient-to-r from-white/5 via-white/8 to-transparent" />
      )}

      {children}

      {/* Close button — small square, unobtrusive */}
      <SheetPrimitive.Close
        className={cn(
          "absolute right-4 top-4",
          "flex h-6 w-6 items-center justify-center rounded-[5px]",
          "text-muted-foreground/45 border border-border/35",
          "hover:text-foreground hover:border-border/60 hover:bg-muted/40",
          "transition-all duration-150",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:pointer-events-none",
        )}
      >
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">Cerrar</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

// ── SheetHeader ────────────────────────────────────────────────────────────────
const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 mb-4", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

// ── SheetFooter ────────────────────────────────────────────────────────────────
const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      "mt-5 pt-4 border-t border-border/40",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

// ── SheetTitle ─────────────────────────────────────────────────────────────────
const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn(
      "text-[1rem] font-display font-semibold leading-tight tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

// ── SheetDescription ───────────────────────────────────────────────────────────
const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-[12px] text-muted-foreground/65 leading-relaxed", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
