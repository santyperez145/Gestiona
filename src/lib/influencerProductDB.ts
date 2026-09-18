// Módulo de acceso al producto Influencer Marketing (Nerqia).
// Actúa como puente entre useInfluencerProductAccess y supabase.
// Se mantiene como archivo independiente para no mezclar con influencersDB.
export interface ProductSurfaceAccess {
  module: string;
  can_view: boolean;
  can_request: boolean;
  request_status?: 'pending' | 'approved' | 'rejected';
}

export async function getInfluencerProductAccess(orgId?: string): Promise<ProductSurfaceAccess | null> {
  // Datos reales: consultar supabase si está disponible; por ahora devolver un default
  return { module: 'influencers', can_view: true, can_request: true };
}

export async function requestInfluencerProductAccess(orgId?: string): Promise<{ ok: boolean; message?: string }> {
  return { ok: true, message: 'Solicitado' };
}
