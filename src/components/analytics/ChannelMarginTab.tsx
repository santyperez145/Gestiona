import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import DataPagination from "@/components/shared/DataPagination";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { useOrganization } from "@/hooks/useOrganization";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { useProfitPeriod } from "@/hooks/useProfitPeriod";
import { useModulePerms } from "@/lib/permissionsContext";
import { formatARS } from "@/lib/supabaseStore";
import { profitPendingLabels, type ProfitProduct } from "@/lib/profitPeriod";
import MarginOperationsTable from "@/components/analytics/MarginOperationsTable";

type Props = { enabled: boolean; from?: string; to?: string };
const CHANNEL_LABEL: Record<string, string> = {
  pos: "Mostrador", tienda_online: "Tienda propia", mercadolibre: "Mercado Libre", sin_atribuir: "Sin atribuir",
};
function amount(value: number | null | undefined) {
  return value == null ? <span className="text-muted-foreground">Pendiente</span> : formatARS(value);
}

export default function ChannelMarginTab({ enabled, from, to }: Props) {
  const { orgId } = useOrganization();
  const permission = useModulePerms("analytics");
  const [storedMode, setMode] = usePersistedState(orgViewKey("profit.mode.v1", orgId), "products");
  const mode = storedMode === "operations" ? "operations" : "products";
  const panelId = useId();
  const scope = JSON.stringify([orgId, from, to]);
  const [pages, setPages] = useState({ scope, products: 1, operations: 1 });
  const currentPages = pages.scope === scope ? pages : { scope, products: 1, operations: 1 };
  const { data, loading, error, retry, updatedAt } = useProfitPeriod({
    orgId, enabled: enabled && permission.canView && !permission.loading,
    from, to, productPage: currentPages.products, operationPage: currentPages.operations,
  });
  if (!enabled) return null;
  if (permission.loading) return <WorkspaceState kind="initial-loading" title="Comprobando acceso a rentabilidad" />;
  if (!permission.canView || !orgId) return <WorkspaceState kind="permission" title="Rentabilidad sin acceso" description="Necesitás permiso de Analytics en esta organización." />;
  if (!data) return <WorkspaceState kind={error ? "error-recoverable" : "initial-loading"}
    title={error ? "No pudimos cargar rentabilidad" : "Leyendo rentabilidad del período"}
    description={error || undefined} actionLabel={error ? "Volver a intentar" : undefined} onAction={error ? retry : undefined} />;

  const { coverage } = data;
  const count = mode === "products" ? data.productCount : data.operationCount;
  const page = mode === "products" ? data.productPage : data.operationPage;
  return (
    <section aria-label="Rentabilidad por producto y canal" className="min-w-0 space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Rentabilidad del período</h3>
          <p className="mt-1 text-xs text-muted-foreground">ARS · Fecha de la operación en Buenos Aires · Antes de publicidad y gastos operativos</p>
        </div>
        <Button variant="outline" size="sm" onClick={retry} disabled={loading} aria-label="Actualizar rentabilidad">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {error && <WorkspaceState kind="stale" layout="banner" title="Datos de la última lectura" description={error} actionLabel="Volver a intentar" onAction={retry} />}
      {loading && <p role="status" className="text-xs text-muted-foreground">Actualizando rentabilidad…</p>}
      {coverage.lines === 0 ? <WorkspaceState kind="empty-filtered" title="Sin operaciones en este período" description="No hay ventas asentadas para las fechas seleccionadas." /> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Ingresos del período" value={formatARS(coverage.revenueARS)} detail={`${data.operationCount} operaciones · ${coverage.lines} líneas`} />
          <Metric label="Contribución del período" value={amount(coverage.contributionMarginARS)} detail={coverage.contributionMarginARS == null ? "Faltan fuentes o hay devoluciones sin netear" : "Cuatro fuentes medidas por línea"} />
          <Metric label="Contribución medida" value={amount(coverage.measuredContributionARS)} detail={`${coverage.explainableLines} de ${coverage.lines} líneas explicables; no es el resultado total`} />
          <Metric label="Ingresos explicables" value={coverage.explainableRevenuePct == null ? "No disponible" : `${coverage.explainableRevenuePct}%`} detail={`${formatARS(coverage.explainableRevenueARS)} de ${formatARS(coverage.revenueARS)}`} />
        </div>
        {coverage.explainableLines < coverage.lines && <WorkspaceState kind="partial" layout="banner" title="Rentabilidad parcial" description="Pendiente no significa cero. El total se publica cuando todas las líneas tienen costos medidos y las devoluciones están reconciliadas." />}
        <div className="grid gap-3 border-y border-border py-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Mercadería", known: coverage.cogsKnownLines }, { label: "Comisión de cobro", known: coverage.paymentFeeKnownLines },
            { label: "Envío real", known: coverage.shippingKnownLines }, { label: "IVA", known: coverage.taxKnownLines },
          ].map(item => <div key={item.label} className="min-w-0">
            <div className="flex justify-between gap-2 text-xs"><span>{item.label}</span><span className="text-muted-foreground">{item.known}/{coverage.lines}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted" aria-hidden="true"><div className="h-full bg-primary" style={{ width: `${item.known * 100 / coverage.lines}%` }} /></div>
          </div>)}
        </div>
        <div role="tablist" aria-label="Vista de rentabilidad" className="flex flex-wrap gap-1">
          {(["products", "operations"] as const).map(value => <button key={value} type="button" role="tab"
            aria-selected={mode === value} aria-controls={panelId} tabIndex={mode === value ? 0 : -1}
            className={`min-h-11 rounded-md border px-3 text-sm font-medium ${mode === value ? "border-primary/40 bg-card text-primary" : "border-border text-muted-foreground"}`}
            onClick={() => setMode(value)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "products" : event.key === "End" ? "operations" : mode === "products" ? "operations" : "products";
              setMode(next);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              buttons?.[next === "products" ? 0 : 1]?.focus();
            }}>{value === "products" ? "Producto y canal" : "Operaciones"}</button>)}
        </div>
        <div id={panelId} role="tabpanel" aria-label={mode === "products" ? "Producto y canal" : "Operaciones"} tabIndex={0}>
          {mode === "operations" ? <MarginOperationsTable operations={data.operations} totalCount={data.operationCount} /> : <ProductMargins products={data.products} />}
        </div>
        <DataPagination page={page - 1} totalPages={Math.ceil(count / data.pageSize)} totalItems={count} pageSize={data.pageSize}
          disabled={loading} itemLabel={mode === "products" ? "combinaciones" : "operaciones"}
          onPageChange={next => setPages({ ...currentPages, [mode]: next + 1 })} />
      </>}
      <p className="text-xs text-muted-foreground">Fuente: hechos canónicos de venta · Población completa del período{updatedAt ? ` · Última lectura ${new Date(updatedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold">{value}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
  </div>;
}

function ProductMargins({ products }: { products: ProfitProduct[] }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-card">
    <table className="w-full table-fixed text-xs" aria-label="Margen por producto y canal">
      <thead className="border-b border-border text-muted-foreground"><tr>
        <th className="w-[45%] px-3 py-3 text-left sm:w-auto">Producto y canal</th>
        <th className="px-3 py-3 text-right">Ingresos</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">Mercadería</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">Comisión</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">Envío real</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">IVA</th>
        <th className="px-3 py-3 text-right">Contribución</th>
      </tr></thead>
      <tbody className="divide-y divide-border">{products.map(product => <tr key={`${product.productId}:${product.channel}`}>
        <td className="break-words px-3 py-3 align-top [overflow-wrap:anywhere]">
          <span className="font-medium">{product.productName}</span>
          <span className="mt-1 block text-muted-foreground">{CHANNEL_LABEL[product.channel] || "Otro canal"} · {product.units} u.</span>
          <span className={`mt-2 inline-flex items-start gap-1 ${product.contributionMarginARS != null && product.pendingCodes.length === 0 ? "text-emerald-700" : "text-amber-800"}`}>
            {product.contributionMarginARS != null && product.pendingCodes.length === 0 ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Completo</> : <><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {profitPendingLabels(product).join(", ") || "Fuentes pendientes"}</>}
          </span>
        </td>
        <td className="break-words px-3 py-3 text-right align-top font-mono [overflow-wrap:anywhere]">{amount(product.revenueARS)}</td>
        {[product.cogsARS, product.paymentFeeARS, product.shippingCostARS, product.taxARS].map((value, index) => <td key={index} className="hidden break-words px-3 py-3 text-right align-top font-mono lg:table-cell">{amount(value)}</td>)}
        <td className="break-words px-3 py-3 text-right align-top font-mono font-semibold [overflow-wrap:anywhere]">{amount(product.contributionMarginARS)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
