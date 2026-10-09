import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buscarLiteral, camposProducto, crearIndiceBusqueda } from "@/lib/catalogSearch";
import { cn } from "@/lib/utils";

export type ProductoOpcion = {
  id: string;
  name: string;
  brand?: string | null;
  sku?: string | null;
  barcode?: string | null;
  barcode_aliases?: string[] | null;
};

const MAX_RESULTADOS = 50;

/**
 * Selector de producto para catálogos grandes. Un `Select` con 11.000
 * opciones dibuja todo y traba la pantalla; acá se busca por nombre, marca o
 * código sobre un índice armado una vez y se dibujan hasta 50 resultados.
 */
export default function ProductCombobox<T extends ProductoOpcion>({
  products, value, onChange, placeholder = "Buscar producto…", ariaLabel = "Producto", disabled, describe, className, allowClear,
}: {
  products: T[];
  value: string | null | undefined;
  onChange: (id: string, product: T | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Texto secundario por opción (stock, costo, SKU…). */
  describe?: (product: T) => string | null | undefined;
  className?: string;
  /** Muestra una opción para quitar la selección (valor ""). */
  allowClear?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // El índice se arma al abrir: un listado filtrado en línea por el padre no
  // recalcula 11.000 textos en cada render mientras el selector está cerrado.
  const indice = useMemo(() => (open ? crearIndiceBusqueda(products, p => camposProducto(p)) : null), [open, products]);
  const seleccionado = useMemo(() => (value ? products.find(p => p.id === value) ?? null : null), [products, value]);
  const resultados = useMemo(
    () => (indice && query.trim() ? buscarLiteral(indice, query) : products).slice(0, MAX_RESULTADOS),
    [indice, products, query],
  );
  useEffect(() => { if (open) { setQuery(""); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const elegir = (product: T | null) => {
    onChange(product?.id ?? "", product);
    setOpen(false);
  };

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" role="combobox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel} disabled={disabled}
        className={cn("flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-muted px-3 text-left text-sm disabled:opacity-50", className)}>
        <span className={cn("min-w-0 truncate", !seleccionado && "text-muted-foreground")}>
          {seleccionado ? `${seleccionado.name}${seleccionado.brand ? ` · ${seleccionado.brand}` : ""}` : value === "" && allowClear ? allowClear : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[18rem] p-0" align="start">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, marca o código"
          aria-label={`Buscar ${ariaLabel.toLowerCase()}`} aria-controls={listId}
          onKeyDown={e => { if (e.key === "Enter" && resultados[0]) { e.preventDefault(); elegir(resultados[0]); } }}
          className="h-10 w-full bg-transparent text-sm outline-none" />
      </div>
      <ul id={listId} role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto py-1">
        {allowClear && <li role="option" aria-selected={value === ""}>
          <button type="button" className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted" onClick={() => elegir(null)}>{allowClear}</button>
        </li>}
        {resultados.map(p => <li key={p.id} role="option" aria-selected={p.id === value}>
          <button type="button" onClick={() => elegir(p)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
            <Check className={cn("h-4 w-4 shrink-0", p.id === value ? "opacity-100" : "opacity-0")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{p.name}{p.brand ? ` · ${p.brand}` : ""}</span>
              {(describe?.(p) || p.sku) && <span className="block truncate text-xs text-muted-foreground">{describe?.(p) ?? `SKU ${p.sku}`}</span>}
            </span>
          </button>
        </li>)}
        {!resultados.length && <li className="px-3 py-3 text-sm text-muted-foreground">Ningún producto coincide.</li>}
        {resultados.length === MAX_RESULTADOS && <li className="px-3 py-2 text-xs text-muted-foreground">Mostrando {MAX_RESULTADOS}. Escribí más para afinar.</li>}
      </ul>
    </PopoverContent>
  </Popover>;
}
