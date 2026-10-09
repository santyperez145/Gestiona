import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Rpc = { data: unknown; error: { message: string } | null };
const rpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as unknown as Promise<Rpc>;

/**
 * Descuento manual máximo del cajero y PIN del encargado. Sólo dueños y
 * administradores; la base vuelve a validar el rol en cada RPC.
 */
export default function PosSupervisorSettings({ orgId, canManage }: { orgId: string | null | undefined; canManage: boolean }) {
  const [maxPct, setMaxPct] = useState("");
  const [pin, setPin] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<"max" | "pin" | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    setCargando(true);
    supabase.from("settings").select("pos_descuento_max_pct").eq("org_id", orgId).maybeSingle()
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error) console.error("[ajustes] descuento máximo", error);
        const valor = (data as { pos_descuento_max_pct?: number | null } | null)?.pos_descuento_max_pct;
        setMaxPct(valor === null || valor === undefined ? "" : String(valor));
        setCargando(false);
      });
    return () => { vigente = false; };
  }, [orgId]);

  if (!canManage) return null;

  const guardarMax = async () => {
    if (!orgId) return;
    const valor = maxPct.trim() === "" ? null : Number(maxPct.replace(",", "."));
    if (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > 100)) { toast.error("Ingresá un porcentaje entre 0 y 100"); return; }
    setGuardando("max");
    const { error } = await rpc("configurar_descuento_maximo_pos", { p_org: orgId, p_max_pct: valor });
    setGuardando(null);
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    toast.success(valor === null ? "Sin límite de descuento manual" : `Descuento manual máximo: ${valor} %`);
  };

  const guardarPin = async () => {
    if (!orgId) return;
    setGuardando("pin");
    const { error } = await rpc("definir_pin_supervisor", { p_org: orgId, p_pin: pin });
    setGuardando(null);
    setPin("");
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    toast.success("PIN de encargado guardado");
  };

  return <div id="settings-pos-supervisor" className="settings-panel bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
    <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
      <ShieldCheck className="w-4 h-4 text-primary" />Autorización del encargado en caja
    </h2>
    <p className="text-xs text-muted-foreground">
      Un cajero puede bajar precios hasta este porcentaje sobre el precio vigente. Más descuento requiere que un dueño o administrador ingrese su PIN en la caja; la venta registra quién lo autorizó. Vacío: sin límite.
    </p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="pos-max-discount" className="text-sm text-muted-foreground">Descuento manual máximo (%)</Label>
        <div className="flex gap-2">
          <Input id="pos-max-discount" type="number" min="0" max="100" step="0.5" placeholder="Sin límite" value={maxPct}
            disabled={cargando} onChange={e => setMaxPct(e.target.value)} className="bg-muted border-border" />
          <Button variant="outline" disabled={cargando || guardando !== null} onClick={() => void guardarMax()}>
            {guardando === "max" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pos-supervisor-pin" className="text-sm text-muted-foreground">Mi PIN de encargado (4 a 8 dígitos)</Label>
        <div className="flex gap-2">
          <Input id="pos-supervisor-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ""))} className="bg-muted border-border" />
          <Button variant="outline" disabled={!/^\d{4,8}$/.test(pin) || guardando !== null} onClick={() => void guardarPin()}>
            {guardando === "pin" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar PIN
          </Button>
        </div>
      </div>
    </div>
  </div>;
}
