import type { ReactNode } from 'react';
import { useOrg } from '@/lib/orgContext';
import { useModulePerms } from '@/lib/permissionsContext';
import WorkspaceState from '@/components/shared/WorkspaceState';

export default function InfluencerMarketingGate({ children }: { children: ReactNode }) {
  const { activeOrg, activeRole, loading: orgLoading } = useOrg();
  const { canView, loading } = useModulePerms('influencers');
  if (loading || orgLoading) return <WorkspaceState kind="initial-loading" title="Verificando acceso a Influencers" />;
  if (!activeOrg || !['owner', 'admin'].includes(activeRole ?? '') || !canView) {
    return <WorkspaceState kind="permission" title="Sin acceso a Influencers" description="El administrador de tu organización puede revisar tus permisos." />;
  }
  return <>{children}</>;
}
