/**
 * Percepciones del comercio agente (2026-10-22): de qué padrón de Ingresos
 * Brutos (ARBA o AGIP), qué alícuota aplicar a quien no está, la base mínima,
 * y la percepción de IVA. El padrón se importa filtrando, en el navegador,
 * sólo los CUIT de los clientes. Ver la migración 20261022000800.
 */
import { useCallback, useEffect, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FilePicker from "@/components/shared/FilePicker";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { isMissingFunction } from "@/lib/publicDataSource";
import { leerPadronDeArchivo, type Jurisdiccion } from "@/lib/padronIibb";

interface Datos {
  iibb_agente: boolean; iibb_padron: Jurisdiccion | null; iibb_sin_padron: number | null; iibb_minimo: number;
  iva_agente: boolean; iva_alicuota: number | null; clientes_en_padron: number; padron_hasta: string | null;
}

const TANDA = 2000;

export default function PercepcionesConfig({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [disponible, setDisponible] = useState(true);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [form, setForm] = useState({ iibb: false, padron: "ARBA" as Jurisdiccion, sinPadron: "", minimo: "0", iva: false, ivaAlicuota: "" });
  const [guardando, setGuardando] = useState(false);
  const [importando, setImportando] = useState<{ fraccion: number; etapa: string } | null>(null);

  const leer = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase.rpc("datos_percepciones", { p_org: orgId });
    if (error) { if (isMissingFunction(error)) setDisponible(false); else console.error("datos_percepciones", error); return; }
    const d = data as unknown as Datos;
    setDatos(d);
    setForm({
      iibb: d.iibb_agente, padron: d.iibb_padron ?? "ARBA", sinPadron: d.iibb_sin_padron == null ? "" : String(d.iibb_sin_padron),
      minimo: String(d.iibb_minimo ?? 0), iva: d.iva_agente, ivaAlicuota: d.iva_alicuota == null ? "" : String(d.iva_alicuota),
    });
  }, [orgId]);

  useEffect(() => { void leer(); }, [leer]);
  if (!disponible) return null;

  const numero = (t: string) => (t.trim() === "" ? null : Number(t.replace(",", ".")));
  const guardar = async () => {
    if (!orgId) return;
    setGuardando(true);
    const { error } = await supabase.rpc("configurar_percepciones", {
      p_org: orgId, p_iibb_agente: form.iibb, p_iibb_padron: form.iibb ? form.padron : null,
      p_iibb_sin_padron: form.iibb ? numero(form.sinPadron) : null, p_iibb_minimo: numero(form.minimo) ?? 0,
      p_iva_agente: form.iva, p_iva_alicuota: form.iva ? numero(form.ivaAlicuota) : null,
    });
    setGuardando(false);
    if (error) { toast.error(error.code === "42501" || error.code === "22023" ? error.message : "No se pudo guardar. Probá de nuevo."); return; }
    toast.success("Percepciones guardadas");
    void leer();
  };

  const importar = async (archivo: File) => {
    if (!orgId) return;
    setImportando({ fraccion: 0, etapa: "Buscando a tus clientes…" });
    try {
      const { data: clientes, error } = await supabase.from("customers").select("tax_id").eq("org_id", orgId).not("tax_id", "is", null).limit(20000);
      if (error) throw new Error("No se pudieron leer tus clientes.");
      const cuits = new Set((clientes ?? []).map(c => String(c.tax_id ?? "").replace(/\D/g, "")).filter(c => c.length === 11));
      if (cuits.size === 0) { toast.error("Ningún cliente tiene CUIT cargado: no hay a quién buscar en el padrón."); return; }
      setImportando({ fraccion: 0, etapa: `Leyendo el padrón (${cuits.size} clientes con CUIT)…` });
      const r = await leerPadronDeArchivo(archivo, cuits, fraccion => setImportando({ fraccion, etapa: "Leyendo el padrón…" }));
      if (!r.formato) { toast.error("El archivo no parece un padrón de ARBA ni de AGIP."); return; }
      if (r.formato !== form.padron && form.iibb) toast.warning(`El archivo es de ${r.formato} y elegiste ${form.padron}. Se carga como ${r.formato}.`);
      const filas = [...r.encontrados.values()].map(x => ({ cuit: x.cuit, alicuota: x.alicuota, vigencia_desde: x.vigenciaDesde, vigencia_hasta: x.vigenciaHasta, baja: x.baja }));
      for (let i = 0; i < filas.length; i += TANDA) {
        setImportando({ fraccion: 1, etapa: `Guardando ${Math.min(i + TANDA, filas.length)} de ${filas.length}…` });
        const { error: e } = await supabase.rpc("cargar_padron_iibb", { p_org: orgId, p_padron: r.formato, p_filas: filas.slice(i, i + TANDA) });
        if (e) throw new Error(e.code === "42501" ? e.message : "No se pudo guardar el padrón. Probá de nuevo.");
      }
      toast.success(`Padrón ${r.formato}: ${filas.length} de tus ${cuits.size} clientes con CUIT están en el padrón.`);
      void leer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo importar el padrón.");
    } finally {
      setImportando(null);
    }
  };

  return (
    <section aria-labelledby="percepciones" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="percepciones" className="text-sm font-semibold">Percepciones (si sos agente)</h3>
      <p className="text-xs text-muted-foreground">Si ARCA, ARBA o AGIP te designaron agente de percepción, Nerqia calcula la percepción de cada cliente al facturar.</p>

      <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void guardar(); }}>
        <div className="grid gap-3 md:grid-cols-4 md:items-end">
          <label className="flex items-center gap-2 text-sm md:pb-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!canEdit || !datos} checked={form.iibb} onChange={e => setForm(f => ({ ...f, iibb: e.target.checked }))} />
            Agente de Ingresos Brutos
          </label>
          {form.iibb && (
            <>
              <div>
                <Label htmlFor="perc-padron" className="text-xs">Padrón</Label>
                <Select value={form.padron} onValueChange={v => setForm(f => ({ ...f, padron: v as Jurisdiccion }))} disabled={!canEdit}>
                  <SelectTrigger id="perc-padron"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ARBA">ARBA (Buenos Aires)</SelectItem><SelectItem value="AGIP">AGIP (CABA)</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="perc-sin" className="text-xs">Alícuota si no está en el padrón <span className="font-normal text-muted-foreground">(vacío: no percibir)</span></Label>
                <Input id="perc-sin" inputMode="decimal" disabled={!canEdit} value={form.sinPadron} onChange={e => setForm(f => ({ ...f, sinPadron: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="perc-min" className="text-xs">Base mínima</Label>
                <Input id="perc-min" inputMode="decimal" disabled={!canEdit} value={form.minimo} onChange={e => setForm(f => ({ ...f, minimo: e.target.value }))} />
              </div>
            </>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-4 md:items-end">
          <label className="flex items-center gap-2 text-sm md:pb-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!canEdit || !datos} checked={form.iva} onChange={e => setForm(f => ({ ...f, iva: e.target.checked }))} />
            Agente de percepción de IVA
          </label>
          {form.iva && (
            <div>
              <Label htmlFor="perc-iva" className="text-xs">Alícuota de IVA</Label>
              <Input id="perc-iva" inputMode="decimal" disabled={!canEdit} value={form.ivaAlicuota} onChange={e => setForm(f => ({ ...f, ivaAlicuota: e.target.value }))} />
            </div>
          )}
        </div>
        {canEdit && <Button type="submit" size="sm" disabled={!datos || guardando}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar percepciones</Button>}
      </form>

      {form.iibb && datos && (
        <div className="mt-4 space-y-2 rounded-lg bg-muted/20 p-3">
          <p className="text-xs">
            {datos.clientes_en_padron > 0
              ? <>Padrón cargado: <strong>{datos.clientes_en_padron}</strong> clientes{datos.padron_hasta ? `, vigente hasta el ${fechaFiscalArgentina(datos.padron_hasta)}` : ""}. Cargá el nuevo cada mes.</>
              : "Todavía no cargaste el padrón: sin él se aplica la alícuota para quien no está."}
          </p>
          {canEdit && (
            <FilePicker mode="button" accept=".txt,.csv,text/plain" title="Importar el padrón del mes" icon={FileUp}
              description="El .txt que publica ARBA o AGIP. Sólo se guardan tus clientes." busy={Boolean(importando)} busyLabel={importando?.etapa ?? "Importando…"}
              onFile={importar} />
          )}
          {importando && (
            <div role="progressbar" aria-label="Avance de la importación del padrón" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(importando.fraccion * 100)}
              className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(importando.fraccion * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
