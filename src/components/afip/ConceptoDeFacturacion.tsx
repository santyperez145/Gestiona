/**
 * Qué factura el comercio por defecto: productos, servicios o ambos
 * (2026-10-22). Las facturas que salen solas de la caja o la tienda toman
 * este concepto; uno de servicios, además, el período del día. Ver la
 * migración 20261022000600.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isMissingFunction } from "@/lib/publicDataSource";

const OPCIONES = [
  { valor: "1", texto: "Productos", ayuda: "Vendés mercadería." },
  { valor: "2", texto: "Servicios", ayuda: "ARCA pide el período del servicio; por defecto, el día de la factura." },
  { valor: "3", texto: "Productos y servicios", ayuda: "Las dos cosas en la misma factura." },
];

export default function ConceptoDeFacturacion({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [concepto, setConcepto] = useState<string | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    void supabase.rpc("concepto_de_facturacion", { p_org: orgId }).then(({ data, error }) => {
      if (!vigente) return;
      if (error) {
        if (isMissingFunction(error)) setDisponible(false);
        else console.error("concepto_de_facturacion", error);
        return;
      }
      setConcepto(String(data ?? 1));
    });
    return () => { vigente = false; };
  }, [orgId]);

  if (!disponible) return null;

  const cambiar = async (valor: string) => {
    if (!orgId) return;
    const anterior = concepto;
    setConcepto(valor);
    setGuardando(true);
    const { error } = await supabase.rpc("configurar_concepto_de_facturacion", { p_org: orgId, p_concepto: Number(valor) });
    setGuardando(false);
    if (error) {
      setConcepto(anterior);
      toast.error(error.code === "42501" || error.code === "22023" ? error.message : "No se pudo guardar el concepto. Probá de nuevo.");
      return;
    }
    toast.success("Concepto de facturación guardado");
  };

  const actual = OPCIONES.find(o => o.valor === concepto);
  return (
    <section aria-labelledby="concepto-facturacion" className="rounded-xl border border-border/40 bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id="concepto-facturacion" className="text-sm font-semibold">¿Qué facturás?</h3>
          <p className="text-xs text-muted-foreground">Es el concepto de tus facturas por defecto, también las que salen solas de la caja y la tienda.</p>
        </div>
        <div className="w-56">
          <Label htmlFor="concepto-select" className="sr-only">Concepto de facturación</Label>
          <Select value={concepto ?? ""} onValueChange={v => void cambiar(v)} disabled={!canEdit || concepto === null || guardando}>
            <SelectTrigger id="concepto-select">{guardando ? <span className="flex items-center gap-2 text-sm"><Loader2 className="h-3.5 w-3.5 animate-spin" />Guardando…</span> : <SelectValue placeholder="Cargando…" />}</SelectTrigger>
            <SelectContent>{OPCIONES.map(o => <SelectItem key={o.valor} value={o.valor}>{o.texto}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {actual && <p className="mt-2 text-[11px] text-muted-foreground">{actual.ayuda}</p>}
    </section>
  );
}
