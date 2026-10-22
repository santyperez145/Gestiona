/**
 * Conciliación con «Mis Comprobantes – Emitidos» (2026-10-22): el comercio
 * sube el archivo que descarga de ARCA y Nerqia lo compara con lo que
 * autorizó en las mismas fechas. Ver `lib/conciliacionArca.ts`.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileSearch, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import FilePicker from "@/components/shared/FilePicker";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { conciliar, hojaConciliacion, leerEmitidosArca, type Conciliacion, type FacturaNerqia, type LecturaEmitidos } from "@/lib/conciliacionArca";
import { bytesDeArchivoArca, entradaParaPlanilla } from "@/lib/misComprobantes";
import { isMissingColumn } from "@/lib/publicDataSource";

const PAGINA = 1000;
const MOSTRAR = 20;
const COLUMNAS = "id, number, issue_date, tipo_comprobante, punto_venta, numero_afip, cae, total, currency, afip_status, customer_name, codigo_autorizacion_tipo, afip_candidate_number, afip_environment";

type Estado =
  | { etapa: "inicio" }
  | { etapa: "leyendo" }
  | { etapa: "listo"; archivo: string; lectura: LecturaEmitidos; resultado: Conciliacion };

const numeroFiscal = (tipo: number, pv: number, numero: number) => `${tipo} · ${String(pv).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;

async function facturasDelRango(orgId: string, desde: string, hasta: string): Promise<FacturaNerqia[]> {
  const filas: (FacturaNerqia & { afip_environment?: string | null })[] = [];
  let columnas = `${COLUMNAS}, caea_informado_at`;
  for (let desdeFila = 0; ; desdeFila += PAGINA) {
    const { data, error } = await supabase.from("invoices").select(columnas)
      .eq("org_id", orgId).not("tipo_comprobante", "is", null)
      .gte("issue_date", desde).lte("issue_date", hasta)
      .order("issue_date").order("id").range(desdeFila, desdeFila + PAGINA - 1);
    // Sin la migración de CAEA no está esa columna: se lee sin ella.
    if (error && isMissingColumn(error) && columnas.includes("caea_informado_at")) { columnas = COLUMNAS; desdeFila -= PAGINA; continue; }
    if (error) throw new Error("No se pudieron leer tus facturas del período. Probá de nuevo.");
    filas.push(...((data ?? []) as unknown as typeof filas));
    if ((data ?? []).length < PAGINA) break;
  }
  // Homologación no existe para ARCA productiva.
  return filas.filter(f => f.afip_environment !== "homologacion");
}

export default function ConciliacionArca({ orgId }: { orgId: string | null }) {
  const [estado, setEstado] = useState<Estado>({ etapa: "inicio" });

  const leerArchivo = async (archivo: File) => {
    if (!orgId) return;
    setEstado({ etapa: "leyendo" });
    try {
      const XLSX = await import("xlsx");
      const entrada = entradaParaPlanilla(await bytesDeArchivoArca(archivo));
      const libro = XLSX.read(entrada.datos, { type: entrada.tipo, raw: true, cellDates: true });
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: "" });
      const lectura = leerEmitidosArca(matriz);
      if (lectura.error || !lectura.desde || !lectura.hasta) {
        toast.error(lectura.error ?? "El archivo no tiene comprobantes legibles.");
        setEstado({ etapa: "inicio" });
        return;
      }
      const facturas = await facturasDelRango(orgId, lectura.desde, lectura.hasta);
      setEstado({ etapa: "listo", archivo: archivo.name, lectura, resultado: conciliar(lectura.comprobantes, facturas) });
    } catch (e) {
      console.error("Conciliación ARCA: no se pudo leer el archivo", e);
      toast.error(e instanceof Error && e.message.startsWith("No se pudieron") ? e.message : "No se pudo leer el archivo. Subilo tal como lo descargaste de ARCA (.zip, .csv o Excel).");
      setEstado({ etapa: "inicio" });
    }
  };

  const descargar = async () => {
    if (estado.etapa !== "listo") return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaConciliacion(estado.resultado)), "Conciliación");
      XLSX.writeFile(wb, `conciliacion-arca-${estado.lectura.desde}-a-${estado.lectura.hasta}.xlsx`);
    } catch (e) {
      console.error("Conciliación ARCA: no se pudo armar el Excel", e);
      toast.error("No se pudo armar el Excel. Probá de nuevo.");
    }
  };

  const r = estado.etapa === "listo" ? estado.resultado : null;
  const sinRegistrar = r?.soloEnArca.filter(s => s.sinRegistrar) ?? [];
  const deAfuera = r?.soloEnArca.filter(s => !s.sinRegistrar) ?? [];
  const todoBien = r && !r.diferencias.length && !r.soloEnArca.length && !r.soloEnNerqia.length;

  return (
    <section className="bg-card border border-border/40 rounded-xl p-5 space-y-4" aria-labelledby="conciliacion-arca">
      <div className="flex items-start gap-3">
        <FileSearch className="w-5 h-5 text-primary mt-0.5 shrink-0" aria-hidden />
        <div>
          <h2 id="conciliacion-arca" className="font-semibold">Conciliar con ARCA</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Descargá de ARCA › Mis Comprobantes › <strong>Emitidos</strong> el período que quieras revisar y subilo acá.
            Nerqia lo compara con lo que autorizó: encuentra CAE que no llegaron a guardarse, comprobantes hechos por fuera y diferencias de importe.
          </p>
        </div>
      </div>

      <FilePicker mode="button" accept=".zip,.csv,.xlsx,.xls,.txt" title="Subir Mis Comprobantes Emitidos" icon={FileSearch}
        description="El archivo tal como lo da ARCA: .zip, .csv o Excel." busy={estado.etapa === "leyendo"} busyLabel="Comparando con tus facturas…"
        onFile={leerArchivo} />

      {estado.etapa === "listo" && r && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {estado.archivo}: {estado.lectura.comprobantes.length} comprobantes del {fechaFiscalArgentina(estado.lectura.desde!)} al {fechaFiscalArgentina(estado.lectura.hasta!)}.
            {estado.lectura.problemas.length > 0 && ` ${estado.lectura.problemas.length} filas no se pudieron leer (fila ${estado.lectura.problemas.slice(0, 3).map(p => p.fila).join(", ")}${estado.lectura.problemas.length > 3 ? "…" : ""}).`}
          </p>
          <dl className="grid gap-2 sm:grid-cols-4">
            {[
              ["Coinciden", r.coinciden, "text-emerald-700 dark:text-emerald-300"],
              ["Con diferencias", r.diferencias.length, r.diferencias.length ? "text-amber-700 dark:text-amber-300" : ""],
              ["Sólo en ARCA", r.soloEnArca.length, r.soloEnArca.length ? "text-amber-700 dark:text-amber-300" : ""],
              ["Sólo en Nerqia", r.soloEnNerqia.length, r.soloEnNerqia.length ? "text-red-600 dark:text-red-400" : ""],
            ].map(([etiqueta, valor, color]) => (
              <div key={etiqueta as string} className="rounded-lg border border-border/40 p-3">
                <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
                <dd className={`text-lg font-semibold ${color}`}>{valor}</dd>
              </div>
            ))}
          </dl>

          {todoBien && (
            <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" aria-hidden />Todo lo que figura en ARCA coincide con Nerqia en ese período.
            </p>
          )}

          {sinRegistrar.length > 0 && (
            <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs space-y-1">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
                ARCA otorgó {sinRegistrar.length === 1 ? "un CAE que Nerqia no llegó a guardar" : `${sinRegistrar.length} CAE que Nerqia no llegó a guardar`}
              </p>
              <p className="text-muted-foreground">No las vuelvas a autorizar: quedarían duplicadas. Escribinos con este detalle y lo regularizamos.</p>
              <ul className="list-disc pl-5">
                {sinRegistrar.slice(0, MOSTRAR).map(s => (
                  <li key={`${s.arca.tipo}-${s.arca.pv}-${s.arca.numero}`}>
                    {numeroFiscal(s.arca.tipo, s.arca.pv, s.arca.numero)}, CAE {s.arca.cae} → <Link className="underline underline-offset-2" to={`/facturas?invoice=${s.sinRegistrar!.id}`}>factura {s.sinRegistrar!.number ?? ""}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.soloEnNerqia.length > 0 && (
            <div className="rounded-md border border-red-500/30 p-3 text-xs space-y-1">
              <p className="font-medium">En Nerqia y no en el archivo de ARCA</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {r.soloEnNerqia.slice(0, MOSTRAR).map(s => (
                  <li key={s.factura.id}>
                    <Link className="underline underline-offset-2 text-foreground" to={`/facturas?invoice=${s.factura.id}`}>
                      {numeroFiscal(Number(s.factura.tipo_comprobante), Number(s.factura.punto_venta), Number(s.factura.numero_afip))}
                    </Link>{" "}— {s.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.diferencias.length > 0 && (
            <div className="rounded-md border border-amber-500/30 p-3 text-xs space-y-1">
              <p className="font-medium">Con diferencias</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {r.diferencias.slice(0, MOSTRAR).map(d => (
                  <li key={d.factura.id}>
                    <Link className="underline underline-offset-2 text-foreground" to={`/facturas?invoice=${d.factura.id}`}>{numeroFiscal(d.arca.tipo, d.arca.pv, d.arca.numero)}</Link>: {d.motivos.join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {deAfuera.length > 0 && (
            <div className="rounded-md border border-border/40 p-3 text-xs space-y-1">
              <p className="font-medium">Emitidos por fuera de Nerqia ({deAfuera.length})</p>
              <p className="text-muted-foreground">Están en ARCA y no en Nerqia: si los hiciste con otro sistema o en la web de ARCA, sumalos a tu contabilidad.</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {deAfuera.slice(0, MOSTRAR).map(s => <li key={`${s.arca.tipo}-${s.arca.pv}-${s.arca.numero}`}>{numeroFiscal(s.arca.tipo, s.arca.pv, s.arca.numero)} · {fechaFiscalArgentina(s.arca.fecha)} · {s.arca.receptor || "sin receptor"}</li>)}
              </ul>
            </div>
          )}

          {!todoBien && (
            <Button size="sm" variant="outline" onClick={() => void descargar()}>
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Descargar el detalle (Excel)
            </Button>
          )}
          {estado.etapa === "listo" && (r.diferencias.length > MOSTRAR || r.soloEnArca.length > MOSTRAR || r.soloEnNerqia.length > MOSTRAR) && (
            <p className="text-[11px] text-muted-foreground">Se muestran los primeros {MOSTRAR} de cada grupo; el Excel trae todos.</p>
          )}
        </div>
      )}
      {estado.etapa === "leyendo" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Comparando con tus facturas…</p>}
    </section>
  );
}
