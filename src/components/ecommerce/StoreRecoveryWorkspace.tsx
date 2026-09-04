/**
 * Recuperación operativa (abandonados + reposición) — misma cola que el Foco.
 * Vive en `/pedidos-online?cola=recuperacion` para no enterrar GMV en Ajustes.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AbandonedCartsPanel from "@/components/ecommerce/AbandonedCartsPanel";
import StockAlertsPanel from "@/components/ecommerce/StockAlertsPanel";
import {
  filterAbandonedCartsForQueue,
  type AbandonedCartRow,
} from "@/lib/abandonedCarts";
import {
  countPendingStockAlerts,
  type StockAlertRow,
} from "@/lib/stockAlerts";

type RecoveryVista = "abandonados" | "reposicion";

function parseRecoveryVista(raw: string | null): RecoveryVista {
  return raw === "reposicion" ? "reposicion" : "abandonados";
}

interface Props {
  orgId: string | null;
  storeSlug: string | null;
}

export default function StoreRecoveryWorkspace({ orgId, storeSlug }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const vista = parseRecoveryVista(searchParams.get("vista"));

  const [abandonedCartRows, setAbandonedCartRows] = useState<AbandonedCartRow[]>([]);
  const [abandonedCarts, setAbandonedCarts] = useState(0);
  const [abandonedLoading, setAbandonedLoading] = useState(true);
  const [abandonedError, setAbandonedError] = useState<string | null>(null);

  const [stockAlertRows, setStockAlertRows] = useState<StockAlertRow[]>([]);
  const [stockAlertsPending, setStockAlertsPending] = useState(0);
  const [stockAlertsLoading, setStockAlertsLoading] = useState(true);
  const [stockAlertsError, setStockAlertsError] = useState<string | null>(null);

  const loadAbandoned = useCallback(async () => {
    if (!orgId) {
      setAbandonedCartRows([]);
      setAbandonedCarts(0);
      setAbandonedLoading(false);
      return;
    }
    setAbandonedLoading(true);
    setAbandonedError(null);
    const { data, error } = await supabase
      .from("ecommerce_cart_sessions")
      .select("id, status, items, customer_email, subtotal, total, abandoned_email_sent, recovery_token, expires_at, updated_at, created_at")
      .eq("org_id", orgId);
    if (error) {
      console.error("StoreRecoveryWorkspace / carritos:", error);
      setAbandonedError(error.message);
      setAbandonedLoading(false);
      return;
    }
    const rows = (data ?? []) as AbandonedCartRow[];
    const queue = filterAbandonedCartsForQueue(rows);
    setAbandonedCarts(queue.length);
    setAbandonedCartRows(queue);
    setAbandonedLoading(false);
  }, [orgId]);

  const loadStockAlerts = useCallback(async () => {
    if (!orgId) {
      setStockAlertRows([]);
      setStockAlertsPending(0);
      setStockAlertsLoading(false);
      return;
    }
    setStockAlertsLoading(true);
    setStockAlertsError(null);
    const { data, error } = await supabase
      .from("store_stock_alerts")
      .select("id, email, product_id, variant_id, notified_at, created_at, products(name, stock)")
      .eq("org_id", orgId)
      .is("notified_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("StoreRecoveryWorkspace / avisos reposición:", error);
      setStockAlertsError(error.message);
      setStockAlertsLoading(false);
      return;
    }
    const rows: StockAlertRow[] = (data ?? []).map((raw) => {
      const r = raw as Record<string, unknown>;
      const prod = r.products as { name?: string; stock?: number } | null;
      return {
        id: String(r.id),
        email: String(r.email),
        product_id: String(r.product_id),
        variant_id: (r.variant_id as string | null) ?? null,
        notified_at: (r.notified_at as string | null) ?? null,
        created_at: String(r.created_at),
        product_name: prod?.name ?? null,
        product_stock: prod?.stock ?? null,
      };
    });
    setStockAlertRows(rows);
    setStockAlertsPending(countPendingStockAlerts(rows));
    setStockAlertsLoading(false);
  }, [orgId]);

  useEffect(() => { void loadAbandoned(); }, [loadAbandoned]);
  useEffect(() => { void loadStockAlerts(); }, [loadStockAlerts]);

  const setVista = (next: RecoveryVista) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("cola", "recuperacion");
      if (next === "reposicion") p.set("vista", "reposicion");
      else p.delete("vista");
      return p;
    }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={vista === "abandonados" ? "default" : "outline"}
          className="min-h-11"
          onClick={() => setVista("abandonados")}
        >
          Carritos abandonados
          {abandonedCarts > 0 ? ` (${abandonedCarts})` : ""}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={vista === "reposicion" ? "default" : "outline"}
          className="min-h-11"
          onClick={() => setVista("reposicion")}
        >
          Avisos de reposición
          {stockAlertsPending > 0 ? ` (${stockAlertsPending})` : ""}
        </Button>
      </div>
      {vista === "reposicion" ? (
        <StockAlertsPanel
          alerts={stockAlertRows}
          loading={stockAlertsLoading}
          error={stockAlertsError}
          onRetry={() => { void loadStockAlerts(); }}
        />
      ) : (
        <AbandonedCartsPanel
          carts={abandonedCartRows}
          loading={abandonedLoading}
          error={abandonedError}
          storeSlug={storeSlug}
          onRetry={() => { void loadAbandoned(); }}
        />
      )}
    </div>
  );
}
