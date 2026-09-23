-- ============================================================================
-- Feedback de revisión en la bandeja del creador
-- La marca revisa el entregable ('entregado' → 'completado' con review_notes
-- o 'pendiente' con notas de corrección). El creador ve ese feedback directo
-- en su portal, sin pedirlo por WhatsApp.
-- ============================================================================

DROP FUNCTION IF EXISTS public.creator_campaigns();
CREATE OR REPLACE FUNCTION public.creator_campaigns()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  title text,
  brief text,
  channel text,
  due_date date,
  status text,
  budget_ars numeric,
  invitation_status text,
  deliverable_url text,
  deliverable_status text,
  review_notes text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id, o.name, c.title, c.brief, c.channel, c.due_date,
         c.status, c.budget_ars,
         (SELECT ii.status FROM public.influencer_invitations ii
          WHERE ii.campaign_id = c.id AND lower(ii.email) = lower(ca.email)
          ORDER BY ii.created_at DESC LIMIT 1),
         (SELECT d.content_url FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         (SELECT d.status FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         (SELECT d.review_notes FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
            AND d.review_notes IS NOT NULL
          ORDER BY d.updated_at DESC LIMIT 1)
  FROM public.influencer_campaigns c
  JOIN public.influencers i ON i.org_id = c.org_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = c.org_id
  WHERE lower(i.email) = lower(ca.email)
    AND EXISTS (SELECT 1 FROM public.influencer_campaign_creators cc
                WHERE cc.campaign_id = c.id AND cc.influencer_id = i.id)
  ORDER BY c.due_date NULLS LAST, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922000600', 'creator_campaign_review_feedback') ON CONFLICT DO NOTHING;