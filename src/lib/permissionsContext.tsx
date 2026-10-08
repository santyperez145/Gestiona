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
import { useAuth } from "@/lib/auth";
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
  error: string | null;
  refresh: () => void;
  /** Permisos de un módulo. `module` vacío = sin restricción. */
  forModule: (module: string) => ModulePerms;
}

const PermissionsContext = createContext<Ctx | null>(null);

const ALLOW_ALL: ModulePerms = {
  canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, fromDb: false,
};

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useUserRole();
  const { activeOrg, activeRole, loading: orgLoading } = useOrg();
  const [snapshot, setSnapshot] = useState<{
    key: string;
    rows: Record<string, ModulePerms>;
    failed: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const key = user?.id && activeOrg?.id && activeRole
    ? `${user.id}:${user.last_sign_in_at ?? ''}:${activeOrg.id}:${activeRole}:${role}:${revision}` : null;

  useEffect(() => {
    if (authLoading || roleLoading || orgLoading || !key) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const fail = (error: unknown) => {
      if (cancelled) return;
      console.error('[PermissionsProvider] permission lookup failed', error);
      setSnapshot({ key, rows: {}, failed: true });
    };
    supabase
      .from("role_permissions")
      .select("module, can_view, can_create, can_edit, can_delete, can_export")
      .eq("org_id", activeOrg.id)
      .eq("role", role)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          fail(error);
          return;
        }
        const map: Record<string, ModulePerms> = {};
        (data ?? []).forEach((r: any) => {
          map[r.module] = resolveModulePermissions(role, r);
        });
        setSnapshot({ key, rows: map, failed: false });
      }, fail);

    return () => { cancelled = true; };
  }, [activeOrg?.id, key, role, authLoading, roleLoading, orgLoading]);

  const value = useMemo<Ctx>(() => {
    // El cambio de identidad/contexto bloquea en el mismo render, antes del efecto.
    const pending = authLoading || roleLoading || orgLoading || Boolean(key && snapshot?.key !== key);
    const current = key && snapshot?.key === key ? snapshot : null;
    const ready = Boolean(current && !current.failed && !pending);
    const fallback = resolveModulePermissions(role);
    return {
      loading: pending,
      error: current?.failed ? 'No pudimos verificar tus permisos. Reintentá para continuar.' : null,
      refresh,
      forModule: (module: string) => !ready ? DENY_PERMISSIONS
        : (!module ? ALLOW_ALL : (current.rows[module] ?? fallback)),
    };
  }, [snapshot, role, activeRole, authLoading, roleLoading, orgLoading, key, refresh]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/**
 * Fuera del provider no hay autoridad de permisos: se deniega por defecto.
 */
export function useModulePerms(module: string): ModulePerms & { loading: boolean; error: string | null } {
  const ctx = useContext(PermissionsContext);
  if (!ctx) return { ...DENY_PERMISSIONS, loading: false, error: null };
  return { ...ctx.forModule(module), loading: ctx.loading, error: ctx.error };
}

export function useRefreshPermissions() {
  return useContext(PermissionsContext)?.refresh;
}

/**
 * Resolver de permisos para consultar varios módulos de una (filtrado del
 * sidebar). Devuelve una función estable, apta como dependencia de useMemo.
 */
export function usePermissionsResolver(): { loading: boolean; error: string | null; forModule: (m: string) => ModulePerms } {
  const ctx = useContext(PermissionsContext);
  const fallback = useMemo(() => ({ loading: false, error: null, forModule: () => DENY_PERMISSIONS }), []);
  return ctx ?? fallback;
}
