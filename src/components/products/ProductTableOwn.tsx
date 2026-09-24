import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, ChevronUp, ChevronDown, Pencil, Copy, Trash2, Check, X, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ProductSortColumn = "name" | "sale_price_ars" | "stock" | "margin";

export interface ProductRow {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  /** Clases del chip de categoría (`colorDeCategoria`), para que todas tengan color. */
  category_color?: string;
  image_url?: string | null;
  sale_price_ars: number;
  discount_price_ars?: number | null;
  stock: number;
  profit_per_unit_ars?: number | null;
  low_stock_threshold?: number;
}

interface Props {
  rows: ProductRow[];
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  sortCol?: ProductSortColumn;
  sortDir?: "asc" | "desc";
  onSort?: (col: ProductSortColumn) => void;
  onEdit?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Abre el historial de cambios de precio del producto. */
  onPriceHistory?: (id: string) => void;
  /** Edición inline de stock: el conteo físico se corrige en la fila, no abriendo la ficha. */
  onStockChange?: (id: string, newStock: number) => Promise<void> | void;
  busy?: boolean;
}

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const columns: { key: string; label: string; sort?: ProductSortColumn; numeric?: boolean }[] = [
  { key: "name", label: "Producto", sort: "name" },
  { key: "category", label: "Categoría" },
  { key: "price", label: "Venta", sort: "sale_price_ars", numeric: true },
  { key: "stock", label: "Stock", sort: "stock", numeric: true },
  { key: "profit", label: "Ganancia", sort: "margin", numeric: true },
  { key: "status", label: "Estado" },
  { key: "actions", label: "Acciones" },
];

/**
 * Celda de stock editable: clic en el número → input con selección lista,
 * Enter o ✓ confirma, Esc o clic fuera cancela. Guardar es responsabilidad
 * de la página; la tabla sólo captura la intención.
 */
function StockCell({ row, busy, onStockChange }: {
  row: ProductRow;
  busy: boolean;
  onStockChange?: (id: string, newStock: number) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.stock));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setValue(String(row.stock));
      // requestAnimationFrame: el input todavía no está en el DOM en el commit.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, row.stock]);

  if (!onStockChange || busy) {
    return <span className={cn("font-medium", row.stock <= 0 ? "text-destructive" : undefined)}>{row.stock.toLocaleString("es-AR")}</span>;
  }

  const commit = async () => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed === row.stock) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onStockChange(row.id, parsed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        <Input
          ref={inputRef}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={value}
          disabled={saving}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); void commit(); }
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-7 w-16 px-2 text-right text-sm tabular-nums"
          aria-label={`Nuevo stock de ${row.name}`}
        />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={saving} aria-label="Confirmar stock" onClick={() => void commit()}>
          {saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={saving} aria-label="Cancelar" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "font-medium tabular-nums underline-offset-4 decoration-dotted hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1 -mx-1",
        row.stock <= 0 ? "text-destructive" : "hover:text-primary",
      )}
      title="Clic para corregir el conteo físico"
      onClick={() => setEditing(true)}
    >
      {row.stock.toLocaleString("es-AR")}
    </button>
  );
}

export default function ProductTableOwn({ rows, selectedIds, onToggleRow, onToggleAll, sortCol, sortDir, onSort, onEdit, onDuplicate, onDelete, onPriceHistory, onStockChange, busy = false }: Props) {
  const allSelected = rows.length > 0 && rows.every(row => selectedIds.has(row.id));
  const someSelected = rows.some(row => selectedIds.has(row.id));
  const selectable = Boolean(onDelete);

  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border bg-card text-card-foreground" role="region" aria-label="Tabla de productos" tabIndex={0}>
      <table className="w-full min-w-[780px] text-sm">
        <thead className="border-b border-border bg-muted/30">
          <tr>
            <th scope="col" className="w-11 px-3 py-3">
              {selectable && <Checkbox disabled={busy || !rows.length} checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={onToggleAll} aria-label={allSelected ? "Desmarcar este grupo" : "Seleccionar este grupo"} />}
            </th>
            {columns.map(column => (
              <th key={column.key} scope="col" aria-sort={column.sort && sortCol === column.sort ? (sortDir === "desc" ? "descending" : "ascending") : undefined} className={cn("px-3 py-3 text-xs font-semibold text-muted-foreground", column.numeric ? "text-right" : "text-left")}>
                {column.sort && onSort ? (
                  <button type="button" className="inline-flex min-h-8 items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSort(column.sort!)} aria-label={`Ordenar por ${column.label.toLowerCase()}`}>
                    {column.label}
                    {sortCol === column.sort ? (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3" />}
                  </button>
                ) : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(product => {
            const discounted = product.discount_price_ars != null && product.discount_price_ars < product.sale_price_ars;
            const price = discounted ? product.discount_price_ars! : product.sale_price_ars;
            const critical = product.stock <= 0;
            const low = !critical && product.stock <= (product.low_stock_threshold ?? 3);
            const tone = critical ? "text-destructive" : low ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
            return (
              <tr key={product.id} className={cn("hover:bg-muted/30", selectedIds.has(product.id) && "bg-primary/5")}>
                <td className="px-3 py-3">{selectable && <Checkbox disabled={busy} checked={selectedIds.has(product.id)} onCheckedChange={() => onToggleRow(product.id)} aria-label={`Seleccionar ${product.name}`} />}</td>
                <td className="min-w-[200px] max-w-[280px] px-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30 text-muted-foreground">
                      {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-contain" loading="lazy" /> : product.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0"><p className="break-words font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.brand || "Sin marca"}</p></div>
                  </div>
                </td>
                <td className="max-w-[180px] px-3 py-3"><span className={cn("inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium break-words", product.category_color ?? "bg-muted text-muted-foreground")}>{product.category || "Sin categoría"}</span></td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><span className="font-medium">{money.format(price)}</span>{discounted && <del className="block text-xs text-muted-foreground">{money.format(product.sale_price_ars)}</del>}</td>
                <td className={cn("px-3 py-3 text-right", tone)}>
                  <StockCell row={product} busy={busy} onStockChange={onStockChange} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{product.profit_per_unit_ars == null ? <span className="text-xs text-muted-foreground">Sin costo</span> : <span className={product.profit_per_unit_ars < 0 ? "text-destructive" : undefined}>{money.format(product.profit_per_unit_ars)}</span>}</td>
                <td className={cn("whitespace-nowrap px-3 py-3 text-xs font-medium", tone)}>{critical ? "Sin stock" : low ? "Stock bajo" : "Disponible"}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    {([
                      { action: onEdit, label: "Editar", Icon: Pencil },
                      { action: onPriceHistory, label: "Historial de precios", Icon: History },
                      { action: onDuplicate, label: "Duplicar", Icon: Copy },
                      { action: onDelete, label: "Eliminar", Icon: Trash2 },
                    ]).filter(item => item.action).map(({ action, label, Icon }) => (
                      <Tooltip key={label}><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={busy} className={cn("h-10 w-10", label === "Eliminar" && "text-destructive hover:text-destructive")} aria-label={`${label} ${product.name}`} onClick={() => action!(product.id)}><Icon className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
                    ))}
                    {!onEdit && !onDuplicate && !onDelete && !onPriceHistory && <span className="text-xs text-muted-foreground">Sólo lectura</span>}
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No hay productos que coincidan.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}