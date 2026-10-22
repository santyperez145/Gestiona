/**
 * Contingencia CAEA (2026-10-22): si ARCA no responde, la factura igual sale,
 * con el CAEA de la quincena y en un punto de venta propio, y Nerqia se la
 * informa a ARCA cuando vuelve. Esta tarjeta la activa, muestra el CAEA y lo
 * que falta informar. Ver la migración 20261022000900 y `arca-caea`.
 */
import { useCallback, useEffect, useState } from "react";
import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { isMissingFunction } from "@/lib/publicDataSource";
import { nombreQuincena, type EstadoContingencia } from "@/lib/contingenciaCaea";

type RespuestaCaea = { ok?: boolean; error?: string; informados?: number; rechazados?: number; pendientes?: number };

async function llamarCaea(body: Record<string, unknown>): Promise<RespuestaCaea> {
  const { data, error } = await supabase.functions.invoke("arca-caea", { body });
  const mensaje = await mensajeDeEdgeFunction(error, data);
  if (mensaje) return { ok: false, error: mensaje };
  return (data ?? {}) as RespuestaCaea;
}

export default function ContingenciaCaea({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }) {
  const [disponible, setDisponible] = useState(true);
  const [estado, setEstado] = useState<EstadoContingencia | null>(null);
  const [habilitada, setHabilitada] = useState(false);
  const [punto, setPunto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [trabajando, setTrabajando] = useState<"solicitar" | "informar" | null>(null);

  const leer = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase.rpc("estado_contingencia", { p_org: orgId });
    if (error) { if (isMissingFunction(error)) setDisponible(false); else console.error("estado_contingencia", error); return; }
    const e = data as unknown as EstadoContingencia;
    setEstado(e);
    setHabilitada(e.habilitada);
    setPunto(e.punto_venta_caea == null ? "" : String(e.punto_venta_caea));
  }, [orgId]);

  useEffect(() => { void leer(); }, [leer]);
  if (!disponible) return null;

  const puntoNumero = Number(punto);
  const puntoMal = habilitada && (!Number.isInteger(puntoNumero) || puntoNumero < 1 || puntoNumero > 99999 || puntoNumero === estado?.punto_venta);

  const pedirCaea = async () => {
    if (!orgId) return;
    setTrabajando("solicitar");
    const r = await llamarCaea({ action: "solicitar", org_id: orgId });
    setTrabajando(null);
    if (r.ok) toast.success("CAEA al día");
    else toast.error(`${r.error ?? "ARCA no otorgó el CAEA."} Nerqia lo vuelve a pedir solo cada 6 horas.`);
    void leer();
  };

  const guardar = async () => {
    if (!orgId || puntoMal) return;
    setGuardando(true);
    const { error } = await supabase.rpc("configurar_contingencia", {
      p_org: orgId, p_habilitada: habilitada, p_punto_venta_caea: habilitada ? puntoNumero : null,
    });
    setGuardando(false);
    if (error) { toast.error(error.code === "42501" || error.code === "22023" ? error.message : "No se pudo guardar. Probá de nuevo."); return; }
    toast.success(habilitada ? "Contingencia activada" : "Contingencia desactivada");
    await leer();
    if (habilitada) await pedirCaea();
  };

  const reintentarInformes = async () => {
    if (!orgId) return;
    setTrabajando("informar");
    const r = await llamarCaea({ action: "informar", org_id: orgId });
    setTrabajando(null);
    if (!r.ok) toast.error(r.error ?? "No se pudieron informar los comprobantes.");
    else if ((r.rechazados ?? 0) > 0) toast.error(`ARCA rechazó ${r.rechazados} comprobante(s). Mirá el motivo en cada factura.`);
    else if ((r.pendientes ?? 0) > 0) toast.info(`Se informaron ${r.informados ?? 0}; ${r.pendientes} siguen esperando a ARCA.`);
    else toast.success(`Se informaron ${r.informados ?? 0} comprobante(s).`);
    void leer();
  };

  const vigente = estado?.caea_vigente;
  const proximo = estado?.caea_proximo;

  return (
    <section aria-labelledby="contingencia-caea" className="rounded-xl border border-border/40 bg-card p-4">
      <h3 id="contingencia-caea" className="flex items-center gap-2 text-sm font-semibold"><CloudOff className="h-4 w-4" aria-hidden />Si ARCA no responde (CAEA)</h3>
      <p className="text-xs text-muted-foreground">
        Con la contingencia activa, una factura que no consiguió CAE se puede emitir igual con el CAEA de la quincena.
        Nerqia se la informa a ARCA apenas vuelve, antes de la fecha tope.
      </p>

      <form className="mt-3 grid gap-3 md:grid-cols-[auto_12rem_auto] md:items-end" onSubmit={e => { e.preventDefault(); void guardar(); }}>
        <label className="flex items-center gap-2 text-sm md:pb-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!canEdit || !estado} checked={habilitada} onChange={e => setHabilitada(e.target.checked)} />
          Activar la contingencia
        </label>
        {habilitada && (
          <div>
            <Label htmlFor="caea-punto" className="text-xs">Punto de venta CAEA</Label>
            <Input id="caea-punto" inputMode="numeric" disabled={!canEdit} aria-invalid={puntoMal} value={punto}
              onChange={e => setPunto(e.target.value.replace(/\D/g, "").slice(0, 5))} />
          </div>
        )}
        {canEdit && <Button type="submit" size="sm" disabled={!estado || guardando || puntoMal}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>}
      </form>
      {habilitada && (
        <p className={`mt-1 text-[11px] ${puntoMal && punto !== "" ? "text-destructive" : "text-muted-foreground"}`} role={puntoMal && punto !== "" ? "alert" : undefined}>
          Tiene que ser un punto de venta distinto del de CAE{estado?.punto_venta ? ` (${estado.punto_venta})` : ""}, dado de alta para CAEA en
          «Administración de puntos de venta y domicilios» de ARCA.
        </p>
      )}

      {estado?.habilitada && (
        <div className="mt-4 grid gap-3 rounded-lg bg-muted/20 p-3 text-xs sm:grid-cols-2">
          <div>
            <p className="font-medium">CAEA de esta quincena</p>
            {vigente
              ? <p className="text-muted-foreground"><span className="font-mono text-foreground">{vigente.caea}</span> · {nombreQuincena(vigente.periodo, vigente.orden)}, informar hasta el {fechaFiscalArgentina(vigente.tope_informe)}</p>
              : <p className="text-amber-700 dark:text-amber-300">Todavía no hay CAEA: sin él no se puede emitir en contingencia.</p>}
            {proximo && <p className="mt-1 text-muted-foreground">Próxima quincena: <span className="font-mono">{proximo.caea}</span></p>}
            {canEdit && !vigente && (
              <Button size="sm" variant="outline" className="mt-2" disabled={trabajando !== null} onClick={() => void pedirCaea()}>
                {trabajando === "solicitar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Pedir CAEA ahora
              </Button>
            )}
          </div>
          <div>
            <p className="font-medium">Informes a ARCA</p>
            <p className="text-muted-foreground">
              {estado.pendientes_de_informar === 0
                ? "Todo lo emitido con CAEA está informado."
                : `${estado.pendientes_de_informar} comprobante(s) por informar${estado.rechazados ? `, ${estado.rechazados} rechazado(s)` : ""}. Se reintenta solo cada 6 horas.`}
            </p>
            {canEdit && estado.pendientes_de_informar > 0 && (
              <Button size="sm" variant="outline" className="mt-2" disabled={trabajando !== null} onClick={() => void reintentarInformes()}>
                {trabajando === "informar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Informar ahora
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
