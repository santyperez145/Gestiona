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
    <li ref={ref} className={cn("inline-flex items-center gap-1.5 text-[11px] font-display text-[#8892a8] hover:text-[#173aef] transition-colors", className)} {...props} />
  )
);
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<"a"> & { className?: string; isActive?: boolean }>(
  ({ className, isActive = false, ...props }, ref) => (
    <a ref={ref} className={cn("text-[11px] font-display transition-colors hover:underline", isActive ? "text-[#173aef] font-semibold" : "text-[#8892a8] hover:text-[#173aef]", className)} {...props} />
  )
);
BreadcrumbLink.displayName = "BreadcrumbLink";

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span"> & { className?: string }>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("text-[11px] font-display text-[#e8edf2] font-semibold", className)} {...props} />
  )
);
BreadcrumbPage.displayName = "BreadcrumbPage";

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage };