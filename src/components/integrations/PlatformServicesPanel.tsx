import { useEffect, useState } from "react";
import { Sparkles, Mail, Database, MessageSquare, CreditCard, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { estadoDeServicios, type EstadoDeServicio } from "@/lib/estadoDeServicios";
import { useEntitlements } from "@/lib/useEntitlements";

/**
 * Servicios que vienen con Nerqia (claves de la plataforma, el comercio no
 * configura nada).
 *
 * 2026-10-15 (funciones incoherentes): todos decían «✓ Activo» escrito fijo.
 * WhatsApp en automatizaciones no está configurado en la plataforma y el
 * respaldo de un negocio puede fallar; ahora el correo y WhatsApp salen de
 * `mensajeria_de_plataforma` y los respaldos, del último respaldo del negocio.
 */
const ICONOS = { ia: Sparkles, correo: Mail, campanas: Mail, respaldos: Database, suscripcion: CreditCard, whatsapp: MessageSquare } as const;
const COLORES = {
  ia: "text-primary bg-muted/10", correo: "text-blue-400 bg-blue-500/10", campanas: "text-emerald-400 bg-emerald-500/10",
  respaldos: "text-amber-400 bg-amber-500/10", suscripcion: "text-indigo-400 bg-indigo-500/10", whatsapp: "text-green-400 bg-green-500/10",
} as const;
const TONO: Record<EstadoDeServicio["estado"], string> = {
  activo: "text-emerald-400",
  atencion: "text-amber-500",
  no_disponible: "text-muted-foreground",
  sin_datos: "text-muted-foreground",
};

export default function PlatformServicesPanel() {
  const { activeOrg, activeRole } = useOrg();
  const { canUseAI, loading: cargandoPlan } = useEntitlements();
  const [servicios, setServicios] = useState<EstadoDeServicio[]>(() => estadoDeServicios({ mensajeria: undefined, ultimoRespaldo: undefined, puedeVerRespaldos: false }));

  useEffect(() => {
    if (!activeOrg) return;
    let vigente = true;
    const puedeVerRespaldos = activeRole === "owner";
    Promise.all([
      supabase.rpc("mensajeria_de_plataforma"),
      puedeVerRespaldos
        ? supabase.from("organization_backup_snapshots").select("status, created_at").eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]).then(([mensajeria, respaldo]) => {
      if (!vigente) return;
      if (mensajeria.error) console.warn("[servicios] mensajería de plataforma", mensajeria.error);
      if (respaldo.error) console.warn("[servicios] último respaldo", respaldo.error);
      setServicios(estadoDeServicios({
        mensajeria: mensajeria.error ? null : (mensajeria.data as { email_listo?: boolean; smtp_configurado?: boolean; whatsapp_listo?: boolean } | null),
        ultimoRespaldo: respaldo.error ? null : (respaldo.data as { status: string; created_at: string } | null),
        puedeVerRespaldos,
        iaIncluida: cargandoPlan ? undefined : canUseAI,
      }));
    });
    return () => { vigente = false; };
  }, [activeOrg, activeRole, canUseAI, cargandoPlan]);

  return (
    <div className="bg-gradient-to-br from-primary/5 to-transparent border border-primary/20 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-primary/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Servicios de Nerqia</span>
        <span className="text-xs text-muted-foreground ml-auto">Sin configuración de tu parte</span>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-start gap-2 mb-4 text-xs text-muted-foreground bg-muted/20 rounded-lg p-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary/70" />
          <p>
            Estos servicios los provee Nerqia: <strong className="text-foreground">no necesitás contratar nada ni configurar claves</strong>. Cada uno dice si hoy está funcionando.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {servicios.map(s => {
            const Icono = ICONOS[s.id];
            const [color, fondo] = COLORES[s.id].split(" ");
            return (
              <div key={s.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/10 border border-border/40" data-testid={`servicio-${s.id}`}>
                <div className={`w-8 h-8 rounded-lg ${fondo} flex items-center justify-center shrink-0`}>
                  <Icono className={`w-4 h-4 ${color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-tight">{s.nombre}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.detalle}</p>
                </div>
                <span className={`text-[10px] font-medium shrink-0 ${TONO[s.estado]}`}>{s.etiqueta}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
