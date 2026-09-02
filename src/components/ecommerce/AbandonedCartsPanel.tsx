/**
 * Cola de carritos abandonados (paridad Shopify Abandoned checkouts).
 * La recuperación por email la hace el cron; acá se ve qué hay y si ya avisó.
 */
import { Badge } from "@/components/ui/badge";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { formatARS } from "@/lib/supabaseStore";
import {
  abandonedCartItemCount,
  abandonedCartRecoveryLabel,
  abandonedCartRecoveryState,
  abandonedCartRecoveryTone,
  filterAbandonedCartsForQueue,
  type AbandonedCartRow,
} from "@/lib/abandonedCarts";
import { ShoppingCart } from "lucide-react";

interface Props {
  carts: AbandonedCartRow[];
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

export default function AbandonedCartsPanel({ carts, loading, error, onRetry }: Props) {
  const rows = filterAbandonedCartsForQueue(carts);

  if (loading) {
    return <WorkspaceState kind="initial-loading" title="Cargando carritos abandonados" loadingRows={4} />;
  }
  if (error) {
    return (
      <WorkspaceState
        kind="error-recoverable"
        title="No se pudieron cargar los carritos"
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
        title="No hay carritos abandonados"
        description="Cuando alguien deja productos sin comprar, aparecen acá. El aviso por correo lo manda el sistema una sola vez."
        icon={ShoppingCart}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {rows.length} {rows.length === 1 ? "carrito abandonado" : "carritos abandonados"}.
        El email de recuperación sale solo (una vez por carrito); no hace falta reenviarlo a mano.
      </p>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Ítems</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium">Recuperación</th>
                <th className="px-3 py-2 font-medium">Última actividad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((row) => {
                const recovery = abandonedCartRecoveryState(row);
                const n = abandonedCartItemCount(row.items);
                return (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">
                        {row.customer_email?.trim() || "Visitante sin email"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {n} {n === 1 ? "ítem" : "ítems"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatARS(Number(row.total) || Number(row.subtotal) || 0)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`text-xs ${abandonedCartRecoveryTone(recovery)}`}>
                        {abandonedCartRecoveryLabel(recovery)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {whenLabel(row.updated_at || row.created_at)}
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
