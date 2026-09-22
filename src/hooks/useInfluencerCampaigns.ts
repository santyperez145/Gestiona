import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/lib/orgContext';
import { listInfluencerCampaigns } from '@/lib/influencerCampaignsDB';

export function useInfluencerCampaigns() {
  const { activeOrg } = useOrg();
  return useQuery({
    queryKey: ['influencer-campaigns', activeOrg?.id],
    queryFn: () => listInfluencerCampaigns(activeOrg!.id),
    enabled: Boolean(activeOrg?.id),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: undefined,
  });
}
