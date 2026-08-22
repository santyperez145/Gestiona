import * as React from "react";

import { cn } from "@/lib/utils";

// ── Card ─────────────────────────────────────────────────────────────────────
// Low-depth marketplace surface. Theme tokens keep the same hierarchy in light
// and dark mode without each page inventing its own card treatment.

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden rounded-[12px] border border-border/80 bg-card text-card-foreground shadow-card",
        className,
      )}
      {...props}
    >
      {/* Dark mode keeps a restrained inner highlight for separation. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px hidden dark:block bg-gradient-to-r from-white/5 via-white/8 to-transparent" />
      {props.children}
    </div>
  ),
);
Card.displayName = "Card";

// ── CardHeader ───────────────────────────────────────────────────────────────

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-5 sm:p-6", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

// ── CardTitle ────────────────────────────────────────────────────────────────

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "text-[1.05rem] font-display font-semibold leading-tight tracking-[-0.015em]",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

// ── CardDescription ──────────────────────────────────────────────────────────

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-[13px] text-muted-foreground/80 leading-relaxed", className)}
      {...props}
    />
  ),
);
CardDescription.displayName = "CardDescription";

// ── CardContent ──────────────────────────────────────────────────────────────

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0 sm:px-6 sm:pb-6", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

// ── CardFooter ───────────────────────────────────────────────────────────────

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center border-t border-border/60 p-5 pt-4 sm:px-6",
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
