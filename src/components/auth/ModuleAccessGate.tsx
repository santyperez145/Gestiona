import type { ReactNode } from 'react';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { useModulePerms, useRefreshPermissions } from '@/lib/permissionsContext';

export default function ModuleAccessGate({ module, title = 'esta sección', children }: {
  module: string;
  title?: string;
  children: ReactNode;
}) {
  const perms = useModulePerms(module);
  const refresh = useRefreshPermissions();

  if (!module) return <>{children}</>;
  if (perms.loading) return <WorkspaceState kind="initial-loading" title={`Verificando acceso a ${title}`} layout="embedded" />;
  if (perms.error) return <WorkspaceState
    kind="error-recoverable"
    title="No pudimos verificar tu acceso"
    description={perms.error}
    actionLabel="Reintentar"
    onAction={refresh}
    layout="embedded"
  />;
  if (!perms.canView) return <WorkspaceState
    kind="permission"
    title={`Sin acceso a ${title}`}
    description="El administrador de tu organización puede revisar tus permisos."
    layout="embedded"
  />;

  return <>{children}</>;
}
