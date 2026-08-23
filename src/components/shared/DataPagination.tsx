import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPaginationRange } from "@/lib/dataPagination";
import { cn } from "@/lib/utils";

interface DataPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  itemLabel?: string;
  className?: string;
}

export default function DataPagination({
  page,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemLabel = "registros",
  className,
}: DataPaginationProps) {
  if (totalPages <= 1) return null;

  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const range = totalItems !== undefined && pageSize !== undefined
    ? getPaginationRange(safePage, pageSize, totalItems)
    : null;

  return (
    <nav
      aria-label="Paginación de resultados"
      className={cn(
        "mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border/60 bg-card/70 px-3 py-2",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {range
          ? `${range.from}–${range.to} de ${range.total} ${itemLabel}`
          : `Página ${safePage + 1} de ${totalPages}`}
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          disabled={safePage === 0}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Ir a la página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Anterior</span>
        </Button>

        <span className="min-w-20 text-center text-xs font-medium text-foreground tabular-nums">
          {safePage + 1} / {totalPages}
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          disabled={safePage >= totalPages - 1}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Ir a la página siguiente"
        >
          <span className="hidden sm:inline">Siguiente</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
