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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mesAR } from "@/lib/fechaAR";
import { libroIvaVentas, periodoAPresentar, rangoDelPeriodo, type ComprobanteVenta } from "@/lib/libroIvaVentas";
import { posicionIva, type ComprobanteCompra, type LibroIvaCompras } from "@/lib/libroIvaCompras";
import { hojaPosicion, subdiarioCompras, subdiarioVentas } from "@/lib/subdiarioIva";
import ComprobantesDeCompra from "@/components/afip/ComprobantesDeCompra";

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
  const alCambiarCompras = useCallback((r: LibroIvaCompras["resumen"] | null, lista: ComprobanteCompra[]) => {
    setResumenCompras(r);
    setCompras(lista);
  }, []);
  const [armandoExcel, setArmandoExcel] = useState(false);
  const [periodo, setPeriodo] = useState(() => periodoAPresentar(mesAR()));
  const [lectura, setLectura] = useState<Lectura>({ estado: "cargando" });

  const leer = useCallback(async (signal: { cancelado: boolean }) => {
    if (!orgId || !/^\d{4}-\d{2}$/.test(periodo)) return;
    setLectura({ estado: "cargando" });
    const { desde, hasta } = rangoDelPeriodo(periodo);
    const filas: (ComprobanteVenta & { afip_environment: string | null })[] = [];
    for (let desdeFila = 0; ; desdeFila += PAGINA) {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, number, issue_date, tipo_comprobante, punto_venta, numero_afip, customer_tax_id, customer_name, subtotal, tax_amount, tax_pct, total, afip_environment, invoice_items(total, tax_rate, tax_amount)")
        .eq("org_id", orgId)
        .eq("afip_status", "authorized")
        .not("cae", "is", null)
        .gte("issue_date", desde)
        .lte("issue_date", hasta)
        .order("issue_date")
        .order("id")
        .range(desdeFila, desdeFila + PAGINA - 1);
      if (signal.cancelado) return;
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

  const libro = useMemo(() => lectura.estado === "listo" ? libroIvaVentas(lectura.comprobantes) : null, [lectura]);
  const sufijo = periodo.replace("-", "");

  /** Subdiario de ventas, compras y posición en un solo archivo. */
  const descargarExcel = async () => {
    if (lectura.estado !== "listo" || !libro) return;
    setArmandoExcel(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const ventas = subdiarioVentas(lectura.comprobantes);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ventas.filas), "Ventas");
      if (!monotributo) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subdiarioCompras(compras)), "Compras");
        if (resumenCompras) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaPosicion(posicionIva(libro.resumen.debitoFiscal, resumenCompras))), "Posición");
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

          {lectura.homologacion > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Se dejaron afuera {lectura.homologacion} comprobantes de homologación: son de prueba y no tienen validez fiscal.
            </p>
          )}

          {libro.incluidos > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => descargar(`LIBRO_IVA_DIGITAL_VENTAS_CBTE_${sufijo}.txt`, libro.cbte)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />Comprobantes (.txt)
              </Button>
              <Button size="sm" variant="outline" disabled={!libro.alicuotas} onClick={() => descargar(`LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${sufijo}.txt`, libro.alicuotas)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />Alícuotas (.txt)
              </Button>
              <Button size="sm" variant="outline" disabled={armandoExcel} onClick={() => void descargarExcel()}>
                {armandoExcel ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />}Excel para tu contador
              </Button>
            </div>
          )}
        </>
      )}

      {!monotributo && (
        <div className="border-t border-border/40 pt-4 space-y-4">
          {libro && lectura.estado === "listo" && resumenCompras && (() => {
            const p = posicionIva(libro.resumen.debitoFiscal, resumenCompras);
            return (
              <div className="rounded-lg border border-border/40 p-3 text-sm space-y-1" aria-label="Posición de IVA del período">
                <p className="font-medium">Posición de IVA del período</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">Débito fiscal (ventas)</span><span className="text-right">{ars(p.debitoFiscal)}</span>
                  <span className="text-muted-foreground">Crédito fiscal (compras)</span><span className="text-right">− {ars(p.creditoFiscal)}</span>
                  <span className="text-muted-foreground">Percepciones de IVA sufridas</span><span className="text-right">− {ars(p.percepcionesIva)}</span>
                  <span className="font-medium">{p.saldo >= 0 ? "Saldo a pagar" : "Saldo técnico a favor"}</span>
                  <span className="text-right font-semibold">{ars(Math.abs(p.saldo))}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Referencia del mes: no incluye retenciones sufridas ni saldos de períodos anteriores. La declaración jurada la presentás vos o tu contador.</p>
              </div>
            );
          })()}
          <ComprobantesDeCompra orgId={orgId} periodo={periodo} canEdit={canEdit} onResumen={alCambiarCompras} />
        </div>
      )}
    </section>
  );
}
