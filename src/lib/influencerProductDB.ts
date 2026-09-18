// Módulo de acceso al producto Influencer Marketing (Nerqia).
// Consulta organization_product_access para saber si la org tiene el producto habilitado.
import { supabase } from '@/integrations/supabase/client';
import { requireActiveOrgId } from './orgContext';

export interface ProductSurfaceAccess {
  productKey: 'influencers';
  status: 'available' | 'requested' | 'enabled';
  allowed: boolean;
  canRequest: boolean;
  blocker: 'product_not_enabled' | 'module_permission_denied' | null;
  requestedAt: string | null;
  decidedAt: string | null;
}

export async function getInfluencerProductAccess(orgId?: string): Promise<ProductSurfaceAccess | null> {
  const targetOrgId = orgId ?? requireActiveOrgId();
  const { data, error } = await supabase
    .rpc('product_surface_access', { p_org_id: targetOrgId, p_product_key: 'influencers' });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('La base no devolvió el estado del producto Influencers.');
  return {
    productKey: 'influencers',
    status: row.status as ProductSurfaceAccess['status'],
    allowed: Boolean(row.allowed),
    canRequest: Boolean(row.can_request),
    blocker: (row.blocker || null) as ProductSurfaceAccess['blocker'],
    requestedAt: row.requested_at || null,
    decidedAt: row.decided_at || null,
  };
}

export async function requestInfluencerProductAccess(orgId?: string): Promise<void> {
  const targetOrgId = orgId ?? requireActiveOrgId();
  const { error } = await supabase
    .rpc('request_product_access', { p_org_id: targetOrgId, p_product_key: 'influencers' });
  if (error) throw error;
}
