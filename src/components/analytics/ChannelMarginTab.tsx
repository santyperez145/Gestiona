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
import { PROFIT_CHANNELS, profitPendingLabels, type ProfitProduct, type ProfitMode } from "@/lib/profitPeriod";
import MarginOperationsTable from "@/components/analytics/MarginOperationsTable";
import ProfitControls from "@/components/analytics/ProfitControls";

type Props = { enabled: boolean; from?: string; to?: string; storeId?: string; channel?: string; mode?: ProfitMode;
  onModeChange?: (mode: ProfitMode) => void; onFilterChange?: (filter: "store" | "channel" | "all", value: string) => void };
function amount(value: number | null | undefined) {
  return value == null ? <span className="text-muted-foreground">Pendiente</span> : formatARS(value);
}

export default function ChannelMarginTab({ enabled, from, to, storeId, channel, mode: requestedMode, onModeChange, onFilterChange }: Props) {
  const { orgId } = useOrganization();
  const permission = useModulePerms("analytics");
  const [storedMode, persistMode] = usePersistedState(orgViewKey("profit.mode.v1", orgId), "products");
  const mode = requestedMode || (storedMode === "operations" || storedMode === "sku" ? storedMode : "products");
  const setMode = (value: ProfitMode) => { persistMode(value); onModeChange?.(value); };
  const groupBy = mode === "sku" ? "sku" : "product";
  const panelId = useId();
  const scope = JSON.stringify([orgId, from, to, storeId, channel, groupBy]);
  const [pages, setPages] = useState({ scope, products: 1, operations: 1 });
  const currentPages = pages.scope === scope ? pages : { scope, products: 1, operations: 1 };
  const { data, stores, loading, error, retry, updatedAt } = useProfitPeriod({
    orgId, enabled: enabled && permission.canView && !permission.loading,
    from, to, productPage: currentPages.products, operationPage: currentPages.operations,
    storeId, channel, groupBy,
  });
  if (!enabled) return null;
  if (permission.loading) return <WorkspaceState kind="initial-loading" title="Comprobando acceso a rentabilidad" />;
  if (!permission.canView || !orgId) return <WorkspaceState kind="permission" title="Rentabilidad sin acceso" description="Necesitás permiso de Analytics en esta organización." />;
  const coverage = data?.coverage;
  const count = mode === "operations" ? data?.operationCount : data?.productCount;
  const page = mode === "operations" ? data?.operationPage : data?.productPage;
  return (
    <section aria-label="Rentabilidad por producto y canal" className="min-w-0 space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Rentabilidad del período</h3>
          <p className="mt-1 text-xs text-muted-foreground">ARS · Fecha de la operación en Buenos Aires · Antes de publicidad y gastos operativos</p>
        </div>
        <Button variant="outline" size="sm" onClick={retry} disabled={loading} aria-label="Actualizar rentabilidad" title="Actualizar rentabilidad">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <ProfitControls mode={mode} panelId={panelId} stores={stores} storeId={storeId} channel={channel}
        onModeChange={setMode} onFilterChange={onFilterChange} />
      <div id={panelId} role="tabpanel" aria-label={mode === "operations" ? "Operaciones" : mode === "sku" ? "SKU y canal" : "Producto y canal"} tabIndex={0}>
      {!data ? <WorkspaceState kind={error ? "error-recoverable" : "initial-loading"}
        title={error ? "No pudimos cargar rentabilidad" : "Leyendo rentabilidad del período"}
        description={error || undefined} actionLabel={error ? "Volver a intentar" : undefined} onAction={error ? retry : undefined} /> : <div className="space-y-4">
      {error && <WorkspaceState kind="stale" layout="banner" title="Datos de la última lectura" description={error} actionLabel="Volver a intentar" onAction={retry} />}
      {loading && <p role="status" className="text-xs text-muted-foreground">Actualizando rentabilidad…</p>}
      {coverage.lines === 0 ? <WorkspaceState kind="empty-filtered" title="Sin operaciones en este período" description="No hay ventas asentadas para las fechas, tienda y canal seleccionados."
        actionLabel={onFilterChange && (storeId || channel) ? "Limpiar filtros" : undefined} onAction={() => onFilterChange?.("all", "")} /> : <>
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
        {mode === "operations" ? <MarginOperationsTable operations={data.operations} totalCount={data.operationCount} /> : <ProductMargins products={data.products} sku={mode === "sku"} />}
        <DataPagination page={page - 1} totalPages={Math.ceil(count / data.pageSize)} totalItems={count} pageSize={data.pageSize}
          disabled={loading} itemLabel={mode === "operations" ? "operaciones" : "combinaciones"}
          onPageChange={next => setPages({ ...currentPages, [mode === "operations" ? "operations" : "products"]: next + 1 })} />
      </>}
      <p className="text-xs text-muted-foreground">Fuente: hechos canónicos de venta · Población completa del período{updatedAt ? ` · Última lectura ${new Date(updatedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
      </div>}
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold">{value}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
  </div>;
}

function ProductMargins({ products, sku }: { products: ProfitProduct[]; sku: boolean }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-card">
    {sku && <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">SKU y nombre de variante del catálogo actual · Costos históricos de la venta</p>}
    <table className="w-full table-fixed text-xs" aria-label={sku ? "Margen por SKU y canal" : "Margen por producto y canal"}>
      <thead className="border-b border-border text-muted-foreground"><tr>
        <th className="w-[45%] px-3 py-3 text-left sm:w-auto">{sku ? "SKU y canal" : "Producto y canal"}</th>
        <th className="px-3 py-3 text-right">Ingresos</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">Mercadería</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">Comisión</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">Envío real</th>
        <th className="hidden px-3 py-3 text-right lg:table-cell">IVA</th>
        <th className="px-3 py-3 text-right">Contribución</th>
      </tr></thead>
      <tbody className="divide-y divide-border">{products.map(product => <tr key={`${product.productId}:${product.variantId || "base"}:${product.channel}`}>
        <td className="break-words px-3 py-3 align-top [overflow-wrap:anywhere]">
          <span className="line-clamp-2 font-medium" title={product.productName}>{product.productName}</span>
          {sku && <span className="mt-1 line-clamp-2 text-muted-foreground" title={`${product.variantName || "Sin variante identificada"} · ${product.sku || "Sin SKU registrado"}`}>
            {product.variantName || "Sin variante identificada"} · {product.sku || "Sin SKU registrado"}</span>}
          <span className="mt-1 block text-muted-foreground">{PROFIT_CHANNELS[product.channel] || "Otro canal"} · {product.units} u.</span>
          <span className={`mt-2 inline-flex items-start gap-1 ${product.contributionMarginARS != null && product.pendingCodes.length === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>
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
