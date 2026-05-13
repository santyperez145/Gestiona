import { useUserRole } from '@/lib/useUserRole';

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
    canSell:          role === 'admin' || role === 'vendedor',
    canManageSettings: role === 'admin',
    canViewFinance:   role === 'admin' || role === 'vendedor',
    canManageTeam:    role === 'admin',
  };
}
