import { supabase } from '@/integrations/supabase/client';

export const CAMPAIGN_STATUSES = { draft: 'Borrador', active: 'En curso', paused: 'En pausa', completed: 'Cerrada', cancelled: 'Cancelada' } as const;
export const CAMPAIGN_OBJECTIVES = { awareness: 'Reconocimiento de marca', traffic: 'Visitas a la tienda', sales: 'Ventas', content: 'Contenido de marca' } as const;
export const CAMPAIGN_CHANNELS = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', multiple: 'Varias redes' } as const;
export type CampaignStatus = keyof typeof CAMPAIGN_STATUSES;
export interface InfluencerCampaign {
  id: string;
  org_id: string;
  title: string;
  brief: string;
  objective: keyof typeof CAMPAIGN_OBJECTIVES;
  channel: keyof typeof CAMPAIGN_CHANNELS;
  budget_ars: number;
  due_date: string | null;
  status: CampaignStatus;
  version: number;
  created_at: string;
  updated_at: string;
  influencer_campaign_creators: { influencer_id: string }[];
}
export interface CampaignDraft {
  id: string;
  version: number;
  title: string;
  brief: string;
  objective: InfluencerCampaign['objective'];
  channel: InfluencerCampaign['channel'];
  budget_ars: number;
  due_date: string;
  creator_ids: string[];
}
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'cancelled'], active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'], completed: [], cancelled: [],
};

// Local typed boundary for the new migration, pending shared schema generation.
const campaignClient = supabase as unknown as {
  from(table: 'influencer_campaigns'): { select(columns: string): { eq(key: string, value: string): { order(key: string, options: { ascending: boolean }): Promise<{ data: InfluencerCampaign[] | null; error: unknown }> } } };
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: { id: string } | null; error: unknown }>;
};

export async function listInfluencerCampaigns(orgId: string): Promise<InfluencerCampaign[]> {
  const { data, error } = await campaignClient.from('influencer_campaigns')
    .select('*, influencer_campaign_creators(influencer_id)').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function campaignErrorMessage(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('campaign_conflict')) return 'La campaña cambió en otra sesión. Volvé a abrirla antes de guardar.';
  if (message.includes('campaign_not_ready')) return 'Para activar faltan un brief de al menos 20 caracteres, presupuesto, fecha vigente y creadores activos.';
  if (message.includes('invalid_campaign_creator')) return 'Algún creador ya no está disponible. Revisá la selección.';
  if (message.includes('permission_denied')) return 'No tenés permiso para realizar esta acción.';
  if (message.includes('campaign_not_editable') || message.includes('invalid_campaign_transition')) return 'El estado de la campaña no permite esta acción. Actualizá el listado.';
  return 'No pudimos guardar los cambios. Revisá tu conexión e intentá nuevamente.';
}

export async function saveInfluencerCampaign(orgId: string, draft: CampaignDraft): Promise<string> {
  const { data, error } = await campaignClient.rpc('save_influencer_campaign', {
    p_org_id: orgId, p_id: draft.id, p_version: draft.version, p_title: draft.title,
    p_brief: draft.brief, p_objective: draft.objective, p_channel: draft.channel,
    p_budget_ars: draft.budget_ars, p_due_date: draft.due_date || null, p_creator_ids: draft.creator_ids,
  });
  if (error) throw error;
  if (!data?.id) throw new Error('missing_campaign');
  return data.id;
}

export async function transitionInfluencerCampaign(orgId: string, campaign: InfluencerCampaign, status: CampaignStatus): Promise<void> {
  const { data, error } = await campaignClient.rpc('transition_influencer_campaign', {
    p_org_id: orgId, p_id: campaign.id, p_version: campaign.version, p_status: status,
  });
  if (error) throw error;
  if (!data?.id) throw new Error('missing_campaign');
}
