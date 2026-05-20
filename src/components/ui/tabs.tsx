import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

// ── Tabs ─────────────────────────────────────────────────────────────────────
// Underline-indicator style — NO box container, no `bg-muted` pill.
// Active tab gets a gold bottom bar. Feels like Linear/Vercel, not shadcn defaults.

const Tabs = TabsPrimitive.Root;

// ── TabsList — just a bottom border, no box ───────────────────────────────────
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "flex items-end gap-0 border-b border-border/40",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

// ── TabsTrigger — text only, underline active indicator ──────────────────────
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Base
      "relative shrink-0",
      "px-4 pb-2.5 pt-1",
      "text-[11px] font-semibold uppercase tracking-[0.1em]",
      "text-muted-foreground/55 transition-colors duration-150",
      // Hover
      "hover:text-foreground/80",
      // Active text
      "data-[state=active]:text-primary",
      // Active bottom indicator — the gold bar
      "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-t-[2px]",
      "after:bg-primary after:scale-x-0 after:transition-transform after:duration-200 after:origin-left",
      "data-[state=active]:after:scale-x-100",
      // Disabled
      "disabled:pointer-events-none disabled:opacity-30",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

// ── TabsContent ───────────────────────────────────────────────────────────────
const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
