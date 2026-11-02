/**
 * «Facturación de Nerqia» (2026-11-01, migración 20261101000100): Nerqia le
 * factura al comercio cada cobro de su suscripción (RG 4291). Factura C de
 * servicios con el CUIT 20-44648443-6 en monotributo, desde la organización
 * de la plataforma que tenga ese certificado en ARCA. Acá se elige y activa
 * el emisor, se ve el estado de cada factura y se reintenta lo pendiente.
 */
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isMissingFunction } from "@/lib/publicDataSource";
import { formatARS, formatDateAR } from "@/lib/supabaseStore";
import { formatearCuit } from "@/lib/facturacionDeNerqia";

interface Candidata { id: string; nombre: string; tipo: string | null; ambiente: string | null; punto_venta: number | null }
interface Fila {
  id: string; estado: "emitida" | "pendiente_emisor" | "error"; motivo: string | null; intentos: number; created_at: string;
  monto: number; periodo_desde: string; periodo_hasta: string; comercio: string; numero: string | null; afip_status: string | null; cae: string | null;
}
export interface EstadoFacturacion {
  activa: boolean; cuit_esperado: string; org_emisora_id: string | null; org_emisora: string | null;
  emisor_cuit: string | null; emisor_tipo: string | null; punto_venta: number | null; ambiente: string | null;
  resumen: Record<string, number> | null; cobros_sin_registro: number; candidatas: Candidata[]; ultimas: Fila[];
}

const ESTADO: Record<Fila["estado"], { texto: string; variante: "default" | "secondary" | "destructive" }> = {
  emitida: { texto: "Emitida", variante: "default" },
  pendiente_emisor: { texto: "Esperando emisor", variante: "secondary" },
  error: { texto: "Con error", variante: "destructive" },
};

export default function FacturacionDeNerqia() {
  const [estado, setEstado] = useState<EstadoFacturacion | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emisora, setEmisora] = useState<string>("");
  const [guardando, setGuardando] = useState(false);
  const [reintentando, setReintentando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("platform_facturacion_de_nerqia" as never);
    if (e) {
      if (isMissingFunction(e)) { setDisponible(false); return; }
      console.error("[plataforma] facturación de Nerqia", e);
      setError(e.message);
      return;
    }
    const d = data as unknown as EstadoFacturacion;
    setEstado(d);
    setEmisora(d.org_emisora_id ?? d.candidatas[0]?.id ?? "");
    setError(null);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!disponible) return null;

  const configurar = async (activa: boolean) => {
    setGuardando(true);
    const { error: e } = await supabase.rpc("platform_configurar_facturacion" as never,
      { p_org_emisora: emisora || null, p_activa: activa } as never);
    setGuardando(false);
    if (e) { toast.error(e.message.replace(/^.*?:\s*/, "")); return; }
    toast.success(activa ? "Facturación de Nerqia activa: los cobros se facturan solos." : "Facturación de Nerqia pausada.");
    await cargar();
  };

  const reintentar = async () => {
    setReintentando(true);
    const { data, error: e } = await supabase.rpc("platform_reintentar_facturas_de_suscripcion" as never);
    setReintentando(false);
    if (e) { toast.error(e.message.replace(/^.*?:\s*/, "")); return; }
    const n = Number((data as { emitidas?: number } | null)?.emitidas ?? 0);
    toast.success(n === 0 ? "No había cobros para facturar." : n === 1 ? "Se emitió 1 factura." : `Se emitieron ${n} facturas.`);
    await cargar();
  };

  const pendientes = (estado?.resumen?.pendiente_emisor ?? 0) + (estado?.resumen?.error ?? 0) + (estado?.cobros_sin_registro ?? 0);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="facturacion-nerqia" data-testid="facturacion-de-nerqia">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="facturacion-nerqia" className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" />Facturación de Nerqia a los comercios
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada cobro de una suscripción genera la factura C de servicios con el período del plan
            {estado ? ` (CUIT ${formatearCuit(estado.cuit_esperado)}, monotributo)` : ""} y se autoriza en ARCA sola.
          </p>
        </div>
        {estado && (
          <Badge variant={estado.activa ? "default" : "secondary"}>{estado.activa ? "Activa" : "Pausada"}</Badge>
        )}
      </div>

      {error && <p className="text-xs text-destructive">No pudimos leer la facturación: {error}</p>}
      {!estado && !error && <p className="text-xs text-muted-foreground">Leyendo…</p>}

      {estado && (
        <>
          {estado.candidatas.length === 0 ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              Ninguna organización tiene en ARCA el CUIT {formatearCuit(estado.cuit_esperado)}. Creá la organización de Nerqia y conectá su
              certificado en ARCA (lo genera el dueño con su clave fiscal); después volvé acá para activarla. Mientras tanto los cobros quedan
              registrados y se facturan al activarla.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] flex-1 text-xs text-muted-foreground">Organización emisora
                <Select value={emisora} onValueChange={setEmisora}>
                  <SelectTrigger className="mt-1 h-9" aria-label="Organización emisora"><SelectValue placeholder="Elegí la organización" /></SelectTrigger>
                  <SelectContent>
                    {estado.candidatas.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre} · {c.tipo ?? "sin condición"} · PV {c.punto_venta ?? "—"} · {c.ambiente ?? "—"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {estado.activa ? (
                <Button variant="outline" size="sm" disabled={guardando} onClick={() => void configurar(false)}>Pausar</Button>
              ) : (
                <Button size="sm" disabled={guardando || !emisora} onClick={() => void configurar(true)}>
                  {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Activar
                </Button>
              )}
            </div>
          )}

          {estado.ambiente === "homologacion" && estado.activa && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              El emisor está en homologación: las facturas salen de prueba, sin validez fiscal. Pasalo a producción en su ARCA.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span data-testid="resumen-facturacion-nerqia">
              {estado.resumen?.emitida ?? 0} emitidas · {pendientes} por facturar
            </span>
            <Button variant="ghost" size="sm" className="h-8" disabled={reintentando || !estado.activa || pendientes === 0} onClick={() => void reintentar()}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${reintentando ? "animate-spin" : ""}`} />Facturar lo pendiente
            </Button>
          </div>

          {estado.ultimas.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Comercio</th>
                    <th className="px-2 py-1.5 text-left font-medium">Período</th>
                    <th className="px-2 py-1.5 text-right font-medium">Importe</th>
                    <th className="px-2 py-1.5 text-left font-medium">Factura</th>
                    <th className="px-2 py-1.5 text-left font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {estado.ultimas.map(f => (
                    <tr key={f.id}>
                      <td className="px-2 py-1.5">{f.comercio}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDateAR(f.periodo_desde)} → {formatDateAR(f.periodo_hasta)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatARS(Number(f.monto))}</td>
                      <td className="px-2 py-1.5">{f.numero ?? "—"}{f.cae ? <span className="block text-muted-foreground">CAE {f.cae}</span> : f.afip_status === "pending" ? <span className="block text-muted-foreground">CAE en trámite</span> : null}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant={ESTADO[f.estado].variante}>{ESTADO[f.estado].texto}</Badge>
                        {f.motivo && <span className="mt-0.5 block text-muted-foreground">{f.motivo}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
