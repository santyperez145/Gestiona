import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

// ── Tabs ─────────────────────────────────────────────────────────────────────
// Segmented navigation taken from the selected CRM / marketplace direction.

const Tabs = TabsPrimitive.Root;

// ── TabsList ─────────────────────────────────────────────────────────────────
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Scrollea horizontal en móvil en vez de desbordar cuando hay muchos tabs.
      "flex items-center gap-1 overflow-x-auto rounded-[11px] border border-border/75 bg-muted/45 p-1 scrollbar-hide",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

// ── TabsTrigger ──────────────────────────────────────────────────────────────
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Base
      "relative shrink-0",
      "min-h-9 rounded-[8px] border border-transparent px-3 py-2",
      "text-[11px] font-semibold tracking-[0.02em]",
      "text-muted-foreground/75 transition-[background-color,border-color,color,box-shadow] duration-150",
      // Hover
      "hover:text-foreground/80",
      // Active text
      "data-[state=active]:border-primary/15 data-[state=active]:bg-card data-[state=active]:text-primary",
      "data-[state=active]:shadow-[0_5px_14px_-10px_hsl(var(--primary)/0.85)]",
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
      "mt-5 focus-visible:outline-none",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
