import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// ── Alert ────────────────────────────────────────────────────────────────────
// Left accent bar style — NOT a generic rounded box.
// The bar + subtle background is far more distinctive than border-all.

const alertVariants = cva(
  // Base: left bar, no full border, tight horizontal layout
  "relative w-full overflow-hidden pl-4 pr-4 py-3 " +
  "before:absolute before:left-0 before:inset-y-0 before:w-[3px] before:rounded-r-full " +
  "flex items-start gap-3 " +
  "rounded-[8px]",
  {
    variants: {
      variant: {
        default:
          "bg-[hsl(228_22%_8%)] border border-border/40 text-foreground " +
          "before:bg-primary/60",
        destructive:
          "bg-destructive/6 border border-destructive/18 text-destructive " +
          "before:bg-destructive",
        warning:
          "bg-yellow-500/6 border border-yellow-500/18 text-yellow-400 " +
          "before:bg-yellow-500",
        success:
          "bg-emerald-500/6 border border-emerald-500/18 text-emerald-400 " +
          "before:bg-emerald-500",
        info:
          "bg-blue-500/6 border border-blue-500/18 text-blue-400 " +
          "before:bg-blue-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

// ── AlertTitle ────────────────────────────────────────────────────────────────
const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn(
      "text-[13px] font-semibold leading-none tracking-tight mb-0.5",
      className,
    )}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

// ── AlertDescription ──────────────────────────────────────────────────────────
const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-[12px] leading-relaxed opacity-80 [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
