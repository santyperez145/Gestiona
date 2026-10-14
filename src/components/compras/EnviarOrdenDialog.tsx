import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import {
  enlaceDeWhatsAppDeOrden, enviarOrdenPorCorreoDB, marcarOrdenEnviadaDB, textoDeOrdenParaWhatsApp, type OrdenParaEnviar,
} from "@/lib/ordenesDeCompra";

/**
 * Enviar la orden de compra al proveedor (2026-10-14). Por correo la arma y la
 * manda el servidor con todos los renglones; por WhatsApp se abre el chat con
 * el detalle. En cualquier caso la orden queda «enviada» con su fecha.
 */
export default function EnviarOrdenDialog({ open, onOpenChange, orgId, orden, proveedor, negocio, onEnviada }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orden: (OrdenParaEnviar & { id: string; status: string; supplier_email: string | null }) | null;
  proveedor: { email?: string | null; phone?: string | null } | null;
  negocio: string;
  onEnviada: () => void;
}) {
  const [correo, setCorreo] = useState("");
  const [enviando, setEnviando] = useState<"correo" | "marcar" | null>(null);
  const [abrioWhatsApp, setAbrioWhatsApp] = useState(false);

  useEffect(() => {
    if (!open || !orden) return;
    setCorreo(orden.supplier_email || proveedor?.email || "");
    setAbrioWhatsApp(false);
  }, [open, orden, proveedor]);

  if (!orden) return null;
  const whatsapp = enlaceDeWhatsAppDeOrden(proveedor?.phone, textoDeOrdenParaWhatsApp(orden, negocio));
  const reenvio = orden.status !== "draft";

  const porCorreo = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) { toast.error("Escribí el correo del proveedor"); return; }
    setEnviando("correo");
    try {
      const r = await enviarOrdenPorCorreoDB(orgId, (orden as { id: string }).id, correo);
      if (r.statusUpdated) toast.success(`Orden ${r.orderNumber} enviada a ${r.to}`);
      else toast.warning(`Orden ${r.orderNumber} enviada a ${r.to}`, { description: "No se pudo marcar como enviada: actualizá la lista." });
      onEnviada();
      onOpenChange(false);
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo enviar la orden"));
    } finally {
      setEnviando(null);
    }
  };

  const marcarEnviada = async () => {
    setEnviando("marcar");
    try {
      await marcarOrdenEnviadaDB(orden.id, orden.status);
      toast.success(`Orden ${orden.order_number} marcada como enviada`);
      onEnviada();
      onOpenChange(false);
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo marcar como enviada"));
    } finally {
      setEnviando(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!enviando) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" />{reenvio ? "Reenviar" : "Enviar"} {orden.order_number}</DialogTitle>
          <DialogDescription>
            A {orden.supplier_name || "el proveedor"}, con {orden.items?.length ?? 0} {orden.items?.length === 1 ? "producto" : "productos"} y el total de la orden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">Correo del proveedor
            <Input type="email" value={correo} onChange={e => setCorreo(e.target.value)} placeholder="ventas@proveedor.com" className="h-9" />
          </label>
          <Button className="w-full" onClick={() => void porCorreo()} disabled={!!enviando}>
            {enviando === "correo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Enviar por correo
          </Button>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          {whatsapp ? (
            <Button variant="outline" className="w-full" asChild>
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => setAbrioWhatsApp(true)}>
                <MessageCircle className="mr-2 h-4 w-4" />Mandar por WhatsApp
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Para mandarla por WhatsApp, cargá el teléfono del proveedor en Proveedores.</p>
          )}
          {abrioWhatsApp && <p className="text-xs text-muted-foreground">¿Ya la mandaste? Marcala como enviada para seguirla.</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={!!enviando}>Cancelar</Button>
          {!reenvio && (
            <Button variant={abrioWhatsApp ? "default" : "outline"} onClick={() => void marcarEnviada()} disabled={!!enviando}>
              {enviando === "marcar" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ya la mandé: marcar enviada
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
