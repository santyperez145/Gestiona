import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { isMissingRelation } from "@/lib/publicDataSource";
import { useOrganization } from "@/hooks/useOrganization";
import {
  summarizeChannelMargins,
  summarizeMarginCoverage,
  type CanonicalMarginFact,
} from "@/lib/channelMargins";
import MarginOperationsTable, { type MarginOperation } from "@/components/analytics/MarginOperationsTable";

type Props = {
  enabled: boolean;
  from?: string;
  to?: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  pos: "Mostrador",
  tienda_online: "Tienda propia",
  mercadolibre: "MercadoLibre",
  sin_atribuir: "Histórica · sin atribuir",
};

function amount(value: number | null) {
  return value === null ? <span className="text-muted-foreground">Pendiente</span> : formatARS(value);
}

function ratio(known: number, total: number) {
  return total > 0 ? Math.round(known * 100 / total) : 0;
}

/**
 * F2: el navegador presenta la autoridad SQL. No cruza ventas, liquidaciones
 * ni costos por su cuenta y nunca convierte un dato ausente en cero.
 */
export default function ChannelMarginTab({ enabled, from, to }: Props) {
  const { orgId } = useOrganization();
  const [facts, setFacts] = useState<CanonicalMarginFact[]>([]);
  const [operations, setOperations] = useState<MarginOperation[]>([]);
  const [viewMode, setViewMode] = useState<"products" | "operations">("products");
  const [operationsUnavailable, setOperationsUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !orgId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setOperationsUnavailable(false);

      let query = supabase
        .from("sale_margin_facts")
        .select("sale_id,product_id,product_name,channel,quantity,revenue_ars,cogs_ars,payment_fee_ars,shipping_cost_ars,tax_ars,contribution_margin_ars,coverage_pct,is_explainable,missing_components,margin_blockers")
        .eq("org_id", orgId)
        .order("sold_at", { ascending: false });
      if (from) query = query.gte("sold_at", `${from}T00:00:00`);
      if (to) query = query.lte("sold_at", `${to}T23:59:59`);

      let operationsQuery = supabase
        .from("sale_margin_operations")
        .select("*")
        .eq("org_id", orgId)
        .order("sold_at", { ascending: false });
      if (from) operationsQuery = operationsQuery.gte("sold_at", `${from}T00:00:00`);
      if (to) operationsQuery = operationsQuery.lte("sold_at", `${to}T23:59:59`);

      const [result, operationsResult] = await Promise.all([query, operationsQuery]);
      if (cancelled) return;
      if (result.error) {
        const message = isMissingRelation(result.error)
          ? "La base todavía no tiene los hechos canónicos de margen."
          : "No se pudieron leer los hechos canónicos de margen.";
        console.error("Margen canónico:", result.error.message);
        setError(message);
        toast.error(message);
        setLoading(false);
        return;
      }

      if (operationsResult.error && !isMissingRelation(operationsResult.error)) {
        const message = "No se pudo leer la explicación por operación.";
        console.error("Margen por operación:", operationsResult.error.message);
        setError(message);
        toast.error(message);
        setLoading(false);
        return;
      }

      setFacts((result.data ?? []) as CanonicalMarginFact[]);
      if (operationsResult.error) {
        setOperations([]);
        setOperationsUnavailable(true);
      } else {
        setOperations((operationsResult.data ?? []) as MarginOperation[]);
      }
      setLoading(false);
    };

    void load();
    return () => { cancelled = true; };
  }, [enabled, from, orgId, to]);

  const summaries = useMemo(() => summarizeChannelMargins(facts), [facts]);
  const coverage = useMemo(() => summarizeMarginCoverage(facts), [facts]);
  const componentCoverage = useMemo(() => [
    { label: "Costo de mercadería", known: coverage.cogsKnownLines },
    { label: "Comisión de cobro", known: coverage.paymentFeeKnownLines },
    { label: "Costo real de envío", known: coverage.shippingKnownLines },
    { label: "IVA", known: coverage.taxKnownLines },
  ], [coverage]);

  if (loading) {
    return <div className="bg-card border border-border rounded-2xl p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Leyendo hechos canónicos…</div>;
  }

  if (error) {
    return <div className="bg-destructive/5 border border-destructive/30 rounded-2xl p-5 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold">Margen por canal — sólo con hechos medidos</h3>
            <p className="text-xs text-muted-foreground mt-1">
              El margen final aparece únicamente cuando costo de mercadería, comisión de cobro, costo real de envío e IVA tienen una fuente persistida. “Pendiente” nunca significa $0.
            </p>
          </div>
        </div>
      </div>

      {facts.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CoverageCard label="Ingresos explicables" value={`${coverage.explainableRevenuePct}%`} detail={`${formatARS(coverage.explainableRevenueARS)} de ${formatARS(coverage.revenueARS)}`} />
            <CoverageCard label="Cobertura promedio" value={`${coverage.averageCoveragePct}%`} detail="4 fuentes por línea" />
            <CoverageCard label="Líneas completas" value={`${coverage.explainableLines}/${coverage.lines}`} detail="margen final auditable" />
            <CoverageCard label="Fuente canónica" value="SQL" detail="sin cruces en el navegador" icon={Database} />
          </div>

          <section className="bg-card border border-border rounded-2xl p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {componentCoverage.map(component => {
                const value = ratio(component.known, coverage.lines);
                return (
                  <div key={component.label} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium">{component.label}</span>
                      <span className="text-muted-foreground">{component.known}/{coverage.lines}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${value}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-lg border px-3 py-2 text-xs transition-colors ${viewMode === "products" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          onClick={() => setViewMode("products")}
        >
          Producto × canal
        </button>
        <button
          type="button"
          className={`rounded-lg border px-3 py-2 text-xs transition-colors ${viewMode === "operations" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          onClick={() => setViewMode("operations")}
          disabled={operationsUnavailable}
        >
          Explicar operaciones
        </button>
        {operationsUnavailable && <span className="text-[10px] text-amber-700 dark:text-amber-300">La vista por operación todavía no está disponible en esta base.</span>}
      </div>

      {viewMode === "operations" ? (
        <MarginOperationsTable operations={operations} />
      ) : summaries.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No hay ventas en el período seleccionado.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Producto × canal</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Incluye el historial sin canal confiable; no lo presenta como POS ni lo descarta.</p>
            </div>
            <span className="text-xs text-muted-foreground">{summaries.length} combinaciones</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs">
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
                      <td className="px-3 py-3">{CHANNEL_LABEL[summary.channel] || summary.channel}</td>
                      <td className="px-3 py-3 text-right font-mono">{formatARS(summary.revenueARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.cogsARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.paymentFeeARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.shippingCostARS)}</td>
                      <td className="px-3 py-3 text-right font-mono">{amount(summary.taxARS)}</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold">{amount(summary.contributionMarginARS)}</td>
                      <td className="px-4 py-3 max-w-[260px]">
                        {complete ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Completo</span>
                        ) : (
                          <span className="inline-flex items-start gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {summary.coveragePct}% · falta {summary.pending.join(", ")}</span>
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

function CoverageCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: typeof Database;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>
      <p className="text-xl font-semibold mt-1">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{detail}</p>
    </div>
  );
}
