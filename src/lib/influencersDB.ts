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
  /** Versión vigente de las condiciones; cambia invalida aceptaciones. */
  version?: number;
  /** Enlace de aceptación del creador (sólo se comparte, nunca se expone en UI). */
  creator_token?: string;
  /** Cuándo aceptó la marca la versión vigente (server-side). */
  brand_accepted_at?: string | null;
  /** Cuándo aceptó el creador la versión vigente (server-side). */
  creator_accepted_at?: string | null;
  /** Nombre con el que el creador firmó la versión vigente. */
  creator_signature_name?: string | null;
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
  // La vista de la base expone el estado REAL de doble aceptación computado
  // server-side (brand_accepted_at / creator_accepted_at). La marca nunca
  // declara la firma del creador: la aceptación es de él, por token o sesión.
  const { data, error } = await sb
    .from('influencer_contract_status')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as InfluencerContract[];
}

export async function createContract(payload: Partial<InfluencerContract> & { org_id: string; influencer_id: string }): Promise<InfluencerContract> {
  // Server-side: crea v1 + aceptación de marca + token público para el creador.
  // El insert directo desde el cliente queda prohibido por RLS/RPC.
  const { data, error } = await sb.rpc('create_influencer_contract', {
    p_org_id: payload.org_id,
    p_influencer_id: payload.influencer_id,
    p_contract_type: payload.contract_type,
    p_contract_amount: payload.contract_amount ?? 0,
    p_commission_percent: payload.commission_percent ?? 0,
    p_valid_from: payload.valid_from,
    p_valid_until: payload.valid_until ?? null,
    p_notes: payload.notes ?? null,
  });
  if (error) throw error;
  return (data as unknown as InfluencerContract) ?? null;
}

export async function updateContract(id: string, updates: Partial<InfluencerContract>) {
  const orgId = requireActiveOrgId();
  // Cambiar condiciones es versión nueva: la aceptación previa del creador
  // caduca y vuelve a decidir. La firma unilateral ya no existe.
  const { error } = await sb.rpc('update_influencer_contract_terms', {
    p_contract_id: id,
    p_contract_type: updates.contract_type,
    p_contract_amount: updates.contract_amount ?? 0,
    p_commission_percent: updates.commission_percent ?? 0,
    p_valid_from: updates.valid_from,
    p_valid_until: updates.valid_until ?? null,
    p_notes: updates.notes ?? null,
  });
  if (error) throw error;
  // El estado comercial (active/paused/...) sigue siendo de la marca.
  if (updates.status && updates.status !== undefined) {
    const { error: statusError } = await sb
      .from('influencer_contracts')
      .update({ status: updates.status, updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('id', id);
    if (statusError) throw statusError;
  }
}

/** La firma la acepta el creador (token público o su sesión): la marca no firma por él. */
export async function getContractShareLink(id: string): Promise<string> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb
    .from('influencer_contracts')
    .select('creator_token')
    .eq('org_id', orgId)
    .eq('id', id)
    .single();
  if (error) throw error;
  if (!data?.creator_token) throw new Error('contract_without_token');
  return `${window.location.origin}/aceptar-contrato/${data.creator_token}`;
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

/** Estado de retención del pago (Go-Marz parity: retener hasta publicar). */
export interface InfluencerPaymentRelease {
  id: string;
  influencer_name: string;
  amount: number;
  status: string;
  /** publication_verified = retenido hasta verificar la publicación. */
  release_condition: 'manual' | 'publication_verified';
  /** Cuándo la verificación de publicación lo habilitó (null = sigue retenido). */
  released_at: string | null;
  is_held: boolean;
  is_payable: boolean;
  created_at: string;
}

/** Lista pagos con estado de retención: la vista computa held/payable. */
export async function listPaymentsWithRelease(): Promise<InfluencerPaymentRelease[]> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb
    .from('influencer_payment_release_status')
    .select('id, influencer_name, amount, status, release_condition, released_at, is_held, is_payable, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as InfluencerPaymentRelease[];
}

/** Crea un pago retenido: la verificación de publicación lo libera (server-side). */
export async function createHeldPayment(input: {
  influencerId: string;
  campaignId: string;
  amount: number;
  paymentMethod?: 'transfer' | 'mp_money' | 'cash' | 'check' | 'other';
  notes?: string | null;
}): Promise<InfluencerPayment> {
  const orgId = requireActiveOrgId();
  const { data, error } = await sb.rpc('create_influencer_held_payment', {
    p_org_id: orgId,
    p_influencer_id: input.influencerId,
    p_campaign_id: input.campaignId,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod ?? 'transfer',
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as InfluencerPayment;
}

/** Traducción humana del estado de retención (nunca IDs crudos al usuario). */
export function heldPaymentLabel(p: Pick<InfluencerPaymentRelease, 'is_payable' | 'released_at' | 'status'>): string {
  if (p.status === 'completed') return 'Pagado';
  if (p.released_at) return 'Listo para pagar';
  if (p.status === 'failed') return 'Fallido';
  return 'Retenido hasta publicación';
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

/** ─── Reputación verificada del directorio (Go-Marz discovery parity) ─── */
export type InfluencerReputation = {
  influencer_id: string;
  rating: number | null;
  reviews_count: number;
  collaborations_count: number;
  on_time_rate: number | null;
  verified_publications: number;
  /** Métricas con evidencia verificada por la marca en los últimos 180 días. */
  verified_metrics: boolean;
  last_verified_at: string | null;
};

export async function listInfluencerReputation(orgId: string): Promise<Map<string, InfluencerReputation>> {
  const { data, error } = await sb.rpc('influencer_reputation_map', { p_org_id: orgId });
  if (error) throw error;
  const rows = (data ?? []) as InfluencerReputation[];
  return new Map(rows.map(row => [row.influencer_id, row]));
}

/** ─── Métricas sociales verificadas (Go-Marz parity) ─── */
export type SocialMetricReport = {
  id: string;
  org_id: string;
  influencer_id: string;
  platform: 'instagram' | 'tiktok' | 'youtube';
  metric_kind: 'captura' | 'export_csv';
  evidence_url: string;
  period_start: string;
  period_end: string;
  followers: number;
  reach: number | null;
  impressions: number | null;
  engagement_rate: number | null;
  notes: string | null;
  status: 'submitted' | 'verified' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  influencer_name?: string | null;
};

export async function listSocialMetricReports(orgId: string): Promise<SocialMetricReport[]> {
  const { data, error } = await sb.rpc('list_social_metric_reports', { p_org_id: orgId });
  if (error) throw error;
  return (data ?? []) as SocialMetricReport[];
}

export async function submitSocialMetricReport(input: {
  influencer_id: string;
  platform: SocialMetricReport['platform'];
  evidence_url: string;
  period_start: string;
  period_end: string;
  followers: number;
  reach?: number | null;
  impressions?: number | null;
  engagement_rate?: number | null;
  metric_kind?: 'captura' | 'export_csv';
  notes?: string | null;
}): Promise<SocialMetricReport> {
  const { data, error } = await sb.rpc('submit_social_metric_report', {
    p_influencer_id: input.influencer_id,
    p_platform: input.platform,
    p_evidence_url: input.evidence_url,
    p_period_start: input.period_start,
    p_period_end: input.period_end,
    p_followers: input.followers,
    p_reach: input.reach ?? null,
    p_impressions: input.impressions ?? null,
    p_engagement_rate: input.engagement_rate ?? null,
    p_metric_kind: input.metric_kind ?? 'captura',
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as SocialMetricReport;
}

export async function reviewSocialMetricReport(
  reportId: string,
  status: 'verified' | 'rejected',
  reviewNotes: string | null,
): Promise<SocialMetricReport> {
  const { data, error } = await sb.rpc('review_social_metric_report', {
    p_report_id: reportId,
    p_status: status,
    p_review_notes: reviewNotes,
  });
  if (error) throw error;
  return data as SocialMetricReport;
}
