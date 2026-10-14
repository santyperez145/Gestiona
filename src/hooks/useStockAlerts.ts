/**
 * useStockAlerts — alertas de stock con el aviso «stock_bajo» de la base (Broadcast).
 *
 * Fires a toast + browser Notification when any product's stock
 * drops to or below the configured threshold.
 *
 * El aviso persistente de la campanita lo guarda la base (`trg_notify_low_stock`).
 * Este hook antes también insertaba uno por producto desde cada pestaña
 * abierta: duplicaba avisos y, en una importación (hasta 50 productos por
 * sentencia), llenaba la pantalla de cartelitos (medido 2026-10-14: 10.893
 * avisos «stock bajo» en 30 días). Ahora sólo muestra, y con muchos productos
 * a la vez, un solo resumen.
 *
 * Request notification permission on first use.
 */
import { useEffect, useRef } from "react";
import { topicOrg, useTopicEvent } from "@/lib/orgRealtime";
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
  const alertedRef = useRef<Set<string>>(new Set()); // debounce: don't repeat same product

  useEffect(() => {
    if (!enabled) return;
    requestNotificationPermission();
  }, [enabled]);

  // La base avisa «stock_bajo» con los productos que bajaron (antes/ahora) en
  // una sola sentencia; acá se alerta sólo al cruzar el umbral.
  useTopicEvent(enabled ? topicOrg(orgId) : null, "stock_bajo", payload => {
    if (!orgId) return;
    const productos = (payload.productos as { id: string; name: string | null; antes: number; ahora: number }[] | undefined) ?? [];
    const cruzaron = productos.filter(p => {
      const newStock = Number(p.ahora ?? 0);
      const oldStock = Number(p.antes ?? Infinity);
      const productKey = `${p.id}-${newStock}`;
      if (!(newStock <= threshold && oldStock > threshold) || alertedRef.current.has(productKey)) return false;
      alertedRef.current.add(productKey);
      // Clear after 30s so re-alerts are possible on further drops
      setTimeout(() => alertedRef.current.delete(productKey), 30_000);
      return true;
    });
    if (cruzaron.length > 3) {
      const agotados = cruzaron.filter(p => Number(p.ahora ?? 0) <= 0).length;
      toast.warning(`${cruzaron.length} productos quedaron con stock bajo`, {
        id: "stock-bajo-resumen",
        duration: 8000,
        description: agotados ? `${agotados} sin stock. Revisalos en Productos.` : "Revisalos en Productos.",
      });
      fireNotification(`${cruzaron.length} productos con stock bajo`, "Revisalos en Productos.");
      return;
    }
    for (const p of cruzaron) {
      const newStock = Number(p.ahora ?? 0);
      const name = p.name || "Producto";
      if (newStock <= 0) {
        const title = `⚠️ Sin stock: ${name}`;
        const msg = "Stock agotado — revisar reposición";
        toast.error(title, { duration: 8000, description: msg });
        fireNotification(title, msg);
      } else {
        const title = `📦 Stock bajo: ${name}`;
        const msg = `Quedan ${newStock} ud${newStock !== 1 ? "s" : ""} — por debajo del umbral de ${threshold}`;
        toast.warning(`${title} — quedan ${newStock} ud${newStock !== 1 ? "s" : ""}`, {
          duration: 6000,
          description: `Por debajo del umbral de ${threshold} unidades`,
        });
        fireNotification(title, msg);
      }
    }
  });
}
