/**
 * Preparar el envío de una orden de la tienda online.
 *
 * Tres pasos, en el orden en que ocurren de verdad en el mostrador:
 * preparar (crea la entrega con la dirección que ya cargó el comprador),
 * imprimir la etiqueta, y anotar el número de seguimiento.
 *
 * La etiqueta se imprime desde acá y no se pide por API a Correo Argentino ni
 * Andreani: esos contratos no están verificados y no hay credenciales. Cuando
 * las haya, el número entra por `set_order_tracking` igual que si se copiara a
 * mano, y nada de esto cambia.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CARRIER_LABELS, CARRIER_IDS, carrierLabel } from "@/lib/carriers";
import { useHasPermission } from "@/lib/usePermissions";
import { canFulfillStoreOrder, isStorePaymentReversed } from "@/lib/storeOrderPayment";
import { esPedidoRetiro } from "@/lib/storeOrderQueue";
import { Truck, Printer, Loader2, Check, PackageCheck, Home, Store } from "lucide-react";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";

export interface OrderForShipment {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  total: number | string;
  payment_status: string;
  fulfillment_status: string;
  carrier?: string | null;
  shipping_service?: string | null;
  tracking_number?: string | null;
  shipping_address?: Record<string, string> | null;
  items?: unknown[];
}

interface Entrega {
  id: string;
  carrier: string | null;
  external_tracking: string | null;
  status: string;
  weight_kg: number | null;
}

export default function OrderShipmentDialog({
  order, storeName, onClose, onDone,
}: {
  order: OrderForShipment | null;
  storeName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  // La base vuelve a verificarlo; esto sólo evita ofrecer acciones que van a
  // fallar a quien tiene acceso de lectura al ecommerce.
  const canEditEcommerce = useHasPermission("ecommerce", "edit");
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [cargando, setCargando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [actualizandoEstado, setActualizandoEstado] = useState<"shipped" | "delivered" | null>(null);
  const [carrier, setCarrier] = useState("propio");
  const [peso, setPeso] = useState("");
  const [tracking, setTracking] = useState("");

  // El checkout guarda la dirección con claves en español (`calle`, `ciudad`,
  // `provincia`, `cp`). Se aceptan también las inglesas por si alguna orden
  // vieja quedó con ese formato.
  const raw = order?.shipping_address ?? {};
  const dir = {
    calle:     raw.calle || raw.street || raw.address || "",
    ciudad:    raw.ciudad || raw.city || "",
    provincia: raw.provincia || raw.province || raw.state || "",
    cp:        raw.cp || raw.zip || raw.postal_code || "",
  };

  const cargar = useCallback(async () => {
    if (!order) return;
    setCargando(true);
    const { data } = await supabase
      .from("deliveries")
      .select("id, carrier, external_tracking, status, weight_kg")
      .eq("ecommerce_order_id", order.id)
      .maybeSingle();
    setCargando(false);
    const e = (data ?? null) as Entrega | null;
    setEntrega(e);
    if (e) {
      setCarrier(e.carrier || "propio");
      setPeso(e.weight_kg != null ? String(e.weight_kg) : "");
      setTracking(e.external_tracking || "");
    } else {
      setTracking(order.tracking_number || "");
    }
  }, [order]);

  useEffect(() => { if (order) cargar(); }, [order, cargar]);

  const preparar = async () => {
    if (!order) return;
    setPreparando(true);
    const { error } = await supabase.rpc("prepare_order_shipment", {
      p_order_id: order.id,
      p_carrier: carrier,
      p_weight_kg: Number(peso) > 0 ? Number(peso) : null,
    });
    setPreparando(false);
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    toast.success("Envío preparado. Ya podés imprimir la etiqueta.");
    cargar();
    onDone();
  };

  const guardarTracking = async () => {
    if (!order) return;
    setGuardando(true);
    const { error } = await supabase.rpc("set_order_tracking", {
      p_order_id: order.id,
      p_carrier: carrier,
      p_tracking: tracking,
    });
    setGuardando(false);
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    await avisarEstado("shipped");
    toast.success("Seguimiento cargado. El comprador ya puede verlo.");
    cargar();
    onDone();
  };

  /** El estado queda primero en la base; un problema de correo jamás deshace
      un despacho verdadero. La Function registra cada resultado y no vuelve a
      mandar el mismo evento si se reintenta este botón. */
  const avisarEstado = async (event: "shipped" | "delivered") => {
    if (!order || !canEditEcommerce) return;
    const { data, error } = await supabase.functions.invoke("store-order-status-email", {
      body: { orderId: order.id, event },
    });
    const message = error || (data as { error?: string } | null)?.error
      ? await mensajeDeEdgeFunction(error, data)
      : "";
    if (message) {
      toast.warning(`El estado se actualizó, pero no pudimos avisar por email: ${message}`);
    }
  };

  const avanzarEstado = async (status: "shipped" | "delivered") => {
    if (!order || !canEditEcommerce) return;
    setActualizandoEstado(status);
    const { error } = await supabase.rpc("update_store_order_fulfillment", {
      p_order_id: order.id,
      p_status: status,
    });
    setActualizandoEstado(null);
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    await avisarEstado(status);
    toast.success(status === "shipped" ? "Marcado en camino." : (
      esPedidoRetiro(order) ? "Pedido marcado como retirado." : "Pedido marcado como entregado."
    ));
    cargar();
    onDone();
  };

  /**
   * Abre la etiqueta en una ventana e imprime.
   *
   * Se arma acá y no en un componente aparte porque tiene que salir sin el
   * chrome de la app: una etiqueta con la barra lateral impresa no sirve.
   */
  const imprimir = () => {
    if (!order || !canEditEcommerce) return;
    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

    const w = window.open("", "_blank", "width=420,height=620");
    if (!w) { toast.error("El navegador bloqueó la ventana de impresión"); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Etiqueta ${esc(order.order_number)}</title>
<style>
  @page { size: 10cm 15cm; margin: 6mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; color: #000; }
  .caja { border: 2px solid #000; padding: 10px; }
  .rot { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #555; margin: 0 0 2px; }
  .dato { font-size: 13px; margin: 0 0 8px; line-height: 1.35; }
  .grande { font-size: 17px; font-weight: 700; }
  hr { border: 0; border-top: 1px dashed #999; margin: 8px 0; }
  .cod { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 15px;
         font-weight: 700; letter-spacing: .05em; }
  .pie { font-size: 9px; color: #666; margin-top: 8px; }
</style></head><body onload="window.print()">
<div class="caja">
  <p class="rot">Remitente</p>
  <p class="dato">${esc(storeName)}</p>
  <hr>
  <p class="rot">Destinatario</p>
  <p class="dato grande">${esc(order.customer_name)}</p>
  <p class="dato">
    ${esc(dir.calle || "")}<br>
    ${esc(dir.ciudad || "")} ${esc(dir.provincia || "")} ${esc(dir.cp || "")}<br>
    ${order.customer_phone ? "Tel. " + esc(order.customer_phone) : ""}
  </p>
  <hr>
  <p class="rot">Pedido</p>
  <p class="cod">${esc(order.order_number)}</p>
  <p class="dato">${esc(carrierLabel(carrier))}${
    peso ? " · " + esc(peso) + " kg" : ""
  }</p>
  ${entrega?.external_tracking
    ? `<p class="rot">Seguimiento</p><p class="cod">${esc(entrega.external_tracking)}</p>`
    : ""}
  <p class="pie">Pedido ya abonado — no cobrar contra entrega.</p>
</div>
</body></html>`);
    w.document.close();
  };

  if (!order) return null;

  const retiro = esPedidoRetiro(order);
  const sinPagar = !canFulfillStoreOrder(order.payment_status);
  const pagoRevertido = isStorePaymentReversed(order.payment_status);
  const yaPreparada = !!entrega;
  const enCamino = entrega?.status === "in_transit" || entrega?.status === "out_for_delivery";
  const entregada = entrega?.status === "delivered" || order.fulfillment_status === "delivered";
  const yaDespachada = !!entrega?.external_tracking || enCamino || entregada;

  return (
    <Dialog open={!!order} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {retiro ? <Store className="w-4 h-4 text-primary" /> : <Truck className="w-4 h-4 text-primary" />}
            {retiro ? `Retiro de ${order.order_number}` : `Envío de ${order.order_number}`}
          </DialogTitle>
        </DialogHeader>

        {cargando ? (
          <div className="py-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin opacity-50" /></div>
        ) : sinPagar ? (
          <p className="text-sm text-muted-foreground py-4">
            {pagoRevertido
              ? "El pago fue devuelto o desconocido. No despaches esta orden; si el paquete ya salió, coordiná la devolución antes de reponer stock."
              : retiro
                ? "Esta orden todavía no está paga. No marques un retiro de algo que no se cobró."
                : "Esta orden todavía no está paga. Preparar el envío de algo que no se cobró es la forma más cara de equivocarse."}
          </p>
        ) : retiro ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-1">Retiro en tienda</p>
              <p className="font-medium">{order.customer_name}</p>
              {order.customer_phone ? (
                <p className="text-muted-foreground text-xs mt-0.5">Tel. {order.customer_phone}</p>
              ) : null}
            </div>
            {entregada && (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 gap-1">
                <Store className="w-3 h-3" />
                Retirado
              </Badge>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Destino, tal como lo cargó el comprador */}
            <div className="rounded-lg border border-border/60 p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-1">Destino</p>
              <p className="font-medium">{order.customer_name}</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                {[dir.calle, dir.ciudad, dir.provincia, dir.cp]
                  .filter(Boolean).join(" · ") || "Sin dirección cargada"}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Transportista</label>
                <Select value={carrier} onValueChange={setCarrier} disabled={yaPreparada || !canEditEcommerce}>
                  <SelectTrigger className="mt-1 h-9 w-full text-sm" aria-label="Transportista">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARRIER_IDS.map(id => <SelectItem key={id} value={id}>{CARRIER_LABELS[id]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Peso (kg, opcional)</label>
                <Input
                  type="number" step="0.1" min="0" value={peso}
                  onChange={e => setPeso(e.target.value)}
                  placeholder="Se estima solo"
                  className="mt-1 h-9"
                  disabled={yaPreparada || !canEditEcommerce}
                />
              </div>
            </div>

            {yaPreparada && (
              <div>
                <label className="text-xs text-muted-foreground">Número de seguimiento</label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={tracking}
                    onChange={e => setTracking(e.target.value)}
                    placeholder="El que te da el correo"
                    className="h-9 font-mono text-xs"
                    disabled={!canEditEcommerce}
                  />
                  <Button size="sm" className="h-9 gap-1.5 text-xs" disabled={!canEditEcommerce || guardando || !tracking.trim()} onClick={guardarTracking}>
                    {guardando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Guardar
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Al guardarlo la orden pasa a "enviada" y el comprador lo ve en su pedido.
                </p>
              </div>
            )}

            {yaDespachada && (
              <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 gap-1">
                {entregada ? <Home className="w-3 h-3" /> : <PackageCheck className="w-3 h-3" />}
                {entregada ? "Entregada" : "En camino"}
              </Badge>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {canEditEcommerce && retiro && !cargando && !sinPagar && !entregada && (
            <Button
              className="gap-1.5 text-xs"
              disabled={actualizandoEstado === "delivered"}
              onClick={() => avanzarEstado("delivered")}
            >
              {actualizandoEstado === "delivered" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Store className="w-3 h-3" />}
              Marcar como retirado
            </Button>
          )}
          {canEditEcommerce && !retiro && !sinPagar && !yaPreparada && (
            <Button className="gap-1.5 text-xs" disabled={preparando} onClick={preparar}>
              {preparando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
              Preparar envío
            </Button>
          )}
          {canEditEcommerce && !retiro && yaPreparada && (
            <Button variant="outline" className="gap-1.5 text-xs" onClick={imprimir}>
              <Printer className="w-3 h-3" />Imprimir etiqueta
            </Button>
          )}
          {canEditEcommerce && !retiro && yaPreparada && !enCamino && !entregada && (
            <Button
              variant="outline" className="gap-1.5 text-xs"
              disabled={actualizandoEstado === "shipped"}
              onClick={() => avanzarEstado("shipped")}
            >
              {actualizandoEstado === "shipped" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
              Marcar en camino
            </Button>
          )}
          {canEditEcommerce && !retiro && enCamino && !entregada && (
            <Button
              variant="outline" className="gap-1.5 text-xs"
              disabled={actualizandoEstado === "delivered"}
              onClick={() => avanzarEstado("delivered")}
            >
              {actualizandoEstado === "delivered" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Home className="w-3 h-3" />}
              Marcar entregado
            </Button>
          )}
          <Button variant="ghost" className="text-xs" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
