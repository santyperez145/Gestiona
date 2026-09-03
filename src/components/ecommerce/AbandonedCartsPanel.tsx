/**
 * Cola de carritos abandonados (paridad Shopify Abandoned checkouts).
 * El cron manda el email una sola vez; acá el comercio puede copiar/abrir el
 * mismo deep-link de recuperación sin inventar un segundo envío.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { formatARS } from "@/lib/supabaseStore";
import {
  abandonedCartItemCount,
  abandonedCartRecoveryHref,
  abandonedCartRecoveryLabel,
  abandonedCartRecoveryState,
  abandonedCartRecoveryTone,
  filterAbandonedCartsForQueue,
  type AbandonedCartRow,
} from "@/lib/abandonedCarts";
import { Copy, ExternalLink, MessageCircle, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

interface Props {
  carts: AbandonedCartRow[];
  loading: boolean;
  error: string | null;
  storeSlug?: string | null;
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

function absoluteRecoveryUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export default function AbandonedCartsPanel({
  carts, loading, error, storeSlug, onRetry,
}: Props) {
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

  const copyLink = async (href: string) => {
    const url = absoluteRecoveryUrl(href);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link de recuperación copiado");
    } catch {
      toast.error("No se pudo copiar el link");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {rows.length} {rows.length === 1 ? "carrito abandonado" : "carritos abandonados"}.
        El email de recuperación sale solo (una vez por carrito). Podés copiar el mismo link para WhatsApp o abrirlo.
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
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((row) => {
                const recovery = abandonedCartRecoveryState(row);
                const n = abandonedCartItemCount(row.items);
                const href = abandonedCartRecoveryHref(storeSlug, row.recovery_token);
                const email = row.customer_email?.trim() || "";
                return (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">
                        {email || "Visitante sin email"}
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
                    <td className="px-3 py-2.5">
                      {href ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 gap-1 px-2"
                            onClick={() => { void copyLink(href); }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copiar
                          </Button>
                          <Button type="button" size="sm" variant="outline" className="h-9 gap-1 px-2" asChild>
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Abrir
                            </a>
                          </Button>
                          {email ? (
                            <Button type="button" size="sm" variant="outline" className="h-9 gap-1 px-2" asChild>
                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(`Hola! Te dejo el link para retomar tu compra:\n${absoluteRecoveryUrl(href)}`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                                WA
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Sin link todavía</span>
                      )}
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
