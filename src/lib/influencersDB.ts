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

export async function listInfluencers(): Promise<Influencer[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('influencers').select('*').eq('org_id', orgId).order('total_generated_ars', { ascending: false });
  if (error) throw error;
  return (data || []) as Influencer[];
}

export async function createInfluencer(payload: Partial<Influencer> & { user_id: string }) {
  const orgId = requireActiveOrgId();
  const insertData: any = { ...payload, org_id: orgId };
  if (insertData.referral_code) insertData.referral_code = insertData.referral_code.toUpperCase().replace(/\s+/g, '');
  const { data, error } = await supabase.from('influencers').insert(insertData).select().single();
  if (error) throw error;
  return data;
}

export async function updateInfluencer(id: string, updates: Partial<Influencer>) {
  if (updates.referral_code) updates.referral_code = updates.referral_code.toUpperCase().replace(/\s+/g, '');
  const { error } = await supabase.from('influencers').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteInfluencer(id: string) {
  const { error } = await supabase.from('influencers').delete().eq('id', id);
  if (error) throw error;
}

export async function listInfluencerSales(influencerId?: string) {
  const orgId = requireActiveOrgId();
  let q = supabase.from('influencer_sales').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (influencerId) q = q.eq('influencer_id', influencerId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listPayouts(influencerId?: string) {
  const orgId = requireActiveOrgId();
  let q = supabase.from('influencer_payouts').select('*').eq('org_id', orgId).order('paid_at', { ascending: false });
  if (influencerId) q = q.eq('influencer_id', influencerId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createPayout(influencerId: string, amount: number, salesIds: string[], userId: string, opts: { period_start?: string; period_end?: string; payment_method?: string; notes?: string } = {}) {
  const orgId = requireActiveOrgId();
  const { data: payout, error } = await supabase.from('influencer_payouts').insert({
    org_id: orgId, influencer_id: influencerId, amount_ars: amount,
    period_start: opts.period_start, period_end: opts.period_end,
    payment_method: opts.payment_method, notes: opts.notes,
    sales_count: salesIds.length, created_by: userId,
  }).select().single();
  if (error) throw error;
  if (salesIds.length > 0) {
    await supabase.from('influencer_sales').update({ paid: true, paid_at: new Date().toISOString(), payout_id: payout.id }).in('id', salesIds);
  }
  return payout;
}

export async function findInfluencerByCode(code: string) {
  const orgId = requireActiveOrgId();
  const { data } = await supabase.from('influencers').select('*').eq('org_id', orgId).ilike('referral_code', code.trim()).eq('status', 'activo').maybeSingle();
  return data as Influencer | null;
}