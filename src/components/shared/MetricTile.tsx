import { fmtPct } from "@/lib/porcentaje";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Indicador del panel con el lenguaje del Inicio (2026-10-14, pedido del dueño:
 * «presupuestos, órdenes de compra, compras, integraciones… quedaron legacy»).
 * Había tres tarjetas de indicador distintas —barra lateral de color con
 * números monoespaciados (KPICard), borde por área (AreaKPICard) y acento
 * lateral (MetricCard)— y cada pantalla se veía de una época distinta. Ésta es
 * la única: borde suave, etiqueta corta, número en la tipografía de la
 * interfaz con cifras alineadas, ícono en un recuadro tenue y, si hace falta,
 * variación, pie o acción. KPICard y AreaKPICard la usan por dentro.
 */
export type TonoDeIndicador = "primary" | "success" | "warning" | "destructive" | "neutral";

const TONO: Record<TonoDeIndicador, { icono: string; valor: string }> = {
  primary: { icono: "bg-primary/10 text-primary", valor: "text-foreground" },
  success: { icono: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", valor: "text-foreground" },
  warning: { icono: "bg-amber-500/10 text-amber-600 dark:text-amber-400", valor: "text-foreground" },
  destructive: { icono: "bg-destructive/10 text-destructive", valor: "text-destructive" },
  neutral: { icono: "bg-muted text-muted-foreground", valor: "text-foreground" },
};

export interface MetricTileProps {
  label: string;
  value: string | number;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: TonoDeIndicador;
  /** Variación en %, con su texto (p. ej. «vs. mes anterior»). */
  change?: { value: number; label?: string };
  footer?: ReactNode;
  action?: { label: string; onClick: () => void };
  onClick?: () => void;
  className?: string;
}

export default function MetricTile({ label, value, sub, icon: Icon, tone = "primary", change, footer, action, onClick, className }: MetricTileProps) {
  const t = TONO[tone];
  const sube = (change?.value ?? 0) >= 0;
  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "metric-tile flex min-w-0 flex-col rounded-lg border border-border bg-card p-4",
        onClick && "cursor-pointer transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] font-medium uppercase leading-tight text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", t.icono)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className={cn("mt-2 truncate text-2xl font-bold leading-none tabular-nums", t.valor)}>{value}</p>
      {(sub || change) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {change && (
            <span className={cn("font-semibold tabular-nums", sube ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}
              aria-label={`${sube ? "Subió" : "Bajó"} ${fmtPct(Math.abs(change.value))}${change.label ? ` ${change.label}` : ""}`}>
              {sube ? "↑" : "↓"} {fmtPct(Math.abs(change.value))}
              {change.label && <span className="ml-1 font-normal text-muted-foreground">{change.label}</span>}
            </span>
          )}
          {sub && <span className="min-w-0 truncate">{sub}</span>}
        </div>
      )}
      {action && (
        <button type="button" onClick={e => { e.stopPropagation(); action.onClick(); }}
          className="mt-3 self-start text-xs font-medium text-primary hover:underline">
          {action.label}
        </button>
      )}
      {footer && <div className="mt-3 border-t border-border/60 pt-2.5">{footer}</div>}
    </div>
  );
}
