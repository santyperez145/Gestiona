import type { ReactNode } from 'react';
import { useOrg } from '@/lib/orgContext';
import ModuleAccessGate from '@/components/auth/ModuleAccessGate';
import WorkspaceState from '@/components/shared/WorkspaceState';

export default function InfluencerMarketingGate({ children }: { children: ReactNode }) {
  const { activeOrg, activeRole, loading: orgLoading } = useOrg();
  if (orgLoading) return <WorkspaceState kind="initial-loading" title="Verificando acceso a Influencers" layout="embedded" />;
  if (!activeOrg || !['owner', 'admin'].includes(activeRole ?? '')) {
    return <WorkspaceState kind="permission" title="Sin acceso a Influencers" description="El administrador de tu organización puede revisar tus permisos." />;
  }
  return <ModuleAccessGate module="influencers" title="Influencers">{children}</ModuleAccessGate>;
}
