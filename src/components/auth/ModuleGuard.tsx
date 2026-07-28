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
import { useModulePerms } from "@/lib/permissionsContext";
import { moduleForRoute } from "@/lib/moduleMap";
import { Lock } from "lucide-react";

export default function ModuleGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const moduleKey = moduleForRoute(pathname);
  const perms = useModulePerms(moduleKey);

  if (!moduleKey || perms.loading || perms.canView) return <>{children}</>;

  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh] p-4">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          <Lock className="w-5 h-5 text-muted-foreground" />
        </div>
        <h1 className="text-base font-semibold mb-1">Sin acceso a esta sección</h1>
        <p className="text-sm text-muted-foreground">
          Tu rol no tiene permiso para ver este módulo. Si necesitás entrar,
          pedile a un administrador que lo habilite en Admin → Permisos.
        </p>
      </div>
    </div>
  );
}
