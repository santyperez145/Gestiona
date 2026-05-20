import * as React from "react";

import { cn } from "@/lib/utils";

// ── Table ────────────────────────────────────────────────────────────────────
// Terminal-style data grid. No full borders, no bg on header — just bottom
// dividers and ultra-compact all-caps column labels. Feels like a financial
// terminal, not a generic admin panel.

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-[13px]", className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("", className)} {...props} />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn(
        "border-t border-border/40 bg-muted/20 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  ),
);
TableFooter.displayName = "TableFooter";

// ── TableRow — hairline bottom dividers, no box ──────────────────────────────
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border/30 transition-colors duration-100",
        "hover:bg-muted/25",
        "data-[state=selected]:bg-primary/6",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

// ── TableHead — 9px ALL-CAPS label, no background ────────────────────────────
const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-9 px-3 pb-2 pt-3",
        "text-left align-bottom",
        "text-[9px] font-semibold uppercase tracking-[0.13em]",
        "text-muted-foreground/50",
        "border-b border-border/40",
        "[&:has([role=checkbox])]:pr-0 [&:has([role=checkbox])]:w-10",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

// ── TableCell — compact, aligned ─────────────────────────────────────────────
const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-3 py-2.5 align-middle",
        "[&:has([role=checkbox])]:pr-0 [&:has([role=checkbox])]:w-10",
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption
      ref={ref}
      className={cn("mt-4 text-[11px] text-muted-foreground/50", className)}
      {...props}
    />
  ),
);
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
