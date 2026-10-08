/**
 * ModuleGuard — bloquea el acceso directo por URL a un módulo sin `can_view`.
 *
 * Filtrar el sidebar no alcanza: hasta ahora, con escribir /deudas en la barra
 * de direcciones se entraba igual sin importar los permisos configurados.
 *
 * Alcance honesto: esto es una barrera de interfaz. El límite de seguridad
 * real sigue siendo la RLS por organización — un usuario con sesión válida
 * puede consultar la API directamente. Sirve para separar responsabilidades
 * dentro de un equipo, no para contener a un atacante.
 */
import { useLocation } from "react-router-dom";
import { moduleForRoute } from "@/lib/moduleMap";
import ModuleAccessGate from "@/components/auth/ModuleAccessGate";

export default function ModuleGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const moduleKey = moduleForRoute(pathname);
  return <ModuleAccessGate module={moduleKey}>{children}</ModuleAccessGate>;
}
