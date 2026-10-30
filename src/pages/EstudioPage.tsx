/**
 * Portal del contador (2026-10-30): todos sus clientes de Nerqia, el estado
 * fiscal del mes de cada uno y el paquete del mes con un clic.
 *
 * El contador no es miembro de ningún negocio: lo que ve sale de
 * `estudio_clientes` y `estudio_datos_mes` (sólo lo fiscal, de sólo lectura).
 * El paquete se arma con el mismo código que la pantalla de ARCA del comercio
 * (src/lib/mesFiscal.ts), y cada descarga queda en la auditoría del negocio.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, Loader2, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatARS } from "@/lib/supabaseStore";
import { diaAR, mesAR } from "@/lib/fechaAR";
import { periodoAPresentar, type ComprobanteVenta } from "@/lib/libroIvaVentas";
import { isMissingFunction } from "@/lib/publicDataSource";
import { descargarBlob, paqueteDelMes, type DatosDelMes } from "@/lib/mesFiscal";
import { guardarInvitacionPendiente, invitacionPendiente, olvidarInvitacionPendiente } from "@/lib/estudio";
import type { ComprobanteCompra } from "@/lib/libroIvaCompras";
import type { RetencionSufrida } from "@/lib/subdiarioIva";
import type { InscripcionIibb } from "@/lib/liquidacionIibb";
import type { CierreZ, TiqueA } from "@/lib/cierreZ";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandLogo from "@/components/shared/BrandLogo";

type Cliente = {
  org_id: string; negocio: string; razon_social: string | null; cuit: string | null; tipo_emisor: string | null;
  facturas: number; total_facturado: number; compras: number; cierres_z: number; cierres_z_borrador: number; retenciones: number;
};

type DatosRpc = {
  razon_social: string | null; cuit: string | null; monotributo: boolean;
  comprobantes: ComprobanteVenta[]; homologacion: number; compras: ComprobanteCompra[]; retenciones: RetencionSufrida[];
  inscripciones: InscripcionIibb[]; cierres: CierreZ[]; borradores_z: number; tiques_a: TiqueA[];
};

const CONDICION: Record<string, string> = { responsable_inscripto: "Responsable inscripto", monotributo: "Monotributo", exento: "Exento" };

export default function EstudioPage() {
  usePageTitle("Portal del contador");
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [periodo, setPeriodo] = useState(() => periodoAPresentar(mesAR()));
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armando, setArmando] = useState<string | null>(null);
  const [aceptando, setAceptando] = useState(false);

  const token = params.get("invitacion") ?? invitacionPendiente();

  // Aceptar la invitación del enlace (o la que quedó guardada antes de entrar).
  useEffect(() => {
    if (authLoading || !token) return;
    if (!user) { guardarInvitacionPendiente(token); return; }
    let vigente = true;
    setAceptando(true);
    void (async () => {
      const { data, error: e } = await supabase.rpc("aceptar_invitacion_contador" as never, { p_token: token } as never);
      if (!vigente) return;
      setAceptando(false);
      olvidarInvitacionPendiente();
      if (params.has("invitacion")) { params.delete("invitacion"); setParams(params, { replace: true }); }
      if (e) { toast.error(e.message); return; }
      const r = data as { negocio?: string; ya_aceptada?: boolean } | null;
      if (!r?.ya_aceptada) toast.success(`Ya tenés acceso a ${r?.negocio ?? "tu cliente"}`);
      setClientes(null);
    })();
    return () => { vigente = false; };
  }, [authLoading, user, token, params, setParams]);

  const cargar = useCallback(async () => {
    if (!user) return;
    setError(null);
    const { data, error: e } = await supabase.rpc("estudio_clientes" as never, { p_periodo: periodo } as never);
    if (e) {
      setError(isMissingFunction(e) ? "El portal del contador todavía no está disponible." : "No se pudieron leer tus clientes. Reintentá en unos minutos.");
      if (!isMissingFunction(e)) console.error("[Estudio] clientes", e);
      setClientes([]);
      return;
    }
    setClientes((data ?? []) as Cliente[]);
  }, [user, periodo]);
  useEffect(() => { if (!aceptando) void cargar(); }, [cargar, aceptando]);

  const paquete = async (c: Cliente) => {
    setArmando(c.org_id);
    try {
      const { data, error: e } = await supabase.rpc("estudio_datos_mes" as never, { p_org: c.org_id, p_periodo: periodo } as never);
      if (e) throw e;
      const d = data as unknown as DatosRpc;
      const datos: DatosDelMes = {
        periodo, monotributo: d.monotributo, razonSocial: d.razon_social, cuit: d.cuit,
        comprobantes: d.comprobantes, homologacion: Number(d.homologacion ?? 0),
        compras: d.compras.map(x => ({ ...x, alicuotas: x.alicuotas ?? [] })), retenciones: d.retenciones,
        inscripciones: d.inscripciones, cierres: d.cierres, borradoresZ: Number(d.borradores_z ?? 0), tiquesA: d.tiques_a, diaDe: diaAR,
      };
      const [XLSX, { default: JSZip }] = await Promise.all([import("xlsx"), import("jszip")]);
      const resultado = await paqueteDelMes(XLSX, JSZip, datos);
      // La descarga queda en la auditoría del negocio antes de entregarla: sin
      // registro, no hay archivo.
      const registro = await supabase.rpc("estudio_registrar_descarga" as never, { p_org: c.org_id, p_periodo: periodo } as never);
      if (registro.error) throw registro.error;
      descargarBlob(resultado.nombre.replace("contador-", `${(d.cuit ?? c.negocio).replace(/[^\w-]+/g, "")}-`), resultado.blob);
      toast.success(resultado.pendientes.length ? `${c.negocio}: hay ${resultado.pendientes.length} punto(s) para revisar en LEAME.txt` : `${c.negocio}: paquete listo`);
    } catch (e) {
      console.error("[Estudio] paquete", e);
      toast.error(e instanceof Error ? e.message : "No se pudo armar el paquete");
    } finally {
      setArmando(null);
    }
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-[420px] space-y-6 text-center">
          <BrandLogo eager className="flex justify-center" markClassName="h-7 w-7" nameClassName="text-[15px] text-foreground/80" />
          <div className="rounded-[10px] border border-border/60 bg-card p-8 space-y-4">
            <Briefcase className="w-6 h-6 text-primary mx-auto" />
            <h1 className="font-display text-lg font-bold">Portal del contador</h1>
            <p className="text-sm text-muted-foreground">
              {token ? "Entrá con el email al que te llegó la invitación para aceptarla." : "Entrá con tu cuenta para ver a tus clientes de Nerqia."}
            </p>
            <Button className="w-full" onClick={() => navigate("/login")}>Entrar</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-display text-xl font-bold">Portal del contador</h1>
              <p className="text-xs text-muted-foreground">Tus clientes de Nerqia. Sólo lo fiscal, de sólo lectura; cada descarga queda registrada en el negocio.</p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="estudio-periodo" className="text-xs">Período</Label>
              <Input id="estudio-periodo" type="month" value={periodo} max={mesAR()} onChange={e => { setPeriodo(e.target.value); setClientes(null); }} className="h-9 w-40" />
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void cargar()}><RefreshCw className="w-3.5 h-3.5" />Actualizar</Button>
          </div>
        </div>

        {aceptando && <p role="status" className="text-sm text-muted-foreground">Aceptando la invitación…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {clientes === null ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : clientes.length === 0 && !error ? (
          <div className="rounded-[10px] border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
            Todavía no tenés clientes. Pedile a cada comercio que te invite desde ARCA › Tu contador, con este email: <strong className="text-foreground">{user.email}</strong>.
          </div>
        ) : (
          <div className="rounded-[10px] border border-border/60 bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Condición</th>
                  <th className="px-3 py-2.5 text-right font-medium">Facturas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Facturado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Compras</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cierres Z</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {clientes.map(c => (
                  <tr key={c.org_id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.razon_social || c.negocio}</p>
                      <p className="text-xs text-muted-foreground">{c.cuit ? `CUIT ${c.cuit}` : "Sin CUIT cargado"}{c.razon_social && c.razon_social !== c.negocio ? ` · ${c.negocio}` : ""}</p>
                    </td>
                    <td className="px-3 py-3 text-xs">{CONDICION[c.tipo_emisor ?? ""] ?? "—"}</td>
                    <td className="px-3 py-3 text-right font-mono">{c.facturas}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatARS(Number(c.total_facturado))}</td>
                    <td className="px-3 py-3 text-right font-mono">{c.tipo_emisor === "monotributo" ? "—" : c.compras}</td>
                    <td className="px-3 py-3 text-right">
                      <span className="font-mono">{c.cierres_z}</span>
                      {c.cierres_z_borrador > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{c.cierres_z_borrador} sin confirmar</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" className="gap-1.5" disabled={armando !== null} onClick={() => void paquete(c)}
                        aria-label={`Paquete del mes de ${c.razon_social || c.negocio}`}>
                        {armando === c.org_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}Paquete del mes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
