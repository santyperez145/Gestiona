/**
 * Ingreso o retiro de efectivo durante el turno (migración 20261011002200):
 * el cambio que se trae de afuera o la plata que se saca para un flete dejan
 * de terminar como «diferencia» al cerrar. Motivo obligatorio; el servidor
 * valida permiso, caja abierta y que el retiro no supere lo que hay.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeSeguroParaCliente } from "@/lib/edgeErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowDownUp } from "lucide-react";

export default function MovimientoDeCaja({ sessionId, onRegistrado }: { sessionId: string; onRegistrado: () => void | Promise<void> }) {
  const [tipo, setTipo] = useState<"manual_in" | "manual_out">("manual_out");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const registrar = async () => {
    const valor = Number(monto);
    if (!(valor > 0)) { toast.error("Ingresá un monto mayor a cero"); return; }
    if (!motivo.trim()) { toast.error("Escribí el motivo del movimiento"); return; }
    setGuardando(true);
    const { error } = await supabase.rpc("pos_cash_movement" as never, {
      p_session_id: sessionId, p_tipo: tipo, p_monto: valor, p_motivo: motivo.trim(),
    } as never);
    setGuardando(false);
    if (error) {
      console.error("[Caja] No se pudo registrar el movimiento:", error);
      toast.error(mensajeSeguroParaCliente(error, "No se pudo registrar el movimiento"));
      return;
    }
    toast.success(tipo === "manual_in" ? "Ingreso registrado" : "Retiro registrado");
    setMonto(""); setMotivo("");
    await onRegistrado();
  };

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><ArrowDownUp className="w-4 h-4 text-primary" />Ingreso o retiro de efectivo</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs" htmlFor="caja-mov-tipo">Tipo</Label>
          <Select value={tipo} onValueChange={v => setTipo(v as "manual_in" | "manual_out")}>
            <SelectTrigger id="caja-mov-tipo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual_out">Retiro (sale plata)</SelectItem>
              <SelectItem value="manual_in">Ingreso (entra plata)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="caja-mov-monto">Monto</Label>
          <Input id="caja-mov-monto" type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs" htmlFor="caja-mov-motivo">Motivo</Label>
          <Input id="caja-mov-motivo" maxLength={300} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: pago de flete, cambio del banco" />
        </div>
      </div>
      <Button type="button" variant="outline" disabled={guardando} onClick={() => void registrar()}>
        {guardando ? "Registrando..." : "Registrar"}
      </Button>
    </div>
  );
}
