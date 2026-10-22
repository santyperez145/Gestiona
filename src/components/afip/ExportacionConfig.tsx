/**
 * Factura de exportación «E» en la página de ARCA (2026-10-22): el punto de
 * venta de exportación (tipo «Comprobantes de Exportación – Web Services») y
 * las listas que publica ARCA (países, Incoterms, monedas). Ver
 * `arca-fex` y la migración 20261022001100.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { isMissingFunction } from "@/lib/publicDataSource";

interface Estado { punto_venta_exportacion: number | null; punto_venta: number | null; environment: string | null; modo: string | null; parametros_at: string | null }

export default function ExportacionConfig({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [disponible, setDisponible] = useState(true);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [punto, setPunto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [trayendo, setTrayendo] = useState(false);
  const [puntosArca, setPuntosArca] = useState<{ numero: number; bloqueado: boolean }[] | null>(null);

  const leer = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase.rpc("estado_exportacion", { p_org: orgId });
    if (error) { if (isMissingFunction(error)) setDisponible(false); else console.error("estado_exportacion", error); return; }
    const e = data as unknown as Estado;
    setEstado(e);
    setPunto(e.punto_venta_exportacion == null ? "" : String(e.punto_venta_exportacion));
  }, [orgId]);

  useEffect(() => { void leer(); }, [leer]);
  if (!disponible) return null;

  const n = Number(punto);
  const puntoMal = punto !== "" && (!Number.isInteger(n) || n < 1 || n > 99998 || n === estado?.punto_venta);

  const guardar = async () => {
    if (!orgId || puntoMal) return;
    setGuardando(true);
    const { error } = await supabase.rpc("configurar_exportacion", { p_org: orgId, p_punto_venta_exportacion: punto === "" ? null : n });
    setGuardando(false);
    if (error) { toast.error(error.code === "42501" || error.code === "22023" ? error.message : "No se pudo guardar. Probá de nuevo."); return; }
    toast.success("Punto de venta de exportación guardado");
    void leer();
  };

  const traer = async () => {
    if (!orgId) return;
    setTrayendo(true);
    const { data, error } = await supabase.functions.invoke("arca-fex", { body: { action: "parametros", org_id: orgId } });
    setTrayendo(false);
    const mensaje = await mensajeDeEdgeFunction(error, data);
    if (mensaje) { toast.error(mensaje); return; }
    const r = data as { puntos_venta?: { numero: number; bloqueado: boolean }[] };
    setPuntosArca(r.puntos_venta ?? []);
    toast.success("Listas de ARCA actualizadas");
    void leer();
  };

  const propio = estado?.modo === "propio";

  return (
    <section aria-labelledby="exportacion-config" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="exportacion-config" className="flex items-center gap-2 text-sm font-semibold"><Globe2 className="h-4 w-4" aria-hidden />Factura de exportación (E)</h3>
      <p className="text-xs text-muted-foreground">
        Para vender al exterior. Se emite con tu propio certificado, asociado en ARCA al servicio «Factura Electrónica de Exportación»,
        en un punto de venta de tipo «Comprobantes de Exportación – Web Services».
      </p>
      {estado && !propio && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Primero cargá tu propio certificado de ARCA: la factura E no se emite con el de Nerqia.</p>
      )}

      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={ev => { ev.preventDefault(); void guardar(); }}>
        <div className="w-40">
          <Label htmlFor="expo-punto" className="text-xs">Punto de venta de exportación</Label>
          <Input id="expo-punto" inputMode="numeric" disabled={!canEdit || !estado} aria-invalid={puntoMal} value={punto}
            onChange={ev => setPunto(ev.target.value.replace(/\D/g, "").slice(0, 5))} />
        </div>
        {canEdit && <Button type="submit" size="sm" disabled={!estado || guardando || puntoMal}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>}
        {canEdit && propio && (
          <Button type="button" size="sm" variant="outline" disabled={trayendo} onClick={() => void traer()}>
            {trayendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Traer listas de ARCA
          </Button>
        )}
      </form>
      {puntoMal && <p role="alert" className="mt-1 text-[11px] text-destructive">Tiene que ser un número del 1 al 99998, distinto del punto de venta de CAE{estado?.punto_venta ? ` (${estado.punto_venta})` : ""}.</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {estado?.parametros_at ? `Países e Incoterms traídos de ARCA el ${fechaFiscalArgentina(estado.parametros_at)}.` : "Todavía no se trajeron de ARCA los países e Incoterms."}
      </p>
      {puntosArca && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {puntosArca.length
            ? `Puntos de venta de exportación habilitados en ARCA: ${puntosArca.map(p => `${p.numero}${p.bloqueado ? " (bloqueado)" : ""}`).join(", ")}.`
            : "ARCA no tiene puntos de venta de exportación para tu CUIT: dalo de alta en «Administración de puntos de venta y domicilios»."}
        </p>
      )}
    </section>
  );
}
