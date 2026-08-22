import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';

export type AppRole = 'admin' | 'vendedor' | 'viewer';

/**
 * Deriva el rol del usuario DENTRO de la organización activa.
 * - owner / admin → 'admin' (acceso total al tenant)
 * - vendedor      → 'vendedor'
 * - viewer / sin membership → 'viewer'
 *
 * Importante: ser staff de plataforma (`platform_admins`) NO otorga permisos
 * dentro de una organización. Son dos superficies separadas — el staff opera
 * sobre las orgs desde `/platform` y las Edge Functions con service_role, no
 * heredando el rol de admin del tenant. Para entrar a una org tiene que tener
 * una membresía real. Soporte usa snapshots diagnósticos temporales y
 * consentidos desde Merchant 360; nunca inicia sesión como otra persona.
 */
export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const { activeRole, loading: orgLoading } = useOrg();

  const loading = authLoading || orgLoading;

  let role: AppRole = 'viewer';
  if (user) {
    if (activeRole === 'owner' || activeRole === 'admin') {
      role = 'admin';
    } else if (activeRole === 'vendedor') {
      role = 'vendedor';
    }
  }

  return {
    role,
    loading,
    isOwner: activeRole === 'owner',
    isAdmin: role === 'admin',
    isVendedor: role === 'vendedor',
    isViewer: role === 'viewer',
  };
}
