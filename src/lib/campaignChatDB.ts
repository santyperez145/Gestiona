import { supabase as _supabase } from '@/integrations/supabase/client';

// influencer_campaign_messages aún no está en los tipos generados.
export const sb: any = _supabase;

/** Un mensaje del hilo de una colaboración campaña+creador. */
export type CampaignChatMessage = {
  id: string;
  author_role: 'brand' | 'creator';
  body: string;
  created_at: string;
};

/**
 * Lee el hilo de chat de una colaboración desde el lado marca.
 * El RPC resuelve permisos server-side (influencers view sobre la org).
 */
export async function listCampaignChat(campaignId: string, influencerId: string): Promise<CampaignChatMessage[]> {
  const { data, error } = await sb.rpc('campaign_chat_list', {
    p_campaign_id: campaignId,
    p_influencer_id: influencerId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CampaignChatMessage[];
}

/**
 * Envía un mensaje como marca. El servidor valida que el creador esté
 * asignado a la campaña y aplica anti-spam (1 mensaje / 10 s por hilo).
 */
export async function sendCampaignChatMessage(campaignId: string, influencerId: string, body: string): Promise<CampaignChatMessage> {
  const { data, error } = await sb.rpc('campaign_chat_send', {
    p_campaign_id: campaignId,
    p_body: body,
    p_influencer_id: influencerId,
  });
  if (error) throw error;
  return data as CampaignChatMessage;
}

/** Mensaje legible del error para la UI (sin exponer códigos de Postgres). */
export function campaignChatErrorMessage(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('chat_rate_limited')) return 'Esperá unos segundos antes de mandar otro mensaje.';
  if (message.includes('invalid_body')) return 'El mensaje está vacío o supera los 2000 caracteres.';
  if (message.includes('creator_not_assigned')) return 'Ese creador no participa de esta campaña.';
  if (message.includes('permission_denied') || message.includes('not_authenticated')) return 'No tenés permiso para escribir en este chat.';
  if (message.includes('campaign_not_found')) return 'La colaboración ya no existe. Actualizá el listado.';
  return 'No pudimos enviar el mensaje. Revisá tu conexión e intentá de nuevo.';
}
