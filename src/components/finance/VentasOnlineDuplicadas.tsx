/**
 * Ventas de la tienda contadas dos veces en el libro (2026-10-30, migración
 * 20261030001000). Hasta 20261030000900, en un monotributista cada pedido
 * online pagado quedaba asentado como orden y además por cada venta: Ventas y
 * el margen de esos días salían inflados. Esta tarjeta lo muestra arriba del
 * resultado y le da al dueño la corrección (contraasientos fechados en el
 * original; nada se borra). Sin duplicados, o sin la migración, no aparece.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";
import { formatARS } from "@/lib/supabaseStore";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Duplicadas { cantidad: number; ventas: number; desde: string | null; hasta: string | null }

const fecha = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("es-AR") : "");

export default function VentasOnlineDuplicadas({ orgId, onCorregido }: { orgId: string; onCorregido: () => void }) {
  const [dup, setDup] = useState<Duplicadas | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const { ask, dialog } = useConfirmDialog();

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("ledger_ventas_online_duplicadas" as never, { p_org: orgId } as never);
    if (error) {
      if (!isMissingFunction(error)) console.error("[libro] ventas online duplicadas", error);
      setDup(null);
      return;
    }
    const r = (data ?? {}) as Partial<Duplicadas>;
    setDup({ cantidad: Number(r.cantidad) || 0, ventas: Number(r.ventas) || 0, desde: r.desde ?? null, hasta: r.hasta ?? null });
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const corregir = async () => {
    if (!dup) return;
    const ok = await ask({
      title: "Corregir las ventas contadas dos veces",
      description: `Se anulan ${dup.cantidad === 1 ? "1 asiento" : `${dup.cantidad} asientos`} por ${formatARS(dup.ventas)} con contraasientos fechados el mismo día que cada original, así cada mes queda bien. No se borra nada y queda en la auditoría.`,
      confirmText: "Corregir el libro",
    });
    if (!ok) return;
    setCorrigiendo(true);
    const { data, error } = await supabase.rpc("ledger_corregir_ventas_online_duplicadas" as never, { p_org: orgId } as never);
    setCorrigiendo(false);
    if (error) { console.error("[libro] corregir duplicadas", error); toast.error(error.message || "No se pudo corregir el libro"); return; }
    const r = (data ?? {}) as { corregidos?: number; ventas?: number };
    toast.success(`Libro corregido: ${Number(r.corregidos) || 0} asientos anulados por ${formatARS(Number(r.ventas) || 0)}`);
    await cargar();
    onCorregido();
  };

  if (!dup || dup.cantidad === 0) return null;
  return (
    <Card className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
      {dialog}
      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="text-sm flex-1 min-w-0">
        <p className="font-medium">Hay ventas de la tienda online contadas dos veces</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {dup.cantidad === 1 ? "1 asiento" : `${dup.cantidad} asientos`} de ventas de pedidos online por {formatARS(dup.ventas)}
          {dup.desde ? `, entre el ${fecha(dup.desde)} y el ${fecha(dup.hasta)}` : ""}. Cada pedido ya estaba asentado como orden:
          Ventas y el margen de esos días salen inflados. Desde el 30/10 ya no pasa.
        </p>
        <Button size="sm" variant="outline" className="mt-2" disabled={corrigiendo} onClick={() => void corregir()}>
          {corrigiendo && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Corregir (lo decide el dueño)
        </Button>
      </div>
    </Card>
  );
}
