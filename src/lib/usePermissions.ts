import { useCallback } from 'react';
import { useUserRole } from '@/lib/useUserRole';
import { useOrg, PlatformRole } from '@/lib/orgContext';
import { useModulePerms } from '@/lib/permissionsContext';
export { defaultsForRole } from '@/lib/permissionPolicy';

// El vocabulario de módulos vive en un módulo puro para que lo puedan importar
// el mapa de rutas y los tests sin arrastrar React ni el cliente de Supabase.
export {
  PERMISSION_MODULES, PERMISSION_MODULE_LABEL, isPermissionModule,
  type PermissionModule,
} from '@/lib/permissionModules';

// ─── Role-based permission helpers ───────────────────────────────────────────

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
  return useModulePerms(module);
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
    canSupport: platformRole === 'superadmin' || platformRole === 'support',
    canPlatform,
  };
}
