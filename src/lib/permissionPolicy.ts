import type { AppRole } from '@/lib/useUserRole';

export function defaultsForRole(role: AppRole) {
  const admin = role === 'admin';
  return { can_view: true, can_create: admin || role === 'vendedor', can_edit: admin, can_delete: admin, can_export: admin };
}

export const DENY_PERMISSIONS = {
  canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, fromDb: false,
};

export function resolveModulePermissions(role: AppRole, row?: Partial<ReturnType<typeof defaultsForRole>>) {
  const defaults = defaultsForRole(role);
  return {
    canView: row?.can_view ?? defaults.can_view,
    canCreate: row?.can_create ?? defaults.can_create,
    canEdit: row?.can_edit ?? defaults.can_edit,
    canDelete: row?.can_delete ?? defaults.can_delete,
    canExport: row?.can_export ?? defaults.can_export,
    fromDb: row != null,
  };
}
