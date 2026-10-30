/**
 * Ventas y gastos que todavía no están en el libro (2026-10-30, migración
 * 20261030001100). `operaciones_sin_asentar` tiene que estar vacía, pero
 * ninguna pantalla la mostraba: un responsable inscripto tenía todas sus
 * ventas del local afuera sin enterarse. Esta tarjeta lo dice arriba del
 * resultado y ofrece asentarlas; lo que no se puede, dice por qué.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction, isMissingRelation } from "@/lib/publicDataSource";
import { textoDePendientes, type ResultadoPendientes } from "@/lib/libroPendientes";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function OperacionesSinAsentar({ orgId, onAsentado }: { orgId: string; onAsentado: () => void }) {
  const [cantidad, setCantidad] = useState(0);
  const [asentando, setAsentando] = useState(false);

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
    const { titulo, detalle } = textoDePendientes(data as ResultadoPendientes);
    if (Number((data as ResultadoPendientes | null)?.fallidas ?? 0) > 0) toast.warning(titulo, { description: detalle, duration: 15000 });
    else toast.success(titulo);
    await cargar();
    onAsentado();
  };

  if (cantidad === 0) return null;
  return (
    <Card className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
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
      </div>
    </Card>
  );
}
