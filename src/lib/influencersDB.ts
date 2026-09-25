import { supabase as _supabase } from '@/integrations/supabase/client';
import { requireActiveOrgId } from './orgContext';

// New tables (influencer_contracts, influencer_deliverables, influencer_payments,
// brand_portal_profiles) are not in the Supabase generated types yet. Cast to any
// to avoid type-check failures until the migration is deployed.
export const sb: any = _supabase;

export type Influencer = {
  id: string; org_id: string; user_id: string; name: string;
  instagram?: string; tiktok?: string; phone?: string; email?: string;
  followers_ig: number; followers_tiktok: number; engagement_rate: number;
  tier: 'nano' | 'micro' | 'medio' | 'macro';
  commission_percent: number; commission_type: 'porcentaje' | 'monto_fijo' | 'por_venta';
  commission_fixed_ars: number; referral_code: string; status: string;
  total_generated_ars: number; total_commissions_ars: number; total_sales_count: number;
  notes?: string; avatar_url?: string;
};

export type InfluencerContract = {
  id: string;
  org_id: string;
  influencer_id: string;
  influencer_name: string;
  contract_type: 'fixed' | 'percentage' | 'hybrid';
  contract_amount: number;
  commission_percent: number;
  commission_fixed: number;
  is_signed: boolean;
  valid_from: string;
  valid_until: string;
  status: 'active' | 'paused' | 'expired' | 'cancelled';
  notes?: string;
  created_at: string;
  updated_at: string;
};

export function isActiveInfluencer(status: string) {
  return status === 'active' || status === 'activo';
}

export type InfluencerDeliverable = {
  id: string;
  org_id: string;
  influencer_id: string;
  influencer_name: string;
  campaign_name: string;
  campaign_id?: string | null;
  content_url?: string | null;
  review_notes?: string | null;
  description: string;
  due_date: string;
  status: 'pendiente' | 'en_progreso' | 'completado' | 'entregado';
  delivery_date?: string;
  notes?: string;
  created_at: string;
};

export type InfluencerPayment = {
  id: string;
  org_id: string;
  influencer_id: string;
  influencer_name: string;
  amount: number;
  currency: string;
  payment_method: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  period_start?: string;
  period_end?: string;
  notes?: string;
  created_at: string;
  completed_at?: string;
};

export type InfluencerInvitation = {
  id: string;
  org_id: string;
  campaign_id: string | null;
  influencer_id: string;
  email?: string | null;
  phone?: string | null;
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
  responded_at?: string | null;
  created_by: string;
  created_at: string;
};

export type InfluencerReview = {
  id: string;
  org_id: string;
  influencer_id: string;
  campaign_id: string | null;
  deliverable_id: string | null;
  rating: number;
  comment?: string | null;
  created_by: string;
  created_at: string;
};

export type BrandPortalProfile = {
  id: string;
  org_id: string;
  influencer_id: string;
  influencer_name: string;
  portal_name: string;
  description: string;
  website_url?: string;
  instagram_handle?: string;
  tiktok_handle?: string;
  youtube_handle?: string;
  followers_ig: number;
  followers_tiktok: number;
  engagement_rate: number;
  tier: 'nano' | 'micro' | 'medio' | 'macro';
  status: 'active' | 'inactive' | 'pending';
  category: string;
  bio?: string;
  created_at: string;
};

/** ─── Contratos ─── */
export async function listInfluencerContracts(): Promise<InfluencerContract[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb
    .from('influencer_contracts')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as InfluencerContract[];
}

export async function createContract(payload: Partial<InfluencerContract> & { org_id: string; influencer_id: string }): Promise<InfluencerContract> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_contracts').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as InfluencerContract;
}

export async function updateContract(id: string, updates: Partial<InfluencerContract>) {
  const { error } = await sb.from('influencer_contracts').update(updates).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function signContract(id: string): Promise<void> {
  const { error } = await sb.from('influencer_contracts').update({ is_signed: true, updated_at: new Date().toISOString() }).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function deleteContract(id: string): Promise<void> {
  const { error } = await sb.from('influencer_contracts').delete().eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

/** ─── Entregables ─── */
export async function listDeliverables(influencerId?: string): Promise<InfluencerDeliverable[]> {
  const orgId = requireActiveOrgId();
  let q = sb.from('influencer_deliverables').select('*').eq('org_id', orgId).order('due_date', { ascending: true });
  if (influencerId) q = q.eq('influencer_id', influencerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as InfluencerDeliverable[];
}

/** Alias para compatibilidad con código existente */
export async function listInfluencerDeliverables(): Promise<InfluencerDeliverable[]> {
  return listDeliverables();
}

export async function createDeliverable(payload: Partial<InfluencerDeliverable> & { org_id: string; influencer_id: string }): Promise<InfluencerDeliverable> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_deliverables').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as InfluencerDeliverable;
}

export async function updateDeliverable(id: string, updates: Partial<InfluencerDeliverable>) {
  const { error } = await sb.from('influencer_deliverables').update(updates).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function completeDeliverable(id: string): Promise<void> {
  const { error } = await sb.from('influencer_deliverables').update({ status: 'completado', delivery_date: new Date().toISOString() }).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function deleteDeliverable(id: string): Promise<void> {
  const { error } = await sb.from('influencer_deliverables').delete().eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export type PublicationProof = {
  id: string;
  org_id: string;
  deliverable_id: string;
  influencer_id: string;
  campaign_id: string | null;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'otro';
  publication_url: string;
  screenshot_url: string | null;
  license_type: 'organico' | 'uso_campaña' | 'paid_ampliado' | 'cesion_total';
  license_expires_at: string | null;
  license_notes: string | null;
  verified_by: string | null;
  created_at: string;
};

/** Registra la verificación de publicación vía RPC server-side (permiso influencer edit). */
export async function registerPublicationProof(input: {
  deliverable_id: string;
  platform: PublicationProof['platform'];
  publication_url: string;
  screenshot_url?: string | null;
  license_type: PublicationProof['license_type'];
  license_expires_at?: string | null;
  license_notes?: string | null;
}): Promise<PublicationProof> {
  const { data, error } = await sb.rpc('register_publication_proof', {
    p_deliverable_id: input.deliverable_id,
    p_platform: input.platform,
    p_publication_url: input.publication_url,
    p_license_type: input.license_type,
    p_license_expires_at: input.license_expires_at ?? null,
    p_license_notes: input.license_notes ?? null,
    p_screenshot_url: input.screenshot_url ?? null,
  });
  if (error) throw error;
  return data as PublicationProof;
}

/** ─── Pagos / Liquidaciones ─── */
export async function listPayments(): Promise<InfluencerPayment[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_payments').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as InfluencerPayment[];
}

export async function createPayment(payload: Partial<InfluencerPayment> & { org_id: string; influencer_id: string }): Promise<InfluencerPayment> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_payments').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as InfluencerPayment;
}

export async function updatePayment(id: string, updates: Partial<InfluencerPayment>) {
  const { error } = await sb.from('influencer_payments').update(updates).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function processPayment(id: string): Promise<void> {
  throw new Error('Los pagos requieren un proveedor conectado y confirmación del servidor.');
}

/** ─── Brand Portal ─── */
export async function listBrandPortals(): Promise<BrandPortalProfile[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('brand_portal_profiles').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as BrandPortalProfile[];
}

export async function createBrandPortal(payload: Partial<BrandPortalProfile> & { org_id: string; influencer_id: string }): Promise<BrandPortalProfile> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('brand_portal_profiles').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as BrandPortalProfile;
}

export async function updateBrandPortal(id: string, updates: Partial<BrandPortalProfile>) {
  const { error } = await sb.from('brand_portal_profiles').update(updates).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function deleteBrandPortal(id: string): Promise<void> {
  const { error } = await sb.from('brand_portal_profiles').delete().eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

/** ─── Influencers (CRUD básico) ─── */
export async function listInfluencers(orgId = requireActiveOrgId()): Promise<Influencer[]> {
  const { data, error } = await sb.from('influencers').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Influencer[];
}

export async function createInfluencer(payload: Partial<Influencer> & { org_id: string; user_id: string }): Promise<Influencer> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencers').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as Influencer;
}

export async function updateInfluencer(id: string, updates: Partial<Influencer>) {
  const { error } = await sb.from('influencers').update(updates).eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function deleteInfluencer(id: string): Promise<void> {
  const { error } = await sb.from('influencers').delete().eq('org_id', requireActiveOrgId()).eq('id', id).select('id').single();
  if (error) throw error;
}

export async function findInfluencerByCode(referralCode: string): Promise<Influencer | null> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencers').select('*').eq('org_id', orgId).eq('referral_code', referralCode).single();
  if (error) return null;
  return data as Influencer;
}

export async function createInfluencerProfile(payload: Partial<Influencer> & { org_id?: string }) {
  return await createInfluencer({ ...payload, user_id: 'system', org_id: payload.org_id || requireActiveOrgId() });
}

export async function verifyInfluencerDocument(influencerId: string, verified: boolean) {
  const updates: Partial<Influencer> = { status: verified ? 'verified' : 'rejected' };
  return await updateInfluencer(influencerId, updates);
}

/** ─── Influencer Sales (para campañas) ─── */
export async function listInfluencerSales(influencerId?: string): Promise<any[]> {
  const orgId = requireActiveOrgId();
  let q = sb.from('influencer_sales').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (influencerId) q = q.eq('influencer_id', influencerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as any[];
}

/** ─── Payouts (liquidaciones) ─── */
export async function listPayouts(): Promise<any[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_payouts').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as any[];
}

export async function createPayout(payload: {
  org_id: string;
  total_amount: number;
  influencer_id?: string;
  status?: 'pending' | 'processing' | 'completed' | 'cancelled';
  period_start: string;
  period_end: string;
  notes?: string;
  amount_ars?: number;
  sales_ids?: string[];
  user_id?: string;
  payment_method?: string;
}): Promise<any> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_payouts').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data;
}

/** ─── Invitaciones a creadores (flujo Go-Marz: invitar → aceptar/rechazar → expira) ─── */
export async function listInfluencerInvitations(): Promise<InfluencerInvitation[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_invitations').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as InfluencerInvitation[];
}

export async function createInfluencerInvitation(influencerId: string, campaignId?: string | null, days = 14): Promise<InfluencerInvitation> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.rpc('create_influencer_invitation', {
    p_org_id: orgId, p_influencer_id: influencerId, p_campaign_id: campaignId ?? null, p_days: days,
  });
  if (error) throw error;
  return data as InfluencerInvitation;
}

export async function getInfluencerInvitation(token: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb.rpc('get_influencer_invitation', { p_token: token });
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function respondInfluencerInvitation(token: string, action: 'accept' | 'decline'): Promise<string> {
  const { data, error } = await sb.rpc('respond_influencer_invitation', { p_token: token, p_action: action });
  if (error) throw error;
  return String(data);
}

/** ─── Reviews y reputación (rating real, no valores fijos) ─── */
export async function listInfluencerReviews(influencerId?: string): Promise<InfluencerReview[]> {
  const orgId = requireActiveOrgId();
  let q = sb.from('influencer_reviews').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (influencerId) q = q.eq('influencer_id', influencerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as InfluencerReview[];
}

export async function createInfluencerReview(payload: {
  influencer_id: string;
  campaign_id?: string | null;
  deliverable_id?: string | null;
  rating: number;
  comment?: string | null;
}): Promise<InfluencerReview> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_reviews').insert({ ...payload, org_id: orgId, created_by: (await sb.auth.getUser()).data?.user?.id ?? null }).select().single();
  if (error) throw error;
  return data as InfluencerReview;
}

/** ─── Lado creador: saldo y retiros (portal público por token) ─── */
export async function getCreatorEarnings(token: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb.rpc('get_creator_earnings', { p_token: token });
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function listCreatorWithdrawals(token: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await sb.rpc('list_creator_withdrawals', { p_token: token });
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function requestCreatorWithdrawal(token: string, amountArs: number): Promise<Record<string, unknown>> {
  const { data, error } = await sb.rpc('request_creator_withdrawal', { p_token: token, p_amount_ars: amountArs });
  if (error) throw error;
  return data as Record<string, unknown>;
}

/** ─── Lado marca: revisar solicitudes de retiro ─── */
export type WithdrawalRequest = {
  id: string;
  org_id: string;
  influencer_id: string;
  token: string;
  amount_ars: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  notes?: string | null;
  created_at: string;
  processed_at?: string | null;
};

export async function listWithdrawalRequests(): Promise<WithdrawalRequest[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.from('influencer_withdrawal_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as WithdrawalRequest[];
}

export async function resolveWithdrawalRequest(id: string, status: 'approved' | 'rejected' | 'paid'): Promise<void> {
  const { error } = await sb.rpc('resolve_creator_withdrawal', { p_request_id: id, p_status: status });
  if (error) throw error;
}
