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