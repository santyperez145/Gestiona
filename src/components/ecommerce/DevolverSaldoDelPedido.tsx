/**
 * Contracargo de un pedido pagado en parte con saldo a favor (2026-10-30,
 * migración 20261030001500). El saldo no vuelve solo porque la disputa se
 * puede ganar: lo decide el dueño o un administrador. La base valida el rol,
 * lo devuelve una sola vez y lo deja en la auditoría.
 */
import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";

interface Props {
  orderId: string;
  saldoAplicado: number;
}

export default function DevolverSaldoDelPedido({ orderId, saldoAplicado }: Props) {
  // Lo ya devuelto de este pedido; null mientras se lee o si no se pudo leer.
  const [devuelto, setDevuelto] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDevuelto(null);
    void supabase.from("saldo_a_favor_movimientos" as never).select("*")
      .eq("ecommerce_order_id" as never, orderId as never)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error("[pedido] no se pudo leer el saldo devuelto", error);
          return;
        }
        const filas = (data ?? []) as Array<{ monto_ars?: unknown }>;
        setDevuelto(filas.reduce((suma, fila) => suma + Math.max(0, Number(fila.monto_ars) || 0), 0));
      });
    return () => { vivo = false; };
  }, [orderId]);

  async function devolver() {
    setEnviando(true);
    const { data, error } = await supabase.rpc("devolver_saldo_del_pedido" as never, { p_order_id: orderId } as never);
    setEnviando(false);
    if (error) {
      toast.error("No se pudo devolver el saldo", { description: error.message });
      return;
    }
    const monto = Number((data as { devuelto?: unknown } | null)?.devuelto ?? 0);
    setDevuelto(monto > 0 ? monto : saldoAplicado);
    toast.success(monto > 0 ? `Le devolviste ${formatARS(monto)} de saldo a favor` : "Ese saldo ya estaba devuelto");
  }

  if (devuelto === null) return null;
  if (devuelto > 0) {
    return <p className="text-xs text-muted-foreground">Le devolviste {formatARS(devuelto)} de saldo a favor al cliente.</p>;
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-xs leading-relaxed">
        El cliente pagó {formatARS(saldoAplicado)} con saldo a favor. Un contracargo no se lo devuelve solo,
        porque la disputa se puede ganar. Si corresponde, devolvéselo.
      </p>
      <Button size="sm" variant="outline" className="min-h-11 gap-1.5" disabled={enviando} onClick={() => void devolver()}>
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
        Devolver {formatARS(saldoAplicado)} de saldo
      </Button>
    </div>
  );
}
