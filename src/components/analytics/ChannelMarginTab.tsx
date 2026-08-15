import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { isMissingRelation } from "@/lib/publicDataSource";
import { useOrganization } from "@/hooks/useOrganization";
import {
  buildChannelMarginLines,
  summarizeChannelMargins,
  type MarginSaleFact,
  type MeliMarginFact,
  type StoreMarginFact,
} from "@/lib/channelMargins";

type Props = {
  enabled: boolean;
  from?: string;
  to?: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  pos: "Mostrador",
  tienda_online: "Tienda propia",
  mercadolibre: "MercadoLibre",
};

function amount(value: number | null) {
  return value === null ? <span className="text-muted-foreground">Pendiente</span> : formatARS(value);
}

/**
 * E4: muestra sólo términos persistidos. La falta de una liquidación, costo de
 * correo o IVA no se reemplaza por una tarifa estimada para que el comerciante
 * no tome una decisión con un "margen real" que en realidad no lo es.
 */
export default function ChannelMarginTab({ enabled, from, to }: Props) {
  const { orgId } = useOrganization();
  const [sales, setSales] = useState<MarginSaleFact[]>([]);
  const [storeFacts, setStoreFacts] = useState<StoreMarginFact[]>([]);
  const [meliFacts, setMeliFacts] = useState<MeliMarginFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeFactsUnavailable, setStoreFactsUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled || !orgId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setStoreFactsUnavailable(false);

      let salesQuery = supabase
        .from("sales")
        .select("id, product_id, product_name, source, quantity, total_ars, cost_of_goods_ars")
        .eq("org_id", orgId)
        .in("source", ["pos", "tienda_online", "mercadolibre"]);
      if (from) salesQuery = salesQuery.gte("date", `${from}T00:00:00`);
      if (to) salesQuery = salesQuery.lte("date", `${to}T23:59:59`);

      const [salesResult, storeResult, meliResult] = await Promise.all([
        salesQuery,
        supabase
          .from("store_order_margin_facts")
          .select("sale_id, payment_fee_ars, carrier_shipping_cost_ars, tax_ars")
          .eq("org_id", orgId),
        supabase
          .from("meli_order_sale_lines")
          .select("sale_id, sale_fee_ars, seller_shipping_cost_ars")
          .eq("org_id", orgId),
      ]);

      if (cancelled) return;
      if (salesResult.error) {
        console.error("Margen por canal: no se pudieron leer las ventas:", salesResult.error.message);
        setError("No se pudieron leer las ventas por canal.");
        toast.error("No se pudieron leer las ventas por canal");
        setLoading(false);
        return;
      }
      if (meliResult.error) {
        console.error("Margen por canal: no se pudieron leer los costos de MercadoLibre:", meliResult.error.message);
        setError("No se pudieron leer los costos de MercadoLibre.");
        toast.error("No se pudieron leer los costos de MercadoLibre");
        setLoading(false);
        return;
      }

      if (storeResult.error && !isMissingRelation(storeResult.error)) {
        console.error("Margen por canal: no se pudieron leer los hechos de tienda:", storeResult.error.message);
        setError("No se pudieron leer los hechos de margen de la tienda.");
        toast.error("No se pudieron leer los hechos de margen de la tienda");
        setLoading(false);
        return;
      }

      setSales((salesResult.data ?? []) as MarginSaleFact[]);
      setMeliFacts((meliResult.data ?? []) as MeliMarginFact[]);
      if (storeResult.error) {
        console.warn("Margen por canal: store_order_margin_facts todavía no existe; las ventas de tienda quedarán pendientes.");
        setStoreFacts([]);
        setStoreFactsUnavailable(true);
      } else {
        setStoreFacts((storeResult.data ?? []) as StoreMarginFact[]);
      }
      setLoading(false);
    };

    void load();
    return () => { cancelled = true; };
  }, [enabled, from, orgId, to]);

  const summaries = useMemo(
    () => summarizeChannelMargins(buildChannelMarginLines(sales, storeFacts, meliFacts)),
    [meliFacts, sales, storeFacts],
  );

  if (loading) {
    return <div className="bg-card border border-border rounded-2xl p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Leyendo hechos de margen…</div>;
  }

  if (error) {
    return <div className="bg-destructive/5 border border-destructive/30 rounded-2xl p-5 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold">Margen por canal — sólo con hechos medidos</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Para cerrar el margen de una línea hacen falta costo de mercadería, comisión de cobro, costo real de envío e IVA. “Pendiente” no significa $0: no se estima.
            </p>
          </div>
        </div>
      </div>

      {storeFactsUnavailable && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
          Esta base todavía no tiene el vínculo nuevo de órdenes de tienda; sus líneas se muestran como incompletas hasta aplicar la migración.
        </div>
      )}

      {summaries.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No hay ventas de mostrador, tienda propia o MercadoLibre en el período seleccionado.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Producto × canal</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Una fila por producto y canal; no mezcla una comisión de marketplace con una venta de mostrador.</p>
            </div>
            <span className="text-xs text-muted-foreground">{summaries.length} combinaciones</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-xs">
              <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wide text-[10px]">
                <tr>
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-3 py-3">Canal</th>
                  <th className="text-right px-3 py-3">Ingresos</th>
                  <th className="text-right px-3 py-3">Mercadería</th>
                  <th className="text-right px-3 py-3">Comisión</th>
                  <th className="text-right px-3 py-3">Envío real</th>
                  <th className="text-right px-3 py-3">IVA</th>
                  <th className="text-right px-3 py-3">Margen final</th>
                  <th className="text-left px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summaries.map(summary => {
                  const complete = summary.pending.length === 0;
                  return (
                    <tr key={`${summary.productId}-${summary.channel}`}>
                      <td className="px-4 py-3 font-medium">{summary.productName}<span className="block text-[10px] text-muted-foreground">{summary.units} u. · {summary.lines} líneas</span></td>
                      <td className="px-3 py-3">{CHANNEL_LABEL[summary.channel]}</td>
                      <td className="px-3 py-3 text-right font-mono">{formatARS(summary.revenueARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{formatARS(summary.cogsARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.paymentFeeARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.carrierShippingCostARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.taxARS)}</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold">{amount(summary.marginAfterMeasuredCostsARS)}</td>
                      <td className="px-4 py-3">
                        {complete ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Completo</span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-300">Falta {summary.pending.join(", ")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
