/**
 * Libro IVA Digital de ventas del mes, listo para importar en ARCA
 * (2026-10-21). Ver `lib/libroIvaVentas.ts` para el formato.
 *
 * Lee sólo comprobantes con CAE de producción: uno de homologación no tiene
 * validez fiscal y uno sin CAE no existe para ARCA. Lo que no se puede
 * desglosar se muestra con el motivo en vez de desaparecer del libro.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Download, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingColumn, isMissingRelation } from "@/lib/publicDataSource";
import { libroIvaDesdeZ, libroIvaTiquesA, NOMBRE_TIPO_Z, ORIGEN_ELECTRONICO, type CierreZ, type TiqueA } from "@/lib/cierreZ";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diaAR, mesAR } from "@/lib/fechaAR";
import { libroIvaVentas, periodoAPresentar, rangoDelPeriodo, type ComprobanteVenta } from "@/lib/libroIvaVentas";
import { posicionIva, type ComprobanteCompra, type LibroIvaCompras } from "@/lib/libroIvaCompras";
import { hojaPosicion, hojaRetenciones, subdiarioCompras, subdiarioVentas, totalesDeRetenciones, type RetencionSufrida } from "@/lib/subdiarioIva";
import RetencionesSufridas from "@/components/afip/RetencionesSufridas";
import ComprobantesDeCompra from "@/components/afip/ComprobantesDeCompra";
import LiquidacionIibbMes from "@/components/afip/LiquidacionIibbMes";
import { hojaIibb, liquidacionIibb, type InscripcionIibb } from "@/lib/liquidacionIibb";

const PAGINA = 1000;
const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

function descargar(nombre: string, contenido: string) {
  // Sin BOM: el importador de ARCA lo tomaría como parte del primer renglón.
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Lectura = { estado: "cargando" } | { estado: "error"; mensaje: string } | { estado: "listo"; comprobantes: ComprobanteVenta[]; homologacion: number };

export default function LibroIvaDigital({ orgId, monotributo, canEdit }: { orgId: string | null; monotributo: boolean; canEdit: boolean }) {
  const [resumenCompras, setResumenCompras] = useState<LibroIvaCompras["resumen"] | null>(null);
  const [compras, setCompras] = useState<ComprobanteCompra[]>([]);
  // El Excel espera a que compras y retenciones terminen de leerse: antes,
  // un clic temprano armaba el archivo con la hoja de compras vacía y sin la
  // posición de IVA, sin avisar.
  const [comprasEstado, setComprasEstado] = useState<string>("cargando");
  const alCambiarCompras = useCallback((r: LibroIvaCompras["resumen"] | null, lista: ComprobanteCompra[], estado: string) => {
    setResumenCompras(r);
    setCompras(lista);
    setComprasEstado(estado);
  }, []);
  const [armandoExcel, setArmandoExcel] = useState(false);
  const [retenciones, setRetenciones] = useState<RetencionSufrida[]>([]);
  const [retencionesEstado, setRetencionesEstado] = useState<string>("cargando");
  const alCambiarRetenciones = useCallback((lista: RetencionSufrida[], estado: string) => {
    setRetenciones(lista);
    setRetencionesEstado(estado);
  }, []);
  const faltaLeer = !monotributo && (comprasEstado === "cargando" || retencionesEstado === "cargando");
  const retencionesIva = totalesDeRetenciones(retenciones).iva;
  const [periodo, setPeriodo] = useState(() => periodoAPresentar(mesAR()));
  const [inscripciones, setInscripciones] = useState<InscripcionIibb[] | null>(null);

  // Inscripciones de IIBB para la liquidación del mes. Sin la migración
  // 20261022001000 se leen sin coeficiente y la pantalla pide cargarlo.
  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    void (async () => {
      let r = await supabase.from("iibb_registrations").select("id, province, regime, rate_pct, coeficiente, active").eq("org_id", orgId);
      if (r.error && isMissingColumn(r.error)) {
        r = await supabase.from("iibb_registrations").select("id, province, regime, rate_pct, active").eq("org_id", orgId) as typeof r;
      }
      if (!vigente) return;
      if (r.error) { console.error("Libro IVA: no se pudieron leer las inscripciones de IIBB", r.error); setInscripciones(null); return; }
      setInscripciones((r.data ?? []) as InscripcionIibb[]);
    })();
    return () => { vigente = false; };
  }, [orgId]);
  const [lectura, setLectura] = useState<Lectura>({ estado: "cargando" });

  const leer = useCallback(async (signal: { cancelado: boolean }) => {
    if (!orgId || !/^\d{4}-\d{2}$/.test(periodo)) return;
    setLectura({ estado: "cargando" });
    const { desde, hasta } = rangoDelPeriodo(periodo);
    const filas: (ComprobanteVenta & { afip_environment: string | null })[] = [];
    // Con la migración 20261022000600 cada factura trae exento, no gravado,
    // tributos y concepto; sin ella se lee como antes (todo gravado).
    const COMUNES = "id, number, issue_date, tipo_comprobante, punto_venta, numero_afip, customer_tax_id, customer_name, subtotal, tax_amount, tax_pct, total, afip_environment, currency, moneda_cotizacion, due_date";
    let columnas = `${COMUNES}, concepto, importe_no_gravado, importe_exento, importe_tributos, tributos, invoice_items(total, tax_rate, tax_amount, tratamiento)`;
    for (let desdeFila = 0; ; desdeFila += PAGINA) {
      const { data, error } = await supabase
        .from("invoices")
        .select(columnas)
        .eq("org_id", orgId)
        .eq("afip_status", "authorized")
        .not("cae", "is", null)
        .gte("issue_date", desde)
        .lte("issue_date", hasta)
        .order("issue_date")
        .order("id")
        .range(desdeFila, desdeFila + PAGINA - 1);
      if (signal.cancelado) return;
      if (error && isMissingColumn(error) && columnas.includes("tratamiento")) {
        console.warn("[Libro IVA] la migración de la factura completa todavía no está aplicada: se lee sin sus columnas");
        columnas = `${COMUNES}, invoice_items(total, tax_rate, tax_amount)`;
        desdeFila -= PAGINA;
        continue;
      }
      if (error) {
        console.error("Libro IVA: no se pudieron leer las facturas", error);
        setLectura({ estado: "error", mensaje: "No se pudieron leer las facturas del período. Reintentá en unos minutos." });
        return;
      }
      filas.push(...((data ?? []) as unknown as typeof filas));
      if ((data ?? []).length < PAGINA) break;
    }
    const homologacion = filas.filter(f => f.afip_environment === "homologacion").length;
    setLectura({ estado: "listo", comprobantes: filas.filter(f => f.afip_environment !== "homologacion"), homologacion });
  }, [orgId, periodo]);

  useEffect(() => {
    const signal = { cancelado: false };
    void leer(signal);
    return () => { signal.cancelado = true; };
  }, [leer]);

  // Cierres Z del controlador (20261023000700): los tiques entran al libro
  // como venta global diaria. Sin la migración no hay Z que sumar; un error de
  // lectura no se calla: el libro quedaría incompleto.
  // Los Tique-Factura A van uno por uno: salen de los tiques que registró la
  // caja (fiscal_controller_documents) con los renglones de su venta.
  const [cierres, setCierres] = useState<{ estado: "cargando" | "listo" | "error"; confirmados: CierreZ[]; borradores: number; tiquesA: TiqueA[] }>({ estado: "cargando", confirmados: [], borradores: 0, tiquesA: [] });
  const leerCierres = useCallback(async (signal: { cancelado: boolean }) => {
    if (!orgId || !/^\d{4}-\d{2}$/.test(periodo)) return;
    setCierres(c => ({ ...c, estado: "cargando" }));
    const fallar = (que: string, error: unknown) => {
      console.error(`Libro IVA: no se pudieron leer ${que}`, error);
      if (!signal.cancelado) setCierres({ estado: "error", confirmados: [], borradores: 0, tiquesA: [] });
    };
    const { desde, hasta } = rangoDelPeriodo(periodo);
    const { data, error } = await supabase.from("cierres_z" as never)
      .select("id, origen, punto_venta, numero, fecha, estado, equipo, comprobantes, total, iva")
      .eq("org_id", orgId).neq("origen", ORIGEN_ELECTRONICO).gte("fecha", desde).lte("fecha", hasta)
      .order("fecha").order("numero");
    if (signal.cancelado) return;
    if (error) {
      if (isMissingRelation(error)) { setCierres({ estado: "listo", confirmados: [], borradores: 0, tiquesA: [] }); return; }
      fallar("los cierres Z", error);
      return;
    }
    const filas = (data ?? []) as unknown as CierreZ[];
    const confirmados = filas.filter(z => z.estado === "confirmado");
    const borradores = filas.filter(z => z.estado !== "confirmado").length;

    // Tique-Factura A del período (día argentino), sólo si hay Z que los traigan.
    let tiquesA: TiqueA[] = [];
    if (confirmados.some(z => z.comprobantes.some(c => c.tipo === 81))) {
      const [anio, mes] = periodo.split("-").map(Number);
      const siguiente = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
      const docs = await supabase.from("fiscal_controller_documents" as never)
        .select("sale_transaction_id, numero, total, emitted_at")
        .eq("org_id", orgId).eq("estado", "emitido").eq("tipo", "A")
        .gte("emitted_at", `${desde}T00:00:00-03:00`).lt("emitted_at", `${siguiente}T00:00:00-03:00`)
        .order("emitted_at").range(0, 4999);
      if (signal.cancelado) return;
      if (docs.error) { fallar("los Tique-Factura A", docs.error); return; }
      const lista = (docs.data ?? []) as { sale_transaction_id: string; numero: string; total: number; emitted_at: string }[];
      if (lista.length) {
        const [lineas, ajustes] = await Promise.all([
          supabase.from("sales").select("sale_transaction_id, total_ars, fiscal_tax_rate, customer_id, products(tax_rate)")
            .eq("org_id", orgId).in("sale_transaction_id", lista.map(d => d.sale_transaction_id)).range(0, 9999),
          supabase.from("settings").select("tax_iva_percent").eq("org_id", orgId).maybeSingle(),
        ]);
        if (signal.cancelado) return;
        if (lineas.error) { fallar("las ventas de los Tique-Factura A", lineas.error); return; }
        type Linea = { sale_transaction_id: string; total_ars: number; fiscal_tax_rate: number | null; customer_id: string | null; products: { tax_rate: number | null } | null };
        const ventas = (lineas.data ?? []) as unknown as Linea[];
        const idsClientes = [...new Set(ventas.map(v => v.customer_id).filter((id): id is string => !!id))];
        const clientes = idsClientes.length
          ? await supabase.from("customers").select("id, name, legal_name, tax_id").in("id", idsClientes)
          : { data: [], error: null };
        if (signal.cancelado) return;
        if (clientes.error) { fallar("los clientes de los Tique-Factura A", clientes.error); return; }
        const porId = new Map(((clientes.data ?? []) as { id: string; name: string | null; legal_name: string | null; tax_id: string | null }[]).map(c => [c.id, c]));
        // La misma alícuota con que se imprimió (src/lib/fiscalPrinter/service.ts).
        const tasaGeneral = Number((ajustes.data as { tax_iva_percent?: number } | null)?.tax_iva_percent ?? 21);
        tiquesA = lista.map(d => {
          const propias = ventas.filter(v => v.sale_transaction_id === d.sale_transaction_id);
          const cliente = porId.get(propias.find(v => v.customer_id)?.customer_id ?? "");
          return {
            numero: d.numero, emitido: d.emitted_at, total: Number(d.total),
            lineas: propias.map(v => ({ total: Number(v.total_ars), tasa: Number(v.fiscal_tax_rate ?? v.products?.tax_rate ?? tasaGeneral) })),
            cuit: cliente?.tax_id ?? null, nombre: cliente?.legal_name || cliente?.name || null,
          };
        });
      }
    }
    setCierres({ estado: "listo", confirmados, borradores, tiquesA });
  }, [orgId, periodo]);
  useEffect(() => {
    const signal = { cancelado: false };
    void leerCierres(signal);
    return () => { signal.cancelado = true; };
  }, [leerCierres]);

  // Lo del controlador: el resumen de cada Z y los Tique-Factura A uno por uno.
  const libroZ = useMemo(() => {
    const resumen = libroIvaDesdeZ(cierres.confirmados);
    const tiques = libroIvaTiquesA(cierres.tiquesA, cierres.confirmados, diaAR);
    const porTasa = new Map<number, { tasa: number; neto: number; iva: number }>();
    for (const a of [...resumen.resumen.porAlicuota, ...tiques.resumen.porAlicuota]) {
      const r = porTasa.get(a.tasa) ?? { tasa: a.tasa, neto: 0, iva: 0 };
      porTasa.set(a.tasa, { tasa: a.tasa, neto: r.neto + a.neto, iva: r.iva + a.iva });
    }
    return {
      cbte: [...resumen.cbte, ...tiques.cbte],
      alicuotas: [...resumen.alicuotas, ...tiques.alicuotas],
      avisos: [...resumen.avisos, ...tiques.avisos],
      resumen: {
        total: resumen.resumen.total + tiques.resumen.total,
        debitoFiscal: resumen.resumen.debitoFiscal + tiques.resumen.debitoFiscal,
        porAlicuota: [...porTasa.values()],
      },
    };
  }, [cierres.confirmados, cierres.tiquesA]);
  const libro = useMemo(() => {
    if (lectura.estado !== "listo") return null;
    const base = libroIvaVentas(lectura.comprobantes);
    if (libroZ.cbte.length === 0) return base;
    const porTasa = new Map(base.resumen.porAlicuota.map(a => [a.tasa, { ...a }]));
    for (const a of libroZ.resumen.porAlicuota) {
      const r = porTasa.get(a.tasa) ?? { tasa: a.tasa, neto: 0, iva: 0 };
      porTasa.set(a.tasa, { tasa: a.tasa, neto: Math.round((r.neto + a.neto) * 100) / 100, iva: Math.round((r.iva + a.iva) * 100) / 100 });
    }
    return {
      ...base,
      cbte: base.cbte + libroZ.cbte.join(""),
      alicuotas: base.alicuotas + libroZ.alicuotas.join(""),
      incluidos: base.incluidos + libroZ.cbte.length,
      resumen: {
        ...base.resumen,
        total: Math.round((base.resumen.total + libroZ.resumen.total) * 100) / 100,
        debitoFiscal: Math.round((base.resumen.debitoFiscal + libroZ.resumen.debitoFiscal) * 100) / 100,
        porAlicuota: [...porTasa.values()].sort((a, b) => a.tasa - b.tasa),
      },
    };
  }, [lectura, libroZ]);
  const iibb = useMemo(() => lectura.estado === "listo" && inscripciones ? liquidacionIibb({
    comprobantes: lectura.comprobantes, inscripciones, retenciones,
    percepcionesDeCompras: compras.reduce((s, c) => s + Number(c.percepcion_iibb || 0), 0),
  }) : null, [lectura, inscripciones, retenciones, compras]);
  const sufijo = periodo.replace("-", "");

  /** Subdiario de ventas, compras y posición en un solo archivo. */
  const descargarExcel = async () => {
    if (lectura.estado !== "listo" || !libro || faltaLeer || cierres.estado !== "listo") return;
    if (!monotributo && (comprasEstado === "error" || retencionesEstado === "error")) {
      toast.error("No se pudieron leer las compras o las retenciones del período. Reintentá antes de armar el Excel, así no sale incompleto.");
      return;
    }
    setArmandoExcel(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const ventas = subdiarioVentas(lectura.comprobantes);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ventas.filas), "Ventas");
      if (!monotributo) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subdiarioCompras(compras)), "Compras");
        if (resumenCompras) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaPosicion(posicionIva(libro.resumen.debitoFiscal, resumenCompras, retencionesIva))), "Posición");
        if (retenciones.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaRetenciones(retenciones)), "Retenciones");
        if (cierres.confirmados.length) {
          const filas: (string | number)[][] = [["Fecha", "Punto de venta", "Z", "Comprobante", "Desde", "Hasta", "Cantidad", "Total", "Neto 21%", "IVA 21%", "Neto 10,5%", "IVA 10,5%", "Otras alícuotas (neto + IVA)", "Exento", "No gravado", "Internos y otros"]];
          for (const z of cierres.confirmados) for (const c of z.comprobantes) {
            const al = (t: number) => c.alicuotas.find(a => Number(a.tasa) === t);
            const otras = c.alicuotas.filter(a => ![21, 10.5].includes(Number(a.tasa))).reduce((s, a) => s + Number(a.neto) + Number(a.iva), 0);
            filas.push([z.fecha, z.punto_venta, z.numero, NOMBRE_TIPO_Z[c.tipo] ?? String(c.tipo), c.desde, c.hasta, c.cantidad, Number(c.total),
              Number(al(21)?.neto ?? 0), Number(al(21)?.iva ?? 0), Number(al(10.5)?.neto ?? 0), Number(al(10.5)?.iva ?? 0), otras,
              Number(c.exento ?? 0), Number(c.no_gravado ?? 0), Number(c.internos ?? 0) + Number(c.otros_tributos ?? 0)]);
          }
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Cierres Z");
        }
        if (iibb?.renglones.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaIibb(iibb)), "Ingresos Brutos");
      }
      if (ventas.revisar.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Fecha", "Comprobante", "Motivo"], ...ventas.revisar]), "A revisar");
      }
      XLSX.writeFile(wb, `subdiario-iva-${periodo}.xlsx`);
    } catch (e) {
      console.error("Libro IVA: no se pudo armar el Excel", e);
      toast.error("No se pudo armar el Excel. Reintentá.");
    } finally {
      setArmandoExcel(false);
    }
  };

  return (
    <section className="bg-card border border-border/40 rounded-xl p-5 space-y-4" aria-labelledby="libro-iva-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BookOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 id="libro-iva-titulo" className="font-semibold">Libro IVA Digital</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Los dos archivos que se importan en ARCA › Portal IVA › Libro IVA Digital, armados con tus facturas autorizadas.
              Pasáselos a tu contador o importalos vos.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input type="month" value={periodo} max={mesAR()} onChange={e => setPeriodo(e.target.value)}
            className="h-8 w-36 px-2 text-xs" aria-label="Período del libro" />
          <Button size="icon" variant="ghost" onClick={() => void leer({ cancelado: false })} disabled={lectura.estado === "cargando"} aria-label="Volver a leer el período">
            <RefreshCw className={`w-4 h-4 ${lectura.estado === "cargando" ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {monotributo && (
        <p className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground">
          Los monotributistas no presentan Libro IVA. Igual te sirve como detalle de lo facturado en el mes.
        </p>
      )}

      {lectura.estado === "cargando" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Leyendo las facturas del período…</p>
      )}

      {lectura.estado === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {lectura.mensaje}
          <Button size="sm" variant="outline" onClick={() => void leer({ cancelado: false })}>Reintentar</Button>
        </div>
      )}

      {libro && lectura.estado === "listo" && (
        <>
          {libro.incluidos === 0 && libro.problemas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay facturas con CAE en este período.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Comprobantes</p>
                <p className="text-lg font-semibold">{libro.incluidos}</p>
                {libro.resumen.notasDeCredito > 0 && <p className="text-[11px] text-muted-foreground">{libro.resumen.notasDeCredito} notas de crédito</p>}
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Total facturado (neto de notas de crédito)</p>
                <p className="text-lg font-semibold">{ars(libro.resumen.total)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">IVA débito fiscal</p>
                <p className="text-lg font-semibold">{ars(libro.resumen.debitoFiscal)}</p>
              </div>
            </div>
          )}

          {libro.resumen.porAlicuota.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/40">
                    <th className="py-1.5 pr-3 font-medium">Alícuota</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Neto gravado</th>
                    <th className="py-1.5 font-medium text-right">IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {libro.resumen.porAlicuota.map(a => (
                    <tr key={a.tasa} className="border-b border-border/20">
                      <td className="py-1.5 pr-3">{a.tasa.toLocaleString("es-AR")} %</td>
                      <td className="py-1.5 pr-3 text-right">{ars(a.neto)}</td>
                      <td className="py-1.5 text-right">{ars(a.iva)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {libro.problemas.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="w-4 h-4 text-amber-600" />
                {libro.problemas.length === 1 ? "1 comprobante no entra en el libro" : `${libro.problemas.length} comprobantes no entran en el libro`}: revisalos antes de presentar.
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {libro.problemas.slice(0, 10).map(p => <li key={p.id}>{p.comprobante}: {p.motivo}</li>)}
              </ul>
              {libro.problemas.length > 10 && <p className="text-muted-foreground">Y {libro.problemas.length - 10} más.</p>}
            </div>
          )}

          {cierres.estado === "error" && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              No se pudieron leer los cierres Z del período: el libro quedaría sin los tiques del controlador.
              <Button size="sm" variant="outline" onClick={() => void leerCierres({ cancelado: false })}>Reintentar</Button>
            </div>
          )}
          {cierres.confirmados.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Incluye {cierres.confirmados.length === 1 ? "1 cierre Z" : `${cierres.confirmados.length} cierres Z`} del controlador fiscal como venta global diaria.
            </p>
          )}
          {cierres.borradores > 0 && (
            <p role="status" className="text-[11px] text-amber-700 dark:text-amber-400">
              {cierres.borradores === 1 ? "Hay 1 cierre Z en borrador" : `Hay ${cierres.borradores} cierres Z en borrador`}: confirmalos contra el ticket para que entren al libro.
            </p>
          )}
          {libroZ.avisos.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-amber-700 dark:text-amber-400">
              {libroZ.avisos.slice(0, 5).map(a => <li key={a}>{a}</li>)}
            </ul>
          )}

          {lectura.homologacion > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Se dejaron afuera {lectura.homologacion} comprobantes de homologación: son de prueba y no tienen validez fiscal.
            </p>
          )}

          {libro.incluidos > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={cierres.estado !== "listo"} onClick={() => descargar(`LIBRO_IVA_DIGITAL_VENTAS_CBTE_${sufijo}.txt`, libro.cbte)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />Comprobantes (.txt)
              </Button>
              <Button size="sm" variant="outline" disabled={!libro.alicuotas || cierres.estado !== "listo"} onClick={() => descargar(`LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${sufijo}.txt`, libro.alicuotas)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />Alícuotas (.txt)
              </Button>
              <Button size="sm" variant="outline" disabled={armandoExcel || faltaLeer} onClick={() => void descargarExcel()}>
                {armandoExcel || faltaLeer ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />}Excel para tu contador
              </Button>
            </div>
          )}
        </>
      )}

      {!monotributo && (
        <div className="border-t border-border/40 pt-4 space-y-4">
          {libro && lectura.estado === "listo" && resumenCompras && (() => {
            const p = posicionIva(libro.resumen.debitoFiscal, resumenCompras, retencionesIva);
            return (
              <div className="rounded-lg border border-border/40 p-3 text-sm space-y-1" aria-label="Posición de IVA del período">
                <p className="font-medium">Posición de IVA del período</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">Débito fiscal (ventas)</span><span className="text-right">{ars(p.debitoFiscal)}</span>
                  <span className="text-muted-foreground">Crédito fiscal (compras)</span><span className="text-right">− {ars(p.creditoFiscal)}</span>
                  <span className="text-muted-foreground">Percepciones de IVA sufridas</span><span className="text-right">− {ars(p.percepcionesIva)}</span>
                  <span className="text-muted-foreground">Retenciones de IVA sufridas</span><span className="text-right">− {ars(p.retencionesIva)}</span>
                  <span className="font-medium">{p.saldo >= 0 ? "Saldo a pagar" : "Saldo técnico a favor"}</span>
                  <span className="text-right font-semibold">{ars(Math.abs(p.saldo))}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Referencia del mes: no incluye saldos de períodos anteriores. La declaración jurada la presentás vos o tu contador.</p>
              </div>
            );
          })()}
          {libro && lectura.estado === "listo" && <LiquidacionIibbMes liquidacion={iibb} />}
          <ComprobantesDeCompra orgId={orgId} periodo={periodo} canEdit={canEdit} onResumen={alCambiarCompras} />
          <RetencionesSufridas orgId={orgId} periodo={periodo} canEdit={canEdit} onCambio={alCambiarRetenciones} />
        </div>
      )}
    </section>
  );
}
