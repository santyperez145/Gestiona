/**
 * Cargar un cierre Z a mano desde el ticket impreso (2026-10-23): para
 * cualquier controlador fiscal —Hasar, Epson sin conexión, el que sea—.
 * Un renglón por tipo de comprobante, con la numeración desde/hasta y los
 * importes por alícuota tal como figuran en el Z. Se guarda en borrador o
 * confirmado (`registrar_cierre_z`, origen «manual»), con los mismos controles
 * que la base.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { hoyAR } from "@/lib/fechaAR";
import { comprobanteDesdeRenglon, controlesZ, NOMBRE_TIPO_Z, renglonZVacio, TIPOS_CONTROLADOR, totalesZ, type RenglonZ } from "@/lib/cierreZ";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Renglon = RenglonZ;
const vacio = renglonZVacio;

export default function CargaManualZ({ open, orgId, puntoVentaSugerido, onClose, onGuardado }: {
  open: boolean;
  orgId: string;
  puntoVentaSugerido: number | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [puntoVenta, setPuntoVenta] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(() => hoyAR());
  const [marca, setMarca] = useState("");
  const [registro, setRegistro] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>([vacio()]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPuntoVenta(puntoVentaSugerido ? String(puntoVentaSugerido) : "");
    setNumero(""); setFecha(hoyAR()); setMarca(""); setRegistro(""); setRenglones([vacio()]);
  }, [open, puntoVentaSugerido]);

  const comprobantes = useMemo(() => renglones.map(comprobanteDesdeRenglon), [renglones]);
  const controles = useMemo(() => controlesZ(comprobantes), [comprobantes]);
  const errores = controles.filter(c => c.nivel === "error");
  const totales = totalesZ(comprobantes);
  const incompleto = !(Number(puntoVenta) >= 1) || !(Number(numero) >= 1) || !fecha
    || comprobantes.some(c => !(c.desde >= 1) || !(c.hasta >= c.desde) || !(c.total > 0));

  const cambiar = (i: number, campo: keyof Renglon, valor: string) =>
    setRenglones(prev => prev.map((r, j) => j === i ? { ...r, [campo]: valor } : r));

  const guardar = async (confirmar: boolean) => {
    if (incompleto) { toast.error("Completá punto de venta, número, fecha y cada renglón (desde, hasta y total)"); return; }
    if (confirmar && errores.length) { toast.error("Hay renglones que no cierran: revisalos contra el ticket"); return; }
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc("registrar_cierre_z" as never, {
        p_org: orgId, p_origen: "manual", p_punto_venta: Number(puntoVenta), p_numero: Number(numero), p_fecha: fecha,
        p_equipo: { marca: marca.trim() || null, registro: registro.trim() || null },
        p_comprobantes: comprobantes, p_confirmar: confirmar,
      } as never);
      if (error) throw error;
      const avisos = ((data as { observaciones?: { nivel: string; texto: string }[] } | null)?.observaciones ?? []).filter(o => o.nivel === "aviso");
      toast.success(confirmar ? `Z N° ${numero} confirmado` : `Z N° ${numero} guardado en borrador`,
        avisos.length ? { description: avisos.map(a => a.texto).join(" ") } : undefined);
      onGuardado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el Z");
    } finally {
      setGuardando(false);
    }
  };

  const campo = (i: number, k: keyof Renglon, etiqueta: string, ancho = "w-24") => (
    <div className="space-y-1">
      <Label htmlFor={`z-${i}-${k}`} className="text-[11px] text-muted-foreground">{etiqueta}</Label>
      <Input id={`z-${i}-${k}`} inputMode="decimal" value={renglones[i][k]} onChange={e => cambiar(i, k, e.target.value)} className={`h-8 ${ancho} font-mono text-xs`} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cargar un cierre Z</DialogTitle>
          <DialogDescription>Copiá los datos del ticket del Z. Un renglón por tipo de comprobante; los Tique-Factura A van además uno por uno en el Libro IVA.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1"><Label htmlFor="z-pv" className="text-xs">Punto de venta</Label>
            <Input id="z-pv" inputMode="numeric" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value.replace(/\D/g, "").slice(0, 5))} className="h-9" /></div>
          <div className="space-y-1"><Label htmlFor="z-numero" className="text-xs">Número de Z</Label>
            <Input id="z-numero" inputMode="numeric" value={numero} onChange={e => setNumero(e.target.value.replace(/\D/g, "").slice(0, 6))} className="h-9" /></div>
          <div className="space-y-1"><Label htmlFor="z-fecha" className="text-xs">Fecha</Label>
            <Input id="z-fecha" type="date" value={fecha} max={hoyAR()} onChange={e => setFecha(e.target.value)} className="h-9" /></div>
          <div className="space-y-1"><Label htmlFor="z-marca" className="text-xs">Marca del equipo</Label>
            <Input id="z-marca" value={marca} onChange={e => setMarca(e.target.value.slice(0, 40))} placeholder="Hasar, Epson…" className="h-9" /></div>
          <div className="space-y-1"><Label htmlFor="z-registro" className="text-xs">N° de registro</Label>
            <Input id="z-registro" value={registro} onChange={e => setRegistro(e.target.value.slice(0, 30))} className="h-9" /></div>
        </div>

        <div className="space-y-3">
          {renglones.map((r, i) => (
            <fieldset key={i} className="rounded-md border border-border/60 p-3 space-y-2">
              <legend className="sr-only">Renglón {i + 1}</legend>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`z-${i}-tipo`} className="text-[11px] text-muted-foreground">Comprobante</Label>
                  <Select value={r.tipo} onValueChange={v => cambiar(i, "tipo", v)}>
                    <SelectTrigger id={`z-${i}-tipo`} className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPOS_CONTROLADOR.map(t => <SelectItem key={t} value={String(t)}>{NOMBRE_TIPO_Z[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {campo(i, "desde", "Desde")}
                {campo(i, "hasta", "Hasta")}
                {campo(i, "cantidad", "Cantidad", "w-20")}
                {campo(i, "total", "Total", "w-28")}
                {renglones.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" className="h-8" aria-label={`Quitar el renglón ${i + 1}`}
                    onClick={() => setRenglones(prev => prev.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {campo(i, "neto21", "Neto 21%")}{campo(i, "iva21", "IVA 21%")}
                {campo(i, "neto105", "Neto 10,5%")}{campo(i, "iva105", "IVA 10,5%")}
                {campo(i, "neto27", "Neto 27%")}{campo(i, "iva27", "IVA 27%")}
                {campo(i, "exento", "Exento")}{campo(i, "noGravado", "No gravado")}{campo(i, "internos", "Internos")}
              </div>
            </fieldset>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5"
            onClick={() => setRenglones(prev => [...prev, vacio(String(TIPOS_CONTROLADOR.find(t => !prev.some(r => Number(r.tipo) === t)) ?? 83))])}>
            <Plus className="w-3.5 h-3.5" />Otro tipo de comprobante
          </Button>
        </div>

        <div className="text-xs space-y-1">
          <p className="font-medium">Total del Z {formatARS(totales.total)} · IVA {formatARS(totales.iva)}</p>
          {controles.length > 0 && (
            <ul className="list-disc pl-4">
              {controles.map(c => <li key={c.texto} className={c.nivel === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>{c.texto}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button variant="outline" onClick={() => void guardar(false)} disabled={guardando || incompleto}>Guardar en borrador</Button>
          <Button onClick={() => void guardar(true)} disabled={guardando || incompleto || errores.length > 0}>Confirmar el Z</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
