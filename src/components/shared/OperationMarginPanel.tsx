/**
 * Margen canónico de UNA operación (orden o ticket).
 *
 * Lee sólo `sale_margin_operations` — la misma autoridad que Analytics.
 * NULL ≠ $0; sin fila = aún no hay hechos (pedido sin venta asentada).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isMissingRelation } from "@/lib/publicDataSource";
import { labelMissingMarginComponent } from "@/lib/channelMargins";
import { formatARS } from "@/lib/supabaseStore";

export type OperationMarginRow = Database["public"]["Views"]["sale_margin_operations"]["Row"];

const SOURCE_LABEL: Record<string, string> = {
  sale_snapshot: "Snapshot de venta",
  ledger_operation_allocation: "Asiento de la operación",
  store_settlement: "Liquidación de tienda",
  meli_settlement: "Liquidación de MercadoLibre",
  payment_transaction_line: "Cobro por línea",
  payment_transaction_allocation: "Cobro de la operación",
  cash_not_applicable: "Efectivo · sin comisión",
  carrier_settlement: "Liquidación del transportista",
  pos_not_applicable: "Mostrador · sin despacho",
  store_order_snapshot: "Snapshot de la orden",
  invoice_snapshot: "Factura",
};

const SELECT_COLS =
  "operation_id,operation_type,channel,revenue_ars,cogs_ars,payment_fee_ars,shipping_cost_ars,tax_ars,contribution_margin_ars,coverage_pct,is_explainable,missing_components,margin_blockers,cogs_sources,payment_fee_sources,shipping_sources,tax_sources";

function amount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">Pendiente</span>;
  }
  return formatARS(value);
}

function Fact({
  label,
  value,
  sources,
}: {
  label: string;
  value: number | null;
  sources: string[] | null;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{amount(value)}</p>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        {(sources ?? []).length > 0
          ? sources!.map((s) => SOURCE_LABEL[s] || s).join(" + ")
          : "Sin fuente persistida"}
      </p>
    </div>
  );
}

interface Props {
  orgId: string | undefined;
  /** `ecommerce_orders.id` o `sale_transaction_id` / `sales.id`. */
  operationId: string | null | undefined;
}

export default function OperationMarginPanel({ orgId, operationId }: Props) {
  const [row, setRow] = useState<OperationMarginRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !operationId) {
      setRow(null);
      setLoading(false);
      setError(null);
      setUnavailable(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setError(null);
    setUnavailable(false);
    supabase
      .from("sale_margin_operations")
      .select(SELECT_COLS)
      .eq("org_id", orgId)
      .eq("operation_id", operationId)
      .limit(1)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelado) return;
        if (err) {
          console.error("OperationMarginPanel:", err);
          if (isMissingRelation(err)) {
            setUnavailable(true);
            setRow(null);
          } else {
            setError("No se pudo leer el margen canónico de esta operación.");
            setRow(null);
          }
          setLoading(false);
          return;
        }
        setRow((data as OperationMarginRow | null) ?? null);
        setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [orgId, operationId]);

  if (!operationId) return null;

  return (
    <section aria-labelledby="operacion-margen" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="operacion-margen" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Margen de esta operación
        </h3>
        <Link
          to="/analytics?vista=resumen"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Ver por canal
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Leyendo hechos de margen…</p>
      ) : unavailable ? (
        <p className="text-xs text-muted-foreground">
          La base todavía no expone el margen canónico. No se inventa un número acá.
        </p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !row ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Todavía no hay hechos de margen para esta operación. Aparecen cuando la venta queda
          asentada con costo, comisión, envío real e IVA — no se estiman desde el catálogo actual.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ingresos</p>
              <p className="mt-1 font-mono text-sm font-semibold">{formatARS(Number(row.revenue_ars) || 0)}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Margen final</p>
              <p className="mt-1 font-mono text-sm font-semibold">{amount(row.contribution_margin_ars)}</p>
            </div>
            <div className="col-span-2 rounded-lg border border-border/60 bg-card p-3 sm:col-span-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Calidad</p>
              <p className="mt-1 flex items-center gap-1 text-xs font-medium">
                {row.is_explainable ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> 100% explicable
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> {row.coverage_pct ?? 0}% cubierto
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Fact label="Mercadería" value={row.cogs_ars} sources={row.cogs_sources} />
            <Fact label="Comisión" value={row.payment_fee_ars} sources={row.payment_fee_sources} />
            <Fact label="Envío real" value={row.shipping_cost_ars} sources={row.shipping_sources} />
            <Fact label="IVA" value={row.tax_ars} sources={row.tax_sources} />
          </div>

          {((row.missing_components?.length ?? 0) > 0 || (row.margin_blockers?.length ?? 0) > 0) && (
            <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              Falta{" "}
              {[...(row.missing_components ?? []), ...(row.margin_blockers ?? [])]
                .map(labelMissingMarginComponent)
                .join(", ")}
              . El margen final queda Pendiente hasta completar la evidencia — no se completa a ojo.
            </p>
          )}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Cuatro datos a la vez: costo histórico, comisión del cobro, costo real de envío e IVA.
            El envío cobrado al cliente no es el costo del correo.
          </p>
        </div>
      )}
    </section>
  );
}
