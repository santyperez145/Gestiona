/**
 * Declarar percepciones en ARBA (2026-10-23): el lote del período con las
 * percepciones de Ingresos Brutos de las facturas autorizadas, para la carga
 * por lote de Agentes de Recaudación (actividad 7, devengado). Ver
 * `lib/lotePercepcionesArba.ts`.
 */
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hoyAR } from "@/lib/fechaAR";
import { plural } from "@/lib/plural";
import { isMissingColumn, isMissingFunction } from "@/lib/publicDataSource";
import { periodoA122R, type Quincena } from "@/lib/loteA122R";
import { nombreLotePercepcionesArba, percepcionesDeJurisdiccion, zipLotePercepcionesArba, type PercepcionArba } from "@/lib/lotePercepcionesArba";

const PAGINA = 1000;

export default function DeclaracionArbaPercepciones({ orgId, cuitAgente }: { orgId: string | null; cuitAgente: string | null }) {
  const [padron, setPadron] = useState<string | null>(null);
  const hoy = hoyAR();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [quincena, setQuincena] = useState<Quincena>(0);
  const [armando, setArmando] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    void supabase.rpc("datos_percepciones", { p_org: orgId }).then(({ data, error }) => {
      if (!vigente) return;
      if (error) { if (!isMissingFunction(error)) console.error("datos_percepciones", error); return; }
      const d = data as { iibb_agente?: boolean; iibb_padron?: string } | null;
      setPadron(d?.iibb_agente ? d.iibb_padron ?? null : null);
    });
    return () => { vigente = false; };
  }, [orgId]);

  if (padron !== "ARBA") return null;

  const descargar = async () => {
    if (!orgId) return;
    const [anio, m] = mes.split("-").map(Number);
    if (!anio || !m) { toast.error("Elegí el mes."); return; }
    setArmando(true);
    try {
      const periodo = periodoA122R(anio, m, quincena);
      const nombre = nombreLotePercepcionesArba(cuitAgente ?? "", periodo.codigo);
      const percepciones: PercepcionArba[] = [];
      for (let fila = 0; ; fila += PAGINA) {
        const { data, error } = await supabase.from("invoices")
          .select("issue_date, tipo_comprobante, punto_venta, numero_afip, customer_tax_id, tributos")
          .eq("org_id", orgId).eq("afip_status", "authorized").gt("importe_tributos", 0)
          .gte("issue_date", periodo.desde).lte("issue_date", periodo.hasta).order("issue_date").order("id").range(fila, fila + PAGINA - 1);
        if (error) throw new Error(isMissingColumn(error) ? "Las percepciones automáticas todavía no están disponibles: falta una actualización que ya está en camino." : "No se pudieron leer las facturas del período. Probá de nuevo.");
        for (const f of data ?? []) {
          for (const p of percepcionesDeJurisdiccion(f.tributos, "ARBA", padron)) {
            percepciones.push({ cuit: String(f.customer_tax_id ?? ""), fecha: String(f.issue_date), tipoArca: Number(f.tipo_comprobante),
              puntoVenta: Number(f.punto_venta), numero: Number(f.numero_afip), ...p });
          }
        }
        if ((data ?? []).length < PAGINA) break;
      }
      if (!percepciones.length) { toast.info("No hay percepciones de ARBA en facturas autorizadas de ese período."); return; }
      const { archivo, zip } = await zipLotePercepcionesArba(nombre, percepciones);
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url; a.download = archivo;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${archivo}: ${plural(percepciones.length, "percepción", "percepciones")}. Subilo en ARBA › Agentes de Recaudación › Carga por lote.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo armar el lote.");
    } finally {
      setArmando(false);
    }
  };

  return (
    <section aria-labelledby="declaracion-arba-percepciones" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="declaracion-arba-percepciones" className="text-sm font-semibold">Declarar percepciones en ARBA</h3>
      <p className="text-xs text-muted-foreground">
        El lote de las percepciones de Ingresos Brutos de tus facturas autorizadas (actividad 7, devengado), con el nombre y el MD5 que pide ARBA.
        Subilo en «Agentes de Recaudación» › «Carga por lote».
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="arba-perc-mes" className="text-xs">Mes</Label>
          <Input id="arba-perc-mes" type="month" className="w-40" value={mes} max={hoy.slice(0, 7)} onChange={e => setMes(e.target.value)} />
        </div>
        <div className="w-40">
          <Label htmlFor="arba-perc-quincena" className="text-xs">Período</Label>
          <Select value={String(quincena)} onValueChange={v => setQuincena(Number(v) as Quincena)}>
            <SelectTrigger id="arba-perc-quincena"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Mes completo</SelectItem>
              <SelectItem value="1">1.ª quincena</SelectItem>
              <SelectItem value="2">2.ª quincena</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!orgId || armando} onClick={() => void descargar()}>
          {armando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}Descargar lote
        </Button>
      </div>
      {!cuitAgente && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Cargá el CUIT del comercio en Datos fiscales: el nombre del lote lo lleva.</p>}
    </section>
  );
}
