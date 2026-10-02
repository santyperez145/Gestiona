import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, History, Layers, Package, RefreshCw, Save, ShieldCheck, TrendingDown, Wallet } from "lucide-react";
import { useOrg } from "@/lib/orgContext";
import { useModulePerms } from "@/lib/permissionsContext";
import { useInventoryCapital } from "@/hooks/useInventoryCapital";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CAPITAL_REASONS, inventoryCapitalCsv, type CapitalItem } from "@/lib/inventoryCapital";
import { formatARS } from "@/lib/supabaseStore";
import PageHeader from "@/components/shared/PageHeader";
import WorkspaceState from "@/components/shared/WorkspaceState";
import DataPagination from "@/components/shared/DataPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Root as Tabs, Content as TabsContent, List as TabsList, Trigger as TabsTrigger } from "@radix-ui/react-tabs";

const money = (value: number | null) => value === null ? "Pendiente" : formatARS(value);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "Sin evidencia";
const title = (row: Pick<CapitalItem, "product_name" | "variant_name" | "sku">) => <div className="min-w-0"><p className="line-clamp-2 break-words font-medium">{row.product_name}</p>
  <p className="line-clamp-2 break-words text-xs text-muted-foreground">{[row.variant_name, row.sku].filter(Boolean).join(" · ") || "Sin SKU"}</p></div>;
const cell = "px-3 py-3 text-right tabular-nums break-words";
const header = "px-3 py-3 text-right font-medium";
const TableFrame = ({ children }: { children: ReactNode }) => <div tabIndex={0} className="max-w-full overflow-x-auto rounded-lg border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary">{children}</div>;

export default function InventoryValuationPage() {
  usePageTitle("Capital en inventario");
  const { activeOrg } = useOrg();
  const inventory = useModulePerms("inventory"), analytics = useModulePerms("analytics");
  const [params, setParams] = useSearchParams();
  const search = (params.get("q") || "").slice(0, 120);
  const [draft, setDraft] = useState({ search, text: search });
  const tab = ["valuation", "layers", "rotation", "history"].includes(params.get("vista")) ? params.get("vista") : "valuation";
  const readPage = (key: string) => { const value = Number(params.get(key) || 1); return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1000000) : 1; };
  const allowed = inventory.canView && analytics.canView && !inventory.loading && !analytics.loading;
  const source = useInventoryCapital({ orgId: activeOrg?.id ?? null, enabled: allowed, search, page: readPage("pagina"), historyPage: readPage("historial"), layerPage: readPage("capas") });
  const { data, loading, error } = source;
  const change = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "q") { next.delete("pagina"); next.delete("capas"); }
    return next;
  }, { replace: true });
  const exportPage = () => {
    if (!data || error || loading || !inventory.canExport) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", inventoryCapitalCsv(data, tab)], { type: "text/csv;charset=utf-8" }));
    const viewName = tab === "history" ? "historial" : tab === "layers" ? "capas" : "inventario";
    const exportPage = tab === "history" ? data.historyPage : tab === "layers" ? data.layerPage : data.page;
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `capital-${viewName}_${data.snapshotDate}_pagina-${exportPage}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };
  const summary = data?.summary;
  return <section aria-label="Capital en inventario" className="min-w-0 space-y-4 pb-8">
    <PageHeader icon={Layers} title="Capital en inventario" description="Costo registrado en Kardex · Organización completa · ARS" actions={<div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={!allowed || loading} onClick={source.retry}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button>
      {inventory.canExport && <Button variant="outline" onClick={exportPage} disabled={!data || loading || !!error}><Download className="mr-2 h-4 w-4" />Exportar página</Button>}
      {inventory.canCreate && <Button onClick={() => void source.capture()} disabled={!allowed || !data || !data.itemCount || loading || !!error || source.capturing}>
        <Save className="mr-2 h-4 w-4" />{source.capturing ? "Guardando cierre" : "Guardar cierre del día"}</Button>}
    </div>} />
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <p>FIFO analítico sobre costos congelados. No es valor de mercado ni cierre contable.</p>
      <div className="flex gap-4"><Link to="/profit" className="font-medium text-primary dark:text-blue-300 hover:underline">Rentabilidad</Link><Link to="/kardex" className="font-medium text-primary dark:text-blue-300 hover:underline">Kardex</Link></div>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); change("q", draft.search === search ? draft.text.trim() : search); }}>
      <div className="min-w-0 max-w-sm flex-1"><Input aria-label="Buscar producto o SKU" placeholder="Buscar producto o SKU" maxLength={120} value={draft.search === search ? draft.text : search}
        onChange={event => setDraft({ search, text: event.target.value })} /></div>
      <Button type="submit" variant="outline">Buscar</Button>
      {search && <Button type="button" variant="ghost" onClick={() => { change("q", ""); setDraft({ search: "", text: "" }); }}>Limpiar</Button>}
    </form>
    <Tabs value={tab} onValueChange={value => change("vista", value)} className="min-w-0">
      <div className="max-w-full overflow-x-auto"><TabsList aria-label="Vistas de capital" className="flex w-max gap-1 border-b border-border">
        {[{ value: "valuation", label: "Valuación" }, { value: "layers", label: "Capas de costo" }, { value: "rotation", label: "Rotación" }, { value: "history", label: "Histórico" }].map(view =>
          <TabsTrigger key={view.value} value={view.value} className="min-h-10 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:text-blue-300">{view.label}</TabsTrigger>)}
      </TabsList></div>
      {!allowed && !inventory.loading && !analytics.loading && <WorkspaceState kind="permission" title="Capital sin acceso" description="Esta lectura requiere permisos de inventario y rentabilidad." />}
      {(inventory.loading || analytics.loading || (loading && !data)) && <WorkspaceState kind="initial-loading" title="Cargando capital en inventario" />}
      {error && <WorkspaceState kind={data ? "stale" : "error-recoverable"} title={data ? "Lectura anterior, sin actualizar" : "No pudimos cargar capital"}
        description={error} actionLabel="Volver a intentar" onAction={source.retry} />}
      {source.captureError && <WorkspaceState kind="error-recoverable" layout="banner" title="No se confirmó el cierre" description={source.captureError} />}
      {source.captureMessage && <WorkspaceState kind="success" layout="banner" title={source.captureMessage} />}
      {allowed && data && <>
        {loading && <WorkspaceState kind="refreshing" layout="banner" title="Actualizando lectura" />}
        <p className="mt-4 text-xs text-muted-foreground">{data.itemCount} posiciones · Lectura {new Date(data.asOf).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
          {search ? " · Totales de la búsqueda" : " · Totales de la organización"}</p>
        {tab !== "history" && <>
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: "Capital completo", value: money(summary.valueARS), detail: summary.valueARS === null ? "Falta evidencia o conciliación" : "Costo registrado, no valor de venta", icon: Wallet },
              { label: "Subtotal trazable", value: money(summary.measuredValueARS), detail: `${summary.knownUnits} unidades con costo`, icon: ShieldCheck },
              { label: "Unidades pendientes", value: summary.unvaluedUnits.toLocaleString("es-AR"), detail: `${summary.blockedItems} posiciones a conciliar`, icon: Package },
              { label: "Más de 90 días sin vender", value: money(summary.slowCapitalARS), detail: "Subtotal con venta previa comprobable", icon: TrendingDown },
            ].map(metric => <div key={metric.label} className="workspace-kpi-card min-w-0 border border-border bg-card p-3 sm:p-4">
              <div className="flex justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><metric.icon className="h-4 w-4 shrink-0 text-primary" /></div>
              <p className="mt-2 break-words text-xl font-semibold tabular-nums">{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
            </div>)}
          </div>
          {summary.valueARS === null && data.itemCount > 0 && <WorkspaceState kind="partial" layout="banner" className="mt-3" title="Capital parcialmente explicado"
            description={`${summary.coveragePct ?? 0}% de las unidades positivas tiene costo trazable. El stock negativo y los saldos sin conciliar siguen visibles.`} />}
        </>}
        {data.itemCount === 0 && tab !== "history" ? <WorkspaceState kind={search ? "empty-filtered" : "empty-first-use"} title={search ? "Sin posiciones para esta búsqueda" : "No hay stock para valorizar"}
          description="Los servicios y productos sin control de stock no forman parte del capital en inventario." actionLabel={search ? "Limpiar búsqueda" : undefined} onAction={() => change("q", "")} /> : <>
          {tab === "valuation" && <TabsContent value="valuation"><TableFrame><table aria-label="Valuación por producto y variante" className="w-full min-w-[720px] table-fixed text-sm">
            <thead className="border-b bg-muted/20"><tr><th className="w-[30%] px-3 py-3 text-left font-medium">Producto / SKU</th><th className={header}>Stock</th><th className={header}>Con costo</th><th className={header}>Capital ARS</th><th className={header}>Subtotal ARS</th><th className="w-[22%] px-3 py-3 text-left font-medium">Pendientes</th></tr></thead>
            <tbody>{data.items.map(row => <tr key={`${row.product_id}:${row.variant_id || "base"}`} className="border-b last:border-0">
              <td className="px-3 py-3">{title(row)}</td><td className={cell}>{row.stock_units ?? "Sin saldo"}</td><td className={cell}>{row.known_units}</td>
              <td className={cell}>{money(row.value_ars)}</td><td className={cell}>{money(row.measured_value_ars)}</td><td className="px-3 py-3 text-xs leading-relaxed">{row.reasons.length ? row.reasons.map(code => CAPITAL_REASONS[code]).join(" · ") : "Costo trazable"}</td>
            </tr>)}</tbody></table></TableFrame></TabsContent>}
          {tab === "layers" && <TabsContent value="layers"><p className="mb-3 text-xs text-muted-foreground">Unidades remanentes después de las salidas FIFO. Las devoluciones sin costo original y el saldo inicial quedan pendientes.</p>
            {data.layerCount === 0 ? <WorkspaceState kind="partial" title="Conciliar movimientos antes de asignar capas" description="El Kardex y el saldo actual deben reconciliar para explicar las unidades remanentes." /> :
            <TableFrame><table aria-label="Capas remanentes de costo" className="w-full min-w-[680px] table-fixed text-sm"><thead className="border-b bg-muted/20"><tr>
              <th className="w-[30%] px-3 py-3 text-left font-medium">Producto / SKU</th><th className="px-3 py-3 text-left font-medium">Ingreso</th><th className={header}>Remanentes</th><th className={header}>Costo unitario ARS</th><th className={header}>Capa ARS</th></tr></thead>
              <tbody>{data.layers.map((layer, index) => <tr key={`${layer.product_id}:${layer.variant_id}:${layer.movementId || index}`} className="border-b last:border-0">
                <td className="px-3 py-3">{title(layer)}</td><td className="px-3 py-3 text-xs">{date(layer.receivedAt)}<p className="mt-1 text-muted-foreground">{layer.source === "movement_snapshot" ? "Costo registrado" : layer.source === "opening" ? "Saldo inicial sin costo" : "Ingreso sin costo verificado"}</p></td>
                <td className={cell}>{layer.remainingUnits}</td><td className={cell}>{money(layer.unitCostARS)}</td><td className={cell}>{money(layer.valueARS)}</td>
              </tr>)}</tbody></table></TableFrame>}
          </TabsContent>}
          {tab === "rotation" && <TabsContent value="rotation"><p className="mb-3 text-xs text-muted-foreground">Ventas netas de devoluciones registradas en los últimos 90 días. Cobertura de stock observada, no pronóstico.</p>
            <TableFrame><table aria-label="Rotación del inventario" className="w-full min-w-[660px] table-fixed text-sm"><thead className="border-b bg-muted/20"><tr>
              <th className="w-[30%] px-3 py-3 text-left font-medium">Producto / SKU</th><th className={header}>Última venta</th><th className={header}>Días sin vender</th><th className={header}>Unidades netas 90 días</th><th className={header}>Cobertura en días</th><th className={header}>Subtotal ARS</th></tr></thead>
              <tbody>{data.items.map(row => <tr key={`${row.product_id}:${row.variant_id}`} className="border-b last:border-0"><td className="px-3 py-3">{title(row)}</td>
                <td className={cell}>{date(row.last_sold_at)}</td><td className={cell}>{row.days_without_sale ?? "Sin historial"}</td><td className={cell}>{row.sold_units_90}</td>
                <td className={cell}>{row.days_of_stock ?? "Sin demanda comprobable"}</td><td className={cell}>{money(row.measured_value_ars)}</td></tr>)}</tbody></table></TableFrame>
          </TabsContent>}
        </>}
        {tab !== "history" && <DataPagination page={(tab === "layers" ? data.layerPage : data.page) - 1} totalPages={Math.ceil((tab === "layers" ? data.layerCount : data.itemCount) / data.pageSize)} totalItems={tab === "layers" ? data.layerCount : data.itemCount} pageSize={data.pageSize}
          itemLabel={tab === "layers" ? "capas" : "posiciones"} disabled={loading} onPageChange={page => change(tab === "layers" ? "capas" : "pagina", String(page + 1))} />}
        {tab === "history" && <TabsContent value="history"><div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><History className="h-4 w-4" /><p>Cierres diarios de toda la organización. Una captura previa no se sobrescribe.</p></div>
          {data.historyCount === 0 ? <WorkspaceState kind="empty-first-use" title="Todavía no hay cierres guardados" description="El cierre del día conserva stock, cobertura y fuentes sin crear asientos." />
            : <TableFrame><table aria-label="Cierres diarios de inventario" className="w-full min-w-[620px] text-sm"><thead className="border-b bg-muted/20"><tr><th className="px-3 py-3 text-left font-medium">Fecha</th><th className={header}>Productos</th><th className={header}>Stock</th><th className={header}>Capital ARS</th><th className={header}>Subtotal ARS</th><th className="px-3 py-3 text-left font-medium">Fuente</th></tr></thead>
              <tbody>{data.history.map(row => <tr key={row.snapshot_date} className="border-b last:border-0"><td className="px-3 py-3">{date(`${row.snapshot_date}T12:00:00-03:00`)}</td><td className={cell}>{row.products}</td><td className={cell}>{row.units}</td>
                <td className={cell}>{money(row.value_ars)}</td><td className={cell}>{money(row.measured_value_ars)}</td><td className="px-3 py-3 text-xs">{row.verified ? "FIFO · Kardex" : "Registro anterior sin evidencia de costo"}</td></tr>)}</tbody></table></TableFrame>}
          <DataPagination page={data.historyPage - 1} totalPages={Math.ceil(data.historyCount / data.pageSize)} totalItems={data.historyCount} pageSize={data.pageSize}
            itemLabel="cierres" disabled={loading} onPageChange={page => change("historial", String(page + 1))} />
        </TabsContent>}
      </>}
    </Tabs>
  </section>;
}
