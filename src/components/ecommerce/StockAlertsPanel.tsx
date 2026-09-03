/**
 * Cola de avisos «Avisame cuando vuelva» (Shopify / Klaviyo Back in stock).
 * Vive bajo el tab Carritos: misma superficie de recuperación, sin ruta nueva.
 */
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WorkspaceState from "@/components/shared/WorkspaceState";
import {
  countPendingStockAlerts,
  filterPendingStockAlerts,
  stockAlertState,
  stockAlertStateLabel,
  stockAlertStateTone,
  type StockAlertRow,
} from "@/lib/stockAlerts";
import { BellRing } from "lucide-react";

interface Props {
  alerts: StockAlertRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function whenLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StockAlertsPanel({ alerts, loading, error, onRetry }: Props) {
  const rows = filterPendingStockAlerts(alerts);
  const pending = countPendingStockAlerts(alerts);

  if (loading) {
    return <WorkspaceState kind="initial-loading" title="Cargando avisos de reposición" loadingRows={4} />;
  }
  if (error) {
    return (
      <WorkspaceState
        kind="error-recoverable"
        title="No se pudieron cargar los avisos"
        description={error}
        actionLabel="Reintentar"
        onAction={onRetry}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <WorkspaceState
        kind="empty-first-use"
        title="Nadie pidió aviso de reposición"
        description="Cuando un producto está agotado, el comprador puede dejar su email. Aparecen acá; el sistema avisa una sola vez cuando vuelve el stock."
        icon={BellRing}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {pending} {pending === 1 ? "persona esperando" : "personas esperando"} stock.
        El correo sale solo cuando hay unidades otra vez (una vez por pedido).
      </p>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Pedido</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = stockAlertState(row);
                return (
                  <tr key={row.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2.5">{row.email}</td>
                    <td className="px-3 py-2.5">{row.product_name ?? "Producto"}</td>
                    <td className="px-3 py-2.5">
                      <Badge className={stockAlertStateTone(state)}>
                        {stockAlertStateLabel(state)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {whenLabel(row.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="outline" className="min-h-11" asChild>
                        <Link to={`/productos?highlight=${row.product_id}`}>Ver ficha</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
