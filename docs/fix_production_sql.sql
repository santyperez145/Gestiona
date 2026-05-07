-- ============================================================
-- PASTE IN: Supabase Dashboard > SQL Editor
-- Project: wcfohngxrtopgggumjmw
-- ============================================================

-- FIX 1: column m.created_at does not exist (POST /sales 400)
-- Triggers look for memberships.created_at but the column is joined_at.
-- Add created_at as an alias so all triggers keep working.
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.memberships
   SET created_at = joined_at
 WHERE created_at = now()
   AND joined_at IS NOT NULL;


-- FIX 2: influencer_exchanges 403 Forbidden
DROP POLICY IF EXISTS "Org admins manage exchanges"  ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Admin manages exchanges"      ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Users manage own exchanges"   ON public.influencer_exchanges;
DROP POLICY IF EXISTS "org_members_manage_exchanges" ON public.influencer_exchanges;

ALTER TABLE public.influencer_exchanges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_manage_exchanges"
  ON public.influencer_exchanges
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );
