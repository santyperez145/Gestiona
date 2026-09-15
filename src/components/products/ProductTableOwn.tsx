/* Tabla propia Nerqia — modo claro y oscuro sin shadcn genérico */
import React from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ChevronUp, ChevronDown, Pencil, Copy, Trash2 } from "lucide-react";

export interface ProductRow {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  gender?: string;
  image_url?: string | null;
  sale_price_ars: number;
  discount_price_ars?: number | null;
  stock: number;
  profit_per_unit_ars?: number;
  featured?: boolean;
  updated_at?: string;
  low_stock_threshold?: number;
}

interface Props {
  rows: ProductRow[];
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  sortCol?: string;
  sortDir?: "asc" | "desc";
  onSort?: (col: string) => void;
  onEdit?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

function SortIcon({ active, dir }: { active?: boolean; dir?: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
  return dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}

export default function ProductTableOwn({
  rows,
  selectedIds,
  onToggleRow,
  onToggleAll,
  sortCol,
  sortDir,
  onSort,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id)) && !allSelected;

  return (
    <div className="relative w-full overflow-x-auto rounded-xl border border-[#1a1a2e]/60 bg-[#0b0b18]/90 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset,0_12px_40px_rgba(0,0,0,0.6)]" aria-label="Tabla de productos propia">
      <table className="w-full text-[13px] leading-snug">
        <thead>
          <tr className="border-b border-[#2a2a3e] bg-[#0f0f23]/80">
            <th className="w-10 px-2 py-3 text-left">
              <button
                type="button"
                onClick={onToggleAll}
                className="text-[#c4b8a8]/70 hover:text-[#f59e0b] transition-colors"
                aria-label={allSelected ? "Desmarcar todos" : "Marcar todos"}
              >
                <span className={cn("inline-block w-3.5 h-3.5 rounded-[3px] border", allSelected ? "bg-[#f59e0b] border-[#f59e0b]" : someSelected ? "bg-[#f59e0b]/20 border-[#f59e0b]/60" : "border-[#555]/60 bg-transparent")} />
              </button>
            </th>
            {[
              { col: "name", label: "Producto" },
              { col: "category", label: "Categoría" },
              { col: "sale_price_ars", label: "Venta", align: "right" },
              { col: "stock", label: "Stock", align: "right" },
              { col: "profit_per_unit_ars", label: "Ganancia", align: "right" },
              { col: "status", label: "Estado", align: "center" },
              { col: "actions", label: "Acciones", align: "center" },
            ].map((h) => (
              <th
                key={h.col}
                className={cn("px-3 py-3 font-bold tracking-wider uppercase text-[10px] text-[#e4e4e7]/80 hover:text-[#f59e0b]/90 transition-colors cursor-pointer select-none", h.align === "right" ? "text-right" : "text-center")}
                onClick={() => onSort?.(h.col)}
              >
                <span className="inline-flex items-center gap-1">
                  {h.label}
                  <SortIcon active={sortCol === h.col} dir={sortCol === h.col ? sortDir : undefined} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#2a2a3e]/60">
          {rows.map((p) => {
            const hasDiscount = p.discount_price_ars && Number(p.discount_price_ars) < p.sale_price_ars;
            const low = p.stock <= (p.low_stock_threshold ?? 3);
            const critical = p.stock <= 0;
            return (
              <tr
                key={p.id}
                className={cn(
                  "transition-colors hover:bg-[#173aef]/[0.08]",
                  selectedIds.has(p.id) && "bg-[#173aef]/[0.12]"
                )}
              >
                <td className="px-2 py-3">
                  <button
                    type="button"
                    onClick={() => onToggleRow(p.id)}
                    className={cn(
                      "w-3.5 h-3.5 rounded-[3px] border shrink-0 transition-colors",
                      selectedIds.has(p.id)
                        ? "bg-[#f59e0b] border-[#f59e0b]"
                        : "border-[#555]/60 bg-transparent hover:border-[#f59e0b]/60"
                    )}
                    aria-label={`Seleccionar ${p.name}`}
                  />
                </td>
                <td className="px-3 py-3 min-w-[180px] max-w-[220px] text-[13px] text-[#f5f3ed]/95">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-[#0f0f23] border border-[#1a1a2e]/60 shadow-sm">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-[#777] text-sm font-bold">{p.name?.charAt(0)?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#f5f3ed] truncate text-[13px] leading-tight">{p.name}</p>
                      <p className="text-[11px] text-[#c4b8a8]/80 font-medium truncate">{p.brand || "—"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <span className={cn("font-mono text-[13px] font-bold", critical ? "text-rose-500" : low ? "text-amber-400" : "text-emerald-400")}>
                    {p.stock}
                  </span>
                  {low && (
                    <span className="block text-[10px] text-amber-400/80">bajo</span>
                  )}
                  {critical && (
                    <span className="block text-[10px] text-rose-400/80">agotado</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-mono text-[13px] text-[#f5f3ed]">
                  {p.profit_per_unit_ars ? (
                    <>
                      <span className="font-black text-[#f59e0b]">${Number(p.profit_per_unit_ars).toLocaleString("es-AR")}</span>
                      {p.sale_price_ars > 0 && (
                        <span className="block text-[10px] text-emerald-400/60">({Math.round((Number(p.profit_per_unit_ars) / p.sale_price_ars) * 100)}%)</span>
                      )}
                    </>
                  ) : p.sale_price_ars ? (
                    <span className="font-medium">${p.sale_price_ars.toLocaleString("es-AR")}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={cn("w-2 h-2 rounded-full", critical ? "bg-rose-500 animate-pulse" : low ? "bg-amber-500" : "bg-emerald-500")} />
                    <span className={cn("text-[11px] font-semibold", critical ? "text-rose-500" : low ? "text-amber-400" : "text-emerald-400")}>
                      {critical ? "Agotado" : low ? "Alerta" : "Activo"}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onEdit?.(p.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-[#173aef] bg-[#173aef]/15 border border-[#173aef]/30 hover:bg-[#173aef]/25 hover:border-[#173aef]/40 transition-all"
                      aria-label={`Editar ${p.name}`}
                    >
                      <Pencil className="w-3 h-3" />
                      Editar
                    </button>
                    {onDuplicate && (
                      <button
                        type="button"
                        onClick={() => onDuplicate(p.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-amber-400 bg-amber-400/15 border border-amber-400/30 hover:bg-amber-400/25 hover:border-amber-400/40 transition-all"
                        aria-label={`Duplicar ${p.name}`}
                      >
                        <Copy className="w-3 h-3" />
                        Copiar
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(p.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-rose-400 bg-rose-400/15 border border-rose-400/30 hover:bg-rose-500/25 hover:border-rose-500/40 transition-all"
                        aria-label={`Eliminar ${p.name}`}
                      >
                        <Trash2 className="w-3 h-3" />
                        Borrar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-xs text-[#777]/[0.8]">
                No hay productos que coincidan.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}