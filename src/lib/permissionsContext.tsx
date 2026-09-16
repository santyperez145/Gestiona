/**
 * PermissionsProvider — carga TODOS los `role_permissions` de la org+rol una
 * sola vez y los expone por contexto.
 *
 * Antes, `useModulePermissions(module)` disparaba una query por módulo y por
 * componente montado. Con el guard de rutas y el filtrado del sidebar eso
 * habría sido una query por ítem de navegación en cada render.
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { DENY_PERMISSIONS, resolveModulePermissions } from "@/lib/permissionPolicy";

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
  refresh: () => void;
  /** Permisos de un módulo. `module` vacío = sin restricción. */
  forModule: (module: string) => ModulePerms;
}

const PermissionsContext = createContext<Ctx | null>(null);

const ALLOW_ALL: ModulePerms = {
  canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, fromDb: false,
};

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { role, loading: roleLoading } = useUserRole();
  const { activeOrg, activeRole, loading: orgLoading } = useOrg();
  const [rows, setRows] = useState<Record<string, ModulePerms>>({});
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const key = activeOrg?.id && activeRole ? `${activeOrg.id}:${role}:${revision}` : null;

  useEffect(() => {
    if (roleLoading || orgLoading) return;
    if (!key) { setRows({}); setLoadedKey(null); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setLoadedKey(null);
    supabase
      .from("role_permissions")
      .select("module, can_view, can_create, can_edit, can_delete, can_export")
      .eq("org_id", activeOrg.id)
      .eq("role", role)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[PermissionsProvider] permission lookup failed', error);
          setRows({});
          setLoading(false);
          return;
        }
        const map: Record<string, ModulePerms> = {};
        (data ?? []).forEach((r: any) => {
          map[r.module] = resolveModulePermissions(role, r);
        });
        setRows(map);
        setLoadedKey(key);
        setLoading(false);
      }, (error) => { if (!cancelled) { console.error('[PermissionsProvider] permission lookup failed', error); setRows({}); setLoading(false); } });

    return () => { cancelled = true; };
  }, [activeOrg?.id, key, role, roleLoading, orgLoading]);

  const value = useMemo<Ctx>(() => {
    const pending = loading || roleLoading || orgLoading;
    const ready = Boolean(key && loadedKey === key && !pending);
    const fallback = resolveModulePermissions(role);
    return {
      loading: pending,
      refresh,
      forModule: (module: string) => !ready ? DENY_PERMISSIONS : (module ? (rows[module] ?? fallback) : ALLOW_ALL),
    };
  }, [rows, role, loading, roleLoading, orgLoading, key, loadedKey, refresh]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/**
 * Fuera del provider no hay autoridad de permisos: se deniega por defecto.
 */
export function useModulePerms(module: string): ModulePerms & { loading: boolean } {
  const ctx = useContext(PermissionsContext);
  if (!ctx) return { ...DENY_PERMISSIONS, loading: false };
  return { ...ctx.forModule(module), loading: ctx.loading };
}

export function useRefreshPermissions() {
  return useContext(PermissionsContext)?.refresh;
}

/**
 * Resolver de permisos para consultar varios módulos de una (filtrado del
 * sidebar). Devuelve una función estable, apta como dependencia de useMemo.
 */
export function usePermissionsResolver(): { loading: boolean; forModule: (m: string) => ModulePerms } {
  const ctx = useContext(PermissionsContext);
  const fallback = useMemo(() => ({ loading: false, forModule: () => DENY_PERMISSIONS }), []);
  return ctx ?? fallback;
}
