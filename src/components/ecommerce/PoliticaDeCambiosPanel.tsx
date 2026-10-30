/**
 * Política de cambios de la tienda (2026-10-30), migración 20261030000200.
 *
 * El arrepentimiento (10 días) y la garantía (6 meses) los fija la ley; el
 * cambio por otro talle, color o producto es decisión del comercio. Acá elige
 * el plazo: la pantalla de devoluciones de la tienda lo muestra y la base lo
 * hace cumplir. 0 = la tienda no recibe pedidos de cambio online.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Repeat } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingColumn } from "@/lib/publicDataSource";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PoliticaDeCambiosPanel({ storeId }: { storeId: string }) {
  const [disponible, setDisponible] = useState(true);
  const [plazo, setPlazo] = useState("30");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    // Con * hasta que types.ts se regenere con la migración.
    const { data, error } = await supabase.from("ecommerce_stores").select("*").eq("id", storeId).maybeSingle();
    if (error) {
      if (isMissingColumn(error)) { setDisponible(false); return; }
      console.error("[Cambios] tienda", error);
      toast.error("No se pudo leer la política de cambios");
      return;
    }
    const t = data as unknown as { plazo_cambio_dias?: number } | null;
    // Sin la migración la fila no trae la columna: el panel no se muestra.
    if (t && t.plazo_cambio_dias === undefined) { setDisponible(false); return; }
    if (t) setPlazo(String(t.plazo_cambio_dias ?? 30));
  }, [storeId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async () => {
    const dias = Number(plazo);
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) { toast.error("El plazo va de 0 a 365 días"); return; }
    setGuardando(true);
    const { error } = await supabase.from("ecommerce_stores").update({ plazo_cambio_dias: dias } as never).eq("id", storeId);
    setGuardando(false);
    if (error) { console.error("[Cambios] guardar", error); toast.error("No se pudo guardar la política de cambios"); return; }
    toast.success(dias === 0 ? "La tienda ya no recibe cambios online" : `Cambios dentro de los ${dias} días`);
    await cargar();
  };

  if (!disponible) return null;
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><Repeat className="w-4 h-4 text-primary" />Cambios y saldo a favor</h3>
      <p className="text-sm text-muted-foreground">
        Tus compradores piden el cambio desde la tienda o desde Mi cuenta. Si lo resolvés con crédito en tienda, el monto queda
        como saldo a favor del cliente y lo usa al pagar online o en el local.
      </p>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <Label htmlFor="plazo-cambio">Plazo para pedir un cambio (días)</Label>
          <Input id="plazo-cambio" type="number" min={0} max={365} className="w-32" value={plazo} onChange={e => setPlazo(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </div>
        <Button onClick={() => void guardar()} disabled={guardando}>
          {guardando && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Guardar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">0 = no recibís cambios online. El arrepentimiento (10 días) y la garantía (6 meses) siguen siempre disponibles: los fija la ley.</p>
    </div>
  );
}
