import { supabase } from '@/integrations/supabase/client';
import { requireActiveOrgId } from './orgContext';

// ===== Combos =====
export async function listCombos() {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('product_combos').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function createCombo(payload: any) {
  const orgId = requireActiveOrgId();
  const { error } = await supabase.from('product_combos').insert({ ...payload, org_id: orgId });
  if (error) throw error;
}
export async function updateCombo(id: string, updates: any) {
  const { error } = await supabase.from('product_combos').update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteCombo(id: string) {
  const { error } = await supabase.from('product_combos').delete().eq('id', id);
  if (error) throw error;
}

// ===== Story Templates =====
export async function listStoryTemplates() {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('story_templates').select('*').or(`org_id.eq.${orgId},org_id.is.null`).eq('active', true).order('sort_order');
  if (error) throw error;
  return data || [];
}

// ===== Industry Presets (no hardcode) =====
export async function listIndustries() {
  const { data, error } = await supabase.from('industry_presets').select('*').eq('active', true).order('sort_order');
  if (error) throw error;
  return data || [];
}

// ===== Banners =====
export async function listBanners() {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('catalog_banners').select('*').eq('org_id', orgId).order('sort_order');
  if (error) throw error;
  return data || [];
}
export async function createBanner(payload: any) {
  const orgId = requireActiveOrgId();
  const { error } = await supabase.from('catalog_banners').insert({ ...payload, org_id: orgId });
  if (error) throw error;
}
export async function updateBanner(id: string, updates: any) {
  const { error } = await supabase.from('catalog_banners').update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteBanner(id: string) {
  const { error } = await supabase.from('catalog_banners').delete().eq('id', id);
  if (error) throw error;
}

// ===== AI Recommendations =====
export async function listAIRecommendations(status?: string) {
  const orgId = requireActiveOrgId();
  let q = supabase.from('ai_offer_recommendations').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
export async function updateRecommendationStatus(id: string, status: 'applied' | 'dismissed') {
  const updates: any = { status };
  if (status === 'applied') updates.applied_at = new Date().toISOString();
  if (status === 'dismissed') updates.dismissed_at = new Date().toISOString();
  const { error } = await supabase.from('ai_offer_recommendations').update(updates).eq('id', id);
  if (error) throw error;
}

// ===== Exchange configs (status / type) =====
export type ExchangeConfig = { id: string; org_id: string | null; kind: 'status' | 'type'; code: string; label: string; color_class: string; sort_order: number; active: boolean };

export async function listExchangeConfigs(kind?: 'status' | 'type'): Promise<ExchangeConfig[]> {
  const orgId = requireActiveOrgId();
  let q = supabase.from('exchange_configs').select('*').or(`org_id.eq.${orgId},org_id.is.null`).eq('active', true).order('sort_order');
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw error;
  // Prefer org-specific over global if duplicate code
  const byCode = new Map<string, ExchangeConfig>();
  for (const row of (data || []) as ExchangeConfig[]) {
    const key = `${row.kind}:${row.code}`;
    const prev = byCode.get(key);
    if (!prev || (row.org_id && !prev.org_id)) byCode.set(key, row);
  }
  return Array.from(byCode.values()).sort((a, b) => a.sort_order - b.sort_order);
}

// ===== Marketing post types =====
export async function listPostTypes() {
  const orgId = requireActiveOrgId();
  const { data, error } = await supabase.from('marketing_post_types').select('*').or(`org_id.eq.${orgId},org_id.is.null`).eq('active', true).order('sort_order');
  if (error) throw error;
  return data || [];
}

// ===== Marketing themes =====
export async function listMarketingThemes(industryCode?: string | null) {
  const orgId = requireActiveOrgId();
  let q = supabase.from('marketing_themes').select('*').or(`org_id.eq.${orgId},org_id.is.null`).eq('active', true).order('sort_order');
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  if (!industryCode) return rows;
  return rows.filter((r: any) => !r.industry_code || r.industry_code === industryCode);
}

// ===== Brand knowledge CRUD =====
export async function listBrandKnowledge(category?: string) {
  const orgId = requireActiveOrgId();
  let q = supabase.from('brand_knowledge').select('*').or(`org_id.eq.${orgId},org_id.is.null`).eq('active', true).order('brand');
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
export async function createBrandKnowledge(payload: any) {
  const orgId = requireActiveOrgId();
  const { error } = await supabase.from('brand_knowledge').insert({ ...payload, org_id: orgId });
  if (error) throw error;
}
export async function updateBrandKnowledge(id: string, updates: any) {
  const { error } = await supabase.from('brand_knowledge').update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteBrandKnowledge(id: string) {
  const { error } = await supabase.from('brand_knowledge').delete().eq('id', id);
  if (error) throw error;
}

// ===== Influencer settlements =====
export async function listInfluencerSalesByPeriod(opts: { from: string; to: string; influencerId?: string; onlyUnpaid?: boolean }) {
  const orgId = requireActiveOrgId();
  let q = supabase.from('influencer_sales').select('*').eq('org_id', orgId).gte('created_at', opts.from).lte('created_at', opts.to).order('created_at', { ascending: false });
  if (opts.influencerId) q = q.eq('influencer_id', opts.influencerId);
  if (opts.onlyUnpaid) q = q.eq('paid', false);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}