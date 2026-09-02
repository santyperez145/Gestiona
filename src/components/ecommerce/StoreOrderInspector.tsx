/**
 * Ficha de un pedido de tienda sin sacar al comercio de la cola.
 *
 * Ventas ya hace esto con `?sale=`. Acá la selección es `?pedido=`: Back
 * restaura búsqueda y vista, un id ajeno no consulta otra organización y el
 * despacho sigue siendo un paso aparte, sólo si el pago está acreditado.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import WorkspaceState from "@/components/shared/WorkspaceState";
import {
  buildStoreOrderDetail,
  type StoreOrderInspectRow,
} from "@/lib/storeOrderDetail";
import {
  storeOrderFulfillmentLabel,
  storeOrderFulfillmentTone,
} from "@/lib/storeOrderQueue";
import {
  canConfirmManualStorePayment,
  canFulfillStoreOrder,
  storeOrderPaymentLabel,
  storeOrderPaymentTone,
} from "@/lib/storeOrderPayment";
import { formatARS } from "@/lib/supabaseStore";
import { Banknote, Eye, Loader2, Truck } from "lucide-react";
import OperationMarginPanel from "@/components/shared/OperationMarginPanel";

interface Props {
  open: boolean;
  orgId?: string;
  order: StoreOrderInspectRow | null;
  requestedId: string | null;
  loading?: boolean;
  confirmingPaid?: boolean;
  onClose: () => void;
  onPrepare: (order: StoreOrderInspectRow) => void;
  onConfirmPaid?: (order: StoreOrderInspectRow) => void;
}

function fechaHora(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

export default function StoreOrderInspector({
  open, orgId, order, requestedId, loading, confirmingPaid, onClose, onPrepare, onConfirmPaid,
}: Props) {
  const detail = buildStoreOrderDetail(order);
  const canShip = order ? canFulfillStoreOrder(order.payment_status) : false;
  const canConfirmPaid = order ? canConfirmManualStorePayment(order) : false;

  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <SheetContent
        side="right"
        data-testid="store-order-inspector"
        className="flex w-full flex-col p-0 sm:max-w-2xl"
      >
        {loading ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/60 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
              <SheetTitle>Pedido</SheetTitle>
              <SheetDescription>Leyendo la ficha sin salir de la cola.</SheetDescription>
            </SheetHeader>
            <WorkspaceState kind="initial-loading" title="Leyendo el pedido" loadingRows={4} layout="embedded" />
          </div>
        ) : detail ? (
          <>
            <SheetHeader className="mb-0 border-b border-border/60 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge className={`text-xs ${storeOrderPaymentTone(detail.order.payment_status)}`}>
                  {storeOrderPaymentLabel(detail.order.payment_status)}
                </Badge>
                <Badge className={`text-xs ${storeOrderFulfillmentTone(detail.order.fulfillment_status)}`}>
                  {storeOrderFulfillmentLabel(detail.order.fulfillment_status)}
                </Badge>
              </div>
              <SheetTitle>Pedido {detail.order.order_number}</SheetTitle>
              <SheetDescription>
                {fechaHora(detail.order.created_at)}
                {` · ${detail.order.customer_name}`}
                {` · ${detail.items.length} ${detail.items.length === 1 ? "ítem" : "ítems"}`}
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 px-5 py-5 sm:px-6">
                <section aria-labelledby="pedido-resumen">
                  <h3 id="pedido-resumen" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Resumen
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-border/60 bg-card p-3">
                      <p className="text-[11px] text-muted-foreground">Total</p>
                      <p className="mt-1 font-mono text-base font-bold">{formatARS(Number(detail.order.total))}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card p-3">
                      <p className="text-[11px] text-muted-foreground">Unidades</p>
                      <p className="mt-1 font-mono text-base font-bold">{detail.units}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card p-3">
                      <p className="text-[11px] text-muted-foreground">Medio</p>
                      <p className="mt-1 text-sm font-semibold">{detail.paymentMethodLabel}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card p-3">
                      <p className="text-[11px] text-muted-foreground">Seguimiento</p>
                      <p className="mt-1 font-mono text-xs font-semibold">
                        {detail.order.tracking_number || "Sin número"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    El total lo cobró el checkout. El margen canónico (costo, comisión, envío real e IVA) está abajo cuando la venta ya está asentada.
                  </p>
                </section>

                <OperationMarginPanel orgId={orgId} operationId={detail.order.id} />

                <section aria-labelledby="pedido-cliente">
                  <h3 id="pedido-cliente" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Cliente y destino
                  </h3>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Nombre</dt>
                      <dd className="font-medium">{detail.order.customer_name}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Email</dt>
                      <dd className="break-all">{detail.order.customer_email || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Teléfono</dt>
                      <dd>
                        {detail.order.customer_phone
                          ? <a className="underline-offset-2 hover:underline" href={`tel:${detail.order.customer_phone}`}>{detail.order.customer_phone}</a>
                          : "—"}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] text-muted-foreground">Envío a</dt>
                      <dd>{detail.address.texto || "Retiro o sin dirección cargada"}</dd>
                    </div>
                  </dl>
                </section>

                <section aria-labelledby="pedido-importes">
                  <h3 id="pedido-importes" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Importes
                  </h3>
                  <dl className="space-y-1.5 rounded-lg border border-border/60 bg-card p-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd className="font-mono">{formatARS(Number(detail.order.subtotal ?? detail.itemsTotal))}</dd>
                    </div>
                    {(Number(detail.order.discount_amount) > 0 || Number(detail.order.coupon_discount_ars) > 0) && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          Descuento{detail.order.coupon_code ? ` (${detail.order.coupon_code})` : ""}
                        </dt>
                        <dd className="font-mono">
                          −{formatARS(Number(detail.order.coupon_discount_ars || detail.order.discount_amount))}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Envío</dt>
                      <dd className="font-mono">
                        {Number(detail.order.shipping_cost) === 0
                          ? "Gratis"
                          : formatARS(Number(detail.order.shipping_cost ?? 0))}
                      </dd>
                    </div>
                    {Number(detail.order.tax_amount) > 0 && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">IVA</dt>
                        <dd className="font-mono">{formatARS(Number(detail.order.tax_amount))}</dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-3 border-t border-border/50 pt-2 font-semibold">
                      <dt>Total</dt>
                      <dd className="font-mono">{formatARS(Number(detail.order.total))}</dd>
                    </div>
                  </dl>
                </section>

                <section aria-labelledby="pedido-items">
                  <h3 id="pedido-items" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ítems
                  </h3>
                  {detail.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Este pedido no tiene líneas para mostrar.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.items.map((item, index) => (
                        <article key={`${item.name}-${index}`} className="rounded-lg border border-border/60 bg-card p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight">{item.name}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {item.quantity} × {formatARS(item.unit_price)}
                              </p>
                            </div>
                            <p className="shrink-0 font-mono text-sm font-semibold">{formatARS(item.total)}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                {detail.order.notes && (
                  <section aria-labelledby="pedido-notas">
                    <h3 id="pedido-notas" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Notas
                    </h3>
                    <p className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                      {detail.order.notes}
                    </p>
                  </section>
                )}
              </div>
            </ScrollArea>

            <div className="flex flex-col-reverse gap-2 border-t border-border/60 bg-popover px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <Button variant="outline" className="min-h-11" onClick={onClose} disabled={confirmingPaid}>
                Cerrar
              </Button>
              {canConfirmPaid && onConfirmPaid && (
                <Button
                  className="min-h-11 gap-1.5"
                  disabled={confirmingPaid}
                  onClick={() => onConfirmPaid(detail.order)}
                >
                  {confirmingPaid
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Banknote className="h-4 w-4" />}
                  Marcar como cobrado
                </Button>
              )}
              {canShip && (
                <Button className="min-h-11 gap-1.5" onClick={() => onPrepare(detail.order)} disabled={confirmingPaid}>
                  <Truck className="h-4 w-4" />
                  {detail.order.tracking_number ? "Ver envío" : "Preparar envío"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/60 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
              <SheetTitle>Pedido no disponible</SheetTitle>
              <SheetDescription>El registro solicitado no forma parte de la lectura autorizada actual.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div className="max-w-sm rounded-lg border border-border/60 bg-muted/20 p-5">
                <Eye className="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium">No se pudo abrir el detalle.</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Puede haber sido eliminado, pertenecer a otra organización o ya no estar disponible con tus permisos.
                </p>
                {requestedId && (
                  <p className="mt-3 font-mono text-[10px] text-muted-foreground">ID …{requestedId.slice(-8)}</p>
                )}
                <Button variant="outline" className="mt-4 min-h-11" onClick={onClose}>Volver a Pedidos</Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
