/**
 * useStockAlerts — Supabase Realtime listener for stock changes.
 *
 * Fires a toast + browser Notification when any product's stock
 * drops to or below the configured threshold.
 * Request notification permission on first use.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
import { toast } from "sonner";

interface StockAlertOptions {
  orgId: string | undefined;
  threshold?: number; // default 5
  enabled?: boolean;
}

function requestNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function fireNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico", tag: "stock-alert" });
  } catch { /* ignore */ }
}

export function useStockAlerts({ orgId, threshold = 5, enabled = true }: StockAlertOptions) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const alertedRef = useRef<Set<string>>(new Set()); // debounce: don't repeat same product

  useEffect(() => {
    if (!enabled) return;
    requestNotificationPermission();
  }, [enabled]);

  useEffect(() => {
    if (!orgId || !enabled) return;

    const channel = safeChannel(`stock-alerts-${orgId}`);

    channel
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "products",
          filter: `org_id=eq.${orgId}`,
        },
        (payload: { new: any; old: any }) => {
          const { new: p, old } = payload;
          const newStock = Number(p.stock ?? 0);
          const oldStock = Number(old?.stock ?? Infinity);
          const productKey = `${p.id}-${newStock}`;

          // Only alert when stock just crossed below threshold (not on every update)
          if (newStock <= threshold && oldStock > threshold && !alertedRef.current.has(productKey)) {
            alertedRef.current.add(productKey);
            // Clear after 30s so re-alerts are possible on further drops
            setTimeout(() => alertedRef.current.delete(productKey), 30_000);

            const name = p.name || "Producto";
            if (newStock <= 0) {
              toast.error(`⚠️ Sin stock: ${name}`, { duration: 8000, description: "Stock agotado — revisar reposición" });
              fireNotification(`⚠️ Sin stock: ${name}`, "Stock agotado — revisar reposición");
            } else {
              toast.warning(`📦 Stock bajo: ${name} — quedan ${newStock} ud${newStock !== 1 ? "s" : ""}`, {
                duration: 6000,
                description: `Por debajo del umbral de ${threshold} unidades`,
              });
              fireNotification(`📦 Stock bajo: ${name}`, `Quedan ${newStock} unidades`);
            }
          }
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, threshold, enabled]);
}
