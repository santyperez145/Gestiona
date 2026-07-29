import { useState, useEffect, useCallback } from 'react';
import { useUserRole, AppRole } from '@/lib/useUserRole';
import { useOrg, PlatformRole } from '@/lib/orgContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * Módulos sobre los que se puede dar/quitar permiso. Tiene que coincidir con
 * `seed_default_permissions()` (migración 20260729000001) para que la UI de
 * AdminPage y el enforcement en la base hablen del mismo vocabulario.
 */
export const PERMISSION_MODULES = [
  'sales', 'pos', 'products', 'customers', 'crm', 'reports',
  'expenses', 'purchases', 'invoices', 'inventory', 'analytics',
  'marketing', 'support', 'settings', 'team', 'finance',
  'ecommerce', 'shipping', 'payments', 'influencers',
] as const;

export type PermissionModule = typeof PERMISSION_MODULES[number];

// ─── Role-based permission helpers ───────────────────────────────────────────

/** Derive sensible permission defaults from a role (used as fallback). */
export function defaultsForRole(role: AppRole) {
  const isAdmin    = role === 'admin';
  const isSeller   = role === 'vendedor';

  return {
    can_view:   true,
    can_create: isAdmin || isSeller,
    can_edit:   isAdmin,
    can_delete: isAdmin,
    can_export: isAdmin,
  };
}

// ─── usePermissions — global, role-based (backwards compat) ──────────────────

export function usePermissions() {
  const { role, loading } = useUserRole();

  return {
    loading,
    role,
    // Write operations
    canCreate: role === 'admin' || role === 'vendedor',
    canEdit:   role === 'admin',
    canDelete: role === 'admin',
    // Specific domains
    canSell:             role === 'admin' || role === 'vendedor',
    canManageSettings:   role === 'admin',
    canViewFinance:      role === 'admin' || role === 'vendedor',
    canManageTeam:       role === 'admin',
    canExport:           role === 'admin',
  };
}

// ─── ModulePermissions ────────────────────────────────────────────────────────

export interface ModulePermissions {
  canView:   boolean;
  canCreate: boolean;
  canEdit:   boolean;
  canDelete: boolean;
  canExport: boolean;
  loading:   boolean;
  /** True if permissions came from the DB override, false if from role defaults */
  fromDb:    boolean;
}

/**
 * Returns per-action permissions for `module` in the current org.
 *
 * Resolution order:
 *   1. Explicit row in `role_permissions` for (org_id, role, module)  →  use those values
 *   2. No row found  →  fall back to sensible role defaults
 *
 * The hook re-fetches only when org or role changes.
 */
export function useModulePermissions(module: string): ModulePermissions {
  const { role, loading: roleLoading } = useUserRole();
  const { activeOrg, loading: orgLoading } = useOrg();

  const [perms, setPerms] = useState<Omit<ModulePermissions, 'loading'>>(() => {
    const d = defaultsForRole('viewer');
    return { canView: d.can_view, canCreate: d.can_create, canEdit: d.can_edit, canDelete: d.can_delete, canExport: d.can_export, fromDb: false };
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading || orgLoading) return;

    const fetchPerms = async () => {
      setLoading(true);

      if (!activeOrg) {
        // No org — viewer defaults
        const d = defaultsForRole('viewer');
        setPerms({ canView: d.can_view, canCreate: d.can_create, canEdit: d.can_edit, canDelete: d.can_delete, canExport: d.can_export, fromDb: false });
        setLoading(false);
        return;
      }

      // Try DB override first
      const { data } = await supabase
        .from('role_permissions')
        .select('can_view, can_create, can_edit, can_delete, can_export')
        .eq('org_id', activeOrg.id)
        .eq('role', role)
        .eq('module', module)
        .maybeSingle();

      if (data) {
        setPerms({
          canView:   data.can_view   ?? true,
          canCreate: data.can_create ?? false,
          canEdit:   data.can_edit   ?? false,
          canDelete: data.can_delete ?? false,
          canExport: data.can_export ?? false,
          fromDb:    true,
        });
      } else {
        // Fallback to role defaults
        const d = defaultsForRole(role);
        setPerms({ canView: d.can_view, canCreate: d.can_create, canEdit: d.can_edit, canDelete: d.can_delete, canExport: d.can_export, fromDb: false });
      }

      setLoading(false);
    };

    fetchPerms();
  }, [module, role, activeOrg?.id, roleLoading, orgLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...perms, loading: loading || roleLoading || orgLoading };
}

// ─── useHasPermission — single boolean shorthand ─────────────────────────────

type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'export';

/**
 * Returns a single `allowed` boolean for a specific module+action.
 * Useful for simple conditional rendering without destructuring.
 *
 * @example
 *   const canDelete = useHasPermission('inventario', 'delete');
 */
export function useHasPermission(module: string, action: PermAction): boolean {
  const p = useModulePermissions(module);
  if (p.loading) return false;
  switch (action) {
    case 'view':   return p.canView;
    case 'create': return p.canCreate;
    case 'edit':   return p.canEdit;
    case 'delete': return p.canDelete;
    case 'export': return p.canExport;
  }
}

// ─── usePlatformAccess — permisos del staff DE LA PLATAFORMA ─────────────────

/**
 * Nivel de staff de plataforma. Ortogonal a los permisos de organización:
 * esto gobierna la superficie `/platform`, no el tenant.
 *
 * `superadmin` satisface cualquier requerimiento — espejo exacto de
 * `has_platform_role()` en la base, que es donde se hace el enforcement real.
 */
export function usePlatformAccess() {
  const { platformRole, loading } = useOrg();

  const canPlatform = useCallback((...allowed: PlatformRole[]) => {
    if (!platformRole) return false;
    if (platformRole === 'superadmin') return true;
    return allowed.includes(platformRole);
  }, [platformRole]);

  return {
    loading,
    platformRole,
    isPlatformStaff: platformRole !== null,
    isSuperadmin: platformRole === 'superadmin',
    /** Finanzas: planes, precios, comisiones, facturación */
    canBilling: platformRole === 'superadmin' || platformRole === 'finance',
    /** Soporte: ver orgs/usuarios, asistir, sin tocar plata ni borrar */
    canSupport: platformRole !== null,
    canPlatform,
  };
}
