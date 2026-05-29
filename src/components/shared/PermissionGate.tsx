import { ReactNode } from 'react';
import { useModulePermissions } from '@/lib/usePermissions';
import { Lock } from 'lucide-react';

type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'export';

interface PermissionGateProps {
  /** Module key — must match a value in `role_permissions.module` */
  module: string;
  /** Which action to check */
  action: PermAction;
  /** What to render when permission is granted */
  children: ReactNode;
  /**
   * What to render when permission is denied.
   * - `"hidden"` (default) — renders nothing
   * - `"disabled"` — renders children wrapped in a disabled + blurred overlay
   * - `"lock"` — renders a small lock icon placeholder
   * - `ReactNode` — renders whatever you pass
   */
  fallback?: 'hidden' | 'disabled' | 'lock' | ReactNode;
  /** If true, renders nothing (same as "hidden") while permissions are loading */
  hideWhileLoading?: boolean;
}

/**
 * PermissionGate
 *
 * Wraps content that should only be accessible when the current user has
 * `action` permission on `module`. Works with the `role_permissions` table
 * (falls back to role defaults if no DB row exists).
 *
 * @example
 * <PermissionGate module="inventario" action="delete" fallback="disabled">
 *   <Button variant="destructive">Eliminar</Button>
 * </PermissionGate>
 */
export default function PermissionGate({
  module,
  action,
  children,
  fallback = 'hidden',
  hideWhileLoading = false,
}: PermissionGateProps) {
  const perms = useModulePermissions(module);

  // While loading — optionally hide
  if (perms.loading) {
    return hideWhileLoading ? null : <>{children}</>;
  }

  const allowed = (() => {
    switch (action) {
      case 'view':   return perms.canView;
      case 'create': return perms.canCreate;
      case 'edit':   return perms.canEdit;
      case 'delete': return perms.canDelete;
      case 'export': return perms.canExport;
    }
  })();

  if (allowed) return <>{children}</>;

  // Denied — resolve fallback
  if (fallback === 'hidden') return null;

  if (fallback === 'lock') {
    return (
      <span
        title="No tenés permiso para esta acción"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-50 cursor-not-allowed select-none"
      >
        <Lock className="w-3 h-3" />
        Sin acceso
      </span>
    );
  }

  if (fallback === 'disabled') {
    return (
      <span
        title="No tenés permiso para esta acción"
        className="pointer-events-none opacity-40 cursor-not-allowed select-none"
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  // Custom fallback node
  return <>{fallback}</>;
}
