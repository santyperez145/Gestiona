/**
 * Retenciones sufridas del período (2026-10-22): los certificados que los
 * clientes agentes de retención le dan al comercio. La de IVA resta en la
 * posición del mes. Ver la migración 20261022000300.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { usePadronAutomatico } from "@/hooks/usePadronAutomatico";
import EstadoDelPadron from "@/components/afip/EstadoDelPadron";
import { leerImporte } from "@/lib/libroIvaCompras";
import { rangoDelPeriodo } from "@/lib/libroIvaVentas";
import { isMissingRelation } from "@/lib/publicDataSource";
import { NOMBRE_IMPUESTO, type RetencionSufrida } from "@/lib/subdiarioIva";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

type Lectura = { estado: "cargando" } | { estado: "inactivo" } | { estado: "error" } | { estado: "listo"; retenciones: RetencionSufrida[] };

interface Formulario { impuesto: RetencionSufrida["impuesto"]; fecha: string; cuit: string; nombre: string; certificado: string; jurisdiccion: string; importe: string }

export default function RetencionesSufridas({ orgId, periodo, canEdit, onCambio }: {
  orgId: string | null; periodo: string; canEdit: boolean; onCambio: (retenciones: RetencionSufrida[]) => void;
}) {
  const [lectura, setLectura] = useState<Lectura>({ estado: "cargando" });
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const vacio = (): Formulario => ({ impuesto: "iva", fecha: rangoDelPeriodo(periodo).desde, cuit: "", nombre: "", certificado: "", jurisdiccion: "", importe: "" });
  const [form, setForm] = useState<Formulario>(vacio);
  const { ask, dialog } = useConfirmDialog();

  const leer = useCallback(async (signal: { cancelado: boolean }) => {
    if (!orgId || !/^\d{4}-\d{2}$/.test(periodo)) return;
    setLectura({ estado: "cargando" });
    const { data, error } = await supabase.from("retenciones_sufridas")
      .select("id, fecha, impuesto, agente_cuit, agente_nombre, numero_certificado, jurisdiccion, importe")
      .eq("org_id", orgId).eq("periodo", periodo).order("fecha").limit(1000);
    if (signal.cancelado) return;
    if (error) {
      if (isMissingRelation(error)) { setLectura({ estado: "inactivo" }); return; }
      console.error("Retenciones: no se pudieron leer", error);
      setLectura({ estado: "error" });
      return;
    }
    setLectura({ estado: "listo", retenciones: (data ?? []) as RetencionSufrida[] });
  }, [orgId, periodo]);

  useEffect(() => {
    const signal = { cancelado: false };
    void leer(signal);
    return () => { signal.cancelado = true; };
  }, [leer]);

  useEffect(() => { onCambio(lectura.estado === "listo" ? lectura.retenciones : []); }, [lectura, onCambio]);

  const cuit = form.cuit.replace(/\D/g, "");
  const importe = leerImporte(form.importe);
  const errores = [
    !/^\d{11}$/.test(cuit) && "El CUIT del agente tiene que tener 11 dígitos.",
    !form.nombre.trim() && "Falta el nombre del agente.",
    !form.certificado.trim() && "Falta el número de certificado.",
    !(importe > 0) && "El importe tiene que ser mayor a cero.",
    form.fecha.slice(0, 7) > periodo && "La fecha es posterior al período.",
  ].filter(Boolean) as string[];

  // Al escribir el CUIT del agente, ARCA trae su nombre.
  const padron = usePadronAutomatico(orgId, form.cuit, persona => setForm(f => ({ ...f, nombre: persona.nombre })));

  const guardar = async () => {
    if (!orgId || errores.length) return;
    setGuardando(true);
    const { error } = await supabase.from("retenciones_sufridas").insert({
      org_id: orgId, periodo, fecha: form.fecha, impuesto: form.impuesto, agente_cuit: cuit, agente_nombre: form.nombre.trim(),
      numero_certificado: form.certificado.trim(), jurisdiccion: form.impuesto === "iibb" ? form.jurisdiccion.trim() || null : null, importe,
    });
    setGuardando(false);
    if (error) { toast.error(error.code === "23505" ? "Ese certificado de ese agente ya está cargado." : `No se pudo guardar: ${error.message}`); return; }
    toast.success("Retención cargada");
    setAbierto(false);
    setForm(vacio());
    void leer({ cancelado: false });
  };

  const borrar = async (r: RetencionSufrida) => {
    if (!(await ask({ title: `¿Borrar el certificado ${r.numero_certificado}?`, description: `${r.agente_nombre} · ${ars(Number(r.importe))}`, confirmText: "Borrar", variant: "destructive" }))) return;
    const { error } = await supabase.from("retenciones_sufridas").delete().eq("id", r.id);
    if (error) { toast.error(`No se pudo borrar: ${error.message}`); return; }
    void leer({ cancelado: false });
  };

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-sm">Retenciones sufridas</h3>
          <p className="text-[11px] text-muted-foreground">Los certificados que te dan tus clientes cuando te retienen al pagarte. La de IVA resta en la posición.</p>
        </div>
        {canEdit && lectura.estado === "listo" && (
          <Button size="sm" variant="outline" onClick={() => { setForm(vacio()); setAbierto(true); }}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />Cargar retención
          </Button>
        )}
      </div>

      {lectura.estado === "cargando" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Leyendo retenciones…</p>}
      {lectura.estado === "inactivo" && <p className="text-sm text-muted-foreground">El registro de retenciones todavía no está activo en tu cuenta.</p>}
      {lectura.estado === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          No se pudieron leer las retenciones. Reintentá en unos minutos.
          <Button size="sm" variant="outline" onClick={() => void leer({ cancelado: false })}>Reintentar</Button>
        </div>
      )}
      {lectura.estado === "listo" && (lectura.retenciones.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay retenciones cargadas en este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/40">
                {["Fecha", "Impuesto", "Agente", "Certificado", "Importe", ""].map(h => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {lectura.retenciones.map(r => (
                <tr key={r.id} className="border-b border-border/20">
                  <td className="py-1.5 pr-3">{r.fecha.split("-").reverse().join("/")}</td>
                  <td className="py-1.5 pr-3">{NOMBRE_IMPUESTO[r.impuesto]}{r.jurisdiccion ? ` · ${r.jurisdiccion}` : ""}</td>
                  <td className="py-1.5 pr-3">{r.agente_nombre}</td>
                  <td className="py-1.5 pr-3">{r.numero_certificado}</td>
                  <td className="py-1.5 pr-3">{ars(Number(r.importe))}</td>
                  <td className="py-1.5 text-right">
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void borrar(r)} aria-label={`Borrar certificado ${r.numero_certificado}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Retención sufrida</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rs-imp">Impuesto</Label>
              <Select value={form.impuesto} onValueChange={v => setForm(f => ({ ...f, impuesto: v as RetencionSufrida["impuesto"] }))}>
                <SelectTrigger id="rs-imp"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(NOMBRE_IMPUESTO) as RetencionSufrida["impuesto"][]).map(k => <SelectItem key={k} value={k}>{NOMBRE_IMPUESTO[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="rs-fecha">Fecha</Label><Input id="rs-fecha" type="date" value={form.fecha} max={rangoDelPeriodo(periodo).hasta} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} /></div>
            <div className="col-span-2">
              <Label htmlFor="rs-cuit">CUIT del agente</Label>
              <Input id="rs-cuit" inputMode="numeric" value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))} />
              <EstadoDelPadron estado={padron.estado} onReintentar={padron.reintentar} />
            </div>
            <div className="col-span-2"><Label htmlFor="rs-nombre">Agente</Label><Input id="rs-nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></div>
            <div><Label htmlFor="rs-cert">N.º de certificado</Label><Input id="rs-cert" value={form.certificado} onChange={e => setForm(f => ({ ...f, certificado: e.target.value }))} /></div>
            <div><Label htmlFor="rs-importe">Importe</Label><Input id="rs-importe" inputMode="decimal" value={form.importe} onChange={e => setForm(f => ({ ...f, importe: e.target.value }))} /></div>
            {form.impuesto === "iibb" && (
              <div className="col-span-2"><Label htmlFor="rs-jur">Jurisdicción</Label><Input id="rs-jur" placeholder="Ej.: Buenos Aires" value={form.jurisdiccion} onChange={e => setForm(f => ({ ...f, jurisdiccion: e.target.value }))} /></div>
            )}
          </div>
          {errores.length > 0 && (form.cuit || form.certificado || form.importe) && (
            <ul role="alert" className="list-disc pl-5 text-xs text-destructive">{errores.map(e => <li key={e}>{e}</li>)}</ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button disabled={guardando || errores.length > 0} onClick={() => void guardar()}>
              {guardando && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
