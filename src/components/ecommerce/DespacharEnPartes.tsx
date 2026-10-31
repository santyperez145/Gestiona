/**
 * «Despachar en partes» (2026-10-31), dentro del envío de un pedido: mandar ya
 * lo que hay y el resto (por ejemplo, la preventa) cuando llegue. Cada parte
 * lleva su seguimiento y el comprador recibe un aviso. La base valida y deja
 * el pedido en camino con la última parte; ver `src/lib/despachoEnPartes.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARRIER_IDS, CARRIER_LABELS, carrierLabel } from "@/lib/carriers";
import { hoyAR } from "@/lib/fechaAR";
import {
  cantidadesSugeridas, despacharParteDB, eventoDelAviso, itemsDeLaParte, leerPendienteDB, problemasDeLaParte, textoDeLaParte,
  type ParteDelPedido, type PendienteDeDespacho,
} from "@/lib/despachoEnPartes";

const ESTADO_DE_PARTE: Record<string, string> = {
  pending: "Preparada", assigned: "Preparada", picked_up: "En camino", in_transit: "En camino",
  out_for_delivery: "En reparto", delivered: "Entregada", failed: "Con problemas", returned: "Devuelta",
};

export default function DespacharEnPartes({ orderId, renglones, carrierInicial, partes, puedeDespachar, onDespachada, avisar }: {
  orderId: string;
  /** `ecommerce_orders.items`: de ahí sale qué unidades son de preventa. */
  renglones: unknown[] | undefined;
  carrierInicial: string;
  partes: ParteDelPedido[];
  puedeDespachar: boolean;
  onDespachada: (r: { completo: boolean; parte: number }) => void;
  /** Manda el aviso al comprador; un problema de correo no deshace la parte. */
  avisar: (evento: string) => Promise<void>;
}) {
  const [pendientes, setPendientes] = useState<PendienteDeDespacho[] | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [carrier, setCarrier] = useState(CARRIER_IDS.includes(carrierInicial) ? carrierInicial : "propio");
  const [tracking, setTracking] = useState("");
  const [despachando, setDespachando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await leerPendienteDB(orderId);
      setDisponible(r.disponible);
      setPendientes(r.pendientes);
    } catch (err) {
      console.error("[despacho en partes] no se pudo leer lo pendiente", err);
      setPendientes([]);
    }
  }, [orderId]);
  useEffect(() => { setAbierto(false); void cargar(); }, [cargar]);

  if (!disponible || pendientes === null) return null;
  const quedan = pendientes.filter(p => p.falta > 0);
  if (partes.length === 0 && quedan.length === 0) return null;

  const abrir = () => {
    const sugeridas = cantidadesSugeridas(pendientes, renglones, hoyAR());
    setCantidades(Object.fromEntries(quedan.map(p => [p.linea, String(sugeridas[p.linea] ?? 0)])));
    setTracking("");
    setAbierto(true);
  };
  const problemas = problemasDeLaParte(quedan, cantidades);

  const despachar = async () => {
    if (problemas.length) { toast.error(problemas[0]); return; }
    setDespachando(true);
    try {
      const r = await despacharParteDB(orderId, itemsDeLaParte(cantidades), carrier, tracking);
      toast.success(textoDeLaParte(r));
      await avisar(eventoDelAviso(r));
      setAbierto(false);
      await cargar();
      onDespachada(r);
    } catch (err) {
      const mensaje = (err as { message?: string } | null)?.message ?? "";
      toast.error(mensaje.replace(/^.*?:\s*/, "") || "No se pudo despachar la parte");
    } finally {
      setDespachando(false);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-border/60 p-3 text-sm" aria-labelledby="despacho-en-partes" data-testid="despacho-en-partes">
      <div className="flex items-start gap-2">
        <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 id="despacho-en-partes" className="text-xs font-medium">Despachar en partes</h3>
          <p className="text-[11px] text-muted-foreground">
            Mandá ya lo que tenés y el resto (por ejemplo, la preventa) cuando llegue. Cada parte lleva su seguimiento y el comprador recibe un aviso.
          </p>
        </div>
        {puedeDespachar && !abierto && quedan.length > 0 && (
          <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={abrir}>Despachar una parte</Button>
        )}
      </div>

      {partes.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border/60" data-testid="partes-del-pedido">
          {partes.map(p => (
            <li key={p.id} className="px-2.5 py-2 text-xs">
              <p className="font-medium">
                Parte {p.parte} · {ESTADO_DE_PARTE[p.status] ?? p.status} · {carrierLabel(p.carrier)}
                {p.external_tracking ? <span className="font-mono"> · {p.external_tracking}</span> : null}
              </p>
              <p className="text-muted-foreground">{p.items.map(i => `${i.cantidad} × ${i.nombre}`).join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
      {partes.length > 0 && quedan.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Falta despachar: {quedan.map(p => `${p.falta} × ${p.nombre}`).join(", ")}.
        </p>
      )}

      {abierto && (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3" data-testid="formulario-parte">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Producto</th>
                <th className="py-1 text-right font-medium">Falta</th>
                <th className="py-1 text-right font-medium">Sale ahora</th>
              </tr>
            </thead>
            <tbody>
              {quedan.map(p => (
                <tr key={p.linea}>
                  <td className="py-1 pr-2">{p.nombre}</td>
                  <td className="py-1 text-right tabular-nums">{p.falta}</td>
                  <td className="py-1 pl-2 text-right">
                    <Input value={cantidades[p.linea] ?? ""} inputMode="decimal" aria-label={`Cantidad de ${p.nombre}`}
                      onChange={e => setCantidades(c => ({ ...c, [p.linea]: e.target.value }))} className="ml-auto h-8 w-20 text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Transportista
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger className="mt-1 h-8 text-xs" aria-label="Transportista de la parte"><SelectValue /></SelectTrigger>
                <SelectContent>{CARRIER_IDS.map(id => <SelectItem key={id} value={id}>{CARRIER_LABELS[id]}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs text-muted-foreground">Seguimiento (opcional)
              <Input value={tracking} onChange={e => setTracking(e.target.value)} maxLength={120} aria-label="Seguimiento de la parte"
                placeholder="El que te da el correo" className="mt-1 h-8 font-mono text-xs" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setAbierto(false)} disabled={despachando}>Cancelar</Button>
            <Button size="sm" className="text-xs" onClick={() => void despachar()} disabled={despachando || problemas.length > 0}>
              {despachando && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}Despachar esta parte
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
