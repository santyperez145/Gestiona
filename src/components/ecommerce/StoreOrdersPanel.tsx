/**
 * Cola operativa de pedidos de la tienda.
 *
 * Búsqueda, vistas en español y CSV del recorte visible. El despacho sigue
 * siendo uno por uno: no hay selección masiva porque no hay RPC que la
 * autorice.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import WorkspaceState from "@/components/shared/WorkspaceState";
import {
  STORE_ORDER_QUEUE_LIMIT,
  STORE_ORDER_VIEWS,
  buildStoreOrdersCsv,
  countStoreOrderViews,
  filterStoreOrders,
  parseStoreOrderView,
  storeOrderFulfillmentLabel,
  storeOrderFulfillmentTone,
  storeOrdersCsvFilename,
  type StoreOrderQueueRow,
  type StoreOrderView,
} from "@/lib/storeOrderQueue";
import { canFulfillStoreOrder, storeOrderPaymentLabel, storeOrderPaymentTone } from "@/lib/storeOrderPayment";
import { Download, Search, Truck } from "lucide-react";

interface Props {
  orders: StoreOrderQueueRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPrepare: (order: StoreOrderQueueRow) => void;
}

function writeQueueParams(
  prev: URLSearchParams,
  next: { query?: string; view?: StoreOrderView },
) {
  const params = new URLSearchParams(prev);
  params.set("tab", "orders");
  if (next.query !== undefined) {
    const q = next.query.trim();
    if (q) params.set("q", next.query);
    else params.delete("q");
  }
  if (next.view !== undefined) {
    if (next.view === "todas") params.delete("vista");
    else params.set("vista", next.view);
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

export default function StoreOrdersPanel({ orders, loading, error, onRetry, onPrepare }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const view = parseStoreOrderView(searchParams.get("vista"));
  const counts = useMemo(() => countStoreOrderViews(orders), [orders]);
  const visible = useMemo(
    () => filterStoreOrders(orders, { query, view }),
    [orders, query, view],
  );
  const capped = orders.length >= STORE_ORDER_QUEUE_LIMIT;
  const hasFilters = query.trim().length > 0 || view !== "todas";

  const setQuery = (q: string) => {
    setSearchParams(prev => writeQueueParams(prev, { query: q }), { replace: true });
  };
  const setView = (next: StoreOrderView) => {
    setSearchParams(prev => writeQueueParams(prev, { view: next }), { replace: true });
  };
  const clearFilters = () => {
    setSearchParams(prev => writeQueueParams(prev, { query: "", view: "todas" }), { replace: true });
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

      {capped && (
        <p className="text-xs text-muted-foreground">
          Se muestran los últimos {STORE_ORDER_QUEUE_LIMIT} pedidos. La búsqueda y el CSV operan sobre esa cola.
        </p>
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
          title="Todavía no hay pedidos"
          description="Cuando un comprador termine una compra, aparece acá para cobrar el pendiente o preparar el envío."
        />
      ) : visible.length === 0 ? (
        <WorkspaceState
          kind="empty-filtered"
          title="Ningún pedido coincide"
          description="Probá otra búsqueda o volvé a Todas. No se ocultan pedidos de otra organización: esta cola es sólo la tuya."
          actionLabel="Quitar filtros"
          onAction={clearFilters}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {visible.length === 1 ? "1 pedido" : `${visible.length} pedidos`}
            {hasFilters ? " en este recorte" : ""}
          </p>

          <div className="hidden overflow-hidden rounded-xl border border-border/40 bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
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
                    <OrderRow key={o.id} order={o} onPrepare={onPrepare} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {visible.map(o => (
              <OrderCard key={o.id} order={o} onPrepare={onPrepare} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OrderRow({
  order: o,
  onPrepare,
}: {
  order: StoreOrderQueueRow;
  onPrepare: (order: StoreOrderQueueRow) => void;
}) {
  const canShip = canFulfillStoreOrder(o.payment_status);
  return (
    <tr
      className={`border-b border-border/20 hover:bg-muted/20 ${canShip ? "cursor-pointer" : ""}`}
      onClick={() => canShip && onPrepare(o)}
    >
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
          {storeOrderFulfillmentLabel(o.fulfillment_status)}
        </Badge>
        {o.tracking_number && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{o.tracking_number}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{fechaPedido(o.created_at)}</td>
      <td className="sticky right-0 bg-card px-4 py-3">
        {canShip ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={e => { e.stopPropagation(); onPrepare(o); }}
          >
            <Truck className="h-3 w-3" />
            {o.tracking_number ? "Ver envío" : "Preparar"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function OrderCard({
  order: o,
  onPrepare,
}: {
  order: StoreOrderQueueRow;
  onPrepare: (order: StoreOrderQueueRow) => void;
}) {
  const canShip = canFulfillStoreOrder(o.payment_status);
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
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
          {storeOrderFulfillmentLabel(o.fulfillment_status)}
        </Badge>
        <span className="text-xs text-muted-foreground">{fechaPedido(o.created_at)}</span>
      </div>
      {o.tracking_number && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">{o.tracking_number}</p>
      )}
      {canShip && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-11 w-full gap-1.5"
          onClick={() => onPrepare(o)}
        >
          <Truck className="h-4 w-4" />
          {o.tracking_number ? "Ver envío" : "Preparar envío"}
        </Button>
      )}
    </div>
  );
}
