/**
 * «¿Cómo trabajás?» en el Inicio: elegir el perfil del menú con un clic.
 *
 * Medido 2026-10-11: ningún comercio había elegido perfil (está en Ajustes ›
 * Sistema desde el 2026-10-10), así que todos veían el menú completo, con
 * ~70 destinos. Aparece al dueño o administrador mientras no haya perfil;
 * «Dejar todo» lo esconde en este navegador. Se cambia cuando quiera en
 * Ajustes; lo que no entra sigue en «Más herramientas» y en el buscador.
 */
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { PERFILES_MENU, type PerfilMenu } from "@/lib/navigation";
import { saveSettingsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const claveSinPerfil = (orgId: string) => `nerqia.perfil-menu.omitido.${orgId}`;

function leer(clave: string): boolean {
  try { return window.localStorage.getItem(clave) === "1"; } catch { return false; }
}

export default function ElegirPerfilDelMenu() {
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const { perfilMenu, cargado } = useBusinessConfig();
  const orgId = activeOrg?.id;
  const [oculto, setOculto] = useState(false);
  const [guardando, setGuardando] = useState<PerfilMenu | null>(null);

  if (!user || !orgId || !cargado || perfilMenu || oculto || leer(claveSinPerfil(orgId))) return null;
  if (activeRole !== "owner" && activeRole !== "admin") return null;

  const elegir = async (perfil: PerfilMenu) => {
    setGuardando(perfil);
    try {
      await saveSettingsDB(user.id, { perfil_menu: perfil });
      window.dispatchEvent(new CustomEvent("nerqia:ajustes-guardados"));
      setOculto(true);
      toast.success("Listo: el menú muestra lo que usás", { description: "Lo demás está en «Más herramientas». Se cambia en Ajustes." });
    } catch (error) {
      console.error("ElegirPerfilDelMenu", error);
      toast.error("No se pudo guardar el perfil del menú");
    } finally {
      setGuardando(null);
    }
  };

  const dejarTodo = () => {
    try { window.localStorage.setItem(claveSinPerfil(orgId), "1"); } catch { /* se vuelve a mostrar */ }
    setOculto(true);
  };

  return (
    <section className="rounded-[8px] border border-border bg-card px-4 py-3 text-sm space-y-3" aria-labelledby="perfil-menu-titulo">
      <div>
        <p id="perfil-menu-titulo" className="font-semibold">¿Cómo trabajás? Ordenamos el menú a tu medida</p>
        <p className="text-muted-foreground">Hoy ves todas las pantallas. Elegí una opción y queda a mano sólo lo que usás.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {PERFILES_MENU.map(p => (
          <Button
            key={p.id} type="button" variant="outline" disabled={guardando !== null}
            className="h-auto flex-col items-start whitespace-normal py-2 text-left"
            onClick={() => void elegir(p.id)}
          >
            <span className="font-medium">{p.label}</span>
            <span className="text-xs font-normal text-muted-foreground">{p.descripcion}</span>
          </Button>
        ))}
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={dejarTodo}>Dejar todo como está</Button>
    </section>
  );
}
