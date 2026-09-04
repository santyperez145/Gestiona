/**
 * Cola operativa de pedidos de la tienda.
 *
 * Búsqueda, vistas en español, CSV y fulfillment masivo del recorte visible.
 * La selección sólo ofrece transiciones compatibles; la autoridad final vive
 * en `bulk_update_store_order_fulfillment`.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import WorkspaceState from "@/components/shared/WorkspaceState";
import {
  STORE_ORDER_MEDIOS,
  STORE_ORDER_BULK_LIMIT,
  STORE_ORDER_QUEUE_LIMIT,
  STORE_ORDER_SORTS,
  STORE_ORDER_VIEWS,
  buildStoreOrdersCsv,
  countBulkFulfillmentCandidates,
  countStoreOrderViews,
  filterStoreOrders,
  isStoreOrderBulkSelectable,
  parseStoreOrderMedio,
  parseStoreOrderSort,
  parseStoreOrderView,
  storeOrderFulfillmentLabel,
  storeOrderFulfillmentTone,
  storeOrderFulfillmentActionLabel,
  esPedidoRetiro,
  storeOrdersCsvFilename,
  type StoreOrderMedio,
  type StoreOrderBulkResponse,
  type StoreOrderBulkStatus,
  type StoreOrderQueueRow,
  type StoreOrderSort,
  type StoreOrderView,
} from "@/lib/storeOrderQueue";
import { canFulfillStoreOrder, storeOrderPaymentLabel, storeOrderPaymentTone } from "@/lib/storeOrderPayment";
import { storeOrdersEmptyShareCopy } from "@/lib/storeFirstPublish";
import { toast } from "sonner";
import { Download, Eye, Loader2, PackageCheck, Search, Store, Truck, X } from "lucide-react";

interface Props {
  orders: StoreOrderQueueRow[];
  loading: boolean;
  error: string | null;
  selectedId?: string | null;
  /** Link público de la tienda: empty-first-use puede copiarlo (ATM). */
  publicStoreUrl?: string | null;
  onRetry: () => void;
  onInspect: (order: StoreOrderQueueRow) => void;
  onPrepare: (order: StoreOrderQueueRow) => void;
  canBulkEdit: boolean;
  bulkBusy: boolean;
  bulkResult: StoreOrderBulkResponse | null;
  onDismissBulkResult: () => void;
  onBulkFulfill: (orders: StoreOrderQueueRow[], status: StoreOrderBulkStatus) => Promise<boolean>;
}

function writeQueueParams(
  prev: URLSearchParams,
  next: { query?: string; view?: StoreOrderView; sort?: StoreOrderSort; medio?: StoreOrderMedio },
) {
  const params = new URLSearchParams(prev);
  if (next.query !== undefined) {
    const q = next.query.trim();
    if (q) params.set("q", next.query);
    else params.delete("q");
  }
  if (next.view !== undefined) {
    if (next.view === "todas") params.delete("vista");
    else params.set("vista", next.view);
  }
  if (next.sort !== undefined) {
    if (next.sort === "recientes") params.delete("orden");
    else params.set("orden", next.sort);
  }
  if (next.medio !== undefined) {
    if (next.medio === "todos") params.delete("medio");
    else params.set("medio", next.medio);
  }
  return params;
}

function fechaPedido(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

function downloadCsv(rows: StoreOrderQueueRow[]) {
  const blob = new Blob(["\uFEFF", buildStoreOrdersCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = storeOrdersCsvFilename();
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function StoreOrdersPanel({
  orders, loading, error, selectedId, publicStoreUrl, onRetry, onInspect, onPrepare,
  canBulkEdit, bulkBusy, bulkResult, onDismissBulkResult, onBulkFulfill,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const view = parseStoreOrderView(searchParams.get("vista"));
  const sort = parseStoreOrderSort(searchParams.get("orden"));
  const medio = parseStoreOrderMedio(searchParams.get("medio"));
  const ordersEmpty = storeOrdersEmptyShareCopy(Boolean(publicStoreUrl));
  const counts = useMemo(() => countStoreOrderViews(orders), [orders]);
  const visible = useMemo(
    () => filterStoreOrders(orders, { query, view, sort, medio }),
    [orders, query, view, sort, medio],
  );
  const capped = orders.length >= STORE_ORDER_QUEUE_LIMIT;
  const hasFilters = query.trim().length > 0 || view !== "todas" || sort !== "recientes" || medio !== "todos";
  const selectionScope = useMemo(
    () => visible.filter(isStoreOrderBulkSelectable).slice(0, STORE_ORDER_BULK_LIMIT),
    [visible],
  );
  const selectedOrders = useMemo(
    () => visible.filter(order => selectedIds.has(order.id)),
    [visible, selectedIds],
  );
  const shippedCandidates = countBulkFulfillmentCandidates(selectedOrders, "shipped");
  const deliveredCandidates = countBulkFulfillmentCandidates(selectedOrders, "delivered");
  const allScopeSelected = selectionScope.length > 0 && selectionScope.every(order => selectedIds.has(order.id));
  const someScopeSelected = selectionScope.some(order => selectedIds.has(order.id));

  useEffect(() => {
    setSelectedIds(new Set());
  }, [query, view, sort, medio]);

  useEffect(() => {
    const valid = new Set(orders.filter(isStoreOrderBulkSelectable).map(order => order.id));
    setSelectedIds(current => new Set([...current].filter(id => valid.has(id))));
  }, [orders]);

  const toggleOrder = (orderId: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else if (next.size < STORE_ORDER_BULK_LIMIT) next.add(orderId);
      else toast.info(`Podés operar hasta ${STORE_ORDER_BULK_LIMIT} pedidos por lote.`);
      return next;
    });
  };

  const toggleScope = () => {
    if (allScopeSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectionScope.map(order => order.id)));
    if (visible.filter(isStoreOrderBulkSelectable).length > STORE_ORDER_BULK_LIMIT) {
      toast.info(`Seleccionamos los primeros ${STORE_ORDER_BULK_LIMIT} pedidos operables del recorte.`);
    }
  };

  const runBulk = async (status: StoreOrderBulkStatus) => {
    const completed = await onBulkFulfill(selectedOrders, status);
    if (completed) setSelectedIds(new Set());
  };

  const setQuery = (q: string) => {
    setSearchParams(prev => writeQueueParams(prev, { query: q }), { replace: true });
  };
  const setView = (next: StoreOrderView) => {
    setSearchParams(prev => writeQueueParams(prev, { view: next }), { replace: true });
  };
  const setSort = (next: StoreOrderSort) => {
    setSearchParams(prev => writeQueueParams(prev, { sort: next }), { replace: true });
  };
  const setMedio = (next: StoreOrderMedio) => {
    setSearchParams(prev => writeQueueParams(prev, { medio: next }), { replace: true });
  };
  const clearFilters = () => {
    setSearchParams(prev => writeQueueParams(prev, { query: "", view: "todas", sort: "recientes", medio: "todos" }), { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Número, cliente, email, teléfono o monto"
            aria-label="Buscar pedidos de la tienda"
            className="h-11 pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-11 shrink-0 gap-1.5"
          disabled={visible.length === 0}
          onClick={() => downloadCsv(visible)}
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STORE_ORDER_VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`min-h-11 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              view === v.id
                ? "border-primary/30 bg-primary/15 text-primary"
                : "border-border/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {v.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[v.id]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={sort} onValueChange={value => setSort(value as StoreOrderSort)}>
          <SelectTrigger className="h-11 w-[170px]" aria-label="Ordenar pedidos">
            <SelectValue placeholder="Ordenar pedidos" />
          </SelectTrigger>
          <SelectContent>
            {STORE_ORDER_SORTS.map(option => (
              <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={medio} onValueChange={value => setMedio(value as StoreOrderMedio)}>
          <SelectTrigger className="h-11 w-[190px]" aria-label="Filtrar por medio de pago">
            <SelectValue placeholder="Medio de pago" />
          </SelectTrigger>
          <SelectContent>
            {STORE_ORDER_MEDIOS.map(option => (
              <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-11 px-3 text-xs" onClick={clearFilters}>
            Quitar filtros
          </Button>
        )}
      </div>

      {capped && (
        <p className="text-xs text-muted-foreground">
          Se muestran los últimos {STORE_ORDER_QUEUE_LIMIT} pedidos. La búsqueda y el CSV operan sobre esa cola.
        </p>
      )}

      {bulkResult && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4" role="status">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Lote procesado</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {bulkResult.changed} actualizados · {bulkResult.unchanged} ya estaban así · {bulkResult.skipped} omitidos
                {bulkResult.duplicates ? ` · ${bulkResult.duplicates} repetidos` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={onDismissBulkResult} aria-label="Cerrar resultado del lote">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {bulkResult.results.some(item => item.outcome === "skipped") && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {bulkResult.results.filter(item => item.outcome === "skipped").slice(0, 5).map((item, index) => (
                <li key={`${item.order_id ?? "invalid"}-${index}`}>
                  <span className="font-mono text-foreground">{item.order_number ?? "Pedido no visible"}</span>: {item.reason}
                </li>
              ))}
              {bulkResult.skipped > 5 && <li>Y {bulkResult.skipped - 5} omisiones más.</li>}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <WorkspaceState kind="initial-loading" title="Leyendo pedidos" loadingRows={5} />
      ) : error ? (
        <WorkspaceState
          kind="error-recoverable"
          title="No pudimos leer los pedidos"
          description={error}
          actionLabel="Reintentar"
          onAction={onRetry}
        />
      ) : orders.length === 0 ? (
        <WorkspaceState
          kind="empty-first-use"
          title={ordersEmpty.title}
          description={ordersEmpty.description}
          actionLabel={ordersEmpty.actionLabel}
          onAction={ordersEmpty.actionLabel && publicStoreUrl
            ? () => {
                void navigator.clipboard.writeText(publicStoreUrl).then(
                  () => toast.success("Enlace copiado"),
                  () => toast.error("No se pudo copiar el enlace"),
                );
              }
            : undefined}
        />
      ) : visible.length === 0 ? (
        <WorkspaceState
          kind="empty-filtered"
          title="Ningún pedido coincide"
          description="Probá otra búsqueda o volvé a Todas. Esta lista muestra únicamente los pedidos de tu tienda."
          actionLabel="Quitar filtros"
          onAction={clearFilters}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {visible.length === 1 ? "1 pedido" : `${visible.length} pedidos`}
            {hasFilters ? " en este recorte" : ""}
          </p>

          {canBulkEdit && selectedOrders.length > 0 && (
            <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-primary/25 bg-background/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between" role="region" aria-label="Acciones para pedidos seleccionados">
              <div>
                <p className="text-sm font-semibold">{selectedOrders.length} seleccionados</p>
                <p className="text-xs text-muted-foreground">Sólo cambia lo compatible; el resultado identifica cada omisión.</p>
              </div>
              <div className="grid gap-2 sm:flex">
                <Button
                  variant="outline"
                  className="min-h-11 gap-1.5"
                  disabled={bulkBusy || shippedCandidates === 0}
                  onClick={() => { void runBulk("shipped"); }}
                >
                  {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                  En camino ({shippedCandidates})
                </Button>
                <Button
                  className="min-h-11 gap-1.5"
                  disabled={bulkBusy || deliveredCandidates === 0}
                  onClick={() => { void runBulk("delivered"); }}
                >
                  {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                  Entregados/retiros ({deliveredCandidates})
                </Button>
              </div>
            </div>
          )}

          <div className="hidden overflow-hidden rounded-xl border border-border/40 bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {canBulkEdit && (
                      <th className="w-12 px-1 py-1 text-center">
                        <div className="grid h-11 w-11 place-items-center">
                          <Checkbox
                            checked={allScopeSelected ? true : someScopeSelected ? "indeterminate" : false}
                            disabled={selectionScope.length === 0 || bulkBusy}
                            onCheckedChange={toggleScope}
                            aria-label={`Seleccionar hasta ${STORE_ORDER_BULK_LIMIT} pedidos operables visibles`}
                          />
                        </div>
                      </th>
                    )}
                    {["Orden", "Cliente", "Email", "Total", "Pago", "Estado", "Fecha"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                    <th className="sticky right-0 bg-muted/20 px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground backdrop-blur">
                      Envío
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(o => (
                    <OrderRow
                      key={o.id}
                      order={o}
                      selected={o.id === selectedId}
                      bulkSelected={selectedIds.has(o.id)}
                      canBulkEdit={canBulkEdit}
                      bulkBusy={bulkBusy}
                      onToggle={toggleOrder}
                      onInspect={onInspect}
                      onPrepare={onPrepare}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {visible.map(o => (
              <OrderCard
                key={o.id}
                order={o}
                selected={o.id === selectedId}
                bulkSelected={selectedIds.has(o.id)}
                canBulkEdit={canBulkEdit}
                bulkBusy={bulkBusy}
                onToggle={toggleOrder}
                onInspect={onInspect}
                onPrepare={onPrepare}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OrderRow({
  order: o,
  selected,
  bulkSelected,
  canBulkEdit,
  bulkBusy,
  onToggle,
  onInspect,
  onPrepare,
}: {
  order: StoreOrderQueueRow;
  selected: boolean;
  bulkSelected: boolean;
  canBulkEdit: boolean;
  bulkBusy: boolean;
  onToggle: (orderId: string) => void;
  onInspect: (order: StoreOrderQueueRow) => void;
  onPrepare: (order: StoreOrderQueueRow) => void;
}) {
  const canShip = canFulfillStoreOrder(o.payment_status);
  const bulkSelectable = isStoreOrderBulkSelectable(o);
  return (
    <tr
      className={`cursor-pointer border-b border-border/20 hover:bg-muted/20 ${selected || bulkSelected ? "bg-primary/5" : ""}`}
      onClick={() => onInspect(o)}
    >
      {canBulkEdit && (
        <td className="w-12 px-1 py-1 text-center">
          <div className="grid h-11 w-11 place-items-center">
            <Checkbox
              checked={bulkSelected}
              disabled={!bulkSelectable || bulkBusy}
              onCheckedChange={() => onToggle(o.id)}
              onClick={event => event.stopPropagation()}
              aria-label={`Seleccionar ${o.order_number}`}
            />
          </div>
        </td>
      )}
      <td className="px-4 py-3 font-mono text-xs">{o.order_number}</td>
      <td className="px-4 py-3 text-sm font-medium">{o.customer_name}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{o.customer_email}</td>
      <td className="px-4 py-3 text-sm font-semibold">${Number(o.total).toLocaleString("es-AR")}</td>
      <td className="px-4 py-3">
        <Badge className={`text-xs ${storeOrderPaymentTone(o.payment_status)}`}>
          {storeOrderPaymentLabel(o.payment_status)}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <Badge className={`text-xs ${storeOrderFulfillmentTone(o.fulfillment_status)}`}>
          {storeOrderFulfillmentLabel(o.fulfillment_status, o)}
        </Badge>
        {o.tracking_number && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{o.tracking_number}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{fechaPedido(o.created_at)}</td>
      <td className="sticky right-0 bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-label={`Ver detalle de ${o.order_number}`}
            onClick={e => { e.stopPropagation(); onInspect(o); }}
          >
            <Eye className="h-3 w-3" />
            Detalle
          </Button>
          {canShip ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={e => { e.stopPropagation(); onPrepare(o); }}
            >
              {esPedidoRetiro(o) ? <Store className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
              {storeOrderFulfillmentActionLabel(o)}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function OrderCard({
  order: o,
  selected,
  bulkSelected,
  canBulkEdit,
  bulkBusy,
  onToggle,
  onInspect,
  onPrepare,
}: {
  order: StoreOrderQueueRow;
  selected: boolean;
  bulkSelected: boolean;
  canBulkEdit: boolean;
  bulkBusy: boolean;
  onToggle: (orderId: string) => void;
  onInspect: (order: StoreOrderQueueRow) => void;
  onPrepare: (order: StoreOrderQueueRow) => void;
}) {
  const canShip = canFulfillStoreOrder(o.payment_status);
  const bulkSelectable = isStoreOrderBulkSelectable(o);
  return (
    <div className={`rounded-xl border bg-card p-4 ${selected || bulkSelected ? "border-primary/40" : "border-border/60"}`}>
      <div className="flex items-start justify-between gap-3">
        {canBulkEdit && (
          <div className="grid h-11 w-11 shrink-0 place-items-center">
            <Checkbox
              checked={bulkSelected}
              disabled={!bulkSelectable || bulkBusy}
              onCheckedChange={() => onToggle(o.id)}
              aria-label={`Seleccionar ${o.order_number}`}
            />
          </div>
        )}
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{o.order_number}</p>
          <p className="truncate text-sm font-medium">{o.customer_name}</p>
          <p className="truncate text-xs text-muted-foreground">{o.customer_email}</p>
        </div>
        <p className="shrink-0 text-sm font-semibold">${Number(o.total).toLocaleString("es-AR")}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge className={`text-xs ${storeOrderPaymentTone(o.payment_status)}`}>
          {storeOrderPaymentLabel(o.payment_status)}
        </Badge>
        <Badge className={`text-xs ${storeOrderFulfillmentTone(o.fulfillment_status)}`}>
          {storeOrderFulfillmentLabel(o.fulfillment_status, o)}
        </Badge>
        <span className="text-xs text-muted-foreground">{fechaPedido(o.created_at)}</span>
      </div>
      {o.tracking_number && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">{o.tracking_number}</p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-11 w-full gap-1.5"
          aria-label={`Ver detalle de ${o.order_number}`}
          onClick={() => onInspect(o)}
        >
          <Eye className="h-4 w-4" />
          Detalle
        </Button>
        {canShip && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 w-full gap-1.5"
            onClick={() => onPrepare(o)}
          >
            {esPedidoRetiro(o) ? <Store className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
            {storeOrderFulfillmentActionLabel(o) || (o.tracking_number ? "Ver envío" : "Preparar envío")}
          </Button>
        )}
      </div>
    </div>
  );
}
