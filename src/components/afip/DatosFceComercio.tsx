/**
 * CBU, alias y modalidad de transferencia que el comercio usa en sus
 * Facturas de Crédito Electrónica MiPyME (2026-10-22). Se cargan una vez y
 * cada FCE los toma; ver la migración 20261022000700.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isMissingFunction } from "@/lib/publicDataSource";
import { cbuValido } from "../../../supabase/functions/_shared/wsfeComprobante";

export default function DatosFceComercio({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [disponible, setDisponible] = useState(true);
  const [cargado, setCargado] = useState(false);
  const [cbu, setCbu] = useState("");
  const [alias, setAlias] = useState("");
  const [transferencia, setTransferencia] = useState<"SCA" | "ADC">("SCA");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    void supabase.rpc("datos_fce", { p_org: orgId }).then(({ data, error }) => {
      if (!vigente) return;
      if (error) { if (isMissingFunction(error)) setDisponible(false); else console.error("datos_fce", error); return; }
      const d = (data ?? {}) as { cbu?: string | null; alias?: string | null; transferencia?: string | null };
      setCbu(d.cbu ?? ""); setAlias(d.alias ?? ""); setTransferencia(d.transferencia === "ADC" ? "ADC" : "SCA");
      setCargado(true);
    });
    return () => { vigente = false; };
  }, [orgId]);

  if (!disponible) return null;
  const cbuMal = cbu.trim() !== "" && !cbuValido(cbu);

  const guardar = async () => {
    if (!orgId || cbuMal) return;
    setGuardando(true);
    const { error } = await supabase.rpc("configurar_fce", { p_org: orgId, p_cbu: cbu.replace(/\D/g, "") || null, p_alias: alias.trim() || null, p_transferencia: transferencia });
    setGuardando(false);
    if (error) { toast.error(error.code === "42501" || error.code === "22023" ? error.message : "No se pudieron guardar los datos. Probá de nuevo."); return; }
    toast.success("Datos de la factura de crédito guardados");
  };

  return (
    <section aria-labelledby="datos-fce" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="datos-fce" className="text-sm font-semibold">Factura de Crédito Electrónica MiPyME</h3>
      <p className="text-xs text-muted-foreground">Si le vendés a empresas grandes, ARCA te pide una FCE con el CBU donde cobrás. Cargalo una vez y cada FCE lo usa.</p>
      <form className="mt-3 grid gap-3 md:grid-cols-[1fr_12rem_16rem_auto] md:items-end" onSubmit={e => { e.preventDefault(); void guardar(); }}>
        <div>
          <Label htmlFor="fce-cbu-comercio" className="text-xs">CBU</Label>
          <Input id="fce-cbu-comercio" inputMode="numeric" className="font-mono" maxLength={26} disabled={!canEdit || !cargado}
            aria-invalid={cbuMal} value={cbu} onChange={e => setCbu(e.target.value.replace(/[^\d ]/g, ""))} />
          {cbuMal && <p role="alert" className="mt-1 text-[11px] text-destructive">El CBU no es válido: revisá los 22 números.</p>}
        </div>
        <div>
          <Label htmlFor="fce-alias-comercio" className="text-xs">Alias <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input id="fce-alias-comercio" maxLength={20} disabled={!canEdit || !cargado} value={alias} onChange={e => setAlias(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="fce-transf-comercio" className="text-xs">Transferencia</Label>
          <Select value={transferencia} onValueChange={v => setTransferencia(v as "SCA" | "ADC")} disabled={!canEdit || !cargado}>
            <SelectTrigger id="fce-transf-comercio"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SCA">Circulación Abierta (SCA)</SelectItem>
              <SelectItem value="ADC">Agente de Depósito Colectivo (ADC)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Button type="submit" disabled={!cargado || cbuMal || guardando}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>
        )}
      </form>
      <p className="mt-2 text-[11px] text-muted-foreground">Para consultar si un cliente está obligado a recibir FCE, asociá tu certificado al servicio «Factura de Crédito Electrónica MiPyMEs» en el Administrador de Relaciones de ARCA.</p>
    </section>
  );
}
