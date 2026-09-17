import { supabase } from '@/integrations/supabase/client';
import { requireActiveOrgId } from './orgContext';

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

export type InfluencerDeliverable = {
  id: string;
  org_id: string;
  influencer_id: string;
  influencer_name: string;
  campaign_name: string;
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
  const { data, error } = await supabase
    .from('influencer_contracts')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as InfluencerContract[];
}

export async function createContract(payload: Partial<InfluencerContract> & { org_id: string; influencer_id: string }): Promise<InfluencerContract> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('influencer_contracts').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as InfluencerContract;
}

export async function updateContract(id: string, updates: Partial<InfluencerContract>) {
  const { error } = await supabase.from('influencer_contracts').update(updates).eq('id', id);
  if (error) throw error;
}

export async function signContract(id: string): Promise<void> {
  const { error } = await supabase.from('influencer_contracts').update({ is_signed: true, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteContract(id: string): Promise<void> {
  const { error } = await supabase.from('influencer_contracts').delete().eq('id', id);
  if (error) throw error;
}

/** ─── Entregables ─── */
export async function listDeliverables(influencerId?: string): Promise<InfluencerDeliverable[]> {
  const orgId = requireActiveOrgId();
  let q = supabase.from('influencer_deliverables').select('*').eq('org_id', orgId).order('due_date', { ascending: true });
  if (influencerId) q = q.eq('influencer_id', influencerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as InfluencerDeliverable[];
}

export async function createDeliverable(payload: Partial<InfluencerDeliverable> & { org_id: string; influencer_id: string }): Promise<InfluencerDeliverable> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('influencer_deliverables').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as InfluencerDeliverable;
}

export async function updateDeliverable(id: string, updates: Partial<InfluencerDeliverable>) {
  const { error } = await supabase.from('influencer_deliverables').update(updates).eq('id', id);
  if (error) throw error;
}

export async function completeDeliverable(id: string): Promise<void> {
  const { error } = await supabase.from('influencer_deliverables').update({ status: 'completado', delivery_date: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteDeliverable(id: string): Promise<void> {
  const { error } = await supabase.from('influencer_deliverables').delete().eq('id', id);
  if (error) throw error;
}

/** ─── Pagos / Liquidaciones ─── */
export async function listPayments(): Promise<InfluencerPayment[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('influencer_payments').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as InfluencerPayment[];
}

export async function createPayment(payload: Partial<InfluencerPayment> & { org_id: string; influencer_id: string }): Promise<InfluencerPayment> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('influencer_payments').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as InfluencerPayment;
}

export async function updatePayment(id: string, updates: Partial<InfluencerPayment>) {
  const { error } = await supabase.from('influencer_payments').update(updates).eq('id', id);
  if (error) throw error;
}

export async function processPayment(id: string): Promise<void> {
  const { error } = await supabase.from('influencer_payments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** ─── Brand Portal ─── */
export async function listBrandPortals(): Promise<BrandPortalProfile[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('brand_portal_profiles').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as BrandPortalProfile[];
}

export async function createBrandPortal(payload: Partial<BrandPortalProfile> & { org_id: string; influencer_id: string }): Promise<BrandPortalProfile> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('brand_portal_profiles').insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data as BrandPortalProfile;
}

export async function updateBrandPortal(id: string, updates: Partial<BrandPortalProfile>) {
  const { error } = await supabase.from('brand_portal_profiles').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteBrandPortal(id: string): Promise<void> {
  const { error } = await supabase.from('brand_portal_profiles').delete().eq('id', id);
  if (error) throw error;
}