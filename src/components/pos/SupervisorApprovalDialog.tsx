import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AutorizacionEncargado = { id: string; autorizadoPor: string; maxPct: number };

/** Lee el porcentaje del rechazo de la base: "El descuento de 20.00 % en «X» supera…". */
export function porcentajeDelRechazo(mensaje: string): number | null {
  const match = /El descuento de ([\d.,]+) %/.exec(mensaje);
  if (!match) return null;
  const valor = Number(match[1].replace(",", "."));
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

export const esRechazoPorAutorizacion = (mensaje: string) => mensaje.includes("autorización del encargado");

/**
 * El encargado (dueño/admin) escribe su PIN en esta caja. La base valida el
 * PIN, limita intentos y emite una autorización de 10 minutos para el cajero,
 * con el porcentaje pedido como tope.
 */
export default function SupervisorApprovalDialog({ open, orgId, porcentaje, onClose, onApproved }: {
  open: boolean;
  orgId: string | null | undefined;
  porcentaje: number;
  onClose: () => void;
  onApproved: (autorizacion: AutorizacionEncargado) => void;
}) {
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setPin(""); setError(null); } }, [open]);

  const autorizar = async () => {
    if (!orgId || !/^\d{4,8}$/.test(pin)) return;
    setEnviando(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc("autorizar_descuento_pos" as never, {
      p_org: orgId, p_pin: pin, p_max_pct: Math.ceil(porcentaje * 100) / 100,
    } as never) as { data: { ok?: boolean; motivo?: string; autorizacion_id?: string; autorizado_por?: string; max_descuento_pct?: number } | null; error: { message: string } | null };
    setEnviando(false);
    setPin("");
    if (rpcError) { setError(rpcError.message.replace(/^.*?:\s*/, "")); return; }
    if (!data?.ok || !data.autorizacion_id) { setError(data?.motivo ?? "No se pudo autorizar"); return; }
    onApproved({ id: data.autorizacion_id, autorizadoPor: data.autorizado_por ?? "Encargado", maxPct: Number(data.max_descuento_pct ?? porcentaje) });
  };

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Autorización del encargado</DialogTitle>
        <DialogDescription>El descuento de {porcentaje.toLocaleString("es-AR")} % supera el máximo de la caja. Un dueño o administrador ingresa su PIN para autorizarlo durante 10 minutos.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        <Label htmlFor="supervisor-pin" className="text-xs">PIN del encargado</Label>
        <Input id="supervisor-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8}
          value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={e => { if (e.key === "Enter") void autorizar(); }} />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={enviando || !/^\d{4,8}$/.test(pin)} onClick={() => void autorizar()}>
          {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Autorizar
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
