/**
 * Oferta de E5 en el Inicio: a las 4 semanas de uso, al dueño o administrador
 * de un comercio que todavía no paga, lo lleva a la cuenta de «Lo que Nerqia
 * reemplaza» en Mi plan. Ver `src/lib/ofertaE5.ts`.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { claveOfertaE5, mostrarOfertaE5, pospuestaHasta, semanasDeUso } from "@/lib/ofertaE5";
import { Button } from "@/components/ui/button";

function leer(clave: string): string | null {
  try { return window.localStorage.getItem(clave); } catch { return null; }
}
function guardar(clave: string, valor: string) {
  try { window.localStorage.setItem(clave, valor); } catch { /* sin almacenamiento: se vuelve a mostrar */ }
}

export default function OfertaStarterE5() {
  const { activeOrg, activeRole } = useOrg();
  const [visible, setVisible] = useState(false);
  const orgId = activeOrg?.id;
  const creada = activeOrg?.created_at;

  useEffect(() => {
    setVisible(false);
    if (!orgId || (activeRole !== "owner" && activeRole !== "admin")) return;
    let activo = true;
    supabase.rpc("suscripcion_de_organizacion", { p_org: orgId }).then(({ data, error }) => {
      if (!activo) return;
      if (error) { console.error("OfertaStarterE5 / suscripción", error); return; }
      const sub = data as unknown as { estado?: string; plan?: { code?: string } | null } | null;
      setVisible(mostrarOfertaE5({
        orgCreadaAt: creada, rol: activeRole, planCode: sub?.plan?.code, estado: sub?.estado,
        pospuestaHasta: leer(claveOfertaE5(orgId)), ahora: new Date(),
      }));
    });
    return () => { activo = false; };
  }, [orgId, activeRole, creada]);

  if (!visible || !orgId) return null;
  const semanas = semanasDeUso(creada, new Date()) ?? 4;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-primary/30 bg-primary/5 px-4 py-3 text-sm" aria-label="Oferta del plan Starter">
      <p>
        <span className="font-semibold">Ya llevás {semanas} semanas con Nerqia.</span>{" "}
        <span className="text-muted-foreground">Mirá cuánto dejarías de pagar en otras herramientas con el plan Starter.</span>
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => { guardar(claveOfertaE5(orgId), pospuestaHasta(new Date())); setVisible(false); }}>
          Más adelante
        </Button>
        <Button size="sm" asChild><Link to="/mi-plan#lo-que-reemplaza">Ver la cuenta</Link></Button>
      </div>
    </section>
  );
}
