import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';

export type AppRole = 'admin' | 'vendedor' | 'viewer';

/**
 * Deriva el rol del usuario en la organización activa.
 * - owner / admin → 'admin' (acceso total)
 * - vendedor      → 'vendedor'
 * - viewer / sin membership → 'viewer'
 */
export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const { activeRole, loading: orgLoading, isPlatformAdmin } = useOrg();

  const loading = authLoading || orgLoading;

  let role: AppRole = 'viewer';
  if (user) {
    if (isPlatformAdmin) {
      role = 'admin';
    } else if (activeRole === 'owner' || activeRole === 'admin') {
      role = 'admin';
    } else if (activeRole === 'vendedor') {
      role = 'vendedor';
    }
  }

  return {
    role,
    loading,
    isAdmin: role === 'admin',
    isVendedor: role === 'vendedor',
    isViewer: role === 'viewer',
  };
}
