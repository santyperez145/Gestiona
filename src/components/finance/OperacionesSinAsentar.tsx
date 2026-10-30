/**
 * Ventas y gastos que todavía no están en el libro (2026-10-30, migraciones
 * 20261030001100 y 1300). `operaciones_sin_asentar` tiene que estar vacía,
 * pero ninguna pantalla la mostraba: un responsable inscripto tenía todas sus
 * ventas del local afuera sin enterarse. Esta tarjeta lo dice arriba del
 * resultado y ofrece asentarlas; lo que no se puede, dice por qué.
 *
 * Las ventas viejas sin alícuota (anteriores a que cada venta la guardara) no
 * se asientan solas: el dueño decide, con su contador, con qué alícuota.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction, isMissingRelation } from "@/lib/publicDataSource";
import { ALICUOTAS_ARCA, sinAlicuotaEn, textoDePendientes, type ResultadoPendientes } from "@/lib/libroPendientes";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function OperacionesSinAsentar({ orgId, onAsentado }: { orgId: string; onAsentado: () => void }) {
  const [cantidad, setCantidad] = useState(0);
  const [asentando, setAsentando] = useState(false);
  const [sinAlicuota, setSinAlicuota] = useState(0);
  const [alicuota, setAlicuota] = useState("21");
  const [usarLaDelProducto, setUsarLaDelProducto] = useState(true);
  const { ask, dialog } = useConfirmDialog();

  const cargar = useCallback(async () => {
    const { count, error } = await supabase.from("operaciones_sin_asentar" as never)
      .select("id", { count: "exact", head: true }).eq("org_id" as never, orgId as never);
    if (error) {
      if (!isMissingRelation(error)) console.error("[libro] operaciones sin asentar", error);
      setCantidad(0);
      return;
    }
    setCantidad(count ?? 0);
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const informar = (data: unknown) => {
    const r = data as ResultadoPendientes | null;
    const { titulo, detalle } = textoDePendientes(r);
    if (Number(r?.fallidas ?? 0) > 0) toast.warning(titulo, { description: detalle, duration: 15000 });
    else toast.success(titulo);
  };

  const asentar = async () => {
    setAsentando(true);
    const { data, error } = await supabase.rpc("ledger_asentar_pendientes" as never, { p_org: orgId } as never);
    setAsentando(false);
    if (error) {
      if (isMissingFunction(error)) { toast.error("Asentar pendientes va a estar disponible cuando se actualice la base de datos."); return; }
      console.error("[libro] asentar pendientes", error);
      toast.error(error.message || "No se pudieron asentar las operaciones");
      return;
    }
    informar(data);
    setSinAlicuota(sinAlicuotaEn(data as ResultadoPendientes));
    await cargar();
    onAsentado();
  };

  const asentarConAlicuota = async () => {
    const ok = await ask({
      title: "Asentar ventas viejas con una alícuota supuesta",
      description: `${sinAlicuota === 1 ? "1 venta" : `${sinAlicuota} ventas`} se asientan con ${usarLaDelProducto ? `la alícuota actual de su producto y, si no tiene, ${alicuota}%` : `${alicuota}%`}. Cada asiento queda marcado como «alícuota supuesta» y la decisión queda en la auditoría. Conviene confirmarlo con tu contador.`,
      confirmText: "Asentarlas",
    });
    if (!ok) return;
    setAsentando(true);
    const { data, error } = await supabase.rpc("ledger_asentar_ventas_sin_alicuota" as never, {
      p_org: orgId, p_alicuota: Number(alicuota), p_usar_la_del_producto: usarLaDelProducto,
    } as never);
    setAsentando(false);
    if (error) {
      console.error("[libro] ventas sin alícuota", error);
      toast.error(error.message || "No se pudieron asentar las ventas viejas");
      return;
    }
    informar(data);
    setSinAlicuota(sinAlicuotaEn(data as ResultadoPendientes));
    await cargar();
    onAsentado();
  };

  if (cantidad === 0) return null;
  return (
    <Card className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
      {dialog}
      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="text-sm flex-1 min-w-0">
        <p className="font-medium">
          {cantidad === 1 ? "1 venta o gasto todavía no está en el libro" : `${cantidad} ventas y gastos todavía no están en el libro`}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          El resultado de abajo no los incluye. Asentarlos los suma con su fecha original; lo que no se pueda, te dice por qué.
        </p>
        <Button size="sm" variant="outline" className="mt-2" disabled={asentando} onClick={() => void asentar()}>
          {asentando && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Asentar ahora
        </Button>

        {sinAlicuota > 0 && (
          <div className="mt-3 border-t border-amber-500/30 pt-3 space-y-2">
            <p className="text-xs">
              {sinAlicuota === 1 ? "1 venta vieja no tiene" : `${sinAlicuota} ventas viejas no tienen`} la alícuota de IVA guardada (son de antes del 1/10/2026).
              No se adivina: decidí con tu contador con qué alícuota asentarlas. Sólo lo puede hacer el dueño.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={alicuota} onValueChange={setAlicuota}>
                <SelectTrigger className="h-8 w-28" aria-label="Alícuota a suponer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALICUOTAS_ARCA.map(a => <SelectItem key={a} value={String(a)}>{String(a).replace(".", ",")}%</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={usarLaDelProducto} onCheckedChange={v => setUsarLaDelProducto(v === true)} />
                Usar la alícuota actual de cada producto cuando la tenga
              </label>
            </div>
            <Button size="sm" variant="outline" disabled={asentando} onClick={() => void asentarConAlicuota()}>
              Asentarlas con alícuota supuesta
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
