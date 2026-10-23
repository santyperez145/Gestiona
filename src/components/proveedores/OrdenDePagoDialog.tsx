/**
 * Orden de pago (2026-10-22): las deudas elegidas de un proveedor, con qué se
 * pagan, y el comprobante para entregarle. Ver `lib/ordenDePago.ts` y
 * `emitir_orden_de_pago`.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Printer, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmisorDelRemito } from "@/hooks/useEmisorDelRemito";
import { hoyAR } from "@/lib/fechaAR";
import { isMissingFunction } from "@/lib/publicDataSource";
import {
  MEDIOS, avisoDeRetencion, erroresDeOrden, leerMonto, medioDeRetencion, medioVacio, ordenDePagoHtml, ordenParaEnviar, totales,
  type CalculoRetencion, type ImputacionForm, type MedioDePago, type MedioForm, type RetencionImpresa,
} from "@/lib/ordenDePago";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
type Cheque = { id: string; check_number: string | null; bank_name: string | null; amount_ars: number; due_date: string; customer_name: string | null };
export interface DeudaParaPagar { id: string; description: string; remaining_ars: number }

export default function OrdenDePagoDialog({ open, onOpenChange, orgId, proveedor, deudas, onEmitida }: {
  open: boolean; onOpenChange: (v: boolean) => void; orgId: string | null;
  proveedor: { id: string; nombre: string; cuit?: string | null } | null; deudas: DeudaParaPagar[]; onEmitida: () => void;
}) {
  const emisor = useEmisorDelRemito();
  const [imputaciones, setImputaciones] = useState<ImputacionForm[]>([]);
  const [medios, setMedios] = useState<MedioForm[]>([]);
  const [notas, setNotas] = useState("");
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [clave, setClave] = useState("");
  const [emitiendo, setEmitiendo] = useState(false);
  // Retención de Ingresos Brutos (agente): la base la calcula; acá se propone
  // y se puede cambiar la base o no retener (por ejemplo, con certificado de exclusión).
  const [baseRetencion, setBaseRetencion] = useState("");
  const [calculo, setCalculo] = useState<CalculoRetencion | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [noRetener, setNoRetener] = useState(false);
  const [baseEditada, setBaseEditada] = useState(false);

  useEffect(() => {
    if (!open) return;
    const imps = deudas.map(d => ({ deudaId: d.id, descripcion: d.description, saldo: Number(d.remaining_ars), importe: String(Number(d.remaining_ars)) }));
    setImputaciones(imps);
    setMedios([medioVacio("transferencia", String(totales(imps, []).imputado))]);
    setBaseRetencion(String(totales(imps, []).imputado));
    setCalculo(null);
    setNoRetener(false);
    setBaseEditada(false);
    setNotas("");
    setClave(crypto.randomUUID());
    if (!orgId) return;
    let vigente = true;
    void supabase.from("cheques").select("id, check_number, bank_name, amount_ars, due_date, customer_name")
      .eq("org_id", orgId).eq("type", "received").eq("status", "pending").order("due_date").then(({ data, error }) => {
        if (!vigente) return;
        if (error) { console.error("Orden de pago: no se leyó la cartera de cheques", error); return; }
        setCheques((data ?? []) as Cheque[]);
      });
    return () => { vigente = false; };
  }, [open, orgId, deudas]);

  // Mientras no la toquen, la base sigue a lo que se paga.
  const imputadoTotal = totales(imputaciones, []).imputado;
  useEffect(() => { if (!baseEditada) setBaseRetencion(String(imputadoTotal)); }, [baseEditada, imputadoTotal]);

  // Pide el cálculo a la base con una pausa corta mientras se escribe la base.
  const base = leerMonto(baseRetencion);
  useEffect(() => {
    if (!open || !orgId || !proveedor || base <= 0) { setCalculo(null); return; }
    let vigente = true;
    setCalculando(true);
    const t = window.setTimeout(() => {
      void supabase.rpc("retencion_para_proveedor", { p_org: orgId, p_supplier: proveedor.id, p_base: base }).then(({ data, error }) => {
        if (!vigente) return;
        setCalculando(false);
        // Sin la migración 20261022001600 no hay retención automática: la orden sigue como antes.
        if (error) { if (!isMissingFunction(error)) console.error("Orden de pago: no se calculó la retención", error); setCalculo(null); return; }
        const c = data as unknown as CalculoRetencion | null;
        setCalculo(c && typeof c === "object" && "aplica" in c ? c : null);
      });
    }, 300);
    return () => { vigente = false; window.clearTimeout(t); setCalculando(false); };
  }, [open, orgId, proveedor, base]);

  // La retención propuesta entra como un medio fijo; si hay un solo medio más, se ajusta solo.
  useEffect(() => {
    setMedios(ms => {
      const otros = ms.filter(m => !m.automatica);
      const ret = calculo?.aplica && !noRetener ? medioDeRetencion(calculo) : null;
      const previa = ms.find(m => m.automatica);
      if (!ret && !previa) return ms;
      if (ret && previa && previa.importe === ret.importe && previa.base === ret.base) return ms;
      const resto = Math.round((totales(imputaciones, []).imputado - leerMonto(ret?.importe ?? "0")) * 100) / 100;
      const ajustados = otros.length === 1 && otros[0].medio !== "cheque_tercero" ? [{ ...otros[0], importe: String(resto) }] : otros;
      return ret ? [ret, ...ajustados] : ajustados;
    });
  }, [calculo, noRetener, imputaciones]);

  const t = totales(imputaciones, medios);
  const avisoRetencion = avisoDeRetencion(calculo);
  const errores = useMemo(() => erroresDeOrden(imputaciones, medios, cheques), [imputaciones, medios, cheques]);
  const cambiarMedio = (i: number, parcial: Partial<MedioForm>) => setMedios(ms => ms.map((m, j) => (j === i ? { ...m, ...parcial } : m)));

  const emitir = async () => {
    if (!orgId || !proveedor || errores.length) return;
    // La ventana se abre en el clic: después de esperar a la base, el navegador la bloquea.
    const ventana = window.open("", "_blank", "width=820,height=980");
    ventana?.document.write(`<!doctype html><meta charset="utf-8"><title>Orden de pago</title><p style="font:14px Arial;padding:24px">Preparando la orden de pago…</p>`);
    setEmitiendo(true);
    const { data, error } = await supabase.rpc("emitir_orden_de_pago", {
      p_org: orgId, p_datos: ordenParaEnviar({ supplierId: proveedor.id, clave, notas, imputaciones, medios }) as unknown as Json,
    });
    setEmitiendo(false);
    if (error) {
      ventana?.close();
      toast.error(isMissingFunction(error) ? "La orden de pago todavía no está disponible. Probá más tarde."
        : error.code === "22023" || error.code === "42501" ? error.message
        : error.code === "23505" ? "Ese número de cheque propio ya está cargado en la cartera." : "No se pudo emitir la orden. Probá de nuevo: no se paga dos veces.");
      return;
    }
    const r = data as unknown as { numero: number; total: number; retenciones?: RetencionImpresa[] };
    toast.success(`Orden de pago N.º ${r.numero} por ${ars(Number(r.total))} emitida${r.retenciones?.length ? ", con su certificado de retención" : ""}.`);
    if (ventana) {
      ventana.document.open();
      ventana.document.write(ordenDePagoHtml({
        numero: r.numero, fecha: hoyAR(), proveedor: proveedor.nombre, proveedorCuit: proveedor.cuit ?? null, total: Number(r.total),
        retenciones: (r.retenciones ?? []).map(x => ({ jurisdiccion: x.jurisdiccion, certificado: Number(x.certificado), base: Number(x.base), alicuota: Number(x.alicuota), importe: Number(x.importe) })),
        notas: notas.trim() || null,
        imputaciones: imputaciones.map(i => ({ descripcion: i.descripcion, importe: leerMonto(i.importe) })),
        medios: medios.map(m => ({ medio: m.medio, importe: leerMonto(m.importe),
          referencia: m.automatica ? certificadoDe(r.retenciones) : m.medio === "cheque_tercero" ? describirCheque(cheques.find(c => c.id === m.chequeId)) : m.medio === "cheque_propio" ? `${m.banco} N.º ${m.numero}, paga el ${m.vencimiento.split("-").reverse().join("/")}` : m.referencia || null })),
      }, emisor));
      ventana.document.close();
      ventana.focus();
      window.setTimeout(() => ventana.print(), 150);
    }
    onOpenChange(false);
    onEmitida();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Orden de pago{proveedor ? ` a ${proveedor.nombre}` : ""}</DialogTitle>
          <DialogDescription>Qué se cancela y con qué se paga. Al emitirla, las deudas se descuentan y se imprime el comprobante para el proveedor.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="op-imputaciones" className="space-y-2">
          <h3 id="op-imputaciones" className="text-sm font-medium">Se cancela</h3>
          {imputaciones.map((imp, i) => (
            <div key={imp.deudaId} className="grid grid-cols-[1fr_9rem] items-center gap-2 text-sm">
              <span className="min-w-0"><span className="block truncate">{imp.descripcion}</span><span className="text-xs text-muted-foreground">Saldo {ars(imp.saldo)}</span></span>
              <Input aria-label={`Importe a pagar de ${imp.descripcion}`} inputMode="decimal" className="text-right" value={imp.importe}
                onChange={e => setImputaciones(xs => xs.map((x, j) => (j === i ? { ...x, importe: e.target.value } : x)))} />
            </div>
          ))}
        </section>

        {(calculo?.aplica || noRetener || avisoRetencion) && (
          <section aria-labelledby="op-retencion" className="space-y-2 rounded-md border border-border/50 p-3">
            <h3 id="op-retencion" className="flex items-center gap-1.5 text-sm font-medium"><Receipt className="h-4 w-4" aria-hidden />Retención de Ingresos Brutos</h3>
            {avisoRetencion && !calculo?.aplica && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{avisoRetencion}</p>}
            <div className="grid grid-cols-[9rem_1fr] items-end gap-3">
              <div>
                <Label htmlFor="op-base-retencion" className="text-xs">Base</Label>
                <Input id="op-base-retencion" inputMode="decimal" className="text-right" value={baseRetencion} disabled={noRetener}
                  onChange={e => { setBaseEditada(true); setBaseRetencion(e.target.value); }} />
              </div>
              <p role="status" className="pb-2 text-xs text-muted-foreground">
                {calculando ? "Calculando…" : calculo?.aplica && !noRetener
                  ? <>{calculo.jurisdiccion} {calculo.alicuota.toLocaleString("es-AR")} % {calculo.origen === "padron" ? "(padrón del proveedor)" : "(no está en el padrón)"}: <strong className="text-foreground">{ars(calculo.importe)}</strong>. El certificado se numera al emitir.</>
                  : noRetener ? "No se retiene en este pago." : null}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">La base es lo pagado sin IVA si el proveedor es responsable inscripto.</p>
            {(calculo?.aplica || noRetener) && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={noRetener} onChange={e => setNoRetener(e.target.checked)} />
                No retener en este pago (el proveedor presentó certificado de exclusión)
              </label>
            )}
          </section>
        )}

        <section aria-labelledby="op-medios" className="space-y-2">
          <h3 id="op-medios" className="text-sm font-medium">Se paga con</h3>
          {medios.map((m, i) => m.automatica ? (
            <div key="retencion-automatica" className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-sm">
              <span>Retención IIBB {calculo?.aplica ? calculo.jurisdiccion : ""} <span className="text-xs text-muted-foreground">· certificado al emitir</span></span>
              <strong className="tabular-nums">{ars(leerMonto(m.importe))}</strong>
            </div>
          ) : (
            <div key={i} className="space-y-2 rounded-md border border-border/50 p-2">
              <div className="grid grid-cols-[10rem_1fr_auto] items-end gap-2">
                <div>
                  <Label htmlFor={`op-medio-${i}`} className="text-xs">Medio</Label>
                  <Select value={m.medio} onValueChange={v => cambiarMedio(i, { medio: v as MedioDePago, chequeId: "" })}>
                    <SelectTrigger id={`op-medio-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(MEDIOS) as MedioDePago[]).map(k => <SelectItem key={k} value={k}>{MEDIOS[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`op-importe-${i}`} className="text-xs">Importe</Label>
                  <Input id={`op-importe-${i}`} inputMode="decimal" className="text-right" value={m.importe} disabled={m.medio === "cheque_tercero"}
                    onChange={e => cambiarMedio(i, { importe: e.target.value })} />
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label={`Quitar el medio ${i + 1}`} disabled={medios.filter(x => !x.automatica).length === 1}
                  onClick={() => setMedios(ms => ms.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
              {m.medio === "cheque_tercero" && (
                <div>
                  <Label htmlFor={`op-cheque-${i}`} className="text-xs">Cheque de la cartera</Label>
                  <Select value={m.chequeId} onValueChange={v => cambiarMedio(i, { chequeId: v, importe: String(cheques.find(c => c.id === v)?.amount_ars ?? "") })}>
                    <SelectTrigger id={`op-cheque-${i}`}><SelectValue placeholder={cheques.length ? "Elegí un cheque" : "No hay cheques pendientes en cartera"} /></SelectTrigger>
                    <SelectContent>{cheques.map(c => <SelectItem key={c.id} value={c.id}>{describirCheque(c)} · {ars(Number(c.amount_ars))}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {m.medio === "cheque_propio" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div><Label htmlFor={`op-banco-${i}`} className="text-xs">Banco</Label><Input id={`op-banco-${i}`} value={m.banco} onChange={e => cambiarMedio(i, { banco: e.target.value })} /></div>
                  <div><Label htmlFor={`op-numero-${i}`} className="text-xs">Número</Label><Input id={`op-numero-${i}`} value={m.numero} onChange={e => cambiarMedio(i, { numero: e.target.value })} /></div>
                  <div><Label htmlFor={`op-vto-${i}`} className="text-xs">Fecha de pago</Label><Input id={`op-vto-${i}`} type="date" value={m.vencimiento} onChange={e => cambiarMedio(i, { vencimiento: e.target.value })} /></div>
                </div>
              )}
              {(m.medio === "transferencia" || m.medio === "retencion" || m.medio === "otro") && (
                <div>
                  <Label htmlFor={`op-ref-${i}`} className="text-xs">{m.medio === "retencion" ? "N.º de certificado de retención" : "Referencia (opcional)"}</Label>
                  <Input id={`op-ref-${i}`} maxLength={200} value={m.referencia} onChange={e => cambiarMedio(i, { referencia: e.target.value })} />
                </div>
              )}
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setMedios(ms => [...ms, medioVacio("efectivo", t.diferencia > 0 ? String(t.diferencia) : "")])}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Otro medio
          </Button>
        </section>

        <div>
          <Label htmlFor="op-notas" className="text-xs">Notas <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Textarea id="op-notas" rows={2} maxLength={1000} value={notas} onChange={e => setNotas(e.target.value)} />
        </div>

        {errores.length > 0 && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{errores[0]}</p>}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm">Total <strong>{ars(t.imputado)}</strong></span>
          <Button disabled={emitiendo || errores.length > 0} onClick={() => void emitir()}>
            {emitiendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}Emitir e imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function certificadoDe(retenciones: RetencionImpresa[] | undefined): string {
  const r = retenciones?.[0];
  return r ? `Certificado IIBB ${r.jurisdiccion} N.º ${String(r.certificado).padStart(8, "0")}` : "Retención IIBB";
}

function describirCheque(c: Cheque | undefined): string {
  if (!c) return "Cheque de terceros";
  return `${c.bank_name ?? "Cheque"} N.º ${c.check_number ?? "s/n"}${c.customer_name ? ` de ${c.customer_name}` : ""}, vence ${c.due_date.split("-").reverse().join("/")}`;
}
