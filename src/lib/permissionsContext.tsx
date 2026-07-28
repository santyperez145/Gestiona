/**
 * PermissionsProvider — carga TODOS los `role_permissions` de la org+rol una
 * sola vez y los expone por contexto.
 *
 * Antes, `useModulePermissions(module)` disparaba una query por módulo y por
 * componente montado. Con el guard de rutas y el filtrado del sidebar eso
 * habría sido una query por ítem de navegación en cada render.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { defaultsForRole } from "@/lib/usePermissions";

export interface ModulePerms {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  /** true si vino de una fila de `role_permissions`, false si son defaults del rol */
  fromDb: boolean;
}

interface Ctx {
  loading: boolean;
  /** Permisos de un módulo. `module` vacío = sin restricción. */
  forModule: (module: string) => ModulePerms;
}

const PermissionsContext = createContext<Ctx | null>(null);

const ALLOW_ALL: ModulePerms = {
  canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, fromDb: false,
};

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { role, loading: roleLoading } = useUserRole();
  const { activeOrg, loading: orgLoading } = useOrg();
  const [rows, setRows] = useState<Record<string, ModulePerms>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading || orgLoading) return;
    if (!activeOrg?.id) { setRows({}); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    supabase
      .from("role_permissions")
      .select("module, can_view, can_create, can_edit, can_delete, can_export")
      .eq("org_id", activeOrg.id)
      .eq("role", role)
      .then(({ data }) => {
        if (cancelled) return;
        const map: Record<string, ModulePerms> = {};
        (data ?? []).forEach((r: any) => {
          map[r.module] = {
            canView: r.can_view ?? true,
            canCreate: r.can_create ?? false,
            canEdit: r.can_edit ?? false,
            canDelete: r.can_delete ?? false,
            canExport: r.can_export ?? false,
            fromDb: true,
          };
        });
        setRows(map);
        setLoading(false);
      }, () => { if (!cancelled) { setRows({}); setLoading(false); } });

    return () => { cancelled = true; };
  }, [activeOrg?.id, role, roleLoading, orgLoading]);

  const value = useMemo<Ctx>(() => {
    const d = defaultsForRole(role);
    const fallback: ModulePerms = {
      canView: d.can_view, canCreate: d.can_create, canEdit: d.can_edit,
      canDelete: d.can_delete, canExport: d.can_export, fromDb: false,
    };
    return {
      loading: loading || roleLoading || orgLoading,
      forModule: (module: string) => (module ? (rows[module] ?? fallback) : ALLOW_ALL),
    };
  }, [rows, role, loading, roleLoading, orgLoading]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/**
 * Permisos del módulo. Fuera del provider devuelve permitir-todo para no
 * romper componentes que se rendericen aislados (tests, storybook).
 */
export function useModulePerms(module: string): ModulePerms & { loading: boolean } {
  const ctx = useContext(PermissionsContext);
  if (!ctx) return { ...ALLOW_ALL, loading: false };
  return { ...ctx.forModule(module), loading: ctx.loading };
}

/**
 * Resolver de permisos para consultar varios módulos de una (filtrado del
 * sidebar). Devuelve una función estable, apta como dependencia de useMemo.
 */
export function usePermissionsResolver(): { loading: boolean; forModule: (m: string) => ModulePerms } {
  const ctx = useContext(PermissionsContext);
  const fallback = useMemo(() => ({ loading: false, forModule: () => ALLOW_ALL }), []);
  return ctx ?? fallback;
}
