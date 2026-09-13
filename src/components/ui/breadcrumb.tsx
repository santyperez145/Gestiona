/**
 * Nerqia Breadcrumb — Migaja de pan propia
 * Diseño: items con separador personalizado, tipografía compacta, estado activo con acento
 */
import * as React from "react";
import { Slash } from "lucide-react";
import { cn } from "@/lib/utils";

const Breadcrumb = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"nav"> & { className?: string }>(
  ({ className, ...props }, ref) => (
    <nav ref={ref} className={cn("flex items-center gap-1.5 text-[11px] font-display", className)} {...props} />
  )
);
Breadcrumb.displayName = "Breadcrumb";

const BreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<"ol"> & { className?: string }>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex flex-wrap items-center gap-1.5 text-[11px] font-display", className)} {...props} />
  )
);
BreadcrumbList.displayName = "BreadcrumbList";

const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<"li"> & { className?: string }>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn("inline-flex items-center gap-1.5 text-[11px] font-display text-muted-foreground hover:text-primary transition-colors", className)} {...props} />
  )
);
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<"a"> & { className?: string; isActive?: boolean }>(
  ({ className, isActive = false, ...props }, ref) => (
    <a ref={ref} className={cn("text-[11px] font-display transition-colors hover:underline", isActive ? "text-primary font-semibold" : "text-muted-foreground hover:text-primary", className)} {...props} />
  )
);
BreadcrumbLink.displayName = "BreadcrumbLink";

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span"> & { className?: string }>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("text-[11px] font-display text-foreground font-semibold", className)} {...props} />
  )
);

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage };