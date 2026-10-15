import { ROUTES } from "@/app/routeManifest";
import { NAV_GROUPS } from "@/lib/navigation";

/**
 * El área del menú de una pantalla, para el encabezado (2026-10-15). Las
 * pantallas sin etiqueta propia decían todas «Nerqia · Commerce», también
 * Cheques y Conciliación bancaria, que son de Cobros y facturación.
 */
export function areaDeRuta(pathname: string): string {
  const ruta = ROUTES.find(r => r.path === pathname)
    ?? ROUTES.filter(r => r.path !== "/" && pathname.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const grupo = NAV_GROUPS.find(g => g.id === ruta?.nav?.group);
  return grupo?.label ? `Nerqia · ${grupo.label}` : "Nerqia";
}
