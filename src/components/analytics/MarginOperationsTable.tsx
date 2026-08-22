import { Fragment, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { formatARS } from "@/lib/supabaseStore";

export type MarginOperation = Database["public"]["Views"]["sale_margin_operations"]["Row"];

const CHANNEL_LABEL: Record<string, string> = {
  pos: "Mostrador",
  tienda_online: "Tienda propia",
  mercadolibre: "MercadoLibre",
  sin_atribuir: "Histórica · sin atribuir",
};

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

const EVIDENCE_LABEL: Record<string, string> = {
  importe_descuento_cupon: "importe histórico del cupón",
  precio_referencia_historico: "precio de referencia histórico",
};

type PaymentLeg = { method: string; amount_ars: number };

function paymentLegs(value: MarginOperation["payment_mix"]): PaymentLeg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const method = "method" in item ? String(item.method || "sin_informar") : "sin_informar";
    const amount = "amount_ars" in item ? Number(item.amount_ars || 0) : 0;
    return [{ method, amount_ars: amount }];
  });
}

function dateLabel(value: string | null) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Sin fecha"
    : parsed.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function amount(value: number | null) {
  return value === null ? <span className="text-muted-foreground">Pendiente</span> : formatARS(value);
}

export default function MarginOperationsTable({ operations }: { operations: MarginOperation[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (operations.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
        No hay operaciones en el período seleccionado.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Operaciones explicables</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Un ticket conserva sus líneas, mix de cobro, promoción y fuentes sin duplicar importes.</p>
        </div>
        <span className="text-xs text-muted-foreground">{operations.length} operaciones</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-xs">
          <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wide text-[10px]">
            <tr>
              <th className="text-left px-4 py-3">Operación</th>
              <th className="text-left px-3 py-3">Canal</th>
              <th className="text-left px-3 py-3">Cobro</th>
              <th className="text-left px-3 py-3">Promoción</th>
              <th className="text-right px-3 py-3">Ingresos</th>
              <th className="text-right px-3 py-3">Margen final</th>
              <th className="text-left px-3 py-3">Calidad</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {operations.map(operation => {
              const key = operation.operation_key || operation.operation_id || "unknown";
              const isExpanded = expanded === key;
              const mix = paymentLegs(operation.payment_mix);
              const blockers = operation.margin_blockers ?? [];
              return (
                <Fragment key={key}>
                  <tr>
                    <td className="px-4 py-3">
                      <span className="font-medium">#{operation.operation_reference || "Sin referencia"}</span>
                      <span className="block text-[10px] text-muted-foreground">{dateLabel(operation.sold_at)} · {operation.line_count || 0} líneas · {operation.units || 0} u.</span>
                    </td>
                    <td className="px-3 py-3">{CHANNEL_LABEL[operation.channel || ""] || operation.channel || "Sin atribuir"}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(operation.payment_methods ?? []).map(method => <span key={method} className="rounded bg-muted px-1.5 py-0.5">{method}</span>)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {operation.promotion_evidence_status === "not_applicable" ? (
                        <span className="text-muted-foreground">Sin promoción</span>
                      ) : operation.promotion_evidence_status === "measured" ? (
                        <span className="text-emerald-600 dark:text-emerald-400">{formatARS(operation.measured_discount_ars || 0)} medidos</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">Evidencia parcial</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{formatARS(operation.revenue_ars || 0)}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold">{amount(operation.contribution_margin_ars)}</td>
                    <td className="px-3 py-3">
                      {operation.is_explainable ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> 100% explicable</span>
                      ) : blockers.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"><RotateCcw className="w-3.5 h-3.5" /> Devolución pendiente</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> {operation.coverage_pct || 0}% cubierto</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setExpanded(isExpanded ? null : key)}
                        aria-label={isExpanded ? "Ocultar explicación" : "Explicar operación"}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/10">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-3 lg:grid-cols-4">
                          <Fact label="Mercadería" value={operation.cogs_ars} sources={operation.cogs_sources} />
                          <Fact label="Comisión" value={operation.payment_fee_ars} sources={operation.payment_fee_sources} />
                          <Fact label="Envío real" value={operation.shipping_cost_ars} sources={operation.shipping_sources} />
                          <Fact label="IVA" value={operation.tax_ars} sources={operation.tax_sources} />
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <div className="rounded-xl border border-border/60 bg-card p-3">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Mix de cobro persistido</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {mix.map(leg => <span key={leg.method} className="rounded-md border border-border px-2 py-1">{leg.method}: {formatARS(leg.amount_ars)}</span>)}
                              {mix.length === 0 && <span className="text-muted-foreground">Sin desglose</span>}
                            </div>
                            {Math.abs(Number(operation.payment_mix_difference_ars || 0)) > 0.01 && (
                              <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">Diferencia contra ingresos: {formatARS(operation.payment_mix_difference_ars || 0)}</p>
                            )}
                          </div>
                          <div className="rounded-xl border border-border/60 bg-card p-3">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Evidencia de promoción</p>
                            <p className="mt-2">Descuento medido: <span className="font-mono">{formatARS(operation.measured_discount_ars || 0)}</span></p>
                            {(operation.coupon_codes ?? []).length > 0 && <p className="mt-1 text-muted-foreground">Cupones: {(operation.coupon_codes ?? []).join(", ")}</p>}
                            {(operation.promotion_missing_evidence ?? []).length > 0 && (
                              <p className="mt-1 text-amber-700 dark:text-amber-300">Falta {operation.promotion_missing_evidence?.map(item => EVIDENCE_LABEL[item] || item).join(", ")}</p>
                            )}
                            {blockers.length > 0 && <p className="mt-1 text-red-600 dark:text-red-400">El margen queda bloqueado hasta reconciliar la devolución.</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fact({ label, value, sources }: { label: string; value: number | null; sources: string[] | null }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold">{amount(value)}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {(sources ?? []).length > 0 ? sources?.map(source => SOURCE_LABEL[source] || source).join(" + ") : "Sin fuente persistida"}
      </p>
    </div>
  );
}
