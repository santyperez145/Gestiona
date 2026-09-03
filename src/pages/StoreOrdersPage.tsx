/**
 * Pedidos de la tienda online — cola operativa de primer nivel.
 *
 * Shopify/Tiendanube separan Pedidos de Diseño/Pagos. Recuperación
 * (abandonados + reposición) vive acá como hermano, no en Ajustes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import PageHeader from "@/components/shared/PageHeader";
import WorkspaceState from "@/components/shared/WorkspaceState";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import StoreOrdersWorkspace from "@/components/ecommerce/StoreOrdersWorkspace";
import StoreRecoveryWorkspace from "@/components/ecommerce/StoreRecoveryWorkspace";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  STORE_ORDER_QUEUE_LIMIT,
  countStoreOrdersNeedingAttention,
} from "@/lib/storeOrderQueue";
import { STORE_ORDER_LIST_SELECT, type StoreOrderInspectRow } from "@/lib/storeOrderDetail";
import { parseStoreOrdersCola } from "@/lib/storeOrdersCanonical";
import { urlPublicaDeTienda } from "@/lib/storeFirstPublish";
import {
  filterAbandonedCartsForQueue,
  type AbandonedCartRow,
} from "@/lib/abandonedCarts";
import { countPendingStockAlerts } from "@/lib/stockAlerts";
import { RotateCcw, Settings, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function StoreOrdersPage() {
  usePageTitle("Pedidos");
  const { orgId } = useOrganization();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cola = parseStoreOrdersCola(searchParams.get("cola"));
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("Tu tienda");
  const [orders, setOrders] = useState<StoreOrderInspectRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setStoreSlug(null);
      return;
    }
    supabase
      .from("ecommerce_stores")
      .select("slug, name")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        setStoreSlug(data?.slug ?? null);
        setStoreName(data?.name ?? "Tu tienda");
      });
  }, [orgId]);

  const loadOrders = useCallback(async () => {
    if (!orgId) {
      setOrders([]);
      setOrdersLoading(false);
      return;
    }
    setOrdersLoading(true);
    setOrdersError(null);
    const { data, error } = await supabase
      .from("ecommerce_orders")
      .select(STORE_ORDER_LIST_SELECT)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(STORE_ORDER_QUEUE_LIMIT);
    if (error) {
      console.error("No se pudieron leer los pedidos de la tienda", error);
      setOrders([]);
      setOrdersError("No pudimos leer los pedidos de la tienda. Reintentá.");
    } else {
      setOrders((data ?? []) as StoreOrderInspectRow[]);
    }
    setOrdersLoading(false);
  }, [orgId]);

  const loadRecoveryCounts = useCallback(async () => {
    if (!orgId) {
      setRecoveryPending(0);
      return;
    }
    const [carts, alerts] = await Promise.all([
      supabase
        .from("ecommerce_cart_sessions")
        .select("id, status, items, customer_email, subtotal, total, abandoned_email_sent, recovery_token, updated_at, created_at")
        .eq("org_id", orgId),
      supabase
        .from("store_stock_alerts")
        .select("id, email, product_id, variant_id, notified_at, created_at, products(name, stock)")
        .eq("org_id", orgId)
        .is("notified_at", null),
    ]);
    if (carts.error) {
      console.error("StoreOrdersPage / recovery carritos:", carts.error);
    }
    if (alerts.error) {
      console.error("StoreOrdersPage / recovery reposición:", alerts.error);
    }
    const abandoned = filterAbandonedCartsForQueue((carts.data ?? []) as AbandonedCartRow[]).length;
    const stockRows = (alerts.data ?? []).map((raw) => {
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
    setRecoveryPending(abandoned + countPendingStockAlerts(stockRows));
  }, [orgId]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => { void loadRecoveryCounts(); }, [loadRecoveryCounts]);

  const ordersAttention = useMemo(
    () => countStoreOrdersNeedingAttention(orders),
    [orders],
  );

  const urlPublica = urlPublicaDeTienda(
    typeof window === "undefined" ? "" : window.location.origin,
    storeSlug,
  );

  const setCola = (next: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "recuperacion") {
        p.set("cola", "recuperacion");
        p.delete("pedido");
        p.delete("q");
        p.delete("orden");
        p.delete("medio");
      } else {
        p.delete("cola");
        if (p.get("vista") === "reposicion") p.delete("vista");
      }
      return p;
    }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingBag}
        title="Pedidos"
        description="Cola de pedidos y recuperación de carritos: cobrar, despachar y recuperar GMV. Misma autoridad que el checkout público."
        actions={(
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5" asChild>
            <Link to="/tienda-online">
              <Settings className="h-4 w-4" />
              Configurar tienda
            </Link>
          </Button>
        )}
      />

      <WorkspaceViewTabs
        ariaLabel="Colas de la tienda online"
        activeTab={cola}
        onChange={setCola}
        tabs={[
          {
            id: "pedidos",
            label: "Pedidos",
            icon: ShoppingBag,
            count: ordersAttention > 0 ? ordersAttention : undefined,
          },
          {
            id: "recuperacion",
            label: "Recuperación",
            icon: RotateCcw,
            count: recoveryPending > 0 ? recoveryPending : undefined,
          },
        ]}
      />

      {!storeSlug && !ordersLoading && cola === "pedidos" ? (
        <WorkspaceState
          kind="empty-first-use"
          icon={ShoppingBag}
          title="Todavía no hay tienda online"
          description="Publicá la tienda para recibir pedidos. Mientras tanto podés vender desde el mostrador."
          actionLabel="Ir a Tienda online"
          onAction={() => navigate("/tienda-online")}
        />
      ) : cola === "recuperacion" ? (
        <StoreRecoveryWorkspace orgId={orgId} storeSlug={storeSlug} />
      ) : (
        <StoreOrdersWorkspace
          orgId={orgId}
          storeName={storeName}
          publicStoreUrl={urlPublica}
          orders={orders}
          ordersLoading={ordersLoading}
          ordersError={ordersError}
          onReload={loadOrders}
        />
      )}
    </div>
  );
}
