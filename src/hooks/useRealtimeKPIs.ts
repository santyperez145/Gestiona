/**
 * useRealtimeKPIs — KPIs en vivo con los avisos de la base (Broadcast).
 *
 * Escucha venta · stock · deuda en el topic privado de la organización. Una
 * venta de varios renglones llega como un solo aviso.
 */
import { useState } from "react";
import { toast } from "sonner";
import { topicOrg, useTopicEvent, type VentaAviso } from "@/lib/orgRealtime";

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
  const topic = topicOrg(orgId);

  useTopicEvent(topic, "venta", payload => {
    const ventas = (payload.ventas as VentaAviso[] | undefined) ?? [];
    const total = Number(payload.total ?? 0);
    const primera = ventas[0];
    const product = primera?.product_name || "Venta";
    const customer = primera?.customer_name || "Cliente";
    setLastSale({ amount: total, product, customer });
    setSaleEventCount(n => n + 1);
    toast.success(`💰 Nueva venta: $${Math.round(total).toLocaleString("es-AR")}`, {
      description: ventas.length > 1 ? `${ventas.length} productos · ${customer}` : `${product} · ${customer}`,
      duration: 4000,
    });
  });
  useTopicEvent(topic, "stock", () => setStockEventCount(n => n + 1));
  useTopicEvent(topic, "deuda", () => setDebtEventCount(n => n + 1));

  return { lastSale, saleEventCount, stockEventCount, debtEventCount };
}
