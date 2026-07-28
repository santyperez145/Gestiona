/**
 * useStockAlerts — Supabase Realtime listener for stock changes.
 *
 * Fires a toast + browser Notification when any product's stock
 * drops to or below the configured threshold.
 *
 * Also inserts a record into the `notifications` table so the
 * NotificationBell panel shows the alert persistently.
 *
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

/** Insert a notification row so it shows up in NotificationBell */
async function insertNotification(orgId: string, title: string, message: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("notifications").insert({
      user_id: user.id,
      org_id: orgId,
      title,
      message,
      type: "stock_bajo",
      read: false,
    });
  } catch { /* non-critical — ignore insert errors */ }
}

export function useStockAlerts({ orgId, threshold = 5, enabled = true }: StockAlertOptions) {
  const alertedRef = useRef<Set<string>>(new Set()); // debounce: don't repeat same product

  useEffect(() => {
    if (!enabled) return;
    requestNotificationPermission();
  }, [enabled]);

  useEffect(() => {
    if (!orgId || !enabled) return;

    const channel = safeChannel("stock-alerts", orgId);

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
              const title = `⚠️ Sin stock: ${name}`;
              const msg = "Stock agotado — revisar reposición";
              toast.error(title, { duration: 8000, description: msg });
              fireNotification(title, msg);
              insertNotification(orgId, title, msg);
            } else {
              const title = `📦 Stock bajo: ${name}`;
              const msg = `Quedan ${newStock} ud${newStock !== 1 ? "s" : ""} — por debajo del umbral de ${threshold}`;
              toast.warning(`${title} — quedan ${newStock} ud${newStock !== 1 ? "s" : ""}`, {
                duration: 6000,
                description: `Por debajo del umbral de ${threshold} unidades`,
              });
              fireNotification(title, msg);
              insertNotification(orgId, title, msg);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, threshold, enabled]);
}
