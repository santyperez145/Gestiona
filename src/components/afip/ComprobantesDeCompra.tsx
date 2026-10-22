/**
 * Comprobantes de compra del período y su Libro IVA Digital (2026-10-21).
 * Ver `lib/libroIvaCompras.ts` y la migración 20261021000100.
 *
 * Si la tabla todavía no existe (migración sin aplicar) lo dice, en vez de
 * mostrar un libro vacío como si no hubiera compras.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileUp, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { consultarPadron } from "@/lib/arcaPadron";
import { rangoDelPeriodo } from "@/lib/libroIvaVentas";
import { bytesDeArchivoArca, entradaParaPlanilla, leerMisComprobantes, type FilaImportada } from "@/lib/misComprobantes";
import {
  TIPOS_DE_COMPRA, discriminaIva, erroresDeComprobante, leerImporte, libroIvaCompras,
  type AlicuotaCompra, type ComprobanteCompra, type LibroIvaCompras,
} from "@/lib/libroIvaCompras";

const PAGINA = 1000;
const TASAS = [21, 10.5, 27, 5, 2.5, 0];
const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const num = leerImporte;
const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const nombreTipo = (codigo: number) => TIPOS_DE_COMPRA.find(t => t.codigo === codigo)?.nombre ?? `Tipo ${codigo}`;

/** El código de PostgREST cuando la tabla no existe todavía. */
const tablaInexistente = (code?: string) => code === "42P01" || code === "PGRST205";

function descargar(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Lectura =
  | { estado: "cargando" }
  | { estado: "inactivo" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; comprobantes: ComprobanteCompra[] };

interface Formulario {
  tipo: number; fecha: string; puntoVenta: string; numero: string; cuit: string; razonSocial: string;
  netos: Record<number, string>; ivas: Record<number, string>;
  noGravado: string; exento: string; percepcionIva: string; percepcionIibb: string; otros: string; totalSinIva: string;
}

const vacio = (periodo: string): Formulario => ({
  tipo: 1, fecha: rangoDelPeriodo(periodo).desde, puntoVenta: "", numero: "", cuit: "", razonSocial: "",
  netos: {}, ivas: {}, noGravado: "", exento: "", percepcionIva: "", percepcionIibb: "", otros: "", totalSinIva: "",
});

function desdeFormulario(f: Formulario): Omit<ComprobanteCompra, "id"> {
  const conIva = discriminaIva(f.tipo);
  const alicuotas: AlicuotaCompra[] = conIva
    ? TASAS.filter(t => num(f.netos[t] ?? "") > 0).map(t => ({
        tasa: t, neto: num(f.netos[t]), iva: f.ivas[t] ? num(f.ivas[t]) : redondear(num(f.netos[t]) * t / 100),
      }))
    : [];
  const partes = {
    no_gravado: conIva ? num(f.noGravado) : 0, exento: conIva ? num(f.exento) : 0,
    percepcion_iva: num(f.percepcionIva), percepcion_iibb: num(f.percepcionIibb), otros_tributos: num(f.otros),
    percepcion_nacionales: 0, percepcion_municipal: 0, impuestos_internos: 0,
  };
  const total = conIva
    ? redondear(alicuotas.reduce((s, a) => s + a.neto + a.iva, 0) + partes.no_gravado + partes.exento + partes.percepcion_iva + partes.percepcion_iibb + partes.otros_tributos)
    : num(f.totalSinIva);
  return {
    fecha: f.fecha, tipo_comprobante: f.tipo, punto_venta: Math.trunc(num(f.puntoVenta)), numero: Math.trunc(num(f.numero)),
    cuit_emisor: f.cuit.replace(/\D/g, ""), razon_social_emisor: f.razonSocial.trim(), alicuotas, total, ...partes,
  };
}

export default function ComprobantesDeCompra({ orgId, periodo, canEdit, onResumen }: {
  orgId: string | null; periodo: string; canEdit: boolean;
  onResumen: (r: LibroIvaCompras["resumen"] | null, comprobantes: ComprobanteCompra[]) => void;
}) {
  const [lectura, setLectura] = useState<Lectura>({ estado: "cargando" });
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<Formulario>(() => vacio(periodo));
  const [guardando, setGuardando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const { ask, dialog } = useConfirmDialog();

  const leer = useCallback(async (signal: { cancelado: boolean }) => {
    if (!orgId || !/^\d{4}-\d{2}$/.test(periodo)) return;
    setLectura({ estado: "cargando" });
    const filas: ComprobanteCompra[] = [];
    for (let desde = 0; ; desde += PAGINA) {
      const { data, error } = await supabase
        .from("comprobantes_de_compra")
        .select("id, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, no_gravado, exento, percepcion_iva, percepcion_nacionales, percepcion_iibb, percepcion_municipal, impuestos_internos, otros_tributos, total")
        .eq("org_id", orgId)
        .eq("periodo", periodo)
        .order("fecha")
        .order("id")
        .range(desde, desde + PAGINA - 1);
      if (signal.cancelado) return;
      if (error) {
        if (tablaInexistente(error.code)) { setLectura({ estado: "inactivo" }); return; }
        console.error("Compras: no se pudieron leer los comprobantes", error);
        setLectura({ estado: "error", mensaje: "No se pudieron leer los comprobantes de compra. Reintentá en unos minutos." });
        return;
      }
      filas.push(...((data ?? []).map(d => ({ ...d, alicuotas: (d.alicuotas ?? []) as unknown as AlicuotaCompra[] })) as ComprobanteCompra[]));
      if ((data ?? []).length < PAGINA) break;
    }
    setLectura({ estado: "listo", comprobantes: filas });
  }, [orgId, periodo]);

  useEffect(() => {
    const signal = { cancelado: false };
    void leer(signal);
    return () => { signal.cancelado = true; };
  }, [leer]);

  const libro = useMemo(() => lectura.estado === "listo" ? libroIvaCompras(lectura.comprobantes) : null, [lectura]);
  useEffect(() => {
    onResumen(libro?.resumen ?? null, lectura.estado === "listo" ? lectura.comprobantes : []);
  }, [libro, lectura, onResumen]);

  const borrador = desdeFormulario(form);
  const errores = erroresDeComprobante(borrador);
  const conIva = discriminaIva(form.tipo);
  const cambiar = (parcial: Partial<Formulario>) => setForm(f => ({ ...f, ...parcial }));

  const buscarCuit = async () => {
    if (!orgId) return;
    setBuscando(true);
    const r = await consultarPadron(orgId, borrador.cuit_emisor);
    setBuscando(false);
    if ("error" in r) { toast.error(r.error); return; }
    cambiar({ razonSocial: r.persona.nombre });
  };

  const guardar = async () => {
    if (!orgId || errores.length) return;
    setGuardando(true);
    const { error } = await supabase.from("comprobantes_de_compra").insert({
      ...borrador, org_id: orgId, periodo, alicuotas: borrador.alicuotas as unknown as Json,
    });
    setGuardando(false);
    if (error) {
      toast.error(error.code === "23505" ? "Ese comprobante de ese proveedor ya está cargado." : `No se pudo guardar: ${error.message}`);
      return;
    }
    toast.success("Comprobante cargado");
    setAbierto(false);
    setForm(vacio(periodo));
    void leer({ cancelado: false });
  };

  const borrar = async (c: ComprobanteCompra) => {
    if (!(await ask({ title: `¿Borrar ${nombreTipo(c.tipo_comprobante)} ${c.punto_venta}-${c.numero}?`, description: c.razon_social_emisor, confirmText: "Borrar", variant: "destructive" }))) return;
    const { error } = await supabase.from("comprobantes_de_compra").delete().eq("id", c.id);
    if (error) { toast.error(`No se pudo borrar: ${error.message}`); return; }
    void leer({ cancelado: false });
  };

  // ── Importar «Mis Comprobantes – Recibidos» de ARCA ────────────────────
  const [importacion, setImportacion] = useState<{ archivo: string; validas: FilaImportada[]; conProblemas: FilaImportada[] } | null>(null);
  const [importando, setImportando] = useState(false);

  const leerArchivoDeArca = async (archivo: File | undefined) => {
    if (!archivo) return;
    try {
      // SheetJS sólo cuando hace falta: pesa y la mayoría no importa nunca.
      const XLSX = await import("xlsx");
      // raw: los montos del CSV llegan con coma decimal y no se reinterpretan.
      const entrada = entradaParaPlanilla(await bytesDeArchivoArca(archivo));
      const libro = XLSX.read(entrada.datos, { type: entrada.tipo, raw: true, cellDates: true });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: "" });
      const r = leerMisComprobantes(matriz, periodo);
      if (r.error) { toast.error(r.error); return; }
      setImportacion({
        archivo: archivo.name,
        validas: r.filas.filter(f => f.comprobante),
        conProblemas: r.filas.filter(f => !f.comprobante),
      });
    } catch (e) {
      console.error("Compras: no se pudo leer el archivo de ARCA", e);
      toast.error("No se pudo leer el archivo. Subilo tal como lo descargaste de ARCA (.zip, .csv o Excel).");
    }
  };

  const confirmarImportacion = async () => {
    if (!orgId || !importacion) return;
    setImportando(true);
    let nuevos = 0;
    let enviados = 0;
    try {
      const filas = importacion.validas.map(f => ({ ...f.comprobante!, org_id: orgId, periodo, alicuotas: f.comprobante!.alicuotas as unknown as Json }));
      for (let i = 0; i < filas.length; i += 200) {
        const tanda = filas.slice(i, i + 200);
        const { data, error } = await supabase.from("comprobantes_de_compra")
          .upsert(tanda, { onConflict: "org_id,cuit_emisor,tipo_comprobante,punto_venta,numero", ignoreDuplicates: true })
          .select("id");
        if (error) {
          console.error("Compras: falló una tanda de la importación", error);
          toast.error(`Se importaron ${nuevos} de ${filas.length}. La base rechazó una tanda: ${error.message}`);
          return;
        }
        nuevos += (data ?? []).length;
        enviados += tanda.length;
      }
      const repetidos = enviados - nuevos;
      toast.success(`${nuevos} ${nuevos === 1 ? "comprobante importado" : "comprobantes importados"}${repetidos ? ` · ${repetidos} ya estaban cargados` : ""}`);
      setImportacion(null);
    } finally {
      setImportando(false);
      void leer({ cancelado: false });
    }
  };

  const sufijo = periodo.replace("-", "");

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-sm">Compras del período</h3>
        {canEdit && lectura.estado !== "inactivo" && (
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              title="En ARCA: Mis Comprobantes › Recibidos › elegí el período › CSV o Excel">
              <FileUp className="w-3.5 h-3.5" />Importar de ARCA
              <input type="file" accept=".zip,.csv,.xlsx,.xls,.txt" className="sr-only"
                onChange={ev => { void leerArchivoDeArca(ev.target.files?.[0]); ev.target.value = ""; }} />
            </label>
            <Button size="sm" variant="outline" onClick={() => { setForm(vacio(periodo)); setAbierto(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />Cargar comprobante de compra
            </Button>
          </div>
        )}
      </div>

      {lectura.estado === "cargando" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Leyendo las compras…</p>
      )}
      {lectura.estado === "inactivo" && (
        <p className="text-sm text-muted-foreground">El registro de compras todavía no está activo en tu cuenta.</p>
      )}
      {lectura.estado === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {lectura.mensaje}
          <Button size="sm" variant="outline" onClick={() => void leer({ cancelado: false })}>Reintentar</Button>
        </div>
      )}

      {lectura.estado === "listo" && libro && (
        lectura.comprobantes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay comprobantes de compra cargados en este período.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/40">
                    {["Fecha", "Comprobante", "Proveedor", "Total", "IVA", ""].map(h => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lectura.comprobantes.map(c => (
                    <tr key={c.id} className="border-b border-border/20">
                      <td className="py-1.5 pr-3">{c.fecha.split("-").reverse().join("/")}</td>
                      <td className="py-1.5 pr-3">{nombreTipo(c.tipo_comprobante)} {String(c.punto_venta).padStart(5, "0")}-{String(c.numero).padStart(8, "0")}</td>
                      <td className="py-1.5 pr-3">{c.razon_social_emisor}</td>
                      <td className="py-1.5 pr-3">{ars(Number(c.total))}</td>
                      <td className="py-1.5 pr-3">{ars(c.alicuotas.reduce((s, a) => s + Number(a.iva), 0))}</td>
                      <td className="py-1.5 text-right">
                        {canEdit && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void borrar(c)} aria-label={`Borrar comprobante ${c.punto_venta}-${c.numero}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => descargar(`LIBRO_IVA_DIGITAL_COMPRAS_CBTE_${sufijo}.txt`, libro.cbte)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />Compras (.txt)
              </Button>
              <Button size="sm" variant="outline" disabled={!libro.alicuotas} onClick={() => descargar(`LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS_${sufijo}.txt`, libro.alicuotas)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />Alícuotas de compras (.txt)
              </Button>
            </div>
          </>
        )
      )}

      <Dialog open={!!importacion} onOpenChange={abierto => { if (!abierto && !importando) setImportacion(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Importar comprobantes recibidos</DialogTitle></DialogHeader>
          {importacion && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">{importacion.archivo} · período {periodo.split("-").reverse().join("/")}</p>
              <p><strong>{importacion.validas.length}</strong> {importacion.validas.length === 1 ? "comprobante listo" : "comprobantes listos"} para importar.
                {" "}Los que ya estén cargados se saltean.</p>
              {importacion.conProblemas.length > 0 && (
                <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
                  <p className="font-medium">{importacion.conProblemas.length} {importacion.conProblemas.length === 1 ? "fila no se importa" : "filas no se importan"}: cargalas a mano si corresponden.</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {importacion.conProblemas.slice(0, 15).map(f => <li key={f.fila}>Fila {f.fila}: {f.problemas.join(" ")}</li>)}
                  </ul>
                  {importacion.conProblemas.length > 15 && <p className="text-muted-foreground">Y {importacion.conProblemas.length - 15} más.</p>}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Las percepciones vienen sumadas en «Otros tributos». Si alguna es de IVA, editala para que entre en tu posición.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={importando} onClick={() => setImportacion(null)}>Cancelar</Button>
            <Button disabled={importando || !importacion?.validas.length} onClick={() => void confirmarImportacion()}>
              {importando && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Importar {importacion?.validas.length ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Comprobante de compra</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="cc-tipo">Tipo</Label>
                <Select value={String(form.tipo)} onValueChange={v => cambiar({ tipo: Number(v) })}>
                  <SelectTrigger id="cc-tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIPOS_DE_COMPRA.map(t => <SelectItem key={t.codigo} value={String(t.codigo)}>{t.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="cc-fecha">Fecha</Label><Input id="cc-fecha" type="date" value={form.fecha} max={rangoDelPeriodo(periodo).hasta} onChange={e => cambiar({ fecha: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="cc-pv">Pto. venta</Label><Input id="cc-pv" inputMode="numeric" value={form.puntoVenta} onChange={e => cambiar({ puntoVenta: e.target.value })} /></div>
                <div><Label htmlFor="cc-num">Número</Label><Input id="cc-num" inputMode="numeric" value={form.numero} onChange={e => cambiar({ numero: e.target.value })} /></div>
              </div>
              <div>
                <Label htmlFor="cc-cuit">CUIT del proveedor</Label>
                <div className="flex gap-1">
                  <Input id="cc-cuit" inputMode="numeric" value={form.cuit} onChange={e => cambiar({ cuit: e.target.value })} />
                  <Button type="button" size="icon" variant="outline" onClick={() => void buscarCuit()} disabled={buscando || !/^\d{11}$/.test(borrador.cuit_emisor)} aria-label="Buscar razón social en ARCA">
                    {buscando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div><Label htmlFor="cc-rs">Razón social</Label><Input id="cc-rs" value={form.razonSocial} onChange={e => cambiar({ razonSocial: e.target.value })} /></div>
            </div>

            {conIva ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Neto gravado por alícuota (el IVA se calcula; corregilo si el comprobante dice otra cosa).</p>
                {TASAS.map(t => (
                  <div key={t} className="grid grid-cols-[4rem_1fr_1fr] items-center gap-2">
                    <span className="text-xs">{t.toLocaleString("es-AR")} %</span>
                    <Input aria-label={`Neto al ${t} %`} inputMode="decimal" placeholder="Neto" value={form.netos[t] ?? ""} onChange={e => cambiar({ netos: { ...form.netos, [t]: e.target.value } })} />
                    <Input aria-label={`IVA al ${t} %`} inputMode="decimal" placeholder={num(form.netos[t] ?? "") ? String(redondear(num(form.netos[t]) * t / 100)) : "IVA"}
                      value={form.ivas[t] ?? ""} onChange={e => cambiar({ ivas: { ...form.ivas, [t]: e.target.value } })} disabled={t === 0} />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  <div><Label htmlFor="cc-ng">No gravado</Label><Input id="cc-ng" inputMode="decimal" value={form.noGravado} onChange={e => cambiar({ noGravado: e.target.value })} /></div>
                  <div><Label htmlFor="cc-ex">Exento</Label><Input id="cc-ex" inputMode="decimal" value={form.exento} onChange={e => cambiar({ exento: e.target.value })} /></div>
                </div>
              </div>
            ) : (
              <div><Label htmlFor="cc-total">Total del comprobante</Label><Input id="cc-total" inputMode="decimal" value={form.totalSinIva} onChange={e => cambiar({ totalSinIva: e.target.value })} /></div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div><Label htmlFor="cc-piva">Percep. IVA</Label><Input id="cc-piva" inputMode="decimal" value={form.percepcionIva} onChange={e => cambiar({ percepcionIva: e.target.value })} /></div>
              <div><Label htmlFor="cc-piibb">Percep. IIBB</Label><Input id="cc-piibb" inputMode="decimal" value={form.percepcionIibb} onChange={e => cambiar({ percepcionIibb: e.target.value })} /></div>
              <div><Label htmlFor="cc-otros">Otros tributos</Label><Input id="cc-otros" inputMode="decimal" value={form.otros} onChange={e => cambiar({ otros: e.target.value })} /></div>
            </div>

            {conIva && <p className="text-sm font-medium">Total: {ars(borrador.total)}</p>}
            {errores.length > 0 && (form.numero || form.cuit) && (
              <ul role="alert" className="list-disc pl-5 text-xs text-destructive">{errores.map(e => <li key={e}>{e}</li>)}</ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button onClick={() => void guardar()} disabled={guardando || errores.length > 0}>
              {guardando && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
