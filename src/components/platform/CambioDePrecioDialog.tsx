import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, Loader2, Users } from "lucide-react";

/**
 * Programar un cambio de precio para quien YA está suscripto.
 *
 * ── Por qué es un paso aparte ─────────────────────────────────────────────
 *
 * Editar `plans.price_ars_monthly` cambia el precio de lista: lo que paga quien
 * se suscriba de ahí en adelante. Eso es instantáneo y está bien.
 *
 * ⚠️ Lo que NO puede pasar en silencio es cambiarle el precio a quien ya está
 * adentro. Hasta el 2026-08-27 no pasaba nada en absoluto —el `preapproval` de
 * MercadoPago se creó con el precio del día y nadie lo actualizaba— así que un
 * cambio de precio no llegaba nunca a los actuales. Y `Mi plan` les mostraba el
 * precio nuevo mientras les seguían cobrando el viejo.
 *
 * 📌 Este diálogo existe para que la decisión se tome viendo a quién toca. Un
 * cambio de precio a ciegas es cómo se pierde una cartera entera sin enterarse.
 */

interface Impacto {
  afectados: number;
  suben: number;
  bajan: number;
  sin_constancia: number;
  mrr_actual: number;
  mrr_nuevo: number;
  preaviso_dias: number;
  precio_actual_lista: number | null;
}

const pesos = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);

/** `YYYY-MM-DD` de hoy más N días, en hora local. */
function enDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CambioDePrecioDialog({
  open, onOpenChange, planId, planName, ciclo, precioNuevo, onProgramado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planId: string;
  planName: string;
  ciclo: "mensual" | "anual";
  precioNuevo: number;
  onProgramado?: () => void;
}) {
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    (async () => {
      const { data, error: err } = await supabase.rpc("impacto_cambio_de_precio", {
        p_plan_id: planId, p_ciclo: ciclo, p_precio_nuevo: precioNuevo,
      });
      if (!vivo) return;
      if (err) {
        console.error("impacto_cambio_de_precio falló", err);
        setError(err.message);
      } else {
        const i = data as unknown as Impacto;
        setImpacto(i);
        // La fecha arranca en la más temprana permitida: el preaviso mínimo.
        setDesde(enDias(i?.preaviso_dias ?? 30));
      }
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [open, planId, ciclo, precioNuevo]);

  const programar = async () => {
    setGuardando(true);
    const { data, error: err } = await supabase.rpc("programar_cambio_de_precio", {
      p_plan_id: planId, p_ciclo: ciclo, p_precio_nuevo: precioNuevo,
      p_vigente_desde: desde, p_motivo: motivo.trim() || null,
    });
    setGuardando(false);
    if (err) {
      // El motivo lo escribe la base —«un aumento necesita 30 días de
      // preaviso»— y es lo único útil acá.
      console.error("programar_cambio_de_precio falló", err);
      toast.error(err.message);
      return;
    }
    const r = data as unknown as { alcance: number };
    toast.success(
      r.alcance === 1
        ? "Cambio programado. Se le avisa a 1 comercio."
        : `Cambio programado. Se le avisa a ${r.alcance} comercios.`,
    );
    onOpenChange(false);
    onProgramado?.();
  };

  const sube = (impacto?.suben ?? 0) > 0;
  const minimo = enDias(impacto?.preaviso_dias ?? 30);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cambiar el precio a los que ya están suscriptos</DialogTitle>
          <DialogDescription>
            El precio de lista de <strong>{planName}</strong> ya quedó en {pesos(precioNuevo)}{" "}
            {ciclo === "anual" ? "por año" : "por mes"} para quien se suscriba desde ahora.
            Esto es aparte: mueve el precio de los actuales, con aviso.
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Midiendo a quién afecta…
          </div>
        ) : error ? (
          <div className="rounded-[8px] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            No se pudo medir el impacto: {error}
          </div>
        ) : !impacto || impacto.afectados === 0 ? (
          <div className="rounded-[8px] border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            Ninguna suscripción activa queda en otro precio. No hay nada que programar.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[8px] border border-border bg-muted/20 p-3">
                <Users className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
                <div className="text-lg font-semibold">{impacto.afectados}</div>
                <div className="text-[11px] text-muted-foreground">afectados</div>
              </div>
              <div className="rounded-[8px] border border-border bg-muted/20 p-3">
                <ArrowUp className="mx-auto mb-1 h-4 w-4 text-destructive" />
                <div className="text-lg font-semibold">{impacto.suben}</div>
                <div className="text-[11px] text-muted-foreground">les sube</div>
              </div>
              <div className="rounded-[8px] border border-border bg-muted/20 p-3">
                <ArrowDown className="mx-auto mb-1 h-4 w-4 text-teal-600" />
                <div className="text-lg font-semibold">{impacto.bajan}</div>
                <div className="text-[11px] text-muted-foreground">les baja</div>
              </div>
            </div>

            <div className="rounded-[8px] border border-border p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ingreso mensual de este grupo, hoy</span>
                <span className="font-medium">{pesos(impacto.mrr_actual)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">Después del cambio</span>
                <span className="font-medium">{pesos(impacto.mrr_nuevo)}</span>
              </div>
            </div>

            {impacto.sin_constancia > 0 && (
              /* No se puede decir «tu precio pasa de X a Y» sin saber la X. */
              <div className="flex items-start gap-2 rounded-[8px] border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  De {impacto.sin_constancia} suscripción(es) no consta el monto autorizado.
                  El aviso les va a decir el precio nuevo y a pedirles que revisen el viejo
                  en su resumen de MercadoPago, en vez de inventarlo.
                </span>
              </div>
            )}

            <div>
              <Label htmlFor="desde">Rige desde</Label>
              <Input
                id="desde" type="date" value={desde} min={minimo}
                onChange={e => setDesde(e.target.value)}
              />
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarClock className="h-3 w-3" />
                {sube
                  ? `Un aumento necesita ${impacto.preaviso_dias} días de aviso: lo más temprano es el ${minimo}.`
                  : "Una baja puede regir hoy mismo: sólo beneficia a quien la recibe."}
              </p>
            </div>

            <div>
              <Label htmlFor="motivo">Motivo (se le muestra al comercio)</Label>
              <Textarea
                id="motivo" rows={2} value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ej: Actualización anual por costos de infraestructura."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {impacto?.afectados ? "Ahora no" : "Cerrar"}
          </Button>
          {!!impacto?.afectados && (
            <Button onClick={programar} disabled={guardando || !desde}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Programar y avisar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
