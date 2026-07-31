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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CARRIER_LABELS, CARRIER_IDS, carrierLabel } from "@/lib/carriers";
import { Truck, Printer, Loader2, Check, PackageCheck } from "lucide-react";

export interface OrderForShipment {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  total: number | string;
  payment_status: string;
  fulfillment_status: string;
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
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [cargando, setCargando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [guardando, setGuardando] = useState(false);
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
    toast.success("Seguimiento cargado. El comprador ya puede verlo.");
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
    if (!order) return;
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

  const sinPagar = order.payment_status !== "paid";
  const yaPreparada = !!entrega;
  const yaDespachada = !!entrega?.external_tracking;

  return (
    <Dialog open={!!order} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" />
            Envío de {order.order_number}
          </DialogTitle>
        </DialogHeader>

        {cargando ? (
          <div className="py-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin opacity-50" /></div>
        ) : sinPagar ? (
          <p className="text-sm text-muted-foreground py-4">
            Esta orden todavía no está paga. Preparar el envío de algo que no se
            cobró es la forma más cara de equivocarse.
          </p>
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
                <select
                  value={carrier}
                  onChange={e => setCarrier(e.target.value)}
                  className="mt-1 w-full h-9 px-2 text-sm bg-background border border-border rounded-lg"
                >
                  {CARRIER_IDS.map(id => <option key={id} value={id}>{CARRIER_LABELS[id]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Peso (kg, opcional)</label>
                <Input
                  type="number" step="0.1" min="0" value={peso}
                  onChange={e => setPeso(e.target.value)}
                  placeholder="Se estima solo"
                  className="mt-1 h-9"
                  disabled={yaPreparada}
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
                  />
                  <Button size="sm" className="h-9 gap-1.5 text-xs" disabled={guardando || !tracking.trim()} onClick={guardarTracking}>
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
                <PackageCheck className="w-3 h-3" />Despachada
              </Badge>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!sinPagar && !yaPreparada && (
            <Button className="gap-1.5 text-xs" disabled={preparando} onClick={preparar}>
              {preparando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
              Preparar envío
            </Button>
          )}
          {yaPreparada && (
            <Button variant="outline" className="gap-1.5 text-xs" onClick={imprimir}>
              <Printer className="w-3 h-3" />Imprimir etiqueta
            </Button>
          )}
          <Button variant="ghost" className="text-xs" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
