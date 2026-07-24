import * as React from "react";

import { cn } from "@/lib/utils";

// ── Card ─────────────────────────────────────────────────────────────────────
// Distinctive dark card with inner top highlight, custom shadow, tighter radius.
// Uses --shadow-card (defined in index.css) which includes an inset highlight.

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative rounded-[10px] border border-border/60 bg-card text-card-foreground",
        "shadow-card",          // custom shadow with inner highlight from index.css
        "overflow-hidden",
        className,
      )}
      {...props}
    >
      {/* Inner top-edge highlight — feels like physical depth (dark theme only) */}
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
      className={cn("flex flex-col space-y-1.5 p-5", className)}
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
        "text-[1.05rem] font-display font-semibold leading-tight tracking-tight",
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
      className={cn("text-[13px] text-muted-foreground/70 leading-relaxed", className)}
      {...props}
    />
  ),
);
CardDescription.displayName = "CardDescription";

// ── CardContent ──────────────────────────────────────────────────────────────

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

// ── CardFooter ───────────────────────────────────────────────────────────────

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center p-5 pt-0 border-t border-border/40 mt-0",
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
