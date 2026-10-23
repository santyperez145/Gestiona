/**
 * Retenciones del comercio agente (2026-10-22): si ARBA o AGIP lo designaron
 * agente de retención de Ingresos Brutos, la orden de pago a un proveedor
 * calcula la retención con el padrón de retenciones y emite el certificado.
 * El padrón se importa filtrando, en el navegador, sólo los CUIT de los
 * proveedores. Ver la migración 20261022001600.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FilePicker from "@/components/shared/FilePicker";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { isMissingColumn, isMissingFunction } from "@/lib/publicDataSource";
import { leerPadronDeArchivo, type Jurisdiccion } from "@/lib/padronIibb";
import { plural } from "@/lib/plural";

interface Datos {
  iibb_agente: boolean; iibb_padron: Jurisdiccion | null; iibb_sin_padron: number | null; iibb_minimo: number;
  proveedores_en_padron: number; padron_hasta: string | null; proveedores_sin_cuit: number;
}

const TANDA = 2000;

export default function RetencionesConfig({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [disponible, setDisponible] = useState(true);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [form, setForm] = useState({ iibb: false, padron: "ARBA" as Jurisdiccion, sinPadron: "", minimo: "0" });
  const [guardando, setGuardando] = useState(false);
  const [importando, setImportando] = useState<{ fraccion: number; etapa: string } | null>(null);

  const leer = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase.rpc("datos_retenciones", { p_org: orgId });
    if (error) { if (isMissingFunction(error)) setDisponible(false); else console.error("datos_retenciones", error); return; }
    const d = data as unknown as Datos;
    setDatos(d);
    setForm({ iibb: d.iibb_agente, padron: d.iibb_padron ?? "ARBA", sinPadron: d.iibb_sin_padron == null ? "" : String(d.iibb_sin_padron), minimo: String(d.iibb_minimo ?? 0) });
  }, [orgId]);

  useEffect(() => { void leer(); }, [leer]);
  if (!disponible) return null;

  const numero = (t: string) => (t.trim() === "" ? null : Number(t.replace(",", ".")));
  const guardar = async () => {
    if (!orgId) return;
    setGuardando(true);
    const { error } = await supabase.rpc("configurar_retenciones", {
      p_org: orgId, p_iibb_agente: form.iibb, p_iibb_padron: form.iibb ? form.padron : null,
      p_iibb_sin_padron: form.iibb ? numero(form.sinPadron) : null, p_iibb_minimo: numero(form.minimo) ?? 0,
    });
    setGuardando(false);
    if (error) { toast.error(error.code === "42501" || error.code === "22023" ? error.message : "No se pudo guardar. Probá de nuevo."); return; }
    toast.success("Retenciones guardadas");
    void leer();
  };

  const importar = async (archivo: File) => {
    if (!orgId) return;
    setImportando({ fraccion: 0, etapa: "Buscando a tus proveedores…" });
    try {
      const { data: proveedores, error } = await supabase.from("suppliers").select("cuit").eq("org_id", orgId).not("cuit", "is", null).limit(20000);
      if (error) throw new Error(isMissingColumn(error) ? "Tus proveedores todavía no tienen CUIT en el sistema: falta una actualización que ya está en camino." : "No se pudieron leer tus proveedores.");
      const cuits = new Set((proveedores ?? []).map(p => String((p as { cuit?: string | null }).cuit ?? "").replace(/\D/g, "")).filter(c => c.length === 11));
      if (cuits.size === 0) { toast.error("Ningún proveedor tiene CUIT cargado: cargalo en su ficha para buscarlo en el padrón."); return; }
      setImportando({ fraccion: 0, etapa: `Leyendo el padrón (${cuits.size} proveedores con CUIT)…` });
      const r = await leerPadronDeArchivo(archivo, cuits, fraccion => setImportando({ fraccion, etapa: "Leyendo el padrón…" }), "R");
      if (!r.formato) { toast.error("El archivo no parece un padrón de ARBA ni de AGIP."); return; }
      if (r.formato === "ARBA" && r.encontrados.size === 0 && r.leidas > 0 && r.invalidas === r.leidas) {
        toast.error("Ese archivo es el padrón de percepciones de ARBA. Para retener se usa el de retenciones (PadronRGSRet…).");
        return;
      }
      if (r.formato !== form.padron && form.iibb) toast.warning(`El archivo es de ${r.formato} y elegiste ${form.padron}. Se carga como ${r.formato}.`);
      const filas = [...r.encontrados.values()].map(x => ({ cuit: x.cuit, alicuota: x.alicuota, vigencia_desde: x.vigenciaDesde, vigencia_hasta: x.vigenciaHasta, baja: x.baja }));
      for (let i = 0; i < filas.length; i += TANDA) {
        setImportando({ fraccion: 1, etapa: `Guardando ${Math.min(i + TANDA, filas.length)} de ${filas.length}…` });
        const { error: e } = await supabase.rpc("cargar_padron_iibb_retencion", { p_org: orgId, p_padron: r.formato, p_filas: filas.slice(i, i + TANDA) });
        if (e) throw new Error(e.code === "42501" ? e.message : "No se pudo guardar el padrón. Probá de nuevo.");
      }
      toast.success(`Padrón de retenciones ${r.formato}: ${filas.length} de tus ${cuits.size} proveedores con CUIT están en el padrón.`);
      void leer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo importar el padrón.");
    } finally {
      setImportando(null);
    }
  };

  return (
    <section aria-labelledby="retenciones-config" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="retenciones-config" className="text-sm font-semibold">Retenciones al pagar (si sos agente)</h3>
      <p className="text-xs text-muted-foreground">
        Si ARBA o AGIP te designaron agente de retención de Ingresos Brutos, la orden de pago calcula la retención de cada proveedor y emite el certificado.
      </p>

      <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void guardar(); }}>
        <div className="grid gap-3 md:grid-cols-4 md:items-end">
          <label className="flex items-center gap-2 text-sm md:pb-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!canEdit || !datos} checked={form.iibb} onChange={e => setForm(f => ({ ...f, iibb: e.target.checked }))} />
            Agente de retención de IIBB
          </label>
          {form.iibb && (
            <>
              <div>
                <Label htmlFor="ret-padron" className="text-xs">Padrón</Label>
                <Select value={form.padron} onValueChange={v => setForm(f => ({ ...f, padron: v as Jurisdiccion }))} disabled={!canEdit}>
                  <SelectTrigger id="ret-padron"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ARBA">ARBA (Buenos Aires)</SelectItem><SelectItem value="AGIP">AGIP (CABA)</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ret-sin" className="text-xs">Alícuota si no está en el padrón <span className="font-normal text-muted-foreground">(vacío: no retener)</span></Label>
                <Input id="ret-sin" inputMode="decimal" disabled={!canEdit} value={form.sinPadron} onChange={e => setForm(f => ({ ...f, sinPadron: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="ret-min" className="text-xs">Base mínima por pago</Label>
                <Input id="ret-min" inputMode="decimal" disabled={!canEdit} value={form.minimo} onChange={e => setForm(f => ({ ...f, minimo: e.target.value }))} />
              </div>
            </>
          )}
        </div>
        {canEdit && <Button type="submit" size="sm" disabled={!datos || guardando}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar retenciones</Button>}
      </form>

      {form.iibb && datos && (
        <div className="mt-4 space-y-2 rounded-lg bg-muted/20 p-3">
          <p className="text-xs">
            {datos.proveedores_en_padron > 0
              ? <>Padrón de retenciones cargado: <strong>{datos.proveedores_en_padron}</strong> proveedores{datos.padron_hasta ? `, vigente hasta el ${fechaFiscalArgentina(datos.padron_hasta)}` : ""}. Cargá el nuevo cada mes.</>
              : "Todavía no cargaste el padrón de retenciones: sin él se aplica la alícuota para quien no está."}
          </p>
          {datos.proveedores_sin_cuit > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {plural(datos.proveedores_sin_cuit, "proveedor activo no tiene", "proveedores activos no tienen")} CUIT: no se les puede retener. <Link to="/proveedores" className="underline underline-offset-2">Cargalo en Proveedores</Link> (al escribirlo, ARCA completa los datos).
            </p>
          )}
          {canEdit && (
            <FilePicker mode="button" accept=".txt,.csv,text/plain" title="Importar el padrón de retenciones del mes" icon={FileUp}
              description="El .txt de retenciones que publica ARBA o AGIP. Sólo se guardan tus proveedores." busy={Boolean(importando)} busyLabel={importando?.etapa ?? "Importando…"}
              onFile={importar} />
          )}
          {importando && (
            <div role="progressbar" aria-label="Avance de la importación del padrón de retenciones" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(importando.fraccion * 100)}
              className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(importando.fraccion * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
