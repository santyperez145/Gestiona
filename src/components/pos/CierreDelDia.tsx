/**
 * Cierre del día (2026-10-23): informes X y Z, con factura electrónica o con
 * controlador fiscal, y los cierres guardados para el contador.
 *
 *   · Electrónico: el X muestra lo autorizado del día por tipo; el Z lo cierra
 *     numerado (`cerrar_dia_electronico`, que sólo acepta lo que coincide con
 *     ARCA).
 *   · Controlador: el X es el cierre de cajero (0802); el Z lee los totales
 *     de la jornada, emite el 0801 y lo registra en borrador hasta confirmarlo
 *     contra el ticket impreso. Si el equipo emitió el Z y no se pudo
 *     registrar, queda en este dispositivo para reintentar: no se repite.
 *   · Cualquier equipo (Hasar incluido): el Z se carga a mano desde el ticket.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, FileText, Loader2, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { hoyAR } from "@/lib/fechaAR";
import { isMissingColumn, isMissingRelation } from "@/lib/publicDataSource";
import { controlesZ, informeDiarioElectronico, NOMBRE_TIPO_Z, ORIGEN_ELECTRONICO, totalesZ, type CierreZ, type ComprobanteZ } from "@/lib/cierreZ";
import type { ComprobanteVenta } from "@/lib/libroIvaVentas";
import { enviarLoteEpson, leerConfigControlador } from "@/lib/fiscalPrinter/transport";
import { mensajeRetornoEpson, type EpsonResponse } from "@/lib/fiscalPrinter/epson";
import { CIERRE_Z, INFORME_X, interpretarLecturaJornada, loteLecturaJornada, numeroDeZ, TIPOS_JORNADA, type LecturaJornada } from "@/lib/fiscalPrinter/jornadaEpson";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CargaManualZ from "@/components/pos/CargaManualZ";

const NOMBRE_ARCA: Record<number, string> = {
  1: "Factura A", 2: "Nota de Débito A", 3: "Nota de Crédito A", 6: "Factura B", 7: "Nota de Débito B", 8: "Nota de Crédito B",
  11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C", 19: "Factura E", 20: "Nota de Débito E", 21: "Nota de Crédito E",
  51: "Factura M", 201: "FCE A", 206: "FCE B", 211: "FCE C",
};
const nombreTipo = (t: number) => NOMBRE_TIPO_Z[t] ?? NOMBRE_ARCA[t] ?? `Tipo ${t}`;

type ZPendiente = { numero: number; fecha: string; puntoVenta: number; comprobantes: ComprobanteZ[]; registro: string | null };
const clavePendiente = (orgId: string) => `nerqia.cierreZPendiente.${orgId}`;
function leerPendiente(orgId: string): ZPendiente | null {
  try { return JSON.parse(localStorage.getItem(clavePendiente(orgId)) || "null"); } catch { return null; }
}
function guardarPendiente(orgId: string, z: ZPendiente | null) {
  try {
    if (z) localStorage.setItem(clavePendiente(orgId), JSON.stringify(z));
    else localStorage.removeItem(clavePendiente(orgId));
  } catch { /* sin almacenamiento: se muestra el error al usuario */ }
}

function TablaComprobantes({ comprobantes }: { comprobantes: ComprobanteZ[] }) {
  if (comprobantes.length === 0) return <p className="text-xs text-muted-foreground">Sin comprobantes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Comprobante</th><th className="py-1 pr-3 font-medium">Desde – hasta</th>
            <th className="py-1 pr-3 text-right font-medium">Cant.</th><th className="py-1 pr-3 text-right font-medium">IVA</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {comprobantes.map(c => (
            <tr key={c.tipo} className="border-t border-border/40">
              <td className="py-1 pr-3">{nombreTipo(c.tipo)}</td>
              <td className="py-1 pr-3 font-mono">{c.desde} – {c.hasta}</td>
              <td className="py-1 pr-3 text-right">{c.cantidad}</td>
              <td className="py-1 pr-3 text-right font-mono">{formatARS(c.alicuotas.reduce((s, a) => s + Number(a.iva), 0))}</td>
              <td className="py-1 text-right font-mono">{formatARS(Number(c.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function imprimirInforme(titulo: string, subtitulo: string, comprobantes: ComprobanteZ[]) {
  const { total, iva } = totalesZ(comprobantes);
  const filas = comprobantes.map(c => `<tr><td>${nombreTipo(c.tipo)}</td><td>${c.desde} – ${c.hasta}</td><td style="text-align:right">${c.cantidad}</td>
    <td style="text-align:right">${c.alicuotas.map(a => `${a.tasa}%: ${formatARS(Number(a.neto))} + ${formatARS(Number(a.iva))}`).join("<br>") || "—"}</td>
    <td style="text-align:right">${formatARS(Number(c.total))}</td></tr>`).join("");
  const w = window.open("", "_blank");
  if (!w) { toast.error("Permití las ventanas emergentes para imprimir"); return; }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111;font-size:12px}h1{font-size:18px;margin:0}p{color:#555;margin:2px 0 14px}
table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}
th{background:#f3f4f6;font-size:10px;text-transform:uppercase}.tot{margin-top:14px;font-size:14px;font-weight:700}</style></head><body>
<h1>${titulo}</h1><p>${subtitulo}</p><table><thead><tr><th>Comprobante</th><th>Numeración</th><th style="text-align:right">Cant.</th><th style="text-align:right">Neto + IVA por alícuota</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${filas || "<tr><td colspan=5>Sin comprobantes</td></tr>"}</tbody></table>
<p class="tot">Total ${formatARS(total)} · IVA ${formatARS(iva)}</p><p style="font-size:10px">Generado por Nerqia · ${new Date().toLocaleString("es-AR")}</p></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

export default function CierreDelDia({ orgId }: { orgId: string }) {
  const { ask, dialog } = useConfirmDialog();
  const [conexion, setConexion] = useState<{ punto_venta: number | null; environment: string | null } | null>(null);
  const [cierres, setCierres] = useState<(CierreZ & { id: string; observaciones?: { nivel: string; texto: string }[] })[] | null>(null);
  const [sinMigracion, setSinMigracion] = useState(false);
  const [fecha, setFecha] = useState(() => hoyAR());
  const [informe, setInforme] = useState<{ comprobantes: ComprobanteZ[]; problemas: string[] } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lectura, setLectura] = useState<LecturaJornada | null>(null);
  const [pendiente, setPendiente] = useState<ZPendiente | null>(() => leerPendiente(orgId));
  const [manualAbierto, setManualAbierto] = useState(false);
  const controlador = useMemo(() => leerConfigControlador(orgId), [orgId]);

  const cargar = useCallback(async () => {
    const [con, lista] = await Promise.all([
      supabase.from("afip_connection_status").select("punto_venta, environment").eq("org_id", orgId).maybeSingle(),
      supabase.from("cierres_z" as never).select("id, origen, punto_venta, numero, fecha, estado, equipo, comprobantes, total, iva, observaciones")
        .eq("org_id", orgId).order("fecha", { ascending: false }).order("numero", { ascending: false }).limit(20),
    ]);
    if (!con.error) setConexion((con.data as { punto_venta: number | null; environment: string | null } | null) ?? null);
    if (lista.error) {
      if (isMissingRelation(lista.error)) { setSinMigracion(true); setCierres([]); return; }
      console.error("[Cierre del día] no se pudieron leer los cierres", lista.error);
      toast.error("No se pudieron leer los cierres guardados");
      setCierres(null);
      return;
    }
    setCierres((lista.data ?? []) as unknown as NonNullable<typeof cierres>);
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  // ── Electrónico ───────────────────────────────────────────────────────
  const pvElectronico = conexion?.punto_venta ?? null;
  const leerDelDia = async (): Promise<{ comprobantes: ComprobanteZ[]; problemas: string[] } | null> => {
    if (!pvElectronico) { toast.error("Configurá el punto de venta de ARCA para cerrar el día"); return null; }
    const comunes = "id, number, issue_date, tipo_comprobante, punto_venta, numero_afip, customer_tax_id, customer_name, subtotal, tax_amount, tax_pct, total, afip_environment, currency, moneda_cotizacion, due_date";
    let columnas = `${comunes}, concepto, importe_no_gravado, importe_exento, importe_tributos, tributos, invoice_items(total, tax_rate, tax_amount, tratamiento)`;
    const consultar = () => supabase.from("invoices").select(columnas).eq("org_id", orgId).eq("punto_venta", pvElectronico)
      .eq("afip_status", "authorized").not("cae", "is", null).eq("issue_date", fecha).order("numero_afip").range(0, 4999);
    let r = await consultar();
    if (r.error && isMissingColumn(r.error)) { columnas = `${comunes}, invoice_items(total, tax_rate, tax_amount)`; r = await consultar(); }
    if (r.error) { console.error("[Cierre del día] facturas", r.error); toast.error("No se pudieron leer las facturas del día"); return null; }
    const filas = ((r.data ?? []) as unknown as (ComprobanteVenta & { afip_environment: string | null })[])
      .filter(f => f.afip_environment !== "homologacion");
    return informeDiarioElectronico(filas);
  };

  const informeX = async () => {
    setOcupado("x-electronico");
    try { setInforme(await leerDelDia()); } finally { setOcupado(null); }
  };

  const cerrarDia = async () => {
    setOcupado("z-electronico");
    try {
      const dia = await leerDelDia();
      if (!dia) return;
      setInforme(dia);
      if (dia.problemas.length) { toast.error("Hay comprobantes que no se pueden desglosar: revisalos antes de cerrar"); return; }
      const { total } = totalesZ(dia.comprobantes);
      if (!(await ask({
        title: `¿Cerrar el ${fecha.split("-").reverse().join("/")}?`,
        description: `Punto de venta ${pvElectronico}: ${dia.comprobantes.reduce((s, c) => s + c.cantidad, 0)} comprobantes por ${formatARS(total)}. El cierre queda numerado y no se edita.`,
        confirmText: "Cerrar el día",
      }))) return;
      const { data, error } = await supabase.rpc("cerrar_dia_electronico" as never, {
        p_org: orgId, p_punto_venta: pvElectronico, p_fecha: fecha, p_comprobantes: dia.comprobantes,
      } as never);
      if (error) throw error;
      toast.success(`Día cerrado: cierre N° ${(data as { numero?: number } | null)?.numero ?? ""}`);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cerrar el día");
    } finally { setOcupado(null); }
  };

  // ── Controlador ───────────────────────────────────────────────────────
  const informeXControlador = async () => {
    if (!controlador) return;
    setOcupado("x-controlador");
    try {
      const [r] = (await enviarLoteEpson(controlador, [INFORME_X], 60_000) as unknown[]).flat() as EpsonResponse[];
      if (r?.["return code"] !== "0000") throw new Error(mensajeRetornoEpson(String(r?.["return code"] ?? "")));
      toast.success(`Informe X N° ${Number(r.fields?.[0] ?? 0) || ""} impreso`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "El controlador no respondió");
    } finally { setOcupado(null); }
  };

  const leerJornada = async () => {
    if (!controlador?.puntoVenta) { toast.error("Cargá el punto de venta del controlador en su configuración"); return; }
    setOcupado("leer");
    try {
      // El último número de cada tipo en el Z anterior confirmado: desde = hasta + 1.
      const previo = (cierres ?? []).filter(z => z.origen !== ORIGEN_ELECTRONICO && z.punto_venta === controlador.puntoVenta && z.estado === "confirmado")
        .sort((a, b) => b.numero - a.numero)[0];
      const previoHasta: Record<number, number> = {};
      for (const c of previo?.comprobantes ?? []) previoHasta[c.tipo] = c.hasta;
      const respuestas = await enviarLoteEpson(controlador, loteLecturaJornada(), 60_000);
      setLectura(interpretarLecturaJornada(respuestas, TIPOS_JORNADA, previoHasta));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "El controlador no respondió");
    } finally { setOcupado(null); }
  };

  const registrarZ = async (z: ZPendiente) => {
    const { data, error } = await supabase.rpc("registrar_cierre_z" as never, {
      p_org: orgId, p_origen: "controlador", p_punto_venta: z.puntoVenta, p_numero: z.numero, p_fecha: z.fecha,
      p_equipo: { marca: "Epson", modelo: "TM-T900FA", registro: z.registro }, p_comprobantes: z.comprobantes, p_confirmar: false,
    } as never);
    if (error) throw error;
    guardarPendiente(orgId, null);
    setPendiente(null);
    return data as { observaciones?: { nivel: string; texto: string }[] };
  };

  const emitirZ = async () => {
    if (!controlador?.puntoVenta || !lectura) return;
    if (!(await ask({
      title: "¿Emitir el cierre Z?",
      description: "Cierra la jornada fiscal del controlador: después del Z no se pueden emitir más tiques con fecha de hoy. No se puede deshacer.",
      confirmText: "Emitir el Z", variant: "destructive",
    }))) return;
    setOcupado("z-controlador");
    try {
      const respuestas = await enviarLoteEpson(controlador, [CIERRE_Z], 120_000);
      const numero = numeroDeZ(respuestas);
      if (!numero) {
        const [r] = (Array.isArray(respuestas) ? respuestas.flat() : []) as EpsonResponse[];
        throw new Error(r?.["return code"] ? mensajeRetornoEpson(String(r["return code"])) : "El controlador no confirmó el Z");
      }
      const z: ZPendiente = { numero, fecha: hoyAR(), puntoVenta: controlador.puntoVenta, comprobantes: lectura.comprobantes, registro: controlador.registro ?? null };
      // Antes de registrar: si se corta acá, el Z impreso no se pierde.
      guardarPendiente(orgId, z);
      setPendiente(z);
      try {
        await registrarZ(z);
        toast.success(`Z N° ${numero} emitido. Confirmalo contra el ticket impreso.`);
      } catch (e) {
        toast.error(`El controlador emitió el Z ${numero}, pero no se pudo guardar: ${e instanceof Error ? e.message : "reintentá"}. Quedó en este equipo para reintentar.`);
      }
      setLectura(null);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo emitir el Z");
    } finally { setOcupado(null); }
  };

  const reintentarPendiente = async () => {
    if (!pendiente) return;
    setOcupado("pendiente");
    try { await registrarZ(pendiente); toast.success(`Z N° ${pendiente.numero} guardado`); await cargar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo guardar el Z"); }
    finally { setOcupado(null); }
  };

  const confirmar = async (z: CierreZ & { id: string }) => {
    if (!(await ask({
      title: `¿Confirmar el Z N° ${z.numero}?`,
      description: "Revisá que los totales coincidan con el ticket impreso. Confirmado entra al Libro IVA y no se puede modificar.",
      confirmText: "Confirmar",
    }))) return;
    const { error } = await supabase.rpc("confirmar_cierre_z" as never, { p_id: z.id } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(`Z N° ${z.numero} confirmado`);
    await cargar();
  };
  const descartar = async (z: CierreZ & { id: string }) => {
    if (!(await ask({ title: `¿Descartar el borrador del Z N° ${z.numero}?`, description: "Podés volver a cargarlo a mano desde el ticket.", confirmText: "Descartar", variant: "destructive" }))) return;
    const { error } = await supabase.rpc("descartar_cierre_z" as never, { p_id: z.id } as never);
    if (error) { toast.error(error.message); return; }
    await cargar();
  };

  if (sinMigracion) {
    return (
      <div className="bg-card border border-border/60 rounded-[10px] p-5 text-sm text-muted-foreground">
        Los cierres X y Z van a estar disponibles cuando se actualice tu cuenta.
      </div>
    );
  }

  const controlesLectura = lectura ? controlesZ(lectura.comprobantes) : [];

  return (
    <section className="bg-card border border-border/60 rounded-[10px] p-5 space-y-5" aria-labelledby="cierre-dia-titulo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cierre-dia-titulo" className="font-semibold flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-primary" />Cierre del día: informes X y Z</h2>
        <Button variant="ghost" size="sm" onClick={() => void cargar()} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Actualizar</Button>
      </div>

      {pendiente && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          El controlador emitió el Z N° {pendiente.numero} y todavía no se guardó.
          <Button size="sm" onClick={() => void reintentarPendiente()} disabled={ocupado !== null}>Guardarlo ahora</Button>
        </div>
      )}

      {/* Factura electrónica */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Factura electrónica {pvElectronico ? <span className="text-xs font-normal text-muted-foreground">· punto de venta {pvElectronico}</span> : null}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="cierre-fecha" className="text-xs">Día</Label>
            <Input id="cierre-fecha" type="date" value={fecha} max={hoyAR()} onChange={e => { setFecha(e.target.value); setInforme(null); }} className="h-9 w-40" />
          </div>
          <Button variant="outline" size="sm" onClick={() => void informeX()} disabled={ocupado !== null || !pvElectronico} className="gap-1.5">
            {ocupado === "x-electronico" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}Informe X del día
          </Button>
          <Button size="sm" onClick={() => void cerrarDia()} disabled={ocupado !== null || !pvElectronico} className="gap-1.5">
            {ocupado === "z-electronico" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5" />}Cerrar el día (Z)
          </Button>
        </div>
        {!pvElectronico && <p className="text-xs text-muted-foreground">Configurá ARCA (Facturas › ARCA) para usar el cierre electrónico.</p>}
        {informe && (
          <div className="rounded-md border border-border/60 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Informe X · {fecha.split("-").reverse().join("/")} · {formatARS(totalesZ(informe.comprobantes).total)}</p>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                onClick={() => imprimirInforme("Informe X", `${fecha.split("-").reverse().join("/")} · Punto de venta ${pvElectronico}`, informe.comprobantes)}>
                <Printer className="w-3 h-3" />Imprimir
              </Button>
            </div>
            <TablaComprobantes comprobantes={informe.comprobantes} />
            {informe.problemas.length > 0 && (
              <ul role="alert" className="list-disc pl-4 text-xs text-destructive">{informe.problemas.slice(0, 5).map(p => <li key={p}>{p}</li>)}</ul>
            )}
          </div>
        )}
      </div>

      {/* Controlador fiscal */}
      <div className="space-y-3 border-t border-border/40 pt-4">
        <p className="text-sm font-medium">Controlador fiscal {controlador?.puntoVenta ? <span className="text-xs font-normal text-muted-foreground">· punto de venta {controlador.puntoVenta}</span> : null}</p>
        {controlador ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void informeXControlador()} disabled={ocupado !== null} className="gap-1.5">
              {ocupado === "x-controlador" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}Informe X (cierre de cajero)
            </Button>
            <Button size="sm" onClick={() => void leerJornada()} disabled={ocupado !== null || !controlador.puntoVenta} className="gap-1.5">
              {ocupado === "leer" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5" />}Preparar el cierre Z
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No hay un controlador configurado en esta caja (Caja › Controlador fiscal). Si usás otro equipo, cargá el Z a mano.</p>
        )}
        {controlador && !controlador.puntoVenta && <p className="text-xs text-amber-700 dark:text-amber-400">Cargá el punto de venta del controlador en su configuración para hacer el Z.</p>}
        {lectura && (
          <div className="rounded-md border border-border/60 p-3 space-y-2">
            <p className="text-xs font-medium">Jornada leída del controlador{lectura.ultimoZ ? ` · último Z: ${lectura.ultimoZ}` : ""}</p>
            <TablaComprobantes comprobantes={lectura.comprobantes} />
            {[...lectura.problemas, ...controlesLectura.filter(c => c.nivel === "error").map(c => c.texto)].length > 0 && (
              <ul role="alert" className="list-disc pl-4 text-xs text-destructive">
                {[...lectura.problemas, ...controlesLectura.filter(c => c.nivel === "error").map(c => c.texto)].map(p => <li key={p}>{p}</li>)}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">El Z queda en borrador: después confirmalo contra el ticket impreso.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => void emitirZ()} disabled={ocupado !== null}>
                {ocupado === "z-controlador" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Emitir el Z en el controlador
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLectura(null)}>Cancelar</Button>
            </div>
          </div>
        )}
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setManualAbierto(true)}>Cargar un Z a mano (cualquier controlador)</Button>
      </div>

      {/* Cierres guardados */}
      <div className="space-y-2 border-t border-border/40 pt-4">
        <p className="text-sm font-medium">Cierres guardados</p>
        {cierres === null ? (
          <p className="text-xs text-muted-foreground">No se pudieron leer.</p>
        ) : cierres.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no hay cierres.</p>
        ) : (
          <ul className="divide-y divide-border/40 text-xs">
            {cierres.map(z => (
              <li key={z.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="font-mono">{z.fecha.split("-").reverse().join("/")}</span>
                <span>{z.origen === ORIGEN_ELECTRONICO ? "Cierre diario" : "Z"} N° {z.numero}</span>
                <span className="text-muted-foreground">PV {z.punto_venta}{z.origen === "manual" ? " · cargado a mano" : ""}</span>
                <span className="font-mono">{formatARS(Number(z.total ?? 0))}</span>
                <span className="text-muted-foreground">IVA {formatARS(Number(z.iva ?? 0))}</span>
                {z.estado === "confirmado" ? (
                  <span className="text-green-600 dark:text-green-400">confirmado</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-amber-700 dark:text-amber-400">borrador</span>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void confirmar(z)}>Confirmar</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void descartar(z)}>Descartar</Button>
                  </span>
                )}
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" aria-label={`Imprimir el cierre ${z.numero}`}
                  onClick={() => imprimirInforme(`${z.origen === ORIGEN_ELECTRONICO ? "Cierre diario" : "Cierre Z"} N° ${z.numero}`, `${z.fecha.split("-").reverse().join("/")} · Punto de venta ${z.punto_venta}`, z.comprobantes)}>
                  <Printer className="w-3 h-3" />
                </Button>
                {(z.observaciones ?? []).filter(o => o.nivel === "aviso").map(o => (
                  <span key={o.texto} className="basis-full text-[11px] text-amber-700 dark:text-amber-400">{o.texto}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CargaManualZ open={manualAbierto} orgId={orgId} puntoVentaSugerido={controlador?.puntoVenta ?? null}
        onClose={() => setManualAbierto(false)} onGuardado={() => { setManualAbierto(false); void cargar(); }} />
      {dialog}
    </section>
  );
}

