/**
 * Declarar en AGIP (2026-10-23): los archivos de importación de e-ARCIBA del
 * mes, con las retenciones de las órdenes de pago y las percepciones de las
 * facturas autorizadas (y las notas de crédito que las reducen). Antes de
 * descargar muestra a quién le faltan datos de Ingresos Brutos y deja
 * completarlos ahí mismo. Ver `lib/earciba.ts` y la migración
 * 20261023000100.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hoyAR } from "@/lib/fechaAR";
import { plural } from "@/lib/plural";
import { isMissingColumn, isMissingFunction } from "@/lib/publicDataSource";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import {
  NORMA_REGIMEN_GENERAL, SITUACIONES_IB, archivoEarciba, armarPeriodoEarciba, percepcionesAgip,
  registroEarciba, registroNotaDeCreditoEarciba,
  type FacturaLeida, type FichaIb, type Periodo, type RetencionLeida, type SituacionIb,
} from "@/lib/earciba";

const ACTUALIZACION = "Falta una actualización del sistema que ya está en camino: todavía no se puede armar el archivo.";
const PAGINA = 1000;

type Estado = { etapa: "inicio" } | { etapa: "leyendo" } | { etapa: "listo"; periodo: Periodo; mes: string };

function descargar(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DeclaracionAgip({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [agente, setAgente] = useState<{ retiene: boolean; percibe: boolean; padronPercepcion: string | null } | null>(null);
  const hoy = hoyAR();
  const [mes, setMes] = useState(() => {
    const [a, m] = hoy.split("-").map(Number);
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  });
  const [norma, setNorma] = usePersistedState(orgViewKey("agip.norma", orgId), NORMA_REGIMEN_GENERAL);
  const [estado, setEstado] = useState<Estado>({ etapa: "inicio" });

  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    void Promise.all([
      supabase.rpc("datos_retenciones", { p_org: orgId }),
      supabase.rpc("datos_percepciones", { p_org: orgId }),
    ]).then(([ret, perc]) => {
      if (!vigente) return;
      for (const r of [ret, perc]) if (r.error && !isMissingFunction(r.error)) console.error("Declaración AGIP: no se leyó la configuración", r.error);
      const dr = ret.data as { iibb_agente?: boolean; iibb_padron?: string } | null;
      const dp = perc.data as { iibb_agente?: boolean; iibb_padron?: string } | null;
      setAgente({
        retiene: !!dr?.iibb_agente && dr.iibb_padron === "AGIP",
        percibe: !!dp?.iibb_agente && dp.iibb_padron === "AGIP",
        padronPercepcion: dp?.iibb_padron ?? null,
      });
    });
    return () => { vigente = false; };
  }, [orgId]);

  const revisar = useCallback(async () => {
    if (!orgId || !agente) return;
    const [anio, m] = mes.split("-").map(Number);
    if (!anio || !m) { toast.error("Elegí el mes."); return; }
    const desde = `${mes}-01`;
    const hasta = `${mes}-${String(new Date(Date.UTC(anio, m, 0)).getUTCDate()).padStart(2, "0")}`;
    setEstado({ etapa: "leyendo" });
    try {
      const retenciones: RetencionLeida[] = [];
      if (agente.retiene) {
        const { data, error } = await supabase.from("withholding_records")
          .select("certificado_numero, counterpart_cuit, counterpart_name, date, rate_pct, base_amount, amount, reference_id")
          .eq("org_id", orgId).eq("direction", "applied").eq("withholding_type", "iibb").eq("jurisdiccion", "AGIP")
          .not("certificado_numero", "is", null).gte("date", desde).lte("date", hasta).order("date");
        if (error) throw new Error(isMissingColumn(error) ? ACTUALIZACION : "No se pudieron leer las retenciones del mes.");
        const ids = [...new Set((data ?? []).map(r => r.reference_id).filter(Boolean))] as string[];
        const ordenes = new Map<string, { numero: number; fecha: string; total: number }>();
        if (ids.length) {
          const { data: ops, error: e } = await supabase.from("ordenes_de_pago").select("id, numero, fecha, total").in("id", ids);
          if (e) throw new Error("No se pudieron leer las órdenes de pago del mes.");
          for (const o of ops ?? []) ordenes.set(o.id, { numero: Number(o.numero), fecha: String(o.fecha), total: Number(o.total) });
        }
        for (const r of data ?? []) retenciones.push({
          certificado: Number(r.certificado_numero), cuit: String(r.counterpart_cuit ?? ""), nombre: r.counterpart_name, fecha: String(r.date),
          alicuota: Number(r.rate_pct), base: Number(r.base_amount), importe: Number(r.amount), orden: r.reference_id ? ordenes.get(r.reference_id) ?? null : null,
        });
      }

      const facturas: FacturaLeida[] = [];
      const originales = new Map<string, FacturaLeida>();
      if (agente.percibe) {
        const columnas = "id, issue_date, tipo_comprobante, punto_venta, numero_afip, total, tax_amount, tributos, customer_tax_id, customer_name, condicion_iva_receptor, nota_credito_de";
        const leer = (f: Record<string, unknown>): FacturaLeida => ({
          id: String(f.id), fecha: String(f.issue_date), tipo: Number(f.tipo_comprobante), puntoVenta: Number(f.punto_venta), numero: Number(f.numero_afip),
          total: Number(f.total), iva: Number(f.tax_amount ?? 0), cuit: String(f.customer_tax_id ?? ""), nombre: String(f.customer_name ?? ""),
          condicionReceptor: f.condicion_iva_receptor == null ? null : Number(f.condicion_iva_receptor), notaCreditoDe: (f.nota_credito_de as string | null) ?? null,
          percepciones: percepcionesAgip(f.tributos, agente.padronPercepcion),
        });
        for (let fila = 0; ; fila += PAGINA) {
          const { data, error } = await supabase.from("invoices").select(columnas)
            .eq("org_id", orgId).eq("afip_status", "authorized").gt("importe_tributos", 0)
            .gte("issue_date", desde).lte("issue_date", hasta).order("issue_date").order("id").range(fila, fila + PAGINA - 1);
          if (error) throw new Error(isMissingColumn(error) ? ACTUALIZACION : "No se pudieron leer las facturas del mes.");
          for (const f of data ?? []) { const x = leer(f as unknown as Record<string, unknown>); if (x.percepciones.length) facturas.push(x); }
          if ((data ?? []).length < PAGINA) break;
        }
        const ids = [...new Set(facturas.map(f => f.notaCreditoDe).filter(Boolean))] as string[];
        if (ids.length) {
          const { data, error } = await supabase.from("invoices").select(columnas).in("id", ids);
          if (error) throw new Error("No se pudieron leer las facturas que anulan las notas de crédito.");
          for (const f of data ?? []) { const x = leer(f as unknown as Record<string, unknown>); originales.set(x.id, x); }
        }
      }

      const cuitsProv = [...new Set(retenciones.map(r => r.cuit.replace(/\D/g, "")).filter(c => c.length === 11))];
      const cuitsCli = [...new Set(facturas.map(f => f.cuit.replace(/\D/g, "")).filter(c => c.length === 11))];
      const proveedores: FichaIb[] = [];
      const clientes: FichaIb[] = [];
      if (cuitsProv.length) {
        const { data, error } = await supabase.from("suppliers").select("id, name, cuit, iibb_situacion, iibb_inscripcion, condicion_iva").eq("org_id", orgId).in("cuit", cuitsProv);
        if (error) throw new Error(isMissingColumn(error) ? ACTUALIZACION : "No se pudieron leer los proveedores.");
        for (const p of data ?? []) proveedores.push({ id: p.id, tabla: "suppliers", nombre: p.name, cuit: String(p.cuit), situacionIb: p.iibb_situacion as SituacionIb | null, inscripcionIb: p.iibb_inscripcion, condicionIva: p.condicion_iva });
      }
      if (cuitsCli.length) {
        const { data, error } = await supabase.from("customers").select("id, name, legal_name, tax_id, iibb_situacion, iibb_inscripcion, vat_condition").eq("org_id", orgId).in("tax_id", cuitsCli);
        if (error) throw new Error(isMissingColumn(error) ? ACTUALIZACION : "No se pudieron leer los clientes.");
        for (const c of data ?? []) clientes.push({ id: c.id, tabla: "customers", nombre: c.legal_name || c.name, cuit: String(c.tax_id), situacionIb: c.iibb_situacion as SituacionIb | null, inscripcionIb: c.iibb_inscripcion, condicionIva: c.vat_condition });
      }
      setEstado({ etapa: "listo", mes, periodo: armarPeriodoEarciba({ norma, retenciones, facturas, originales, proveedores, clientes }) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo revisar el mes.");
      setEstado({ etapa: "inicio" });
    }
  }, [orgId, agente, mes, norma]);

  if (!agente || (!agente.retiene && !agente.percibe)) return null;

  const bajar = (p: Periodo, m: string) => {
    try {
      const sufijo = m.replace("-", "");
      if (p.operaciones.length) descargar(`earciba-retenciones-percepciones-${sufijo}.txt`, archivoEarciba(p.operaciones, o => o.fecha, registroEarciba));
      if (p.notas.length) descargar(`earciba-notas-de-credito-${sufijo}.txt`, archivoEarciba(p.notas, n => n.fecha, registroNotaDeCreditoEarciba));
      toast.success("Importalos en e-ARCIBA: «Importar» › retenciones/percepciones y, si hay, notas de crédito.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo armar el archivo.");
    }
  };

  return (
    <section aria-labelledby="declaracion-agip" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="declaracion-agip" className="text-sm font-semibold">Declarar en AGIP (e-ARCIBA)</h3>
      <p className="text-xs text-muted-foreground">
        El archivo de {agente.retiene && agente.percibe ? "retenciones y percepciones" : agente.retiene ? "retenciones" : "percepciones"} del mes para importar en e-ARCIBA,
        con el diseño de AGIP vigente desde enero de 2022. Vence el 7 del mes siguiente.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void revisar(); }}>
        <div>
          <Label htmlFor="agip-mes" className="text-xs">Mes</Label>
          <Input id="agip-mes" type="month" className="w-40" value={mes} max={hoy.slice(0, 7)} onChange={e => { setMes(e.target.value); setEstado({ etapa: "inicio" }); }} />
        </div>
        <div className="w-28">
          <Label htmlFor="agip-norma" className="text-xs">Código de norma</Label>
          <Input id="agip-norma" inputMode="numeric" maxLength={3} value={norma} onChange={e => { setNorma(e.target.value.replace(/\D/g, "").slice(0, 3)); setEstado({ etapa: "inicio" }); }} />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={!orgId || estado.etapa === "leyendo" || !norma}>
          {estado.etapa === "leyendo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Search className="mr-2 h-4 w-4" aria-hidden />}Revisar el mes
        </Button>
      </form>
      <p className="mt-1 text-[11px] text-muted-foreground">029 es el régimen general por padrón (Res. 939/AGIP/2013). Cambialo sólo si tu designación dice otro.</p>

      {estado.etapa === "listo" && <Resultado periodo={estado.periodo} canEdit={canEdit} onCompletado={() => void revisar()} onDescargar={() => bajar(estado.periodo, estado.mes)} />}
    </section>
  );
}

function Resultado({ periodo, canEdit, onCompletado, onDescargar }: { periodo: Periodo; canEdit: boolean; onCompletado: () => void; onDescargar: () => void }) {
  const ret = periodo.operaciones.filter(o => o.tipo === 1).length;
  const perc = periodo.operaciones.length - ret;
  const vacio = !periodo.operaciones.length && !periodo.notas.length && !periodo.incompletos.length;
  return (
    <div role="status" className="mt-3 space-y-3 rounded-lg bg-muted/20 p-3 text-xs">
      {vacio ? <p>No hay retenciones ni percepciones de AGIP en ese mes.</p> : (
        <p>
          {plural(ret, "retención", "retenciones")}, {plural(perc, "percepción", "percepciones")}
          {periodo.notas.length ? ` y ${plural(periodo.notas.length, "nota de crédito", "notas de crédito")}` : ""} listas.
        </p>
      )}
      {periodo.incompletos.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            Completá los datos de Ingresos Brutos de {plural(periodo.incompletos.length, "sujeto", "sujetos")} para que entren en el archivo:
          </p>
          <ul className="space-y-2">
            {periodo.incompletos.map(i => <SujetoIncompleto key={`${i.ficha?.tabla}:${i.cuit}`} item={i} canEdit={canEdit} onGuardado={onCompletado} />)}
          </ul>
        </div>
      )}
      {periodo.omitidos.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{periodo.omitidos.map(o => <li key={o}>{o}</li>)}</ul>
      )}
      {(periodo.operaciones.length > 0 || periodo.notas.length > 0) && (
        <Button type="button" size="sm" disabled={periodo.incompletos.length > 0} onClick={onDescargar}
          title={periodo.incompletos.length ? "Primero completá los datos que faltan" : undefined}>
          <Download className="mr-2 h-4 w-4" aria-hidden />Descargar {periodo.notas.length ? "los archivos" : "el archivo"}
        </Button>
      )}
    </div>
  );
}

function SujetoIncompleto({ item, canEdit, onGuardado }: { item: Periodo["incompletos"][number]; canEdit: boolean; onGuardado: () => void }) {
  const f = item.ficha;
  const [situacion, setSituacion] = useState<string>(f?.situacionIb ? String(f.situacionIb) : "");
  const [inscripcion, setInscripcion] = useState(f?.inscripcionIb ?? "");
  const [iva, setIva] = useState(f?.condicionIva ?? "");
  const [guardando, setGuardando] = useState(false);
  const pideIva = item.motivo.includes("IVA") || f?.tabla === "suppliers";
  const local = situacion === "1";
  const valido = !!situacion && (!local || /^\d{10}$/.test(inscripcion.replace(/\D/g, ""))) && (!pideIva || !!iva);

  const guardar = async () => {
    if (!f || !valido) return;
    setGuardando(true);
    const sit = Number(situacion) as SituacionIb;
    const cambios = {
      iibb_situacion: sit,
      iibb_inscripcion: sit === 1 ? inscripcion.replace(/\D/g, "") : sit === 2 ? f.cuit.replace(/\D/g, "") : null,
    };
    const columnaIva = f.tabla === "suppliers" ? "condicion_iva" : "vat_condition";
    const { error } = f.tabla === "suppliers"
      ? await supabase.from("suppliers").update({ ...cambios, ...(pideIva ? { [columnaIva]: iva } : {}) }).eq("id", f.id)
      : await supabase.from("customers").update({ ...cambios, ...(pideIva ? { [columnaIva]: iva } : {}) }).eq("id", f.id);
    setGuardando(false);
    if (error) { toast.error(isMissingColumn(error) ? ACTUALIZACION : "No se pudo guardar. Probá de nuevo."); return; }
    toast.success(`Datos de ${f.nombre} guardados`);
    onGuardado();
  };

  return (
    <li className="rounded-md border border-border/50 bg-card p-2">
      <p><strong>{item.nombre}</strong> <span className="text-muted-foreground">· CUIT {item.cuit} · {item.motivo}</span></p>
      {!f ? (
        <p className="mt-1 text-muted-foreground">No encontramos su ficha con ese CUIT: cargalo en Clientes o Proveedores y volvé a revisar.</p>
      ) : canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="w-48">
            <Label htmlFor={`sit-${f.id}`} className="text-[11px]">Ingresos Brutos</Label>
            <Select value={situacion} onValueChange={setSituacion}>
              <SelectTrigger id={`sit-${f.id}`} className="h-8"><SelectValue placeholder="Elegí" /></SelectTrigger>
              <SelectContent>{(Object.keys(SITUACIONES_IB) as unknown as SituacionIb[]).map(k => <SelectItem key={k} value={String(k)}>{SITUACIONES_IB[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {local && (
            <div className="w-36">
              <Label htmlFor={`insc-${f.id}`} className="text-[11px]">N.º de inscripción</Label>
              <Input id={`insc-${f.id}`} className="h-8" inputMode="numeric" maxLength={12} value={inscripcion} onChange={e => setInscripcion(e.target.value)} />
            </div>
          )}
          {pideIva && (
            <div className="w-44">
              <Label htmlFor={`iva-${f.id}`} className="text-[11px]">IVA</Label>
              <Select value={iva} onValueChange={setIva}>
                <SelectTrigger id={`iva-${f.id}`} className="h-8"><SelectValue placeholder="Elegí" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="responsable_inscripto">Responsable inscripto</SelectItem>
                  <SelectItem value="monotributo">Monotributo</SelectItem>
                  <SelectItem value="exento">Exento</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button type="button" size="sm" className="h-8" disabled={!valido || guardando} onClick={() => void guardar()}>
            {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}Guardar
          </Button>
        </div>
      )}
    </li>
  );
}
