import { sb } from './influencersDB';

export interface CreatorProfile {
  id: string;
  name: string;
  handle: string;
  platform: string;
  followers: number;
  engagement_rate: number;
  tier: string;
  verified: boolean;
  reputation_score: number;
  reviews_count: number;
  avg_review: number;
  completed_works: number;
  bio: string;
  avatar_url?: string;
  contact_email?: string;
}

export async function getCreatorProfile(id: string): Promise<CreatorProfile | null> {
  const { data, error } = await sb.from('influencers').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as CreatorProfile;
}

export async function updateCreatorProfile(id: string, updates: Partial<CreatorProfile>) {
  const { data, error } = await sb.from('influencers').update(updates).eq('id', id).select().single();
  return error ? null : (data as CreatorProfile);
}

export async function listCreatorWorks(influencerId: string) {
  const { data } = await sb.from('influencer_deliverables').select('*').eq('influencer_id', influencerId);
  return data || [];
}

export async function listCreatorReviews(influencerId: string) {
  const { data } = await sb.from('influencer_reviews').select('*').eq('influencer_id', influencerId);
  return data || [];
}
