import React from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ChevronUp, ChevronDown, Pencil } from "lucide-react";

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
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id)) && !allSelected;

  return (
    <div className="relative w-full overflow-auto rounded-xl border border-[#1a1a2e]/60 bg-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset,0_12px_40px_rgba(0,0,0,0.6)]" aria-label="Tabla de productos propia">
      <table className="w-full text-[12px] leading-relaxed">
        <thead>
          <tr className="border-b border-[#1a1a2e]/70">
            <th className="w-10 px-2 py-3 text-left">
              <button
                type="button"
                onClick={onToggleAll}
                className="text-[#c4b8a8]/60 hover:text-[#f59e0b] transition-colors"
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
                className={cn("px-3 py-3 font-bold tracking-wider uppercase text-[10px] text-[#c4b8a8]/70 hover:text-[#f59e0b]/90 transition-colors cursor-pointer select-none", h.align === "right" ? "text-right" : "text-center")}
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
        <tbody className="divide-y divide-[#1a1a2e]/60">
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
                <td className="px-3 py-3 min-w-[220px]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-[#0f0f23] border border-[#1a1a2e]/60">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-[#555] text-xs font-black">{(p.name || "?").charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#f5f3ed] truncate text-[11.5px] leading-snug">{p.name}</p>
                      <p className="text-[10px] text-[#c4b8a8]/50 truncate">{p.brand || "—"}</p>
                      {p.featured && (
                        <span className="inline-block mt-0.5 px-1 py-[1px] text-[9px] font-black rounded bg-[#173aef]/20 text-[#173aef] border border-[#173aef]/25">DESTACADO</span>
                      )}
                      {hasDiscount && (
                        <span className="inline-block mt-0.5 px-1 py-[1px] text-[9px] font-black rounded bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/25">-{Math.round((1 - Number(p.discount_price_ars!) / p.sale_price_ars) * 100)}%</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-[11px] text-[#c4b8a8]/70">
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold", p.category ? "bg-[#f59e0b]/10 text-[#f59e0b]/90 border border-[#f59e0b]/20" : "bg-[#333]/40 text-[#888]")}>
                    {p.category || "—"}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-[11.5px]">
                  {hasDiscount ? (
                    <div className="flex flex-col items-end">
                      <span className="font-black text-[#f59e0b]">${Number(p.discount_price_ars).toLocaleString("es-AR")}</span>
                      <span className="line-through text-[10px] text-[#777]">${p.sale_price_ars.toLocaleString("es-AR")}</span>
                    </div>
                  ) : (
                    <span className="font-medium text-[#f5f3ed]">${p.sale_price_ars.toLocaleString("es-AR")}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <span className={cn("font-mono text-[11px] font-bold", critical ? "text-rose-400" : low ? "text-amber-300" : "text-emerald-400")}>
                    {p.stock}
                  </span>
                  {low && (
                    <span className="block text-[9px] text-amber-300/70">bajo</span>
                  )}
                  {critical && (
                    <span className="block text-[9px] text-rose-400/70">agotado</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-mono text-[11px] text-emerald-400">
                  {p.profit_per_unit_ars ? `$${Number(p.profit_per_unit_ars).toLocaleString("es-AR")}` : "—"}
                  {p.profit_per_unit_ars && p.sale_price_ars > 0 && (
                    <span className="block text-[9px] text-emerald-400/50">({Math.round((Number(p.profit_per_unit_ars) / p.sale_price_ars) * 100)}%)</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("w-2 h-2 rounded-full", critical ? "bg-rose-400 animate-pulse" : low ? "bg-amber-300" : "bg-emerald-400")} />
                    <span className={cn("text-[10px] font-semibold", critical ? "text-rose-400" : low ? "text-amber-300" : "text-emerald-400")}>
                      {critical ? "Agotado" : low ? "Alerta" : "Activo"}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-xs text-[#777]">Sin productos que coincidan.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
