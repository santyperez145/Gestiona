/**
 * useRealtimeKPIs — KPIs en vivo con los avisos de la base (Broadcast).
 *
 * Escucha venta · stock · deuda en el topic privado de la organización. Una
 * venta de varios renglones llega como un solo aviso.
 *
 * 2026-11-04 (#29): la venta que el comerciante acaba de cobrar en esta
 * pestaña no dispara el aviso «Nueva venta» (ya tiene el recibo en pantalla);
 * los contadores se actualizan siempre. `opts.toast: false` deja que una
 * pantalla escuche sin avisar, para que haya un solo emisor del aviso.
 */
import { useState } from "react";
import { toast } from "sonner";
import { topicOrg, useTopicEvent, type VentaAviso } from "@/lib/orgRealtime";
import { avisoDeNuevaVenta } from "@/lib/posCobroUnico";

interface LiveKPIs {
  lastSale: { amount: number; product: string; customer: string } | null;
  saleEventCount: number; // increments on each new sale — use as dep in useEffect
  stockEventCount: number; // increments on stock changes
  debtEventCount: number;
}

export function useRealtimeKPIs(orgId: string | undefined, opts: { toast?: boolean } = {}): LiveKPIs {
  const [lastSale, setLastSale] = useState<LiveKPIs["lastSale"]>(null);
  const [saleEventCount, setSaleEventCount] = useState(0);
  const [stockEventCount, setStockEventCount] = useState(0);
  const [debtEventCount, setDebtEventCount] = useState(0);
  const topic = topicOrg(orgId);
  const conAviso = opts.toast !== false;

  useTopicEvent(topic, "venta", payload => {
    const ventas = (payload.ventas as VentaAviso[] | undefined) ?? [];
    const total = Number(payload.total ?? 0);
    const primera = ventas[0];
    const product = primera?.product_name || "Venta";
    const customer = primera?.customer_name || "Cliente";
    setLastSale({ amount: total, product, customer });
    setSaleEventCount(n => n + 1);
    if (!conAviso) return;
    const aviso = avisoDeNuevaVenta(ventas, total);
    if (aviso) toast.success(aviso.titulo, { description: aviso.descripcion, duration: 4000 });
  });
  useTopicEvent(topic, "stock", () => setStockEventCount(n => n + 1));
  useTopicEvent(topic, "deuda", () => setDebtEventCount(n => n + 1));

  return { lastSale, saleEventCount, stockEventCount, debtEventCount };
}
