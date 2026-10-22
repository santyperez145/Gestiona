/**
 * Orden de pago (2026-10-22): las deudas elegidas de un proveedor, con qué se
 * pagan, y el comprobante para entregarle. Ver `lib/ordenDePago.ts` y
 * `emitir_orden_de_pago`.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Printer, Trash2 } from "lucide-react";
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
import { isMissingFunction } from "@/lib/publicDataSource";
import {
  MEDIOS, erroresDeOrden, leerMonto, medioVacio, ordenDePagoHtml, ordenParaEnviar, totales,
  type ImputacionForm, type MedioDePago, type MedioForm,
} from "@/lib/ordenDePago";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
type Cheque = { id: string; check_number: string | null; bank_name: string | null; amount_ars: number; due_date: string; customer_name: string | null };
export interface DeudaParaPagar { id: string; description: string; remaining_ars: number }

export default function OrdenDePagoDialog({ open, onOpenChange, orgId, proveedor, deudas, onEmitida }: {
  open: boolean; onOpenChange: (v: boolean) => void; orgId: string | null;
  proveedor: { id: string; nombre: string } | null; deudas: DeudaParaPagar[]; onEmitida: () => void;
}) {
  const emisor = useEmisorDelRemito();
  const [imputaciones, setImputaciones] = useState<ImputacionForm[]>([]);
  const [medios, setMedios] = useState<MedioForm[]>([]);
  const [notas, setNotas] = useState("");
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [clave, setClave] = useState("");
  const [emitiendo, setEmitiendo] = useState(false);

  useEffect(() => {
    if (!open) return;
    const imps = deudas.map(d => ({ deudaId: d.id, descripcion: d.description, saldo: Number(d.remaining_ars), importe: String(Number(d.remaining_ars)) }));
    setImputaciones(imps);
    setMedios([medioVacio("transferencia", String(totales(imps, []).imputado))]);
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

  const t = totales(imputaciones, medios);
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
    const r = data as { numero: number; total: number };
    toast.success(`Orden de pago N.º ${r.numero} por ${ars(Number(r.total))} emitida.`);
    if (ventana) {
      ventana.document.open();
      ventana.document.write(ordenDePagoHtml({
        numero: r.numero, fecha: new Date().toISOString().slice(0, 10), proveedor: proveedor.nombre, proveedorCuit: null, total: Number(r.total),
        notas: notas.trim() || null,
        imputaciones: imputaciones.map(i => ({ descripcion: i.descripcion, importe: leerMonto(i.importe) })),
        medios: medios.map(m => ({ medio: m.medio, importe: leerMonto(m.importe),
          referencia: m.medio === "cheque_tercero" ? describirCheque(cheques.find(c => c.id === m.chequeId)) : m.medio === "cheque_propio" ? `${m.banco} N.º ${m.numero}, paga el ${m.vencimiento.split("-").reverse().join("/")}` : m.referencia || null })),
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

        <section aria-labelledby="op-medios" className="space-y-2">
          <h3 id="op-medios" className="text-sm font-medium">Se paga con</h3>
          {medios.map((m, i) => (
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
                <Button type="button" size="icon" variant="ghost" aria-label={`Quitar el medio ${i + 1}`} disabled={medios.length === 1}
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

function describirCheque(c: Cheque | undefined): string {
  if (!c) return "Cheque de terceros";
  return `${c.bank_name ?? "Cheque"} N.º ${c.check_number ?? "s/n"}${c.customer_name ? ` de ${c.customer_name}` : ""}, vence ${c.due_date.split("-").reverse().join("/")}`;
}
