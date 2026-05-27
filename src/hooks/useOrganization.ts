import { useOrg } from "@/lib/orgContext";

/**
 * Convenience hook that exposes the active organization's ID and metadata.
 * All pages use `const { orgId } = useOrganization()`.
 */
export function useOrganization() {
  const { activeOrg, loading, activeRole } = useOrg();
  return {
    orgId: activeOrg?.id ?? null,
    org: activeOrg,
    role: activeRole,
    loading,
  };
}
