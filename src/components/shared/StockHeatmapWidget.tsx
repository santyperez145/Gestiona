/**
 * StockHeatmapWidget — Visual stock grid showing inventory health at a glance.
 *
 * Renders each product as a colored tile based on stock level:
 *   🔴 red    = out of stock (0)
 *   🟠 orange = critically low (≤ threshold)
 *   🟡 yellow = low (≤ 2x threshold)
 *   🟢 green  = healthy
 *   🔵 blue   = overstocked (> 10x threshold)
 *
 * Hovering shows product name + stock count.
 * Clicking a tile navigates to /productos.
 *
 * Inspired by GitHub contributions heatmap UX.
 *
 * Usage:
 *   <StockHeatmapWidget products={products} maxTiles={60} />
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package } from "lucide-react";

import { plural } from "@/lib/plural";
interface Product {
  id: string;
  name: string;
  stock: number;
  low_stock_threshold?: number | null;
  category?: string;
}

interface Props {
  products: Product[];
  maxTiles?: number;
  className?: string;
}

function getColor(stock: number, threshold: number): {
  bg: string;
  border: string;
  level: "empty" | "critical" | "low" | "ok" | "high";
} {
  if (stock <= 0)          return { bg: "bg-red-500/80",    border: "border-red-600/50",    level: "empty" };
  if (stock <= threshold)  return { bg: "bg-orange-400/70", border: "border-orange-500/50", level: "critical" };
  if (stock <= threshold * 2) return { bg: "bg-yellow-400/60", border: "border-yellow-500/50", level: "low" };
  if (stock <= threshold * 10) return { bg: "bg-emerald-500/55", border: "border-emerald-600/40", level: "ok" };
  return { bg: "bg-blue-400/50", border: "border-blue-500/40", level: "high" };
}

const LEVEL_LABELS = {
  empty:    "Sin stock",
  critical: "Stock crítico",
  low:      "Stock bajo",
  ok:       "Stock OK",
  high:     "Sobrestock",
};

export default function StockHeatmapWidget({ products, maxTiles = 80, className = "" }: Props) {
  const navigate = useNavigate();
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  const sorted = useMemo(() => {
    return [...products]
      .sort((a, b) => a.stock - b.stock)
      .slice(0, maxTiles);
  }, [products, maxTiles]);

  const stats = useMemo(() => {
    const outOfStock  = products.filter(p => p.stock <= 0).length;
    const critical    = products.filter(p => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 3)).length;
    const low         = products.filter(p => p.stock > (p.low_stock_threshold ?? 3) && p.stock <= (p.low_stock_threshold ?? 3) * 2).length;
    const ok          = products.filter(p => p.stock > (p.low_stock_threshold ?? 3) * 2).length;
    return { outOfStock, critical, low, ok, total: products.length };
  }, [products]);

  const hoveredProduct = tooltip ? products.find(p => p.id === tooltip.id) : null;

  if (products.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-8 text-muted-foreground ${className}`}>
        <Package className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-sm">Sin productos</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2 text-xs">
        {stats.outOfStock > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {stats.outOfStock} sin stock
          </span>
        )}
        {stats.critical > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            {stats.critical} crítico
          </span>
        )}
        {stats.low > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            {stats.low} bajo
          </span>
        )}
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {stats.ok} OK
        </span>
      </div>

      {/* Heatmap grid */}
      <div
        className="relative"
        onMouseLeave={() => setTooltip(null)}
      >
        <div className="flex flex-wrap gap-1">
          {sorted.map(p => {
            const threshold = p.low_stock_threshold ?? 3;
            const { bg, border } = getColor(p.stock, threshold);
            return (
              <button
                key={p.id}
                className={`w-6 h-6 rounded-sm border ${bg} ${border} transition-all duration-150 hover:scale-125 hover:z-10 relative focus:outline-none focus:ring-1 focus:ring-primary`}
                onMouseEnter={e => {
                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                  setTooltip({ id: p.id, x: rect.left, y: rect.top });
                }}
                onClick={() => navigate("/productos")}
                title={`${p.name}: ${p.stock} uds`}
                aria-label={`${p.name}: ${plural(p.stock, "unidad", "unidades")}`}
              />
            );
          })}
        </div>

        {/* Floating tooltip */}
        {hoveredProduct && tooltip && (
          <div
            className="fixed z-50 pointer-events-none bg-popover border border-border rounded-lg shadow-xl px-3 py-2 text-xs"
            style={{ left: Math.min(tooltip.x + 12, window.innerWidth - 180), top: Math.max(tooltip.y - 50, 8) }}
          >
            <p className="font-semibold truncate max-w-[160px]">{hoveredProduct.name}</p>
            <p className="text-muted-foreground mt-0.5">
              Stock: <span className="font-mono font-bold text-foreground">{hoveredProduct.stock}</span>
            </p>
            {hoveredProduct.category && (
              <p className="text-muted-foreground text-[10px]">{hoveredProduct.category}</p>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        {(["empty", "critical", "low", "ok", "high"] as const).map(level => {
          const colors = {
            empty:    "bg-red-500/70",
            critical: "bg-orange-400/70",
            low:      "bg-yellow-400/60",
            ok:       "bg-emerald-500/55",
            high:     "bg-blue-400/50",
          };
          return (
            <span key={level} className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded-sm ${colors[level]}`} />
              {LEVEL_LABELS[level]}
            </span>
          );
        })}
      </div>

      {products.length > maxTiles && (
        <p className="text-[10px] text-muted-foreground">
          Mostrando {maxTiles} de {products.length} productos (ordenados por stock ↑)
        </p>
      )}
    </div>
  );
}
