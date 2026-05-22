/**
 * useRealtimeKPIs — Live dashboard KPIs via Supabase Realtime Postgres Changes.
 *
 * Subscribes to INSERT/UPDATE events on `sales`, `debts`, `products`.
 * Returns callbacks to register "on change" handlers so any page
 * can reactively update without polling.
 *
 * Usage:
 *   const { salesCount, todayRevenue } = useRealtimeKPIs(orgId);
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LiveKPIs {
  lastSale: { amount: number; product: string; customer: string } | null;
  saleEventCount: number; // increments on each new sale — use as dep in useEffect
  stockEventCount: number; // increments on stock changes
  debtEventCount: number;
}

export function useRealtimeKPIs(orgId: string | undefined): LiveKPIs {
  const [lastSale, setLastSale] = useState<LiveKPIs["lastSale"]>(null);
  const [saleEventCount, setSaleEventCount] = useState(0);
  const [stockEventCount, setStockEventCount] = useState(0);
  const [debtEventCount, setDebtEventCount] = useState(0);

  useEffect(() => {
    if (!orgId) return;

    const channelName = `kpi-realtime-${orgId}`;
    const stale = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(channelName)
      // ── New sale ─────────────────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sales", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const sale = payload.new as any;
          const amount = Number(sale.total_ars || 0);
          const product = sale.product_name || "Venta";
          const customer = sale.customer_name || "Cliente";

          setLastSale({ amount, product, customer });
          setSaleEventCount(n => n + 1);

          // Live toast — non-intrusive
          toast.success(`💰 Nueva venta: $${Math.round(amount).toLocaleString("es-AR")}`, {
            description: `${product} · ${customer}`,
            duration: 4000,
          });
        }
      )
      // ── Stock movement ────────────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stock_movements", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const mv = payload.new as any;
          setStockEventCount(n => n + 1);

          // Only alert on low stock
          if (mv.qty_after !== undefined && Number(mv.qty_after) <= 2 && Number(mv.qty_after) >= 0) {
            toast.warning(`⚠️ Stock bajo: ${mv.product_name || "Producto"}`, {
              description: `Quedan ${mv.qty_after} unidades`,
              duration: 6000,
            });
          }
        }
      )
      // ── New debt ──────────────────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "debts", filter: `org_id=eq.${orgId}` },
        () => {
          setDebtEventCount(n => n + 1);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  return { lastSale, saleEventCount, stockEventCount, debtEventCount };
}
