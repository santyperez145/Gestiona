import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * Los workers no reconstruyen producto + activación + dependencias + rollout.
 * Usan el mismo evaluador SQL que la UI y los comandos, mediante el wrapper
 * reservado a service_role. Un error de evaluación falla cerrado.
 */
export async function resolveWorkerCapability(
  admin: SupabaseClient,
  orgId: string,
  capabilityKey: string,
): Promise<{ allowed: boolean; error: string | null }> {
  const { data, error } = await admin.rpc("organization_capability_enabled", {
    p_org_id: orgId,
    p_capability_key: capabilityKey,
  });

  if (error) {
    return { allowed: false, error: error.message };
  }
  return { allowed: data === true, error: null };
}
