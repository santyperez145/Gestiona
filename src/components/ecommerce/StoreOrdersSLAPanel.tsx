import React from "react";
import { Clock, AlertTriangle, CheckCircle2, Package } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OrderRow {
  id: string;
  orderNumber: string;
  customerName?: string;
  totalArs: number;
  fulfillmentStatus: string;
  slaStatus: "normal" | "alert" | "overdue";
  actionRequired: string | null;
  storeName?: string;
  createdAt: string;
}

interface SLAMetrics {
  pending: number;
  overdue: number;
  actionsAvailable: number;
  totalToday: number;
}

export default function StoreOrdersSLAPanel({
  metrics,
  rows,
  storeName,
}: {
  metrics: SLAMetrics;
  rows: OrderRow[];
  storeName?: string;
}) {
  return (
    <section
      data-section="store-orders-sla"
      aria-label="Panel de SLA de pedidos de tienda"
      className="mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <header className="flex items-center gap-3 px-5 py-4 border-b border-border bg-gradient-to-r from-card to-muted/20">
        <Package className="h-5 w-5 text-primary shrink-0" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight truncate">
            SLA de pedidos — {storeName || "tu tienda"}
          </h2>
          <p className="text-[11px] text-muted-foreground truncate">
            Estado operativo del pipeline pedido → pago → fulfillment. Datos reales del sistema.
          </p>
        </div>
      </header>

      {/* Métricas */}
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        <MetricPill label="Total hoy" value={metrics.totalToday} color="text-foreground" />
        <MetricPill label="Pendiente" value={metrics.pending} color="text-yellow-500" />
        <MetricPill label="Atrasados (SLA)" value={metrics.overdue} color="text-red-500" />
        <MetricPill label="Acciones disponibles" value={metrics.actionsAvailable} color="text-emerald-400" />
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Pedido</th>
              <th className="text-left px-4 py-2.5">Cliente</th>
              <th className="text-right px-4 py-2.5">Total</th>
              <th className="text-left px-4 py-2.5">Estado fulfillment</th>
              <th className="text-left px-4 py-2.5">Estado SLA</th>
              <th className="text-left px-4 py-2.5">Acción pendiente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  Sin pedidos hoy. Publicá o registrá una venta para ver el pipeline.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium tabular-nums">{r.orderNumber}</td>
                  <td className="px-4 py-2.5 truncate max-w-[200px]">{r.customerName || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono">${r.totalArs.toLocaleString("es-AR")}</td>
                  <td className="px-4 py-2.5">{r.fulfillmentStatus}</td>
                  <td className="px-4 py-2.5">
                    <SLAStatusBadge status={r.slaStatus} />
                  </td>
                  <td className="px-4 py-2.5 text-xs truncate max-w-[250px]">
                    {r.actionRequired ? (
                      <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {r.actionRequired}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        Atendido
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Nota de evidencia */}
      <div className="px-4 py-2.5 bg-muted/20 border-t border-border flex items-center gap-2 text-[10px] text-muted-foreground">
        <Clock className="w-3 h-3 shrink-0" />
        Datos tomados directamente de la base; sin simular ni inventar tracción.
      </div>
    </section>
  );
}

function MetricPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-bold tabular-nums", color)}>{value}</span>
    </div>
  );
}

function SLAStatusBadge({ status }: { status: "normal" | "alert" | "overdue" }) {
  const map = {
    normal: { label: "Normal", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
    alert: { label: "Alerta", className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: Clock },
    overdue: { label: "Atrasado", className: "bg-red-500/10 text-red-400 border-red-500/20", icon: AlertTriangle },
  };
  const s = map[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide", s.className)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}
