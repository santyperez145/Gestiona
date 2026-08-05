/**
 * Completar el peso de los productos, de una sola vez.
 *
 * Cierra el círculo del panel de calidad: ese panel dice "59 productos sin
 * peso" y filtra la lista, pero arreglarlo eran 59 diálogos. Es el mismo
 * patrón que "Completar el tarifario" en Envíos, y por la misma razón: un
 * pendiente que cuesta una hora de clics no se hace nunca, aunque cueste plata
 * todos los días.
 *
 * Sin peso, `quote_store_shipping` cotiza con `default_item_weight_kg` (0,5 kg)
 * y `prepare_order_shipment` declara ese mismo 0,5 en la etiqueta. En este
 * catálogo el error va en la dirección de **cobrarle de más al comprador**
 * —los perfumes estiman 0,40—, y el envío caro es de las primeras razones por
 * las que se abandona un carrito.
 *
 * El cálculo vive en `weightEstimate.ts` (16 tests). Acá se muestra el plan
 * antes de aplicarlo y se escribe.
 */
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Scale, Loader2, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  planDePesos, diferenciaContraDefault, type ProductoParaPesar,
} from "@/lib/weightEstimate";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Los productos sobre los que se trabaja: la selección, o lo filtrado. */
  productos: ProductoParaPesar[];
  onDone: () => void;
}

export default function CompletarPesos({ open, onOpenChange, productos, onDone }: Props) {
  const [pisar, setPisar] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const plan = useMemo(
    () => planDePesos(productos, { pisarExistentes: pisar }),
    [productos, pisar],
  );

  const diferencia = useMemo(() => diferenciaContraDefault(plan.aplicar), [plan.aplicar]);

  async function aplicar() {
    if (plan.aplicar.length === 0) return;
    setGuardando(true);
    // Se actualiza de a uno: son decenas de filas, no miles, y así un error en
    // un producto no tira abajo el resto.
    let ok = 0;
    let ultimoError = "";
    for (const p of plan.aplicar) {
      const { error } = await supabase
        .from("products").update({ weight_kg: p.estimado } as never).eq("id", p.id);
      if (error) ultimoError = error.message; else ok++;
    }
    setGuardando(false);

    if (ok === 0) { toast.error("No se pudo actualizar: " + ultimoError); return; }
    if (ok < plan.aplicar.length) {
      toast.warning(`${ok} de ${plan.aplicar.length} actualizados`, { description: ultimoError });
    } else {
      toast.success(`${ok} ${ok === 1 ? "producto actualizado" : "productos actualizados"}`, {
        description: "Pesá una caja real y ajustá el número cuando puedas.",
      });
    }
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Scale className="w-4 h-4 text-primary" /> Completar el peso
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Se estima a partir del contenido en ml y la categoría. Es una estimación
          para que el envío deje de cotizarse con los 0,5 kg por defecto —
          <strong className="text-foreground"> pesá una caja real y corregí el número</strong> cuando
          puedas.
        </p>

        {plan.aplicar.length > 0 && (diferencia.deMas > 0 || diferencia.deMenos > 0) && (
          <div className="bg-yellow-500/8 border border-yellow-500/25 rounded-lg px-3 py-2 space-y-1">
            {diferencia.deMas > 0 && (
              <p className="text-xs text-yellow-500/90 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Si se llevaran todos juntos, hoy se cotizarían{" "}
                  <strong>{diferencia.deMas} kg de más</strong> — el comprador paga un envío
                  más caro del que corresponde, y eso es carrito abandonado.
                </span>
              </p>
            )}
            {diferencia.deMenos > 0 && (
              <p className="text-xs text-yellow-500/90 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Y <strong>{diferencia.deMenos} kg de menos</strong> en el resto: ahí el envío
                  se cobra por debajo de lo que cuesta y la diferencia la pone el comercio.
                </span>
              </p>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={pisar} onChange={e => setPisar(e.target.checked)} />
          Recalcular también los que ya tienen peso cargado
        </label>

        {plan.aplicar.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {plan.sinModelo.length > 0
              ? "No hay ninguno que se pueda estimar. Los de abajo necesitan el peso a mano."
              : "Todos los productos seleccionados ya tienen el peso cargado."}
          </p>
        ) : (
          <div className="border border-border/60 rounded-lg overflow-x-auto">
            <table className="w-full text-xs min-w-[24rem]">
              <thead className="bg-muted/20 border-b border-border/60">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 font-medium text-right">Ahora</th>
                  <th className="px-3 py-2 font-medium text-right">Estimado</th>
                </tr>
              </thead>
              <tbody>
                {plan.aplicar.map(p => (
                  <tr key={p.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-1.5 truncate max-w-[16rem]">{p.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {p.actual > 0 ? `${p.actual} kg` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{p.estimado} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {plan.sinModelo.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">{plan.sinModelo.length}</strong>{" "}
            {plan.sinModelo.length === 1 ? "producto queda afuera" : "productos quedan afuera"}:
            su categoría no tiene modelo de peso o no tienen contenido cargado. Ésos van
            a mano — inventarles un número sería volver al problema con otra cara.
          </p>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button onClick={aplicar} disabled={guardando || plan.aplicar.length === 0}>
            {guardando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
            Aplicar a {plan.aplicar.length} {plan.aplicar.length === 1 ? "producto" : "productos"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
