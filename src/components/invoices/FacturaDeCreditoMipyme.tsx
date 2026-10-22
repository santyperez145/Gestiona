/**
 * La parte de Factura de Crédito Electrónica MiPyME de una factura manual
 * (RG 4367): activarla, el CBU del comercio y la modalidad de transferencia,
 * y preguntarle a ARCA si el cliente está obligado a recibirla (`arca-fce`).
 */
import { useState } from "react";
import { CheckCircle2, Info, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DetalleFiscal } from "@/lib/detalleFiscal";

type Consulta =
  | { estado: "nada" }
  | { estado: "consultando" }
  | { estado: "listo"; obligado: boolean; montoDesde: number | null }
  | { estado: "error"; mensaje: string };

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function FacturaDeCreditoMipyme({ valor, onChange, orgId, cuitCliente, total }: {
  valor: DetalleFiscal;
  onChange: (d: DetalleFiscal) => void;
  orgId: string | null | undefined;
  cuitCliente: string;
  total: number;
}) {
  const [consulta, setConsulta] = useState<Consulta>({ estado: "nada" });
  const cuit = cuitCliente.replace(/\D/g, "");
  const set = <K extends keyof DetalleFiscal>(k: K, v: DetalleFiscal[K]) => onChange({ ...valor, [k]: v });

  const consultar = async () => {
    if (!orgId || cuit.length !== 11) return;
    setConsulta({ estado: "consultando" });
    const { data, error } = await supabase.functions.invoke("arca-fce", { body: { org_id: orgId, cuit } });
    if (error) { setConsulta({ estado: "error", mensaje: "No se pudo consultar a ARCA. Probá de nuevo en unos minutos." }); return; }
    const r = data as { ok?: boolean; obligado?: boolean; monto_desde?: number | null; error?: string };
    if (!r?.ok) { setConsulta({ estado: "error", mensaje: r?.error ?? "ARCA no respondió la consulta." }); return; }
    setConsulta({ estado: "listo", obligado: Boolean(r.obligado), montoDesde: r.monto_desde ?? null });
  };

  const corresponde = consulta.estado === "listo" && consulta.obligado && (consulta.montoDesde === null || total >= consulta.montoDesde);

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={valor.fce} onChange={e => set("fce", e.target.checked)} />
          <span>
            <span className="font-medium">Factura de Crédito Electrónica MiPyME</span>
            <span className="block text-[11px] text-muted-foreground">Obligatoria si le vendés a una empresa grande por encima del monto que fija ARCA. Necesita el vencimiento del pago.</span>
          </span>
        </label>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={!orgId || cuit.length !== 11 || consulta.estado === "consultando"} onClick={() => void consultar()}>
          {consulta.estado === "consultando" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          ¿Está obligado a recibirla?
        </Button>
      </div>

      {consulta.estado === "listo" && (
        <p role="status" className={`flex items-start gap-2 rounded-md p-2 text-xs ${corresponde ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : "bg-muted/40 text-muted-foreground"}`}>
          {corresponde ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {consulta.obligado
            ? `ARCA: este cliente está obligado a recibir FCE${consulta.montoDesde !== null ? ` desde ${ars(consulta.montoDesde)}` : ""}.${corresponde ? " Esta factura tiene que ser FCE." : " Esta factura está por debajo del monto: puede ser común."}`
            : "ARCA: este cliente no está obligado a recibir FCE. Podés emitir una factura común."}
        </p>
      )}
      {consulta.estado === "error" && <p role="alert" className="text-xs text-destructive">{consulta.mensaje}</p>}

      {valor.fce && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <Label htmlFor="fce-cbu" className="text-xs">CBU del comercio</Label>
            <Input id="fce-cbu" inputMode="numeric" className="font-mono" maxLength={26} value={valor.fceCbu} onChange={e => set("fceCbu", e.target.value.replace(/[^\d ]/g, ""))} />
          </div>
          <div>
            <Label htmlFor="fce-alias" className="text-xs">Alias <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id="fce-alias" maxLength={20} value={valor.fceAlias} onChange={e => set("fceAlias", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fce-transferencia" className="text-xs">Transferencia</Label>
            <Select value={valor.fceTransferencia} onValueChange={v => set("fceTransferencia", v as "SCA" | "ADC")}>
              <SelectTrigger id="fce-transferencia"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SCA">Sistema de Circulación Abierta (SCA)</SelectItem>
                <SelectItem value="ADC">Agente de Depósito Colectivo (ADC)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
